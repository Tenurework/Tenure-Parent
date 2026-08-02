/**
 * GE-033-003 — just-in-time support sessions.
 *
 * GE-033-002 established that the operator plane has no *default* raw content
 * access. This is the mechanism that legitimises the exception, and Bible §14.6
 * names every part of it:
 *
 *   > Support access requires a tenant-approved or incident-policy request,
 *   > ticket/reason, narrow scope, time limit, step-up MFA, visible banner,
 *   > audit, and automatic revocation. Impersonation never silently becomes the
 *   > customer; actions record both operator and represented actor.
 *
 * Nine requirements, and the failure mode of each is the same: a support
 * mechanism that is slightly too convenient becomes the way operators work,
 * and then "default no access" is a sentence in a document rather than a
 * property of the system.
 *
 * ## Revocation is computed, never scheduled
 *
 * `isActive` derives liveness from the clock every time it is asked. A session
 * that expires because a job runs is a session that stays live when the job
 * does not — and the window where that matters is exactly an incident, when the
 * job queue is the thing that broke. Nothing here needs a sweeper to be correct;
 * a sweeper would only tidy storage.
 *
 * ## Dual attribution has no single-actor form
 *
 * There is no function returning "the actor". `attributionFor` returns both the
 * operator and the represented party, always, because the only way an audit
 * trail loses the operator is if some call site was able to ask for one name.
 */

export const SUPPORT_BASES = ["tenant-approved", "incident-policy"] as const
export type SupportBasis = (typeof SUPPORT_BASES)[number]

/** The longest a support session may last, whatever was asked for. */
export const MAX_DURATION_HOURS = 8

/** How recently step-up must have happened for the session to be usable. */
export const STEP_UP_FRESHNESS_MINUTES = 30

export interface SupportSession {
  id: string
  tenantId: string
  /** The Tenure operator. Never replaced by the represented party. */
  operator: string
  /** Whose data is being reached. Recorded even when the operator acts as themselves. */
  representing: string
  basis: SupportBasis
  /** The ticket this traces to. Required — "an operator asked" is not a reason. */
  ticket: string
  reason: string
  /**
   * Exactly what may be reached. Resource identifiers, never a pattern.
   *
   * A wildcard scope is the whole mechanism defeated: it converts a reviewed,
   * time-boxed, attributed grant into ordinary access with paperwork.
   */
  scope: readonly string[]
  grantedAt: string
  expiresAt: string
  /** When step-up MFA was last completed. Null means it never was. */
  steppedUpAt: string | null
  /** Set when an operator or the tenant ends it early. */
  revokedAt: string | null
}

export interface SessionProblem {
  field: string
  detail: string
}

/**
 * Whether a session was validly granted.
 *
 * Separate from `isActive`, which asks whether it is usable *now*. A session can
 * be perfectly well-formed and expired; conflating the two would mean a
 * malformed session looked merely stale, and the fix for those is different.
 */
export function validateSession(session: SupportSession, at: Date): readonly SessionProblem[] {
  const problems: SessionProblem[] = []

  if (!(SUPPORT_BASES as readonly string[]).includes(session.basis)) {
    problems.push({
      field: "basis",
      detail: `"${session.basis}" is not a basis. Support access is either tenant-approved or taken under incident policy; there is no third way in.`,
    })
  }

  if (!session.ticket.trim()) {
    problems.push({ field: "ticket", detail: "No ticket. An access with nothing to trace to is an access nobody can review." })
  }
  if (session.reason.trim().length < 12) {
    problems.push({ field: "reason", detail: "A reason short enough to be a placeholder is one nobody can audit against." })
  }

  if (session.scope.length === 0) {
    problems.push({ field: "scope", detail: "An empty scope reaches nothing; state what is needed." })
  }
  for (const resource of session.scope) {
    if (resource === "*" || resource.includes("*")) {
      problems.push({
        field: "scope",
        detail: `"${resource}" is a pattern. A wildcard converts a reviewed, time-boxed grant into ordinary access with paperwork.`,
      })
    }
  }

  if (!session.operator.trim()) problems.push({ field: "operator", detail: "No operator recorded." })
  if (!session.representing.trim()) {
    problems.push({
      field: "representing",
      detail: "No represented party. Impersonation never silently becomes the customer, so both names are required.",
    })
  }

  const granted = Date.parse(session.grantedAt)
  const expires = Date.parse(session.expiresAt)
  if (Number.isNaN(granted)) problems.push({ field: "grantedAt", detail: "Not a time." })
  if (Number.isNaN(expires)) {
    problems.push({ field: "expiresAt", detail: "No expiry. A support session with no end is standing access." })
  } else if (!Number.isNaN(granted)) {
    if (expires <= granted) {
      problems.push({ field: "expiresAt", detail: "Expires before it starts." })
    } else {
      const hours = (expires - granted) / 3_600_000
      if (hours > MAX_DURATION_HOURS) {
        problems.push({
          field: "expiresAt",
          detail: `${hours.toFixed(1)} hours exceeds the ${MAX_DURATION_HOURS}-hour maximum. A longer investigation is a new request, reviewed again.`,
        })
      }
    }
  }

  void at
  return problems
}

export type InactiveReason =
  | "MALFORMED"
  | "REVOKED"
  | "EXPIRED"
  | "NOT_YET_GRANTED"
  | "STEP_UP_MISSING"
  | "STEP_UP_STALE"

export interface Liveness {
  active: boolean
  reason: InactiveReason | null
}

/**
 * Whether a session may be used at this instant.
 *
 * Every reason is distinct and reported, because they need different actions: a
 * stale step-up is re-authentication, an expiry is a new request, and a
 * revocation is a conversation.
 */
export function isActive(session: SupportSession, at: Date): Liveness {
  if (validateSession(session, at).length > 0) return { active: false, reason: "MALFORMED" }
  if (session.revokedAt !== null) return { active: false, reason: "REVOKED" }

  const now = at.getTime()
  if (now < Date.parse(session.grantedAt)) return { active: false, reason: "NOT_YET_GRANTED" }
  // Computed, not swept. A session that expires when a job runs stays live when
  // the job does not, and that window is exactly an incident.
  if (now >= Date.parse(session.expiresAt)) return { active: false, reason: "EXPIRED" }

  if (session.steppedUpAt === null) return { active: false, reason: "STEP_UP_MISSING" }
  const steppedUp = Date.parse(session.steppedUpAt)
  if (Number.isNaN(steppedUp)) return { active: false, reason: "STEP_UP_MISSING" }
  if (now - steppedUp > STEP_UP_FRESHNESS_MINUTES * 60_000) {
    return { active: false, reason: "STEP_UP_STALE" }
  }

  return { active: true, reason: null }
}

/** Whether an active session reaches a specific resource. */
export function permits(session: SupportSession, resource: string, at: Date): boolean {
  if (!isActive(session, at).active) return false
  // Exact membership. `startsWith` would make "org-1" reach "org-10", which is
  // the kind of near-miss that is invisible in a log.
  return session.scope.includes(resource)
}

export interface Attribution {
  operator: string
  representing: string
  sessionId: string
  ticket: string
}

/**
 * Both names, always.
 *
 * There is deliberately no variant that returns one. Bible §14.6: "Impersonation
 * never silently becomes the customer; actions record both operator and
 * represented actor." The only way an audit record loses the operator is if some
 * call site could ask for a single name, so no such call exists.
 */
export function attributionFor(session: SupportSession): Attribution {
  return {
    operator: session.operator,
    representing: session.representing,
    sessionId: session.id,
    ticket: session.ticket,
  }
}

export interface SessionBanner {
  /** Always true while a session is live. The UI has no branch that hides it. */
  visible: true
  text: string
  /** Minutes remaining, so the banner counts down rather than merely existing. */
  minutesRemaining: number
}

/**
 * What the tenant's interface must display while support access is live.
 *
 * Returns null only when there is nothing to announce. `visible` is the literal
 * `true` rather than a boolean, so a caller cannot render a banner object with
 * the flag turned off — the type makes the hidden-banner state unwritable.
 */
export function bannerFor(session: SupportSession, at: Date): SessionBanner | null {
  if (!isActive(session, at).active) return null
  const minutesRemaining = Math.max(0, Math.ceil((Date.parse(session.expiresAt) - at.getTime()) / 60_000))
  return {
    visible: true,
    text:
      `${session.operator} from Tenure support is viewing this organisation on ticket ${session.ticket}. ` +
      `Access ends in ${minutesRemaining} minute${minutesRemaining === 1 ? "" : "s"}.`,
    minutesRemaining,
  }
}

export interface SupportAuditEntry {
  sessionId: string
  tenantId: string
  operator: string
  representing: string
  ticket: string
  basis: SupportBasis
  action: string
  resource: string
  at: string
  /** Whether the access was permitted, so refusals are recorded too. */
  outcome: "ALLOW" | "DENY"
  reason: InactiveReason | "OUT_OF_SCOPE" | null
}

/**
 * The record of one attempted access under a session.
 *
 * Refusals are recorded as well as grants. An audit trail containing only
 * successful reads cannot answer "did anyone try", which is the question asked
 * after an incident.
 */
export function auditAccess(
  session: SupportSession,
  action: string,
  resource: string,
  at: Date,
): SupportAuditEntry {
  const liveness = isActive(session, at)
  const inScope = session.scope.includes(resource)
  const allowed = liveness.active && inScope

  return {
    sessionId: session.id,
    tenantId: session.tenantId,
    operator: session.operator,
    representing: session.representing,
    ticket: session.ticket,
    basis: session.basis,
    action,
    resource,
    at: at.toISOString(),
    outcome: allowed ? "ALLOW" : "DENY",
    reason: allowed ? null : (liveness.reason ?? "OUT_OF_SCOPE"),
  }
}
