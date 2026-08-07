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
  canAdvance,
  needsApproval,
  nextStates,
} from "./lifecycle"
export type { Actor, AdvanceOptions, LifecycleStep, TenantState } from "./lifecycle"

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

export { CELL_APPLY, deploymentManifest, executeStep } from "./execute"
export type { DeploymentManifest, ExecutionContext, StepEvidence } from "./execute"

export { MANIFEST_VERSION, digestOf, planFor, validateManifest } from "./manifest"
export type {
  IsolationTier,
  ManifestProblem,
  PlanStep,
  ProvisioningPlan,
  TenantManifest,
} from "./manifest"

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
  CATALOG_ENTRIES,
  RECERTIFICATION_WARNING_DAYS,
  RELAY_ANTHROPIC_CONNECTOR,
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
  ConnectorEntry,
  ExtensionEntry,
  ModelEntry,
  PackageVersion,
  UsabilityReason,
  UsabilityVerdict,
} from "./catalogs"

/**
 * WRK-000-002. The seven-state classification, per
 * (provider, product, capability, direction).
 */
export {
  capabilityKey,
  capabilityProblems,
  claimIsUnproven,
  classifyCapabilities,
} from "./connector-capability"
export type {
  CapabilityDirection,
  CapabilityProblem,
  ClassifiedCapability,
  ConnectorCapability,
  ConnectorCapabilityStatus,
} from "./connector-capability"

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
