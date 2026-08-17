import { adjacencyOf, affectedSubgraph, dependentsOf, minimalCyclePaths, nodesOf, topologicalGroups } from "./graph"

/**
 * CFG-030-002 / CFG-030-003 — the graph algorithms.
 *
 * The test that matters is `finds the SHORTEST cycle`. Every cycle detector
 * finds a cycle; Bible §11 step 6 asks for the minimal path, and the difference
 * is what an operator is sent to look at. A depth-first search entering the
 * graph below at `a` reports `a → b → c → a` and never mentions `a → c → a`,
 * which is the pair that actually cannot be ordered.
 */

const graph = (entries: Record<string, string[]>) => adjacencyOf(Object.entries(entries))

describe("minimal cycle paths", () => {
  it("finds the SHORTEST cycle, not the first one a traversal closes", () => {
    // a depends on b and c; b on c; c on a. Two cycles: a → c → a (two nodes)
    // and a → b → c → a (three). The short one is the answer §11 asks for.
    const cycles = minimalCyclePaths(graph({ a: ["b", "c"], b: ["c"], c: ["a"] }))
    expect(cycles).toContain("a → c → a")
  })

  it("reports a two-node cycle as the path that forms it", () => {
    expect(minimalCyclePaths(graph({ a: ["b"], b: ["a"] }))).toEqual(["a → b → a"])
  })

  it("reports a self-dependency", () => {
    expect(minimalCyclePaths(graph({ a: ["a"] }))).toEqual(["a → a"])
  })

  it("reports one cycle once, not once per participant", () => {
    expect(minimalCyclePaths(graph({ a: ["b"], b: ["c"], c: ["a"] }))).toEqual(["a → b → c → a"])
  })

  it("does not mistake a diamond for a cycle", () => {
    // Two paths to one node is a diamond. A visited-set that forgot to
    // distinguish "on the current path" from "seen before" would call this one.
    expect(minimalCyclePaths(graph({ a: ["b", "c"], b: ["d"], c: ["d"], d: [] }))).toEqual([])
  })

  it("is quiet on an acyclic graph", () => {
    expect(minimalCyclePaths(graph({ a: ["b"], b: ["c"], c: [] }))).toEqual([])
  })

  it("prints the same path whichever order the edges arrived in", () => {
    // The digest of a snapshot covers the cycle list. If the text depended on
    // insertion order, two processes compiling the same packages would disagree.
    const one = minimalCyclePaths(graph({ a: ["b"], b: ["c"], c: ["a"] }))
    const other = minimalCyclePaths(graph({ c: ["a"], b: ["c"], a: ["b"] }))
    expect(other).toEqual(one)
    expect(one[0]).toBe("a → b → c → a")
  })

  it("prints a cycle from its lowest-sorting member even when another member discovered it", () => {
    // `b` sits on the SHORTER cycle b → e → b, so the search from `b` reports
    // that one and the three-node cycle is first discovered from `c`. Printed as
    // discovered it would read "c → d → b → c", so the same cycle would be
    // rendered two different ways depending on what else exists in the graph —
    // and the snapshot digest covers this text.
    expect(minimalCyclePaths(graph({ b: ["c", "e"], c: ["d"], d: ["b"], e: ["b"] }))).toEqual([
      "b → c → d → b",
      "b → e → b",
    ])
  })

  it("reports two genuinely different minimal cycles separately", () => {
    // {a,b} and {c,d} are two problems with two fixes.
    expect(minimalCyclePaths(graph({ a: ["b"], b: ["a"], c: ["d"], d: ["c"] }))).toEqual([
      "a → b → a",
      "c → d → c",
    ])
  })
})

describe("adjacency", () => {
  it("adds a node for a prerequisite nobody declared", () => {
    // Otherwise a topological order silently omits it and an affected-subgraph
    // walk stops short at it.
    expect(nodesOf(graph({ a: ["b"] }))).toEqual(["a", "b"])
  })

  it("de-duplicates and sorts each node's prerequisites", () => {
    expect(graph({ a: ["c", "b", "c"] }).get("a")).toEqual(["b", "c"])
  })

  it("reverses to dependents", () => {
    const dependents = dependentsOf(graph({ a: ["c"], b: ["c"], c: [] }))
    expect(dependents.get("c")).toEqual(["a", "b"])
    expect(dependents.get("a")).toEqual([])
  })
})

describe("topological groups", () => {
  it("puts prerequisites in an earlier group than what needs them", () => {
    const order = topologicalGroups(graph({ total: ["seats", "rate"], seats: [], rate: [] }))
    expect(order.groups).toEqual([["rate", "seats"], ["total"]])
    expect(order.unordered).toEqual([])
    expect(order.cycles).toEqual([])
  })

  it("groups independent nodes together rather than inventing a sequence", () => {
    // `rate` and `seats` have no relationship. A flat order would imply one, and
    // a later change that swapped them would read as a change in meaning.
    const order = topologicalGroups(graph({ total: ["seats", "rate"], seats: [], rate: [] }))
    expect(order.groups[0]).toEqual(["rate", "seats"])
  })

  it("names what it could not order, and why", () => {
    // A partial order that looks total is the failure this reports rather than
    // hides: 2 of 4 ordered and nothing said about the other two.
    const order = topologicalGroups(graph({ a: ["b"], b: ["a"], c: [], d: ["c"] }))
    expect(order.groups.flat().sort()).toEqual(["c", "d"])
    expect(order.unordered).toEqual(["a", "b"])
    expect(order.cycles).toEqual(["a → b → a"])
  })

  it("produces the same groups whichever order the edges arrived in", () => {
    const one = topologicalGroups(graph({ a: [], b: ["a"], c: ["b"] }))
    const other = topologicalGroups(graph({ c: ["b"], a: [], b: ["a"] }))
    expect(other.groups).toEqual(one.groups)
  })
})

describe("affected subgraph", () => {
  const g = graph({ seats: [], rate: [], subtotal: ["seats", "rate"], tax: ["subtotal"], total: ["subtotal", "tax"] })

  it("returns the changed node and everything downstream, in evaluation order", () => {
    // The order is as load-bearing as the set: re-evaluating `total` before
    // `tax` reads a stale input and produces an answer a second pass would fix,
    // which no test on the final values would ever notice.
    expect(affectedSubgraph(g, ["seats"])).toEqual(["seats", "subtotal", "tax", "total"])
  })

  it("does not return what a change cannot reach", () => {
    expect(affectedSubgraph(g, ["tax"])).toEqual(["tax", "total"])
    expect(affectedSubgraph(g, ["rate"])).not.toContain("seats")
  })

  it("returns nothing for no change", () => {
    expect(affectedSubgraph(g, [])).toEqual([])
  })

  it("ignores a changed path the graph does not read", () => {
    // The tempting alternative — re-evaluate the world when in doubt — is how an
    // incremental evaluator quietly stops being incremental.
    expect(affectedSubgraph(g, ["something.nobody.declared"])).toEqual([])
  })

  it("still returns nodes inside a cycle rather than dropping them", () => {
    const cyclic = graph({ a: ["b"], b: ["a"], seed: [], a2: ["seed"] })
    expect([...affectedSubgraph(cyclic, ["a"])].sort()).toEqual(["a", "b"])
  })
})
