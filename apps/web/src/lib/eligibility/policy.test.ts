import {
  MAX_CONDITION_NODES,
  canonicalDigest,
  canonicalJson,
  compilePolicy,
  compilePolicyOrThrow,
  type AttributeCatalog,
  type Condition,
  type EligibilityPolicy,
} from "./policy"

/**
 * IER-070-001 / IER-070-002 / IER-070-004 — the compiler refuses what it cannot
 * decide deterministically, and the digest is over the meaning.
 */

const CATALOG: AttributeCatalog = {
  "affiliation.status": {
    id: "affiliation.status",
    type: "enum",
    members: ["ACTIVE", "PENDING", "SUSPENDED", "REVOKED", "ENDED"],
    acceptedSourceRoles: ["SYSTEM_OF_RECORD", "AUTHORITATIVE"],
    maxAgeMs: 3_600_000,
    derivation: "SOURCE_ASSERTED",
  },
  "affiliation.interval": {
    id: "affiliation.interval",
    type: "interval",
    acceptedSourceRoles: ["SYSTEM_OF_RECORD"],
    maxAgeMs: 3_600_000,
    derivation: "SOURCE_ASSERTED",
  },
  "identity.email.verified": {
    id: "identity.email.verified",
    type: "boolean",
    acceptedSourceRoles: ["SYSTEM_OF_RECORD"],
    maxAgeMs: 3_600_000,
    derivation: "SOURCE_ASSERTED",
  },
  "person.disability.status": {
    id: "person.disability.status",
    type: "enum",
    members: ["DECLARED", "NOT_DECLARED"],
    acceptedSourceRoles: ["SELF_ATTESTED"],
    maxAgeMs: 3_600_000,
    derivation: "SOURCE_ASSERTED",
    protectedAttribute: true,
  },
}

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
      {
        attribute: "affiliation.status",
        acceptedSourceRoles: ["SYSTEM_OF_RECORD"],
        maxAgeMs: 60_000,
      },
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

function problemsOf(candidate: EligibilityPolicy): string[] {
  const result = compilePolicy(candidate, CATALOG)
  return result.ok ? [] : result.problems.map((problem) => `${problem.path}: ${problem.message}`)
}

describe("compilePolicy — a well-formed policy", () => {
  it("compiles, and reports every attribute its conditions read", () => {
    const result = compilePolicy(
      policy({
        attributes: [
          { attribute: "affiliation.status", acceptedSourceRoles: ["SYSTEM_OF_RECORD"], maxAgeMs: 60_000 },
          { attribute: "identity.email.verified", acceptedSourceRoles: ["SYSTEM_OF_RECORD"], maxAgeMs: 60_000 },
        ],
        conditionallyEligible: [
          {
            when: { attribute: "identity.email.verified", op: "equals", value: true },
            code: "EMAIL_NOT_VERIFIED",
          },
        ],
      }),
      CATALOG,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.compiled.referencedAttributes).toEqual([
      "affiliation.status",
      "identity.email.verified",
    ])
    expect(result.compiled.digest).toMatch(/^sha256:[0-9a-f]{64}$/)
  })
})

describe("IER-070-002 — every attribute reference, type, source trust and freshness is validated", () => {
  it("refuses an attribute that is in no catalog entry", () => {
    const problems = problemsOf(
      policy({ conditions: { all: [{ attribute: "affiliation.staus", op: "in", values: ["ACTIVE"] }] } }),
    )
    expect(problems.join("\n")).toContain('attribute "affiliation.staus" is in no catalog entry')
  })

  it("refuses a value that is not a member of the enum", () => {
    const problems = problemsOf(
      policy({ conditions: { all: [{ attribute: "affiliation.status", op: "in", values: ["ACTIVE", "ALUMNUS"] }] } }),
    )
    expect(problems.join("\n")).toContain("not members of affiliation.status: ALUMNUS")
  })

  it("refuses a type mismatch", () => {
    const problems = problemsOf(
      policy({
        attributes: [
          { attribute: "identity.email.verified", acceptedSourceRoles: ["SYSTEM_OF_RECORD"], maxAgeMs: 60_000 },
        ],
        conditions: { all: [{ attribute: "identity.email.verified", op: "equals", value: "true" }] },
      }),
    )
    expect(problems.join("\n")).toContain("is boolean; compared against a string")
  })

  it("refuses evaluationTimeWithin on an attribute that is not an interval", () => {
    const problems = problemsOf(
      policy({ conditions: { all: [{ attribute: "affiliation.status", op: "evaluationTimeWithin" }] } }),
    )
    expect(problems.join("\n")).toContain("evaluationTimeWithin needs an interval attribute")
  })

  it("refuses a policy that widens source trust beyond the catalog", () => {
    const problems = problemsOf(
      policy({
        attributes: [
          { attribute: "affiliation.status", acceptedSourceRoles: ["SELF_ATTESTED"], maxAgeMs: 60_000 },
        ],
      }),
    )
    expect(problems.join("\n")).toContain("a policy may narrow source trust, never widen it")
  })

  it("refuses a policy that accepts a fact staler than the catalog permits", () => {
    const problems = problemsOf(
      policy({
        attributes: [
          { attribute: "affiliation.status", acceptedSourceRoles: ["SYSTEM_OF_RECORD"], maxAgeMs: 86_400_000 },
        ],
      }),
    )
    expect(problems.join("\n")).toContain("is older than the catalog's 3600000ms")
  })

  it("refuses a condition over an attribute whose trust and freshness the policy never declared", () => {
    const problems = problemsOf(
      policy({
        conditions: {
          all: [
            { attribute: "affiliation.status", op: "in", values: ["ACTIVE"] },
            { attribute: "identity.email.verified", op: "equals", value: true },
          ],
        },
      }),
    )
    expect(problems.join("\n")).toContain("not declared in this policy's attributes")
  })

  it("refuses a protected attribute read with no stated lawful basis, and permits one with", () => {
    const reading: Condition = {
      all: [{ attribute: "person.disability.status", op: "in", values: ["DECLARED"] }],
    }
    const attributes = [
      { attribute: "person.disability.status", acceptedSourceRoles: ["SELF_ATTESTED" as const], maxAgeMs: 60_000 },
    ]
    expect(problemsOf(policy({ conditions: reading, attributes })).join("\n")).toContain(
      "is protected and this policy states no lawful basis",
    )
    expect(
      problemsOf(
        policy({
          conditions: reading,
          attributes,
          justifiedProtectedAttributes: {
            "person.disability.status": "Accommodation workflow, DPIA 2026-03, reviewed annually.",
          },
        }),
      ),
    ).toEqual([])
  })
})

describe("IER-070-004 — missing, stale, conflict and unavailable-source behaviour is declared, never defaulted", () => {
  it.each(["onMissing", "onStale", "onConflict", "onSourceUnavailable"] as const)(
    "refuses a policy whose %s is absent",
    (field) => {
      const incomplete = policy()
      // A policy arriving as parsed JSON from System Studio has no type system
      // standing behind it, which is the case this check exists for.
      delete (incomplete as unknown as Record<string, unknown>)[field]
      expect(problemsOf(incomplete).join("\n")).toContain(`every policy must state ${field}`)
    },
  )

  it("refuses a behaviour word that is not one of the four", () => {
    const problems = problemsOf(policy({ onStale: "CARRY_ON" as never }))
    expect(problems.join("\n")).toContain('"CARRY_ON" is not one of')
  })
})

describe("IER-070-005 — the language is capped and cannot hide a default", () => {
  it("refuses a condition tree larger than the cap", () => {
    const leaf: Condition = { attribute: "affiliation.status", op: "in", values: ["ACTIVE"] }
    const many: Condition = { all: Array.from({ length: MAX_CONDITION_NODES }, () => leaf) }
    expect(problemsOf(policy({ conditions: many })).join("\n")).toContain(
      `condition nodes exceeds the cap of ${MAX_CONDITION_NODES}`,
    )
  })

  it("refuses an `in` with no members, which could never be true", () => {
    const problems = problemsOf(
      policy({ conditions: { all: [{ attribute: "affiliation.status", op: "in", values: [] }] } }),
    )
    expect(problems.join("\n")).toContain("can never be true")
  })

  it("refuses a policy naming no tenant capability", () => {
    expect(problemsOf(policy({ requiresTenantCapability: "" })).join("\n")).toContain("gate 1 is not optional")
  })

  it("refuses an exception with no expiry", () => {
    const problems = problemsOf(
      policy({
        exceptions: [
          { subjectId: "u1", approvedBy: "dean", reason: "late transfer", expiresAt: "whenever" },
        ],
      }),
    )
    expect(problems.join("\n")).toContain("a permanent grant with paperwork")
  })
})

describe("IER-070-001 — the digest is over the meaning of a version, not its byte order", () => {
  it("is stable under key reordering and changes when a condition changes", () => {
    const base = policy()
    // Same policy, every top-level key inserted in the opposite order — what an
    // editor that rewrites a document does, and what must not move a digest.
    const reordered = Object.fromEntries(
      Object.entries(base).reverse(),
    ) as unknown as EligibilityPolicy
    expect(Object.keys(reordered)).not.toEqual(Object.keys(base))
    expect(canonicalDigest(reordered)).toBe(canonicalDigest(base))

    const changed = policy({
      conditions: { all: [{ attribute: "affiliation.status", op: "in", values: ["ACTIVE", "PENDING"] }] },
    })
    expect(canonicalDigest(changed)).not.toBe(canonicalDigest(base))
  })

  it("sorts object keys at every depth", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe(
      '{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}',
    )
  })
})

describe("compilePolicyOrThrow", () => {
  it("throws with every problem listed, so one edit fixes them all", () => {
    expect(() =>
      compilePolicyOrThrow(policy({ requiresTenantCapability: "", approvedBy: "" }), CATALOG),
    ).toThrow(/requiresTenantCapability[\s\S]*approvedBy/)
  })
})
