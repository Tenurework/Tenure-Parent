import {
  ENABLEABLE,
  validateManifest,
  type ModuleManifest,
  type ModuleNavEntry,
} from "./manifest"

/** The set of modules a running system knows about. Immutable once built. */
export class ModuleCatalog {
  private readonly byKey: ReadonlyMap<string, ModuleManifest>

  private constructor(byKey: ReadonlyMap<string, ModuleManifest>) {
    this.byKey = byKey
  }

  static of(manifests: readonly ModuleManifest[]): ModuleCatalog {
    const byKey = new Map<string, ModuleManifest>()
    for (const m of manifests) {
      validateManifest(m)
      if (byKey.has(m.key)) {
        throw new Error(`Duplicate module key "${m.key}".`)
      }
      byKey.set(m.key, m)
    }

    // Dependencies naming modules that do not exist are a catalog defect, not a
    // per-tenant one, and should fail once here rather than for every tenant.
    const problems: string[] = []
    for (const m of byKey.values()) {
      for (const dep of m.dependsOn ?? []) {
        if (!byKey.has(dep)) problems.push(`Module "${m.key}" depends on "${dep}", which is not in the catalog.`)
      }
      for (const inc of m.incompatibleWith ?? []) {
        if (!byKey.has(inc)) problems.push(`Module "${m.key}" is incompatible with "${inc}", which is not in the catalog.`)
      }
    }
    if (problems.length > 0) throw new Error(`Invalid module catalog:\n  ${problems.join("\n  ")}`)

    return new ModuleCatalog(byKey)
  }

  get(key: string): ModuleManifest | undefined {
    return this.byKey.get(key)
  }

  has(key: string): boolean {
    return this.byKey.has(key)
  }

  keys(): string[] {
    return [...this.byKey.keys()].sort()
  }

  all(): ModuleManifest[] {
    return this.keys().map((k) => this.byKey.get(k)!)
  }

  get size(): number {
    return this.byKey.size
  }
}

export interface ModuleProblem {
  moduleKey: string
  reason:
    | "unknown-module"
    | "not-enableable"
    | "missing-dependency"
    | "incompatible"
    | "missing-entitlement"
    | "dependency-cycle"
  detail: string
}

export class ModuleResolutionError extends Error {
  readonly problems: readonly ModuleProblem[]
  constructor(problems: readonly ModuleProblem[]) {
    super(
      `Modules did not resolve (${problems.length}):\n` +
        problems.map((p) => `  [${p.reason}] ${p.moduleKey}: ${p.detail}`).join("\n"),
    )
    this.name = "ModuleResolutionError"
    this.problems = problems
  }
}

export interface ResolveModulesInput {
  /** Modules the system asks for, by key. Order is irrelevant. */
  requested: readonly string[]
  /** Entitlements the tenant holds. */
  entitlements?: readonly string[]
}

export interface ResolvedModules {
  /** Enabled modules in dependency order — dependencies before dependants. */
  ordered: readonly ModuleManifest[]
  keys: readonly string[]
  problems: readonly ModuleProblem[]
}

/**
 * Work out which modules a system runs, or refuse.
 *
 * **Dependencies are not auto-added.** A package manager quietly installing what
 * you did not ask for is convenient; a platform quietly enabling a module a
 * customer did not buy, and did not appear in the release artifact anyone
 * approved, is not. A missing dependency is reported with the exact keys to add,
 * and `expandDependencies` exists so the Studio can offer to add them — as a
 * visible edit to the request rather than a silent one to the result.
 *
 * Fail closed throughout: a missing entitlement disables the module and says so;
 * it does not degrade to a partially-working feature.
 */
export function resolveModules(catalog: ModuleCatalog, input: ResolveModulesInput): ResolvedModules {
  const problems: ModuleProblem[] = []
  const entitlements = new Set(input.entitlements ?? [])
  const requested = [...new Set(input.requested)]

  const accepted = new Map<string, ModuleManifest>()

  for (const key of requested) {
    const m = catalog.get(key)
    if (!m) {
      problems.push({ moduleKey: key, reason: "unknown-module", detail: `No module with that key.` })
      continue
    }
    if (!ENABLEABLE.has(m.lifecycle)) {
      problems.push({
        moduleKey: key,
        reason: "not-enableable",
        detail: `Lifecycle is "${m.lifecycle}"; only approved, available or deprecated modules can be enabled.`,
      })
      continue
    }
    if (m.requiresEntitlement && !entitlements.has(m.requiresEntitlement)) {
      problems.push({
        moduleKey: key,
        reason: "missing-entitlement",
        detail: `Requires entitlement "${m.requiresEntitlement}", which this tenant does not hold.`,
      })
      continue
    }
    accepted.set(key, m)
  }

  for (const m of accepted.values()) {
    for (const dep of m.dependsOn ?? []) {
      if (!accepted.has(dep)) {
        problems.push({
          moduleKey: m.key,
          reason: "missing-dependency",
          detail: `Needs "${dep}", which is not enabled. Add it to the requested set.`,
        })
      }
    }
    for (const inc of m.incompatibleWith ?? []) {
      if (accepted.has(inc)) {
        problems.push({
          moduleKey: m.key,
          reason: "incompatible",
          detail: `Cannot be enabled alongside "${inc}".`,
        })
      }
    }
  }

  // Topological order, with cycle detection. Enable order matters: a module's
  // migrations and configuration have to land after the ones it depends on.
  const ordered: ModuleManifest[] = []
  const state = new Map<string, 0 | 1 | 2>()

  const visit = (key: string, stack: string[]): void => {
    const s = state.get(key)
    if (s === 2) return
    if (s === 1) {
      const start = stack.indexOf(key)
      problems.push({
        moduleKey: key,
        reason: "dependency-cycle",
        detail: `Dependency cycle: ${[...stack.slice(start), key].join(" → ")}.`,
      })
      return
    }
    state.set(key, 1)
    const m = accepted.get(key)
    for (const dep of m?.dependsOn ?? []) {
      if (accepted.has(dep)) visit(dep, [...stack, key])
    }
    state.set(key, 2)
    if (m) ordered.push(m)
  }

  for (const key of [...accepted.keys()].sort()) visit(key, [])

  return {
    ordered,
    keys: ordered.map((m) => m.key),
    problems,
  }
}

/** Resolve, or throw. The shape a request path wants. */
export function resolveModulesOrThrow(
  catalog: ModuleCatalog,
  input: ResolveModulesInput,
): ResolvedModules {
  const result = resolveModules(catalog, input)
  if (result.problems.length > 0) throw new ModuleResolutionError(result.problems)
  return result
}

/**
 * The requested set plus everything it transitively depends on.
 *
 * Offered to an operator so they can see and approve the expansion, rather than
 * applied inside resolution where nobody would.
 */
export function expandDependencies(
  catalog: ModuleCatalog,
  requested: readonly string[],
): string[] {
  const out = new Set<string>()
  const queue = [...requested]
  while (queue.length > 0) {
    const key = queue.shift()!
    if (out.has(key)) continue
    out.add(key)
    for (const dep of catalog.get(key)?.dependsOn ?? []) queue.push(dep)
  }
  return [...out].sort()
}

export interface NavSection {
  label: string
  order: number
  items: readonly ModuleNavEntry[]
}

/**
 * Navigation contributed by the enabled modules, grouped and ordered.
 *
 * Two modules may contribute to one section — that is the point of sections
 * being named rather than owned. Section order is the lowest `sectionOrder` any
 * contributor declares, so adding a module cannot silently reorder the menu.
 *
 * `capabilities` filters entries the principal cannot use. Passing `null` means
 * "do not filter", for operator views that show the whole menu.
 */
export function navigationFor(
  modules: readonly ModuleManifest[],
  capabilities: ReadonlySet<string> | null,
): NavSection[] {
  const sections = new Map<string, { order: number; items: ModuleNavEntry[] }>()

  for (const m of modules) {
    for (const entry of m.navigation ?? []) {
      if (entry.requiresCapability && capabilities && !capabilities.has(entry.requiresCapability)) {
        continue
      }
      const existing = sections.get(entry.section)
      if (existing) {
        existing.order = Math.min(existing.order, entry.sectionOrder)
        existing.items.push(entry)
      } else {
        sections.set(entry.section, { order: entry.sectionOrder, items: [entry] })
      }
    }
  }

  return [...sections.entries()]
    .map(([label, { order, items }]) => ({
      label,
      order,
      // Ties broken by id so the menu is stable rather than dependent on catalog
      // iteration order.
      items: [...items].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1)),
    }))
    .sort((a, b) => a.order - b.order || (a.label < b.label ? -1 : 1))
}
