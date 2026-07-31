import {
  OrgGraphError,
  TopologyError,
  buildOrgGraph,
  mayContain,
  validateTopology,
  type OrgTopology,
  type OrgUnitInput,
} from "./index"

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
