/**
 * STUDIO-020-008 — the step-up window, the seven triggers, and the four ways a
 * session fails to satisfy them.
 *
 * Everything here drives the REAL tables. The triggers are asserted over
 * `STUDIO_COMMANDS` itself rather than over a fixture command, because the
 * property that matters is one about what this console ships: every lifecycle
 * write demands a fresh authentication, and no read does.
 *
 * The window boundary is asserted in terms of `STEP_UP_MAX_AGE_SECONDS` rather
 * than the number 900. A test that hard-codes the number passes when somebody
 * widens the window to four hours and the constant with it, which is precisely
 * the change a reviewer would want reddened.
 */

/* `authorizeCommand` is not called here, but `POLICY_REVISION` is imported
 * transitively and `roleOf` parses this allowlist on load in other suites. Set
 * before the import so nothing in the module graph reads an empty environment.
 */
process.env.PLATFORM_OPERATORS = "lead@tenure.example:platform-super-admin"
process.env.PLATFORM_OPERATOR_SECRET = "kQ7pXm2Zr9Tb4Ns6Wf1Yc8Vd3Hj5Lg0"

import { POLICY_REVISION, STUDIO_COMMANDS, type StudioCommand } from "./authorize"
import {
  AUTHENTICATED_AT_CLAIM,
  STEP_UP_MAX_AGE_SECONDS,
  STEP_UP_TRIGGERS,
  authenticatedAtOf,
  dataExportStepUp,
  sessionWithAuthentication,
  stampAuthentication,
  stepUpTriggers,
  stepUpVerdict,
  triggersNoCommandCanFire,
  type StepUpAction,
  type StepUpSession,
} from "./step-up"

const NOW = new Date("2026-08-20T12:00:00.000Z")

/** A session that authenticated `seconds` ago. */
const aged = (seconds: number): StepUpSession => ({
  authenticatedAt: new Date(NOW.getTime() - seconds * 1000).toISOString(),
  policyRevisionAtRender: POLICY_REVISION,
})

const purge = (): StepUpAction => ({
  command: "tenant.lifecycle.advance",
  environment: "non-production",
  operation: { surface: "tenant-lifecycle", action: "PURGING", target: "simon" },
  recurringMonthly: null,
})

describe("which of the seven a command is", () => {
  test("a lifecycle write fires the lifecycle trigger and a lifecycle read fires nothing", () => {
    const base = { environment: "non-production", operation: null, recurringMonthly: null } as const
    expect(stepUpTriggers({ ...base, command: "tenant.lifecycle.advance" })).toEqual(["lifecycle"])
    expect(stepUpTriggers({ ...base, command: "tenant.lifecycle.read" })).toEqual([])
  })

  test("an approval is security-sensitive because the verb is, not because of what it is aimed at", () => {
    expect(
      stepUpTriggers({
        command: "tenant.lifecycle.approve",
        environment: "non-production",
        operation: null,
        recurringMonthly: null,
      }),
    ).toEqual(["security-sensitive", "lifecycle"])
  })

  test("production fires on the environment alone, for a command that is otherwise ordinary", () => {
    expect(
      stepUpTriggers({
        command: "platform.read",
        environment: "production",
        operation: null,
        recurringMonthly: null,
      }),
    ).toEqual(["production"])
  })

  test("PURGING is destructive because `classify` says C7 — no second list of dangerous states", () => {
    expect(stepUpTriggers(purge())).toEqual(["lifecycle", "destructive"])
  })

  test("a move that is not C7 is not destructive, on the same command", () => {
    expect(
      stepUpTriggers({
        ...purge(),
        operation: { surface: "tenant-lifecycle", action: "READY", target: "simon" },
      }),
    ).toEqual(["lifecycle"])
  })

  test("high cost is the finops band, so a commitment under the threshold does not fire it", () => {
    const spendy = stepUpTriggers({
      command: "tenants.compose",
      environment: "non-production",
      operation: null,
      recurringMonthly: { minorUnits: 5_000_000, currency: "USD", change: "Provisioning simon" },
    })
    const cheap = stepUpTriggers({
      command: "tenants.compose",
      environment: "non-production",
      operation: null,
      recurringMonthly: { minorUnits: 1, currency: "USD", change: "Provisioning simon" },
    })
    expect(spendy).toEqual(["high-cost"])
    expect(cheap).toEqual([])
  })

  test("triggers are reported in the requirement's own order, not in the order they fired", () => {
    const fired = stepUpTriggers({
      command: "tenant.lifecycle.approve",
      environment: "production",
      operation: { surface: "tenant-lifecycle", action: "PURGING", target: "simon" },
      recurringMonthly: { minorUnits: 5_000_000, currency: "USD", change: "Purging simon" },
    })
    expect(fired).toEqual([
      "production",
      "high-cost",
      "security-sensitive",
      "lifecycle",
      "destructive",
    ])
    // The order is the constant's, so this cannot pass by coincidence.
    expect(fired).toEqual(STEP_UP_TRIGGERS.filter((t) => fired.includes(t)))
  })

  test("a surface trigger can only make the check stricter", () => {
    const withoutIt = stepUpTriggers({
      command: "platform.read",
      environment: "non-production",
      operation: null,
      recurringMonthly: null,
    })
    const withIt = stepUpTriggers({
      command: "platform.read",
      environment: "non-production",
      operation: null,
      recurringMonthly: null,
      surfaceTriggers: ["data-export"],
    })
    expect(withoutIt).toEqual([])
    expect(withIt).toEqual(["data-export"])
  })

  test("every write in the real command table is covered by at least one trigger in production", () => {
    const uncovered = (Object.keys(STUDIO_COMMANDS) as StudioCommand[]).filter((command) => {
      if (STUDIO_COMMANDS[command].action === "read") return false
      return (
        stepUpTriggers({
          command,
          environment: "production",
          operation: null,
          recurringMonthly: null,
        }).length === 0
      )
    })
    expect(uncovered).toEqual([])
  })

  test("the two triggers no command can fire are named rather than silently absent", () => {
    expect(triggersNoCommandCanFire()).toEqual(["data-export", "identity"])
  })
})

describe("the window", () => {
  test("an authentication one second inside the window satisfies a triggering command", () => {
    const verdict = stepUpVerdict(purge(), aged(STEP_UP_MAX_AGE_SECONDS - 1), NOW)
    expect(verdict.outcome).toBe("SATISFIED")
    expect(verdict.permitted).toBe(true)
    expect(verdict.ageSeconds).toBe(STEP_UP_MAX_AGE_SECONDS - 1)
  })

  test("an authentication exactly at the window still satisfies it", () => {
    expect(stepUpVerdict(purge(), aged(STEP_UP_MAX_AGE_SECONDS), NOW).outcome).toBe("SATISFIED")
  })

  test("one second past the window does not, and the refusal says how old it is", () => {
    const verdict = stepUpVerdict(purge(), aged(STEP_UP_MAX_AGE_SECONDS + 1), NOW)
    expect(verdict.outcome).toBe("AUTHENTICATION_STALE")
    expect(verdict.permitted).toBe(false)
    expect(verdict.detail).toContain(`${STEP_UP_MAX_AGE_SECONDS + 1} seconds old`)
  })

  test("a stale session is still permitted for a command that triggers nothing", () => {
    const verdict = stepUpVerdict(
      {
        command: "tenant.lifecycle.read",
        environment: "non-production",
        operation: null,
        recurringMonthly: null,
      },
      aged(86_400),
      NOW,
    )
    expect(verdict.outcome).toBe("NOT_REQUIRED")
    expect(verdict.permitted).toBe(true)
    expect(verdict.detail).toBe("")
  })

  test("an authentication dated in the future is stale, not fresh", () => {
    const verdict = stepUpVerdict(purge(), aged(-30), NOW)
    expect(verdict.outcome).toBe("AUTHENTICATION_STALE")
    expect(verdict.detail).toContain("ahead of this engine's clock")
  })
})

describe("what a session that cannot be checked gets", () => {
  test("no authentication time at all is refused, not waved through", () => {
    const verdict = stepUpVerdict(
      purge(),
      { authenticatedAt: null, policyRevisionAtRender: POLICY_REVISION },
      NOW,
    )
    expect(verdict.outcome).toBe("NO_AUTHENTICATION_TIME")
    expect(verdict.permitted).toBe(false)
    expect(verdict.detail).toContain("does not record when you")
  })

  test("an unreadable authentication time is its own outcome, not a stale one", () => {
    const verdict = stepUpVerdict(
      purge(),
      { authenticatedAt: "last Tuesday", policyRevisionAtRender: POLICY_REVISION },
      NOW,
    )
    expect(verdict.outcome).toBe("UNREADABLE_AUTHENTICATION_TIME")
    expect(verdict.permitted).toBe(false)
  })

  test("every refusal names the triggers that made the action one, so two refusals differ", () => {
    const lifecycleOnly = stepUpVerdict(
      { ...purge(), operation: null },
      { authenticatedAt: null, policyRevisionAtRender: POLICY_REVISION },
      NOW,
    )
    const alsoDestructive = stepUpVerdict(
      purge(),
      { authenticatedAt: null, policyRevisionAtRender: POLICY_REVISION },
      NOW,
    )
    expect(lifecycleOnly.detail).toContain("lifecycle action")
    expect(alsoDestructive.detail).toContain("lifecycle, destructive action")
    expect(lifecycleOnly.detail).not.toBe(alsoDestructive.detail)
  })
})

describe("fresh authorization", () => {
  test("a submission rendered under a policy that is no longer in force is refused", () => {
    const verdict = stepUpVerdict(
      purge(),
      { ...aged(1), policyRevisionAtRender: "op-deadbeef" },
      NOW,
    )
    expect(verdict.outcome).toBe("AUTHORIZATION_STALE")
    expect(verdict.permitted).toBe(false)
    expect(verdict.detail).toContain("op-deadbeef")
    expect(verdict.detail).toContain(POLICY_REVISION)
  })

  test("a stale policy outranks a fresh authentication, and says re-decide rather than re-authenticate", () => {
    const verdict = stepUpVerdict(
      purge(),
      { authenticatedAt: NOW.toISOString(), policyRevisionAtRender: "op-deadbeef" },
      NOW,
    )
    expect(verdict.outcome).toBe("AUTHORIZATION_STALE")
    expect(verdict.detail).not.toContain("Sign out")
  })

  test("a surface that carries no revision is not treated as agreeing with the current one", () => {
    // It proceeds on the authentication alone — the freshness of the policy is
    // unknown, not asserted — and the verdict still records which policy the
    // decision was actually made under.
    const verdict = stepUpVerdict(
      purge(),
      { authenticatedAt: NOW.toISOString(), policyRevisionAtRender: null },
      NOW,
    )
    expect(verdict.outcome).toBe("SATISFIED")
    expect(verdict.policyRevision).toBe(POLICY_REVISION)
  })

  test("the revision compared is the live one, so a changed grant table changes the answer", () => {
    const verdict = stepUpVerdict(purge(), aged(1), NOW, "op-00000000")
    expect(verdict.outcome).toBe("AUTHORIZATION_STALE")
  })
})

describe("the export door", () => {
  test("an export fires data-export whatever the environment is", () => {
    const verdict = dataExportStepUp(aged(STEP_UP_MAX_AGE_SECONDS + 60), "non-production", NOW)
    expect(verdict.triggers).toEqual(["data-export"])
    expect(verdict.permitted).toBe(false)
  })

  test("a fresh session may export", () => {
    expect(dataExportStepUp(aged(5), "production", NOW).permitted).toBe(true)
  })
})

describe("the stamp", () => {
  test("a fresh sign-in is stamped with the clock it was given", () => {
    const token = stampAuthentication<Record<string, unknown>>(
      { email: "lead@tenure.example" },
      true,
      NOW,
    )
    expect(token[AUTHENTICATED_AT_CLAIM]).toBe(NOW.toISOString())
  })

  test("a re-issued token keeps the stamp it arrived with", () => {
    const first = stampAuthentication<Record<string, unknown>>(
      {},
      true,
      new Date("2026-08-20T09:00:00.000Z"),
    )
    const reissued = stampAuthentication(first, false, NOW)
    expect(reissued[AUTHENTICATED_AT_CLAIM]).toBe("2026-08-20T09:00:00.000Z")
  })

  test("a token that arrives with no stamp does not acquire one on re-issue", () => {
    expect(
      authenticatedAtOf(
        stampAuthentication<Record<string, unknown>>({ email: "x@y.z" }, false, NOW),
      ),
    ).toBeNull()
  })

  test("the session carries the token's stamp, so an action need not decode the JWT", () => {
    const token = stampAuthentication<Record<string, unknown>>({}, true, NOW)
    const session = sessionWithAuthentication({ user: { email: "lead@tenure.example" } }, token)
    expect(authenticatedAtOf(session)).toBe(NOW.toISOString())
  })

  test("a session built from a token with no stamp carries none — it is not dated now", () => {
    const session = sessionWithAuthentication({ user: { email: "lead@tenure.example" } }, {})
    expect(authenticatedAtOf(session)).toBeNull()
    expect(Object.keys(session)).toEqual(["user"])
  })

  test("a non-string stamp reads as absent rather than being coerced", () => {
    expect(authenticatedAtOf({ [AUTHENTICATED_AT_CLAIM]: 1_760_000_000_000 })).toBeNull()
    expect(authenticatedAtOf({ [AUTHENTICATED_AT_CLAIM]: "   " })).toBeNull()
    expect(authenticatedAtOf(null)).toBeNull()
    expect(authenticatedAtOf(undefined)).toBeNull()
  })
})
