import { createHash } from "node:crypto"

/**
 * IER-070-001 / IER-070-002 / IER-070-004 — the declarative eligibility policy,
 * and the compiler that refuses one it cannot decide deterministically.
 *
 * Bible §12: "Eligibility is a deterministic policy decision over typed,
 * versioned facts." §12.2 then says what the language may not do — "Use a typed
 * declarative language, not arbitrary scripts", "Validate every attribute
 * reference against the catalog", "Validate source trust and freshness at
 * compile time and evaluation time", "Prohibit hidden defaults", "Cap
 * expression complexity", "Record a canonical digest for every version".
 *
 * ## Why a compile step exists at all
 *
 * A policy that references `affiliation.staus` is not a policy that denies
 * everybody — it is a policy nobody has read. Without a compile step the typo
 * surfaces as an evaluation that finds no fact, applies `on_missing`, and
 * produces a perfectly-formed INDETERMINATE that looks exactly like a source
 * outage. "We looked and found nothing" and "we could not look" are different
 * answers, and this compiler is where the third answer — "this question was
 * never askable" — is separated from both, before anybody is denied by it.
 *
 * So `compilePolicy` is a lint, not a parse. Every problem it reports names the
 * path inside the policy where it lives, because the operator fixing it is
 * editing a document, not a stack trace.
 *
 * ## No hidden defaults, enforced by the type and again at runtime
 *
 * `onMissing`, `onStale`, `onConflict` and `onSourceUnavailable` are required
 * fields, not optional ones with a sensible fallback. §12.2's "Prohibit hidden
 * defaults" is precisely the rule that a policy which forgot to say what a
 * stale HRIS feed means must not silently mean "carry on". TypeScript enforces
 * that for a policy written in this repository; `compilePolicy` enforces it
 * again for one that arrived as JSON from System Studio, where the type system
 * is not present.
 *
 * ## The digest is over the meaning, not the file
 *
 * `canonicalDigest` serialises with sorted keys, so a policy re-saved by an
 * editor that reorders fields has the same digest and a policy whose conditions
 * changed does not. That is what makes "this decision was made under policy
 * digest X" a claim anybody can re-derive.
 */

/** §8 source roles. `UNTRUSTED` is listed so a quarantined source is nameable, never readable. */
export const SOURCE_ROLES = [
  "AUTHORITATIVE",
  "SYSTEM_OF_RECORD",
  "CORROBORATING",
  "ATTESTED_BY_TENANT_ADMIN",
  "SELF_ATTESTED",
  "DERIVED_DETERMINISTIC",
  "ADVISORY_ONLY",
  "UNTRUSTED",
] as const
export type SourceRole = (typeof SOURCE_ROLES)[number]

export const ATTRIBUTE_TYPES = ["string", "boolean", "enum", "interval"] as const
export type AttributeType = (typeof ATTRIBUTE_TYPES)[number]

/**
 * IER-070-006 — how a value came to exist, which is the only thing that
 * separates a fact from a guess once both are sitting in the same field.
 *
 * §12.2 "Prohibit LLM output as a condition", invariant 8. A prohibition you
 * cannot detect is a comment, so the catalog is made to SAY how each attribute
 * is produced and the compiler refuses the ones that were not derived by a rule
 * anybody can re-run. It is required rather than optional-with-a-default
 * precisely because the dangerous case is the attribute somebody forgot to
 * label: an optional field means a model-inferred value slips in as a hard
 * access condition by omission, which is the shape of this failure everywhere
 * it has happened.
 */
export const DERIVATIONS = [
  /** A source stated it. */
  "SOURCE_ASSERTED",
  /** Computed from asserted facts by a rule that produces the same answer every time. */
  "DETERMINISTIC_DERIVED",
  /** Produced by a model. Evidence for a human to read; never the condition itself. */
  "MODEL_INFERRED",
] as const
export type Derivation = (typeof DERIVATIONS)[number]

/** Derivations that may never be a condition on access (IER-070-006). */
export const NON_DECIDING_DERIVATIONS: readonly Derivation[] = ["MODEL_INFERRED"]

/**
 * Source roles that may never be the final word on access (IER-070-006).
 *
 * §8's `ADVISORY_ONLY` exists so a probabilistic or third-party signal can be
 * carried, shown and reasoned about without deciding anything; `UNTRUSTED` is
 * how a quarantined source stays nameable. A policy that accepted either would
 * be reading exactly the signal §12.2 forbids as a condition, under a different
 * field name.
 */
export const NON_DECIDING_SOURCE_ROLES: readonly SourceRole[] = ["ADVISORY_ONLY", "UNTRUSTED"]

/**
 * One attribute this platform is allowed to decide with (§7).
 *
 * `acceptedSourceRoles` and `maxAgeMs` live on the CATALOG rather than only on
 * the policy because they are properties of the fact, not of the question: a
 * self-attested employment status is untrustworthy in every policy that reads
 * it, and a policy that widened its own acceptance would be granting itself
 * trust the catalog withheld. A policy may narrow both; `compilePolicy` refuses
 * one that widens either.
 */
export interface AttributeDefinition {
  id: string
  type: AttributeType
  /** Required when `type` is `enum`; the complete set of values that exist. */
  members?: readonly string[]
  /** Source roles whose assertion of this attribute may be read at all. */
  acceptedSourceRoles: readonly SourceRole[]
  /** Maximum age of an assertion, in milliseconds, before it is stale. */
  maxAgeMs: number
  /**
   * IER-070-006 — how this attribute is produced. Required: an attribute whose
   * derivation nobody stated is an attribute nobody can vouch for.
   */
  derivation: Derivation
  /**
   * §7.2 / invariant 7 — a protected attribute is forbidden as an ordinary
   * access factor. A policy may still read one, but only by naming it in
   * `justifiedProtectedAttributes` with a lawful basis, which is a sentence
   * somebody has to write and an auditor can read.
   */
  protectedAttribute?: boolean
}

export type AttributeCatalog = Readonly<Record<string, AttributeDefinition>>

/** A leaf test. There is no expression language: every operator is enumerated here. */
export type Comparison =
  | { attribute: string; op: "equals"; value: string | boolean }
  | { attribute: string; op: "in"; values: readonly string[] }
  /** True when the evaluation clock falls inside the interval this attribute holds. */
  | { attribute: string; op: "evaluationTimeWithin" }

export type Condition =
  | Comparison
  | { all: readonly Condition[] }
  | { any: readonly Condition[] }
  | { not: Condition }

/** What a policy does when a fact it needs is missing, stale, conflicting or unreachable. */
export const UNKNOWN_BEHAVIOURS = [
  /** Fails closed, and says so: nothing was decided. */
  "INDETERMINATE",
  /** Fails closed and asks for a human. §8.1's answer for high-risk access. */
  "MANUAL_REVIEW_REQUIRED",
  /** A decision, not an absence: this policy denies without the fact. */
  "INELIGIBLE",
  /**
   * The condition evaluates false and evaluation continues.
   *
   * The only behaviour that can end in ELIGIBLE, and therefore the one that has
   * to be chosen deliberately — it is right for "has this optional training
   * been recorded?" and catastrophic for "is this person still employed?".
   */
  "TREAT_AS_ABSENT",
] as const
export type UnknownBehaviour = (typeof UNKNOWN_BEHAVIOURS)[number]

export interface AttributeRequirement {
  attribute: string
  /** Narrower than or equal to the catalog's. Never wider. */
  acceptedSourceRoles: readonly SourceRole[]
  /** Narrower than or equal to the catalog's. Never wider. */
  maxAgeMs: number
}

export interface DenyRule {
  when: Condition
  /** A stable code, safe to show. Never a sentence containing a person's data. */
  code: string
  /** `SUSPENDED` when the denial is liftable by whoever imposed it. */
  outcome: "INELIGIBLE" | "SUSPENDED"
}

export interface ConditionalRequirement {
  when: Condition
  /** Emitted as remediation when `when` is not satisfied. */
  code: string
}

export interface PolicyException {
  subjectId: string
  approvedBy: string
  reason: string
  /** ISO instant. §13.5 — an exception without an end is a permanent grant with paperwork. */
  expiresAt: string
}

/** Deterministic staged rollout (§12.2 "staged rollout"). Never sampled. */
export interface StagedRollout {
  /** 0 admits nobody, 100 admits everybody. */
  percent: number
  /** Changing this reshuffles the cohort; it is part of the digest. */
  cohortSalt: string
}

export interface EligibilityPolicy {
  policyId: string
  version: string
  owner: string
  purpose: string
  /** What eligibility is being decided FOR. Never "everything". */
  target: string
  /** §2.1 gate 1: the tenant capability that must be entitled before this can grant. */
  requiresTenantCapability: string
  /** Which population this policy speaks about. */
  subject: string
  /** HIGH forces INDETERMINATE to escalate rather than simply fail closed (§8.1). */
  risk: "LOW" | "HIGH"
  /** ISO instant the policy version starts deciding. */
  activeFrom: string
  /** ISO instant it stops, or null for open-ended. */
  expiresAt: string | null
  rollout: StagedRollout
  attributes: readonly AttributeRequirement[]
  /** §7.2 — protected attributes read here, each with the basis that permits it. */
  justifiedProtectedAttributes?: Readonly<Record<string, string>>
  /** Sources whose unavailability this policy cares about. */
  requiredSources: readonly string[]
  /** Evaluated first. §12.2 "explicit deny and deny-overrides". */
  deny: readonly DenyRule[]
  conditions: Condition
  /** Unmet here means CONDITIONALLY_ELIGIBLE with remediation, not INELIGIBLE. */
  conditionallyEligible: readonly ConditionalRequirement[]
  onMissing: UnknownBehaviour
  onStale: UnknownBehaviour
  onConflict: UnknownBehaviour
  onSourceUnavailable: UnknownBehaviour
  exceptions: readonly PolicyException[]
  /** §12.1 "review frequency", in days. */
  reviewEveryDays: number
  /** §12.1 "activation approval". */
  approvedBy: string
  /** §12.1 "rollback target" — the version to return to. */
  rollbackTo: string | null
}

/** §12.2 "Cap expression complexity". A condition tree larger than this is refused. */
export const MAX_CONDITION_NODES = 64

export interface PolicyProblem {
  /** Where in the policy, e.g. `conditions.all[0]` or `attributes[2].maxAgeMs`. */
  path: string
  message: string
}

export interface CompiledPolicy {
  policy: EligibilityPolicy
  /** `sha256:…` over the canonical form. */
  digest: string
  /** Every attribute the conditions actually read, sorted. */
  referencedAttributes: readonly string[]
  /** The requirement in force for each referenced attribute, catalog-narrowed. */
  effectiveRequirements: Readonly<Record<string, AttributeRequirement>>
  catalog: AttributeCatalog
}

export type CompileResult =
  | { ok: true; compiled: CompiledPolicy }
  | { ok: false; problems: readonly PolicyProblem[] }

/** Deterministic serialisation: object keys sorted at every depth. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`
}

export function canonicalDigest(policy: EligibilityPolicy): string {
  return `sha256:${createHash("sha256").update(canonicalJson(policy)).digest("hex")}`
}

function isComparison(condition: Condition): condition is Comparison {
  return "attribute" in condition
}

/** Every leaf, in traversal order. */
function comparisonsOf(condition: Condition): Comparison[] {
  if (isComparison(condition)) return [condition]
  if ("all" in condition) return condition.all.flatMap(comparisonsOf)
  if ("any" in condition) return condition.any.flatMap(comparisonsOf)
  return comparisonsOf(condition.not)
}

function countNodes(condition: Condition): number {
  if (isComparison(condition)) return 1
  if ("all" in condition) return 1 + condition.all.reduce((n, c) => n + countNodes(c), 0)
  if ("any" in condition) return 1 + condition.any.reduce((n, c) => n + countNodes(c), 0)
  return 1 + countNodes(condition.not)
}

function isIsoInstant(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
}

function checkComparison(
  comparison: Comparison,
  path: string,
  catalog: AttributeCatalog,
  policy: EligibilityPolicy,
  problems: PolicyProblem[],
): void {
  const definition = catalog[comparison.attribute]
  if (!definition) {
    problems.push({
      path,
      message: `attribute "${comparison.attribute}" is in no catalog entry — nothing can assert it, so no decision could ever read it`,
    })
    return
  }

  // IER-070-006. Checked here, at the point a condition READS the attribute,
  // rather than over the catalog as a whole: a model-inferred attribute may
  // exist, be stored and be shown to a reviewer. What it may not do is decide.
  if (!DERIVATIONS.includes(definition.derivation)) {
    problems.push({
      path,
      message: `the catalog does not say how "${comparison.attribute}" is produced; derivation must be one of ${DERIVATIONS.join(", ")}`,
    })
  } else if (NON_DECIDING_DERIVATIONS.includes(definition.derivation)) {
    problems.push({
      path,
      message: `"${comparison.attribute}" is ${definition.derivation}: a value produced by a model is evidence a human may read, never a condition on access (§12.2, invariant 8)`,
    })
  }

  if (definition.protectedAttribute && !policy.justifiedProtectedAttributes?.[comparison.attribute]) {
    problems.push({
      path,
      message: `attribute "${comparison.attribute}" is protected and this policy states no lawful basis for reading it`,
    })
  }

  const declared = policy.attributes.find((a) => a.attribute === comparison.attribute)
  if (!declared) {
    problems.push({
      path,
      message: `attribute "${comparison.attribute}" is read by a condition but not declared in this policy's attributes, so its source trust and freshness are undeclared`,
    })
  }

  if (comparison.op === "evaluationTimeWithin" && definition.type !== "interval") {
    problems.push({
      path,
      message: `evaluationTimeWithin needs an interval attribute; "${comparison.attribute}" is ${definition.type}`,
    })
    return
  }
  if (comparison.op === "equals") {
    const expected = definition.type === "boolean" ? "boolean" : "string"
    if (typeof comparison.value !== expected) {
      problems.push({
        path,
        message: `"${comparison.attribute}" is ${definition.type}; compared against a ${typeof comparison.value}`,
      })
    } else if (definition.type === "enum" && !definition.members?.includes(String(comparison.value))) {
      problems.push({
        path,
        message: `"${String(comparison.value)}" is not a member of ${comparison.attribute}`,
      })
    }
  }
  if (comparison.op === "in") {
    if (definition.type === "boolean" || definition.type === "interval") {
      problems.push({ path, message: `"in" cannot be applied to a ${definition.type} attribute` })
    } else if (definition.type === "enum") {
      const strays = comparison.values.filter((v) => !definition.members?.includes(v))
      if (strays.length > 0) {
        problems.push({
          path,
          message: `not members of ${comparison.attribute}: ${strays.join(", ")}`,
        })
      }
    }
    if (comparison.values.length === 0) {
      problems.push({ path, message: `"in" with an empty list can never be true` })
    }
  }
}

/**
 * Lint a policy against the attribute catalog, and produce its digest.
 *
 * Every problem is collected rather than thrown at the first one: an operator
 * fixing a policy wants the list, and a compiler that stops at the first typo
 * turns one edit into five round trips.
 */
export function compilePolicy(policy: EligibilityPolicy, catalog: AttributeCatalog): CompileResult {
  const problems: PolicyProblem[] = []

  if (!policy.policyId) problems.push({ path: "policyId", message: "a policy needs an id" })
  if (!policy.version) problems.push({ path: "version", message: "a policy needs a version" })
  if (!policy.owner) problems.push({ path: "owner", message: "a policy needs an owner" })
  if (!policy.requiresTenantCapability) {
    problems.push({
      path: "requiresTenantCapability",
      message:
        "gate 1 is not optional: a policy that names no tenant capability could grant a person access to a module the tenant never bought",
    })
  }
  if (!policy.approvedBy) {
    problems.push({ path: "approvedBy", message: "activation approval is required (§12.1)" })
  }
  if (!isIsoInstant(policy.activeFrom)) {
    problems.push({ path: "activeFrom", message: "activeFrom must be an ISO instant" })
  }
  if (policy.expiresAt !== null && !isIsoInstant(policy.expiresAt)) {
    problems.push({ path: "expiresAt", message: "expiresAt must be an ISO instant or null" })
  }
  if (
    isIsoInstant(policy.activeFrom) &&
    isIsoInstant(policy.expiresAt) &&
    Date.parse(policy.expiresAt) <= Date.parse(policy.activeFrom)
  ) {
    problems.push({ path: "expiresAt", message: "a policy cannot expire before it activates" })
  }
  if (!Number.isInteger(policy.reviewEveryDays) || policy.reviewEveryDays <= 0) {
    problems.push({ path: "reviewEveryDays", message: "review frequency must be a positive whole number of days" })
  }

  // §12.2 "Prohibit hidden defaults" — checked at runtime as well as in the
  // type, because System Studio can hand this compiler parsed JSON.
  for (const field of ["onMissing", "onStale", "onConflict", "onSourceUnavailable"] as const) {
    const behaviour = policy[field] as unknown
    if (!UNKNOWN_BEHAVIOURS.includes(behaviour as UnknownBehaviour)) {
      problems.push({
        path: field,
        message: `every policy must state ${field}; "${String(behaviour)}" is not one of ${UNKNOWN_BEHAVIOURS.join(", ")}`,
      })
    }
  }

  if (
    !Number.isFinite(policy.rollout.percent) ||
    policy.rollout.percent < 0 ||
    policy.rollout.percent > 100
  ) {
    problems.push({ path: "rollout.percent", message: "rollout percent must be between 0 and 100" })
  }
  if (!policy.rollout.cohortSalt) {
    problems.push({
      path: "rollout.cohortSalt",
      message: "a rollout needs a salt, or two policies would admit an identical cohort",
    })
  }

  const nodes = countNodes(policy.conditions)
  if (nodes > MAX_CONDITION_NODES) {
    problems.push({
      path: "conditions",
      message: `${nodes} condition nodes exceeds the cap of ${MAX_CONDITION_NODES}`,
    })
  }

  const effectiveRequirements: Record<string, AttributeRequirement> = {}
  policy.attributes.forEach((requirement, index) => {
    const definition = catalog[requirement.attribute]
    if (!definition) {
      problems.push({
        path: `attributes[${index}]`,
        message: `attribute "${requirement.attribute}" is in no catalog entry`,
      })
      return
    }
    const widened = requirement.acceptedSourceRoles.filter(
      (role) => !definition.acceptedSourceRoles.includes(role),
    )
    if (widened.length > 0) {
      problems.push({
        path: `attributes[${index}].acceptedSourceRoles`,
        message: `the catalog does not accept ${widened.join(", ")} for "${requirement.attribute}"; a policy may narrow source trust, never widen it`,
      })
    }
    // IER-070-006 — an advisory or quarantined assertion is a signal, not a
    // decision. A policy that accepted one would be letting a probabilistic
    // feed grant access through the source-role field instead of the
    // derivation field, which is the same prohibition with the label moved.
    const nonDeciding = requirement.acceptedSourceRoles.filter((role) =>
      NON_DECIDING_SOURCE_ROLES.includes(role),
    )
    if (nonDeciding.length > 0) {
      problems.push({
        path: `attributes[${index}].acceptedSourceRoles`,
        message: `${nonDeciding.join(", ")} may be read and shown but may not decide access for "${requirement.attribute}" (§12.2, IER-070-006)`,
      })
    }
    if (requirement.maxAgeMs > definition.maxAgeMs) {
      problems.push({
        path: `attributes[${index}].maxAgeMs`,
        message: `${requirement.maxAgeMs}ms is older than the catalog's ${definition.maxAgeMs}ms for "${requirement.attribute}"`,
      })
    }
    if (requirement.maxAgeMs <= 0) {
      problems.push({
        path: `attributes[${index}].maxAgeMs`,
        message: "freshness must be a positive number of milliseconds",
      })
    }
    effectiveRequirements[requirement.attribute] = requirement
  })

  comparisonsOf(policy.conditions).forEach((comparison, index) => {
    checkComparison(comparison, `conditions[${index}]`, catalog, policy, problems)
  })
  policy.deny.forEach((rule, index) => {
    if (!rule.code) problems.push({ path: `deny[${index}].code`, message: "a deny rule needs a reason code" })
    comparisonsOf(rule.when).forEach((comparison, leaf) => {
      checkComparison(comparison, `deny[${index}].when[${leaf}]`, catalog, policy, problems)
    })
  })
  policy.conditionallyEligible.forEach((requirement, index) => {
    if (!requirement.code) {
      problems.push({
        path: `conditionallyEligible[${index}].code`,
        message: "a conditional requirement needs a remediation code",
      })
    }
    comparisonsOf(requirement.when).forEach((comparison, leaf) => {
      checkComparison(comparison, `conditionallyEligible[${index}].when[${leaf}]`, catalog, policy, problems)
    })
  })

  policy.exceptions.forEach((exception, index) => {
    if (!isIsoInstant(exception.expiresAt)) {
      problems.push({
        path: `exceptions[${index}].expiresAt`,
        message: "an exception without an expiry is a permanent grant with paperwork (§13.5)",
      })
    }
    if (!exception.approvedBy || !exception.reason) {
      problems.push({
        path: `exceptions[${index}]`,
        message: "an exception records who approved it and why",
      })
    }
  })

  if (problems.length > 0) return { ok: false, problems }

  const referenced = new Set<string>()
  for (const source of [
    policy.conditions,
    ...policy.deny.map((rule) => rule.when),
    ...policy.conditionallyEligible.map((requirement) => requirement.when),
  ]) {
    for (const comparison of comparisonsOf(source)) referenced.add(comparison.attribute)
  }

  return {
    ok: true,
    compiled: {
      policy,
      digest: canonicalDigest(policy),
      referencedAttributes: [...referenced].sort(),
      effectiveRequirements,
      catalog,
    },
  }
}

/** For a policy this repository ships: a defect is a deployment defect, not a decision. */
export function compilePolicyOrThrow(
  policy: EligibilityPolicy,
  catalog: AttributeCatalog,
): CompiledPolicy {
  const result = compilePolicy(policy, catalog)
  if (result.ok) return result.compiled
  const lines = result.problems.map((problem) => `  ${problem.path}: ${problem.message}`)
  throw new Error(`eligibility policy ${policy.policyId} does not compile:\n${lines.join("\n")}`)
}
