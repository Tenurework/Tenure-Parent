/**
 * What a module declares about itself.
 *
 * A module is a unit of product capability that a system can have or not have —
 * events, budgeting, reimbursements, organizational memory. The point of a
 * manifest is that enabling one is a *decision recorded in a release*, not a
 * feature flag someone flipped, and that the consequences of enabling it are
 * knowable before it happens.
 *
 * Deliberately smaller than the architecture's twelve declaration arrays. Each
 * field here is one something already reads. A manifest that declares workflow
 * actions, form components and integration hooks before any of those engines
 * exist is a manifest whose declarations cannot be wrong, because nothing checks
 * them — and that is worse than not declaring them.
 */

/**
 * Where a module is in its life.
 *
 * Only `approved` and `available` may be enabled. The others exist so that
 * "why can't I turn this on?" has a specific answer instead of a 404.
 */
export const MODULE_LIFECYCLE = [
  "development",
  "validated",
  "approved",
  "available",
  "deprecated",
  "retired",
] as const

export type ModuleLifecycle = (typeof MODULE_LIFECYCLE)[number]

/** Lifecycle states in which a module may be turned on. */
export const ENABLEABLE: ReadonlySet<ModuleLifecycle> = new Set<ModuleLifecycle>([
  "approved",
  "available",
  // Deprecated is deliberately included: a tenant that already has it keeps
  // working. Deprecation is a signal to stop adopting, not an outage.
  "deprecated",
])

export interface ModuleNavEntry {
  /** Stable id, namespaced by the module that owns it. */
  id: string
  label: string
  href: string
  /** Section heading it appears under. Sections are ordered by `sectionOrder`. */
  section: string
  sectionOrder: number
  /** Order within the section. */
  order: number
  /** Icon name resolved by the UI. Kept a string so this package stays render-free. */
  icon: string
  /**
   * A named UI behaviour instead of navigation, e.g. opening a panel.
   *
   * A string the UI resolves, not a handler: this package must stay renderable
   * from a server component and serializable across the boundary, so it names
   * behaviour rather than carrying it.
   */
  action?: string
  /**
   * Capability a principal must hold for this entry to appear.
   *
   * Navigation is not authorization: hiding a link does not protect the route,
   * and the route must check for itself. This exists so the menu does not offer
   * people things they cannot do.
   */
  requiresCapability?: string
}

export interface ModuleManifest {
  /** Stable key, lowerCamelCase. Namespaces everything the module owns. */
  key: string
  version: string
  name: string
  description: string

  lifecycle: ModuleLifecycle

  /** Modules that must also be enabled. Not auto-added — see resolveModules. */
  dependsOn?: readonly string[]

  /** Modules that must NOT be enabled alongside this one. */
  incompatibleWith?: readonly string[]

  /** Entitlement a tenant must hold. Absent means available to every tenant. */
  requiresEntitlement?: string

  /** Permission keys the module introduces. Namespaced under `key`. */
  permissions?: readonly string[]

  navigation?: readonly ModuleNavEntry[]
}

export class ModuleManifestError extends Error {
  readonly problems: readonly string[]
  constructor(problems: readonly string[]) {
    super(`Invalid module manifest:\n  ${problems.join("\n  ")}`)
    this.name = "ModuleManifestError"
    this.problems = problems
  }
}

const KEY = /^[a-z][a-zA-Z0-9]*$/

export function validateManifest(m: ModuleManifest): void {
  const problems: string[] = []
  const where = `Module "${m.key}"`

  if (!KEY.test(m.key ?? "")) {
    problems.push(`Module key ${JSON.stringify(m.key)} must be lowerCamelCase.`)
  }
  if (!m.version) problems.push(`${where} has no version.`)
  if (!m.name) problems.push(`${where} has no name.`)
  if (!MODULE_LIFECYCLE.includes(m.lifecycle)) {
    problems.push(`${where} has unknown lifecycle ${JSON.stringify(m.lifecycle)}.`)
  }

  if (m.dependsOn?.includes(m.key)) problems.push(`${where} depends on itself.`)
  if (m.incompatibleWith?.includes(m.key)) problems.push(`${where} is incompatible with itself.`)

  for (const dep of m.dependsOn ?? []) {
    if (m.incompatibleWith?.includes(dep)) {
      problems.push(`${where} both depends on and is incompatible with "${dep}".`)
    }
  }

  // A permission that is not namespaced under its module cannot be traced back
  // to whoever is responsible for it. The architecture states this rule and
  // then breaks it in its own finance example.
  for (const p of m.permissions ?? []) {
    if (!p.startsWith(`${m.key}.`)) {
      problems.push(`${where} declares permission "${p}", which is not namespaced under "${m.key}.".`)
    }
  }

  const navIds = new Set<string>()
  for (const nav of m.navigation ?? []) {
    if (!nav.id.startsWith(`${m.key}.`)) {
      problems.push(`${where} declares nav entry "${nav.id}", which is not namespaced under "${m.key}.".`)
    }
    if (navIds.has(nav.id)) problems.push(`${where} declares nav entry "${nav.id}" twice.`)
    navIds.add(nav.id)
    if (!nav.href.startsWith("/")) {
      problems.push(`${where} nav entry "${nav.id}" has href "${nav.href}", which is not an app path.`)
    }
    if (!nav.label) problems.push(`${where} nav entry "${nav.id}" has no label.`)
  }

  if (problems.length > 0) throw new ModuleManifestError(problems)
}
