import {
  TENANT_BINDINGS,
  applyModuleEdits,
  archetypeFor,
  compiledArchetypeFor,
  getTenantBinding,
} from "@tenure/blueprints"
import { MODULE_CATALOG } from "@tenure/modules"
import { ENGINE_VERSION } from "@tenure/configuration"
import {
  navigationFor,
  resolveModules,
  type ModuleAdvisory,
  type ModuleLifecycle,
  type ModuleManifest,
  type ModuleNavEntry,
  type ModuleProblem,
  type NavSection,
} from "@tenure/module-runtime"

import { compareVersionStrings } from "./compatibility"

/**
 * Which modules an institution runs, and the navigation that follows from it.
 *
 * The blueprint says what this *kind* of system is made of; the tenant binding
 * says what this customer is entitled to. A module in the blueprint that the
 * tenant is not entitled to is refused with that reason rather than silently
 * dropped — the difference matters when someone asks why Reports is missing.
 *
 * Navigation used to be a function of two booleans in a client component:
 *
 *   buildNav(ctx.institutionRoles.length > 0, ctx.institutionRoles.length > 0)
 *
 * which is not configurable, is the same for every institution, and decides
 * visibility from a role *count*. Now the menu is what the enabled modules
 * contribute, filtered by what the principal can do.
 */

/**
 * Where an enabled module came from.
 *
 * `preset` is what this tenant's archetype compiled to; `tenant-add` is a module
 * its own `moduleEdits` put in on top. The distinction is what makes a preset an
 * editable starting point rather than a locked tenant type — without it, a
 * running system cannot say whether it looks the way it does because of the
 * archetype it was composed from or because somebody changed it afterwards
 * (PACK-020-002).
 *
 * The two edits are at different grains and both are real. Moving an axis
 * (`TenantBinding.archetype`) says this is a different KIND of system and
 * recompiles everything that follows; a module edit is a one-off divergence from
 * whatever those axes compiled to. This field reports the second, because the
 * first is already visible as the tenant's selection.
 */
export type ModuleProvenance = "preset" | "tenant-add"

export interface EnabledModuleOrigin {
  key: string
  from: ModuleProvenance
}

export interface SystemModules {
  enabled: readonly ModuleManifest[]
  keys: readonly string[]
  /** One entry per enabled module, in the same order as `keys`. */
  provenance: readonly EnabledModuleOrigin[]
  /** Modules the blueprint asked for that this tenant does not get, and why. */
  problems: readonly ModuleProblem[]
  /**
   * True of modules this tenant IS running, and that somebody has to be told.
   *
   * Deprecation, a read-only mode and a declared completeness gap all used to be
   * invisible here: `SystemModules` carried `keys` and `problems`, and a module
   * that ran with limitations was indistinguishable from one that did not.
   * Reported by `/api/me` so a client can say so.
   */
  advisories: readonly ModuleAdvisory[]
}

/**
 * The tiers each enabled module sells, and the tier this tenant is on.
 *
 * The shape `packages/authorization/src/decide.ts` needs: `tiers` gives the
 * ordering a `minTier` is ranked within, `currentTier` says where the tenant
 * sits in it. Both come from data that already exists — the catalog declares the
 * tiers, the binding records what was sold — rather than from a second table
 * somebody has to keep in step.
 *
 * Built from the ENABLED modules, not the whole catalog: a tier ordering for a
 * module this system does not run would rank a requirement that can never apply.
 */
export interface SystemTiers {
  tiers: Readonly<Record<string, readonly string[]>>
  currentTier: Readonly<Record<string, string>>
}

/** Tag each enabled key with whether the blueprint asked for it or the tenant did. */
function originsOf(
  keys: readonly string[],
  preset: readonly string[],
): readonly EnabledModuleOrigin[] {
  const fromPreset = new Set(preset)
  return keys.map((key) => ({ key, from: fromPreset.has(key) ? "preset" : "tenant-add" }))
}

/**
 * @param at when the resolution happens, ISO. Defaults to now.
 *
 * Defaulted rather than required so every existing caller is unchanged, and
 * overridable so a test can ask what a system looked like on a date — which is
 * the only way to exercise a module's support window without waiting for it.
 */
export function modulesFor(
  institutionSlug: string,
  at: string = new Date().toISOString(),
): SystemModules {
  const binding = getTenantBinding(institutionSlug)
  if (!binding) {
    // An institution with no binding gets the front door and nothing else.
    // Deliberately not "everything": an unconfigured tenant should look empty,
    // not fully provisioned. Terminology can fall back to defaults because words
    // are cosmetic; capability cannot, because it is not.
    const requested = ["dashboard"]
    const { ordered, keys, problems, advisories } = resolveModules(MODULE_CATALOG, {
      requested,
      at,
      runningEngineVersion: ENGINE_VERSION,
      compareVersions: compareVersionStrings,
    })
    // Reported as `preset`, not `tenant-add`: there is no tenant here to have
    // edited anything, and the front door is what an unconfigured institution
    // gets by default rather than something somebody chose for it.
    return {
      enabled: ordered,
      keys,
      provenance: originsOf(keys, requested),
      problems,
      advisories,
    }
  }

  // `compiledArchetypeFor` throws for a binding naming a blueprint that does not
  // exist, and returns undefined only when there is no binding — which the
  // branch above has already handled. This narrows the type; the message is
  // there because an unreachable branch that returns something plausible is how
  // an unconfigured tenant ends up looking provisioned.
  const compiled = compiledArchetypeFor(institutionSlug)
  if (!compiled) {
    throw new Error(
      `Institution "${institutionSlug}" is bound to blueprint "${binding.blueprintId}", which did not compile to a system.`,
    )
  }

  // The preset, edited — then resolved exactly as an unedited preset would be.
  //
  // Applying the edit BEFORE resolution rather than to the result is what keeps
  // an edit honest. An `add` becomes a request, so entitlement, lifecycle and
  // dependency rules all still get to refuse it; a `remove` leaves the requested
  // set short, so a module that depended on the removed one is reported with the
  // existing `missing-dependency` problem instead of the removal being quietly
  // undone or the dependant quietly disappearing.
  const preset = compiled.modules
  const { ordered, keys, problems, advisories } = resolveModules(MODULE_CATALOG, {
    requested: applyModuleEdits(preset, binding.moduleEdits),
    entitlements: binding.entitlements ?? [],
    // When, so a module past its support window is refused rather than served
    // (PACK-030-004), and the engine actually running, so a module needing a
    // newer one is refused rather than half-applied (PACK-030-003). The
    // comparator is passed in because module-runtime must not import this
    // package — this package imports IT.
    at,
    runningEngineVersion: ENGINE_VERSION,
    compareVersions: compareVersionStrings,
    // The `operatingModel` axis, passed through rather than assumed. This is
    // what makes an axis an INPUT TO RESOLUTION instead of a label: a module
    // declaring `requiresOperatingModel` is refused for a system whose axis it
    // does not name, with `wrong-operating-model` and the models it does accept
    // (PACK-020-001, PACK-GATE-020).
    operatingModel: archetypeFor(institutionSlug)?.operatingModel,
    // PACK-020-004. Which system is authoritative for each business domain, so
    // a module that would write into a domain the customer's external ERP owns
    // is refused rather than enabled into a dual write. Passed through from the
    // binding for the same reason the operating model is: a coexistence profile
    // that resolution never sees is a label.
    systemOfRecord: binding.coexistence?.systemOfRecord,
  })

  return { enabled: ordered, keys, provenance: originsOf(keys, preset), problems, advisories }
}

/** True when this system runs a module. The check a feature surface should make. */
export function hasModule(institutionSlug: string, moduleKey: string): boolean {
  return modulesFor(institutionSlug).keys.includes(moduleKey)
}

/**
 * The tier ordering and the tenant's position in it, for `decide()`.
 *
 * This is the half of REVIEW-FINDINGS P0 #5 that was missing. The engine's tier
 * gate was implemented and correct — ordered comparison, not string equality —
 * and it could not fire, because the only production builders of an
 * `AuthorizationWorld` never set `entitlements`, so `tierRank` returned null and
 * the whole loop was a no-op. A correct gate nothing supplies facts to is a gate
 * that is off.
 *
 * A module the tenant has no recorded tier for is deliberately absent from
 * `currentTier` rather than defaulted to its lowest: `decide()` denies
 * TIER_TOO_LOW when a role demands a tier and the tenant has none, which is the
 * fail-closed direction. Defaulting would silently grant the bottom tier to
 * every tenant nobody had recorded a sale for.
 */
export function tiersFor(institutionSlug: string): SystemTiers {
  const binding = getTenantBinding(institutionSlug)
  const enabled = modulesFor(institutionSlug).enabled

  const tiers: Record<string, readonly string[]> = {}
  const currentTier: Record<string, string> = {}

  for (const manifest of enabled) {
    if (!manifest.tiers) continue
    tiers[manifest.key] = manifest.tiers
    const sold = binding?.currentTier?.[manifest.key]
    if (sold !== undefined) currentTier[manifest.key] = sold
  }

  return { tiers, currentTier }
}

/**
 * The menu for one principal in one system.
 *
 * `capabilities` filters entries the principal cannot use. Passing `null` shows
 * everything, for operator views.
 *
 * Navigation is not authorization. Hiding a link does not protect a route, and
 * every route still checks for itself; this only stops the menu offering people
 * things they cannot do.
 */
export function navigationForSystem(
  institutionSlug: string,
  capabilities: ReadonlySet<string> | null,
): NavSection[] {
  return navigationFor(modulesFor(institutionSlug).enabled, capabilities)
}

/* ------------------------------------------------- the fleet, not one tenant */

/**
 * PACK-GATE-080 — the inverse question, and the one nothing could answer.
 *
 * Every lifecycle question in this package used to take a slug: `modulesFor`
 * one tenant, `hasModule` one tenant and one key. So "what happens if we
 * deprecate budgeting?" had no function to ask — an operator would have read
 * three blueprints, intersected them by hand with three entitlement lists, and
 * been wrong about `midtown-arts`, which lists budgeting in its blueprint and
 * does not run it.
 *
 * Folded through `modulesFor`, deliberately, rather than reading
 * `blueprint.modules` directly. A second path to "which modules does this
 * tenant run" is a second answer, and the one that drifts is the one nobody is
 * looking at: reading blueprints directly would report `midtown-arts` as
 * running budgeting (its blueprint lists it) when the entitlement refuses it,
 * and would miss a tenant that runs a module only because of its own
 * `moduleEdits`. Blast radius computed from a wish list is worse than none.
 */
interface FleetRow {
  slug: string
  displayName: string
  modules: SystemModules
}

function fleetModules(): readonly FleetRow[] {
  return TENANT_BINDINGS.map((binding) => ({
    slug: binding.slug,
    displayName: binding.displayName,
    modules: modulesFor(binding.slug),
  }))
}

/** The tenants that actually run a module today, in binding order. */
export function tenantsRunning(moduleKey: string): readonly string[] {
  return fleetModules()
    .filter((row) => row.modules.keys.includes(moduleKey))
    .map((row) => row.slug)
}

/** A nav entry that fires a command rather than navigating, and what it risks. */
export interface ModuleCommand {
  id: string
  label: string
  riskClass: NonNullable<ModuleNavEntry["riskClass"]>
}

export interface ModuleAdoption {
  key: string
  name: string
  lifecycle: ModuleLifecycle
  /** Every tenant running it, with where that tenant got it from. */
  tenants: readonly { slug: string; displayName: string; from: ModuleProvenance }[]
  /** Command surfaces this module contributes. Empty for most modules. */
  commands: readonly ModuleCommand[]
}

/**
 * Every module in the catalog, and the tenants it would take with it.
 *
 * The blast radius of a lifecycle change, computed for the whole fleet at once
 * so deprecating, suspending or retiring a module is a decision somebody can
 * take with the consequences in front of them rather than after the fact. A
 * module with no tenants is included, and that is the useful half: it is the
 * one that can be retired for nothing.
 */
export function moduleAdoption(): readonly ModuleAdoption[] {
  const fleet = fleetModules()

  return MODULE_CATALOG.all().map((manifest) => ({
    key: manifest.key,
    name: manifest.name,
    lifecycle: manifest.lifecycle,
    tenants: fleet
      .filter((row) => row.modules.keys.includes(manifest.key))
      .map((row) => ({
        slug: row.slug,
        displayName: row.displayName,
        from: row.modules.provenance.find((p) => p.key === manifest.key)!.from,
      })),
    commands: (manifest.navigation ?? [])
      .filter((entry) => entry.action)
      // `riskClass` is required beside `action` by validateManifest, so the
      // fallback is unreachable rather than a default nobody declared.
      .map((entry) => ({ id: entry.id, label: entry.label, riskClass: entry.riskClass ?? "read" })),
  }))
}
