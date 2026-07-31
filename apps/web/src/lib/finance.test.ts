import {
  formatCents,
  parseMoneyToCents,
  summarize,
  parseBudgetSheet,
} from "./finance"

describe("formatCents", () => {
  it("formats dollars and cents with commas", () => {
    expect(formatCents(123456)).toBe("$1,234.56")
    expect(formatCents(0)).toBe("$0.00")
    expect(formatCents(5)).toBe("$0.05")
  })
  it("handles negatives", () => {
    expect(formatCents(-4500)).toBe("-$45.00")
  })
})

describe("parseMoneyToCents", () => {
  it("parses plain numbers as dollars", () => {
    expect(parseMoneyToCents(12)).toBe(1200)
    expect(parseMoneyToCents(12.5)).toBe(1250)
  })
  it("strips currency symbols and commas", () => {
    expect(parseMoneyToCents("$1,200.50")).toBe(120050)
  })
  it("reads parenthesised and signed negatives", () => {
    expect(parseMoneyToCents("(300)")).toBe(-30000)
    expect(parseMoneyToCents("-45")).toBe(-4500)
  })
  it("returns null for blanks and non-numbers", () => {
    expect(parseMoneyToCents("")).toBeNull()
    expect(parseMoneyToCents(null)).toBeNull()
    expect(parseMoneyToCents("n/a")).toBeNull()
  })
})

describe("summarize", () => {
  it("computes variance, remaining and savings", () => {
    const s = summarize([
      { category: "Catering", budgetedCents: 100000, actualCents: 80000 },
      { category: "Venue", budgetedCents: 50000, actualCents: 60000 },
    ])
    expect(s.totalBudgetedCents).toBe(150000)
    expect(s.totalActualCents).toBe(140000)
    expect(s.varianceCents).toBe(10000) // 150k budget − 140k projected
    expect(s.remainingCents).toBe(10000)
    expect(s.projectedSavingsCents).toBe(10000)
    expect(s.projectedOverspendCents).toBe(0)
    expect(s.utilizationPct).toBe(93)
  })

  it("uses forecast when there is no actual yet", () => {
    const s = summarize([
      { category: "Swag", budgetedCents: 40000, actualCents: 0, forecastCents: 45000 },
    ])
    // Projected = forecast 45k, so variance is a 5k overspend
    expect(s.totalProjectedCents).toBe(45000)
    expect(s.varianceCents).toBe(-5000)
    expect(s.projectedOverspendCents).toBe(5000)
    expect(s.projectedSavingsCents).toBe(0)
  })

  it("does not divide by zero with an empty budget", () => {
    const s = summarize([{ category: "x", budgetedCents: 0, actualCents: 0 }])
    expect(s.utilizationPct).toBe(0)
  })
})

describe("parseBudgetSheet", () => {
  it("detects columns by fuzzy header names", () => {
    const res = parseBudgetSheet([
      ["Line Item", "Planned Budget", "Amount Spent"],
      ["Catering", "$1,000", "$800"],
      ["Venue", "500", "(50)"],
    ])
    expect(res.mapping).toEqual({
      category: "Line Item",
      budgeted: "Planned Budget",
      actual: "Amount Spent",
    })
    expect(res.rows).toEqual([
      { category: "Catering", budgetedCents: 100000, actualCents: 80000 },
      { category: "Venue", budgetedCents: 50000, actualCents: -5000 },
    ])
  })

  it("skips total rows and blank rows", () => {
    const res = parseBudgetSheet([
      ["Category", "Budget", "Actual"],
      ["Catering", "1000", "800"],
      ["", "", ""],
      ["Total", "1000", "800"],
    ])
    expect(res.rows).toHaveLength(1)
    expect(res.skipped).toBe(2)
  })

  it("merges duplicate categories", () => {
    const res = parseBudgetSheet([
      ["Category", "Budget", "Actual"],
      ["Food", "100", "50"],
      ["Food", "100", "75"],
    ])
    expect(res.rows).toHaveLength(1)
    expect(res.rows[0]).toEqual({ category: "Food", budgetedCents: 20000, actualCents: 12500 })
  })

  it("warns and still returns rows when a column is missing", () => {
    const res = parseBudgetSheet([
      ["Item", "Budget"],
      ["Catering", "1000"],
    ])
    expect(res.rows).toEqual([
      { category: "Catering", budgetedCents: 100000, actualCents: 0 },
    ])
    expect(res.warnings.some((w) => /actual/i.test(w))).toBe(true)
  })
})
