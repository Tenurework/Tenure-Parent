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
  RESIDUAL_COST,
  SERVING,
  TERMINAL,
  advance,
  canAdvance,
  needsApproval,
  nextStates,
} from "./lifecycle"
export type { Actor, AdvanceOptions, LifecycleStep, TenantState } from "./lifecycle"

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

export { choosePlacement, isCellServing, validateCellRecord } from "./cell-registry"
export type {
  CellCapacity,
  CellHealth,
  CellProblem,
  CellRecord,
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
  availableToTenants,
  canAdvanceCatalog,
  engineIsCompatible,
  isUsable,
  validatePackage,
  validateRange,
} from "./catalogs"
export type {
  AnyCatalogEntry,
  CatalogEntry,
  CatalogLifecycle,
  CatalogProblem,
  CompatibilityRange,
  ConnectorEntry,
  ExtensionEntry,
  ModelEntry,
  PackageVersion,
  UsabilityReason,
} from "./catalogs"


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
