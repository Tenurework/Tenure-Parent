import type {
  AuthSession,
  EffectiveInterval,
  ExternalIdentity,
  Invitation,
  LifecycleStatus,
  Person,
  RecoveryMethod,
  TenantMembership,
} from "./entities"

/**
 * GE-040-001 — "with effective state".
 *
 * Every entity's liveness is derived from the clock on each ask. Nothing stores
 * an `isActive` flag, and nothing depends on a sweeper having run.
 *
 * The reason is not purity. A stored flag is a second source of truth, and the
 * window in which it is wrong is precisely the window that matters: a
 * membership that ended at midnight and still reads active at 09:00 because the
 * nightly job failed is access nobody granted, and it looks identical to access
 * somebody did. A sweeper can tidy storage; it must never be what makes a
 * revocation true.
 *
 * ## Every "no" is a different no
 *
 * `NotLive` names which condition failed. They need different actions — an
 * expiry is a renewal, a suspension is a conversation, a not-yet-started
 * membership is a scheduling question — and an interface that answers only
 * `false` forces the caller to re-derive the reason or, more often, to show
 * "access denied" and leave the person to guess.
 */

export type NotLiveReason =
  | "SUSPENDED"
  | "REVOKED"
  | "NOT_YET_EFFECTIVE"
  | "EXPIRED"
  | "MALFORMED"
  | "SUPERSEDED"
  | "UNVERIFIED"
  | "ALREADY_ACCEPTED"

export interface Live {
  live: true
}

export interface NotLive {
  live: false
  reason: NotLiveReason
  /** What a person can do about it, in the words they need. */
  detail: string
}

export type Liveness = Live | NotLive

const LIVE: Live = { live: true }

function notLive(reason: NotLiveReason, detail: string): NotLive {
  return { live: false, reason, detail }
}

/**
 * Whether a status and a window are live at an instant.
 *
 * Status is checked before the window, deliberately. A revoked membership whose
 * window also happens to have ended should report REVOKED — somebody acted, and
 * that is the more useful fact. Reporting EXPIRED would make a deliberate
 * removal look like ordinary lapse.
 */
export function intervalLiveness(
  status: LifecycleStatus,
  interval: EffectiveInterval,
  at: Date,
): Liveness {
  if (status === "REVOKED") {
    return notLive("REVOKED", "This was revoked. Reinstating it is a new grant, not a reactivation.")
  }
  if (status === "SUSPENDED") {
    return notLive("SUSPENDED", "This is suspended. It can be lifted by whoever suspended it, without a new grant.")
  }

  const from = Date.parse(interval.effectiveFrom)
  if (Number.isNaN(from)) return notLive("MALFORMED", "The start of the validity window is not a time.")

  const now = at.getTime()
  if (now < from) {
    return notLive("NOT_YET_EFFECTIVE", `This does not start until ${interval.effectiveFrom}.`)
  }

  if (interval.effectiveUntil !== null) {
    const until = Date.parse(interval.effectiveUntil)
    if (Number.isNaN(until)) return notLive("MALFORMED", "The end of the validity window is not a time.")
    // Exclusive: an interval ending at 17:00 is not live at 17:00. Half-open
    // intervals compose — one ending exactly where the next begins leaves no
    // gap and no overlap, which is what an effective-dated handover needs.
    if (now >= until) return notLive("EXPIRED", `This ended at ${interval.effectiveUntil}.`)
  }

  return LIVE
}

export function personLiveness(person: Person, at: Date): Liveness {
  void at
  if (person.mergedIntoPersonId !== null) {
    return notLive(
      "SUPERSEDED",
      `This person record was merged into ${person.mergedIntoPersonId}. It is kept so older references still resolve, but it is not the live record.`,
    )
  }
  if (person.status === "REVOKED") return notLive("REVOKED", "This person record was revoked.")
  if (person.status === "SUSPENDED") return notLive("SUSPENDED", "This person is suspended platform-wide.")
  return LIVE
}

/**
 * Whether a membership grants anything right now.
 *
 * This is the function the rest of the platform should ask. `status === ACTIVE`
 * is not the same question and never has been: it ignores the window, which is
 * the whole reason the window exists.
 */
export function membershipLiveness(membership: TenantMembership, at: Date): Liveness {
  return intervalLiveness(membership.status, membership.interval, at)
}

export function identityLiveness(identity: ExternalIdentity, at: Date): Liveness {
  void at
  if (identity.status === "REVOKED") {
    return notLive("REVOKED", "This credential was unlinked. Signing in with it again requires linking it again.")
  }
  if (identity.status === "SUSPENDED") {
    return notLive("SUSPENDED", "This credential is suspended.")
  }
  return LIVE
}

export function invitationLiveness(invitation: Invitation, at: Date): Liveness {
  if (invitation.status === "REVOKED") return notLive("REVOKED", "This invitation was withdrawn.")
  if (invitation.status === "ACCEPTED") {
    return notLive(
      "ALREADY_ACCEPTED",
      "This invitation has already been accepted. An invitation is single-use; a second person cannot arrive on it.",
    )
  }

  const expires = Date.parse(invitation.expiresAt)
  if (Number.isNaN(expires)) return notLive("MALFORMED", "The invitation has no valid expiry.")
  // Computed, never a stored EXPIRED status. An invitation nobody swept must
  // not stay acceptable, and a sweeper is not what makes an expiry true.
  if (at.getTime() >= expires) {
    return notLive("EXPIRED", `This invitation expired at ${invitation.expiresAt}. Ask for a new one.`)
  }

  return LIVE
}

export function sessionLiveness(session: AuthSession, at: Date): Liveness {
  if (session.revokedAt !== null) {
    return notLive("REVOKED", "This session was ended deliberately. Sign in again.")
  }
  return intervalLiveness("ACTIVE", { effectiveFrom: session.issuedAt, effectiveUntil: session.expiresAt }, at)
}

/**
 * Whether a recovery method may actually be used.
 *
 * An unverified method is not a recovery path. It is an address somebody typed,
 * and treating it as one is how an account is "recoverable" through a mailbox
 * the person cannot read — or worse, one somebody else can.
 */
export function recoveryLiveness(method: RecoveryMethod, at: Date): Liveness {
  void at
  if (method.status === "REVOKED") return notLive("REVOKED", "This recovery method was removed.")
  if (method.status === "SUSPENDED") return notLive("SUSPENDED", "This recovery method is suspended.")
  if (method.verifiedAt === null) {
    return notLive(
      "UNVERIFIED",
      "This recovery method was never verified, so it does not count as a way back in. Verify it first.",
    )
  }
  return LIVE
}

/** The live members of a tenant at an instant. */
export function liveMemberships(
  memberships: readonly TenantMembership[],
  at: Date,
): readonly TenantMembership[] {
  return memberships.filter((membership) => membershipLiveness(membership, at).live)
}

/**
 * How many verified recovery paths a person has left.
 *
 * GE-040-004 forbids unlinking the last one, and this is the count that rule
 * needs. Unverified methods are excluded for the reason above — counting them
 * would let a person satisfy the floor with an address nobody has ever proved
 * they control.
 */
export function usableRecoveryCount(methods: readonly RecoveryMethod[], at: Date): number {
  return methods.filter((method) => recoveryLiveness(method, at).live).length
}

export type AccessState =
  /** Has a live membership somewhere. */
  | "ACTIVE"
  /** Never had one. A genuinely new account, and the onboarding case. */
  | "NEVER_PLACED"
  /** Every membership was suspended. Liftable by whoever suspended it. */
  | "SUSPENDED"
  /** Every membership was revoked. A new grant is needed. */
  | "REVOKED"
  /** Every membership's term has ended. */
  | "ENDED"
  /** A membership exists but has not started yet. */
  | "NOT_YET_STARTED"

export interface AccessReport {
  state: AccessState
  /** What to tell the person. Different states need different sentences. */
  detail: string
  /**
   * True when waiting is the whole obstacle.
   *
   * Only `NOT_YET_STARTED` qualifies: the date arrives and access begins with
   * nobody doing anything. Every other blocked state needs a person to act —
   * an invitation, a lifted suspension, a renewed term, a fresh grant — so the
   * call to action is "go and ask somebody" rather than "check back".
   *
   * Deliberately not `selfResolvable`, which would be false in every state and
   * therefore carry no information at all: nothing here is resolvable by the
   * person reading it.
   */
  waitingOnTheClock: boolean
}

/**
 * Why somebody has no access, when they have none.
 *
 * GE-042-006 asks `/me` to report "expired/revoked/disabled states", and
 * GE-040-001 is what made them distinguishable: before memberships were
 * effective-dated a revoked person had no row at all, so "no membership" and
 * "membership ended" were the same fact. They are not the same fact to the
 * person.
 *
 * The failure this prevents is small and real. A suspended director opens the
 * application and sees the onboarding path a brand-new account sees — *welcome,
 * let's get you started* — when the truth is that somebody suspended them an
 * hour ago and they should go and ask why. Collapsing every reason into `null`
 * is not a neutral simplification; it tells one specific lie to the person
 * least able to work out that it is one.
 *
 * ## Precedence, when several memberships disagree
 *
 * Any live membership wins: ACTIVE. Otherwise the most *actionable* state wins,
 * because the report exists to tell somebody what to do — a person suspended at
 * one tenant and revoked at another should hear about the suspension, which
 * somebody can lift, rather than the revocation, which needs a new grant.
 */
export function accessState(memberships: readonly TenantMembership[], at: Date): AccessReport {
  if (memberships.length === 0) {
    return {
      state: "NEVER_PLACED",
      detail: "This account is not a member of any organization yet.",
      waitingOnTheClock: false,
    }
  }

  if (memberships.some((membership) => membershipLiveness(membership, at).live)) {
    return { state: "ACTIVE", detail: "", waitingOnTheClock: false }
  }

  const reasons = new Set(
    memberships.map((membership) => {
      const state = membershipLiveness(membership, at)
      return state.live ? "LIVE" : state.reason
    }),
  )

  // Most actionable first. A person suspended somewhere and revoked elsewhere
  // should hear about the suspension.
  if (reasons.has("NOT_YET_EFFECTIVE")) {
    return {
      state: "NOT_YET_STARTED",
      detail: "Access to this organization has not started yet. It will begin on the date you were given.",
      waitingOnTheClock: true,
    }
  }
  if (reasons.has("SUSPENDED")) {
    return {
      state: "SUSPENDED",
      detail: "Access to this organization is suspended. Whoever suspended it can lift it.",
      waitingOnTheClock: false,
    }
  }
  if (reasons.has("EXPIRED")) {
    return {
      state: "ENDED",
      detail: "Membership of this organization has ended. Ask an administrator if it should be renewed.",
      waitingOnTheClock: false,
    }
  }
  if (reasons.has("REVOKED")) {
    return {
      state: "REVOKED",
      detail: "Access to this organization has been removed. An administrator would need to grant it again.",
      waitingOnTheClock: false,
    }
  }

  // A membership that is neither live nor any recognised not-live reason is
  // malformed data, and saying "no access" without a reason is the honest
  // answer rather than guessing at one.
  return {
    state: "NEVER_PLACED",
    detail: "This account has no usable membership.",
    waitingOnTheClock: false,
  }
}
