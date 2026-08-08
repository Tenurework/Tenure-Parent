import fs from "fs"
import path from "path"

import { test, expect } from "@playwright/test"

import {
  CONFIRM_TARGET_FIELD,
  HIGH_RISK_FIELDS,
  RISK_DIGEST_FIELD,
  STATE_KINDS,
  STATE_META,
  degradationOf,
  missingRiskFields,
  riskDigest,
} from "../src/components/states"
import { backoffMs, isTransient, readWithBackoff } from "../src/lib/aws/throttle"
import { mutationForTransition, planMutation } from "../src/lib/aws/mutate"
import {
  ARCHIVED_STATES,
  PURGE_STATES,
  canReachServing,
  observedFor,
  residualFindings,
  riskOf,
} from "../src/lib/tenant-state"

/**
 * What a pooled, deployed, non-serving tenant is holding.
 *
 * A real observation rather than `[]`: passing an empty list would make every
 * risk panel below report nothing unexplained, which is exactly the answer the
 * reconciliation exists to stop being given by accident.
 */
const POOLED = observedFor({
  isolation: "pooled",
  hasDeployment: true,
  serving: false,
  evidenceRecords: 2,
})

/**
 * GE-022-006 — the rules the state vocabulary is supposed to hold to.
 *
 * No browser needed: these are properties of the vocabulary and of the
 * lifecycle graph it reads. `states.spec.ts` covers what has to be rendered to
 * be checked.
 */

test.describe("the vocabulary is governed, not a habit", () => {
  test("every state carries a distinct word", () => {
    // Bible §26.3.2 forbids meaning carried by colour alone, and this palette is
    // deliberately desaturated — the word IS the signal. Two states sharing one
    // would be two states nobody can tell apart.
    const labels = STATE_KINDS.map((k) => STATE_META[k].label)
    expect(new Set(labels).size).toBe(STATE_KINDS.length)
  })

  test("every state has meta, and meta has no state the vocabulary lacks", () => {
    // Both directions. An entry in one and not the other is how a twelfth state
    // gets added by accident.
    expect(Object.keys(STATE_META).sort()).toEqual([...STATE_KINDS].sort())
  })

  test("no state is louder than the palette allows", () => {
    // Tone is a muted border, never a saturated fill. A console where the eye is
    // pulled to whatever is reddest stops being read.
    for (const kind of STATE_KINDS) {
      expect(["quiet", "warn", "bad"]).toContain(STATE_META[kind].tone)
    }
  })

  test("the fourteen states the item names are exactly these", () => {
    // STUDIO-030-006 raised this from eleven. `retrying` and `degraded` are the
    // two an exponential-backoff AWS reader produces and the vocabulary could
    // not say: a panel waiting out a ThrottlingException, and an estate view
    // where some of the reads never came back. Changing this list is meant to
    // be a deliberate, reviewed edit, which is why the assertion is exhaustive
    // rather than a count.
    //
    // STUDIO-000-007 raised it to fourteen with `unknown`: the ENGINE's own role
    // was refused. It is genuinely a fourteenth rather than a rewording of
    // `permissionDenied`, which is about the human at the keyboard and takes NO
    // identifier for that reason — where `unknown` MUST name the principal, the
    // action and the minimum IAM statement, because Tenure's operators are
    // exactly the people entitled to know what their own task role could not do.
    expect([...STATE_KINDS].sort()).toEqual([
      "archived",
      "conflict",
      "degraded",
      "empty",
      "error",
      "highRisk",
      "loading",
      "offline",
      "partialData",
      "pendingDeletion",
      "permissionDenied",
      "retrying",
      "stale",
      "unknown",
    ])
  })

  test("the unknown state is not a synonym for denied, empty or error", () => {
    // Three states that would all be "nothing to show" in a lesser vocabulary.
    // The words have to differ, because the word is the signal — and the remedy
    // differs too: `unknown` is an IAM statement, `permissionDenied` is a person
    // asking for access, `empty` is nothing at all.
    const words = ["unknown", "permissionDenied", "empty", "error"].map(
      (k) => STATE_META[k as (typeof STATE_KINDS)[number]].label,
    )
    expect(new Set(words).size).toBe(4)
    expect(STATE_META.unknown.label).toBe("Unknown")
    // `warn`, not `bad`: nothing is broken, the engine was not allowed to look.
    expect(STATE_META.unknown.tone).toBe("warn")
  })

  test("the two new ones carry their own words", () => {
    // The distinctness assertion above would still pass if `retrying` were
    // labelled "Loading" and `loading` something else. These are the words.
    expect(STATE_META.retrying.label).toBe("Retrying")
    expect(STATE_META.degraded.label).toBe("Degraded")
    // Muted tokens only, and the two are not equally loud: a backoff has not
    // failed yet, and a read that never came back has.
    expect(STATE_META.retrying.tone).toBe("warn")
    expect(STATE_META.degraded.tone).toBe("bad")
  })
})

/* --------------------------------------------------------------- STUDIO-030-006 --
 * `degraded` is only `degraded` when both halves exist.
 *
 * The narrowing is what lets `DegradedState` require two NON-EMPTY lists in the
 * type. Without it every caller invents its own threshold, and a page renders
 * "Degraded" for an estate where nothing failed — which is the state word
 * equivalent of a smoke alarm nobody believes.
 */
test.describe("a degradation names both halves or is not one", () => {
  const refused = [{ source: "organizations list-accounts", why: "Organizations not in use" }]

  test("nothing failing is whole, not a degradation with an empty list", () => {
    expect(degradationOf(["vpcs", "s3 buckets"], [])).toEqual({ kind: "whole" })
  })

  test("nothing working is down, not degraded", () => {
    // "Degraded" for a view where every read failed is the message that gets an
    // outage treated as a slow page.
    const state = degradationOf([], refused)
    expect(state.kind).toBe("down")
  })

  test("some of each is a degradation, and it carries both halves", () => {
    const state = degradationOf(["vpcs", "s3 buckets"], refused)
    expect(state.kind).toBe("degraded")
    if (state.kind !== "degraded") throw new Error("unreachable")
    expect(state.working).toEqual(["vpcs", "s3 buckets"])
    expect(state.failing).toEqual(refused)
  })
})

/* --------------------------------------------------------------- STUDIO-030-006 --
 * Only what is worth retrying is retried, and the page is told which it was.
 *
 * `read` is the real shape the SDK presents — a promise that rejects with an
 * error whose `name` is the AWS error code. The fixtures below throw exactly
 * that, so a classifier that stopped reading `name` would fail here rather than
 * agree with itself.
 */
test.describe("a throttled read is not a failed read", () => {
  const awsError = (name: string) => Object.assign(new Error(`${name} from DynamoDB`), { name })

  /** Deterministic: the schedule is asserted, never slept. */
  const harness = () => {
    const waits: number[] = []
    return {
      waits,
      opts: { now: () => 1_700_000_000_000, wait: async (ms: number) => void waits.push(ms) },
    }
  }

  test("names the exceptions that mean slow down", () => {
    expect(isTransient(awsError("ProvisionedThroughputExceededException"))).toBe(true)
    expect(isTransient(awsError("ThrottlingException"))).toBe(true)
    // A missing table is not a throttle, and treating it as one is how a page
    // tells an operator to wait for something that will never arrive.
    expect(isTransient(awsError("ResourceNotFoundException"))).toBe(false)
    expect(isTransient(awsError("AccessDeniedException"))).toBe(false)
  })

  test("a read that works is not retried", async () => {
    const h = harness()
    let calls = 0
    const outcome = await readWithBackoff(async () => {
      calls++
      return ["acme"]
    }, h.opts)
    expect(outcome).toEqual({ state: "ok", value: ["acme"] })
    expect(calls).toBe(1)
    expect(h.waits).toEqual([])
  })

  test("a throttle that clears is invisible to the page", async () => {
    const h = harness()
    let calls = 0
    const outcome = await readWithBackoff(async () => {
      calls++
      if (calls === 1) throw awsError("ThrottlingException")
      return ["acme"]
    }, h.opts)
    expect(outcome.state).toBe("ok")
    expect(calls).toBe(2)
    // Exponential from 200ms, and the first attempt is not a retry.
    expect(h.waits).toEqual([200])
  })

  test("a fault is reported at once, not retried three times", async () => {
    const h = harness()
    let calls = 0
    const outcome = await readWithBackoff(async () => {
      calls++
      throw awsError("ResourceNotFoundException")
    }, h.opts)
    expect(outcome.state).toBe("failed")
    if (outcome.state !== "failed") throw new Error("unreachable")
    expect(outcome.why).toMatch(/ResourceNotFoundException/)
    // Retrying a missing table makes the page slower and the answer no better.
    expect(calls).toBe(1)
    expect(h.waits).toEqual([])
  })

  test("a throttle that outlasts the budget is retrying, and says when", async () => {
    const h = harness()
    let calls = 0
    const outcome = await readWithBackoff(
      async () => {
        calls++
        throw awsError("ProvisionedThroughputExceededException")
      },
      { ...h.opts, attempts: 3 },
    )
    expect(outcome.state).toBe("retrying")
    if (outcome.state !== "retrying") throw new Error("unreachable")
    expect(calls).toBe(3)
    expect(h.waits).toEqual([backoffMs(2), backoffMs(3)])
    expect(outcome.attempt).toBe(3)
    expect(outcome.of).toBe(3)
    // The instant is the schedule's, not a guess: 1_700_000_000_000 + 800ms.
    expect(outcome.nextAttemptAt).toBe(new Date(1_700_000_000_000 + backoffMs(4)).toISOString())
    expect(outcome.why).toMatch(/ProvisionedThroughputExceededException/)
  })

  test("the backoff actually grows", () => {
    // A "schedule" that returned a constant would pass every assertion above
    // that only checks it was called.
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([0, 200, 400, 800])
  })
})

/* --------------------------------------------------------------- STUDIO-030-006 --
 * The panel that renders `retrying` is reached from production, not only from
 * the cases above.
 */
test("the fleet page renders RetryingState for a throttled registry read", () => {
  const page = fs.readFileSync(
    path.join(__dirname, "..", "src", "app", "tenants", "page.tsx"),
    "utf8",
  )
  // The registry read goes THROUGH the classifier — not around it, and not
  // through a copy of it that a page grew for itself.
  expect(page).toMatch(/readWithBackoff\(\(\) => list\w+\(\)\)/)
  expect(page).toMatch(/outcome\.state === "retrying"/)
  expect(page).toMatch(/<RetryingState/)
  // And the throttled arm is not also the failed arm: a page that assigned both
  // to `failure` would still contain every string above.
  expect(page).toMatch(/throttled \? \(/)
})

/* --------------------------------------------------------------- STUDIO-030-006 --
 * And so is the panel that renders `degraded`.
 *
 * `degradationOf` had a unit test and a production caller and nothing tying the
 * two together, which is the same defect in the other half of the item: the
 * narrowing could keep passing every assertion above while the estate page
 * rendered its old table of three refusals and never said what that left.
 */
test("the platform page renders DegradedState from the inventory's own refusals", () => {
  const page = fs.readFileSync(
    path.join(__dirname, "..", "src", "app", "platform", "page.tsx"),
    "utf8",
  )
  // Derived from the inventory, not written down. `degradationOf(answered, [])`
  // — a caller that passes an empty failing half — can never be a degradation,
  // and would render "nothing was refused" over an estate with three refusals.
  expect(page).toMatch(/degradationOf\(answered, refused\)/)
  // Both halves reach the component. `DegradedState` requires them in the type,
  // but a page could satisfy `tsc` with two literals.
  expect(page).toMatch(/<DegradedState[^>]*working=\{state\.working\}/)
  expect(page).toMatch(/<DegradedState[\s\S]{0,120}failing=\{state\.failing\}/)
  // And the other two arms are not the same arm. "Degraded" for an estate where
  // every read failed is the message that gets an outage treated as a slow page,
  // and for one where none did it is a smoke alarm nobody believes.
  expect(page).toMatch(/state\.kind === "whole"/)
  expect(page).toMatch(/state\.kind === "down"/)
})

test.describe("a high-risk confirmation cannot be partial", () => {
  const complete = {
    target: "acme — currently ACTIVE",
    impact: "Does not serve traffic in this state.",
    policy: "Lifecycle requires a recorded approver.",
    approval: "A second operator identity.",
    reversibility: "Reversible.",
  }

  test("accepts all five", () => {
    expect(missingRiskFields(complete)).toEqual([])
  })

  test("names each one that is missing", () => {
    // Bible §26.6 requires all five. A confirmation missing reversibility is the
    // one people click through, which is worse than no confirmation at all.
    for (const field of HIGH_RISK_FIELDS) {
      const partial = { ...complete, [field]: "" }
      expect(missingRiskFields(partial)).toEqual([field])
    }
  })

  test("treats whitespace as missing", () => {
    expect(missingRiskFields({ ...complete, reversibility: "   " })).toEqual(["reversibility"])
  })

  /* ------------------------------------------------------- STUDIO-140-006 --
   * The digest that binds what was READ to what EXECUTES.
   */
  test("the same five facts digest the same, every time", () => {
    // Otherwise the gate refuses every submission, which is a different bug
    // wearing the same message.
    expect(riskDigest(complete)).toBe(riskDigest({ ...complete }))
    expect(riskDigest(complete)).toMatch(/^[0-9a-f]{32}$/)
  })

  test("changing ANY of the five changes it", () => {
    // Field by field rather than one sample: a digest over four of the five
    // would pass a single-field check and silently let the fifth change under
    // an approver — and reversibility, the one most worth binding, is last.
    for (const field of HIGH_RISK_FIELDS) {
      const altered = { ...complete, [field]: `${complete[field]} (changed)` }
      expect(riskDigest(altered), `${field} does not affect the digest`).not.toBe(
        riskDigest(complete),
      )
    }
  })

  test("moving text across a field boundary changes it", () => {
    // A digest that joins the fields on a printable separator hashes
    // {target: "a|b", impact: "c"} and {target: "a", impact: "b|c"} alike, so an
    // approver could be shown one split and the server compute another.
    const left = { ...complete, target: "acme", impact: "-- ACTIVE. Does not serve." }
    const right = { ...complete, target: "acme -- ACTIVE.", impact: " Does not serve." }
    expect(riskDigest(left)).not.toBe(riskDigest(right))
  })
})

/* --------------------------------------------------------------- STUDIO-140-006 --
 * The confirmation is submitted, not merely displayed.
 *
 * The inputs `HighRiskConfirmation` renders are plain form controls with no
 * client state: outside a `<form>` they are inert, and the server refuses
 * without them — so a panel rendered BESIDE the form rather than in it is a gate
 * that can never be satisfied. That is exactly where the panel used to be.
 */
test("the confirmation fields are inside the form that submits them", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "app", "tenants", "[slug]", "AdvanceControls.tsx"),
    "utf8",
  )

  const formStart = source.indexOf("<form action={action}>")
  const formEnd = source.indexOf("</form>")
  const confirmation = source.indexOf("<HighRiskConfirmation")

  expect(formStart, "the advance form is gone").toBeGreaterThan(-1)
  expect(confirmation, "the high-risk confirmation is gone").toBeGreaterThan(-1)
  expect(confirmation).toBeGreaterThan(formStart)
  expect(confirmation).toBeLessThan(formEnd)

  // And it is handed what to demand. A confirmation with no `confirm` prop does
  // not compile, but a confirmation asking for the wrong string compiles fine —
  // the server compares against the slug it resolved itself, so the value the
  // panel asks for has to derive from the slug rather than from anything the
  // browser chose.
  expect(source).toMatch(/expected:[^\n]*\bslug\b/)
})

/* --------------------------------------------------------------- STUDIO-140-006 --
 * The destructive half of the AWS mutation surface is refused, with the command.
 */
test.describe("this console does not perform an irreversible AWS mutation", () => {
  const base = {
    resource: "dynamodb:tenure-tenants/TENANT#acme",
    serving: false,
    reason: "purge",
    runYourself: ["aws dynamodb batch-write-item --request-items file://delete.json"],
  } as const

  test("refuses terminate, delete and revoke outright", () => {
    for (const verb of ["terminate", "delete", "revoke"] as const) {
      const verdict = planMutation({ ...base, verb })
      expect(verdict.outcome, verb).toBe("REFUSED_IRREVERSIBLE")
      if (verdict.outcome !== "REFUSED_IRREVERSIBLE") throw new Error("unreachable")
      // The remedy travels with the refusal. Without it an operator's next move
      // is to find someone with wider credentials, which is worse than the
      // mutation this gate stopped.
      expect(verdict.message).toContain("aws dynamodb batch-write-item")
      expect(verdict.runYourself).toEqual(base.runYourself)
    }
  })

  test("scale-to-zero turns on whether it is serving", () => {
    // Taking an idle task to zero is a saving. Taking a serving one to zero is
    // an outage. One verb, decided from the resource rather than from what the
    // caller chose to call it.
    expect(planMutation({ ...base, verb: "scale-to-zero", serving: false }).outcome).toBe(
      "PERMITTED",
    )
    expect(planMutation({ ...base, verb: "scale-to-zero", serving: true }).outcome).toBe(
      "REFUSED_IRREVERSIBLE",
    )
  })

  test("permits the reversible verbs", () => {
    for (const verb of ["create", "update", "tag"] as const) {
      expect(planMutation({ ...base, verb }).outcome, verb).toBe("PERMITTED")
    }
  })

  test("refuses to refuse without a command a human can run", () => {
    // A refusal with no remedy is a dead end, and this is a programming error
    // rather than something to show an operator.
    expect(() => planMutation({ ...base, verb: "delete", runYourself: [] })).toThrow(
      /without a command a human could run/,
    )
  })

  test("PURGING is the delete, and it names the real table", () => {
    const mutation = mutationForTransition({
      slug: "acme",
      to: "PURGING",
      isolation: "pooled",
      serving: false,
      tenantTable: "tenure-tenants-ci",
      reason: "offboarded",
    })
    expect(mutation).not.toBeNull()
    expect(mutation!.verb).toBe("delete")
    expect(mutation!.resource).toBe("dynamodb:tenure-tenants-ci/TENANT#acme")
    expect(mutation!.runYourself.join(" ")).toContain("tenure-tenants-ci")
  })

  test("hibernating a POOLED tenant is not an AWS mutation at all", () => {
    // "Nothing to do" and "allowed to do it" are different answers, and a
    // pooled tenant has no compute of its own to stop.
    expect(
      mutationForTransition({
        slug: "acme",
        to: "HIBERNATING",
        isolation: "pooled",
        serving: true,
        tenantTable: "t",
        reason: "r",
      }),
    ).toBeNull()
  })

  test("hibernating a SERVING dedicated tenant is a scale-to-zero on a serving resource", () => {
    const mutation = mutationForTransition({
      slug: "acme",
      to: "HIBERNATING",
      isolation: "dedicated-account",
      serving: true,
      tenantTable: "t",
      reason: "r",
    })
    expect(mutation!.verb).toBe("scale-to-zero")
    expect(planMutation(mutation!).outcome).toBe("REFUSED_IRREVERSIBLE")

    // And not when it is already not serving: the console must still be able to
    // do the cheap, safe thing.
    const idle = mutationForTransition({
      slug: "acme",
      to: "HIBERNATING",
      isolation: "dedicated-account",
      serving: false,
      tenantTable: "t",
      reason: "r",
    })
    expect(idle).toBeNull()
  })

  test("an ordinary move asks for no AWS mutation", () => {
    for (const to of ["ACTIVATING", "SUSPENDING", "IDLE"] as const) {
      expect(
        mutationForTransition({
          slug: "acme",
          to,
          isolation: "dedicated-account",
          serving: true,
          tenantTable: "t",
          reason: "r",
        }),
        to,
      ).toBeNull()
    }
  })
})

/* --------------------------------------------------------------- STUDIO-140-006 --
 * The two field names are one fact, not two.
 */
test("the form writes the fields the action reads", () => {
  const action = fs.readFileSync(
    path.join(__dirname, "..", "src", "app", "tenants", "actions.ts"),
    "utf8",
  )
  // Imported rather than spelled twice. A literal on either side is a gate that
  // is always satisfied and never checked, and neither `tsc` nor a rendering
  // test can see the mismatch.
  expect(action).toContain("CONFIRM_TARGET_FIELD")
  expect(action).toContain("RISK_DIGEST_FIELD")
  expect(CONFIRM_TARGET_FIELD).toBe("confirmTarget")
  expect(RISK_DIGEST_FIELD).toBe("riskDigest")

  /* ------------------------------------------------------- STUDIO-140-006 --
   * And the gate runs BEFORE the command gate claims anything.
   *
   * `src/lib/high-risk-gate.test.ts` drives all five refusals through the real
   * action and proves each one refuses; what it cannot see is ORDER, because a
   * `highRiskVerdict` called after `gate` still refuses — having first burned
   * the operator's idempotency key on a request that was never going to run,
   * so the retry they make after fixing their typo is rejected as a replay of
   * the refusal. This is the one assertion that keeps the two in order.
   */
  const verdict = action.indexOf("highRiskVerdict({")
  const claim = action.indexOf("await gate<AdvancePayload>(")
  expect(verdict, "advanceState no longer calls the high-risk gate").toBeGreaterThan(-1)
  expect(claim).toBeGreaterThan(-1)
  expect(verdict).toBeLessThan(claim)
  // And its answer is what the operator is told, rather than being computed and
  // dropped — the exact shape of "correct code, zero effect".
  expect(action).toMatch(/await resolve\(verdict\.code, verdict\.detail\)/)
  expect(action).toMatch(/return \{ error: verdict\.detail \}/)
})

test.describe("risk is computed from the lifecycle graph, not written down", () => {
  test("a purge is irreversible and says the word", () => {
    // The single most important fact before the click. `PURGED_...` has no path
    // back to anything serving, and this must not depend on someone having
    // labelled it.
    expect(canReachServing("PURGED_ZERO_INCREMENTAL_COST")).toBe(false)
    const risk = riskOf("acme", "PURGING", "PURGED_ZERO_INCREMENTAL_COST", POOLED)
    expect(risk.reversibility).toMatch(/IRREVERSIBLE/)
  })

  test("a suspension is reversible, because a serving state is reachable again", () => {
    expect(canReachServing("SUSPENDED_LOGICAL")).toBe(true)
    expect(riskOf("acme", "ACTIVE", "SUSPENDED_LOGICAL", POOLED).reversibility).toMatch(/^Reversible/)
  })

  test("the target names the tenant and where it is now", () => {
    // "Are you sure?" with no subject is how the wrong tenant gets moved.
    expect(riskOf("acme", "ACTIVE", "SUSPENDING", POOLED).target).toBe("acme — currently ACTIVE")
  })

  test("policy and approval agree with the engine", () => {
    for (const [from, to] of [
      ["ACTIVE", "SUSPENDING"],
      ["SUSPENDED_LOGICAL", "OFFBOARDING"],
      ["DRAFT", "VALIDATING"],
    ] as const) {
      const risk = riskOf("acme", from, to, POOLED)
      const demandsApprover = /requires a recorded approver/.test(risk.policy)
      const namesSecondIdentity = /second operator identity/.test(risk.approval)
      // The two fields must not be able to disagree: a policy saying an approver
      // is required beside an approval field saying "none" is a dialog that
      // teaches people the fields are decorative.
      expect(demandsApprover).toBe(namesSecondIdentity)
    }
  })

  test("every risk it produces is complete", () => {
    // Exhaustive over the real graph rather than a sample: a state whose risk
    // came back missing a field would render a confirmation with a blank row.
    for (const state of [...ARCHIVED_STATES, ...PURGE_STATES, "ACTIVE", "DRAFT"] as const) {
      expect(missingRiskFields(riskOf("acme", "ACTIVE", state, POOLED))).toEqual([])
    }
  })
})

/* --------------------------------------------------------------- WRK-120-005 --
 * The residual note is checked against what the tenant actually holds, and the
 * console renders the difference. Asserted on what `riskOf` and
 * `residualFindings` EMIT — the projections the page renders — rather than on
 * `reconcileResidual` in isolation, which would stay green the day the page
 * stopped calling it.
 */
test.describe("the residual claim is reconciled, not just printed", () => {
  const DEDICATED = observedFor({
    isolation: "dedicated-account",
    hasDeployment: true,
    serving: false,
    evidenceRecords: 4,
  })

  test("names a hibernated tenant's compute as a bill the note does not cover", () => {
    // GE-103-012's failure, made visible: "zero runtime" and a dedicated task
    // that keeps running whether or not routing points at it.
    const risk = riskOf("acme", "ACTIVE", "HIBERNATED_ZERO_RUNTIME", DEDICATED)
    expect(risk.impact).toMatch(/not zero cost/)
    expect(risk.impact).toMatch(/Retained beyond that claim, and still billing:.*compute/)

    const findings = residualFindings("HIBERNATED_ZERO_RUNTIME", DEDICATED)!
    expect(findings.unexplained).toContain("compute")
  })

  test("does not invent a finding when the note is right", () => {
    // Without this, the assertion above would pass against a projection that
    // reported everything as unexplained.
    const risk = riskOf("acme", "ACTIVE", "SUSPENDED_LOGICAL", DEDICATED)
    expect(risk.impact).toMatch(/Full infrastructure is retained/)
    expect(risk.impact).not.toMatch(/Retained beyond that claim/)
  })

  test("tells an operator when the note charges them for something they do not have", () => {
    // A pooled tenant has no dedicated edge. A panel claiming one is how the
    // real finding stops being believed.
    const risk = riskOf("acme", "ACTIVE", "HIBERNATED_ZERO_RUNTIME", POOLED)
    expect(risk.impact).toMatch(/Claimed by that note and not held here:.*edge/)
  })

  test("has nothing to reconcile for a state that claims nothing", () => {
    // Not an empty reconciliation: "we compared and found nothing" and "there
    // was nothing to compare" are different statements.
    expect(residualFindings("ACTIVE", DEDICATED)).toBeNull()
    expect(riskOf("acme", "IDLE", "ACTIVE", DEDICATED).impact).not.toMatch(/Retained beyond/)
  })

  test("says a successor owner is required exactly where the engine refuses without one", () => {
    for (const to of ["SUSPENDING", "HIBERNATING", "OFFBOARDING"] as const) {
      expect(riskOf("acme", "ACTIVE", to, POOLED).approval).toMatch(/successor owner must be named/)
    }
    // And not everywhere. A control demanded on every move is a field people
    // fill with the same word every time.
    expect(riskOf("acme", "ACTIVE", "IDLE", POOLED).approval).not.toMatch(/successor owner/)
  })
})
