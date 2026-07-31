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
 *   })
 *   navigationFor(ordered, capabilities)
 *
 * Dependencies are never auto-added. A platform quietly enabling a module the
 * customer did not buy — and that appears in no approved release — is a
 * different thing from a package manager pulling a transitive dependency.
 */

export {
  ENABLEABLE,
  MODULE_LIFECYCLE,
  ModuleManifestError,
  validateManifest,
} from "./manifest"
export type { ModuleLifecycle, ModuleManifest, ModuleNavEntry } from "./manifest"

export {
  ModuleCatalog,
  ModuleResolutionError,
  expandDependencies,
  navigationFor,
  resolveModules,
  resolveModulesOrThrow,
} from "./resolve"
export type { ModuleProblem, NavSection, ResolveModulesInput, ResolvedModules } from "./resolve"
