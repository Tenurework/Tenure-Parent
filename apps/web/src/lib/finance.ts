/**
 * Finance calculations and spreadsheet parsing — pure, so they can be unit
 * tested and reused by both the server (import, persistence) and the client
 * (live forecasting).
 *
 * Money is integer cents everywhere, matching the Prisma models. Floating
 * point never touches a currency total.
 */

// The /money subpath, not the package root: the root reaches node:crypto via the
// configuration resolver, and this module is imported by client components.
import {
  DEFAULT_MONEY_FORMAT,
  formatMoney,
  type MoneyFormat,
} from "@tenure/platform-config/money"

export type BudgetLineInput = {
  category: string
  budgetedCents: number
  actualCents: number
  forecastCents?: number | null
}

export type FinanceSummary = {
  totalBudgetedCents: number
  totalActualCents: number
  /** Actual where present, else the saved/entered forecast, else 0 */
  totalProjectedCents: number
  /** budgeted − projected. Positive = under budget (savings). */
  varianceCents: number
  /** budgeted − actual. What is left to spend against plan. */
  remainingCents: number
  /** Positive variance only — money you are on track to save. */
  projectedSavingsCents: number
  /** Negative variance as a positive number — money you are on track to overspend. */
  projectedOverspendCents: number
  utilizationPct: number
  lineCount: number
}

/**
 * "$1,234.56" from cents, in the platform default currency.
 *
 * Kept for the 36 call sites that have no tenant in hand — most of them client
 * components rendering a number they were handed. Output is unchanged: the Intl
 * path it now delegates to was checked byte-for-byte against the hand-rolled
 * one for positives, negatives, zero, sub-dollar amounts and millions.
 *
 * A surface that DOES know its tenant should use `formatCentsIn` instead, which
 * is the only one of the two that is right for a tenant not denominated in
 * dollars.
 */
export function formatCents(cents: number): string {
  return formatMoney(cents)
}

/** "£1,234.56" — the same amount, in one tenant's locale and currency. */
export function formatCentsIn(cents: number, format: MoneyFormat): string {
  return formatMoney(cents, format)
}

/** "$1.2k" / "$980" for compact axis labels. */
export function formatCentsCompact(cents: number): string {
  const sign = cents < 0 ? "-" : ""
  const dollars = Math.abs(cents) / 100
  if (dollars >= 1000) return `${sign}$${(dollars / 1000).toFixed(dollars >= 10000 ? 0 : 1)}k`
  return `${sign}$${Math.round(dollars)}`
}

/**
 * How many digits the minor unit has: 2 for USD, 0 for JPY, 3 for KWD.
 *
 * Resolved by the *same* expression `formatMoney` uses to pick its divisor
 * (packages/platform-config/src/money.ts), so parsing is the exact inverse of
 * formatting rather than a second, independently-wrong guess. A hardcoded 100
 * here against `10 ** digits` there is a hundredfold error on a JPY tenant.
 *
 * Cached because a budget import resolves this once per spreadsheet cell and
 * constructing an `Intl.NumberFormat` is not free.
 */
const minorUnitDigitsByFormat = new Map<string, number>()

function minorUnitExponent(format: MoneyFormat): number {
  const key = `${format.locale}|${format.currency}`
  const cached = minorUnitDigitsByFormat.get(key)
  if (cached !== undefined) return cached
  let digits: number
  try {
    digits =
      new Intl.NumberFormat(format.locale, {
        style: "currency",
        currency: format.currency,
      }).resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    // An unknown locale or currency code throws RangeError. Fall back to the
    // platform default's 2 rather than propagating out of a parse.
    digits = 2
  }
  minorUnitDigitsByFormat.set(key, digits)
  return digits
}

/**
 * The digits of a finite number, without exponent notation.
 *
 * `String(1e-7)` is "1e-7" and `String(1e21)` is "1e+21"; neither survives
 * digit-wise rounding. Everything in between is already plain, and is the
 * shortest string that round-trips to the same double — which is precisely the
 * decimal a spreadsheet cell was showing.
 */
function toPlainDecimalString(n: number): string {
  const s = String(n)
  if (!s.includes("e") && !s.includes("E")) return s
  const m = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(s)
  if (!m) return s
  const [, sign, intDigits, fracDigits = "", expText] = m
  const exp = Number(expText)
  const digits = intDigits + fracDigits
  const pointAt = intDigits.length + exp
  if (pointAt <= 0) return `${sign}0.${"0".repeat(-pointAt)}${digits}`
  if (pointAt >= digits.length) return `${sign}${digits}${"0".repeat(pointAt - digits.length)}`
  return `${sign}${digits.slice(0, pointAt)}.${digits.slice(pointAt)}`
}

/**
 * Parse a currency-ish value into integer minor units. Accepts numbers (assumed
 * major units) and strings with $, commas, and parenthesised negatives, which is
 * how accounting spreadsheets write them: "$1,200.50", "(300)", "-45".
 * Returns null for anything that is not a number.
 *
 * Rounding happens on the decimal *digits*, half away from zero, never through
 * a float: `Math.round(value * 100)` disagreed with itself across the number and
 * string branches (`-0.005` gave `-0`, `"-0.005"` gave `-1`) and lost the
 * half-way case entirely, because 1.005 and 0.145 are both a hair below their
 * decimal value as doubles, so `"1.005"` yielded 100 and `"0.145"` yielded 14.
 * Both branches now share one implementation: numbers stringify first.
 *
 * `format` names the currency whose minor unit the result is counted in, and
 * only affects how many fraction digits are kept — the accepted *input* charset
 * is deliberately the en-US one for every currency. A locale that writes the
 * decimal separator as a comma (de-DE "1.234,56 €") is rejected as unparseable
 * rather than silently read as 1.23456; making it parse needs locale-aware
 * grouping, which is a larger change than this one.
 */
export function parseMoneyToCents(
  value: unknown,
  format: MoneyFormat = DEFAULT_MONEY_FORMAT
): number | null {
  if (value == null || value === "") return null

  let s: string
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null
    s = toPlainDecimalString(value)
  } else {
    s = String(value)
  }
  s = s.trim()
  if (!s) return null

  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }
  s = s.replace(/[$,\s]/g, "")
  if (s.startsWith("-")) {
    negative = true
    s = s.slice(1)
  }
  if (!/^\d*\.?\d+$/.test(s)) return null

  const exponent = minorUnitExponent(format)
  const dot = s.indexOf(".")
  const wholePart = dot < 0 ? s : s.slice(0, dot)
  const fractionPart = dot < 0 ? "" : s.slice(dot + 1)
  const keptFraction = fractionPart.slice(0, exponent).padEnd(exponent, "0")
  const droppedFraction = fractionPart.slice(exponent)

  // Every term here is a whole number of minor units, and integer arithmetic in
  // a double is exact below 2^53 — so unlike `value * 100`, no fractional float
  // ever exists to be rounded wrong. The safe-integer guard below is what keeps
  // that promise true at the top of the range.
  let minorUnits =
    Number(wholePart === "" ? "0" : wholePart) * 10 ** exponent +
    Number(keptFraction === "" ? "0" : keptFraction)
  // Half away from zero, decided on the magnitude so the sign cannot change the
  // rounding: the first dropped digit being >= 5 ("5" is char code 53) means the
  // remainder is at least half a minor unit.
  if (droppedFraction !== "" && droppedFraction.charCodeAt(0) >= 53) minorUnits += 1

  // Past 2^53 the sum above rounds silently. Refuse the value rather than store
  // a total that is not the amount that was typed.
  if (!Number.isSafeInteger(minorUnits)) return null

  // Normalise -0 to 0 before applying the sign: -0 is === 0 but Object.is-
  // distinct, it serialises as "-0" in JSON, and the number branch used to
  // return it from `Math.round(-0.005 * 100)` while the string branch did not.
  if (minorUnits === 0) return 0
  return negative ? -minorUnits : minorUnits
}

export function summarize(lines: BudgetLineInput[]): FinanceSummary {
  let totalBudgetedCents = 0
  let totalActualCents = 0
  let totalProjectedCents = 0

  for (const line of lines) {
    totalBudgetedCents += line.budgetedCents
    totalActualCents += line.actualCents
    // Projected uses actual when there is one, else the forecast estimate.
    const projected =
      line.actualCents !== 0
        ? line.actualCents
        : line.forecastCents ?? 0
    totalProjectedCents += projected
  }

  const varianceCents = totalBudgetedCents - totalProjectedCents
  const remainingCents = totalBudgetedCents - totalActualCents

  return {
    totalBudgetedCents,
    totalActualCents,
    totalProjectedCents,
    varianceCents,
    remainingCents,
    projectedSavingsCents: Math.max(0, varianceCents),
    projectedOverspendCents: Math.max(0, -varianceCents),
    utilizationPct:
      totalBudgetedCents > 0
        ? Math.round((totalActualCents / totalBudgetedCents) * 100)
        : 0,
    lineCount: lines.length,
  }
}

// ── General ledger ────────────────────────────────────────────────────────────

export type LedgerKindName = "SPEND" | "REIMBURSEMENT" | "ADJUSTMENT"

export const LEDGER_KINDS: LedgerKindName[] = ["SPEND", "REIMBURSEMENT", "ADJUSTMENT"]

export const LEDGER_KIND_LABEL: Record<LedgerKindName, string> = {
  SPEND: "Spend",
  REIMBURSEMENT: "Reimbursement",
  ADJUSTMENT: "Adjustment",
}

/**
 * Signed cents effect a ledger entry has on a line's actual spend, from a raw
 * magnitude and its kind. SPEND increases actual (+), REIMBURSEMENT recovers it
 * (−), and ADJUSTMENT is taken exactly as signed (a negative input lowers the
 * actual). This is the single rule the server posts by and the drawer displays.
 */
export function ledgerSignedCents(kind: LedgerKindName, magnitudeCents: number): number {
  if (kind === "REIMBURSEMENT") return -Math.abs(magnitudeCents)
  if (kind === "SPEND") return Math.abs(magnitudeCents)
  return magnitudeCents // ADJUSTMENT: signed as entered
}

// ── Spreadsheet import ────────────────────────────────────────────────────────

export type ParsedBudgetRow = {
  category: string
  budgetedCents: number
  actualCents: number
}

export type ImportResult = {
  rows: ParsedBudgetRow[]
  /** Header text mapped to each field, for a "we read your columns as…" note */
  mapping: { category: string | null; budgeted: string | null; actual: string | null }
  skipped: number
  warnings: string[]
}

const CATEGORY_HINTS = ["category", "line item", "item", "description", "name", "expense", "type"]
const BUDGET_HINTS = ["budget", "budgeted", "planned", "allocated", "allocation", "plan"]
const ACTUAL_HINTS = ["actual", "spent", "spend", "used", "expense", "cost"]

function scoreHeader(header: string, hints: string[]): number {
  const h = header.toLowerCase().trim()
  if (!h) return 0
  for (const hint of hints) {
    if (h === hint) return 3
    if (h.includes(hint)) return 2
  }
  return 0
}

/** Pick the best-matching column index for a set of hints, avoiding reuse. */
function pickColumn(headers: string[], hints: string[], taken: Set<number>): number {
  let best = -1
  let bestScore = 0
  headers.forEach((header, i) => {
    if (taken.has(i)) return
    const score = scoreHeader(header, hints)
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  })
  if (best >= 0) taken.add(best)
  return best
}

/**
 * Turn a sheet (array-of-arrays, first row headers) into budget rows.
 * Column detection is fuzzy because every club names its columns differently.
 */
export function parseBudgetSheet(rows: unknown[][]): ImportResult {
  const warnings: string[] = []
  if (!rows || rows.length < 2) {
    return {
      rows: [],
      mapping: { category: null, budgeted: null, actual: null },
      skipped: 0,
      warnings: ["The sheet has no data rows."],
    }
  }

  const headers = (rows[0] ?? []).map((h) => String(h ?? "").trim())
  const taken = new Set<number>()
  const catIdx = pickColumn(headers, CATEGORY_HINTS, taken)
  const budgetIdx = pickColumn(headers, BUDGET_HINTS, taken)
  const actualIdx = pickColumn(headers, ACTUAL_HINTS, taken)

  if (catIdx < 0) warnings.push("Could not find a category column; used the first column.")
  if (budgetIdx < 0) warnings.push("Could not find a budget column; those values are 0.")
  if (actualIdx < 0) warnings.push("Could not find an actual/spent column; those values are 0.")

  const cat = catIdx >= 0 ? catIdx : 0
  const out: ParsedBudgetRow[] = []
  let skipped = 0

  for (const row of rows.slice(1)) {
    const category = String(row[cat] ?? "").trim()
    const budgetedCents = budgetIdx >= 0 ? parseMoneyToCents(row[budgetIdx]) ?? 0 : 0
    const actualCents = actualIdx >= 0 ? parseMoneyToCents(row[actualIdx]) ?? 0 : 0

    // Skip blank rows and total/subtotal rows, which would double-count.
    if (!category) {
      skipped++
      continue
    }
    if (/^(total|subtotal|grand total|sum)\b/i.test(category)) {
      skipped++
      continue
    }
    if (budgetedCents === 0 && actualCents === 0) {
      skipped++
      continue
    }

    out.push({ category, budgetedCents, actualCents })
  }

  // Collapse duplicate categories (spreadsheets repeat them), summing values.
  const merged = new Map<string, ParsedBudgetRow>()
  for (const r of out) {
    const key = r.category.toLowerCase()
    const existing = merged.get(key)
    if (existing) {
      existing.budgetedCents += r.budgetedCents
      existing.actualCents += r.actualCents
    } else {
      merged.set(key, { ...r })
    }
  }

  return {
    rows: [...merged.values()],
    mapping: {
      category: catIdx >= 0 ? headers[catIdx] : null,
      budgeted: budgetIdx >= 0 ? headers[budgetIdx] : null,
      actual: actualIdx >= 0 ? headers[actualIdx] : null,
    },
    skipped,
    warnings,
  }
}
