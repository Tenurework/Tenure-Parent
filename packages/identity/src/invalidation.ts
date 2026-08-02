import type { AuthSession, ExternalIdentity, TenantMembership } from "./entities"
import { identityLiveness, membershipLiveness, sessionLiveness } from "./effective-state"
import { seatState, type SeatAssignment } from "./seats"

/**
 * GE-040-005 — access stops when the decision is made, not when the token expires.
 *
 * > Implement immediate access invalidation on membership suspension, identity
 * > connection disable, session revoke, assignment end, or authorization
 * > revision change.
 *
 * Five triggers, and only one of them is a clock event. The other four are
 * somebody *deciding* something, which is why "immediate" is the hard word in
 * that sentence: a session minted an hour ago carries a snapshot of authority
 * that was true when it was minted, and every one of these triggers makes that
 * snapshot wrong while the token itself remains perfectly valid.
 *
 * ## The mechanism is re-evaluation, not revocation lists
 *
 * There is no allowlist here, no cache to invalidate and no fan-out to
 * publish. `evaluateSession` recomputes the answer from current state on every
 * ask, and the whole of "immediate" falls out of that: a membership suspended
 * at 14:03 stops granting at 14:03 because the 14:04 request asks again.
 *
 * The alternative — a revocation list, or a session store marked dirty — is
 * where this usually goes wrong, because it has to be *published* to be true.
 * Whatever publishes it is a job, a queue or a cache TTL, and the window in
 * which it has not published yet is exactly the window somebody is trying to
 * use. Bible §9.1 requires cookies "backed by server-side revocation"; server-
 * side is where this runs, and recomputing is the strongest form of it.
 *
 * ## An ended assignment is not a dead session
 *
 * The five triggers do not all mean the same thing, and collapsing them would
 * be wrong in both directions. A revoked session, a suspended membership and a
 * disabled connection all mean *this person cannot act here at all*. An ended
 * assignment means one seat's authority is gone while the person remains a
 * legitimate member — logging them out would be punishing them for a term
 * ending on schedule. An authorization revision change means the *snapshot* is
 * stale, not that anything was taken away; the answer is to re-resolve, not to
 * sign anybody out.
 *
 * So the outcome distinguishes them: `valid: false` ends the session, and
 * `staleAuthority` says the session lives on but nothing it cached may be
 * believed.
 */

export type InvalidationTrigger =
  | "SESSION_REVOKED"
  | "SESSION_EXPIRED"
  | "MEMBERSHIP_SUSPENDED"
  | "MEMBERSHIP_ENDED"
  | "CONNECTION_DISABLED"
  | "CREDENTIAL_UNLINKED"

export interface SessionInvalid {
  valid: false
  trigger: InvalidationTrigger
  detail: string
}

export interface SessionValid {
  valid: true
  /**
   * True when the authority resolved under this session can no longer be
   * believed — the tenant's authorization revision moved, or a seat's term
   * ended. The session survives; anything derived from it must be recomputed.
   */
  staleAuthority: boolean
  /** Which of the two made it stale, for the log. Null when nothing did. */
  staleReason: "AUTHORIZATION_REVISION_CHANGED" | "ASSIGNMENT_ENDED" | null
  /** Seats that still grant something. Recomputed, never read from the token. */
  liveSeatIds: readonly string[]
}

export type SessionEvaluation = SessionValid | SessionInvalid

/**
 * Everything needed to decide, read fresh.
 *
 * Taken as a parameter rather than fetched, so this stays pure and so the
 * caller cannot accidentally hand it something cached — the shape makes the
 * staleness question the caller's, which is where it can actually be answered.
 */
export interface SessionContext {
  /** The membership for this session's tenant, or null if there is none. */
  membership: TenantMembership | null
  /** The credential this session authenticated with, or null if it is gone. */
  identity: ExternalIdentity | null
  /** The connection's current status, from `@tenure/provisioning`. */
  connectionStatus: string | null
  /** The tenant's current authorization revision. */
  authorizationRevision: number
  /** Every seat this person holds in this tenant. */
  seats: readonly SeatAssignment[]
}

/** Connection states that still permit an existing session to continue. */
const CONNECTION_LIVE = new Set(["ACTIVE"])

export function evaluateSession(
  session: AuthSession,
  context: SessionContext,
  at: Date,
): SessionEvaluation {
  // Order matters, and it is deliberate: the most specific and most deliberate
  // act first. A session that was revoked by a person and whose membership also
  // lapsed should report the revocation — somebody did that, and an operator
  // reading the log needs to know which.
  const liveness = sessionLiveness(session, at)
  if (!liveness.live) {
    return liveness.reason === "REVOKED"
      ? {
          valid: false,
          trigger: "SESSION_REVOKED",
          detail: "This session was ended deliberately. Sign in again.",
        }
      : {
          valid: false,
          trigger: "SESSION_EXPIRED",
          detail: "This session has expired. Sign in again.",
        }
  }

  if (context.identity === null) {
    return {
      valid: false,
      trigger: "CREDENTIAL_UNLINKED",
      detail: "The credential this session was created with no longer exists.",
    }
  }
  if (!identityLiveness(context.identity, at).live) {
    return {
      valid: false,
      trigger: "CREDENTIAL_UNLINKED",
      detail: "The credential this session was created with has been unlinked or suspended.",
    }
  }

  // Disabling a connection is how a tenant turns off an entire identity
  // provider — a compromised IdP, a lapsed contract. It has to end the sessions
  // already open through it, or the control does nothing for eight hours.
  if (context.connectionStatus === null || !CONNECTION_LIVE.has(context.connectionStatus)) {
    return {
      valid: false,
      trigger: "CONNECTION_DISABLED",
      detail: "The identity provider this session came through is no longer enabled for this organization.",
    }
  }

  if (context.membership === null) {
    return {
      valid: false,
      trigger: "MEMBERSHIP_ENDED",
      detail: "This account is no longer a member of this organization.",
    }
  }
  const membership = membershipLiveness(context.membership, at)
  if (!membership.live) {
    return membership.reason === "SUSPENDED"
      ? {
          valid: false,
          trigger: "MEMBERSHIP_SUSPENDED",
          detail: "This account is suspended in this organization.",
        }
      : {
          valid: false,
          trigger: "MEMBERSHIP_ENDED",
          detail: "This account's membership of this organization has ended.",
        }
  }

  // Past here the session stands. What it may *do* is recomputed.
  const liveSeatIds = context.seats
    .filter((seat) => seat.personId === session.personId && seatState(seat, at).liveness.live)
    .map((seat) => seat.id)
    .sort()

  const revisionMoved = context.authorizationRevision !== session.authorizationRevision
  // An assignment that ended is only *news* if the session was created while it
  // was live. Comparing counts would report a seat granted after sign-in as an
  // ending, which is the opposite of what happened.
  const seatEnded = context.seats.some(
    (seat) =>
      seat.personId === session.personId &&
      !seatState(seat, at).liveness.live &&
      Date.parse(seat.interval.effectiveUntil ?? "") > Date.parse(session.issuedAt),
  )

  return {
    valid: true,
    staleAuthority: revisionMoved || seatEnded,
    staleReason: revisionMoved ? "AUTHORIZATION_REVISION_CHANGED" : seatEnded ? "ASSIGNMENT_ENDED" : null,
    liveSeatIds,
  }
}

/**
 * Sessions a change invalidates, for the audit record that accompanies it.
 *
 * Not for enforcement — `evaluateSession` is what enforces, on every request,
 * and this returning an empty list would not grant anybody anything. This
 * answers the reporting question an operator asks immediately after suspending
 * somebody: *what did that just do?* A control whose effect nobody can see is
 * one nobody trusts, and the usual failure is that the answer is only knowable
 * by waiting to see who complains.
 */
export function sessionsEndedBy(
  sessions: readonly AuthSession[],
  context: (session: AuthSession) => SessionContext,
  at: Date,
): readonly { sessionId: string; personId: string; trigger: InvalidationTrigger }[] {
  return sessions
    .map((session) => ({ session, evaluation: evaluateSession(session, context(session), at) }))
    .filter(({ evaluation }) => !evaluation.valid)
    .map(({ session, evaluation }) => ({
      sessionId: session.id,
      personId: session.personId,
      trigger: (evaluation as SessionInvalid).trigger,
    }))
    .sort((left, right) => (left.sessionId < right.sessionId ? -1 : 1))
}
