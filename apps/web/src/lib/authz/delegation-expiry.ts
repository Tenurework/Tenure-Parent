/**
 * PAY-150-008 — a delegation that nobody ever revoked is not a permanent one.
 *
 * Bible §17 requires "Delegation with scope, reason and expiry". Two of the
 * three were absent from the model and the third from the code:
 * `ApprovalDelegation` carries `note` (the reason), `createdAt` and `revokedAt`,
 * and nothing else — no scope, no end date — and `effectiveApprovalContext`
 * filtered on `revokedAt: null` alone. So the authority a president lent a
 * committee member for one week in September was still being lent in June,
 * silently, and the only thing that could end it was somebody remembering to.
 *
 * A per-grant expiry date is a schema change and is NOT what this is. What this
 * is, is the control that can exist against the schema as it stands: a MAXIMUM
 * LIFETIME. A delegation older than the maximum lends nothing, whatever its
 * `revokedAt` says. The person who granted it can grant it again — which is the
 * point, because re-granting is a decision somebody makes on purpose, in the
 * present, with the reason they have now.
 *
 * The honest limit, stated so it is not mistaken for the full control: this
 * cannot express "until 30 September", it cannot express "for reimbursements
 * only", and until `ApprovalDelegation` carries `startsAt`, `expiresAt` and a
 * scope, neither can anything else.
 */

/**
 * How long a delegation lends authority for, at most.
 *
 * Thirty days rather than a term or a year. A delegation is what somebody sets
 * up before going away, and the reason for it — a trip, an exam period, an
 * illness — is measured in days or weeks. A lifetime longer than the reasons
 * people have for granting them is a standing key with a friendly name.
 */
export const DELEGATION_MAX_LIFETIME_DAYS = 30

const DAY_MS = 86_400_000

export interface DelegationRecord {
  /** When the delegation was granted. */
  createdAt: Date | string
  /** When it was explicitly withdrawn, if it was. */
  revokedAt: Date | string | null
}

export type DelegationRefusal = "REVOKED" | "EXPIRED" | "UNDATED" | "NOT_YET_GRANTED"

export interface DelegationStanding {
  live: boolean
  refusal: DelegationRefusal | null
  /** The sentence a person is shown, and the audit row records. */
  detail: string | null
  /** When it stops lending authority, whatever happens. */
  expiresAt: string | null
}

function instant(value: Date | string | null): number | null {
  if (value === null) return null
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * Does this delegation still lend authority at `at`?
 *
 * Fails closed on a row it cannot date. A delegation whose `createdAt` will not
 * parse has no measurable age, and "we cannot tell how old this grant of
 * authority is" must not resolve to "young enough".
 */
export function delegationStanding(
  delegation: DelegationRecord,
  at: Date = new Date(),
  maxLifetimeDays: number = DELEGATION_MAX_LIFETIME_DAYS,
): DelegationStanding {
  const granted = instant(delegation.createdAt)
  const now = at.getTime()

  if (granted === null) {
    return {
      live: false,
      refusal: "UNDATED",
      detail:
        "This delegation has no readable grant date, so its age cannot be measured. An " +
        "undatable grant of authority is refused rather than assumed to be recent.",
      expiresAt: null,
    }
  }

  const expiresAt = new Date(granted + maxLifetimeDays * DAY_MS).toISOString()

  const revoked = instant(delegation.revokedAt)
  if (delegation.revokedAt !== null && revoked === null) {
    return {
      live: false,
      refusal: "UNDATED",
      detail:
        "This delegation records a withdrawal with no readable date. A withdrawal nobody can " +
        "date is still a withdrawal.",
      expiresAt,
    }
  }
  if (revoked !== null && revoked <= now) {
    return {
      live: false,
      refusal: "REVOKED",
      detail: "This delegation was withdrawn.",
      expiresAt,
    }
  }

  if (granted > now) {
    return {
      live: false,
      refusal: "NOT_YET_GRANTED",
      detail:
        "This delegation is dated in the future. Authority does not begin before the grant that " +
        "confers it.",
      expiresAt,
    }
  }

  const ageDays = (now - granted) / DAY_MS
  if (ageDays > maxLifetimeDays) {
    return {
      live: false,
      refusal: "EXPIRED",
      detail:
        `This delegation was granted ${Math.floor(ageDays)} days ago and delegated authority ` +
        `lasts at most ${maxLifetimeDays} days. Ask for it again if it is still needed — a grant ` +
        `nobody has renewed is one nobody has re-decided.`,
      expiresAt,
    }
  }

  return { live: true, refusal: null, detail: null, expiresAt }
}

/** The live subset, in input order. */
export function liveDelegations<T extends DelegationRecord>(
  delegations: readonly T[],
  at: Date = new Date(),
  maxLifetimeDays: number = DELEGATION_MAX_LIFETIME_DAYS,
): T[] {
  return delegations.filter((d) => delegationStanding(d, at, maxLifetimeDays).live)
}
