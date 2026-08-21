import { evaluate, ELIGIBILITY_OUTCOMES, type Decision, type Fact } from "./evaluate"
import {
  EXPLANATION_AUDIENCES,
  SUBJECT_DISPOSITIONS,
  explainDecision,
  maskCode,
  type AdminExplanation,
  type AuditorExplanation,
  type EndUserExplanation,
  type OperatorExplanation,
  type RefusedExplanation,
} from "./explain"
import { compilePolicyOrThrow, type AttributeCatalog, type EligibilityPolicy } from "./policy"
import { PolicyArchive } from "./policy-archive"

/**
 * IER-070-010 — "Implement safe end-user, admin, auditor, and operator
 * explanation layers."
 *
 * Bible §12.3. The tests are organised by the four sentences that section
 * writes, one describe block each, plus the rule that binds them: nothing but
 * the auditor layer may carry a raw value or a raw subject id.
 */

const CATALOG: AttributeCatalog = {
  "affiliation.status": {
    id: "affiliation.status",
    type: "enum",
    members: ["ACTIVE", "SUSPENDED", "ENDED"],
    acceptedSourceRoles: ["SYSTEM_OF_RECORD"],
    maxAgeMs: 3_600_000,
    derivation: "SOURCE_ASSERTED",
  },
  "person.legal_name": {
    id: "person.legal_name",
    type: "string",
    acceptedSourceRoles: ["SYSTEM_OF_RECORD"],
    maxAgeMs: 3_600_000,
    derivation: "SOURCE_ASSERTED",
  },
  "training.completed": {
    id: "training.completed",
    type: "boolean",
    acceptedSourceRoles: ["SYSTEM_OF_RECORD"],
    maxAgeMs: 3_600_000,
    derivation: "SOURCE_ASSERTED",
  },
}

const NOW = new Date("2026-06-01T12:00:00.000Z")
const FRESH = "2026-06-01T11:59:00.000Z"
const LEGAL_NAME = "Adaeze Okonkwo-Brightwater"
const SUBJECT_ID = "usr_9f3c2b7a41de"

function basePolicy(overrides: Partial<EligibilityPolicy> = {}): EligibilityPolicy {
  return {
    policyId: "test.explain.v1",
    version: "1",
    owner: "platform-identity",
    purpose: "test",
    target: "tenant.workspace",
    requiresTenantCapability: "core.workspace",
    subject: "person",
    risk: "LOW",
    activeFrom: "2026-01-01T00:00:00.000Z",
    expiresAt: null,
    rollout: { percent: 100, cohortSalt: "salt" },
    attributes: [
      { attribute: "affiliation.status", acceptedSourceRoles: ["SYSTEM_OF_RECORD"], maxAgeMs: 600_000 },
      { attribute: "person.legal_name", acceptedSourceRoles: ["SYSTEM_OF_RECORD"], maxAgeMs: 600_000 },
      { attribute: "training.completed", acceptedSourceRoles: ["SYSTEM_OF_RECORD"], maxAgeMs: 600_000 },
    ],
    requiredSources: ["hris"],
    deny: [
      {
        when: { attribute: "affiliation.status", op: "equals", value: "SUSPENDED" },
        code: "AFFILIATION_SUSPENDED",
        outcome: "SUSPENDED",
      },
    ],
    conditions: {
      all: [
        { attribute: "affiliation.status", op: "in", values: ["ACTIVE"] },
        { attribute: "person.legal_name", op: "equals", value: LEGAL_NAME },
      ],
    },
    conditionallyEligible: [
      { when: { attribute: "training.completed", op: "equals", value: true }, code: "TRAINING_INCOMPLETE" },
    ],
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

const COMPILED = compilePolicyOrThrow(basePolicy(), CATALOG)

function fact(attribute: string, value: Fact["value"], overrides: Partial<Fact> = {}): Fact {
  return {
    attribute,
    presence: "PRESENT",
    value,
    sourceId: attribute === "affiliation.status" ? "tenure.membership" : "tenure.user",
    sourceRole: "SYSTEM_OF_RECORD",
    observedAt: FRESH,
    ...overrides,
  }
}

const NAME_FACT = fact("person.legal_name", LEGAL_NAME)

function decide(facts: readonly Fact[], options: { unavailableSources?: readonly string[] } = {}): Decision {
  return evaluate(COMPILED, {
    subjectId: SUBJECT_ID,
    facts,
    now: NOW,
    tenantCapabilities: ["core.workspace"],
    unavailableSources: options.unavailableSources,
  })
}

const ELIGIBLE = decide([
  fact("affiliation.status", "ACTIVE"),
  NAME_FACT,
  fact("training.completed", true),
])
const CONDITIONAL = decide([
  fact("affiliation.status", "ACTIVE"),
  NAME_FACT,
  fact("training.completed", false),
])
const SUSPENDED = decide([fact("affiliation.status", "SUSPENDED"), NAME_FACT])
const INDETERMINATE = decide([NAME_FACT])
const SOURCE_DOWN = decide([fact("affiliation.status", "ACTIVE"), NAME_FACT], {
  unavailableSources: ["hris"],
})

describe("IER-070-010 — end user: a generic safe outcome and an actionable next step", () => {
  it("every one of the eight outcomes has a disposition and a sentence", () => {
    // Not a tautology: it walks the real outcome list, so an outcome added to
    // the engine without a decision about what the subject is told fails here.
    for (const outcome of ELIGIBILITY_OUTCOMES) {
      const forged: Decision = { ...ELIGIBLE, outcome }
      const explanation = explainDecision(forged, "END_USER") as EndUserExplanation
      expect(SUBJECT_DISPOSITIONS).toContain(explanation.disposition)
      // Not a length: a length is content that a copy edit moves. The claim is
      // that the sentence exists and is the SAME sentence for the same
      // disposition, which is what makes it a fixed table rather than a template.
      expect(explanation.nextStep).not.toBe("")
      expect(explanation.nextStep).toBe(
        (explainDecision({ ...ELIGIBLE, outcome }, "END_USER") as EndUserExplanation).nextStep,
      )
    }
  })

  it("says nothing about the policy — no id, no version, no digest", () => {
    const explanation = explainDecision(SUSPENDED, "END_USER")
    expect(explanation).not.toHaveProperty("policyId")
    expect(explanation).not.toHaveProperty("policyDigest")
    expect(explanation).not.toHaveProperty("policyVersion")
    expect(JSON.stringify(explanation)).not.toContain(COMPILED.digest)
    expect(JSON.stringify(explanation)).not.toContain("test.explain.v1")
  })

  it("does not report a denial as a decision when nothing was decided", () => {
    expect((explainDecision(SUSPENDED, "END_USER") as EndUserExplanation).disposition).toBe("ACTION_NEEDED")
    expect(INDETERMINATE.outcome).toBe("INDETERMINATE")
    expect((explainDecision(INDETERMINATE, "END_USER") as EndUserExplanation).disposition).toBe("UNDER_REVIEW")
  })

  it("gives the actionable code when the subject can act, and only that", () => {
    expect(CONDITIONAL.outcome).toBe("CONDITIONALLY_ELIGIBLE")
    const explanation = explainDecision(CONDITIONAL, "END_USER") as EndUserExplanation
    expect(explanation.disposition).toBe("ACTION_NEEDED")
    expect(explanation.actionCodes).toEqual(["TRAINING_INCOMPLETE"])
    expect(explanation.withheldCodeCount).toBe(0)
  })

  it("withholds an engine-internal code that names an attribute, and counts it", () => {
    const forged: Decision = { ...CONDITIONAL, remediation: ["TRAINING_INCOMPLETE", "STALE:person.legal_name"] }
    const explanation = explainDecision(forged, "END_USER") as EndUserExplanation
    expect(explanation.actionCodes).toEqual(["TRAINING_INCOMPLETE"])
    expect(explanation.withheldCodeCount).toBe(1)
    expect(JSON.stringify(explanation)).not.toContain("person.legal_name")
  })

  it("the allowed case says so and asks for nothing", () => {
    const explanation = explainDecision(ELIGIBLE, "END_USER") as EndUserExplanation
    expect(explanation.disposition).toBe("ALLOWED")
    expect(explanation.actionCodes).toEqual([])
  })
})

describe("IER-070-010 — tenant access admin: masked codes, freshness, remediation, timeline", () => {
  it("carries the four things §12.3 names", () => {
    const explanation = explainDecision(CONDITIONAL, "TENANT_ACCESS_ADMIN") as AdminExplanation
    expect(explanation.maskedReasonCodes).toEqual(["TRAINING_INCOMPLETE"])
    expect(explanation.remediation).toEqual(["TRAINING_INCOMPLETE"])
    expect(explanation.sourceFreshness.map((entry) => entry.sourceId)).toEqual([
      "tenure.membership",
      "tenure.user",
      "tenure.user",
    ])
    expect(explanation.timeline.map((entry) => entry.event)).toEqual([
      "SOURCE_ASSERTED:tenure.membership",
      "SOURCE_ASSERTED:tenure.user",
      "SOURCE_ASSERTED:tenure.user",
      "DECIDED:CONDITIONALLY_ELIGIBLE",
    ])
  })

  it("freshness is arithmetic on the two instants, not a measurement of this machine", () => {
    const explanation = explainDecision(CONDITIONAL, "TENANT_ACCESS_ADMIN") as AdminExplanation
    // 11:59:00 asserted, 12:00:00 decided.
    expect(explanation.sourceFreshness[0].ageMs).toBe(60_000)
    expect(explanation.sourceFreshness[0].stale).toBe(false)
  })

  it("keeps which fact was missing — an admin who cannot see that cannot do the job", () => {
    const explanation = explainDecision(INDETERMINATE, "TENANT_ACCESS_ADMIN") as AdminExplanation
    expect(explanation.maskedReasonCodes).toEqual([
      "DENY_UNDECIDABLE:AFFILIATION_SUSPENDED",
      "MISSING:affiliation.status",
    ])
  })

  it("masks a third segment, which is where a policy author's free text could carry a value", () => {
    expect(maskCode("MISSING:affiliation.status")).toBe("MISSING:affiliation.status")
    expect(maskCode("AFFILIATION_SUSPENDED")).toBe("AFFILIATION_SUSPENDED")
    expect(maskCode(`DENY:name:${LEGAL_NAME}`)).toBe("DENY:name:…")
  })

  it("identifies the subject by reference, not by id", () => {
    const explanation = explainDecision(SUSPENDED, "TENANT_ACCESS_ADMIN") as AdminExplanation
    expect(explanation.subjectRef).toMatch(/^prs_[0-9a-f]{24}$/)
    expect(JSON.stringify(explanation)).not.toContain(SUBJECT_ID)
  })
})

describe("IER-070-010 — auditor: a complete trace, under a stated purpose", () => {
  const ARCHIVE = new PolicyArchive()
  ARCHIVE.register(COMPILED, "2026-01-01T00:00:00.000Z")

  it("refuses without a purpose, in band rather than by throwing", () => {
    const refused = explainDecision(SUSPENDED, "AUDITOR") as RefusedExplanation
    expect(refused.refused).toBe(true)
    expect(refused.refusal).toBe("PURPOSE_REQUIRED")
    expect(explainDecision(SUSPENDED, "AUDITOR", { purpose: "   " })).toEqual(refused)
  })

  it("returns the whole receipt and the policy version that made the decision", () => {
    const explanation = explainDecision(SUSPENDED, "AUDITOR", {
      purpose: "SAR-2026-114 access appeal",
      archive: ARCHIVE,
    }) as AuditorExplanation
    expect(explanation.refused).toBe(false)
    expect(explanation.receipt.subjectId).toBe(SUBJECT_ID)
    expect(explanation.receipt.reasonCodes).toEqual(["AFFILIATION_SUSPENDED"])
    expect(explanation.policyVersion?.digest).toBe(COMPILED.digest)
    expect(explanation.policyVersion?.policy.conditions).toEqual(COMPILED.policy.conditions)
    expect(explanation.notes).toEqual([])
  })

  it("declines to describe a decision whose version was never archived, rather than using today's", () => {
    // IER-070-009's failure mode, seen from the explanation side: an empty
    // archive must produce "not archived", never the current policy.
    const explanation = explainDecision(SUSPENDED, "AUDITOR", {
      purpose: "SAR-2026-114 access appeal",
      archive: new PolicyArchive(),
    }) as AuditorExplanation
    expect(explanation.policyVersion).toBeNull()
    expect(explanation.notes).toEqual(["POLICY_VERSION_NOT_ARCHIVED"])
  })

  it("explains a decision made under a version that has since been superseded", () => {
    const archive = new PolicyArchive()
    archive.register(COMPILED, "2026-01-01T00:00:00.000Z")
    const successor = compilePolicyOrThrow(
      basePolicy({ version: "2", activeFrom: "2026-07-01T00:00:00.000Z", deny: [] }),
      CATALOG,
    )
    archive.register(successor, "2026-07-01T00:00:00.000Z")

    const explanation = explainDecision(SUSPENDED, "AUDITOR", {
      purpose: "SAR-2026-114 access appeal",
      archive,
    }) as AuditorExplanation

    expect(explanation.policyVersion?.version).toBe("1")
    expect(explanation.policyVersion?.policy.deny).toHaveLength(1)
    expect(successor.policy.deny).toHaveLength(0)
  })
})

describe("IER-070-010 — platform operator: system health, no tenant PII by default", () => {
  it("shows an operational code and no subject at all", () => {
    const explanation = explainDecision(SOURCE_DOWN, "PLATFORM_OPERATOR") as OperatorExplanation
    expect(explanation.operationalCodes).toEqual(["SOURCE_UNAVAILABLE:hris"])
    expect(explanation).not.toHaveProperty("subjectRef")
    expect(explanation).not.toHaveProperty("subjectId")
    expect(JSON.stringify(explanation)).not.toContain(SUBJECT_ID)
  })

  it("withholds a code that describes a person, and counts it rather than dropping it silently", () => {
    const explanation = explainDecision(SUSPENDED, "PLATFORM_OPERATOR") as OperatorExplanation
    expect(explanation.operationalCodes).toEqual([])
    expect(explanation.withheldCodeCount).toBe(1)
  })

  it("reports source staleness as health", () => {
    const stale = decide([
      fact("affiliation.status", "ACTIVE", { observedAt: "2026-05-01T00:00:00.000Z" }),
      NAME_FACT,
    ])
    const explanation = explainDecision(stale, "PLATFORM_OPERATOR") as OperatorExplanation
    expect(explanation.staleSourceCount).toBe(1)
    expect(explanation.operationalCodes).toEqual(["STALE:affiliation.status"])
  })
})

describe("IER-070-010 — the rule that binds the four layers", () => {
  const DECISIONS: readonly [string, Decision][] = [
    ["eligible", ELIGIBLE],
    ["conditional", CONDITIONAL],
    ["suspended", SUSPENDED],
    ["indeterminate", INDETERMINATE],
    ["source down", SOURCE_DOWN],
  ]

  it("no layer but the auditor's carries the subject id or a raw source value", () => {
    for (const [label, decision] of DECISIONS) {
      for (const audience of EXPLANATION_AUDIENCES) {
        if (audience === "AUDITOR") continue
        const text = JSON.stringify(
          explainDecision(decision, audience, { facts: [NAME_FACT], purpose: "audit" }),
        )
        expect(`${label}/${audience}: ${text.includes(SUBJECT_ID)}`).toBe(`${label}/${audience}: false`)
        expect(`${label}/${audience}: ${text.includes(LEGAL_NAME)}`).toBe(`${label}/${audience}: false`)
      }
    }
  })

  it("the auditor's layer does carry them — otherwise the test above proves nothing", () => {
    const text = JSON.stringify(
      explainDecision(SUSPENDED, "AUDITOR", { purpose: "audit" }) as AuditorExplanation,
    )
    expect(text).toContain(SUBJECT_ID)
  })

  it("each audience returns its own shape, tagged", () => {
    for (const audience of EXPLANATION_AUDIENCES) {
      const explanation = explainDecision(ELIGIBLE, audience, { purpose: "audit" })
      expect(explanation.audience).toBe(audience)
    }
  })
})
