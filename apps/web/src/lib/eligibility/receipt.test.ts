import { evaluate, type Fact } from "./evaluate"
import { compilePolicyOrThrow, type AttributeCatalog, type EligibilityPolicy } from "./policy"
import { MIN_SCANNABLE_VALUE_LENGTH, findRawValues, sealReceipt, subjectPseudonym } from "./receipt"

/**
 * IER-070-011 — "Produce decision receipts with policy and source revisions but
 * no unnecessary raw PII."
 *
 * The fixtures use values that could not occur by accident — a full name, an
 * address, a national identifier — so that "this string is not in the receipt"
 * is a claim about leakage rather than about coincidence.
 */

const CATALOG: AttributeCatalog = {
  "affiliation.status": {
    id: "affiliation.status",
    type: "enum",
    members: ["ACTIVE", "ENDED"],
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
}

const NOW = new Date("2026-06-01T12:00:00.000Z")
const FRESH = "2026-06-01T11:59:00.000Z"
const LEGAL_NAME = "Adaeze Okonkwo-Brightwater"
const SUBJECT_ID = "usr_9f3c2b7a41de"

const POLICY: EligibilityPolicy = {
  policyId: "test.receipt.v1",
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
  ],
  requiredSources: [],
  deny: [],
  conditions: {
    all: [
      { attribute: "affiliation.status", op: "in", values: ["ACTIVE"] },
      { attribute: "person.legal_name", op: "equals", value: LEGAL_NAME },
    ],
  },
  conditionallyEligible: [],
  onMissing: "INDETERMINATE",
  onStale: "INDETERMINATE",
  onConflict: "MANUAL_REVIEW_REQUIRED",
  onSourceUnavailable: "INDETERMINATE",
  exceptions: [],
  reviewEveryDays: 180,
  approvedBy: "platform-identity",
  rollbackTo: null,
}

const COMPILED = compilePolicyOrThrow(POLICY, CATALOG)

const FACTS: Fact[] = [
  {
    attribute: "affiliation.status",
    presence: "PRESENT",
    value: "ACTIVE",
    sourceId: "tenure.membership",
    sourceRole: "SYSTEM_OF_RECORD",
    observedAt: FRESH,
  },
  {
    attribute: "person.legal_name",
    presence: "PRESENT",
    value: LEGAL_NAME,
    sourceId: "tenure.user",
    sourceRole: "SYSTEM_OF_RECORD",
    observedAt: FRESH,
  },
]

function decide(facts: readonly Fact[] = FACTS) {
  return evaluate(COMPILED, {
    subjectId: SUBJECT_ID,
    facts,
    now: NOW,
    tenantCapabilities: ["core.workspace"],
  })
}

describe("IER-070-011 — the receipt carries revisions, not records", () => {
  it("carries the policy revision: id, version and digest", () => {
    const receipt = decide().receipt
    expect(receipt.policyId).toBe("test.receipt.v1")
    expect(receipt.policyVersion).toBe("1")
    expect(receipt.policyDigest).toBe(COMPILED.digest)
    expect(receipt.policyDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it("carries a source revision for every attribute it read, with freshness", () => {
    const receipt = decide().receipt
    expect(receipt.sourceRevisions).toEqual([
      {
        attribute: "affiliation.status",
        sourceId: "tenure.membership",
        sourceRole: "SYSTEM_OF_RECORD",
        observedAt: FRESH,
        stale: false,
      },
      {
        attribute: "person.legal_name",
        sourceId: "tenure.user",
        sourceRole: "SYSTEM_OF_RECORD",
        observedAt: FRESH,
        stale: false,
      },
    ])
  })

  it("the raw value the decision turned on is nowhere in the receipt", () => {
    const decision = decide()
    expect(decision.outcome).toBe("ELIGIBLE")
    expect(findRawValues(decision.receipt, FACTS)).toEqual([])
  })

  it("the sealed receipt replaces the subject id with a pseudonym", () => {
    const sealed = sealReceipt(decide().receipt, FACTS)
    expect(sealed.subjectRef).toBe(subjectPseudonym(COMPILED.digest, SUBJECT_ID))
    expect(sealed.subjectRef).toMatch(/^prs_[0-9a-f]{24}$/)
    expect(JSON.stringify(sealed)).not.toContain(SUBJECT_ID)
  })

  it("the pseudonym is stable within a policy version and different across versions", () => {
    const under = subjectPseudonym("sha256:aaa", SUBJECT_ID)
    expect(subjectPseudonym("sha256:aaa", SUBJECT_ID)).toBe(under)
    expect(subjectPseudonym("sha256:bbb", SUBJECT_ID)).not.toBe(under)
    // Two people under one policy are two refs, or it would not be a reference.
    expect(subjectPseudonym("sha256:aaa", "usr_other0000")).not.toBe(under)
  })

  it("a raw value that DID reach a code is replaced and the path recorded", () => {
    // A policy author's own deny code carrying a value. Nothing in the engine
    // writes one, which is exactly why the seal must not assume nothing does.
    const receipt = decide().receipt
    const contaminated = {
      ...receipt,
      reasonCodes: [`DENY:name:${LEGAL_NAME}`],
    }
    const sealed = sealReceipt(contaminated, FACTS)
    expect(sealed.reasonCodes).toEqual(["DENY:name:[REDACTED]"])
    expect(sealed.redactions).toEqual(["reasonCodes[0]"])
  })

  it("reports what it compared, so an empty redaction list is not mistaken for a clean scan", () => {
    const receipt = decide().receipt
    const looked = sealReceipt(receipt, FACTS)
    expect(looked.redactions).toEqual([])
    expect(looked.scanned).toEqual({
      valuesCompared: 2,
      valuesTooShortToCompare: 0,
      subjectIdCompared: true,
    })

    const couldNotLook = sealReceipt(receipt, [])
    expect(couldNotLook.redactions).toEqual([])
    expect(couldNotLook.scanned.valuesCompared).toBe(0)
  })

  it("counts a value too short to search for rather than pretending it was checked", () => {
    const short: Fact = {
      attribute: "affiliation.status",
      presence: "PRESENT",
      value: "AC",
      sourceId: "tenure.membership",
      sourceRole: "SYSTEM_OF_RECORD",
      observedAt: FRESH,
    }
    expect("AC".length).toBeLessThan(MIN_SCANNABLE_VALUE_LENGTH)
    const sealed = sealReceipt(decide().receipt, [short])
    expect(sealed.scanned).toEqual({
      valuesCompared: 0,
      valuesTooShortToCompare: 1,
      subjectIdCompared: true,
    })
  })

  it("an absent fact contributes no value to scan — a withheld value is not a value", () => {
    const withheld: Fact = {
      attribute: "person.legal_name",
      presence: "WITHHELD",
      value: null,
      sourceId: "tenure.user",
      sourceRole: "SYSTEM_OF_RECORD",
      observedAt: FRESH,
    }
    expect(sealReceipt(decide().receipt, [withheld]).scanned.valuesCompared).toBe(0)
  })

  it("findRawValues names the path, because a leak nobody can locate is not actionable", () => {
    const found = findRawValues({ a: { b: [`x ${LEGAL_NAME} y`] } }, FACTS)
    expect(found).toEqual([{ path: "$.a.b[0]", value: LEGAL_NAME }])
  })
})
