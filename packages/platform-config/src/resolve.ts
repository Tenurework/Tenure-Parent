import {
  ConfigRegistry,
  ENGINE_VERSION,
  resolveConfigOrThrow,
  type ConfigLayer,
  validateDomains,
  type ResolvedConfig,
} from "@tenure/configuration"

import {
  TENANT_BINDINGS,
  archetypeFor,
  compileArchetype,
  getBlueprint,
  getTenantBinding,
} from "@tenure/blueprints"
import { PLATFORM_DEFINITIONS } from "./definitions"
import type { Branding } from "./branding"
import type { Localization } from "./localization"
import { checkCompatibility, type CompatibilityVerdict } from "./compatibility"
import { textDirectionFor } from "./direction"

/**
 * The effective configuration for one institution.
 *
 * Layers, lowest precedence first:
 *
 *   platform    the defaults on each definition
 *   blueprint   the kind of system this institution runs
 *   archetype   what this institution's position on the archetype axes compiles to
 *   tenant      this institution's own words
 *
 * `legalEntity`, `orgUnit`, `workspace` and `user` are supported by the engine
 * and are not supplied yet, because nothing writes them. A layer appears when
 * something can set it, not when the architecture mentions it.
 */

export const REGISTRY = ConfigRegistry.of(PLATFORM_DEFINITIONS)

/**
 * GE-031-002 — every platform key is inside a configuration domain's authority.
 *
 * Checked HERE rather than inside `ConfigRegistry.of`, and the distinction is
 * the whole design. `@tenure/configuration` is the mechanism: layers, merge
 * strategies, precedence. It is used by modules that own their own namespaces
 * (`finance.budget.approvalThreshold`) and by tests that build registries out
 * of throwaway keys, and forcing every one of those through the platform's
 * fourteen domains would make the mechanism unusable by anything but the
 * platform.
 *
 * `PLATFORM_DEFINITIONS` is different: it is the platform's own configuration
 * surface, and every key in it must be governed. A new `platform.deployment.*`
 * key with no domain would be settable by any tenant layer, and would look
 * exactly like a key that had been thought about.
 *
 * At module load, so it is a startup failure rather than a surprise on the
 * first request that reads the key.
 */
const domainProblems = validateDomains(PLATFORM_DEFINITIONS)
if (domainProblems.length > 0) {
  throw new Error(
    `${domainProblems.length} platform configuration key(s) are outside their domain's authority ` +
      `(GE-031-002):\n  ` +
      domainProblems.map((p) => `${p.key}: ${p.problem}`).join("\n  "),
  )
}

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

  // The archetype layer is not decoration. `organizationSingular`/`Plural` are
  // set NOWHERE else — the blueprints stopped declaring them when the axes
  // arrived — so a tenant resolving "club" rather than the platform default
  // "organization" is proof this layer applied. Remove it and every terminology
  // assertion in resolve.test.ts fails.
  const archetype = archetypeFor(institutionSlug)
  const compiled = archetype ? compileArchetype(archetype) : undefined

  return [
    { scope: "blueprint", id: blueprint.id, label: blueprint.name, values: blueprint.values },
    ...(compiled
      ? [
          {
            scope: "archetype" as const,
            id: `${archetype!.organization}/${archetype!.operatingModel}`,
            label: "Archetype axes",
            values: compiled.values,
          },
        ]
      : []),
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
    // Derived here rather than stored, so it cannot disagree with the locale.
    direction: textDirectionFor(config.get<string>("platform.localization.locale")),
    businessCalendar: {
      workingDays: config.get<number[]>("platform.localization.workingDays"),
      holidays: config.get<string[]>("platform.localization.holidays"),
    },
  }
}

/* ------------------------------------- can the cell holding it run its config */

/**
 * PACK-GATE-080 — the configuration keys one tenant sets, against one engine.
 *
 * `checkCompatibility` has existed since GE-022-005 and, until this function,
 * had no caller outside its own test. A gate nothing calls refuses nothing: the
 * comment above it describes a cell that is older refusing a release, and no
 * cell has ever been asked. This is where it is asked — per tenant, against the
 * engine version the cell holding that tenant reports.
 *
 * ## What the requirement per key means, exactly
 *
 * Every key this build implements is declared as needing THIS build's engine
 * version, because that is the only claim the repository can support. Nothing
 * records when each configuration key was introduced or when its meaning last
 * moved; `ENGINE_VERSION` is documented in `@tenure/configuration` as moving
 * when the layer contract moves, so "this build's semantics for this key are
 * the ones at ENGINE_VERSION" is true by construction. Guessing an earlier
 * minimum per key would make the gate pass for keys it should refuse, which is
 * the failure this whole module exists to prevent — so it is deliberately
 * conservative in the direction that produces a visible refusal rather than a
 * silent half-application.
 *
 * `known` is the running registry's key set, so a tenant whose overlay names a
 * key this build does not define is refused as `unknown-key` — separately from
 * "your engine is too old", because they are different mistakes by different
 * people even though the tenant experiences them identically.
 */
export interface TenantCompatibility {
  slug: string
  displayName: string
  /** Configuration keys this tenant's own layers set. */
  keys: readonly string[]
  verdict: CompatibilityVerdict
}

/** The keys a tenant's layers actually set, blueprint and tenant scope together. */
export function configuredKeysFor(institutionSlug: string): readonly string[] {
  const keys = new Set<string>()
  for (const layer of layersFor(institutionSlug)) {
    for (const key of Object.keys(layer.values)) keys.add(key)
  }
  return [...keys].sort()
}

export function compatibilityFor(
  institutionSlug: string,
  runningEngineVersion: string,
): CompatibilityVerdict {
  const keys = configuredKeysFor(institutionSlug)
  return checkCompatibility(
    runningEngineVersion,
    Object.fromEntries(keys.map((key) => [key, ENGINE_VERSION])),
    new Set(REGISTRY.keys()),
  )
}

/**
 * The same question for every bound tenant at once.
 *
 * The shape the Studio's fleet view wants: a lifecycle or release decision is
 * taken across tenants, so the answer has to be available across tenants
 * without the caller looping over a binding list it would have to keep in step
 * with `blueprints/index.ts`.
 */
export function fleetCompatibility(runningEngineVersion: string): readonly TenantCompatibility[] {
  return TENANT_BINDINGS.map((binding) => ({
    slug: binding.slug,
    displayName: binding.displayName,
    keys: configuredKeysFor(binding.slug),
    verdict: compatibilityFor(binding.slug, runningEngineVersion),
  }))
}

/** Visual identity for an institution. Beside the registry, for the same reason. */
export function brandingFor(institutionSlug: string): Branding {
  const config = resolveSystemConfig(institutionSlug)
  return {
    primaryColor: config.get<string>("platform.branding.primaryColor"),
    primaryTextColor: config.get<string>("platform.branding.primaryTextColor"),
    wordmark: config.get<string>("platform.branding.wordmark"),
    colorScheme: config.get<Branding["colorScheme"]>("platform.branding.colorScheme"),
  }
}
