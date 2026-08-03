import {
  OrgGraphError,
  TopologyError,
  buildOrgGraph,
  mayContain,
  typeHoldsSeats,
  validateTopology,
  type OrgTopology,
  type OrgUnitInput,
} from "./index"
import { BLUEPRINTS } from "@tenure/blueprints"

// ── two structurally different topologies, neither of them in the code ──────

const UNIVERSITY: OrgTopology = {
  id: "university-student-organizations",
  version: "1.0.0",
  rootType: "institution",
  maxDepth: 3,
  types: [
    { id: "institution", label: "Institution", pluralLabel: "Institutions" },
    { id: "school", label: "School", pluralLabel: "Schools" },
    { id: "club", label: "Club", pluralLabel: "Clubs" },
    { id: "board", label: "Executive board", pluralLabel: "Executive boards" },
  ],
  containment: [
    { parent: "institution", child: "school" },
    { parent: "school", child: "club" },
    { parent: "club", child: "board" },
  ],
  relationTypes: [
    { id: "advises", label: "Advises", from: ["school"], to: ["club"] },
    { id: "partners-with", label: "Partners with", from: ["club"], to: ["club"], symmetric: true },
  ],
}

const HOLDING_COMPANY: OrgTopology = {
  id: "corporate-multi-unit",
  version: "1.0.0",
  rootType: "holdingCompany",
  types: [
    { id: "holdingCompany", label: "Holding company", pluralLabel: "Holding companies" },
    { id: "legalEntity", label: "Legal entity", pluralLabel: "Legal entities" },
    { id: "businessUnit", label: "Business unit", pluralLabel: "Business units" },
    { id: "department", label: "Department", pluralLabel: "Departments" },
    { id: "team", label: "Team", pluralLabel: "Teams" },
  ],
  containment: [
    { parent: "holdingCompany", child: "legalEntity" },
    { parent: "legalEntity", child: "businessUnit" },
    { parent: "businessUnit", child: "department" },
    { parent: "department", child: "team" },
    // Departments nest — a real org chart does this and a fixed-depth model cannot.
    { parent: "department", child: "department" },
  ],
}

const T0 = "2020-01-01T00:00:00Z"
const T1 = "2026-01-01T00:00:00Z"
const T2 = "2026-06-01T00:00:00Z"
const NOW = "2026-07-31T00:00:00Z"

const unit = (
  id: string,
  typeId: string,
  parentId?: string,
  extra: Partial<OrgUnitInput> = {},
): OrgUnitInput => ({
  id,
  typeId,
  name: id,
  effectiveFrom: T0,
  ...(parentId ? { parentage: [{ parentId, effectiveFrom: T0 }] } : {}),
  ...extra,
})

const UNIVERSITY_UNITS: OrgUnitInput[] = [
  unit("rochester", "institution"),
  unit("simon", "school", "rochester"),
  unit("consulting-club", "club", "simon"),
  unit("finance-club", "club", "simon"),
  unit("consulting-board", "board", "consulting-club"),
]

// ── topology validation ─────────────────────────────────────────────────────

describe("a topology is checked before anything is built on it", () => {
  it("accepts two shapes that have nothing in common", () => {
    expect(() => validateTopology(UNIVERSITY)).not.toThrow()
    expect(() => validateTopology(HOLDING_COMPANY)).not.toThrow()
  })

  it("refuses a type nothing can contain", () => {
    // Not the root and nothing may hold it, so no unit of that type could exist.
    // At insertion time this looks exactly like a permissions bug.
    expect(() =>
      validateTopology({
        ...UNIVERSITY,
        types: [...UNIVERSITY.types, { id: "orphan", label: "Orphan", pluralLabel: "Orphans" }],
      }),
    ).toThrow(/no containment rule allows it under anything/)
  })

  it("refuses a type unreachable from the root", () => {
    expect(() =>
      validateTopology({
        ...UNIVERSITY,
        types: [...UNIVERSITY.types, { id: "ghost", label: "Ghost", pluralLabel: "Ghosts" }],
        // Containable, but only under something that is itself unreachable.
        containment: [...UNIVERSITY.containment, { parent: "ghost", child: "ghost" }],
      }),
    ).toThrow(/unreachable from the root type/)
  })

  it("refuses to put the root type under anything", () => {
    expect(() =>
      validateTopology({
        ...UNIVERSITY,
        containment: [...UNIVERSITY.containment, { parent: "club", child: "institution" }],
      }),
    ).toThrow(/The root is what nothing contains/)
  })

  it("refuses containment rules naming undeclared types", () => {
    expect(() =>
      validateTopology({ ...UNIVERSITY, containment: [{ parent: "institution", child: "nope" }] }),
    ).toThrow(TopologyError)
  })

  it("answers what may contain what", () => {
    expect(mayContain(UNIVERSITY, "school", "club")).toBe(true)
    expect(mayContain(UNIVERSITY, "institution", "club")).toBe(false)
    expect(mayContain(HOLDING_COMPANY, "department", "department")).toBe(true)
  })
})

// ── graph structure ─────────────────────────────────────────────────────────

describe("the same engine walks both shapes", () => {
  it("builds a university and answers structural questions", () => {
    const g = buildOrgGraph(UNIVERSITY, UNIVERSITY_UNITS)
    const now = g.asOf(NOW)

    expect(now.roots().map((u) => u.id)).toEqual(["rochester"])
    expect(now.children("simon").map((u) => u.id)).toEqual(["consulting-club", "finance-club"])
    expect(now.ancestors("consulting-board").map((u) => u.id)).toEqual([
      "consulting-club",
      "simon",
      "rochester",
    ])
    expect(now.descendants("rochester").map((u) => u.id).sort()).toEqual([
      "consulting-board",
      "consulting-club",
      "finance-club",
      "simon",
    ])
    expect(now.path("consulting-board").map((u) => u.id)).toEqual([
      "rochester",
      "simon",
      "consulting-club",
      "consulting-board",
    ])
    expect(now.get("consulting-board")!.depth).toBe(3)
    expect(now.isAncestorOf("simon", "consulting-board")).toBe(true)
    expect(now.isAncestorOf("finance-club", "consulting-board")).toBe(false)
  })

  it("builds a five-level holding company with recursive departments", () => {
    // The shape the current Institution/Organization model cannot express at all.
    const g = buildOrgGraph(HOLDING_COMPANY, [
      unit("group", "holdingCompany"),
      unit("uk-ltd", "legalEntity", "group"),
      unit("retail", "businessUnit", "uk-ltd"),
      unit("ops", "department", "retail"),
      unit("logistics", "department", "ops"),
      unit("night-shift", "team", "logistics"),
    ])
    const now = g.asOf(NOW)
    expect(now.get("night-shift")!.depth).toBe(5)
    expect(now.ancestors("night-shift").map((u) => u.id)).toEqual([
      "logistics",
      "ops",
      "retail",
      "uk-ltd",
      "group",
    ])
  })

  it("finds units by type", () => {
    const now = buildOrgGraph(UNIVERSITY, UNIVERSITY_UNITS).asOf(NOW)
    expect(now.ofType("club").map((u) => u.id)).toEqual(["consulting-club", "finance-club"])
  })
})

describe("the graph refuses to be built wrong", () => {
  it("refuses a containment the topology does not allow", () => {
    expect(() =>
      buildOrgGraph(UNIVERSITY, [unit("rochester", "institution"), unit("c", "club", "rochester")]),
    ).toThrow(/which the topology does not allow/)
  })

  it("refuses a non-root type with no parent", () => {
    expect(() => buildOrgGraph(UNIVERSITY, [unit("stray", "club")])).toThrow(
      /only "institution" may be a root/,
    )
  })

  it("refuses a cycle", () => {
    // Reachable from a spreadsheet import with a self-referential row, and it
    // makes every ancestor walk in the product unbounded.
    expect(() =>
      buildOrgGraph(HOLDING_COMPANY, [
        unit("group", "holdingCompany"),
        { ...unit("a", "department"), parentage: [{ parentId: "b", effectiveFrom: T0 }] },
        { ...unit("b", "department"), parentage: [{ parentId: "a", effectiveFrom: T0 }] },
      ]),
    ).toThrow(/contains a cycle/)
  })

  it("refuses a unit that is its own parent", () => {
    expect(() =>
      buildOrgGraph(UNIVERSITY, [
        unit("rochester", "institution"),
        { ...unit("s", "school"), parentage: [{ parentId: "s", effectiveFrom: T0 }] },
      ]),
    ).toThrow(/is its own parent/)
  })

  it("refuses two parents at the same time", () => {
    // A dotted line is a relation, not containment.
    expect(() =>
      buildOrgGraph(UNIVERSITY, [
        unit("rochester", "institution"),
        unit("simon", "school", "rochester"),
        unit("other", "school", "rochester"),
        {
          ...unit("c", "club"),
          parentage: [
            { parentId: "simon", effectiveFrom: T0 },
            { parentId: "other", effectiveFrom: T1 },
          ],
        },
      ]),
    ).toThrow(/two parents at once/)
  })

  it("refuses a parent that does not exist", () => {
    expect(() =>
      buildOrgGraph(UNIVERSITY, [unit("rochester", "institution"), unit("s", "school", "ghost")]),
    ).toThrow(/names parent "ghost", which does not exist/)
  })

  it("refuses a unit whose type the topology does not declare", () => {
    expect(() =>
      buildOrgGraph(UNIVERSITY, [unit("rochester", "institution"), unit("x", "faculty", "rochester")]),
    ).toThrow(/the topology does not declare/)
  })

  it("refuses nesting past maxDepth", () => {
    expect(() =>
      buildOrgGraph({ ...UNIVERSITY, maxDepth: 2 }, UNIVERSITY_UNITS),
    ).toThrow(/past the topology's maxDepth/)
  })

  it("refuses parentage that starts before the unit does", () => {
    expect(() =>
      buildOrgGraph(UNIVERSITY, [
        unit("rochester", "institution"),
        {
          id: "simon",
          typeId: "school",
          name: "simon",
          effectiveFrom: T1,
          parentage: [{ parentId: "rochester", effectiveFrom: T0 }],
        },
      ]),
    ).toThrow(/before the unit itself starts/)
  })

  it("reports every problem at once, not just the first", () => {
    try {
      buildOrgGraph(UNIVERSITY, [unit("rochester", "institution"), unit("a", "club", "rochester"), unit("b", "board", "rochester")])
      throw new Error("expected a throw")
    } catch (err) {
      expect(err).toBeInstanceOf(OrgGraphError)
      expect((err as OrgGraphError).problems.length).toBeGreaterThanOrEqual(2)
    }
  })
})

// ── effective dating: the reason parentage is a list ────────────────────────

describe("structure is a function of time", () => {
  // The consulting club moves from Simon to the College in June 2026.
  const REORG: OrgUnitInput[] = [
    unit("rochester", "institution"),
    unit("simon", "school", "rochester"),
    unit("college", "school", "rochester"),
    {
      id: "consulting-club",
      typeId: "club",
      name: "Consulting Club",
      effectiveFrom: T0,
      parentage: [
        { parentId: "simon", effectiveFrom: T0, effectiveTo: T2 },
        { parentId: "college", effectiveFrom: T2 },
      ],
    },
  ]

  const g = buildOrgGraph(UNIVERSITY, REORG)

  it("answers 'who was the parent' differently before and after the move", () => {
    expect(g.asOf(T1).get("consulting-club")!.parentId).toBe("simon")
    expect(g.asOf(NOW).get("consulting-club")!.parentId).toBe("college")
  })

  it("is exact at the boundary — half-open, so the new parent owns the instant", () => {
    expect(g.asOf(T2).get("consulting-club")!.parentId).toBe("college")
  })

  it("surfaces the boundary as a date validation cares about", () => {
    expect(g.criticalDates()).toContain(T2)
  })

  it("hides a unit before it exists and after it ends", () => {
    const withLifecycle = buildOrgGraph(UNIVERSITY, [
      unit("rochester", "institution"),
      {
        id: "pilot-school",
        typeId: "school",
        name: "Pilot",
        effectiveFrom: T1,
        effectiveTo: T2,
        parentage: [{ parentId: "rochester", effectiveFrom: T1 }],
      },
    ])
    expect(withLifecycle.asOf(T0).has("pilot-school")).toBe(false)
    expect(withLifecycle.asOf(T1).has("pilot-school")).toBe(true)
    expect(withLifecycle.asOf(NOW).has("pilot-school")).toBe(false)
  })

  it("drops an archived unit and everything under it", () => {
    // A subtree hanging off a unit that does not exist is not a tree.
    const archived = buildOrgGraph(UNIVERSITY, [
      unit("rochester", "institution"),
      unit("simon", "school", "rochester", { archivedAt: T2 }),
      unit("consulting-club", "club", "simon"),
      unit("consulting-board", "board", "consulting-club"),
    ])
    expect(archived.asOf(T1).size).toBe(4)

    const after = archived.asOf(NOW)
    expect(after.has("simon")).toBe(false)
    expect(after.has("consulting-club")).toBe(false)
    expect(after.has("consulting-board")).toBe(false)
    expect(after.roots().map((u) => u.id)).toEqual(["rochester"])
  })

  it("can still show archived units when asked", () => {
    const archived = buildOrgGraph(UNIVERSITY, [
      unit("rochester", "institution"),
      unit("simon", "school", "rochester", { archivedAt: T2 }),
    ])
    expect(archived.asOf(NOW, { includeArchived: true }).has("simon")).toBe(true)
  })

  it("validates at every date the structure changes, not only at 'now'", () => {
    // Legal today, illegal for five months. Checking only the present ships it.
    expect(() =>
      buildOrgGraph(UNIVERSITY, [
        unit("rochester", "institution"),
        unit("simon", "school", "rochester"),
        unit("consulting-club", "club", "simon"),
        {
          id: "wanderer",
          typeId: "board",
          name: "Wanderer",
          effectiveFrom: T0,
          parentage: [
            // Under a school for a while, which the topology forbids...
            { parentId: "simon", effectiveFrom: T1, effectiveTo: T2 },
            // ...and correctly parented again by now.
            { parentId: "consulting-club", effectiveFrom: T2 },
          ],
        },
      ]),
    // [\s\S] rather than the `s` flag: tsconfig targets ES2017, where dotAll is
    // not available, and raising the app's target for one test assertion is the
    // wrong trade.
    ).toThrow(/At 2026-01-01[\s\S]*does not allow/)
  })
})

// ── typed relationships that are not containment ────────────────────────────

describe("relationships that are not containment", () => {
  it("accepts a declared relation between allowed types", () => {
    const g = buildOrgGraph(UNIVERSITY, UNIVERSITY_UNITS, [
      { typeId: "advises", fromId: "simon", toId: "consulting-club", effectiveFrom: T0 },
      { typeId: "partners-with", fromId: "consulting-club", toId: "finance-club", effectiveFrom: T0 },
    ])
    expect(g.relationsAsOf(NOW)).toHaveLength(2)
  })

  it("refuses a relation the topology does not declare", () => {
    expect(() =>
      buildOrgGraph(UNIVERSITY, UNIVERSITY_UNITS, [
        { typeId: "owns", fromId: "simon", toId: "consulting-club", effectiveFrom: T0 },
      ]),
    ).toThrow(/is not declared by the topology/)
  })

  it("refuses a relation between the wrong kinds of unit", () => {
    expect(() =>
      buildOrgGraph(UNIVERSITY, UNIVERSITY_UNITS, [
        { typeId: "advises", fromId: "consulting-club", toId: "finance-club", effectiveFrom: T0 },
      ]),
    ).toThrow(/may not start at a "club"/)
  })

  it("is effective-dated like everything else", () => {
    const g = buildOrgGraph(UNIVERSITY, UNIVERSITY_UNITS, [
      { typeId: "advises", fromId: "simon", toId: "consulting-club", effectiveFrom: T0, effectiveTo: T2 },
    ])
    expect(g.relationsAsOf(T1)).toHaveLength(1)
    expect(g.relationsAsOf(NOW)).toHaveLength(0)
  })
})

/**
 * GE-050-003 — arbitrary configured types, and the constraints they need.
 *
 * The topology engine already carried arbitrary types and containment. Two
 * constraint kinds were missing, and both exist because a real structure needs
 * them: a company has exactly one head office, and a location is a place rather
 * than a body that employs.
 */
describe("cardinality is checked against the graph, because only the graph knows", () => {
  const topology: OrgTopology = {
    id: "cardinality",
    version: "1.0.0",
    rootType: "company",
    types: [
      { id: "company", label: "Company", pluralLabel: "Companies" },
      { id: "location", label: "Location", pluralLabel: "Locations" },
      { id: "division", label: "Division", pluralLabel: "Divisions" },
    ],
    containment: [
      { parent: "company", child: "location", minChildren: 1, maxChildren: 1 },
      { parent: "company", child: "division" },
    ],
  }

  const unit = (id: string, typeId: string, parentId?: string): OrgUnitInput => ({
    id,
    typeId,
    name: id,
    effectiveFrom: "2026-01-01",
    parentage: parentId ? [{ parentId, effectiveFrom: "2026-01-01" }] : undefined,
  })

  it("accepts a company with exactly one head office", () => {
    expect(() =>
      buildOrgGraph(topology, [unit("c", "company"), unit("hq", "location", "c")]),
    ).not.toThrow()
  })

  it("refuses a company with no head office", () => {
    // The state a half-finished import leaves behind.
    expect(() => buildOrgGraph(topology, [unit("c", "company")])).toThrow(/requires at least 1/)
  })

  it("refuses a company with two head offices", () => {
    // A data error somebody would otherwise discover from a report that
    // double-counts headcount by site.
    expect(() =>
      buildOrgGraph(topology, [
        unit("c", "company"),
        unit("hq", "location", "c"),
        unit("hq2", "location", "c"),
      ]),
    ).toThrow(/permits at most 1/)
  })

  it("does not constrain a child type with no rule", () => {
    // Cardinality is opt-in. A rule that silently bounded everything would make
    // every existing topology stricter than its author wrote.
    expect(() =>
      buildOrgGraph(topology, [
        unit("c", "company"),
        unit("hq", "location", "c"),
        unit("d1", "division", "c"),
        unit("d2", "division", "c"),
        unit("d3", "division", "c"),
      ]),
    ).not.toThrow()
  })

  it("counts per parent, not across the whole graph", () => {
    // Two companies with one office each is fine; a rule counting globally
    // would reject the second tenant to onboard.
    const twoCompanies: OrgTopology = { ...topology, rootType: "company" }
    expect(() =>
      buildOrgGraph(twoCompanies, [
        unit("c1", "company"),
        unit("hq1", "location", "c1"),
        unit("c2", "company"),
        unit("hq2", "location", "c2"),
      ]),
    ).not.toThrow()
  })

  it("sees an archived child as gone", () => {
    // Archiving the only head office leaves the company without one, and a
    // check that slept through it would report a structure nobody has.
    const archived: OrgUnitInput = { ...unit("hq", "location", "c"), archivedAt: "2026-06-01" }
    expect(() => buildOrgGraph(topology, [unit("c", "company"), archived])).toThrow(
      /requires at least 1/,
    )
  })
})

describe("a topology cannot ask for the impossible", () => {
  const base = {
    id: "t",
    version: "1.0.0",
    rootType: "a",
    types: [
      { id: "a", label: "A", pluralLabel: "As" },
      { id: "b", label: "B", pluralLabel: "Bs" },
    ],
  }

  it("refuses a minimum above the maximum", () => {
    expect(() =>
      buildOrgGraph(
        { ...base, containment: [{ parent: "a", child: "b", minChildren: 3, maxChildren: 2 }] },
        [],
      ),
    ).toThrow(/nothing can satisfy/)
  })

  it("refuses a maximum of zero, which containment already expresses", () => {
    // Removing the rule forbids the pairing. A max of zero says "you may
    // contain this, but never" — two ways to state one thing.
    expect(() =>
      buildOrgGraph({ ...base, containment: [{ parent: "a", child: "b", maxChildren: 0 }] }, []),
    ).toThrow(/below one/)
  })

  it("refuses a fractional or negative count", () => {
    expect(() =>
      buildOrgGraph({ ...base, containment: [{ parent: "a", child: "b", minChildren: -1 }] }, []),
    ).toThrow(/not a count/)
    expect(() =>
      buildOrgGraph({ ...base, containment: [{ parent: "a", child: "b", maxChildren: 1.5 }] }, []),
    ).toThrow(/not a count/)
  })
})

describe("some unit types are places, not bodies that employ", () => {
  const topology: OrgTopology = {
    id: "seats",
    version: "1.0.0",
    rootType: "company",
    types: [
      { id: "company", label: "Company", pluralLabel: "Companies" },
      { id: "department", label: "Department", pluralLabel: "Departments" },
      { id: "location", label: "Location", pluralLabel: "Locations", holdsSeats: false },
    ],
    containment: [
      { parent: "company", child: "department" },
      { parent: "company", child: "location" },
    ],
  }

  it("says a department holds seats", () => {
    expect(typeHoldsSeats(topology, "department")).toBe(true)
  })

  it("says a location does not", () => {
    // A seat there is authority attached to an address, which nobody can
    // succeed to.
    expect(typeHoldsSeats(topology, "location")).toBe(false)
  })

  it("defaults to holding seats, so existing topologies are unchanged", () => {
    // Every topology written before this field existed must keep working, and
    // most unit types are bodies that employ.
    expect(typeHoldsSeats(topology, "company")).toBe(true)
  })

  it("says an unknown type holds nothing", () => {
    // Fails closed: a seat in a type the topology does not declare is a seat
    // nobody configured.
    expect(typeHoldsSeats(topology, "nonexistent")).toBe(false)
  })
})

/**
 * GE-050-003 — every shipped topology is a real one.
 *
 * A blueprint whose topology does not validate is a configuration nobody can
 * provision into, and the failure would land on the first tenant to choose it
 * rather than here.
 */
describe("the shipped blueprints", () => {
  it.each(BLUEPRINTS.map((b) => [b.id, b.topology] as const))("%s has a valid topology", (_id, topology) => {
    expect(() => validateTopology(topology)).not.toThrow()
  })

  it("ships both structures GE-050-003 names", () => {
    // Education shipped first; the corporate shape had no representation at
    // all, which meant "arbitrary configured types" rested on two
    // configurations that happen to look alike.
    const byId = new Map(BLUEPRINTS.map((b) => [b.id, b]))
    const education = byId.get("university-student-organizations")
    const corporate = byId.get("corporate-divisions")

    expect(education).toBeDefined()
    expect(corporate).toBeDefined()

    const educationTypes = education!.topology.types.map((t) => t.id)
    const corporateTypes = corporate!.topology.types.map((t) => t.id)

    expect(educationTypes).toEqual(expect.arrayContaining(["school", "club"]))
    expect(corporateTypes).toEqual(
      expect.arrayContaining(["company", "division", "department", "team", "location", "project"]),
    )
  })

  it("gives the two structures genuinely different shapes", () => {
    // The point of a second blueprint. Two topologies with the same root type
    // and the same depth would prove the engine handles one shape twice.
    const byId = new Map(BLUEPRINTS.map((b) => [b.id, b]))
    const education = byId.get("university-student-organizations")!.topology
    const corporate = byId.get("corporate-divisions")!.topology

    expect(corporate.rootType).not.toBe(education.rootType)
    expect(corporate.maxDepth).not.toBe(education.maxDepth)
  })

  it("uses the constraints it needed them for", () => {
    // The corporate topology is why cardinality and holdsSeats exist. If a
    // later edit drops them, the constraint kinds lose their only real user and
    // this says so.
    const corporate = BLUEPRINTS.find((b) => b.id === "corporate-divisions")!.topology

    const headOffice = corporate.containment.find(
      (rule) => rule.parent === "company" && rule.child === "location",
    )
    expect(headOffice?.minChildren).toBe(1)
    expect(headOffice?.maxChildren).toBe(1)

    expect(typeHoldsSeats(corporate, "location")).toBe(false)
    expect(typeHoldsSeats(corporate, "project")).toBe(false)
    expect(typeHoldsSeats(corporate, "department")).toBe(true)
  })

  it("accepts a company built to its own rules, and refuses one that is not", () => {
    // The topology validating is not the same as a graph satisfying it.
    const corporate = BLUEPRINTS.find((b) => b.id === "corporate-divisions")!.topology
    const unit = (id: string, typeId: string, parentId?: string): OrgUnitInput => ({
      id,
      typeId,
      name: id,
      effectiveFrom: "2026-01-01",
      parentage: parentId ? [{ parentId, effectiveFrom: "2026-01-01" }] : undefined,
    })

    expect(() =>
      buildOrgGraph(corporate, [
        unit("acme", "company"),
        unit("hq", "location", "acme"),
        unit("eng", "division", "acme"),
        unit("platform", "department", "eng"),
        unit("core", "team", "platform"),
      ]),
    ).not.toThrow()

    expect(() =>
      buildOrgGraph(corporate, [unit("acme", "company"), unit("eng", "division", "acme")]),
    ).toThrow(/requires at least 1/)
  })
})
