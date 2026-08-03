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
  accessState,
  usableRecoveryCount,
  type AccessReport,
  type AccessState,
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

export {
  applyAssertedEmail,
  connectionsToOffer,
  emailCollisions,
  identityKey,
  keyOf,
  resolveAssertion,
  type ConnectionState,
  type EmailCollision,
  type IdentityAssertion,
  type RefusalReason,
  type ResolutionOutcome,
} from "./keying"

export {
  SEAT_STATUSES,
  actingSeats,
  concurrentHolders,
  liveSeats,
  personReach,
  seatState,
  type PersonReach,
  type SeatAssignment,
  type SeatAuthority,
  type SeatState,
  type SeatStatus,
} from "./seats"

export {
  LINK_STEP_UP_MINUTES,
  applyMerge,
  planLink,
  planUnlink,
  validateMergeProposal,
  validateMergeReview,
  type LinkCollision,
  type LinkGranted,
  type LinkOutcome,
  type LinkRefusal,
  type LinkRefused,
  type LinkRequest,
  type MergeProposal,
  type MergeResult,
  type MergeReview,
  type MergeVerdict,
  type UnlinkOutcome,
  type UnlinkRefusal,
  type UnlinkRequest,
} from "./linking"

export {
  evaluateSession,
  sessionsEndedBy,
  type InvalidationTrigger,
  type SessionContext,
  type SessionEvaluation,
  type SessionInvalid,
  type SessionValid,
} from "./invalidation"

export {
  IGNORED_CLAIMS,
  withoutIgnoredClaims,
  type AuthenticationCallback,
  type AuthenticationFailure,
  type AuthenticationRejected,
  type AuthenticationResult,
  type AuthenticationStart,
  type AuthenticationVerified,
  type IdentityProvider,
  type ProviderAccount,
} from "./provider"

export {
  ENROLMENT_POLICIES,
  admitToTenant,
  enrolmentPolicy,
  selfSignUpBreaches,
  type EnrolmentAdmitted,
  type EnrolmentOutcome,
  type EnrolmentPolicy,
  type EnrolmentRefusal,
  type EnrolmentRefused,
  type EnrolmentRequest,
  type SelfSignUpBreach,
  type TenantEnrolment,
} from "./enrolment"

export {
  ASSURANCE_LEVELS,
  GATED_ACTIONS,
  MAX_VERIFICATION_ATTEMPTS,
  REQUIREMENTS,
  SAFE_VERIFICATION_MESSAGE,
  assuranceFor,
  digestsEqual,
  meetsLevel,
  verifyChallenge,
  type AssuranceLevel,
  type AssuranceOutcome,
  type AssuranceRefusal,
  type AssuranceRequirement,
  type AssuranceSatisfied,
  type AssuranceUnsatisfied,
  type GatedAction,
  type HeldAssurance,
  type VerificationChallenge,
  type VerificationOutcome,
  type VerificationRefusal,
} from "./assurance"

export {
  DISCOVERY_MAX_PER_WINDOW,
  DISCOVERY_WINDOW_SECONDS,
  LOGIN_ENTRY_POINTS,
  PLATFORM_BRANDING,
  checkDiscoveryRate,
  offerLeaks,
  resolveLogin,
  tenantForHost,
  type DiscoverableTenant,
  type DiscoveryContext,
  type DiscoveryInput,
  type LoginEntryPoint,
  type LoginOffer,
  type RateLimitDecision,
  type RateLimitState,
  type SafeBranding,
} from "./discovery"

export {
  CHALLENGE_METHOD,
  SAFE_CALLBACK_MESSAGE,
  VERIFIER_MAX_LENGTH,
  VERIFIER_MIN_LENGTH,
  beginAuthorization,
  bindCallback,
  validateReturnPath,
  validateVerifier,
  type AuthorizationRequest,
  type AuthorizationTransaction,
  type BeginInput,
  type BeginOutcome,
  type CallbackInput,
  type CallbackOutcome,
  type CallbackRefusal,
  type ReturnPathRefusal,
  type ReturnPathVerdict,
  type Sha256Base64Url,
} from "./authorization-request"

export {
  ALLOWED_ALGORITHMS,
  CHECK_ORDER,
  CLOCK_SKEW_SECONDS,
  SAFE_TOKEN_MESSAGE,
  validateAccessToken,
  validateIdToken,
  type AccessTokenAccepted,
  type AccessTokenOutcome,
  type AccessTokenRefusal,
  type AccessTokenRejected,
  type AllowedAlgorithm,
  type ExpectedAccessToken,
  type ValidateAccessInput,
  type ExpectedToken,
  type ParsedToken,
  type SeenNonce,
  type TokenAccepted,
  type TokenClaims,
  type TokenHeader,
  type TokenOutcome,
  type TokenRefusal,
  type TokenRejected,
  type ValidateInput,
  type VerifySignature,
} from "./token-validation"

export {
  ABSOLUTE_TIMEOUT_HOURS,
  CSRF_COOKIE,
  IDLE_TIMEOUT_MINUTES,
  SESSION_COOKIE,
  checkCsrf,
  checkSession,
  cookieProblems,
  csrfCookie,
  revokeSessions,
  rotateSession,
  sessionCookie,
  sessionInventory,
  type CookieAttributes,
  type CookieProblem,
  type CsrfRefusal,
  type CsrfVerdict,
  type Rotation,
  type RotationReason,
  type ServerSession,
  type SessionCheck,
  type SessionRefusal,
  type SessionSummary,
} from "./session"

export {
  planTenantSwitch,
  type SwitchAccepted,
  type SwitchOutcome,
  type SwitchRefusal,
  type SwitchRefused,
  type SwitchRequest,
} from "./tenant-switch"

export {
  LogoutConfigurationError,
  planLogout,
  type LogoutPlan,
  type LogoutRequest,
  type ProviderMetadata,
  type UpstreamLogout,
} from "./logout"

export {
  DISCLOSING_TERMS,
  FAILURE_OUTCOMES,
  NotAFailureError,
  SIGN_IN_FAILED_MESSAGE,
  disclosesCondition,
  signInFailure,
  type SignInFailure,
} from "./auth-errors"
