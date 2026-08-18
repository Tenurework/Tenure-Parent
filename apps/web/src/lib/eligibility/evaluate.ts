import type {
  CompiledPolicy,
  Comparison,
  Condition,
  SourceRole,
  UnknownBehaviour,
} from "./policy"

/**
 * IER-070-003 / IER-070-004 / IER-070-005 / IER-070-012 — evaluating a compiled
 * policy against typed facts, on an explicit clock, with no way to reach the
 * network and no way to end in ELIGIBLE by accident.
 *
 * Bible §2.2 enumerates the eight outcomes and states the rule this module is
 * built around: "Unknown, null, not supplied, withheld, not applicable, and
 * explicitly false are distinct values." Collapsing them is the failure this
 * repository keeps finding, and it is why `Fact` carries a `presence` rather
 * than letting `null` mean five things.
 *
 * ## Determinism is a property of the signature, not a promise in a comment
 *
 * `evaluate` takes `now` and takes every fact. It reads no clock, no
 * environment, no database and no random source, so the same arguments produce
 * the same decision on any machine at any time — which is what makes a decision
 * receipt replayable and a mutation test meaningful. Staged rollout, the one
 * place a system is tempted to sample, is a hash of the subject id: the same
 * person is in or out of a cohort every time they are asked, which is also the
 * only behaviour a person could be told the truth about.
 *
 * ## Order, and why deny is first
 *
 * §12.2 requires "explicit deny and deny-overrides". A deny rule that ran after
 * the allow conditions would be unreachable for anybody the allow conditions
 * already rejected — harmless — but it would also be *skippable* by a
 * conditional-eligibility path, which is not. Deny first means no ordering of
 * the rest can produce access the deny rule forbids.
 *
 *   1. the policy is in effect at `now`             — else INDETERMINATE
 *   2. tenant capability is entitled (gate 1)       — else INELIGIBLE
 *   3. a source this policy requires is unreachable — `onSourceUnavailable`
 *   4. facts resolved: trust, freshness, conflict   — `onMissing/onStale/onConflict`
 *   5. deny rules                                   — INELIGIBLE or SUSPENDED
 *   6. staged rollout                               — INDETERMINATE when outside
 *   7. allow conditions                             — else INELIGIBLE
 *   8. conditional requirements                     — else CONDITIONALLY_ELIGIBLE
 *
 * An active exception is applied at step 5.5: after the denies, so an exception
 * cannot be used to walk past an explicit deny, and before the allow conditions,
 * which is the whole point of having one.
 */

export const ELIGIBILITY_OUTCOMES = [
  "ELIGIBLE",
  "CONDITIONALLY_ELIGIBLE",
  "PENDING_EFFECTIVE_DATE",
  "INELIGIBLE",
  "SUSPENDED",
  "EXPIRED",
  "INDETERMINATE",
  "MANUAL_REVIEW_REQUIRED",
] as const
export type EligibilityOutcome = (typeof ELIGIBILITY_OUTCOMES)[number]

/** §2.2 — six distinct absences, because they need six different sentences. */
export const PRESENCES = [
  "PRESENT",
  "UNKNOWN",
  "NOT_SUPPLIED",
  "WITHHELD",
  "NOT_APPLICABLE",
] as const
export type Presence = (typeof PRESENCES)[number]

export interface Interval {
  /** ISO instant. */
  from: string
  /** ISO instant, or null for open-ended. */
  until: string | null
}

export type FactValue = string | boolean | Interval | null

export interface Fact {
  attribute: string
  presence: Presence
  /** Null whenever `presence` is not `PRESENT`. */
  value: FactValue
  sourceId: string
  sourceRole: SourceRole
  /** ISO instant the source asserted this. Freshness is measured from here. */
  observedAt: string
}

export interface EvaluationRequest {
  subjectId: string
  facts: readonly Fact[]
  /** The explicit evaluation clock. There is no other one. */
  now: Date
  /** Capabilities this TENANT is entitled to (gate 1). */
  tenantCapabilities: readonly string[]
  /** Sources known to be unreachable for this evaluation. */
  unavailableSources?: readonly string[]
}

/** What was read, for the receipt. Source revisions — never the values. */
export interface SourceRevision {
  attribute: string
  sourceId: string
  sourceRole: SourceRole
  observedAt: string
  stale: boolean
}

export interface DecisionReceipt {
  policyId: string
  policyVersion: string
  policyDigest: string
  subjectId: string
  /** The clock the decision was made on, echoed so a replay uses the same one. */
  evaluatedAt: string
  outcome: EligibilityOutcome
  /** Stable codes. Safe to show an admin; contain no attribute values. */
  reasonCodes: readonly string[]
  sourceRevisions: readonly SourceRevision[]
}

export interface Decision {
  outcome: EligibilityOutcome
  reasonCodes: readonly string[]
  /** Codes a person could act on, when the outcome is CONDITIONALLY_ELIGIBLE. */
  remediation: readonly string[]
  receipt: DecisionReceipt
}

/**
 * The only function that answers "may this proceed".
 *
 * Exported so no caller writes `outcome === "ELIGIBLE" || outcome === …` and
 * gets the list wrong. CONDITIONALLY_ELIGIBLE is deliberately false: the
 * conditions are the access, and "conditionally" means they are unmet.
 */
export function grantsAccess(decision: Decision): boolean {
  return decision.outcome === "ELIGIBLE"
}

/** 32-bit FNV-1a. Deterministic, dependency-free, and not a security primitive. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** IER-070-003 "staged rollout" — a stable cohort, never a sample. */
export function inRollout(
  subjectId: string,
  policyId: string,
  rollout: { percent: number; cohortSalt: string },
): boolean {
  if (rollout.percent >= 100) return true
  if (rollout.percent <= 0) return false
  const bucket = fnv1a(`${rollout.cohortSalt}:${policyId}:${subjectId}`) % 10000
  return bucket < Math.round(rollout.percent * 100)
}

type Resolution =
  | { state: "RESOLVED"; value: Exclude<FactValue, null>; revisions: SourceRevision[] }
  | { state: "MISSING" | "STALE" | "CONFLICT"; revisions: SourceRevision[] }

function sameValue(a: FactValue, b: FactValue): boolean {
  if (a === null || b === null) return a === b
  if (typeof a === "object" || typeof b === "object") {
    if (typeof a !== "object" || typeof b !== "object") return false
    return a.from === b.from && a.until === b.until
  }
  return a === b
}

function resolveAttribute(
  attribute: string,
  compiled: CompiledPolicy,
  request: EvaluationRequest,
): Resolution {
  const requirement = compiled.effectiveRequirements[attribute]
  const nowMs = request.now.getTime()
  const revisions: SourceRevision[] = []
  const usable: Fact[] = []
  let sawStale = false

  for (const fact of request.facts) {
    if (fact.attribute !== attribute) continue
    // Source trust at EVALUATION time, not only at compile time (§12.2). A fact
    // from a role this policy does not accept is not a weak signal to be
    // weighted — it is not read.
    if (requirement && !requirement.acceptedSourceRoles.includes(fact.sourceRole)) continue
    const observedMs = Date.parse(fact.observedAt)
    const stale =
      Number.isNaN(observedMs) || (requirement ? nowMs - observedMs > requirement.maxAgeMs : false)
    revisions.push({
      attribute,
      sourceId: fact.sourceId,
      sourceRole: fact.sourceRole,
      observedAt: fact.observedAt,
      stale,
    })
    if (stale) {
      sawStale = true
      continue
    }
    if (fact.presence !== "PRESENT" || fact.value === null) continue
    usable.push(fact)
  }

  if (usable.length === 0) return { state: sawStale ? "STALE" : "MISSING", revisions }

  const first = usable[0].value
  if (usable.some((fact) => !sameValue(fact.value, first))) {
    // §8.1 — "Conflicting authoritative sources never resolve through last
    // write wins." So they do not resolve here at all.
    return { state: "CONFLICT", revisions }
  }
  return { state: "RESOLVED", value: first as Exclude<FactValue, null>, revisions }
}

/** An unknown fact aborts, or is treated as absent — the policy said which. */
type LeafResult = { kind: "VALUE"; satisfied: boolean } | { kind: "ABORT"; behaviour: UnknownBehaviour; code: string }

function evaluateComparison(
  comparison: Comparison,
  compiled: CompiledPolicy,
  request: EvaluationRequest,
  revisions: SourceRevision[],
): LeafResult {
  const resolution = resolveAttribute(comparison.attribute, compiled, request)
  revisions.push(...resolution.revisions)

  if (resolution.state !== "RESOLVED") {
    const behaviour =
      resolution.state === "MISSING"
        ? compiled.policy.onMissing
        : resolution.state === "STALE"
          ? compiled.policy.onStale
          : compiled.policy.onConflict
    if (behaviour === "TREAT_AS_ABSENT") return { kind: "VALUE", satisfied: false }
    return {
      kind: "ABORT",
      behaviour,
      code: `${resolution.state}:${comparison.attribute}`,
    }
  }

  const value = resolution.value
  if (comparison.op === "equals") return { kind: "VALUE", satisfied: sameValue(value, comparison.value) }
  if (comparison.op === "in") {
    return { kind: "VALUE", satisfied: typeof value === "string" && comparison.values.includes(value) }
  }
  // evaluationTimeWithin
  if (typeof value !== "object" || value === null) return { kind: "VALUE", satisfied: false }
  const nowMs = request.now.getTime()
  const from = Date.parse(value.from)
  const until = value.until === null ? Number.POSITIVE_INFINITY : Date.parse(value.until)
  if (Number.isNaN(from) || Number.isNaN(until)) {
    return { kind: "ABORT", behaviour: "INDETERMINATE", code: `MALFORMED:${comparison.attribute}` }
  }
  return { kind: "VALUE", satisfied: nowMs >= from && nowMs < until }
}

function evaluateCondition(
  condition: Condition,
  compiled: CompiledPolicy,
  request: EvaluationRequest,
  revisions: SourceRevision[],
): LeafResult {
  if ("attribute" in condition) return evaluateComparison(condition, compiled, request, revisions)
  if ("all" in condition) {
    let satisfied = true
    for (const child of condition.all) {
      const result = evaluateCondition(child, compiled, request, revisions)
      // An abort is not swallowed by an earlier false: "we could not look" must
      // not be reported as "we looked and the answer was no".
      if (result.kind === "ABORT") return result
      if (!result.satisfied) satisfied = false
    }
    return { kind: "VALUE", satisfied }
  }
  if ("any" in condition) {
    let satisfied = false
    let abort: LeafResult | null = null
    for (const child of condition.any) {
      const result = evaluateCondition(child, compiled, request, revisions)
      if (result.kind === "ABORT") {
        abort = abort ?? result
        continue
      }
      if (result.satisfied) satisfied = true
    }
    // A satisfied branch makes the unknown one irrelevant; otherwise the
    // unknown is the reason, not a denial.
    if (satisfied) return { kind: "VALUE", satisfied: true }
    return abort ?? { kind: "VALUE", satisfied: false }
  }
  const inner = evaluateCondition(condition.not, compiled, request, revisions)
  if (inner.kind === "ABORT") return inner
  return { kind: "VALUE", satisfied: !inner.satisfied }
}

function outcomeForBehaviour(behaviour: UnknownBehaviour, risk: "LOW" | "HIGH"): EligibilityOutcome {
  if (behaviour === "INELIGIBLE") return "INELIGIBLE"
  if (behaviour === "MANUAL_REVIEW_REQUIRED") return "MANUAL_REVIEW_REQUIRED"
  // IER-070-012 — an indeterminate decision on a high-risk policy escalates
  // rather than resting as an unread INDETERMINATE. Neither grants access.
  return risk === "HIGH" ? "MANUAL_REVIEW_REQUIRED" : "INDETERMINATE"
}

function decide(
  compiled: CompiledPolicy,
  request: EvaluationRequest,
  outcome: EligibilityOutcome,
  reasonCodes: readonly string[],
  revisions: readonly SourceRevision[],
  remediation: readonly string[] = [],
): Decision {
  const seen = new Set<string>()
  const deduped = revisions.filter((revision) => {
    const key = `${revision.attribute}|${revision.sourceId}|${revision.observedAt}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return {
    outcome,
    reasonCodes,
    remediation,
    receipt: {
      policyId: compiled.policy.policyId,
      policyVersion: compiled.policy.version,
      policyDigest: compiled.digest,
      subjectId: request.subjectId,
      // An unusable clock is itself one of the things this engine fails closed
      // on, so the receipt has to be writable for that decision too — calling
      // `toISOString()` on an invalid Date throws, and a receipt that cannot be
      // written would turn a closed door into an unhandled exception.
      evaluatedAt: Number.isNaN(request.now.getTime())
        ? "INVALID_EVALUATION_CLOCK"
        : request.now.toISOString(),
      outcome,
      reasonCodes,
      sourceRevisions: deduped,
    },
  }
}

/**
 * Evaluate a compiled policy. Never throws: an engine defect is a decision that
 * fails closed, because a thrown error inside an authorization path is an
 * outage in one caller and an unchecked `catch` that continues in the next.
 */
export function evaluate(compiled: CompiledPolicy, request: EvaluationRequest): Decision {
  const revisions: SourceRevision[] = []
  const risk = compiled.policy.risk
  try {
    const nowMs = request.now.getTime()
    if (Number.isNaN(nowMs)) {
      return decide(compiled, request, outcomeForBehaviour("INDETERMINATE", risk), ["ENGINE_ERROR"], revisions)
    }

    const activeFrom = Date.parse(compiled.policy.activeFrom)
    if (nowMs < activeFrom) {
      return decide(compiled, request, "INDETERMINATE", ["POLICY_NOT_YET_ACTIVE"], revisions)
    }
    if (compiled.policy.expiresAt !== null && nowMs >= Date.parse(compiled.policy.expiresAt)) {
      return decide(compiled, request, "INDETERMINATE", ["POLICY_EXPIRED"], revisions)
    }

    if (!request.tenantCapabilities.includes(compiled.policy.requiresTenantCapability)) {
      // Gate 1 (§2.1). A person cannot be eligible for a capability the tenant
      // does not have, and this is the difference between "not entitled" and
      // "not permitted" staying visible.
      return decide(compiled, request, "INELIGIBLE", ["TENANT_CAPABILITY_NOT_ENTITLED"], revisions)
    }

    const unavailable = (request.unavailableSources ?? []).filter((source) =>
      compiled.policy.requiredSources.includes(source),
    )
    if (unavailable.length > 0 && compiled.policy.onSourceUnavailable !== "TREAT_AS_ABSENT") {
      return decide(
        compiled,
        request,
        outcomeForBehaviour(compiled.policy.onSourceUnavailable, risk),
        unavailable.sort().map((source) => `SOURCE_UNAVAILABLE:${source}`),
        revisions,
      )
    }

    for (const rule of compiled.policy.deny) {
      const result = evaluateCondition(rule.when, compiled, request, revisions)
      if (result.kind === "ABORT") {
        return decide(
          compiled,
          request,
          outcomeForBehaviour(result.behaviour, risk),
          [`DENY_UNDECIDABLE:${rule.code}`, result.code],
          revisions,
        )
      }
      if (result.satisfied) return decide(compiled, request, rule.outcome, [rule.code], revisions)
    }

    const exception = compiled.policy.exceptions.find(
      (candidate) =>
        candidate.subjectId === request.subjectId && nowMs < Date.parse(candidate.expiresAt),
    )
    if (exception) {
      return decide(compiled, request, "ELIGIBLE", ["EXCEPTION_GRANTED"], revisions)
    }

    if (!inRollout(request.subjectId, compiled.policy.policyId, compiled.policy.rollout)) {
      return decide(compiled, request, "INDETERMINATE", ["OUTSIDE_STAGED_ROLLOUT"], revisions)
    }

    const main = evaluateCondition(compiled.policy.conditions, compiled, request, revisions)
    if (main.kind === "ABORT") {
      const timing = timingOutcome(compiled, request, revisions)
      if (timing) return timing
      return decide(compiled, request, outcomeForBehaviour(main.behaviour, risk), [main.code], revisions)
    }
    if (!main.satisfied) {
      const timing = timingOutcome(compiled, request, revisions)
      if (timing) return timing
      return decide(compiled, request, "INELIGIBLE", ["CONDITIONS_NOT_SATISFIED"], revisions)
    }

    const remediation: string[] = []
    for (const requirement of compiled.policy.conditionallyEligible) {
      const result = evaluateCondition(requirement.when, compiled, request, revisions)
      if (result.kind === "ABORT" || !result.satisfied) remediation.push(requirement.code)
    }
    if (remediation.length > 0) {
      return decide(compiled, request, "CONDITIONALLY_ELIGIBLE", remediation, revisions, remediation)
    }

    return decide(compiled, request, "ELIGIBLE", [], revisions)
  } catch {
    // IER-070-012. The catch is the requirement, not defensive habit: an engine
    // error must be a closed door with a name, never a thrown exception a
    // caller might log and continue past.
    return decide(compiled, request, outcomeForBehaviour("INDETERMINATE", risk), ["ENGINE_ERROR"], revisions)
  }
}

/**
 * Distinguish "not yet" and "no longer" from "no".
 *
 * §2.2 lists PENDING_EFFECTIVE_DATE and EXPIRED as outcomes in their own right,
 * and they are the two a person can do the most with: one is a date to wait
 * for, the other is a renewal to ask for. They are derived from the interval
 * attributes the policy already reads rather than declared a second time, so a
 * policy cannot say a person is expired while reading an interval that is open.
 */
function timingOutcome(
  compiled: CompiledPolicy,
  request: EvaluationRequest,
  revisions: SourceRevision[],
): Decision | null {
  const nowMs = request.now.getTime()
  for (const attribute of compiled.referencedAttributes) {
    if (compiled.catalog[attribute]?.type !== "interval") continue
    const resolution = resolveAttribute(attribute, compiled, request)
    if (resolution.state !== "RESOLVED") continue
    const value = resolution.value
    if (typeof value !== "object") continue
    const from = Date.parse(value.from)
    const until = value.until === null ? Number.POSITIVE_INFINITY : Date.parse(value.until)
    if (!Number.isNaN(from) && nowMs < from) {
      return decide(compiled, request, "PENDING_EFFECTIVE_DATE", [`NOT_YET_EFFECTIVE:${attribute}`], revisions)
    }
    if (!Number.isNaN(until) && nowMs >= until) {
      return decide(compiled, request, "EXPIRED", [`ENDED:${attribute}`], revisions)
    }
  }
  return null
}
