/**
 * @tenure/module-runtime — which product capabilities a system has, and why.
 *
 * A module is a unit of capability a system can have or not have: events,
 * budgeting, reimbursements, organizational memory. Enabling one is a decision
 * recorded in a release artifact, not a feature flag someone flipped, and its
 * consequences are knowable before it happens.
 *
 *   const catalog = ModuleCatalog.of(MODULES)
 *   const { ordered, problems } = resolveModules(catalog, {
 *     requested: ["organizations", "events", "budgeting"],
 *     entitlements: ["finance"],
 *     // Not optional in practice. Every manifest declares `requiresEngine`, and
 *     // a caller that cannot say which engine is running is refused ALL of them
 *     // — an empty result, not a shorter one. Omitting this pair once broke
 *     // tenant composition in the Studio, so the example states it.
 *     runningEngineVersion: ENGINE_VERSION,
 *     compareVersions: compareVersionStrings,
 *   })
 *   navigationFor(ordered, capabilities)
 *
 * Dependencies are never auto-added. A platform quietly enabling a module the
 * customer did not buy — and that appears in no approved release — is a
 * different thing from a package manager pulling a transitive dependency.
 */

export {
  CAPABILITY_MODES,
  CLAIMS_COMPLETENESS,
  COMPLETENESS_DIMENSIONS,
  DEPENDENCY_KINDS,
  ENABLEABLE,
  MODULE_LIFECYCLE,
  ModuleManifestError,
  RISK_CLASSES,
  SUSPENSION_KINDS,
  validateManifest,
} from "./manifest"
export type {
  CapabilityMode,
  CompletenessDimension,
  DependencyKind,
  DimensionAssessment,
  ModuleDependency,
  ModuleGap,
  ModuleLifecycle,
  ModuleManifest,
  ModuleNavEntry,
  ModuleSuspension,
  RiskClass,
  SuspensionKind,
} from "./manifest"

export {
  AmbiguousAlternativeError,
  ModuleCatalog,
  ModuleResolutionError,
  expandDependencies,
  navigationFor,
  resolveModules,
  resolveModulesOrThrow,
  satisfiesRange,
  tierDeclarationProblems,
} from "./resolve"
export type {
  CatalogGovernance,
  ModuleAdvisory,
  ModuleProblem,
  NavSection,
  ResolveModulesInput,
  ResolvedModules,
  VersionComparator,
} from "./resolve"

export {
  BUSINESS_DOMAINS,
  COEXISTENCE_PROFILES,
  coexistenceProblems,
  externalDomains,
  moduleDomains,
} from "./coexistence"
export type {
  CoexistenceDeclaration,
  CoexistenceProblem,
  CoexistenceProfile,
  SystemOfRecordAuthority,
  SystemOfRecordMap,
} from "./coexistence"
