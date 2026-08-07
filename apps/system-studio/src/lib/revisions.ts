import { stableStringify, type ConfigRecord } from "@tenure/configuration"

/**
 * GE-032-003 — comparing and rolling back configuration revisions.
 *
 * The publication path (GE-031-006/007) can already plan, block and commit.
 * What an operator could not do afterwards was look at what happened: which
 * revisions exist, what changed between any two of them, and how to get back.
 *
 * ## Rolling back publishes forward
 *
 * A rollback here republishes an earlier revision's layers as a NEW revision.
 * It never rewinds the history, and that is not a technicality — the record of
 * what was live has to survive the decision to stop living with it. An incident
 * review asking "what was the configuration at 14:20" gets an answer either
 * way; only one of them is the truth.
 *
 * The consequence is visible in the UI and worth stating there too: rolling
 * back to revision 3 produces revision 7, not revision 3.
 */

export interface RevisionSummary {
  revision: number
  publishedBy: string
  publishedAt: string
  checksum: string
  /** What this revision could itself return to. Null for the first. */
  rollbackTo: number | null
  /** How many keys its plan changed, for a list an operator scans. */
  changed: number
}

export function summarise(records: readonly ConfigRecord[]): readonly RevisionSummary[] {
  return records.map((record) => ({
    revision: record.revision,
    publishedBy: record.publishedBy,
    publishedAt: record.publishedAt,
    checksum: record.checksum,
    rollbackTo: record.rollbackTo,
    changed: record.plan.impact.keysChanged + record.plan.impact.keysAdded + record.plan.impact.keysRemoved,
  }))
}

export type ChangeKind = "added" | "removed" | "changed"

export interface ValueDifference {
  key: string
  change: ChangeKind
  before?: unknown
  after?: unknown
}

/**
 * What differs between two revisions' resolved values.
 *
 * Deliberately compares RESOLVED values rather than layers. Two different layer
 * stacks can resolve to the same configuration, and an operator comparing
 * revisions is asking what the system does differently — not how the answer was
 * assembled. `provenance` on each record answers the second question.
 *
 * Key order is normalised through `stableStringify`, so a value reserialised by
 * a different writer does not read as a change.
 */
export function compareRevisions(before: ConfigRecord, after: ConfigRecord): readonly ValueDifference[] {
  const keys = [...new Set([...Object.keys(before.values), ...Object.keys(after.values)])].sort()
  const out: ValueDifference[] = []

  for (const key of keys) {
    const inBefore = key in before.values
    const inAfter = key in after.values

    if (inBefore && !inAfter) out.push({ key, change: "removed", before: before.values[key] })
    else if (!inBefore && inAfter) out.push({ key, change: "added", after: after.values[key] })
    else if (stableStringify(before.values[key]) !== stableStringify(after.values[key])) {
      out.push({ key, change: "changed", before: before.values[key], after: after.values[key] })
    }
  }
  return out
}

/** The same rendering the publication plan uses, so two diffs never disagree in style. */
export function renderComparison(differences: readonly ValueDifference[]): string {
  if (differences.length === 0) return "These revisions resolve to the same configuration."
  return differences
    .map((d) => {
      switch (d.change) {
        case "added":
          return `+ ${d.key} = ${stableStringify(d.after)}`
        case "removed":
          return `- ${d.key}  (was ${stableStringify(d.before)})`
        default:
          return `~ ${d.key}: ${stableStringify(d.before)} -> ${stableStringify(d.after)}`
      }
    })
    .join("\n")
}

export interface DependencyEdge {
  from: string
  to: string
}

export interface DependencyGraph {
  nodes: readonly string[]
  edges: readonly DependencyEdge[]
  /** Modules nothing depends on — the roots an operator can disable freely. */
  roots: readonly string[]
  /** Modules with no dependencies of their own. */
  leaves: readonly string[]
}

/**
 * The module dependency graph, as data.
 *
 * Rendered as a list rather than a canvas, on purpose: a `<canvas>` graph has
 * no keyboard path, no screen-reader text, no selectable labels and nothing the
 * layout suite can measure. Bible §26.4 requires an equivalent non-pointer path
 * for every graph view, and for a graph this small the accessible rendering is
 * simply the better one.
 */
export interface GraphModule {
  key: string
  /**
   * `dependsOn` gained a version range, a kind and the ability to name a
   * CAPABILITY rather than a module key (PACK-010-002, PACK-030-003).
   */
  dependsOn?: readonly { module: string }[]
  provides?: readonly string[]
}

/**
 * Every module that could satisfy a dependency target: the key itself, or every
 * module declaring it in `provides`.
 *
 * Resolving here rather than drawing the capability as a node is what keeps the
 * blast radius true. `reimbursements` depends on `finance.ledger` and
 * `budgeting` provides it — an unresolved edge would draw a node nobody can
 * disable and would answer "what breaks if budgeting goes?" with silence.
 */
function satisfiers(modules: readonly GraphModule[], target: string): string[] {
  if (modules.some((m) => m.key === target)) return [target]
  return modules.filter((m) => (m.provides ?? []).includes(target)).map((m) => m.key)
}

export function dependencyGraph(modules: readonly GraphModule[]): DependencyGraph {
  const nodes = modules.map((m) => m.key).sort()
  const edges = modules
    .flatMap((m) =>
      (m.dependsOn ?? []).flatMap((dependency) =>
        satisfiers(modules, dependency.module).map((to) => ({ from: m.key, to })),
      ),
    )
    .sort((a, b) => (a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from)))

  const dependedUpon = new Set(edges.map((e) => e.to))
  const hasDependencies = new Set(edges.map((e) => e.from))

  return {
    nodes,
    edges,
    roots: nodes.filter((n) => !dependedUpon.has(n)),
    leaves: nodes.filter((n) => !hasDependencies.has(n)),
  }
}

/**
 * Everything that would break if a module were disabled.
 *
 * Transitive, because disabling `organizations` breaks `feed`, and whatever
 * depends on `feed`. A list that stopped at the direct dependants would
 * under-report exactly when the blast radius matters most.
 */
export function dependantsOf(
  modules: readonly GraphModule[],
  moduleKey: string,
): readonly string[] {
  const direct = new Map<string, string[]>()
  for (const module of modules) {
    for (const dependency of module.dependsOn ?? []) {
      for (const satisfier of satisfiers(modules, dependency.module)) {
        direct.set(satisfier, [...(direct.get(satisfier) ?? []), module.key])
      }
    }
  }

  const found = new Set<string>()
  const queue = [moduleKey]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const dependant of direct.get(current) ?? []) {
      if (found.has(dependant)) continue
      found.add(dependant)
      queue.push(dependant)
    }
  }
  return [...found].sort()
}
