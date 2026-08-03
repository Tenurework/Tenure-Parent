import {
  PLATFORM_ASSIGNMENT_STATES,
  assignmentProblems,
  findAssignmentState,
  seatIsVacant,
  stateAuthorityAt,
  validateAssignmentCatalog,
  type AssignmentStateCatalog,
} from "./assignment-states"

/**
 * GE-050-004 — the eleven states, and the decisions a name cannot carry.
 *
 * `interim` and `acting` are different words for arrangements that differ in
 * exactly one respect nobody can recover from the name. That difference is the
 * reason this is a record of decisions rather than a longer enum.
 */

const NOW = new Date("2026-08-03T12:00:00Z")
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString()

const CAT = PLATFORM_ASSIGNMENT_STATES

const authority = (stateId: string, from = days(-10), to: string | null = days(10)) =>
  stateAuthorityAt(CAT, { stateId, effectiveFrom: from, effectiveTo: to, at: NOW })

describe("the platform catalog declares every state the Bible names", () => {
  it("has all eleven", () => {
    const ids = CAT.states.map((s) => s.id).sort()
    expect(ids).toEqual(
      [
        "acting",
        "active",
        "advisor",
        "alumni",
        "contractor",
        "delegate",
        "former",
        "future",
        "interim",
        "leave",
        "shadow",
      ].sort(),
    )
  })

  it("is a catalog the engine can decide from", () => {
    expect(validateAssignmentCatalog(CAT)).toEqual([])
  })

  it("gives every state a label somebody could choose in a form", () => {
    for (const state of CAT.states) expect(state.label.trim().length).toBeGreaterThan(0)
  })
})

describe("authority is decided by the catalog, not by the name", () => {
  it("gives a substantive holder everything", () => {
    expect(authority("active")).toBe("FULL")
  })

  it("gives a shadow read-only, so an incoming holder cannot act a week early", () => {
    expect(authority("shadow")).toBe("READ_ONLY")
  })

  it("gives an advisor read-only, because oversight is not occupancy", () => {
    expect(authority("advisor")).toBe("READ_ONLY")
  })

  it("gives a person on leave nothing, though they still hold the seat", () => {
    expect(authority("leave")).toBe("NONE")
  })

  it("gives a former or alumni holder nothing", () => {
    expect(authority("former")).toBe("NONE")
    expect(authority("alumni")).toBe("NONE")
  })

  it("gives a future appointment nothing until its window opens", () => {
    expect(authority("future", days(5), days(400))).toBe("NONE")
  })
})

describe("the window still bounds every state", () => {
  it("grants nothing before the start", () => {
    expect(authority("active", days(3), days(30))).toBe("NONE")
  })

  it("grants nothing at or after the end", () => {
    // Half-open, matching memberships and seats: one term ending exactly where
    // the next begins leaves no gap and no overlap.
    expect(authority("active", days(-30), days(0))).toBe("NONE")
    expect(authority("active", days(-30), days(-1))).toBe("NONE")
  })

  it("lets a shadow be live before its window, and only a shadow", () => {
    // The reason the flag exists: an incoming president previews for a week.
    expect(authority("shadow", days(3), days(30))).toBe("READ_ONLY")
    expect(authority("interim", days(3), days(30))).toBe("NONE")
  })

  it("still ends a shadow at its window", () => {
    // Live-before-start must not mean live forever; the preview cannot outlive
    // the handover.
    expect(authority("shadow", days(-30), days(-1))).toBe("NONE")
  })

  it("grants nothing on an unparseable window", () => {
    expect(authority("active", "not-a-date", days(10))).toBe("NONE")
    expect(authority("active", days(-10), "soon")).toBe("NONE")
  })

  it("treats an open end as open", () => {
    expect(authority("active", days(-10), null)).toBe("FULL")
  })
})

describe("an unknown state grants nothing", () => {
  it("fails closed", () => {
    // A key nobody configured — a typo, a state removed while rows still carry
    // it, a value written by an older version. Defaulting to the common answer
    // would grant authority on the strength of a spelling mistake.
    expect(authority("acitve")).toBe("NONE")
    expect(authority("")).toBe("NONE")
  })

  it("is not resolved to anything", () => {
    expect(findAssignmentState(CAT, "nonexistent")).toBeUndefined()
  })
})

describe("occupancy is not authority", () => {
  const at = (stateId: string, to: string | null = days(10)) => [
    { stateId, effectiveFrom: days(-10), effectiveTo: to },
  ]

  it("says a seat with an active holder is not vacant", () => {
    expect(seatIsVacant(CAT, at("active"), NOW)).toBe(false)
  })

  it("says a seat whose holder is on leave is NOT vacant", () => {
    // The distinction the whole shape exists for. Appointing a successor to it
    // would put two people in one post, and a vacancy report that counted this
    // as a gap would send somebody to fill a seat that is taken.
    expect(authority("leave")).toBe("NONE")
    expect(seatIsVacant(CAT, at("leave"), NOW)).toBe(false)
  })

  it("says a seat covered by an acting holder IS vacant", () => {
    // An acting holder covers a post that is still somebody else's. They can
    // act; they do not occupy. Both halves matter and they point opposite ways.
    expect(authority("acting")).toBe("FULL")
    expect(seatIsVacant(CAT, at("acting"), NOW)).toBe(true)
  })

  it("says a seat held by an interim holder is not vacant", () => {
    // The difference from acting, and the one a name cannot carry: an interim
    // holder is in a post that is genuinely empty, so it is no longer empty.
    expect(seatIsVacant(CAT, at("interim"), NOW)).toBe(false)
  })

  it("says a seat with only a shadow, advisor or delegate is vacant", () => {
    for (const stateId of ["shadow", "advisor", "delegate"]) {
      expect(seatIsVacant(CAT, at(stateId), NOW)).toBe(true)
    }
  })

  it("says a seat with only past holders is vacant", () => {
    expect(seatIsVacant(CAT, at("former"), NOW)).toBe(true)
    expect(seatIsVacant(CAT, at("alumni"), NOW)).toBe(true)
  })

  it("ignores an occupying assignment whose window has closed", () => {
    expect(seatIsVacant(CAT, at("active", days(-1)), NOW)).toBe(true)
  })

  it("ignores an occupying assignment that has not started", () => {
    expect(
      seatIsVacant(CAT, [{ stateId: "active", effectiveFrom: days(5), effectiveTo: null }], NOW),
    ).toBe(true)
  })

  it("ignores an unknown state when deciding vacancy", () => {
    // Fails closed the other way too: a seat is not held by a state nobody
    // declared, so it reads as open and somebody is prompted to fill it.
    expect(seatIsVacant(CAT, at("mystery"), NOW)).toBe(true)
  })

  it("is not vacant when any one assignment occupies it", () => {
    expect(
      seatIsVacant(
        CAT,
        [
          { stateId: "alumni", effectiveFrom: days(-400), effectiveTo: days(-10) },
          { stateId: "shadow", effectiveFrom: days(-2), effectiveTo: days(5) },
          { stateId: "active", effectiveFrom: days(-10), effectiveTo: null },
        ],
        NOW,
      ),
    ).toBe(false)
  })
})

describe("a temporary arrangement has to end", () => {
  const problems = (stateId: string, to: string | null) =>
    assignmentProblems(CAT, { stateId, effectiveFrom: days(-1), effectiveTo: to })

  it("refuses an interim appointment with no end", () => {
    // The failure this catches is invisible afterwards: it looks exactly like a
    // substantive appointment, which is how a temporary arrangement becomes the
    // org chart.
    expect(problems("interim", null)[0]).toMatch(/must end/)
  })

  it("refuses acting, shadow, delegate and contractor without one", () => {
    for (const stateId of ["acting", "shadow", "delegate", "contractor"]) {
      expect(problems(stateId, null).length).toBeGreaterThan(0)
    }
  })

  it("accepts them when bounded", () => {
    for (const stateId of ["interim", "acting", "shadow", "delegate", "contractor"]) {
      expect(problems(stateId, days(30))).toEqual([])
    }
  })

  it("does not require an end of a substantive appointment", () => {
    expect(problems("active", null)).toEqual([])
  })

  it("does not require history to expire", () => {
    // A former or alumni record with no end is the record standing, not an
    // unbounded grant — they hold nothing.
    expect(problems("alumni", null)).toEqual([])
    expect(problems("former", null)).toEqual([])
  })

  it("refuses an assignment in a state nobody declared", () => {
    expect(problems("mystery", days(30))[0]).toMatch(/not a state this catalog declares/)
  })

  it("reports an unparseable window", () => {
    expect(assignmentProblems(CAT, { stateId: "active", effectiveFrom: "x", effectiveTo: null })).toHaveLength(1)
    expect(
      assignmentProblems(CAT, { stateId: "active", effectiveFrom: days(-1), effectiveTo: "y" }),
    ).toHaveLength(1)
  })
})

describe("a catalog a tenant configures has to make sense", () => {
  const catalog = (states: AssignmentStateCatalog["states"]): AssignmentStateCatalog => ({
    id: "tenant",
    version: "1.0.0",
    states,
  })

  it("refuses two states sharing an id", () => {
    // The second silently wins, and which one that is depends on array order —
    // a decision nobody made.
    const problems = validateAssignmentCatalog(
      catalog([
        { id: "active", label: "Active", authority: "FULL", occupies: true },
        { id: "active", label: "Also active", authority: "NONE", occupies: false },
      ]),
    )
    expect(problems.map((p) => p.detail).join(" ")).toMatch(/silently win/)
  })

  it("refuses an empty catalog", () => {
    expect(validateAssignmentCatalog(catalog([])).length).toBe(1)
  })

  it("refuses a state with no id or no label", () => {
    expect(
      validateAssignmentCatalog(catalog([{ id: " ", label: "X", authority: "NONE", occupies: false }])).length,
    ).toBe(1)
    expect(
      validateAssignmentCatalog(catalog([{ id: "x", label: " ", authority: "NONE", occupies: false }])).length,
    ).toBe(1)
  })

  it("refuses explicitly unbounded full authority", () => {
    // Leaving requiresEnd unset is a substantive appointment. Setting it FALSE
    // says a temporary arrangement need not end, which is the thing to catch.
    const problems = validateAssignmentCatalog(
      catalog([{ id: "x", label: "X", authority: "FULL", occupies: true, requiresEnd: false }]),
    )
    expect(problems.map((p) => p.detail).join(" ")).toMatch(/unbounded full authority/)
  })

  it("refuses a preview state that can act", () => {
    // Live before its window and holding full authority: it acts before the
    // term it was granted for.
    const problems = validateAssignmentCatalog(
      catalog([{ id: "x", label: "X", authority: "FULL", occupies: false, liveBeforeStart: true }]),
    )
    expect(problems.map((p) => p.detail).join(" ")).toMatch(/acts before the term/)
  })

  it("accepts a narrowed catalog, so a tenant may use fewer states", () => {
    expect(
      validateAssignmentCatalog(
        catalog([
          { id: "active", label: "Active", authority: "FULL", occupies: true },
          { id: "former", label: "Former", authority: "NONE", occupies: false },
        ]),
      ),
    ).toEqual([])
  })
})
