/**
 * @tenure/provisioning — bringing a tenant into existence, and taking it out.
 *
 * Two things live here and they are deliberately separate:
 *
 *   lifecycle.ts  where a tenant is, and which moves are legal from there
 *   manifest.ts   what a tenant IS — the thing an operator composes and the
 *                 thing provisioning reads
 *   execute.ts    what each state actually DOES, and the signed artifact a
 *                 cell reconciles toward
 *
 * Neither touches storage. That is what lets the rules be tested exhaustively
 * without AWS, and it is why the Studio can render a plan before anything has
 * been created.
 */

export {
  ALL_STATES,
  LifecycleError,
  REQUIRES_APPROVAL,
  REQUIRES_OWNER,
  RESIDUAL_COST,
  SERVING,
  TERMINAL,
  advance,
  attemptFor,
  canAdvance,
  needsApproval,
  nextStates,
} from "./lifecycle"
export type { Actor, AdvanceOptions, LifecycleStep, TenantState } from "./lifecycle"

/**
 * GE-103-013 / GE-103-015 — the two gates on the way out.
 *
 * Exported beside `advance` because they are not optional extras: `advance`
 * refuses `PURGE_PENDING → PURGING` without a clearance and
 * `PURGING → PURGED_ZERO_INCREMENTAL_COST` without a tombstone, so a caller
 * that has the lifecycle has to have these too.
 */
export { PURGE_CHECKS, PURGE_CHECK_IDS, purgeClearance } from "./purge-gate"
export type {
  CheckVerdict,
  ExportOutcome,
  PurgeApproval,
  PurgeCheck,
  PurgeCheckId,
  PurgeCheckResult,
  PurgeClearance,
  PurgeFacts,
} from "./purge-gate"
export { TOMBSTONE_FIELDS, TombstoneRefused, buildTombstone, tombstoneProblems } from "./tombstone"
export type {
  Tombstone,
  TombstoneApproval,
  TombstoneField,
  TombstoneLifecycle,
  TombstoneProblem,
} from "./tombstone"

/**
 * WRK-120-005. The checkable half of the residual-cost claim, exported beside
 * `RESIDUAL_COST` so a console rendering the sentence has the list in the same
 * import and no excuse for rendering one without the other.
 */
export {
  RESIDUAL_CLAIMS,
  observeResidual,
  reconcileResidual,
} from "./residual-reconciliation"
export type {
  ObservedTenantResources,
  ResidualClaim,
  ResidualReconciliation,
  ResourceClass,
} from "./residual-reconciliation"

export {
  CELL_APPLY,
  DeploymentSigningError,
  deploymentManifest,
  executeStep,
  verifyDeployment,
} from "./execute"
export type {
  DeploymentManifest,
  DeploymentVerification,
  ExecutionContext,
  ManifestSignature,
  SecretRefResolution,
  SigningKey,
  StepEvidence,
  StepRun,
} from "./execute"

/**
 * STUDIO-070-002. The tag contract, exported beside the lifecycle because a
 * resource's tenant tag and a tenant's lifecycle state are the same fact seen
 * from two sides — and a console rendering one without the other is a console
 * that can show a bill it cannot attribute.
 */
export {
  DATA_CLASSES,
  MANAGED_BY,
  REQUIRED_RESOURCE_TAGS,
  SHARED,
  tagProblems,
  tenantAttribution,
} from "./resource-tags"
export type { RequiredResourceTag, TagProblem, TenantAttribution } from "./resource-tags"

/**
 * STUDIO-060-007. The C1–C7 change taxonomy the mutating path is gated on.
 */
export {
  C7_COOLING_OFF_MS,
  CHANGE_CLASSES,
  classify,
  confirmationTokenFor,
  requirementsFor,
} from "./change-class"
export type {
  ChangeClass,
  ChangeOperation,
  ChangeRequirements,
} from "./change-class"

export { MANIFEST_VERSION, digestOf, planFor, validateManifest } from "./manifest"
export type {
  IsolationTier,
  ManifestProblem,
  PlanStep,
  ProvisioningPlan,
  TenantManifest,
} from "./manifest"

/**
 * GE-100-002 — the six kinds of value a manifest carries.
 *
 * Exported beside the manifest for the same reason `RESIDUAL_CLAIMS` is
 * exported beside `RESIDUAL_COST`: a surface that renders a manifest has the
 * provenance of every field in the same import, so there is no excuse for
 * showing a default as though somebody had chosen it.
 */
export {
  MANIFEST_FIELD_SPECS,
  PLACEHOLDER_SHAPES,
  VALUE_KINDS,
  classifyManifestValues,
  placeholderProblems,
  placeholderReason,
} from "./manifest-values"
export type {
  ClassifiedValue,
  FieldSpec,
  PlaceholderShape,
  ValueClassification,
  ValueKind,
  ValueSource,
} from "./manifest-values"

/**
 * The coexistence vocabulary, re-exported rather than redefined.
 *
 * It is declared in `@tenure/module-runtime` because that is the package that
 * ENFORCES it — `resolveModules` refuses a module whose domain an external
 * system owns — and because `apps/web` reaches module-runtime and must not
 * reach this package (`tests/security/cell-independence.test.mjs`). One
 * definition, two importers, same as `ModelEntry`.
 */
export {
  BIDIRECTIONAL_PROFILES,
  BUSINESS_DOMAINS,
  COEXISTENCE_PROFILES,
  SYNC_DIRECTIONS,
  coexistenceProblems,
  externalDomains,
  objectAuthorityNotes,
} from "@tenure/module-runtime"
export type {
  CoexistenceDeclaration,
  CoexistenceProfile,
  FieldAuthority,
  ObjectAuthority,
  SyncDirection,
  SystemOfRecordAuthority,
  SystemOfRecordMap,
} from "@tenure/module-runtime"

export {
  canTransition,
  isServing,
  loginProjection,
  validateRegistryRecord,
} from "./tenant-registry"
export type {
  CellPlacement,
  LoginProjection,
  RegistryProblem,
  TenantLifecycle,
  TenantRegistryRecord,
} from "./tenant-registry"

export {
  DEFAULT_CELL_RESERVE,
  DEFAULT_WARN_FRACTION,
  admissionLimit,
  cellHeadroom,
  cellHoldsResidency,
  cellReserve,
  choosePlacement,
  isCellHot,
  isCellServing,
  validateCellRecord,
  warnThreshold,
} from "./cell-registry"
export type {
  CellCapacity,
  CellHealth,
  CellProblem,
  CellRecord,
  FleetAdmission,
  FleetRecommendation,
  PlacementDecision,
  PlacementRefusal,
} from "./cell-registry"

export {
  EXPIRY_WARNING_DAYS,
  connectionHealth,
  connectionsNeedingAttention,
  discoverTenantByDomain,
  domainMatches,
  findDomainConflicts,
  loginMethods,
  normalizeDomain,
  validateConnection,
  validateDomain,
} from "./identity-registry"
export type {
  ConnectionHealth,
  ConnectionKind,
  ConnectionStatus,
  CredentialRef,
  DomainState,
  HealthReport,
  IdentityConnection,
  OfferedMethod,
  VerifiedDomain,
} from "./identity-registry"

export {
  QUOTA_DIMENSIONS,
  checkQuota,
  commercialProjection,
  contractIsActive,
  entitlementsFor,
  quotaReport,
  validateContract,
  validatePlan,
} from "./commercial"
export type {
  CommercialProblem,
  CommercialProjection,
  Contract,
  Plan,
  QuotaCheck,
  QuotaDimension,
  QuotaEnforcement,
  QuotaLimit,
  QuotaVerdict,
  UsageMeter,
} from "./commercial"

export { PLAN_CATALOG, getPlan, planIds } from "./plan-catalog"

export {
  ACCOUNT_VERIFICATIONS,
  CATALOG_ENTRIES,
  RECERTIFICATION_WARNING_DAYS,
  RELAY_ANTHROPIC_CONNECTOR,
  acceleratorAvailabilityFor,
  authorizationRefusal,
  availabilityDecisions,
  availableToTenants,
  canAdvanceCatalog,
  certificationState,
  engineIsCompatible,
  isUsable,
  validatePackage,
  validateRange,
} from "./catalogs"
export type {
  AnyCatalogEntry,
  AvailabilityContext,
  CapabilityAvailabilityDecision,
  CatalogCertification,
  CatalogEntry,
  CatalogLifecycle,
  CatalogProblem,
  CatalogRestrictions,
  CertificationState,
  CompatibilityRange,
  ConnectorCredentialRequirement,
  ConnectorCredentialSource,
  ConnectorEntry,
  ConnectorSetupSchema,
  ExtensionEntry,
  ModelEntry,
  PackageVersion,
  ProviderAuthorizationProfile,
  UsabilityReason,
  UsabilityVerdict,
} from "./catalogs"

/**
 * WRK-000-002. The seven-state classification, per
 * (provider, product, capability, direction).
 *
 * WRK-100-004. And the certification contract it is held to: eight named
 * clauses, each proved per direction, so a pack that ran one smoke test cannot
 * pass the gate a fully-exercised one passes.
 */
export {
  CERTIFICATION_CLAUSES,
  NO_EVIDENCE,
  capabilityKey,
  capabilityProblems,
  certifiedDirections,
  claimIsUnproven,
  classifyCapabilities,
  evidenceRefsOf,
} from "./connector-capability"
export type {
  CapabilityDirection,
  CapabilityProblem,
  CertificationClause,
  CertifiedDirection,
  ClassifiedCapability,
  ClauseEvidence,
  ConnectorCapability,
  ConnectorCapabilityStatus,
  EvidenceRef,
} from "./connector-capability"

/**
 * WRK-020-002. Versioned include/exclude resource selectors, and the impact
 * diff a tenant is shown before a scope change is saved.
 */
export {
  patternMatches,
  selectorDiff,
  selectorProblems,
  selectorSelects,
} from "./resource-selector"
export type {
  KnownResource,
  ResourcePattern,
  ResourceSelector,
  SelectorDiff,
  SelectorProblem,
  SelectorReason,
} from "./resource-selector"

/**
 * WRK-130-001. The ten accelerators the Bible names, and the computed verdict
 * for each over the capabilities actually selected for release.
 */
export { WORK_ACCELERATORS, acceleratorAvailability } from "./work-accelerators"
export type { AcceleratorVerdict, WorkAccelerator } from "./work-accelerators"

/** WRK-100-003. The named packs, bound to the requirements that ask for them. */
export { PROVIDER_PACKS } from "./provider-packs"
export type { ProviderPackEntry } from "./provider-packs"


export { AdoptionRefused, REQUIRED_ADOPTION_CHECKS, adoptTenant } from "./adoption"
export type { AdoptionCheck, AdoptionEvidence, AdoptionInput } from "./adoption"

export {
  DEFAULT_POOL_STRATEGY,
  ISOLATION_CLASSES,
  POOL_STRATEGIES,
  poolInvariantBreaches,
  resolvePool,
  shardFor,
  type IsolationClass,
  type PoolInvariantBreach,
  type PoolRefusal,
  type PoolResolution,
  type PoolStrategy,
  type PoolStrategyConfig,
  type PoolTenant,
} from "./pool-strategy"

/**
 * GE-101-001 / GE-101-002 / GE-101-003. The placement policy — the eleven axes
 * the Bible names, the five shapes behind one contract, and the override that
 * may not waive a boundary or a gate nobody could check.
 *
 * Exported beside `choosePlacement` because they are two halves of one
 * decision: the policy says which cells a contract permits, `choosePlacement`
 * picks one of those and owns the capacity refusal. A caller reaching for one
 * without the other places a tenant on unchecked ground or reports "policy
 * refused" where "the cells are full" is the sentence an operator can act on.
 */
export {
  GATES_ENFORCED_BY_ADMISSION,
  OVERRIDABLE_GATES,
  PLACEMENT_GATES,
  PLACEMENT_POLICY_VERSION,
  evaluateCell,
  evaluatePlacementPolicy,
  explain,
  placementConfigVersion,
} from "./placement-policy"
export type {
  AppliedOverride,
  CellPlacementFacts,
  CellPolicyEvaluation,
  GateResult,
  GateVerdict,
  PlacementGate,
  PlacementPolicyDecision,
  PlacementRequest,
  PolicyInput,
} from "./placement-policy"

export {
  PLACEMENT_ADAPTERS,
  PLACEMENT_ADAPTER_TABLE,
  PLACEMENT_RESOURCES,
  adapterFor,
} from "./placement-adapters"
export type {
  AdapterSelection,
  PlacementAdapter,
  PlacementAdapterId,
  PlacementResource,
  PlannedResource,
  ResourceSharing,
} from "./placement-adapters"

export {
  MIN_OVERRIDE_REASON,
  OVERRIDE_CHANGE_CLASS,
  OverrideRefused,
  applyOverride,
  overrideProblems,
} from "./placement-override"
export type { OverrideApproval, OverrideProblem, OverrideRefusal, OverrideRequest } from "./placement-override"
