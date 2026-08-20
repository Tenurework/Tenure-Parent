import { evaluate, type Fact } from "./evaluate"
import {
  DERIVATIONS,
  NON_DECIDING_DERIVATIONS,
  NON_DECIDING_SOURCE_ROLES,
  compilePolicy,
  compilePolicyOrThrow,
  type AttributeCatalog,
  type AttributeDefinition,
  type EligibilityPolicy,
} from "./policy"

/**
 * IER-070-006 — "Prohibit LLM/embedding/probabilistic output as final access
 * condition."
 *
 * `engine-purity.test.ts` already asserts the engine's own SOURCE cannot reach
 * a model. That is one half. The other half is the one this file covers: a
 * perfectly pure engine reading an attribute whose VALUE a model produced is
 * exactly the prohibited thing, and no scan of the engine's text can see it.
 *
 * Two locks are tested here, and the second exists because the first can be
 * walked around: `CompiledPolicy` is an interface, so a caller can construct
 * one without ever passing through `compilePolicy`.
 */

const NOW = new Date("2026-06-01T12:00:00.000Z")
const FRESH = "2026-06-01T11:59:00.000Z"

function definition(overrides: Partial<AttributeDefinition> = {}): AttributeDefinition {
  return {
    id: "risk.flag",
    type: "enum",
    members: ["HIGH", "LOW"],
    acceptedSourceRoles: ["SYSTEM_OF_RECORD", "ADVISORY_ONLY"],
    maxAgeMs: 3_600_000,
    derivation: "SOURCE_ASSERTED",
    ...overrides,
  }
}

function catalog(overrides: Partial<AttributeDefinition> = {}): AttributeCatalog {
  return { "risk.flag": definition(overrides) }
}

function policy(overrides: Partial<EligibilityPolicy> = {}): EligibilityPolicy {
  return {
    policyId: "test.deciding.v1",
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
    attributes: [{ attribute: "risk.flag", acceptedSourceRoles: ["SYSTEM_OF_RECORD"], maxAgeMs: 600_000 }],
    requiredSources: [],
    deny: [],
    conditions: { all: [{ attribute: "risk.flag", op: "equals", value: "LOW" }] },
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

function fact(overrides: Partial<Fact> = {}): Fact {
  return {
    attribute: "risk.flag",
    presence: "PRESENT",
    value: "LOW",
    sourceId: "hris",
    sourceRole: "SYSTEM_OF_RECORD",
    observedAt: FRESH,
    ...overrides,
  }
}

describe("IER-070-006 — a model-derived attribute may be held, but may not decide", () => {
  it("the prohibition names a derivation that exists in the vocabulary", () => {
    for (const derivation of NON_DECIDING_DERIVATIONS) {
      expect(DERIVATIONS).toContain(derivation)
    }
    expect(NON_DECIDING_DERIVATIONS).toContain("MODEL_INFERRED")
  })

  it("refuses to compile a policy whose allow condition reads a model-inferred attribute", () => {
    const result = compilePolicy(policy(), catalog({ derivation: "MODEL_INFERRED" }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.problems.map((problem) => problem.path)).toContain("conditions[0]")
    expect(result.problems[0].message).toMatch(/never a condition on access/)
  })

  it("refuses it in a deny rule too — a model may not close a door either", () => {
    const result = compilePolicy(
      policy({
        deny: [
          { when: { attribute: "risk.flag", op: "equals", value: "HIGH" }, code: "RISK", outcome: "INELIGIBLE" },
        ],
      }),
      catalog({ derivation: "MODEL_INFERRED" }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.problems.map((problem) => problem.path)).toContain("deny[0].when[0]")
  })

  it("refuses it in a conditional requirement", () => {
    const result = compilePolicy(
      policy({
        conditionallyEligible: [
          { when: { attribute: "risk.flag", op: "equals", value: "LOW" }, code: "REVIEW_RISK" },
        ],
      }),
      catalog({ derivation: "MODEL_INFERRED" }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.problems.map((problem) => problem.path)).toContain("conditionallyEligible[0].when[0]")
  })

  it("refuses a catalog entry that does not say how the value is produced", () => {
    const unlabelled = { "risk.flag": { ...definition(), derivation: undefined } } as unknown as AttributeCatalog
    const result = compilePolicy(policy(), unlabelled)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.problems.some((problem) => /does not say how/.test(problem.message))).toBe(true)
  })

  it("compiles the same policy once the attribute is deterministically derived", () => {
    const result = compilePolicy(policy(), catalog({ derivation: "DETERMINISTIC_DERIVED" }))
    expect(result.ok).toBe(true)
  })

  it("names both roles §8 forbids as deciders", () => {
    // Named literally, not looped from the constant: a test that takes its
    // cases from the list it is testing passes when an entry is deleted, which
    // is the only edit that matters here.
    expect(NON_DECIDING_SOURCE_ROLES).toContain("ADVISORY_ONLY")
    expect(NON_DECIDING_SOURCE_ROLES).toContain("UNTRUSTED")
  })

  it("refuses a policy that accepts an advisory or quarantined source for a condition", () => {
    for (const role of ["ADVISORY_ONLY", "UNTRUSTED"] as const) {
      const result = compilePolicy(
        policy({
          attributes: [
            { attribute: "risk.flag", acceptedSourceRoles: ["SYSTEM_OF_RECORD", role], maxAgeMs: 600_000 },
          ],
        }),
        catalog(),
      )
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error("unreachable")
      expect(result.problems.map((problem) => problem.path)).toContain("attributes[0].acceptedSourceRoles")
      expect(result.problems.some((problem) => /may not decide access/.test(problem.message))).toBe(true)
    }
  })

  it("the second lock: evaluation refuses a model-inferred attribute even in a hand-built compiled policy", () => {
    // The compiler cannot be the only guard, because this object never went
    // through it. Swapping the catalog after compilation reaches the same place.
    const compiled = compilePolicyOrThrow(policy(), catalog({ derivation: "DETERMINISTIC_DERIVED" }))
    const swapped = { ...compiled, catalog: catalog({ derivation: "MODEL_INFERRED" }) }

    const decision = evaluate(swapped, {
      subjectId: "person-1",
      facts: [fact()],
      now: NOW,
      tenantCapabilities: ["core.workspace"],
    })

    expect(decision.outcome).toBe("INDETERMINATE")
    expect(decision.reasonCodes).toEqual(["NOT_A_DECIDING_ATTRIBUTE:risk.flag"])
  })

  it("a policy that says TREAT_AS_ABSENT cannot use it to walk past the prohibition", () => {
    // TREAT_AS_ABSENT is the one behaviour that can still end in ELIGIBLE. If
    // the prohibition ran through `onMissing`, a policy could opt out of it.
    const compiled = compilePolicyOrThrow(
      policy({ onMissing: "TREAT_AS_ABSENT", conditions: { any: [{ attribute: "risk.flag", op: "equals", value: "LOW" }] } }),
      catalog({ derivation: "DETERMINISTIC_DERIVED" }),
    )
    const swapped = { ...compiled, catalog: catalog({ derivation: "MODEL_INFERRED" }) }

    const decision = evaluate(swapped, {
      subjectId: "person-1",
      facts: [fact()],
      now: NOW,
      tenantCapabilities: ["core.workspace"],
    })

    expect(decision.outcome).not.toBe("ELIGIBLE")
    expect(decision.reasonCodes).toEqual(["NOT_A_DECIDING_ATTRIBUTE:risk.flag"])
  })

  it("an advisory assertion is not read at evaluation time, whatever the compiled policy accepted", () => {
    const compiled = compilePolicyOrThrow(policy(), catalog())
    const widened = {
      ...compiled,
      effectiveRequirements: {
        "risk.flag": {
          attribute: "risk.flag",
          acceptedSourceRoles: ["SYSTEM_OF_RECORD", "ADVISORY_ONLY"] as const,
          maxAgeMs: 600_000,
        },
      },
    }

    const decision = evaluate(widened, {
      subjectId: "person-1",
      facts: [fact({ sourceRole: "ADVISORY_ONLY" })],
      now: NOW,
      tenantCapabilities: ["core.workspace"],
    })

    // Not ELIGIBLE on the advisory value, and not silently false either: the
    // fact was never read, so the answer is "nothing was asserted".
    expect(decision.outcome).toBe("INDETERMINATE")
    expect(decision.reasonCodes).toEqual(["MISSING:risk.flag"])
    expect(decision.receipt.sourceRevisions).toEqual([])
  })

  it("the same fact from a system of record decides normally — the control", () => {
    const compiled = compilePolicyOrThrow(policy(), catalog())
    const decision = evaluate(compiled, {
      subjectId: "person-1",
      facts: [fact()],
      now: NOW,
      tenantCapabilities: ["core.workspace"],
    })
    expect(decision.outcome).toBe("ELIGIBLE")
  })
})
