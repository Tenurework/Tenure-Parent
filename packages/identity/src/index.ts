/**
 * @tenure/identity — the canonical identity model (GE-040-001).
 *
 * A durable person, the external identities that authenticate them,
 * effective-dated tenant memberships, invitations, sessions, authentication
 * events and recovery paths. Liveness is computed from the clock; no status
 * change is expressible without producing its audit record.
 *
 * `IdentityConnection` lives in `@tenure/provisioning` (GE-030-003) and is not
 * duplicated here — it belongs to the tenant registry, not to a person.
 */
export {
  AUTHENTICATION_OUTCOMES,
  INVITATION_STATUSES,
  LIFECYCLE_STATUSES,
  MEMBERSHIP_ORIGINS,
  RECOVERY_KINDS,
  type AuthSession,
  type AuthenticationEvent,
  type AuthenticationOutcome,
  type EffectiveInterval,
  type ExternalIdentity,
  type Invitation,
  type InvitationStatus,
  type LifecycleStatus,
  type MembershipOrigin,
  type Person,
  type RecoveryKind,
  type RecoveryMethod,
  type TenantMembership,
} from "./entities"

export {
  identityLiveness,
  intervalLiveness,
  invitationLiveness,
  liveMemberships,
  membershipLiveness,
  personLiveness,
  recoveryLiveness,
  sessionLiveness,
  usableRecoveryCount,
  type Live,
  type Liveness,
  type NotLive,
  type NotLiveReason,
} from "./effective-state"

export {
  reviseMembership,
  type MembershipAudit,
  type MembershipChange,
  type MembershipRevision,
  type RevisionApplied,
  type RevisionOutcome,
  type RevisionRefused,
} from "./transitions"
