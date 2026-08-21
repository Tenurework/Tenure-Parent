import {
  PROOF_OUTCOMES,
  checkProof,
  checkProofs,
  requirementAtTarget,
  type ProofAssertion,
  type ProofRequirement,
} from "./proofs"
import type { EligibilityTarget } from "./targets"

/**
 * IER-120-006 — "Enforce training/license/clearance proofs by narrow status,
 * source, freshness, and scope."
 *
 * Four gates, tested one at a time. A fixture that fails two of them at once
 * proves nothing about either: the check that is actually load-bearing is the
 * one that is the ONLY thing wrong.
 */

const NOW = new Date("2026-06-01T12:00:00.000Z")
const DAY = 24 * 60 * 60 * 1000

const REQUIREMENT: ProofRequirement = {
  kind: "TRAINING",
  proofId: "training.forklift",
  acceptedStatuses: ["VALID"],
  acceptedSourceRoles: ["AUTHORITATIVE", "SYSTEM_OF_RECORD"],
  maxAgeMs: 30 * DAY,
  scope: { site: "plant-a" },
}

function assertion(over: Partial<ProofAssertion> = {}): ProofAssertion {
  return {
    kind: "TRAINING",
    proofId: "training.forklift",
    status: "VALID",
    sourceId: "lms",
    sourceRole: "AUTHORITATIVE",
    observedAt: "2026-05-30T00:00:00.000Z",
    validFrom: "2025-01-01T00:00:00.000Z",
    validUntil: "2027-01-01T00:00:00.000Z",
    scope: { site: "plant-a" },
    ...over,
  }
}

describe("IER-120-006 — the satisfied case, so the refusals below are not a function that always says no", () => {
  it("accepts a current certificate, from an accepted source, freshly asserted, for this site", () => {
    const check = checkProof(REQUIREMENT, [assertion()], NOW)
    expect(check).toEqual({
      proofId: "training.forklift",
      outcome: "SATISFIED",
      satisfied: true,
      code: "SATISFIED:TRAINING:training.forklift",
    })
  })
})

describe("IER-120-006 — narrow STATUS: an allow-list, not 'anything but revoked'", () => {
  it.each(["PENDING", "SUSPENDED", "EXPIRED", "REVOKED", "NOT_HELD"] as const)(
    "refuses status %s, which a not-revoked test would have admitted",
    (status) => {
      const check = checkProof(REQUIREMENT, [assertion({ status })], NOW)
      expect(check.outcome).toBe("STATUS_NOT_ACCEPTED")
      expect(check.satisfied).toBe(false)
    },
  )

  it("keeps an asserted NOT_HELD distinguishable from nobody having asserted anything", () => {
    expect(checkProof(REQUIREMENT, [assertion({ status: "NOT_HELD" })], NOW).outcome).toBe(
      "STATUS_NOT_ACCEPTED",
    )
    expect(checkProof(REQUIREMENT, [], NOW).outcome).toBe("MISSING")
  })
})

describe("IER-120-006 — narrow SOURCE: who said it is part of the fact", () => {
  it("refuses a licence the person asserted about themselves", () => {
    const check = checkProof(REQUIREMENT, [assertion({ sourceRole: "SELF_ATTESTED" })], NOW)
    expect(check.outcome).toBe("UNTRUSTED_SOURCE")
  })

  it.each(["ADVISORY_ONLY", "UNTRUSTED", "DERIVED_DETERMINISTIC", "CORROBORATING"] as const)(
    "does not read a %s assertion at all",
    (sourceRole) => {
      expect(checkProof(REQUIREMENT, [assertion({ sourceRole })], NOW).outcome).toBe(
        "UNTRUSTED_SOURCE",
      )
    },
  )

  it("does not let an unaccepted source rescue an accepted one that is stale", () => {
    // The self-attested row is newer. If source filtering ran after the
    // freshness pick, this would come back SATISFIED.
    const check = checkProof(
      REQUIREMENT,
      [
        assertion({ observedAt: "2026-01-01T00:00:00.000Z" }),
        assertion({ sourceRole: "SELF_ATTESTED", observedAt: "2026-05-31T00:00:00.000Z" }),
      ],
      NOW,
    )
    expect(check.outcome).toBe("STALE_ASSERTION")
  })
})

describe("IER-120-006 — FRESHNESS is about the assertion, not the certificate", () => {
  it("refuses a certificate that runs to 2027 but was last confirmed in January", () => {
    const check = checkProof(
      REQUIREMENT,
      [assertion({ observedAt: "2026-01-01T00:00:00.000Z", validUntil: "2027-01-01T00:00:00.000Z" })],
      NOW,
    )
    expect(check.outcome).toBe("STALE_ASSERTION")
  })

  it("accepts an assertion exactly at the freshness limit and refuses one a millisecond past it", () => {
    const atLimit = new Date(NOW.getTime() - REQUIREMENT.maxAgeMs).toISOString()
    const pastLimit = new Date(NOW.getTime() - REQUIREMENT.maxAgeMs - 1).toISOString()
    expect(checkProof(REQUIREMENT, [assertion({ observedAt: atLimit })], NOW).satisfied).toBe(true)
    expect(checkProof(REQUIREMENT, [assertion({ observedAt: pastLimit })], NOW).outcome).toBe(
      "STALE_ASSERTION",
    )
  })

  it("treats an unreadable observation instant as stale", () => {
    expect(checkProof(REQUIREMENT, [assertion({ observedAt: "recently" })], NOW).outcome).toBe(
      "STALE_ASSERTION",
    )
  })

  it("separates the certificate's own window from the assertion's age", () => {
    expect(
      checkProof(REQUIREMENT, [assertion({ validUntil: "2026-05-01T00:00:00.000Z" })], NOW).outcome,
    ).toBe("LAPSED")
    expect(
      checkProof(REQUIREMENT, [assertion({ validFrom: "2026-07-01T00:00:00.000Z" })], NOW).outcome,
    ).toBe("NOT_YET_VALID")
  })

  it("accepts an open-ended certificate and refuses one whose end nobody can read", () => {
    expect(checkProof(REQUIREMENT, [assertion({ validUntil: null })], NOW).satisfied).toBe(true)
    expect(checkProof(REQUIREMENT, [assertion({ validUntil: "sometime" })], NOW).outcome).toBe("LAPSED")
  })
})

describe("IER-120-006 — SCOPE: a certificate for site A is not a certificate for site B", () => {
  it("refuses a certificate held for another site", () => {
    const check = checkProof(REQUIREMENT, [assertion({ scope: { site: "plant-b" } })], NOW)
    expect(check.outcome).toBe("OUT_OF_SCOPE")
  })

  it("refuses an unscoped certificate rather than reading it as valid everywhere", () => {
    expect(checkProof(REQUIREMENT, [assertion({ scope: undefined })], NOW).outcome).toBe(
      "OUT_OF_SCOPE",
    )
    expect(checkProof(REQUIREMENT, [assertion({ scope: {} })], NOW).outcome).toBe("OUT_OF_SCOPE")
  })

  it("accepts any scope only when the requirement is written tenant-wide on purpose", () => {
    const anywhere: ProofRequirement = { ...REQUIREMENT, scope: {} }
    expect(checkProof(anywhere, [assertion({ scope: { site: "plant-b" } })], NOW).satisfied).toBe(true)
    expect(checkProof(anywhere, [assertion({ scope: undefined })], NOW).satisfied).toBe(true)
  })

  it("requires every scope field the requirement names, not just one of them", () => {
    const both: ProofRequirement = { ...REQUIREMENT, scope: { site: "plant-a", jurisdiction: "us-ny" } }
    expect(checkProof(both, [assertion({ scope: { site: "plant-a" } })], NOW).outcome).toBe(
      "OUT_OF_SCOPE",
    )
    expect(
      checkProof(both, [assertion({ scope: { site: "plant-a", jurisdiction: "us-ny" } })], NOW)
        .satisfied,
    ).toBe(true)
  })
})

describe("IER-120-006 — a requirement is narrowed to the target it is applied at", () => {
  const target: EligibilityTarget = {
    kind: "workflow",
    id: "work-order.execute",
    capability: "operations",
    orgUnitId: "plant-b",
    jurisdiction: "us-ny",
  }

  it("takes the org unit and jurisdiction from the target rather than from the author's copy", () => {
    const narrowed = requirementAtTarget({ ...REQUIREMENT, scope: { orgUnitId: "plant-a" } }, target)
    expect(narrowed.scope).toEqual({ orgUnitId: "plant-b", jurisdiction: "us-ny" })
  })

  it("leaves a requirement alone when the target is unscoped", () => {
    const unscoped: EligibilityTarget = { kind: "module", id: "finance", capability: "budgeting" }
    expect(requirementAtTarget(REQUIREMENT, unscoped).scope).toEqual({ site: "plant-a" })
  })
})

describe("IER-120-006 — every requirement must hold, and a person is told all of what is missing", () => {
  const licence: ProofRequirement = {
    ...REQUIREMENT,
    kind: "LICENSE",
    proofId: "license.pe",
    scope: {},
  }

  it("refuses when any one requirement is unmet", () => {
    const result = checkProofs([REQUIREMENT, licence], [assertion()], NOW)
    expect(result.satisfied).toBe(false)
    expect(result.checks.filter((c) => !c.satisfied).map((c) => c.code)).toEqual([
      "MISSING:LICENSE:license.pe",
    ])
  })

  it("reports both failures at once rather than one per attempt", () => {
    const result = checkProofs([REQUIREMENT, licence], [], NOW)
    expect(result.checks.map((c) => c.code)).toEqual([
      "MISSING:TRAINING:training.forklift",
      "MISSING:LICENSE:license.pe",
    ])
  })

  it("is satisfied by an empty requirement list, which is a target that conditions on no proof", () => {
    expect(checkProofs([], [], NOW)).toEqual({ satisfied: true, checks: [] })
  })

  it("does not match a licence assertion against a training requirement of the same id", () => {
    const sameId: ProofRequirement = { ...REQUIREMENT, kind: "CLEARANCE" }
    expect(checkProof(sameId, [assertion()], NOW).outcome).toBe("MISSING")
  })

  it("every outcome in PROOF_OUTCOMES is reachable by one of the cases above", () => {
    const reached = new Set(
      [
        checkProof(REQUIREMENT, [assertion()], NOW),
        checkProof(REQUIREMENT, [], NOW),
        checkProof(REQUIREMENT, [assertion({ sourceRole: "SELF_ATTESTED" })], NOW),
        checkProof(REQUIREMENT, [assertion({ observedAt: "2026-01-01T00:00:00.000Z" })], NOW),
        checkProof(REQUIREMENT, [assertion({ status: "REVOKED" })], NOW),
        checkProof(REQUIREMENT, [assertion({ validFrom: "2026-07-01T00:00:00.000Z" })], NOW),
        checkProof(REQUIREMENT, [assertion({ validUntil: "2026-05-01T00:00:00.000Z" })], NOW),
        checkProof(REQUIREMENT, [assertion({ scope: { site: "plant-b" } })], NOW),
      ].map((c) => c.outcome),
    )
    expect([...PROOF_OUTCOMES].filter((o) => !reached.has(o))).toEqual([])
  })
})
