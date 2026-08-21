/**
 * STUDIO-140-005 and STUDIO-020-008, driven through the REAL `gate()`.
 *
 * ## Why this suite exists beside `high-risk-gate.test.ts`
 *
 * That one drives `advanceState` — the whole action, with the lifecycle engine
 * and the audit chain behind it — and it is the better test of a refusal an
 * operator can reach. It is also a hundred-line DynamoDB stand-in, and it
 * exercises exactly one command. The two properties asserted here are
 * properties of the GATE, over any command:
 *
 *   * **STUDIO-140-005** — "Prove identical approved intent is idempotent and
 *     that stale/changed intent is rejected rather than overwritten." Four
 *     distinct things can be stale or changed, and each is a separate arm:
 *     the same key with the same request, the same key with a DIFFERENT
 *     request, a version the target has moved past, and a digest the approved
 *     artifact no longer has.
 *   * **STUDIO-020-008** — the step-up refusal at the gate rather than in the
 *     module: `stepUpVerdict` returning `permitted: false` is only worth
 *     something if the gate stops on it.
 *
 * Only `./registry` is replaced, and only its idempotency claim: everything
 * else — `parseCommand`, `authorizeCommand`, `replayable`, `requestDigest`,
 * `approvalFor`, `stepUpVerdict` — is the production function. A stand-in for
 * the claim is unavoidable (it is a conditional write against DynamoDB) and it
 * is written to behave like one: first claim wins, later claims see the stored
 * record.
 */

/* Real values of the real shape, set before the import: `authorizeCommand`
 * parses this allowlist itself, and a malformed one makes every decision
 * CONFIG_UNUSABLE — a real refusal, and not one of the ones under test. */
process.env.AWS_REGION = "us-east-1"
process.env.AWS_ACCOUNT_ID = "000000000000"
process.env.AWS_PARTITION = "aws"
process.env.DEPLOY_ENVIRONMENT = "production"
process.env.PLATFORM_OPERATORS =
  "lead@tenure.example:platform-super-admin,reader@tenure.example:auditor-read-only"
process.env.PLATFORM_OPERATOR_SECRET = "kQ7pXm2Zr9Tb4Ns6Wf1Yc8Vd3Hj5Lg0"

jest.mock("./registry", () => {
  interface Claim {
    key: string
    tenantId: string
    requestDigest: string
    status: "in-flight" | "succeeded" | "failed"
    resultRef: string | null
    expiresAt: string
    operationId: string
  }
  const claims = new Map<string, Claim>()
  return {
    __claims: claims,
    tableName: () => "tenure-studio-tenants-test",
    claimIdempotency: async (slug: string, claim: Claim) => {
      const key = `${slug} ${claim.key}`
      const existing = claims.get(key)
      // The conditional write, in the only two outcomes it has.
      if (existing) return { claimed: false, existing }
      claims.set(key, claim)
      return { claimed: true }
    },
  }
})

import { POLICY_REVISION } from "./authorize"
import { gate, requestDigest, type GateChecks } from "./command-gate"
import { STEP_UP_MAX_AGE_SECONDS } from "./step-up"

/* eslint-disable @typescript-eslint/no-require-imports */
const claims = (require("./registry") as { __claims: Map<string, unknown> }).__claims

const NOW = new Date("2026-08-20T12:00:00.000Z")
const AT = NOW.toISOString()

let keySeq = 0
const nextKey = () => `idem-${++keySeq}`

/** A valid lifecycle command, in the exact shape `advanceState` submits. */
function command(overrides: Record<string, unknown> = {}) {
  return {
    commandId: "cmd-0000000000000000000000000000001",
    context: {
      tenantId: "simon",
      actorId: "lead:tenure.example",
      actorKind: "user",
      channel: "system-studio-form",
      correlationId: "corr-0000000000000000000000000001",
      configRevision: "0",
      environment: "test",
      legalEntityId: null,
      at: AT,
    },
    action: "Tenant.Advance",
    resourceType: "Tenant",
    resourceId: "simon",
    expectedVersion: 3,
    idempotencyKey: nextKey(),
    effectiveAt: AT,
    payload: { to: "READY" },
    ...overrides,
  }
}

/** The checks `advanceState` builds, with a session that authenticated a minute ago. */
function checks(overrides: Partial<GateChecks> = {}): GateChecks {
  return {
    actor: "lead@tenure.example",
    command: "tenant.lifecycle.advance",
    session: {
      authenticatedAt: new Date(NOW.getTime() - 60_000).toISOString(),
      policyRevisionAtRender: POLICY_REVISION,
    },
    now: NOW,
    operation: { surface: "tenant-lifecycle", action: "READY", target: "simon" },
    current: async () => ({ version: 3, digest: "sha-current" }),
    expectedDigest: "sha-current",
    recurringMonthly: null,
    approvedBy: null,
    operationId: "op-0000000000000000000000000001",
    ...overrides,
  }
}

beforeEach(() => claims.clear())

describe("STUDIO-140-005 — identical intent is idempotent", () => {
  test("the same key and the same request returns the first operation rather than running again", async () => {
    const raw = command()
    const first = await gate(raw, checks())
    expect(first.kind).toBe("proceed")

    const second = await gate(raw, checks({ operationId: "op-second" }))
    expect(second.kind).toBe("replay")
    if (second.kind !== "replay") throw new Error("unreachable")
    // The FIRST operation id, not the second. A replay that returned the
    // caller's own new id would be a second attempt wearing the first's name.
    expect(second.replay.operationId).toBe("op-0000000000000000000000000001")
    expect(claims.size).toBe(1)
  })

  test("a request built with its fields in a different order is the same request", async () => {
    const key = nextKey()
    const a = command({ idempotencyKey: key, payload: { to: "READY", reason: null } })
    const b = command({ idempotencyKey: key, payload: { reason: null, to: "READY" } })
    expect(requestDigest(a as never)).toBe(requestDigest(b as never))

    expect((await gate(a, checks())).kind).toBe("proceed")
    expect((await gate(b, checks())).kind).toBe("replay")
  })
})

describe("STUDIO-140-005 — changed or stale intent is rejected, never overwritten", () => {
  test("the same key over a DIFFERENT request is a conflict and never a replay", async () => {
    const key = nextKey()
    await gate(command({ idempotencyKey: key, payload: { to: "READY" } }), checks())

    const outcome = await gate(
      command({ idempotencyKey: key, payload: { to: "PURGE_PENDING" } }),
      checks(),
    )
    expect(outcome.kind).toBe("refused")
    if (outcome.kind !== "refused") throw new Error("unreachable")
    expect(outcome.refusal.code).toBe("idempotency-conflict")
    expect(outcome.refusal.status).toBe(409)
    // And the stored claim still describes the FIRST request. "Rejected rather
    // than overwritten" is a statement about the store, not only the response.
    const stored = [...claims.values()][0] as { requestDigest: string }
    expect(stored.requestDigest).toBe(
      requestDigest(command({ idempotencyKey: key, payload: { to: "READY" } }) as never),
    )
  })

  test("a version the target has moved past is refused, and the message names both", async () => {
    const outcome = await gate(
      command({ expectedVersion: 3 }),
      checks({ current: async () => ({ version: 4, digest: "sha-current" }) }),
    )
    expect(outcome.kind).toBe("refused")
    if (outcome.kind !== "refused") throw new Error("unreachable")
    expect(outcome.refusal.code).toBe("version-conflict")
    expect(outcome.refusal.detail).toContain("version 3")
    expect(outcome.refusal.detail).toContain("at 4")
    // Nothing was claimed: a key burned by a refused command turns the
    // operator's corrected retry into a conflict with their own mistake.
    expect(claims.size).toBe(0)
  })

  test("the same version over a REWRITTEN artifact is refused too", async () => {
    const outcome = await gate(
      command(),
      checks({ current: async () => ({ version: 3, digest: "sha-rewritten" }) }),
    )
    expect(outcome.kind).toBe("refused")
    if (outcome.kind !== "refused") throw new Error("unreachable")
    expect(outcome.refusal.code).toBe("version-conflict")
    expect(outcome.refusal.detail).toContain("changed since it was reviewed")
  })

  test("a target that no longer exists is refused rather than created", async () => {
    const outcome = await gate(command(), checks({ current: async () => null }))
    expect(outcome.kind).toBe("refused")
    if (outcome.kind !== "refused") throw new Error("unreachable")
    expect(outcome.refusal.status).toBe(404)
  })
})

describe("STUDIO-020-008 — the gate stops on the step-up verdict", () => {
  test("a lifecycle write from a stale session is refused with its own code", async () => {
    const outcome = await gate(
      command(),
      checks({
        session: {
          authenticatedAt: new Date(
            NOW.getTime() - (STEP_UP_MAX_AGE_SECONDS + 60) * 1000,
          ).toISOString(),
          policyRevisionAtRender: POLICY_REVISION,
        },
      }),
    )
    expect(outcome.kind).toBe("refused")
    if (outcome.kind !== "refused") throw new Error("unreachable")
    expect(outcome.refusal.code).toBe("step-up-required")
    expect(outcome.refusal.status).toBe(403)
    expect(outcome.refusal.detail).toContain("lifecycle action")
    expect(claims.size).toBe(0)
  })

  test("a session with no authentication time is refused, not waved through", async () => {
    const outcome = await gate(
      command(),
      checks({ session: { authenticatedAt: null, policyRevisionAtRender: POLICY_REVISION } }),
    )
    expect(outcome.kind).toBe("refused")
    if (outcome.kind !== "refused") throw new Error("unreachable")
    expect(outcome.refusal.code).toBe("step-up-required")
  })

  test("a form rendered under a policy that has since changed is refused", async () => {
    const outcome = await gate(
      command(),
      checks({
        session: {
          authenticatedAt: new Date(NOW.getTime() - 60_000).toISOString(),
          policyRevisionAtRender: "op-deadbeef",
        },
      }),
    )
    expect(outcome.kind).toBe("refused")
    if (outcome.kind !== "refused") throw new Error("unreachable")
    expect(outcome.refusal.code).toBe("step-up-required")
    expect(outcome.refusal.detail).toContain("op-deadbeef")
  })

  test("the step-up refusal comes BEFORE the target is read", async () => {
    let read = 0
    await gate(
      command(),
      checks({
        session: { authenticatedAt: null, policyRevisionAtRender: POLICY_REVISION },
        current: async () => {
          read++
          return { version: 3, digest: "sha-current" }
        },
      }),
    )
    expect(read).toBe(0)
  })

  test("an operator who lacks the permission is told THAT, not that their session is stale", async () => {
    const outcome = await gate(
      command(),
      checks({
        actor: "reader@tenure.example",
        session: { authenticatedAt: null, policyRevisionAtRender: POLICY_REVISION },
      }),
    )
    expect(outcome.kind).toBe("refused")
    if (outcome.kind !== "refused") throw new Error("unreachable")
    expect(outcome.refusal.code).toBe("not-authorized")
  })

  test("a permitted command carries the verdict, so an audit row can record why it was allowed", async () => {
    const outcome = await gate(command(), checks())
    expect(outcome.kind).toBe("proceed")
    if (outcome.kind !== "proceed") throw new Error("unreachable")
    expect(outcome.stepUp.outcome).toBe("SATISFIED")
    expect(outcome.stepUp.triggers).toEqual(["production", "lifecycle"])
    expect(outcome.stepUp.ageSeconds).toBe(60)
    expect(outcome.stepUp.policyRevision).toBe(POLICY_REVISION)
  })
})
