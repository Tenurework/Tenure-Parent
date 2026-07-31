import {
  mayContain,
  validateTopology,
  type OrgTopology,
} from "./topology"

/**
 * One period during which a unit sat under a given parent.
 *
 * Parentage is effective-dated rather than a single `parentId` column because
 * reorganizations are the normal case, not an exception: a club moves between
 * schools, a business unit moves between subsidiaries, and an approval routed
 * last March has to be explicable against the structure that existed in March.
 * A mutable `parentId` answers "where is it now?" and destroys the evidence for
 * every question about the past.
 */
export interface Parentage {
  parentId: string
  effectiveFrom: string
  /** Exclusive. `null` means "still, as far as anyone knows". */
  effectiveTo?: string | null
}

export interface OrgUnitInput {
  id: string
  typeId: string
  name: string
  effectiveFrom: string
  effectiveTo?: string | null
  /** Archived units keep their history and stop appearing in current views. */
  archivedAt?: string | null
  /** Empty or absent means this is a root. */
  parentage?: readonly Parentage[]
}

/** A typed, non-hierarchical edge: advising, partnership, a dotted reporting line. */
export interface OrgRelationInput {
  typeId: string
  fromId: string
  toId: string
  effectiveFrom: string
  effectiveTo?: string | null
}

export class OrgGraphError extends Error {
  readonly problems: readonly string[]
  constructor(problems: readonly string[]) {
    super(`Invalid organization graph:\n  ${problems.join("\n  ")}`)
    this.name = "OrgGraphError"
    this.problems = problems
  }
}

const ts = (iso: string): number => Date.parse(iso)

/** Half-open [from, to). Touching intervals do not overlap; that is the point. */
function overlaps(
  aFrom: string,
  aTo: string | null | undefined,
  bFrom: string,
  bTo: string | null | undefined,
): boolean {
  const aStart = ts(aFrom)
  const aEnd = aTo ? ts(aTo) : Number.POSITIVE_INFINITY
  const bStart = ts(bFrom)
  const bEnd = bTo ? ts(bTo) : Number.POSITIVE_INFINITY
  return aStart < bEnd && bStart < aEnd
}

function coversAt(from: string, to: string | null | undefined, at: number): boolean {
  return ts(from) <= at && (to == null || ts(to) > at)
}

/**
 * Each live unit's parent *as declared* at an instant.
 *
 * `null` means the unit genuinely has no parent — a root. A parent id that is
 * not itself live means the unit is orphaned, which callers must distinguish
 * from being a root: one is the top of the organization, the other is a
 * dangling subtree, and treating them alike is how archiving a school promotes
 * its clubs to institutions.
 */
function declaredParents(
  live: ReadonlyMap<string, OrgUnitInput>,
  instant: number,
): Map<string, string | null> {
  const out = new Map<string, string | null>()
  for (const u of live.values()) {
    const active = (u.parentage ?? []).find((p) => coversAt(p.effectiveFrom, p.effectiveTo, instant))
    out.set(u.id, active ? active.parentId : null)
  }
  return out
}

export interface ResolvedUnit {
  id: string
  typeId: string
  name: string
  parentId: string | null
  depth: number
}

/**
 * The hierarchy as it stood at one instant.
 *
 * Every question about structure is asked of a snapshot, not of the graph,
 * because "the parent of this club" has no answer without a date.
 */
export class OrgSnapshot {
  readonly at: string
  private readonly units: ReadonlyMap<string, ResolvedUnit>
  private readonly childrenOf: ReadonlyMap<string, readonly string[]>

  constructor(at: string, units: ReadonlyMap<string, ResolvedUnit>) {
    this.at = at
    this.units = units
    const children = new Map<string, string[]>()
    for (const u of units.values()) {
      if (u.parentId == null) continue
      children.set(u.parentId, [...(children.get(u.parentId) ?? []), u.id])
    }
    for (const [k, v] of children) children.set(k, v.sort())
    this.childrenOf = children
  }

  get size(): number {
    return this.units.size
  }

  has(id: string): boolean {
    return this.units.has(id)
  }

  get(id: string): ResolvedUnit | undefined {
    return this.units.get(id)
  }

  all(): ResolvedUnit[] {
    return [...this.units.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }

  roots(): ResolvedUnit[] {
    return this.all().filter((u) => u.parentId == null)
  }

  children(id: string): ResolvedUnit[] {
    return (this.childrenOf.get(id) ?? []).map((cid) => this.units.get(cid)!)
  }

  /** Nearest first, root last. Empty for a root. */
  ancestors(id: string): ResolvedUnit[] {
    const out: ResolvedUnit[] = []
    const seen = new Set<string>([id])
    let cur = this.units.get(id)
    while (cur?.parentId != null) {
      // The graph is validated acyclic, but this walk also runs on snapshots
      // built by callers, so it refuses to spin rather than trusting that.
      if (seen.has(cur.parentId)) break
      seen.add(cur.parentId)
      const parent = this.units.get(cur.parentId)
      if (!parent) break
      out.push(parent)
      cur = parent
    }
    return out
  }

  /** Breadth-first, excluding `id` itself. */
  descendants(id: string): ResolvedUnit[] {
    const out: ResolvedUnit[] = []
    const seen = new Set<string>([id])
    const queue = [...(this.childrenOf.get(id) ?? [])]
    while (queue.length > 0) {
      const cur = queue.shift()!
      if (seen.has(cur)) continue
      seen.add(cur)
      const unit = this.units.get(cur)
      if (!unit) continue
      out.push(unit)
      queue.push(...(this.childrenOf.get(cur) ?? []))
    }
    return out
  }

  /** Root first, `id` last — the breadcrumb. */
  path(id: string): ResolvedUnit[] {
    const unit = this.units.get(id)
    if (!unit) return []
    return [...this.ancestors(id).reverse(), unit]
  }

  isAncestorOf(ancestorId: string, descendantId: string): boolean {
    return this.ancestors(descendantId).some((a) => a.id === ancestorId)
  }

  /** Units of one type, anywhere in the tree. */
  ofType(typeId: string): ResolvedUnit[] {
    return this.all().filter((u) => u.typeId === typeId)
  }
}

export class OrgGraph {
  readonly topology: OrgTopology
  private readonly units: readonly OrgUnitInput[]
  private readonly relations: readonly OrgRelationInput[]

  constructor(topology: OrgTopology, units: readonly OrgUnitInput[], relations: readonly OrgRelationInput[]) {
    this.topology = topology
    this.units = units
    this.relations = relations
  }

  /** Every instant at which the structure changes. Validation checks each one. */
  criticalDates(): string[] {
    const dates = new Set<string>()
    for (const u of this.units) {
      dates.add(u.effectiveFrom)
      if (u.effectiveTo) dates.add(u.effectiveTo)
      if (u.archivedAt) dates.add(u.archivedAt)
      for (const p of u.parentage ?? []) {
        dates.add(p.effectiveFrom)
        if (p.effectiveTo) dates.add(p.effectiveTo)
      }
    }
    return [...dates].sort((a, b) => ts(a) - ts(b))
  }

  /**
   * The hierarchy at one instant.
   *
   * Units not yet effective, already ended, or archived by then are absent —
   * along with everything beneath them, because a subtree hanging off a unit
   * that does not exist is not a tree.
   */
  asOf(at: string, options: { includeArchived?: boolean } = {}): OrgSnapshot {
    const instant = ts(at)
    const live = new Map<string, OrgUnitInput>()

    for (const u of this.units) {
      if (!coversAt(u.effectiveFrom, u.effectiveTo, instant)) continue
      if (!options.includeArchived && u.archivedAt != null && ts(u.archivedAt) <= instant) continue
      live.set(u.id, u)
    }

    const declared = declaredParents(live, instant)

    // Reachability, not just parenthood. A unit whose declared parent is not live
    // at this instant — because the parent was archived, or ended — is *orphaned*,
    // and an orphan is excluded along with everything beneath it.
    //
    // Promoting it to a root instead, which is the easy mistake, would show every
    // club of an archived school sitting directly under nothing, as a second root
    // beside the institution. Archiving a school would silently restructure the
    // organization rather than hide it.
    const resolved = new Map<string, ResolvedUnit>()
    const depths = new Map<string, number>()

    const depthOf = (id: string, seen: Set<string>): number | null => {
      const memo = depths.get(id)
      if (memo !== undefined) return memo

      const parent = declared.get(id)
      if (parent === undefined) return null // not live
      if (parent === null) {
        depths.set(id, 0)
        return 0
      }
      if (!live.has(parent)) return null // orphaned
      if (seen.has(parent)) return null // cycle: refuse to spin
      seen.add(parent)

      const parentDepth = depthOf(parent, seen)
      if (parentDepth === null) return null // inherits the orphaning

      depths.set(id, parentDepth + 1)
      return parentDepth + 1
    }

    for (const u of live.values()) {
      const depth = depthOf(u.id, new Set([u.id]))
      if (depth === null) continue
      resolved.set(u.id, {
        id: u.id,
        typeId: u.typeId,
        name: u.name,
        parentId: declared.get(u.id) ?? null,
        depth,
      })
    }

    return new OrgSnapshot(at, resolved)
  }

  /** Relations live at an instant. */
  relationsAsOf(at: string): OrgRelationInput[] {
    const instant = ts(at)
    return this.relations.filter((r) => coversAt(r.effectiveFrom, r.effectiveTo, instant))
  }
}

/**
 * Build and validate a graph.
 *
 * Validation runs at every critical date rather than only at "now", because a
 * structure can be legal today and illegal next month — a parentage that starts
 * before its parent exists, or a reorganization that closes a cycle for three
 * weeks. Checking only the present is how that ships.
 */
export function buildOrgGraph(
  topology: OrgTopology,
  units: readonly OrgUnitInput[],
  relations: readonly OrgRelationInput[] = [],
): OrgGraph {
  validateTopology(topology)

  const problems: string[] = []
  const typeIds = new Set(topology.types.map((t) => t.id))
  const byId = new Map<string, OrgUnitInput>()

  for (const u of units) {
    if (!u.id) problems.push(`A unit has no id.`)
    else if (byId.has(u.id)) problems.push(`Duplicate unit id "${u.id}".`)
    else byId.set(u.id, u)

    if (!typeIds.has(u.typeId)) {
      problems.push(`Unit "${u.id}" has type "${u.typeId}", which the topology does not declare.`)
    }
    if (Number.isNaN(ts(u.effectiveFrom))) {
      problems.push(`Unit "${u.id}" has an unparseable effectiveFrom ${JSON.stringify(u.effectiveFrom)}.`)
    }
    if (u.effectiveTo && ts(u.effectiveTo) <= ts(u.effectiveFrom)) {
      problems.push(`Unit "${u.id}" ends at or before it starts.`)
    }

    const parentage = u.parentage ?? []
    for (let i = 0; i < parentage.length; i++) {
      const p = parentage[i]
      if (p.parentId === u.id) problems.push(`Unit "${u.id}" is its own parent.`)
      if (p.effectiveTo && ts(p.effectiveTo) <= ts(p.effectiveFrom)) {
        problems.push(`Unit "${u.id}" has a parentage period ending at or before it starts.`)
      }
      // A unit cannot sit under a parent before it exists or after it ends.
      if (ts(p.effectiveFrom) < ts(u.effectiveFrom)) {
        problems.push(
          `Unit "${u.id}" has a parentage starting ${p.effectiveFrom}, before the unit itself starts ${u.effectiveFrom}.`,
        )
      }
      for (let j = i + 1; j < parentage.length; j++) {
        const q = parentage[j]
        if (overlaps(p.effectiveFrom, p.effectiveTo, q.effectiveFrom, q.effectiveTo)) {
          problems.push(
            `Unit "${u.id}" has two parents at once: "${p.parentId}" and "${q.parentId}" overlap. ` +
              `A unit sits in one place at a time; a dotted line is a relation, not containment.`,
          )
        }
      }
    }
  }

  for (const u of units) {
    for (const p of u.parentage ?? []) {
      if (!byId.has(p.parentId)) {
        problems.push(`Unit "${u.id}" names parent "${p.parentId}", which does not exist.`)
      }
    }
  }

  for (const r of relations) {
    const relType = (topology.relationTypes ?? []).find((t) => t.id === r.typeId)
    if (!relType) {
      problems.push(`Relation of type "${r.typeId}" is not declared by the topology.`)
      continue
    }
    const from = byId.get(r.fromId)
    const to = byId.get(r.toId)
    if (!from) problems.push(`Relation "${r.typeId}" names unknown unit "${r.fromId}".`)
    if (!to) problems.push(`Relation "${r.typeId}" names unknown unit "${r.toId}".`)
    if (from && relType.from?.length && !relType.from.includes(from.typeId)) {
      problems.push(`Relation "${r.typeId}" may not start at a "${from.typeId}".`)
    }
    if (to && relType.to?.length && !relType.to.includes(to.typeId)) {
      problems.push(`Relation "${r.typeId}" may not end at a "${to.typeId}".`)
    }
  }

  if (problems.length > 0) throw new OrgGraphError(problems)

  const graph = new OrgGraph(topology, units, relations)

  // Structural checks, at every instant the structure changes.
  for (const date of graph.criticalDates()) {
    const instant = ts(date)
    const live = units.filter(
      (u) => coversAt(u.effectiveFrom, u.effectiveTo, instant) && !(u.archivedAt && ts(u.archivedAt) <= instant),
    )
    const liveIds = new Set(live.map((u) => u.id))
    const parentAt = declaredParents(new Map(live.map((u) => [u.id, u])), instant)

    // Cycles. Iterative three-colour DFS so a deep chain cannot blow the stack,
    // and so the reported problem names the cycle instead of "something is wrong".
    const state = new Map<string, 0 | 1 | 2>()
    for (const u of live) {
      if (state.get(u.id)) continue
      const chain: string[] = []
      let cur: string | null = u.id
      while (cur != null && state.get(cur) !== 2) {
        if (state.get(cur) === 1) {
          const start = chain.indexOf(cur)
          problems.push(
            `At ${date} the hierarchy contains a cycle: ${[...chain.slice(start), cur].join(" → ")}.`,
          )
          break
        }
        state.set(cur, 1)
        chain.push(cur)
        cur = parentAt.get(cur) ?? null
      }
      for (const id of chain) state.set(id, 2)
    }

    for (const u of live) {
      const parentId = parentAt.get(u.id)

      if (parentId == null) {
        if (u.typeId !== topology.rootType) {
          problems.push(
            `At ${date} unit "${u.id}" of type "${u.typeId}" has no parent, but only "${topology.rootType}" may be a root.`,
          )
        }
        continue
      }

      // Orphaned, not root: the parent exists in the data but is not live at this
      // instant, because it was archived or ended. That is a normal operational
      // state — archiving a school does not invalidate its clubs — and the
      // snapshot excludes the subtree rather than rejecting the whole graph.
      // Containment is still checked below against the parent's declared type,
      // so an orphan cannot smuggle in an illegal shape for later.
      if (!liveIds.has(parentId)) {
        const parent = byId.get(parentId)!
        if (!mayContain(topology, parent.typeId, u.typeId)) {
          problems.push(
            `At ${date} "${u.id}" (${u.typeId}) declares parent "${parentId}" (${parent.typeId}), ` +
              `which the topology does not allow.`,
          )
        }
        continue
      }

      const parent = byId.get(parentId)!
      if (!mayContain(topology, parent.typeId, u.typeId)) {
        problems.push(
          `At ${date} "${u.id}" (${u.typeId}) sits under "${parentId}" (${parent.typeId}), ` +
            `which the topology does not allow.`,
        )
      }
    }

    if (topology.maxDepth !== undefined) {
      const snapshot = graph.asOf(date)
      for (const u of snapshot.all()) {
        if (u.depth > topology.maxDepth) {
          problems.push(
            `At ${date} unit "${u.id}" is at depth ${u.depth}, past the topology's maxDepth of ${topology.maxDepth}.`,
          )
        }
      }
    }
  }

  if (problems.length > 0) throw new OrgGraphError(problems)
  return graph
}
