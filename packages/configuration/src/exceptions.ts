import type { AuthorityViolation, Invariant } from "./authority"

/**
 * GE-032-004 — the reviewed path for what the guardrails refuse.
 *
 * GE-032-002 made five invariants non-bypassable. This is the other half of the
 * requirement, and getting its scope right is the whole item: an exception
 * mechanism that can excuse anything is not a guardrail with a review process,
 * it is a guardrail with a switch.
 *
 * ## Exactly one of the five is exceptable, and the Bible says which
 *
 * §2.1, on tenant super administrators: they "cannot bypass tenant isolation,
 * mutate the platform's canonical schemas directly, grant themselves Tenure
 * operator access, upload arbitrary privileged backend code, weaken immutable
 * audit, or change the physical deployment topology **outside approved
 * requests**."
 *
 * Five prohibitions, and only the last carries that qualifier. Physical
 * placement can move with an approved request; the other four cannot move at
 * all. `EXCEPTABLE` is that sentence as data, and `NEVER_EXCEPTABLE` carries
 * the clause each is refused by — so a future reader arguing for a sixth
 * exception has to argue with the text rather than with a habit.
 *
 * ## An exception does not make the tenant able to write
 *
 * It records that an operator reviewed a request and published the change
 * themselves. The tenant never acquires the authority; the operator exercises
 * theirs with a justification attached. That distinction is why this cannot be
 * used to hand a tenant administrator a temporary key to their own residency.
 */

export const EXCEPTABLE: ReadonlySet<Invariant> = new Set<Invariant>(["physical-placement"])

/** Why each of the other four can never be excepted, quoting the clause. */
export const NEVER_EXCEPTABLE: Readonly<Record<string, string>> = {
  "operator-access": "§2.1 — a tenant administrator may not 'grant themselves Tenure operator access'. There is no approved-request qualifier on that clause.",
  "audit-integrity": "§2.1 — a tenant administrator may not 'weaken immutable audit'. An audit trail that can be shortened by agreement is not immutable.",
  "core-schemas": "§2.1 — a tenant administrator may not 'mutate the platform's canonical schemas directly'. A schema change is not a configuration change with a note attached.",
  "unrestricted-code-execution": "§2.1 — a tenant administrator may not 'upload arbitrary privileged backend code'. An expression that runs is code, whoever approved it.",
}

export interface GuardrailException {
  id: string
  tenantId: string
  /** Which invariant is being excepted. Only `physical-placement` is permitted. */
  invariant: Invariant
  /** The exact keys this covers. A blanket exception is refused. */
  keys: readonly string[]
  /** Why the tenant needs it, in their words. */
  reason: string
  /** What it is for and how far it reaches, in the operator's terms. */
  scope: string
  requestedBy: string
  /** Null until an operator has decided. */
  approvedBy: string | null
  approvedAt: string | null
  /** ISO instant. Required — an exception with no end is a permanent grant. */
  expiresAt: string
}

export interface ExceptionProblem {
  field: string
  detail: string
}

/**
 * Whether an exception may be relied on, and why not.
 *
 * Every refusal here is one that would otherwise turn the mechanism into a
 * bypass, so they are checked together and reported together rather than one at
 * a time.
 */
export function validateException(
  exception: GuardrailException,
  at: Date,
): readonly ExceptionProblem[] {
  const problems: ExceptionProblem[] = []

  if (!EXCEPTABLE.has(exception.invariant)) {
    problems.push({
      field: "invariant",
      detail:
        NEVER_EXCEPTABLE[exception.invariant] ??
        `"${exception.invariant}" is not an invariant that may be excepted.`,
    })
  }

  if (exception.keys.length === 0) {
    problems.push({
      field: "keys",
      detail:
        "An exception with no keys covers nothing, and an exception that covered everything would be " +
        "a switch rather than a review. Name the keys.",
    })
  }
  for (const key of exception.keys) {
    if (key.includes("*") || key.endsWith(".")) {
      problems.push({
        field: "keys",
        detail: `"${key}" is a pattern. An exception names exact keys, so what it permits can be read.`,
      })
    }
  }

  if (exception.reason.trim().length < 12) {
    problems.push({
      field: "reason",
      detail: "A reason short enough to be a placeholder is one nobody can review or audit against.",
    })
  }
  if (exception.scope.trim().length < 12) {
    problems.push({ field: "scope", detail: "State what this reaches, or an approver is guessing." })
  }

  if (!exception.approvedBy) {
    problems.push({ field: "approvedBy", detail: "Not approved. A request is not an exception." })
  } else if (exception.approvedBy === exception.requestedBy) {
    // The same rule as the publication path, for the same reason: an approval
    // by the requester records a second signature nobody gave.
    problems.push({
      field: "approvedBy",
      detail: `Approved by ${exception.approvedBy}, who requested it. An exception needs a second identity.`,
    })
  }

  const expiry = Date.parse(exception.expiresAt)
  if (Number.isNaN(expiry)) {
    problems.push({ field: "expiresAt", detail: "No expiry. An exception with no end is a permanent grant." })
  } else if (expiry <= at.getTime()) {
    problems.push({
      field: "expiresAt",
      detail: `Expired at ${exception.expiresAt}. An expired exception covers nothing; request a new one.`,
    })
  }

  return problems
}

/** Whether a valid exception covers a specific violation at an instant. */
export function covers(exception: GuardrailException, violation: AuthorityViolation, at: Date): boolean {
  if (validateException(exception, at).length > 0) return false
  if (violation.invariant !== exception.invariant) return false
  // A violation with no key is a whole-layer refusal; an exception names keys,
  // so it cannot cover one.
  return violation.key !== undefined && exception.keys.includes(violation.key)
}

export interface ExceptionOutcome {
  /** Violations no exception covers. These still block. */
  remaining: readonly AuthorityViolation[]
  /** Which exception was relied on for what — the audit trail of the excusing. */
  relied: readonly { exceptionId: string; invariant: Invariant; key: string }[]
}

/**
 * Apply approved exceptions to a set of violations.
 *
 * What is excused is recorded, not merely removed. A publication that proceeded
 * because of an exception must carry which exception and for which key, or the
 * audit trail says a change was clean when it was permitted.
 */
export function applyExceptions(
  violations: readonly AuthorityViolation[],
  exceptions: readonly GuardrailException[],
  at: Date,
): ExceptionOutcome {
  const remaining: AuthorityViolation[] = []
  const relied: { exceptionId: string; invariant: Invariant; key: string }[] = []

  for (const violation of violations) {
    const excusing = exceptions.find((exception) => covers(exception, violation, at))
    if (excusing && violation.key) {
      relied.push({ exceptionId: excusing.id, invariant: excusing.invariant, key: violation.key })
      continue
    }
    remaining.push(violation)
  }

  return { remaining, relied }
}
