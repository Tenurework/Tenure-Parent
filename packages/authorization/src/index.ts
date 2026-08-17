/**
 * @tenure/authorization — who may do what, and an answer to "why not?".
 *
 * Combines role-based grants, attribute conditions, relationship checks
 * (ownership, org-unit ancestry), hierarchical scope inheritance, delegation
 * and separation of duties into one decision that carries its own trace.
 *
 *   const decision = decide(world, {
 *     principalId: "u1", tenantId: "t1",
 *     permission: "approvals.decide",
 *     resource: { type: "ApprovalRequest", id: "a1", orgUnitId: "club1", createdByPrincipalId: "u1" },
 *     at: "2026-07-31T00:00:00Z",
 *   })
 *   decision.allowed   // false
 *   decision.reason    // "SEPARATION_OF_DUTIES"
 *   decision.trace     // every step that was checked, in order
 *
 * Two properties are load-bearing.
 *
 * It is a pure function of stated facts. Nothing is fetched inside; the world is
 * passed in. That is what makes a decision reproducible in a test and in a
 * support session, and what stops it quietly depending on request state.
 *
 * It fails closed and says why. Every denial names one of thirteen reasons, and
 * every reason is reachable — including the two the architecture's own SQL can
 * never produce, because it never checks membership state or whether the
 * principal is disabled.
 */

export { DENY_REASONS } from "./model"
export type {
  Delegation,
  DenyReason,
  GrantScope,
  GrantState,
  ISODate,
  Membership,
  MembershipState,
  Policy,
  PolicyContext,
  Principal,
  ResourceRef,
  RoleDefinition,
  RoleGrant,
  TenantEntitlement,
} from "./model"

export { decide, decideCheck, effectivePermissions, policyRevisionOf } from "./decide"
export type {
  AuthorizationRequest,
  AuthorizationWorld,
  Decision,
  TraceStep,
} from "./decide"

export { SEPARATION_OF_DUTIES, notOwnRequest, notOwnReimbursement } from "./policies"

export {
  MAX_DURATION_HOURS,
  STEP_UP_FRESHNESS_MINUTES,
  SUPPORT_BASES,
  attributionFor,
  auditAccess,
  bannerFor,
  isActive,
  permits,
  validateSession,
} from "./support-session"
export type {
  Attribution,
  InactiveReason,
  Liveness,
  SessionBanner,
  SessionProblem,
  SupportAuditEntry,
  SupportBasis,
  SupportSession,
} from "./support-session"

export {
  MAX_MINUTES,
  REVIEW_DEADLINE_HOURS,
  ROUTINE_THRESHOLD,
  ROUTINE_WINDOW_DAYS,
  alarmFor,
  openBreakGlass,
  routineUse,
  unreviewedOverdue,
  validateReview,
  validateUse,
} from "./break-glass"
export type {
  BreakGlassAlarm,
  BreakGlassProblem,
  BreakGlassReview,
  BreakGlassUse,
  OpenOutcome,
  RefusalReason,
} from "./break-glass"

export {
  NON_DELEGABLE_PERMISSIONS,
  isDelegable,
  PERMISSIONS,
  PERMISSION_DOMAINS,
  PERMISSION_ACTIONS,
  PERMISSION_RESOURCES,
  looksLikeARoleTitle,
  MODULE_KEYS,
  lookupPermission,
  isPermissionKey,
  permissionKeys,
  permissionsForModule,
  validatePermissionCatalog,
} from "./permission-catalog"
export type {
  PermissionDefinition,
  PermissionDomain,
  PermissionAction,
  PermissionResource,
  PermissionKey,
  ModuleKey,
} from "./permission-catalog"

export {
  RELATIONSHIP_TYPES,
  relationshipProblems,
  relationshipHoldsAt,
  hasRelationship,
  directReportsOf,
} from "./relationships"
export type {
  Relationship,
  RelationshipType,
  RelationshipGrant,
  RelationshipQuery,
  RelationshipProblem,
} from "./relationships"

export {
  ASSURANCE_LEVELS,
  assuranceRank,
  meetsAssurance,
  checkAssurance,
  requirementFor,
} from "./assurance"
export type {
  AssuranceLevel,
  SessionAssurance,
  AssuranceRequirement,
  AssuranceOutcome,
  AssuranceFailure,
} from "./assurance"

export {
  ROLE_TEMPLATES,
  lookupRoleTemplate,
  permissionsOfTemplate,
  validateRoleTemplates,
} from "./role-templates"
export type { RoleTemplate } from "./role-templates"

export {
  INCOMPATIBLE_DUTIES,
  conflictHoldsAt,
  mayDecide,
  separationViolations,
  quorumMet,
  ladderProblems,
  rungFor,
} from "./controls"
export type {
  ConflictDeclaration,
  Recusal,
  ControlRefusal,
  ControlOutcome,
  ControlWorld,
  DecisionUnderReview,
  IncompatibleDuties,
  DutiesViolation,
  QuorumRule,
  CastApproval,
  QuorumOutcome,
  QuorumShortfall,
  ThresholdRung,
  LadderProblem,
} from "./controls"

export {
  authorizationService,
  memoryCache,
  decisionKey,
  validUntil,
} from "./service"
export type {
  AuthorizationService,
  AuthorizationServiceOptions,
  ServiceDecision,
  PolicyRevision,
  DecisionCache,
  CachedDecision,
} from "./service"
