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
export { LOCALIZATION_DEFINITIONS, formatMoney, DEFAULT_MONEY_FORMAT } from "./localization"
export type { Localization, MoneyFormat } from "./localization"

export {
  REGISTRY,
  brandingFor,
  layersFor,
  localizationFor,
  resolveSystemConfig,
  terminologyFor,
} from "./resolve"
export type { Terminology } from "./resolve"

export { hasModule, modulesFor, navigationForSystem } from "./modules"
export type { SystemModules } from "./modules"
