import {
  ELIGIBILITY_TARGET_KINDS,
  formatTargetRef,
  parseTargetRef,
  targetWindowState,
  validateTarget,
  type EligibilityTarget,
} from "./targets"

/**
 * IER-120-001 — "Implement workspace, module, feature, organization, workflow,
 * report, seat-candidate, connector, jurisdiction, and time eligibility
 * targets." IER-120-005 — "Enforce effective dates and future/expired states."
 */

const NOW = new Date("2026-06-01T12:00:00.000Z")

function target(over: Partial<EligibilityTarget> = {}): EligibilityTarget {
  return { kind: "module", id: "finance", capability: "budgeting", ...over }
}

describe("IER-120-001 — the ten target kinds the requirement names all exist", () => {
  // Written as the requirement's own list rather than as `ELIGIBILITY_TARGET_KINDS`
  // itself, so deleting a kind reds this test instead of redefining what it checks.
  const REQUIRED = [
    "workspace",
    "module",
    "feature",
    "organization",
    "workflow",
    "report",
    "seat_candidacy",
    "connector",
    "jurisdiction",
    "time_window",
  ] as const

  it.each(REQUIRED)("%s is a target kind", (kind) => {
    expect(ELIGIBILITY_TARGET_KINDS as readonly string[]).toContain(kind)
  })

  it("also carries the two kinds §17 lists that the requirement's sentence compresses away", () => {
    expect(ELIGIBILITY_TARGET_KINDS as readonly string[]).toContain("privileged_access_candidacy")
    expect(ELIGIBILITY_TARGET_KINDS as readonly string[]).toContain("environment")
  })

  it("is a closed set with no duplicates", () => {
    expect(new Set(ELIGIBILITY_TARGET_KINDS).size).toBe(ELIGIBILITY_TARGET_KINDS.length)
  })
})

describe("IER-120-001 — a target ref round-trips, and a malformed one is refused rather than repaired", () => {
  it.each(ELIGIBILITY_TARGET_KINDS)("%s round-trips through its ref", (kind) => {
    const parsed = parseTargetRef(formatTargetRef({ kind, id: "thing-1" }))
    expect(parsed).toEqual({ ok: true, kind, id: "thing-1" })
  })

  it("refuses a kind this deployment does not have", () => {
    expect(parseTargetRef("database:public")).toEqual({
      ok: false,
      problem: '"database" is not an eligibility target kind',
    })
  })

  it("refuses a ref with no separator", () => {
    expect(parseTargetRef("finance")).toEqual({
      ok: false,
      problem: '"finance" has no "kind:id" separator',
    })
  })

  it("refuses a kind with no target after it", () => {
    expect(parseTargetRef("module:")).toEqual({
      ok: false,
      problem: '"module:" names a kind but no target',
    })
  })

  it("refuses a second separator instead of guessing which one divides the ref", () => {
    expect(parseTargetRef("module:finance:reports")).toEqual({
      ok: false,
      problem: '"module:finance:reports" has more than one separator',
    })
  })

  it("does not trim, case-fold, or otherwise repair a ref", () => {
    expect(parseTargetRef("module:finance ").ok).toBe(false)
    expect(parseTargetRef("Module:finance").ok).toBe(false)
  })

  it("refuses a non-string", () => {
    expect(parseTargetRef(undefined).ok).toBe(false)
    expect(parseTargetRef(42).ok).toBe(false)
  })
})

describe("IER-120-001 — validation says which field is wrong, not merely that something is", () => {
  it("accepts a well-formed target", () => {
    expect(validateTarget(target())).toEqual([])
  })

  it("refuses a target with no tenant capability behind it", () => {
    const problems = validateTarget(target({ capability: "" }))
    expect(problems.map((p) => p.path)).toEqual(["capability"])
  })

  it("requires an organization target to name its org unit", () => {
    expect(validateTarget(target({ kind: "organization", id: "club-1" })).map((p) => p.path)).toEqual([
      "orgUnitId",
    ])
    expect(
      validateTarget(target({ kind: "organization", id: "club-1", orgUnitId: "club-1" })),
    ).toEqual([])
  })

  it("requires a jurisdiction target to name its jurisdiction and an environment target its environment", () => {
    expect(validateTarget(target({ kind: "jurisdiction", id: "us-ny" })).map((p) => p.path)).toEqual([
      "jurisdiction",
    ])
    expect(validateTarget(target({ kind: "environment", id: "prod" })).map((p) => p.path)).toEqual([
      "environment",
    ])
  })

  it("requires a time-window target to carry its window", () => {
    expect(validateTarget(target({ kind: "time_window", id: "term-2026" })).map((p) => p.path)).toEqual(
      ["window"],
    )
  })

  it("refuses a window that closes before it opens", () => {
    const problems = validateTarget(
      target({ window: { from: "2026-09-01T00:00:00.000Z", to: "2026-08-01T00:00:00.000Z" } }),
    )
    expect(problems.map((p) => p.path)).toEqual(["window.to"])
  })

  it("refuses a window whose instants are not instants", () => {
    expect(
      validateTarget(target({ window: { from: "next september", to: null } })).map((p) => p.path),
    ).toEqual(["window.from"])
  })

  it("refuses an id that could not survive a ref", () => {
    expect(validateTarget(target({ id: "fin ance" })).map((p) => p.path)).toEqual(["id"])
    expect(validateTarget(target({ id: "" })).map((p) => p.path)).toEqual(["id"])
  })
})

describe("IER-120-005 — four window states, because 'not yet' and 'no longer' are different sentences", () => {
  it("reports an undated target as UNBOUNDED rather than as active", () => {
    expect(targetWindowState(target(), NOW)).toBe("UNBOUNDED")
  })

  it("reports a target whose window has not opened as NOT_YET_ACTIVE", () => {
    expect(
      targetWindowState(target({ window: { from: "2026-09-01T00:00:00.000Z", to: null } }), NOW),
    ).toBe("NOT_YET_ACTIVE")
  })

  it("reports a target inside its window as ACTIVE", () => {
    expect(
      targetWindowState(
        target({ window: { from: "2026-01-01T00:00:00.000Z", to: "2026-12-31T00:00:00.000Z" } }),
        NOW,
      ),
    ).toBe("ACTIVE")
  })

  it("reports a closed target as EXPIRED", () => {
    expect(
      targetWindowState(
        target({ window: { from: "2025-01-01T00:00:00.000Z", to: "2026-01-01T00:00:00.000Z" } }),
        NOW,
      ),
    ).toBe("EXPIRED")
  })

  it("opens at `from` inclusively and closes at `to` exclusively", () => {
    const window = { from: NOW.toISOString(), to: "2026-12-31T00:00:00.000Z" }
    expect(targetWindowState(target({ window }), NOW)).toBe("ACTIVE")
    expect(targetWindowState(target({ window: { from: window.from, to: NOW.toISOString() } }), NOW)).toBe(
      "EXPIRED",
    )
  })

  it("treats an unreadable close as closed, which is the reading that cannot widen access", () => {
    expect(
      targetWindowState(target({ window: { from: "2025-01-01T00:00:00.000Z", to: "whenever" } }), NOW),
    ).toBe("EXPIRED")
  })
})
