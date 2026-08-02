import { test, expect } from "@playwright/test"

import {
  HIGH_RISK_FIELDS,
  STATE_KINDS,
  STATE_META,
  missingRiskFields,
} from "../src/components/states"
import { ARCHIVED_STATES, PURGE_STATES, canReachServing, riskOf } from "../src/lib/tenant-state"

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
    const risk = riskOf("acme", "PURGING", "PURGED_ZERO_INCREMENTAL_COST")
    expect(risk.reversibility).toMatch(/IRREVERSIBLE/)
  })

  test("a suspension is reversible, because a serving state is reachable again", () => {
    expect(canReachServing("SUSPENDED_LOGICAL")).toBe(true)
    expect(riskOf("acme", "ACTIVE", "SUSPENDED_LOGICAL").reversibility).toMatch(/^Reversible/)
  })

  test("the target names the tenant and where it is now", () => {
    // "Are you sure?" with no subject is how the wrong tenant gets moved.
    expect(riskOf("acme", "ACTIVE", "SUSPENDING").target).toBe("acme — currently ACTIVE")
  })

  test("policy and approval agree with the engine", () => {
    for (const [from, to] of [
      ["ACTIVE", "SUSPENDING"],
      ["SUSPENDED_LOGICAL", "OFFBOARDING"],
      ["DRAFT", "VALIDATING"],
    ] as const) {
      const risk = riskOf("acme", from, to)
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
      expect(missingRiskFields(riskOf("acme", "ACTIVE", state))).toEqual([])
    }
  })
})
