import { test, expect } from "@playwright/test"

import {
  HIGH_RISK_FIELDS,
  STATE_KINDS,
  STATE_META,
  missingRiskFields,
} from "../src/components/states"
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

  test("the eleven states the item names are exactly these", () => {
    expect([...STATE_KINDS].sort()).toEqual([
      "archived",
      "conflict",
      "empty",
      "error",
      "highRisk",
      "loading",
      "offline",
      "partialData",
      "pendingDeletion",
      "permissionDenied",
      "stale",
    ])
  })
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
