import { test, expect } from "@playwright/test"

import { MODULES } from "@tenure/modules"
import type { ConfigRecord } from "@tenure/configuration"

import {
  compareRevisions,
  dependantsOf,
  dependencyGraph,
  renderComparison,
  summarise,
} from "../src/lib/revisions"

/**
 * GE-032-003 — comparing revisions and reading the dependency graph.
 *
 * Pure, so no browser. The graph tests run against the REAL module catalogue as
 * well as fixtures: a blast-radius calculation that has only seen a hand-built
 * graph has never met the data an operator would act on.
 */

function record(revision: number, values: Record<string, unknown>): ConfigRecord {
  return {
    tenantId: "acme",
    revision,
    layers: [],
    provenance: `sha256:${revision}`,
    layerDigests: [],
    values,
    checksum: `sha256:c${revision}`,
    languageVersion: "1.0.0",
    publishedBy: "operator:one",
    publishedAt: "2026-08-02T00:00:00.000Z",
    activateAt: "2026-08-02T00:00:00.000Z",
    rollbackTo: revision === 1 ? null : revision - 1,
    plan: {
      blocked: false,
      blockers: [],
      rejections: [],
      violations: [],
      excused: [],
      lint: [],
      diff: [],
      humanDiff: "",
      impact: { keysAdded: 1, keysRemoved: 0, keysChanged: 2, modulesAffected: [], fixturesAffected: [] },
      simulations: [],
      rollbackTo: revision === 1 ? null : revision - 1,
      activateAt: "2026-08-02T00:00:00.000Z",
    },
  }
}

test.describe("comparing two revisions", () => {
  test("reports added, removed and changed keys", () => {
    const differences = compareRevisions(
      record(1, { kept: "same", gone: 1, moved: "before" }),
      record(2, { kept: "same", arrived: 2, moved: "after" }),
    )
    const byKey = Object.fromEntries(differences.map((d) => [d.key, d.change]))
    expect(byKey.gone).toBe("removed")
    expect(byKey.arrived).toBe("added")
    expect(byKey.moved).toBe("changed")
    expect(byKey.kept).toBeUndefined()
  })

  test("does not report a key-order change as a change", () => {
    // A value reserialised by a different writer must not read as a change, or
    // every comparison after a storage-format tweak is noise.
    expect(
      compareRevisions(record(1, { o: { a: 1, b: 2 } }), record(2, { o: { b: 2, a: 1 } })),
    ).toEqual([])
  })

  test("says plainly when two revisions resolve the same", () => {
    expect(renderComparison([])).toBe("These revisions resolve to the same configuration.")
  })

  test("renders in the same style as the publication diff", () => {
    // Two diffs in one console that disagree about notation is one an operator
    // has to translate between.
    const text = renderComparison(compareRevisions(record(1, { a: 1 }), record(2, { a: 2 })))
    expect(text).toBe("~ a: 1 -> 2")
  })

  test("compares resolved values, not layers", () => {
    // Two different layer stacks can resolve to the same configuration. An
    // operator comparing revisions asks what the system does differently;
    // `provenance` answers how the answer was assembled.
    const a = record(1, { same: true })
    const b = { ...record(2, { same: true }), provenance: "sha256:totally-different" }
    expect(compareRevisions(a, b)).toEqual([])
  })
})

test.describe("the revision list", () => {
  test("carries what an operator scans for", () => {
    const [first] = summarise([record(3, { a: 1 })])
    expect(first.revision).toBe(3)
    expect(first.rollbackTo).toBe(2)
    // Total keys touched, so a list shows which revisions were large.
    expect(first.changed).toBe(3)
  })

  test("says null for the first revision rather than 0", () => {
    expect(summarise([record(1, {})])[0].rollbackTo).toBeNull()
  })
})

test.describe("the dependency graph, against the real catalogue", () => {
  test("has every module as a node", () => {
    const graph = dependencyGraph(MODULES)
    expect(graph.nodes.length).toBe(MODULES.length)
    expect([...graph.nodes].sort()).toEqual(graph.nodes)
  })

  test("every edge points at a module that exists", () => {
    const graph = dependencyGraph(MODULES)
    for (const edge of graph.edges) {
      expect(graph.nodes).toContain(edge.to)
      expect(graph.nodes).toContain(edge.from)
    }
  })

  test("names what breaks if a real module is disabled", () => {
    // `feed` depends on `organizations`, so disabling organizations breaks it.
    expect(dependantsOf(MODULES, "organizations")).toContain("feed")
  })

  test("follows a capability to whatever provides it", () => {
    // `reimbursements` depends on the capability `finance.ledger`, which
    // `budgeting` provides. A graph that drew the capability as its own node
    // would answer "what breaks if budgeting goes?" without naming the module
    // that would actually stop working.
    expect(dependantsOf(MODULES, "budgeting")).toContain("reimbursements")
  })

  test("a leaf breaks nothing", () => {
    expect(dependantsOf(MODULES, "feed")).toEqual([])
  })
})

test.describe("the dependency graph, on shapes the catalogue does not have", () => {
  const chain = [
    { key: "a", dependsOn: [{ module: "b" }] },
    { key: "b", dependsOn: [{ module: "c" }] },
    { key: "c" },
  ]

  test("blast radius is transitive", () => {
    // Disabling c breaks b, and whatever depends on b. A list that stopped at
    // the direct dependants would under-report exactly when it matters most.
    expect(dependantsOf(chain, "c")).toEqual(["a", "b"])
  })

  test("roots are what nothing depends on", () => {
    expect(dependencyGraph(chain).roots).toEqual(["a"])
  })

  test("leaves are what depends on nothing", () => {
    expect(dependencyGraph(chain).leaves).toEqual(["c"])
  })

  test("a cycle does not hang the blast-radius walk", () => {
    // The catalogue has no cycle and GE-031-004 refuses one, but this walk runs
    // on whatever it is given — including a catalogue mid-edit.
    const cyclic = [
      { key: "x", dependsOn: [{ module: "y" }] },
      { key: "y", dependsOn: [{ module: "x" }] },
    ]
    expect(dependantsOf(cyclic, "x")).toEqual(["x", "y"])
  })
})
