/**
 * CFG-030-002 / CFG-030-003 — the graph algorithms the configurator needs, once.
 *
 * Bible §11 states ten compilation steps. Three of them are graph problems and
 * this module owns all three, for every caller:
 *
 *   step 6 — "Detect cycles and produce a human-readable minimal cycle path."
 *   step 8 — "Topologically order evaluation groups."
 *   §16    — "Evaluate only affected subgraphs after a change."
 *
 * ## Why this file exists rather than a third depth-first search
 *
 * There were two cycle detectors in this package before it: one over named
 * expressions (`expressionCycles`) and one over the module catalogue
 * (`moduleGraphRejections`). Both were the same twenty lines of depth-first
 * search with the same de-duplication trick, and both answered a question the
 * Bible does not ask. They reported *a* cycle — whichever one the traversal
 * order happened to close first — and §11 step 6 asks for the **minimal** one.
 *
 * The difference is not academic. Given `a → b → c → a` and also `a → c`, a
 * depth-first search entering at `a` reports `a → b → c → a`, and the operator
 * reading it goes and looks at `b`, which has nothing to do with the shortest
 * cycle `a → c → a`. A minimal path names the smallest set of declarations that
 * actually cannot be ordered, which is the set somebody has to edit.
 *
 * So both callers now delegate here and there is one implementation. That was
 * the point of writing it: the repository already carries a note about what
 * having two parsers cost.
 *
 * ## One edge direction, stated once
 *
 * Throughout this module an adjacency entry maps a node to the nodes it
 * **depends on** — its prerequisites. `a → b` reads "a needs b". Both existing
 * callers already meant this (`dependsOn` for modules, the referenced names for
 * an expression), and the reported cycle text reads in that direction too, so
 * `a → b → a` is "a needs b needs a".
 *
 * ## Determinism, because these answers end up in a digest
 *
 * Every output of this module is a function of the edge SET, never of insertion
 * order: groups are sorted, cycle paths are rotated to start at their
 * lowest-sorting member, and cycles are reported in sorted order. A graph loaded
 * from DynamoDB in one order and from a YAML file in another produces byte-equal
 * output, which is what makes a snapshot digest (CFG-030-001) mean anything.
 */

/** Node → the nodes it depends on. A node with no entry has no prerequisites. */
export type Adjacency = ReadonlyMap<string, readonly string[]>

/**
 * Build an adjacency map, including every node named anywhere as a key.
 *
 * A prerequisite nobody declared still has to appear as a node, or a topological
 * order would silently omit it and an "affected" walk would stop short at it.
 */
export function adjacencyOf(entries: Iterable<readonly [string, readonly string[]]>): Adjacency {
  const map = new Map<string, readonly string[]>()
  for (const [node, dependsOn] of entries) {
    // De-duplicated and sorted here so every later answer is order-free.
    map.set(node, [...new Set(dependsOn)].sort())
  }
  for (const dependencies of [...map.values()]) {
    for (const dependency of dependencies) if (!map.has(dependency)) map.set(dependency, [])
  }
  return map
}

/** Every node, sorted. */
export function nodesOf(adjacency: Adjacency): readonly string[] {
  return [...adjacency.keys()].sort()
}

/** Reverse the edges: node → the nodes that depend on it. */
export function dependentsOf(adjacency: Adjacency): Adjacency {
  const reversed = new Map<string, string[]>()
  for (const node of adjacency.keys()) reversed.set(node, [])
  for (const [node, dependencies] of adjacency) {
    for (const dependency of dependencies) reversed.get(dependency)!.push(node)
  }
  const out = new Map<string, readonly string[]>()
  for (const [node, dependents] of reversed) out.set(node, [...new Set(dependents)].sort())
  return out
}

/**
 * The shortest cycle through each node, de-duplicated, as readable paths.
 *
 * Breadth-first from each node back to itself, which is what makes the answer
 * minimal: the first return is the shortest one, where a depth-first search
 * returns whichever the traversal happened to close. Cycles are de-duplicated by
 * their member SET, so one cycle is one finding rather than one per participant,
 * and each path is rotated to begin at its lowest-sorting member so the text
 * does not depend on where the search started.
 *
 * A distinct minimal cycle over a different member set IS reported separately:
 * `a → b → a` inside a longer `a → b → c → d → a` are two things to fix, and
 * collapsing them to one would hide the shorter one behind the longer.
 *
 * Formatted as `a → b → a` — the repeat at the end is deliberate, because a
 * cycle rendered without it reads as a path.
 */
export function minimalCyclePaths(adjacency: Adjacency): readonly string[] {
  const found = new Map<string, string>()

  for (const start of nodesOf(adjacency)) {
    // Breadth-first, carrying the path so the cycle can be printed. Predecessor
    // maps are cheaper but a node can be reached by several shortest paths and
    // the printed one then depends on which was written last.
    const queue: string[][] = [[start]]
    let cycle: readonly string[] | null = null
    const seen = new Set<string>()

    while (queue.length > 0 && cycle === null) {
      const path = queue.shift()!
      const tail = path[path.length - 1]
      for (const next of adjacency.get(tail) ?? []) {
        if (next === start) {
          cycle = path
          break
        }
        if (seen.has(next)) continue
        seen.add(next)
        queue.push([...path, next])
      }
    }

    if (cycle === null) continue
    const signature = [...cycle].sort().join("\u0000")
    if (found.has(signature)) continue

    // Rotate to the lowest-sorting member so two starts that find the same
    // cycle print the same text.
    const lowest = cycle.indexOf([...cycle].sort()[0])
    const rotated = [...cycle.slice(lowest), ...cycle.slice(0, lowest)]
    found.set(signature, [...rotated, rotated[0]].join(" → "))
  }

  return [...found.values()].sort()
}

export interface TopologicalOrder {
  /**
   * Evaluation groups, prerequisites first. Everything in one group is
   * independent of everything else in it, so a group is also the unit that could
   * be evaluated in parallel.
   */
  groups: readonly (readonly string[])[]
  /**
   * Nodes no group could contain, because they are in or downstream of a cycle.
   *
   * Reported rather than omitted, and rather than thrown. A caller that gets
   * back groups covering 900 of 1,000 nodes and no word about the other 100 has
   * been handed a partial order that looks total — the failure this codebase
   * calls collapsing "we looked and found nothing" into "we could not look".
   */
  unordered: readonly string[]
  /** Minimal cycle paths, when `unordered` is non-empty. */
  cycles: readonly string[]
}

/**
 * Kahn's algorithm by levels, deterministic within each level.
 *
 * Groups rather than a flat order because §11 step 8 says "evaluation groups",
 * and because a flat order implies a sequence where none exists: two nodes with
 * no relationship must not appear to have one, or a later change that reorders
 * them looks like a change in meaning.
 */
export function topologicalGroups(adjacency: Adjacency): TopologicalOrder {
  const remaining = new Map<string, Set<string>>()
  for (const [node, dependencies] of adjacency) remaining.set(node, new Set(dependencies))

  const groups: string[][] = []
  const placed = new Set<string>()

  for (;;) {
    const ready = [...remaining.keys()]
      .filter((node) => [...remaining.get(node)!].every((d) => placed.has(d)))
      .sort()
    if (ready.length === 0) break
    for (const node of ready) {
      placed.add(node)
      remaining.delete(node)
    }
    groups.push(ready)
  }

  const unordered = [...remaining.keys()].sort()
  return {
    groups,
    unordered,
    cycles: unordered.length === 0 ? [] : minimalCyclePaths(adjacency),
  }
}

/**
 * The nodes a change reaches: the changed nodes and everything downstream,
 * in evaluation order.
 *
 * This is the whole of §16's "evaluate only affected subgraphs after a change".
 * The order matters as much as the set — re-evaluating a dependent before its
 * prerequisite reads a stale input and produces an answer that is wrong in a way
 * no test on the final values would notice, because a second pass would fix it.
 *
 * A changed node that is not in the graph is IGNORED rather than treated as an
 * unknown that invalidates everything: it is an input the graph does not read,
 * and the safe-looking alternative — re-evaluate the world when in doubt — is
 * how an incremental evaluator quietly stops being incremental.
 */
export function affectedSubgraph(adjacency: Adjacency, changed: readonly string[]): readonly string[] {
  const dependents = dependentsOf(adjacency)
  const reached = new Set<string>()
  const queue = changed.filter((node) => adjacency.has(node))
  for (const node of queue) reached.add(node)

  while (queue.length > 0) {
    const node = queue.shift()!
    for (const dependent of dependents.get(node) ?? []) {
      if (reached.has(dependent)) continue
      reached.add(dependent)
      queue.push(dependent)
    }
  }

  // Ordered by the full graph's groups so a caller can evaluate the subset
  // without recomputing an order for it.
  const order = topologicalGroups(adjacency)
  const ordered = order.groups.flat().filter((node) => reached.has(node))
  // Nodes inside a cycle have no position; appended, sorted, so they are still
  // returned rather than dropped by an order that cannot place them.
  const cyclic = order.unordered.filter((node) => reached.has(node))
  return [...ordered, ...cyclic]
}
