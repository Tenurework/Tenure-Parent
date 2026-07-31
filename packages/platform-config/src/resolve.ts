import {
  ConfigRegistry,
  resolveConfigOrThrow,
  type ConfigLayer,
  type ResolvedConfig,
} from "@tenure/configuration"

import { getBlueprint, getTenantBinding } from "@tenure/blueprints"
import { PLATFORM_DEFINITIONS } from "./definitions"
import type { Branding } from "./branding"
import type { Localization } from "./localization"

/**
 * The effective configuration for one institution.
 *
 * Layers, lowest precedence first:
 *
 *   platform    the defaults on each definition
 *   blueprint   the kind of system this institution runs
 *   tenant      this institution's own words
 *
 * `legalEntity`, `orgUnit`, `workspace` and `user` are supported by the engine
 * and are not supplied yet, because nothing writes them. A layer appears when
 * something can set it, not when the architecture mentions it.
 */

export const REGISTRY = ConfigRegistry.of(PLATFORM_DEFINITIONS)

/** Layers for an institution, in precedence order. Exported for tests and the Studio. */
export function layersFor(institutionSlug: string): ConfigLayer[] {
  const binding = getTenantBinding(institutionSlug)
  if (!binding) return []

  const blueprint = getBlueprint(binding.blueprintId)
  if (!blueprint) {
    // A binding naming a blueprint that does not exist is a broken system
    // definition, not a missing preference. Resolving it to platform defaults
    // would ship a system that looks configured and is not.
    throw new Error(
      `Institution "${institutionSlug}" is bound to blueprint "${binding.blueprintId}", which does not exist.`,
    )
  }

  return [
    { scope: "blueprint", id: blueprint.id, label: blueprint.name, values: blueprint.values },
    { scope: "tenant", id: binding.slug, label: binding.displayName, values: binding.values },
  ]
}

/**
 * Resolve configuration for an institution.
 *
 * An institution with no binding resolves to platform defaults rather than
 * throwing. That is a deliberate exception to the platform's fail-closed rule
 * and it is narrow: every key resolved here is a *word on a screen*. An
 * unconfigured institution seeing "Student Engagement Office" instead of its own
 * name is a cosmetic defect; a 500 on every page because nobody has written its
 * overlay yet is an outage. Fail-closed applies to keys that decide authority,
 * and this module deliberately defines none — see `allowedScopes` in
 * definitions.ts, which is what keeps it that way.
 *
 * A binding that exists but is broken still throws (`layersFor`, above). The
 * distinction is between "not configured" and "configured wrongly".
 */
export function resolveSystemConfig(institutionSlug: string): ResolvedConfig {
  return resolveConfigOrThrow(REGISTRY, layersFor(institutionSlug))
}

/**
 * Terminology for an institution, as a plain object.
 *
 * The shape callers want: `terminology(slug).staffOffice` rather than a string
 * key at every call site, so a renamed key is a compile error in one file.
 */
export interface Terminology {
  staffOffice: string
  staffOfficeShort: string
  organization: string
  organizations: string
  leadershipBody: string
  seat: string
}

export function terminologyFor(institutionSlug: string): Terminology {
  const config = resolveSystemConfig(institutionSlug)
  return {
    staffOffice: config.get<string>("platform.terminology.staffOfficeName"),
    staffOfficeShort: config.get<string>("platform.terminology.staffOfficeShortName"),
    organization: config.get<string>("platform.terminology.organizationSingular"),
    organizations: config.get<string>("platform.terminology.organizationPlural"),
    leadershipBody: config.get<string>("platform.terminology.leadershipBody"),
    seat: config.get<string>("platform.terminology.seatSingular"),
  }
}

/**
 * Locale, currency and calendar for an institution.
 *
 * Here rather than in localization.ts because it needs the registry, and the
 * registry is built from the definitions that file exports.
 */
export function localizationFor(institutionSlug: string): Localization {
  const config = resolveSystemConfig(institutionSlug)
  return {
    locale: config.get<string>("platform.localization.locale"),
    currency: config.get<string>("platform.localization.currency"),
    firstDayOfWeek: config.get<number>("platform.localization.firstDayOfWeek"),
    fiscalYearStartMonth: config.get<number>("platform.localization.fiscalYearStartMonth"),
  }
}

/** Visual identity for an institution. Beside the registry, for the same reason. */
export function brandingFor(institutionSlug: string): Branding {
  const config = resolveSystemConfig(institutionSlug)
  return {
    primaryColor: config.get<string>("platform.branding.primaryColor"),
    primaryTextColor: config.get<string>("platform.branding.primaryTextColor"),
    wordmark: config.get<string>("platform.branding.wordmark"),
  }
}
