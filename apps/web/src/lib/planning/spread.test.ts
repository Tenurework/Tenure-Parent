/**
 * PLN-030-001 — spreading, allocation and reconciliation, proven.
 *
 * The assertions that matter are the conservation ones: Σ parts === the whole,
 * for every basis, at amounts chosen so that naive per-share rounding loses a
 * unit. A spreading engine that is out by a cent is one whose totals a reviewer
 * cannot tie, and every other property here is downstream of that.
 *
 * The refusals are tested as thoroughly as the successes, because each of them
 * is a case where a wrong answer is available and looks right: an all-zero basis
 * silently splitting evenly, a manual spread quietly reweighted to fit, an
 * exclusion that matches nothing, a step-down charging backwards, an undecided
 * reconciliation resolving to one side.
 */

import {
  SPREAD_BASES,
  SpreadRuleError,
  allocateActivityBased,
  allocateDirect,
  allocateReciprocal,
  allocateStepDown,
  applyDecision,
  assertRuleComplete,
  reconcile,
  spread,
  type SpreadRule,
} from "./spread"

/** A complete rule. Tests clone and change one field, so the base is always valid. */
const RULE: SpreadRule = {
  id: "club-target-2026",
  source: "Budget.allocatedCents for organization ose-finance, FY2026-2027",
  target: "BudgetLine.category",
  basis: "even",
  exclusions: [],
  order: 10,
  currency: "USD",
  unit: "currency",
  precision: "down",
  zeroNegative: "refuse-negative",
  effectiveFrom: "2026-07-01",
  effectiveTo: "2027-06-30",
  owner: "seat:finance-officer",
  approval: null,
  test: "apps/web/src/lib/planning/spread.test.ts",
}

const members = (...keys: string[]) => keys.map((key) => ({ key }))
const total = (cells: readonly { minorUnits: number }[]) =>
  cells.reduce((running, cell) => running + cell.minorUnits, 0)

describe("spread", () => {
  it("splits an indivisible target so the parts add back to exactly the target", () => {
    // 1,000,000 cents over three categories is 333,333.33 each. Rounding each
    // share independently gives 999,999 and loses a cent from a budget.
    const result = spread({
      rule: RULE,
      targetMinorUnits: 1_000_000,
      members: members("Catering", "Venue", "Swag"),
    })

    expect(result.cells.map((c) => c.minorUnits)).toEqual([333_334, 333_333, 333_333])
    expect(result.spreadMinorUnits).toBe(1_000_000)
    expect(total(result.cells)).toBe(result.targetMinorUnits)
  })

  it("is deterministic — the same input splits the same way every time", () => {
    const once = spread({ rule: RULE, targetMinorUnits: 100, members: members("a", "b", "c", "d", "e", "f", "g") })
    const twice = spread({ rule: RULE, targetMinorUnits: 100, members: members("a", "b", "c", "d", "e", "f", "g") })
    expect(once.cells.map((c) => c.minorUnits)).toEqual(twice.cells.map((c) => c.minorUnits))
    expect(total(once.cells)).toBe(100)
  })

  it("spreads proportionally to the contributors' own proposals", () => {
    const result = spread({
      rule: { ...RULE, basis: "proportional" },
      targetMinorUnits: 800_000,
      members: [
        { key: "Catering", proposedMinorUnits: 500_000 },
        { key: "Venue", proposedMinorUnits: 300_000 },
        { key: "Swag", proposedMinorUnits: 145_000 },
      ],
    })
    expect(total(result.cells)).toBe(800_000)
    // Catering asked for 500/945 of the proposal and receives that share of the target.
    expect(result.cells[0].minorUnits).toBe(Math.floor((800_000 * 500_000) / 945_000) + 1)
    expect(result.cells[0].weight).toBe(500_000)
    expect(result.cells[0].totalWeight).toBe(945_000)
  })

  it.each([
    ["driver", { driverWeight: 3 }, { driverWeight: 1 }],
    ["seasonal", { seasonalWeight: 3 }, { seasonalWeight: 1 }],
    ["historical", { priorActualMinorUnits: 300 }, { priorActualMinorUnits: 100 }],
  ] as const)("reads the %s basis from its own field", (basis, heavy, light) => {
    const result = spread({
      rule: { ...RULE, basis },
      targetMinorUnits: 400,
      members: [
        { key: "heavy", ...heavy },
        { key: "light", ...light },
      ],
    })
    expect(result.cells.map((c) => c.minorUnits)).toEqual([300, 100])
    expect(result.cells[0].basis).toBe(basis)
  })

  it("refuses a member with no value for the basis rather than giving it nothing", () => {
    expect(() =>
      spread({
        rule: { ...RULE, basis: "driver" },
        targetMinorUnits: 100,
        members: [{ key: "measured", driverWeight: 1 }, { key: "unmeasured" }],
      }),
    ).toThrow(/has no driverWeight/)
  })

  it("uses a manual spread verbatim", () => {
    const result = spread({
      rule: { ...RULE, basis: "manual" },
      targetMinorUnits: 1_001,
      members: [
        { key: "Catering", manualMinorUnits: 700 },
        { key: "Venue", manualMinorUnits: 301 },
      ],
    })
    // 700/301 is not a split any weighting would produce, which is the point.
    expect(result.cells.map((c) => c.minorUnits)).toEqual([700, 301])
    expect(result.spreadMinorUnits).toBe(1_001)
  })

  it("refuses a manual spread that does not add to the target instead of reweighting it", () => {
    expect(() =>
      spread({
        rule: { ...RULE, basis: "manual" },
        targetMinorUnits: 1_000,
        members: [
          { key: "Catering", manualMinorUnits: 700 },
          { key: "Venue", manualMinorUnits: 250 },
        ],
      }),
    ).toThrow(/must add to the target/)
  })

  it("records an exclusion at zero rather than dropping the member", () => {
    const result = spread({
      rule: { ...RULE, exclusions: ["Contingency"] },
      targetMinorUnits: 300,
      members: members("Catering", "Venue", "Contingency"),
    })
    expect(result.cells).toHaveLength(3)
    expect(result.cells.map((c) => c.minorUnits)).toEqual([150, 150, 0])
    expect(result.cells[2].excluded).toBe(true)
    expect(result.excluded).toEqual(["Contingency"])
    expect(total(result.cells)).toBe(300)
  })

  it("refuses an exclusion that matches no member", () => {
    expect(() =>
      spread({ rule: { ...RULE, exclusions: ["Typo"] }, targetMinorUnits: 100, members: members("Catering") }),
    ).toThrow(/excludes Typo, which is not a member/)
  })

  it("refuses a basis that measured zero everywhere instead of splitting evenly", () => {
    expect(() =>
      spread({
        rule: { ...RULE, basis: "historical" },
        targetMinorUnits: 500,
        members: [
          { key: "new-a", priorActualMinorUnits: 0 },
          { key: "new-b", priorActualMinorUnits: 0 },
        ],
      }),
    ).toThrow(/no\s+defensible split/)
  })

  it("refuses the same member key twice", () => {
    expect(() => spread({ rule: RULE, targetMinorUnits: 100, members: members("a", "a") })).toThrow(/twice/)
  })

  it("refuses a negative target when the rule says to, and spreads one when it does not", () => {
    expect(() => spread({ rule: RULE, targetMinorUnits: -500, members: members("a", "b") })).toThrow(
      /refuse-negative/,
    )
    const reduction = spread({
      rule: { ...RULE, zeroNegative: "allow-negative" },
      targetMinorUnits: -501,
      members: members("a", "b"),
    })
    expect(total(reduction.cells)).toBe(-501)
  })

  it("refuses a fractional target rather than rounding money the caller did not move", () => {
    expect(() => spread({ rule: RULE, targetMinorUnits: 100.5, members: members("a") })).toThrow(
      /whole number of minor units/,
    )
  })

  it("refuses an empty axis", () => {
    expect(() => spread({ rule: RULE, targetMinorUnits: 100, members: [] })).toThrow(/no members/)
  })

  it("carries the basis, the weights and the original source on every cell", () => {
    // §7: "Allocation results drill to basis and original source."
    const result = spread({
      rule: { ...RULE, basis: "driver" },
      targetMinorUnits: 100,
      members: [{ key: "a", driverWeight: 1 }, { key: "b", driverWeight: 3 }],
    })
    for (const cell of result.cells) {
      expect(cell.ruleId).toBe(RULE.id)
      expect(cell.basis).toBe("driver")
      expect(cell.source).toBe(RULE.source)
      expect(cell.currency).toBe("USD")
      expect(cell.totalWeight).toBe(4)
    }
    expect(result.cells.map((c) => c.weight)).toEqual([1, 3])
  })

  it("implements every basis section 7 names", () => {
    expect([...SPREAD_BASES]).toEqual(["even", "proportional", "driver", "seasonal", "historical", "manual"])
  })
})

describe("assertRuleComplete", () => {
  it("accepts the complete rule", () => {
    expect(() => assertRuleComplete(RULE)).not.toThrow()
  })

  it.each(["id", "source", "target", "currency", "owner", "test"] as const)(
    "refuses a rule whose %s is blank",
    (field) => {
      expect(() => assertRuleComplete({ ...RULE, [field]: "   " })).toThrow(SpreadRuleError)
    },
  )

  it("refuses a unit nothing in this schema can store", () => {
    expect(() => assertRuleComplete({ ...RULE, unit: "fte" as never })).toThrow(/cannot be spread/)
  })

  it("refuses an effective period that ends before it starts, and a malformed date", () => {
    expect(() => assertRuleComplete({ ...RULE, effectiveFrom: "2027-07-01" })).toThrow(/ends before it starts/)
    expect(() => assertRuleComplete({ ...RULE, effectiveTo: "June 2027" })).toThrow(/YYYY-MM-DD/)
  })

  it("refuses a currency that is not a three-letter code", () => {
    expect(() => assertRuleComplete({ ...RULE, currency: "usd" })).toThrow(/ISO 4217/)
    expect(() => assertRuleComplete({ ...RULE, currency: "DOLLARS" })).toThrow(/ISO 4217/)
  })
})

describe("allocation", () => {
  it("allocates each pool directly to its consumers, losing nothing", () => {
    const results = allocateDirect({
      rule: RULE,
      consumers: ["club-a", "club-b", "club-c"],
      pools: [
        { id: "shared-venue", minorUnits: 100_000, consumption: { "club-a": 2, "club-b": 1, "club-c": 1 } },
        { id: "shared-print", minorUnits: 33_333, consumption: { "club-a": 1, "club-b": 1, "club-c": 1 } },
      ],
    })
    expect(results).toHaveLength(2)
    expect(total(results[0].cells)).toBe(100_000)
    expect(total(results[1].cells)).toBe(33_333)
    expect(results[0].cells.map((c) => c.minorUnits)).toEqual([50_000, 25_000, 25_000])
  })

  it("steps down in order: an earlier pool charges a later one, never the reverse", () => {
    const { steps, consumerTotals, allocatedMinorUnits } = allocateStepDown({
      rule: RULE,
      consumers: ["club-a", "club-b"],
      pools: [
        // Facilities serves IT and both clubs.
        { id: "facilities", minorUnits: 40_000, consumption: { it: 2, "club-a": 1, "club-b": 1 } },
        // IT serves only the clubs — and its balance now includes what facilities charged it.
        { id: "it", minorUnits: 10_000, consumption: { "club-a": 3, "club-b": 1, facilities: 99 } },
      ],
    })

    expect(steps).toHaveLength(2)
    // Step 1 spreads 40,000 over {club-a, club-b, it} by 1:1:2 → 10k/10k/20k.
    expect(total(steps[0].cells)).toBe(40_000)
    // Step 2 spreads IT's own 10,000 plus the 20,000 pushed onto it. Its
    // `consumption` names `facilities` with a weight of 99, and step-down must
    // ignore it: facilities is already closed.
    expect(steps[1].targetMinorUnits).toBe(30_000)
    expect(steps[1].cells.map((c) => c.key)).toEqual(["club-a", "club-b"])
    // Nothing is lost and nothing is invented: every cent of both pools lands on
    // a final consumer.
    expect(allocatedMinorUnits).toBe(50_000)
    expect(consumerTotals["club-a"] + consumerTotals["club-b"]).toBe(50_000)
    expect(consumerTotals).toEqual({ "club-a": 32_500, "club-b": 17_500 })
  })

  it("refuses a key that is both a pool and a final consumer", () => {
    expect(() =>
      allocateStepDown({
        rule: RULE,
        consumers: ["it"],
        pools: [{ id: "it", minorUnits: 100, consumption: { it: 1 } }],
      }),
    ).toThrow(/both a pool and a final consumer/)
  })

  it("refuses the same pool twice, because the order would be ambiguous", () => {
    expect(() =>
      allocateStepDown({
        rule: RULE,
        consumers: ["club-a"],
        pools: [
          { id: "it", minorUnits: 100, consumption: { "club-a": 1 } },
          { id: "it", minorUnits: 200, consumption: { "club-a": 1 } },
        ],
      }),
    ).toThrow(/same pool twice/)
  })

  it("refuses reciprocal and activity-based allocation, naming what each would need", () => {
    expect(() => allocateReciprocal()).toThrow(/simultaneous equations/)
    expect(() => allocateActivityBased()).toThrow(/activity model with cost drivers/)
    expect(() => allocateReciprocal()).toThrow(SpreadRuleError)
  })
})

describe("reconcile", () => {
  const topDown = { Catering: 400_000, Venue: 300_000, Swag: 100_000 }
  const bottomUp = { Catering: 500_000, Venue: 300_000, Travel: 145_000 }

  it("keeps both sides and never overwrites either", () => {
    const record = reconcile({ currency: "USD", topDown, bottomUp })
    expect(record.topDownTotalMinorUnits).toBe(800_000)
    expect(record.bottomUpTotalMinorUnits).toBe(945_000)
    expect(record.varianceMinorUnits).toBe(145_000)
    expect(record.decision).toBeNull()
  })

  it("lines up the union of both axes, so a total always ties to its lines", () => {
    const record = reconcile({ currency: "USD", topDown, bottomUp })
    expect(record.lines.map((l) => l.key)).toEqual(["Catering", "Swag", "Travel", "Venue"])
    // Swag is in the target and not the proposal; Travel is the reverse.
    expect(record.lines.find((l) => l.key === "Swag")).toEqual({
      key: "Swag",
      topDownMinorUnits: 100_000,
      bottomUpMinorUnits: 0,
      varianceMinorUnits: -100_000,
    })
    expect(record.lines.find((l) => l.key === "Travel")?.varianceMinorUnits).toBe(145_000)
    expect(record.lines.reduce((sum, l) => sum + l.topDownMinorUnits, 0)).toBe(record.topDownTotalMinorUnits)
    expect(record.lines.reduce((sum, l) => sum + l.bottomUpMinorUnits, 0)).toBe(record.bottomUpTotalMinorUnits)
  })

  it("refuses a negotiated decision that does not say what was negotiated", () => {
    expect(() =>
      reconcile({
        currency: "USD",
        topDown,
        bottomUp,
        decision: { outcome: "negotiated", by: "seat:advisor", at: "2026-08-01T12:00:00Z", rationale: "split" },
      }),
    ).toThrow(/must state the negotiated total/)
  })

  it("refuses a third number on a decision that accepted one of the two", () => {
    expect(() =>
      reconcile({
        currency: "USD",
        topDown,
        bottomUp,
        decision: {
          outcome: "accept-top-down",
          negotiatedMinorUnits: 850_000,
          by: "seat:advisor",
          at: "2026-08-01T12:00:00Z",
          rationale: "held the line",
        },
      }),
    ).toThrow(/must not carry a negotiated total/)
  })

  it("refuses a decision with no owner or no rationale", () => {
    const base = { outcome: "accept-top-down", at: "2026-08-01T12:00:00Z" } as const
    expect(() =>
      reconcile({ currency: "USD", topDown, bottomUp, decision: { ...base, by: "", rationale: "x" } }),
    ).toThrow(/owner and a rationale/)
    expect(() =>
      reconcile({ currency: "USD", topDown, bottomUp, decision: { ...base, by: "seat:a", rationale: "  " } }),
    ).toThrow(/owner and a rationale/)
  })

  it("will not settle an undecided reconciliation", () => {
    const record = reconcile({ currency: "USD", topDown, bottomUp })
    expect(() => applyDecision(record, RULE)).toThrow(/no decision/)
  })

  it("returns the winning side verbatim when one side is accepted", () => {
    const record = reconcile({
      currency: "USD",
      topDown,
      bottomUp,
      decision: {
        outcome: "accept-top-down",
        by: "seat:advisor",
        at: "2026-08-01T12:00:00Z",
        rationale: "the allocation did not change",
      },
    })
    const { settled, spreadResult } = applyDecision(record, RULE)
    expect(settled).toEqual({ Catering: 400_000, Swag: 100_000, Travel: 0, Venue: 300_000 })
    expect(spreadResult).toBeNull()
    // Both sides are still on the record afterwards.
    expect(record.bottomUpTotalMinorUnits).toBe(945_000)
  })

  it("spreads a negotiated total over the proposal, to the unit", () => {
    const record = reconcile({
      currency: "USD",
      topDown,
      bottomUp,
      decision: {
        outcome: "negotiated",
        negotiatedMinorUnits: 870_001,
        by: "seat:advisor",
        at: "2026-08-01T12:00:00Z",
        rationale: "met in the middle after the travel line was evidenced",
      },
    })
    const { settled, spreadResult } = applyDecision(record, RULE)
    const sum = Object.values(settled).reduce((running, value) => running + value, 0)
    expect(sum).toBe(870_001)
    expect(spreadResult?.basis).toBe("proportional")
    // Swag proposed nothing, so it receives nothing from a proposal-weighted split.
    expect(settled.Swag).toBe(0)
  })
})
