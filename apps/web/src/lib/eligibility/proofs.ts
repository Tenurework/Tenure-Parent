import type { SourceRole } from "./policy"
import type { EligibilityTarget } from "./targets"

/**
 * IER-120-006 — "Enforce training/license/clearance proofs by narrow status,
 * source, freshness, and scope."
 *
 * Bible §17: "Factory assignment plus current safety training may permit
 * work-order execution at a site", and "Professional license status may permit
 * a regulated workflow, while raw license documents remain restricted".
 *
 * Four independent gates, and the requirement names all four. Each one alone
 * is a plausible-looking check that lets the wrong person through:
 *
 *   - **status** is narrow, and narrow means an allow-list. `status !==
 *     "REVOKED"` admits `PENDING`, `EXPIRED` and `NOT_HELD` — and admits any
 *     status invented later, which is the failure that does not show up in a
 *     test until the day somebody adds one.
 *   - **source** is a role, not a field. A licence a person typed into their
 *     own profile and a licence a state registry asserted are the same string
 *     and are not the same fact, which is why `SELF_ATTESTED` exists in
 *     `SOURCE_ROLES` and why a requirement lists what it accepts.
 *   - **freshness** is about the ASSERTION, not the certificate. A registry
 *     feed that last answered in March is stale in September even when the
 *     licence it reported runs to 2029: the licence may have been revoked in
 *     April and nobody asked. `validUntil` and `observedAt` are two different
 *     dates and this module keeps them apart.
 *   - **scope** is the one that is usually missing. A forklift certificate for
 *     site A is not a forklift certificate for site B, and a proof asserted
 *     with no scope at all does not satisfy a scoped requirement — "we could
 *     not tell where this applies" is not "everywhere".
 *
 * ## Raw documents are not here, deliberately
 *
 * §7.2 and §17 both say the document stays restricted. A `ProofAssertion`
 * carries a status, a validity window and a scope — no document id, no file
 * reference, no issuing text, no licence number. Everything an eligibility
 * decision needs and nothing an eligibility decision could leak. §12.4's
 * "prefer narrow attestations over raw sensitive documents" is a property of
 * this type rather than a rule somebody has to remember.
 *
 * Nothing here reads a clock: `now` is an argument.
 */

export const PROOF_KINDS = ["TRAINING", "LICENSE", "CLEARANCE"] as const
export type ProofKind = (typeof PROOF_KINDS)[number]

/**
 * The complete set of things a proof's status can be.
 *
 * `NOT_HELD` is an asserted negative — a source that looked and found no such
 * certificate — and is deliberately distinguishable from no assertion at all,
 * which is `MISSING` in the outcome below. §2.2 keeps "explicitly false" and
 * "not supplied" apart; collapsing them is how "the registry is down" becomes
 * "this person is untrained".
 */
export const PROOF_STATUSES = [
  "VALID",
  "PENDING",
  "SUSPENDED",
  "EXPIRED",
  "REVOKED",
  "NOT_HELD",
] as const
export type ProofStatus = (typeof PROOF_STATUSES)[number]

/** Where a proof applies. Absent fields mean the source did not say. */
export interface ProofScope {
  orgUnitId?: string
  jurisdiction?: string
  site?: string
}

export interface ProofAssertion {
  kind: ProofKind
  /** Stable id of the qualification, e.g. `training.forklift` — never a document. */
  proofId: string
  status: ProofStatus
  sourceId: string
  sourceRole: SourceRole
  /** ISO instant the source last asserted this. Freshness is measured from here. */
  observedAt: string
  /** ISO instant the qualification itself starts, if the source said. */
  validFrom?: string
  /** ISO instant it lapses, or null for open-ended, if the source said. */
  validUntil?: string | null
  scope?: ProofScope
}

export interface ProofRequirement {
  kind: ProofKind
  proofId: string
  /** An allow-list. Never "anything but revoked". */
  acceptedStatuses: readonly ProofStatus[]
  acceptedSourceRoles: readonly SourceRole[]
  /** Maximum age of the ASSERTION, in milliseconds. */
  maxAgeMs: number
  /**
   * The scope the proof must cover for this target.
   *
   * Every field present here must be matched by the assertion. An empty object
   * means the requirement is tenant-wide and any scope satisfies it — which is
   * a decision the author makes by writing `{}`, not one they fall into by
   * leaving the field off.
   */
  scope: ProofScope
}

/**
 * Why a proof did or did not satisfy a requirement.
 *
 * Every value is a distinct remediation. "Your certificate is for the wrong
 * site" and "we have not heard from the registry since March" are the same
 * denial and completely different things for a person to do next.
 */
export const PROOF_OUTCOMES = [
  "SATISFIED",
  /** No source asserted this proof at all — we could not look. */
  "MISSING",
  /** Asserted, but by a source role this requirement does not accept. */
  "UNTRUSTED_SOURCE",
  /** Asserted by an accepted source, but too long ago to decide with. */
  "STALE_ASSERTION",
  /** Asserted and fresh, but the status is not one this requirement accepts. */
  "STATUS_NOT_ACCEPTED",
  /** Accepted status, but the qualification's own window has not opened. */
  "NOT_YET_VALID",
  /** Accepted status, but the qualification's own window has closed. */
  "LAPSED",
  /** Valid everywhere it applies — and this is not one of those places. */
  "OUT_OF_SCOPE",
] as const
export type ProofOutcome = (typeof PROOF_OUTCOMES)[number]

export interface ProofCheck {
  proofId: string
  outcome: ProofOutcome
  satisfied: boolean
  /** Safe, stable, and free of any value the source asserted. */
  code: string
}

function scopeCovers(required: ProofScope, held: ProofScope | undefined): boolean {
  const fields: (keyof ProofScope)[] = ["orgUnitId", "jurisdiction", "site"]
  for (const field of fields) {
    const want = required[field]
    if (want === undefined) continue
    // No scope asserted cannot satisfy a scoped requirement. "We could not tell
    // where this applies" is not "everywhere".
    if (!held || held[field] !== want) return false
  }
  return true
}

/**
 * Decide one requirement against everything asserted about it.
 *
 * The order is deliberate and each step can only refuse: an assertion from a
 * source this requirement does not accept is never read, so it cannot make a
 * stale one look fresh or a revoked one look valid. Among assertions that pass
 * the source gate, the most recently observed is used — not the most
 * favourable, which is how "pick whichever one says VALID" gets written.
 */
export function checkProof(
  requirement: ProofRequirement,
  assertions: readonly ProofAssertion[],
  now: Date,
): ProofCheck {
  const code = `${requirement.kind}:${requirement.proofId}`
  const forThisProof = assertions.filter(
    (a) => a.proofId === requirement.proofId && a.kind === requirement.kind,
  )
  if (forThisProof.length === 0) {
    return { proofId: requirement.proofId, outcome: "MISSING", satisfied: false, code: `MISSING:${code}` }
  }

  const trusted = forThisProof.filter((a) => requirement.acceptedSourceRoles.includes(a.sourceRole))
  if (trusted.length === 0) {
    return {
      proofId: requirement.proofId,
      outcome: "UNTRUSTED_SOURCE",
      satisfied: false,
      code: `UNTRUSTED_SOURCE:${code}`,
    }
  }

  const at = now.getTime()
  const newest = trusted.reduce((best, a) =>
    Date.parse(a.observedAt) > Date.parse(best.observedAt) ? a : best,
  )
  const observedAt = Date.parse(newest.observedAt)
  // An unparseable observation instant is stale, not fresh: a date nobody can
  // read is a date nobody can vouch for.
  if (Number.isNaN(observedAt) || at - observedAt > requirement.maxAgeMs) {
    return {
      proofId: requirement.proofId,
      outcome: "STALE_ASSERTION",
      satisfied: false,
      code: `STALE_ASSERTION:${code}`,
    }
  }

  if (!requirement.acceptedStatuses.includes(newest.status)) {
    return {
      proofId: requirement.proofId,
      outcome: "STATUS_NOT_ACCEPTED",
      satisfied: false,
      code: `STATUS_NOT_ACCEPTED:${code}`,
    }
  }

  if (newest.validFrom !== undefined) {
    const from = Date.parse(newest.validFrom)
    if (Number.isNaN(from) || at < from) {
      return {
        proofId: requirement.proofId,
        outcome: "NOT_YET_VALID",
        satisfied: false,
        code: `NOT_YET_VALID:${code}`,
      }
    }
  }
  if (newest.validUntil !== undefined && newest.validUntil !== null) {
    const until = Date.parse(newest.validUntil)
    if (Number.isNaN(until) || at >= until) {
      return { proofId: requirement.proofId, outcome: "LAPSED", satisfied: false, code: `LAPSED:${code}` }
    }
  }

  if (!scopeCovers(requirement.scope, newest.scope)) {
    return {
      proofId: requirement.proofId,
      outcome: "OUT_OF_SCOPE",
      satisfied: false,
      code: `OUT_OF_SCOPE:${code}`,
    }
  }

  return { proofId: requirement.proofId, outcome: "SATISFIED", satisfied: true, code: `SATISFIED:${code}` }
}

/**
 * Every requirement, checked. All must be satisfied.
 *
 * Returns each check rather than a boolean so a person can be told all of what
 * is missing at once instead of one item per attempt.
 */
export function checkProofs(
  requirements: readonly ProofRequirement[],
  assertions: readonly ProofAssertion[],
  now: Date,
): { satisfied: boolean; checks: readonly ProofCheck[] } {
  const checks = requirements.map((r) => checkProof(r, assertions, now))
  return { satisfied: checks.every((c) => c.satisfied), checks }
}

/**
 * Narrow a requirement to the target it is being applied at.
 *
 * A requirement authored once for a workflow is applied at whichever org unit,
 * jurisdiction or site the target names — so the same "current safety
 * training" rule cannot be satisfied at site B by a certificate for site A
 * without anybody re-authoring it per site.
 */
export function requirementAtTarget(
  requirement: ProofRequirement,
  target: EligibilityTarget,
): ProofRequirement {
  const scope: ProofScope = { ...requirement.scope }
  if (target.orgUnitId !== undefined) scope.orgUnitId = target.orgUnitId
  if (target.jurisdiction !== undefined) scope.jurisdiction = target.jurisdiction
  return { ...requirement, scope }
}
