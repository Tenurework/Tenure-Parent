import {
  formatCents,
  formatCentsIn,
  ledgerSignedCents,
  parseMoneyToCents,
  summarize,
  parseBudgetSheet,
} from "./finance"
import { DEFAULT_MONEY_FORMAT, type MoneyFormat } from "@tenure/platform-config/money"

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

// ── Currency precision invariants ────────────────────────────────────────────
// Every case below is a real amount a treasurer can type into the finance form
// or leave in a spreadsheet cell. They all rounded wrong while the parser went
// through `Math.round(value * 100)`.

/** Amounts, in minor units, exercised by the round-trip invariants. */
const AMOUNT_TABLE = [0, 1, 5, 9, 99, 100, 101, 999, 1234, 12345, 123456, 999999999]

describe("parseMoneyToCents — precision and rounding", () => {
  it("rounds half away from zero instead of through a float", () => {
    // 1.005 and 0.145 are both a hair BELOW their decimal value as doubles, so
    // Math.round(x * 100) truncated them. The digits say otherwise.
    expect(parseMoneyToCents("1.005")).toBe(101)
    expect(parseMoneyToCents("0.145")).toBe(15)
    expect(parseMoneyToCents("2.675")).toBe(268)
    expect(parseMoneyToCents("0.005")).toBe(1)
  })

  it("rounds half away from zero in both signs, symmetrically", () => {
    for (const [text, cents] of [
      ["0.005", 1],
      ["1.005", 101],
      ["0.145", 15],
      ["2.675", 268],
      ["1200.505", 120051],
    ] as const) {
      expect(parseMoneyToCents(text)).toBe(cents)
      expect(parseMoneyToCents(`-${text}`)).toBe(-cents)
      expect(parseMoneyToCents(`(${text})`)).toBe(-cents)
    }
  })

  it("keeps the number and string branches in agreement", () => {
    // These two entry paths are both live: xlsx cells arrive as numbers through
    // parseBudgetSheet, form fields arrive as strings through the server action.
    // They used to disagree — -0.005 gave -0 as a number and -1 as a string.
    for (const n of [
      0, -0, 0.005, -0.005, 1.005, -1.005, 0.145, -0.145, 12.5, -12.5, 1200.5, -1200.5,
      2.675, -2.675, 0.1 + 0.2, 45, -45,
    ]) {
      expect(parseMoneyToCents(n)).toBe(parseMoneyToCents(String(n)))
    }
  })

  it("never returns negative zero", () => {
    for (const v of [-0, "-0", "-0.00", "-0.004", "(0)", "(0.001)"] as const) {
      const cents = parseMoneyToCents(v)
      expect(cents).toBe(0)
      expect(Object.is(cents, -0)).toBe(false)
    }
    // -0.004 is under half a cent; -0.005 is exactly half and rounds away.
    expect(parseMoneyToCents("-0.005")).toBe(-1)
    expect(parseMoneyToCents(-0.005)).toBe(-1)
  })

  it("truncates nothing above the rounding digit", () => {
    expect(parseMoneyToCents("0.004999999999")).toBe(0)
    expect(parseMoneyToCents("0.0050000001")).toBe(1)
    expect(parseMoneyToCents("1.004999")).toBe(100)
    expect(parseMoneyToCents(".50")).toBe(50)
  })

  it("parses amounts too large for a double exactly, and rejects the rest", () => {
    // 2^53-1 cents. A float multiply would have lost the low digits.
    expect(parseMoneyToCents("90071992547409.91")).toBe(Number.MAX_SAFE_INTEGER)
    expect(parseMoneyToCents("90071992547409.92")).toBeNull()
    expect(parseMoneyToCents(1e21)).toBeNull()
  })

  it("handles numbers JavaScript prints in exponent notation", () => {
    expect(parseMoneyToCents(1e-7)).toBe(0)
    expect(parseMoneyToCents(5e-3)).toBe(1)
    expect(parseMoneyToCents(1.5e3)).toBe(150000)
    expect(parseMoneyToCents(-1.5e3)).toBe(-150000)
  })

  it("round-trips every amount through the formatter", () => {
    for (const cents of AMOUNT_TABLE) {
      expect(parseMoneyToCents(formatCents(cents))).toBe(cents)
      // -0 is not in the value space: negating zero still parses back to 0.
      const negated = cents === 0 ? 0 : -cents
      expect(parseMoneyToCents(formatCents(negated))).toBe(negated)
    }
  })
})

describe("parseMoneyToCents — minor-unit exponent", () => {
  const YEN: MoneyFormat = { locale: "en-US", currency: "JPY" }
  const DINAR: MoneyFormat = { locale: "en-US", currency: "KWD" }

  /** The divisor `formatMoney` applies, derived the same way it derives it. */
  const exponentOf = (format: MoneyFormat) =>
    new Intl.NumberFormat(format.locale, { style: "currency", currency: format.currency })
      .resolvedOptions().maximumFractionDigits ?? 2

  it("is the exact inverse of the formatter's divisor for every currency", () => {
    // formatMoney renders `cents / 10 ** digits`. Parsing that same number back
    // has to return `cents`, or stored totals drift by a factor of 10 ** n. A
    // parser hardcoded to * 100 fails this for JPY (0 digits) and KWD (3).
    for (const format of [DEFAULT_MONEY_FORMAT, YEN, DINAR]) {
      const digits = exponentOf(format)
      for (const minorUnits of AMOUNT_TABLE) {
        const major = minorUnits / 10 ** digits
        expect(parseMoneyToCents(String(major), format)).toBe(minorUnits)
        expect(parseMoneyToCents(major, format)).toBe(minorUnits)
      }
    }
  })

  it("counts whole yen, not hundredths of one", () => {
    expect(exponentOf(YEN)).toBe(0)
    expect(parseMoneyToCents("1234", YEN)).toBe(1234)
    expect(parseMoneyToCents("¥1,234", YEN)).toBeNull() // symbol charset, see doc
    expect(parseMoneyToCents("12.5", YEN)).toBe(13) // half away from zero
    expect(parseMoneyToCents("-12.5", YEN)).toBe(-13)
    expect(parseMoneyToCents("12.4", YEN)).toBe(12)
    expect(formatCentsIn(1234, YEN)).toBe("¥1,234")
  })

  it("keeps three digits for a thousandth-unit currency", () => {
    expect(exponentOf(DINAR)).toBe(3)
    expect(parseMoneyToCents("1.234", DINAR)).toBe(1234)
    expect(parseMoneyToCents("1.2345", DINAR)).toBe(1235)
    expect(parseMoneyToCents("-1.2345", DINAR)).toBe(-1235)
    expect(parseMoneyToCents("1.2344", DINAR)).toBe(1234)
  })

  it("defaults to cents, so the existing call sites are unchanged", () => {
    expect(parseMoneyToCents("12.34")).toBe(parseMoneyToCents("12.34", DEFAULT_MONEY_FORMAT))
    expect(parseMoneyToCents("12.34")).toBe(1234)
  })

  it("falls back to two digits for a currency Intl does not know", () => {
    expect(parseMoneyToCents("12.34", { locale: "en-US", currency: "ZZZZZ" })).toBe(1234)
  })
})

describe("money invariants across the ledger", () => {
  it("nets a posting and its reversal to exactly zero", () => {
    for (const text of ["1.005", "0.145", "1,200.50", "(300)", "-45", "0.005", "99999.99"]) {
      const magnitude = parseMoneyToCents(text)
      expect(magnitude).not.toBeNull()
      const spend = ledgerSignedCents("SPEND", magnitude as number)
      const reversal = ledgerSignedCents("REIMBURSEMENT", magnitude as number)
      expect(spend + reversal).toBe(0)
      // And the reversal of a reversal does not drift back to a new magnitude.
      expect(ledgerSignedCents("SPEND", reversal) + reversal).toBe(0)
    }
  })

  it("keeps summarize totals equal to the sum of the parsed lines", () => {
    const raw = [
      { category: "Catering", budgeted: "1,000.005", actual: "800.145" },
      { category: "Venue", budgeted: "500.50", actual: "(50.005)" },
      { category: "Swag", budgeted: "0.145", actual: "0" },
    ]
    const lines = raw.map((r) => ({
      category: r.category,
      budgetedCents: parseMoneyToCents(r.budgeted) as number,
      actualCents: parseMoneyToCents(r.actual) as number,
    }))
    expect(lines.map((l) => l.budgetedCents)).toEqual([100001, 50050, 15])
    expect(lines.map((l) => l.actualCents)).toEqual([80015, -5001, 0])

    const s = summarize(lines)
    expect(s.totalBudgetedCents).toBe(lines.reduce((a, l) => a + l.budgetedCents, 0))
    expect(s.totalActualCents).toBe(lines.reduce((a, l) => a + l.actualCents, 0))
    expect(s.varianceCents).toBe(s.totalBudgetedCents - s.totalProjectedCents)
    expect(s.remainingCents).toBe(s.totalBudgetedCents - s.totalActualCents)
    expect(s.projectedSavingsCents - s.projectedOverspendCents).toBe(s.varianceCents)
    // Every total is an exact integer — no float ever entered the chain.
    for (const v of [s.totalBudgetedCents, s.totalActualCents, s.totalProjectedCents]) {
      expect(Number.isSafeInteger(v)).toBe(true)
    }
  })

  it("sums a spreadsheet of half-cent values without drift", () => {
    // 100 lines of $0.145 each. Every line rounds to 15 cents, so the sheet
    // totals $15.00 — the float parser rounded each to 14 and lost a dollar.
    const rows: unknown[][] = [["Category", "Budget", "Actual"]]
    for (let i = 0; i < 100; i++) rows.push([`Line ${i}`, "0.145", "0.145"])
    const res = parseBudgetSheet(rows)
    const total = res.rows.reduce((a, r) => a + r.budgetedCents, 0)
    expect(total).toBe(1500)
    expect(summarize(res.rows.map((r) => ({ ...r }))).totalBudgetedCents).toBe(1500)
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
