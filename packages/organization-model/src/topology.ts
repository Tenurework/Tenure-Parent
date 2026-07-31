/**
 * The *shape* an organization system is allowed to take.
 *
 * A topology declares what kinds of node exist and which may contain which. It
 * is what makes two blueprints structurally different rather than differently
 * worded:
 *
 *   university   institution → school → club → board
 *   nonprofit    nonprofit → program → committee
 *
 * Neither is in the code. Both are data, validated against the same rules, and
 * the same graph engine walks both.
 *
 * The alternative — a fixed two-level Institution/Organization model with a
 * comment saying "we could nest these later" — is what the codebase has today,
 * and it is why a holding company with subsidiaries and business units has no
 * representation at all.
 */

export interface OrgUnitType {
  /** Stable identifier, referenced by containment rules and by units. */
  id: string
  label: string
  pluralLabel: string
  description?: string
}

/** `parent` may directly contain `child`. Absence is denial. */
export interface ContainmentRule {
  parent: string
  child: string
}

export interface OrgTopology {
  id: string
  version: string
  /** The type every root unit must be. Exactly one, so "the top" is unambiguous. */
  rootType: string
  types: readonly OrgUnitType[]
  containment: readonly ContainmentRule[]
  /**
   * Optional ceiling on nesting depth (root = depth 0).
   *
   * Not paranoia: an org chart imported from a customer spreadsheet with a
   * self-referential row produces an arbitrarily deep chain, and every
   * ancestor walk in the product then becomes unbounded work per request.
   */
  maxDepth?: number
  /** Relationship kinds that are NOT containment — advising, partnership, reporting lines. */
  relationTypes?: readonly OrgRelationType[]
}

export interface OrgRelationType {
  id: string
  label: string
  /** Types a relation of this kind may run from / to. Empty means any. */
  from?: readonly string[]
  to?: readonly string[]
  /** `a advises b` does not imply `b advises a`; `a partners-with b` does. */
  symmetric?: boolean
}

export class TopologyError extends Error {
  readonly problems: readonly string[]
  constructor(problems: readonly string[]) {
    super(`Invalid organization topology:\n  ${problems.join("\n  ")}`)
    this.name = "TopologyError"
    this.problems = problems
  }
}

/**
 * Check a topology before anything is built on it.
 *
 * Every failure here is one that would otherwise surface as a confusing runtime
 * error much later — a unit whose type nothing can contain looks, at the point
 * of insertion, exactly like a permissions problem.
 */
export function validateTopology(topology: OrgTopology): void {
  const problems: string[] = []
  const typeIds = new Set<string>()

  for (const t of topology.types) {
    if (!t.id) problems.push(`A type has no id.`)
    else if (typeIds.has(t.id)) problems.push(`Duplicate type id "${t.id}".`)
    else typeIds.add(t.id)
    if (!t.label) problems.push(`Type "${t.id}" has no label.`)
  }

  if (topology.types.length === 0) problems.push(`A topology must declare at least one type.`)

  if (!typeIds.has(topology.rootType)) {
    problems.push(`rootType "${topology.rootType}" is not a declared type.`)
  }

  for (const rule of topology.containment) {
    if (!typeIds.has(rule.parent)) problems.push(`Containment rule names unknown parent type "${rule.parent}".`)
    if (!typeIds.has(rule.child)) problems.push(`Containment rule names unknown child type "${rule.child}".`)
    if (rule.child === topology.rootType) {
      problems.push(
        `Containment rule would place the root type "${topology.rootType}" under "${rule.parent}". ` +
          `The root is what nothing contains.`,
      )
    }
  }

  // A type nothing can contain, that is not the root, can never be created. That
  // is always a mistake in the topology and never an intentional statement.
  const containable = new Set(topology.containment.map((r) => r.child))
  for (const t of topology.types) {
    if (t.id !== topology.rootType && !containable.has(t.id)) {
      problems.push(
        `Type "${t.id}" is not the root and no containment rule allows it under anything, ` +
          `so no unit of that type could ever exist.`,
      )
    }
  }

  // Reachability from the root. A rule like `club → board` is useless if nothing
  // can contain a club.
  const childrenOf = new Map<string, string[]>()
  for (const r of topology.containment) {
    childrenOf.set(r.parent, [...(childrenOf.get(r.parent) ?? []), r.child])
  }
  const reachable = new Set<string>([topology.rootType])
  const queue = [topology.rootType]
  while (queue.length > 0) {
    const cur = queue.shift()!
    for (const child of childrenOf.get(cur) ?? []) {
      if (reachable.has(child)) continue
      reachable.add(child)
      queue.push(child)
    }
  }
  for (const t of topology.types) {
    if (!reachable.has(t.id)) {
      problems.push(`Type "${t.id}" is unreachable from the root type "${topology.rootType}".`)
    }
  }

  if (topology.maxDepth !== undefined && topology.maxDepth < 0) {
    problems.push(`maxDepth must not be negative.`)
  }

  const relationIds = new Set<string>()
  for (const rel of topology.relationTypes ?? []) {
    if (relationIds.has(rel.id)) problems.push(`Duplicate relation type id "${rel.id}".`)
    relationIds.add(rel.id)
    for (const t of [...(rel.from ?? []), ...(rel.to ?? [])]) {
      if (!typeIds.has(t)) problems.push(`Relation type "${rel.id}" names unknown unit type "${t}".`)
    }
  }

  if (problems.length > 0) throw new TopologyError(problems)
}

/** True when `parent` may directly contain `child` under this topology. */
export function mayContain(topology: OrgTopology, parent: string, child: string): boolean {
  return topology.containment.some((r) => r.parent === parent && r.child === child)
}

export function typeOf(topology: OrgTopology, id: string): OrgUnitType | undefined {
  return topology.types.find((t) => t.id === id)
}
