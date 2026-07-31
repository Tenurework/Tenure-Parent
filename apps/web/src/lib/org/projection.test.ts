import { getBlueprint, getTenantBinding } from "@tenure/blueprints"
import { validateTopology } from "@tenure/organization-model"

import { projectToGraph, projectToUnits, type OrganizationRow } from "./projection"

const UNIVERSITY = getBlueprint("university-student-organizations")!
const NONPROFIT = getBlueprint("nonprofit-program-operations")!

const INSTITUTION = {
  id: "inst_rochester",
  name: "University of Rochester",
  slug: "rochester",
  createdAt: new Date("2026-07-01T00:00:00Z"),
}

const org = (id: string, name: string, status = "ACTIVE"): OrganizationRow => ({
  id,
  name,
  institutionId: INSTITUTION.id,
  status,
  createdAt: new Date("2026-07-10T00:00:00Z"),
})

const OPTIONS = { institutionType: "institution", organizationType: "club" }
const NOW = "2026-07-31T00:00:00Z"

describe("the live two-level schema projects onto the organization model", () => {
  it("makes the institution the root and organizations its children", () => {
    const graph = projectToGraph(
      UNIVERSITY.topology,
      INSTITUTION,
      [org("o1", "Consulting Club"), org("o2", "Finance Club")],
      OPTIONS,
    )
    const now = graph.asOf(NOW)

    expect(now.roots().map((u) => u.id)).toEqual([INSTITUTION.id])
    expect(now.children(INSTITUTION.id).map((u) => u.name).sort()).toEqual([
      "Consulting Club",
      "Finance Club",
    ])
    expect(now.ancestors("o1").map((u) => u.id)).toEqual([INSTITUTION.id])
    expect(now.get("o1")!.depth).toBe(1)
  })

  it("excludes an archived organization from the current view", () => {
    const graph = projectToGraph(
      UNIVERSITY.topology,
      INSTITUTION,
      [org("o1", "Live Club"), org("o2", "Old Club", "ARCHIVED")],
      OPTIONS,
    )
    const now = graph.asOf(NOW)
    expect(now.has("o1")).toBe(true)
    expect(now.has("o2")).toBe(false)

    // Archived means hidden, not deleted: the history is still there to ask.
    expect(graph.asOf(NOW, { includeArchived: true }).has("o2")).toBe(true)
  })

  it("refuses to draw another tenant's organization into the graph", () => {
    // A cross-tenant row is a tenancy failure, not a malformed hierarchy, and it
    // should not be quietly filtered out either — that would hide the bug.
    expect(() =>
      projectToUnits(
        INSTITUTION,
        [{ ...org("o1", "Someone else's club"), institutionId: "inst_other" }],
        OPTIONS,
      ),
    ).toThrow(/Refusing to project another tenant's organization/)
  })

  it("clamps an organization that appears to predate its institution", () => {
    // The seed writes both in one transaction; millisecond ordering is not a
    // statement about history, and an unclamped value fails validation.
    const units = projectToUnits(
      INSTITUTION,
      [{ ...org("o1", "Early Club"), createdAt: new Date("2020-01-01T00:00:00Z") }],
      OPTIONS,
    )
    const child = units.find((u) => u.id === "o1")!
    expect(child.effectiveFrom).toBe(INSTITUTION.createdAt.toISOString())
    expect(() =>
      projectToGraph(UNIVERSITY.topology, INSTITUTION, [
        { ...org("o1", "Early Club"), createdAt: new Date("2020-01-01T00:00:00Z") },
      ], OPTIONS),
    ).not.toThrow()
  })

  it("refuses a projection whose unit type the topology does not allow there", () => {
    // The nonprofit topology has no `club`, and its root is not `institution`.
    // Projecting the university's shape onto it is rejected rather than drawn.
    expect(() =>
      projectToGraph(NONPROFIT.topology, INSTITUTION, [org("o1", "Consulting Club")], OPTIONS),
    ).toThrow()
  })
})

describe("every shipped blueprint declares a legal topology", () => {
  it.each([
    ["university-student-organizations", UNIVERSITY],
    ["nonprofit-program-operations", NONPROFIT],
  ])("%s", (_id, blueprint) => {
    expect(() => validateTopology(blueprint.topology)).not.toThrow()
  })

  it("the two blueprints are structurally different, not just differently worded", () => {
    // The weak version of this claim is that one says "club" and the other says
    // "program". The strong version is that they are different organizations:
    // different roots, different depths, and node types with no counterpart.
    expect(UNIVERSITY.topology.rootType).not.toBe(NONPROFIT.topology.rootType)

    const uniTypes = new Set(UNIVERSITY.topology.types.map((t) => t.id))
    const npTypes = new Set(NONPROFIT.topology.types.map((t) => t.id))
    const shared = [...uniTypes].filter((t) => npTypes.has(t))
    expect(shared).toEqual([])

    // The nonprofit nests one level deeper and has a funding relation the
    // university shape has no analogue for.
    expect(NONPROFIT.topology.maxDepth).toBeGreaterThan(UNIVERSITY.topology.maxDepth!)
    expect(NONPROFIT.topology.relationTypes!.map((r) => r.id)).toContain("funds")
    expect(UNIVERSITY.topology.relationTypes!.map((r) => r.id)).not.toContain("funds")
  })

  it("binds each tenant to a blueprint whose topology validates", () => {
    for (const binding of [getTenantBinding("rochester")!, getTenantBinding("midtown-arts")!]) {
      const blueprint = getBlueprint(binding.blueprintId)!
      expect(blueprint).toBeDefined()
      expect(() => validateTopology(blueprint.topology)).not.toThrow()
    }
  })
})
