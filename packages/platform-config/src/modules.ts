import { getBlueprint, getTenantBinding } from "@tenure/blueprints"
import { MODULE_CATALOG } from "@tenure/modules"
import {
  navigationFor,
  resolveModules,
  type ModuleManifest,
  type ModuleProblem,
  type NavSection,
} from "@tenure/module-runtime"

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

export interface SystemModules {
  enabled: readonly ModuleManifest[]
  keys: readonly string[]
  /** Modules the blueprint asked for that this tenant does not get, and why. */
  problems: readonly ModuleProblem[]
}

export function modulesFor(institutionSlug: string): SystemModules {
  const binding = getTenantBinding(institutionSlug)
  if (!binding) {
    // An institution with no binding gets the front door and nothing else.
    // Deliberately not "everything": an unconfigured tenant should look empty,
    // not fully provisioned. Terminology can fall back to defaults because words
    // are cosmetic; capability cannot, because it is not.
    const { ordered, keys, problems } = resolveModules(MODULE_CATALOG, { requested: ["dashboard"] })
    return { enabled: ordered, keys, problems }
  }

  const blueprint = getBlueprint(binding.blueprintId)
  if (!blueprint) {
    throw new Error(
      `Institution "${institutionSlug}" is bound to blueprint "${binding.blueprintId}", which does not exist.`,
    )
  }

  const { ordered, keys, problems } = resolveModules(MODULE_CATALOG, {
    requested: blueprint.modules,
    entitlements: binding.entitlements ?? [],
  })

  return { enabled: ordered, keys, problems }
}

/** True when this system runs a module. The check a feature surface should make. */
export function hasModule(institutionSlug: string, moduleKey: string): boolean {
  return modulesFor(institutionSlug).keys.includes(moduleKey)
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
