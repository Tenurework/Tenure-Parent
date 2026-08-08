/**
 * @tenure/platform-config — what the platform makes configurable.
 *
 * Lives in a package rather than in an application because BOTH the tenant
 * application and the System Studio need the same answer to "what can be
 * configured, and what does this institution resolve to?". Two copies of that
 * list is two answers, and the one that drifts is whichever nobody is looking at.
 */

export { PLATFORM_DEFINITIONS } from "./definitions"
// PAY-150-002. The key, exported so the application reads the ladder by a
// symbol rather than by a string literal it keeps in step by hand — a renamed
// key must be a compile error, not a threshold that silently resolves to its
// default and stops firing.
export { APPROVAL_THRESHOLDS_KEY, approvalThresholds } from "./definitions"
// WRK-120-004. Same reason: the model-token ceiling is read by symbol in
// `apps/web/src/lib/config/server.ts`, so renaming the key breaks the build
// rather than silently resolving to the platform default and un-capping a
// tenant that had published its own.
export { MODEL_TOKEN_BUDGET_KEY, modelTokenBudgetPerMonth } from "./definitions"
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
/**
 * Re-exported so a Studio page rendering `SystemModules.paymentCapabilities`
 * can name the row type without reaching past this package into
 * `@tenure/payments` — which is the boundary `cell-independence.test.mjs`
 * exists to keep.
 */
export type { ModulePaymentCapability } from "@tenure/payments"

export { MODEL_CATALOG, allowedModelIds, modelIsAllowed } from "./model-policy"
export type { ModelEntry, ModelLifecycle } from "./model-entry"

/**
 * WRK-040-003. Here rather than in `@tenure/provisioning` for the reason
 * `model-policy.ts` states at length: whether a cell may make an outbound call
 * is policy the engine distributes TO the cell, and the cell reads it at
 * request time. `@tenure/provisioning` imports these and hangs them on
 * `ConnectorEntry`, so there is one definition and two importers.
 */
export {
  GRAPH_CALENDAR_REVIEW,
  GRAPH_CALENDAR_SCOPES,
  RELAY_ANTHROPIC_REVIEW,
  RELAY_ANTHROPIC_SCOPES,
  calendarSyncSentence,
  providerActivation,
} from "./provider-review"
export type {
  ProviderActivationReason,
  ProviderActivationVerdict,
  ProviderReview,
  ProviderReviewState,
} from "./provider-review"

/**
 * WRK-020-001. Bible §4.1's connection classes, distributed to the cell for the
 * same reason the provider review is: `apps/web/src/lib/relay-tools.ts` decides
 * on every request whether a tool exceeds the class its capability is offered
 * under, and it may not reach into `@tenure/provisioning` to ask.
 */
export {
  CONNECTION_CLASSES,
  RELAY_CAPABILITY_OFFERS,
  connectionClassFor,
  isConnectionClass,
} from "./provider-review"
export type { CapabilityOffer, ConnectionClass } from "./provider-review"

export { ROLLOUT_PATH, buildSystem, planPromotion, systemUnderValidation } from "./build-system"
export type {
  AssembledSystem,
  BuildSystemOptions,
  PromotionInput,
  PromotionPlan,
  PromotionStep,
  SystemParts,
} from "./build-system"
