import { evaluate, grantsAccess, inRollout, type Fact } from "./evaluate"
import { compilePolicyOrThrow, type AttributeCatalog, type EligibilityPolicy } from "./policy"

/**
 * IER-070-003 / IER-070-004 / IER-070-012 — what the engine does with all/any/
 * not, effective dates, an explicit deny, an exception, a staged rollout, an
 * expiry, and with a fact that is missing, stale, conflicting or unreachable.
 */

const CATALOG: AttributeCatalog = {
  "affiliation.status": {
    id: "affiliation.status",
    type: "enum",
    members: ["ACTIVE", "PENDING", "SUSPENDED", "REVOKED", "ENDED"],
    acceptedSourceRoles: ["SYSTEM_OF_RECORD", "AUTHORITATIVE", "SELF_ATTESTED"],
    maxAgeMs: 3_600_000,
  },
  "affiliation.interval": {
    id: "affiliation.interval",
    type: "interval",
    acceptedSourceRoles: ["SYSTEM_OF_RECORD"],
    maxAgeMs: 3_600_000,
  },
  "training.completed": {
    id: "training.completed",
    type: "boolean",
    acceptedSourceRoles: ["SYSTEM_OF_RECORD"],
    maxAgeMs: 3_600_000,
  },
}

const NOW = new Date("2026-06-01T12:00:00.000Z")
const FRESH = "2026-06-01T11:59:00.000Z"

function policy(overrides: Partial<EligibilityPolicy> = {}): EligibilityPolicy {
  return {
    policyId: "test.entry.v1",
    version: "1",
    owner: "platform-identity",
    purpose: "test",
    target: "tenant.workspace",
    requiresTenantCapability: "core.workspace",
    subject: "active_affiliation",
    risk: "LOW",
    activeFrom: "2026-01-01T00:00:00.000Z",
    expiresAt: null,
    rollout: { percent: 100, cohortSalt: "salt" },
    attributes: [
      { attribute: "affiliation.status", acceptedSourceRoles: ["SYSTEM_OF_RECORD"], maxAgeMs: 600_000 },
      { attribute: "affiliation.interval", acceptedSourceRoles: ["SYSTEM_OF_RECORD"], maxAgeMs: 600_000 },
      { attribute: "training.completed", acceptedSourceRoles: ["SYSTEM_OF_RECORD"], maxAgeMs: 600_000 },
    ],
    requiredSources: ["hris"],
    deny: [],
    conditions: { all: [{ attribute: "affiliation.status", op: "in", values: ["ACTIVE"] }] },
    conditionallyEligible: [],
    onMissing: "INDETERMINATE",
    onStale: "INDETERMINATE",
    onConflict: "MANUAL_REVIEW_REQUIRED",
    onSourceUnavailable: "INDETERMINATE",
    exceptions: [],
    reviewEveryDays: 180,
    approvedBy: "platform-identity",
    rollbackTo: null,
    ...overrides,
  }
}

function statusFact(value: string, overrides: Partial<Fact> = {}): Fact {
  return {
    attribute: "affiliation.status",
    presence: "PRESENT",
    value,
    sourceId: "hris",
    sourceRole: "SYSTEM_OF_RECORD",
    observedAt: FRESH,
    ...overrides,
  }
}

function run(
  candidate: EligibilityPolicy,
  facts: readonly Fact[],
  options: { now?: Date; capabilities?: readonly string[]; unavailable?: readonly string[]; subjectId?: string } = {},
) {
  return evaluate(compilePolicyOrThrow(candidate, CATALOG), {
    subjectId: options.subjectId ?? "person-1",
    facts,
    now: options.now ?? NOW,
    tenantCapabilities: options.capabilities ?? ["core.workspace"],
    unavailableSources: options.unavailable,
  })
}

describe("IER-070-003 — all / any / not", () => {
  it("all requires every branch", () => {
    const candidate = policy({
      conditions: {
        all: [
          { attribute: "affiliation.status", op: "in", values: ["ACTIVE"] },
          { attribute: "training.completed", op: "equals", value: true },
        ],
      },
    })
    const training = (done: boolean): Fact => ({
      attribute: "training.completed",
      presence: "PRESENT",
      value: done,
      sourceId: "lms",
      sourceRole: "SYSTEM_OF_RECORD",
      observedAt: FRESH,
    })
    expect(run(candidate, [statusFact("ACTIVE"), training(true)]).outcome).toBe("ELIGIBLE")
    expect(run(candidate, [statusFact("ACTIVE"), training(false)]).outcome).toBe("INELIGIBLE")
  })

  it("any is satisfied by one branch, and `not` inverts", () => {
    const anyOf = policy({
      conditions: {
        any: [
          { attribute: "affiliation.status", op: "in", values: ["ACTIVE"] },
          { attribute: "affiliation.status", op: "in", values: ["PENDING"] },
        ],
      },
    })
    expect(run(anyOf, [statusFact("PENDING")]).outcome).toBe("ELIGIBLE")
    expect(run(anyOf, [statusFact("ENDED")]).outcome).toBe("INELIGIBLE")

    const negated = policy({
      conditions: { not: { attribute: "affiliation.status", op: "in", values: ["ENDED"] } },
    })
    expect(run(negated, [statusFact("ACTIVE")]).outcome).toBe("ELIGIBLE")
    expect(run(negated, [statusFact("ENDED")]).outcome).toBe("INELIGIBLE")
  })
})

describe("IER-070-003 — effective dates, explicit deny, exceptions, staged rollout, expiry", () => {
  it("an explicit deny overrides conditions that would otherwise allow", () => {
    const candidate = policy({
      deny: [
        {
          when: { attribute: "affiliation.status", op: "equals", value: "ACTIVE" },
          code: "ON_INVESTIGATION",
          outcome: "SUSPENDED",
        },
      ],
    })
    const decision = run(candidate, [statusFact("ACTIVE")])
    expect(decision.outcome).toBe("SUSPENDED")
    expect(decision.reasonCodes).toEqual(["ON_INVESTIGATION"])
    expect(grantsAccess(decision)).toBe(false)
  })

  it("an effective interval that has not opened is PENDING_EFFECTIVE_DATE, and one that closed is EXPIRED", () => {
    const candidate = policy({
      conditions: {
        all: [
          { attribute: "affiliation.status", op: "in", values: ["ACTIVE"] },
          { attribute: "affiliation.interval", op: "evaluationTimeWithin" },
        ],
      },
    })
    const interval = (from: string, until: string | null): Fact => ({
      attribute: "affiliation.interval",
      presence: "PRESENT",
      value: { from, until },
      sourceId: "hris",
      sourceRole: "SYSTEM_OF_RECORD",
      observedAt: FRESH,
    })
    expect(run(candidate, [statusFact("ACTIVE"), interval("2026-09-01T00:00:00.000Z", null)]).outcome).toBe(
      "PENDING_EFFECTIVE_DATE",
    )
    expect(
      run(candidate, [statusFact("ACTIVE"), interval("2025-09-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z")])
        .outcome,
    ).toBe("EXPIRED")
    expect(run(candidate, [statusFact("ACTIVE"), interval("2025-09-01T00:00:00.000Z", null)]).outcome).toBe(
      "ELIGIBLE",
    )
  })

  it("a live exception admits its subject and an expired one does not", () => {
    const exception = {
      subjectId: "person-2",
      approvedBy: "dean",
      reason: "late transfer",
      expiresAt: "2026-07-01T00:00:00.000Z",
    }
    const candidate = policy({ exceptions: [exception] })
    expect(run(candidate, [statusFact("ENDED")], { subjectId: "person-2" }).outcome).toBe("ELIGIBLE")
    expect(run(candidate, [statusFact("ENDED")], { subjectId: "person-1" }).outcome).toBe("INELIGIBLE")
    expect(
      run(policy({ exceptions: [{ ...exception, expiresAt: "2026-05-01T00:00:00.000Z" }] }), [
        statusFact("ENDED"),
      ], { subjectId: "person-2" }).outcome,
    ).toBe("INELIGIBLE")
  })

  it("an exception cannot walk past an explicit deny", () => {
    const candidate = policy({
      deny: [
        {
          when: { attribute: "affiliation.status", op: "equals", value: "REVOKED" },
          code: "REVOKED",
          outcome: "INELIGIBLE",
        },
      ],
      exceptions: [
        { subjectId: "person-2", approvedBy: "dean", reason: "x", expiresAt: "2026-07-01T00:00:00.000Z" },
      ],
    })
    expect(run(candidate, [statusFact("REVOKED")], { subjectId: "person-2" }).outcome).toBe("INELIGIBLE")
  })

  it("staged rollout is a stable cohort, not a sample", () => {
    const rollout = { percent: 50, cohortSalt: "wave-1" }
    const first = inRollout("person-1", "p", rollout)
    for (let i = 0; i < 50; i += 1) expect(inRollout("person-1", "p", rollout)).toBe(first)
    // A cohort that is neither everybody nor nobody, over a deterministic
    // population — the property that matters, and one no font metric can move.
    const subjects = Array.from({ length: 400 }, (_, i) => `person-${i}`)
    const admitted = subjects.filter((subject) => inRollout(subject, "p", rollout)).length
    expect(admitted).toBeGreaterThan(0)
    expect(admitted).toBeLessThan(subjects.length)
    // 0 and 100 are absolute, not sampled.
    expect(subjects.every((s) => inRollout(s, "p", { percent: 100, cohortSalt: "w" }))).toBe(true)
    expect(subjects.some((s) => inRollout(s, "p", { percent: 0, cohortSalt: "w" }))).toBe(false)
  })

  it("a subject outside the rollout is INDETERMINATE, never eligible", () => {
    const decision = run(policy({ rollout: { percent: 0, cohortSalt: "w" } }), [statusFact("ACTIVE")])
    expect(decision.outcome).toBe("INDETERMINATE")
    expect(decision.reasonCodes).toEqual(["OUTSIDE_STAGED_ROLLOUT"])
  })

  it("a policy before its activation or past its expiry decides nothing", () => {
    expect(run(policy(), [statusFact("ACTIVE")], { now: new Date("2025-12-31T00:00:00.000Z") }).reasonCodes)
      .toEqual(["POLICY_NOT_YET_ACTIVE"])
    expect(
      run(policy({ expiresAt: "2026-03-01T00:00:00.000Z" }), [statusFact("ACTIVE")]).reasonCodes,
    ).toEqual(["POLICY_EXPIRED"])
  })

  it("an unmet conditional requirement is CONDITIONALLY_ELIGIBLE with remediation, not a denial", () => {
    const candidate = policy({
      conditionallyEligible: [
        { when: { attribute: "training.completed", op: "equals", value: true }, code: "TRAINING_OUTSTANDING" },
      ],
    })
    const decision = run(candidate, [statusFact("ACTIVE")])
    expect(decision.outcome).toBe("CONDITIONALLY_ELIGIBLE")
    expect(decision.remediation).toEqual(["TRAINING_OUTSTANDING"])
    expect(grantsAccess(decision)).toBe(false)
  })
})

describe("IER-070-004 — missing, stale, conflicting and unreachable are four different answers", () => {
  it("a fact nobody asserted applies onMissing", () => {
    const decision = run(policy(), [])
    expect(decision.outcome).toBe("INDETERMINATE")
    expect(decision.reasonCodes).toEqual(["MISSING:affiliation.status"])
  })

  it("a withheld fact is missing, not false", () => {
    const decision = run(policy(), [statusFact("ACTIVE", { presence: "WITHHELD", value: null })])
    expect(decision.reasonCodes).toEqual(["MISSING:affiliation.status"])
  })

  it("a fact older than the policy's freshness applies onStale, and says stale rather than missing", () => {
    const decision = run(policy({ onStale: "INELIGIBLE" }), [
      statusFact("ACTIVE", { observedAt: "2026-06-01T11:00:00.000Z" }),
    ])
    expect(decision.outcome).toBe("INELIGIBLE")
    expect(decision.reasonCodes).toEqual(["STALE:affiliation.status"])
    expect(decision.receipt.sourceRevisions[0].stale).toBe(true)
  })

  it("two accepted sources disagreeing applies onConflict — never last write wins", () => {
    const decision = run(policy(), [
      statusFact("ACTIVE", { sourceId: "hris" }),
      statusFact("ENDED", { sourceId: "sis", observedAt: "2026-06-01T11:59:30.000Z" }),
    ])
    expect(decision.outcome).toBe("MANUAL_REVIEW_REQUIRED")
    expect(decision.reasonCodes).toEqual(["CONFLICT:affiliation.status"])
  })

  it("a fact from a source role the policy does not accept is not read at all", () => {
    const decision = run(policy(), [statusFact("ACTIVE", { sourceRole: "SELF_ATTESTED" })])
    expect(decision.reasonCodes).toEqual(["MISSING:affiliation.status"])
  })

  it("an unreachable required source applies onSourceUnavailable and names the source", () => {
    const decision = run(policy({ onSourceUnavailable: "MANUAL_REVIEW_REQUIRED" }), [statusFact("ACTIVE")], {
      unavailable: ["hris"],
    })
    expect(decision.outcome).toBe("MANUAL_REVIEW_REQUIRED")
    expect(decision.reasonCodes).toEqual(["SOURCE_UNAVAILABLE:hris"])
  })

  it("an unreachable source this policy does not require changes nothing", () => {
    expect(run(policy(), [statusFact("ACTIVE")], { unavailable: ["lms"] }).outcome).toBe("ELIGIBLE")
  })

  it("TREAT_AS_ABSENT is the only behaviour that can still end in ELIGIBLE", () => {
    const candidate = policy({
      onMissing: "TREAT_AS_ABSENT",
      conditions: {
        any: [
          { attribute: "affiliation.status", op: "in", values: ["ACTIVE"] },
          { attribute: "training.completed", op: "equals", value: true },
        ],
      },
    })
    expect(run(candidate, [statusFact("ACTIVE")]).outcome).toBe("ELIGIBLE")
  })
})

describe("IER-070-012 — fails closed", () => {
  it("a missing tenant capability is INELIGIBLE however eligible the person is", () => {
    const decision = run(policy(), [statusFact("ACTIVE")], { capabilities: [] })
    expect(decision.outcome).toBe("INELIGIBLE")
    expect(decision.reasonCodes).toEqual(["TENANT_CAPABILITY_NOT_ENTITLED"])
  })

  it("an indeterminate decision on a HIGH-risk policy escalates instead of resting", () => {
    expect(run(policy({ risk: "HIGH" }), []).outcome).toBe("MANUAL_REVIEW_REQUIRED")
    expect(run(policy({ risk: "LOW" }), []).outcome).toBe("INDETERMINATE")
  })

  it("an engine error is a closed door with a name, not a thrown exception", () => {
    const compiled = compilePolicyOrThrow(policy(), CATALOG)
    const decision = evaluate(compiled, {
      subjectId: "person-1",
      // A fact list that throws the moment it is walked — the shape an engine
      // defect takes from the caller's side.
      get facts(): never {
        throw new Error("engine defect")
      },
      now: NOW,
      tenantCapabilities: ["core.workspace"],
    })
    expect(decision.outcome).toBe("INDETERMINATE")
    expect(decision.reasonCodes).toEqual(["ENGINE_ERROR"])
    expect(grantsAccess(decision)).toBe(false)
  })

  it("an invalid evaluation clock decides nothing rather than defaulting to now", () => {
    const decision = run(policy(), [statusFact("ACTIVE")], { now: new Date("not a date") })
    expect(decision.outcome).toBe("INDETERMINATE")
    expect(decision.reasonCodes).toEqual(["ENGINE_ERROR"])
  })

  it("grantsAccess is true for ELIGIBLE alone", () => {
    expect(grantsAccess(run(policy(), [statusFact("ACTIVE")]))).toBe(true)
    expect(grantsAccess(run(policy(), [statusFact("ENDED")]))).toBe(false)
  })
})

describe("IER-070-005 — the same arguments produce the same decision", () => {
  it("is a pure function of its arguments", () => {
    const compiled = compilePolicyOrThrow(policy(), CATALOG)
    const request = {
      subjectId: "person-1",
      facts: [statusFact("ACTIVE")],
      now: NOW,
      tenantCapabilities: ["core.workspace"],
    }
    const first = evaluate(compiled, request)
    const second = evaluate(compiled, request)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    expect(first.receipt.evaluatedAt).toBe(NOW.toISOString())
    expect(first.receipt.policyDigest).toBe(compiled.digest)
  })

  it("the receipt carries source revisions and no attribute values", () => {
    const receipt = run(policy(), [statusFact("ACTIVE")]).receipt
    expect(receipt.sourceRevisions).toEqual([
      {
        attribute: "affiliation.status",
        sourceId: "hris",
        sourceRole: "SYSTEM_OF_RECORD",
        observedAt: FRESH,
        stale: false,
      },
    ])
    expect(JSON.stringify(receipt)).not.toContain("ACTIVE")
  })
})
