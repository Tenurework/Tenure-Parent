/**
 * @tenure/platform-config — what the platform makes configurable.
 *
 * Lives in a package rather than in an application because BOTH the tenant
 * application and the System Studio need the same answer to "what can be
 * configured, and what does this institution resolve to?". Two copies of that
 * list is two answers, and the one that drifts is whichever nobody is looking at.
 */

export { PLATFORM_DEFINITIONS } from "./definitions"
export { BRANDING_DEFINITIONS, brandingCss } from "./branding"
export type { Branding } from "./branding"
export {
  LOCALIZATION_DEFINITIONS,
  formatMoney,
  DEFAULT_MONEY_FORMAT,
  textDirectionFor,
  DEFAULT_BUSINESS_CALENDAR,
  addBusinessDays,
  businessDaysBetween,
  dateKey,
  isWorkingDay,
} from "./localization"
export type {
  Localization,
  MoneyFormat,
  TextDirection,
  BusinessCalendar,
} from "./localization"

export {
  FLAG_DEFINITIONS,
  FLAG_KILL_LIST_KEY,
  FLAG_NAMES,
  FlagDefinitionError,
  assertRestrictOnly,
  cohortBucket,
  decideFlag,
  flagEnabledKey,
  flagRolloutKey,
} from "./flags"
export type { FlagDecision, FlagName, FlagReason } from "./flags"

export { ExperimentDefinitionError, assignVariant, defineExperiment } from "./experiments"
export type { Assignment, Experiment, Variant } from "./experiments"

export {
  exposureSnapshot,
  recordExperimentExposure,
  recordFlagExposure,
} from "./exposure"
export type { ExposureCounts } from "./exposure"
// `resetExposureCounts` is deliberately NOT re-exported. Nothing in production
// resets a counter, and an export is an invitation.

export {
  VersionError,
  checkCompatibility,
  compareVersions,
  compareVersionStrings,
  parseVersion,
} from "./compatibility"
export type { CompatibilityVerdict, EngineVersion } from "./compatibility"

export {
  REGISTRY,
  brandingFor,
  compatibilityFor,
  configuredKeysFor,
  fleetCompatibility,
  layersFor,
  localizationFor,
  resolveSystemConfig,
  terminologyFor,
} from "./resolve"
export type { TenantCompatibility, Terminology } from "./resolve"

export {
  hasModule,
  moduleAdoption,
  modulesFor,
  navigationForSystem,
  tenantsRunning,
  tiersFor,
} from "./modules"
export type {
  EnabledModuleOrigin,
  ModuleAdoption,
  ModuleCommand,
  ModuleProvenance,
  SystemModules,
  SystemTiers,
} from "./modules"

export { MODEL_CATALOG, allowedModelIds, modelIsAllowed } from "./model-policy"
export type { ModelEntry, ModelLifecycle } from "./model-entry"

export { ROLLOUT_PATH, buildSystem, planPromotion, systemUnderValidation } from "./build-system"
export type {
  AssembledSystem,
  BuildSystemOptions,
  PromotionInput,
  PromotionPlan,
  PromotionStep,
  SystemParts,
} from "./build-system"
