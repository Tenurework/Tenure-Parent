/**
 * GE-040-001 — the canonical identity entities.
 *
 * Bible §9.1: "Cognito authenticates and federates. Tenure resolves the person,
 * tenant membership, identity connection, active assignments, policies, and
 * session." Everything here is the Tenure side of that sentence — the durable
 * facts an identity provider does not own and cannot be asked for.
 *
 * ## A person is not a login
 *
 * `Person` carries no credential, no issuer and no subject. It is the durable
 * human the product's thesis is about — the person changes, the seat remembers.
 * Credentials attach to it and are replaced under it. A model that keys a person
 * by their login cannot survive a student graduating to alumni, a staff member
 * moving institutions, or an SSO migration, and every one of those is a Tuesday.
 *
 * ## Email is an attribute, never a key
 *
 * `primaryEmail` exists because people need to be contacted. It is deliberately
 * not unique, not required, and not part of any key — GE-040-002 makes that rule
 * explicit for external identities, and these shapes are what make it holdable.
 * Two people may present the same work address after a departmental mailbox is
 * reassigned, and one person routinely holds several.
 *
 * ## Effective state is computed, never stored
 *
 * No entity carries an `isActive` flag. Each carries a status and a validity
 * window, and `effective-state.ts` derives liveness from the clock on every ask.
 * A stored flag is a second source of truth that a missed job leaves wrong, and
 * the window in which it is wrong is the window that matters: an expired
 * membership still reading active is access nobody granted.
 *
 * `IdentityConnection` is deliberately absent — it already exists in
 * `@tenure/provisioning` (GE-030-003) and belongs to the tenant registry rather
 * than to a person. Duplicating it would give the fleet two answers to "which
 * SAML connection is this".
 */

/** Statuses shared by everything that can be turned off without being erased. */
export const LIFECYCLE_STATUSES = ["ACTIVE", "SUSPENDED", "REVOKED"] as const
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number]

/**
 * A validity window.
 *
 * `effectiveUntil: null` means open-ended, not forever-and-unreviewable — an
 * open-ended grant is still subject to its status. `null` and a far-future date
 * are different facts, and collapsing them loses the difference between "no end
 * was set" and "an end was chosen".
 */
export interface EffectiveInterval {
  effectiveFrom: string
  effectiveUntil: string | null
}

/** The durable human. Holds nothing that can authenticate. */
export interface Person {
  id: string
  displayName: string
  /** Contact, not identity. Not unique, and never used to merge. */
  primaryEmail: string | null
  status: LifecycleStatus
  createdAt: string
  /** Set when merged into another person. The record is kept, not deleted. */
  mergedIntoPersonId: string | null
}

/**
 * One way a person authenticates.
 *
 * Keyed by connection + issuer + subject (GE-040-002), which is why this is a
 * separate entity rather than columns on `Person`. `subject` is the provider's
 * opaque identifier — a Cognito sub, a SAML NameID — and the only stable handle
 * a provider offers. `assertedEmail` is a copy of what the provider last said,
 * kept for display and never for matching.
 */
export interface ExternalIdentity {
  id: string
  personId: string
  /** The tenant's identity connection this arrived through (@tenure/provisioning). */
  connectionId: string
  issuer: string
  subject: string
  assertedEmail: string | null
  /** Whether the provider vouched for that address. An unverified claim is a hint. */
  emailVerified: boolean
  status: LifecycleStatus
  linkedAt: string
  lastAuthenticatedAt: string | null
}

/** Why a person belongs to a tenant. Recorded because it decides deprovisioning. */
export const MEMBERSHIP_ORIGINS = ["INVITATION", "SCIM", "JIT_PROVISIONED", "MIGRATED", "OPERATOR"] as const
export type MembershipOrigin = (typeof MEMBERSHIP_ORIGINS)[number]

/**
 * One person's belonging to one tenant.
 *
 * Effective-dated rather than deleted. A membership that ended is the record
 * that someone *was* here, which is what an audit read a year later needs and
 * what an approval signed by a since-departed treasurer has to resolve against.
 */
export interface TenantMembership {
  id: string
  personId: string
  tenantId: string
  origin: MembershipOrigin
  status: LifecycleStatus
  interval: EffectiveInterval
  /** Required when suspended or revoked. A status change with no reason is unauditable. */
  statusReason: string | null
}

export const INVITATION_STATUSES = ["PENDING", "ACCEPTED", "REVOKED"] as const
export type InvitationStatus = (typeof INVITATION_STATUSES)[number]

/**
 * An offer of membership.
 *
 * Carries the address it was sent to, not a person: an invitation exists before
 * there is anyone to point at, and binding it to a `Person` up front would mean
 * creating people who never accept.
 *
 * There is no `EXPIRED` status, deliberately. Expiry is computed from
 * `expiresAt`; a stored one would mean an invitation nobody swept stays
 * acceptable forever, which is the same class of bug as a stored `isActive`.
 */
export interface Invitation {
  id: string
  tenantId: string
  sentToEmail: string
  invitedBy: string
  status: InvitationStatus
  createdAt: string
  expiresAt: string
  acceptedByPersonId: string | null
}

/**
 * An authenticated session.
 *
 * `revokedAt` is separate from expiry because they answer different questions:
 * an expiry is time passing, a revocation is a decision, and an incident review
 * needs to tell them apart. Both make the session unusable; only one means
 * somebody acted.
 */
export interface AuthSession {
  id: string
  personId: string
  tenantId: string
  /** Which credential authenticated it, so disabling one can end its sessions. */
  externalIdentityId: string
  issuedAt: string
  expiresAt: string
  revokedAt: string | null
  /** When step-up last happened, for high-risk actions (Bible §9.1). */
  steppedUpAt: string | null
  /**
   * The authorization revision this session resolved against.
   *
   * GE-040-005 invalidates a session when authorization changes, and can only
   * do that if the session records which version it was built on.
   */
  authorizationRevision: number
}

export const AUTHENTICATION_OUTCOMES = [
  "SUCCEEDED",
  "FAILED_CREDENTIAL",
  "FAILED_NO_MEMBERSHIP",
  "FAILED_SUSPENDED",
  "FAILED_CONNECTION_DISABLED",
  "STEP_UP_SUCCEEDED",
  "STEP_UP_FAILED",
] as const
export type AuthenticationOutcome = (typeof AUTHENTICATION_OUTCOMES)[number]

/**
 * One attempt to authenticate, successful or not.
 *
 * Failures are recorded as well as successes: a log of only successful logins
 * cannot answer "was this account under attack", which is the question asked
 * immediately after a compromise. `personId` is nullable because a failed
 * attempt may resolve to nobody, and recording a guess would be worse than
 * recording nothing.
 */
export interface AuthenticationEvent {
  id: string
  personId: string | null
  tenantId: string
  connectionId: string
  /** The subject asserted, even when it matched nothing. */
  subject: string | null
  outcome: AuthenticationOutcome
  occurredAt: string
  /** Coarse, for rate observation. Never a full address. */
  sourceLabel: string | null
}

export const RECOVERY_KINDS = [
  "BACKUP_EMAIL",
  "AUTHENTICATOR",
  "RECOVERY_CODES",
  "SECURITY_KEY",
  "ADMIN_ASSISTED",
] as const
export type RecoveryKind = (typeof RECOVERY_KINDS)[number]

/**
 * A way back in when the usual one fails.
 *
 * Its own entity because GE-040-004 forbids unlinking the last recovery path,
 * and a rule about "the last one" needs something countable. Verified and
 * unverified methods are both stored; only verified ones count toward that
 * floor, or a person could satisfy it with an address they cannot read.
 */
export interface RecoveryMethod {
  id: string
  personId: string
  kind: RecoveryKind
  /** A reference, never the secret. Codes and keys never appear in this model. */
  reference: string
  verifiedAt: string | null
  status: LifecycleStatus
  createdAt: string
}
