/**
 * Finance calculations and spreadsheet parsing — pure, so they can be unit
 * tested and reused by both the server (import, persistence) and the client
 * (live forecasting).
 *
 * Money is integer cents everywhere, matching the Prisma models. Floating
 * point never touches a currency total.
 */

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

/** "$1,234.56" from cents. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : ""
  const abs = Math.abs(cents)
  const dollars = Math.floor(abs / 100)
  const rem = abs % 100
  const withCommas = dollars.toLocaleString("en-US")
  return `${sign}$${withCommas}.${String(rem).padStart(2, "0")}`
}

/** "$1.2k" / "$980" for compact axis labels. */
export function formatCentsCompact(cents: number): string {
  const sign = cents < 0 ? "-" : ""
  const dollars = Math.abs(cents) / 100
  if (dollars >= 1000) return `${sign}$${(dollars / 1000).toFixed(dollars >= 10000 ? 0 : 1)}k`
  return `${sign}$${Math.round(dollars)}`
}

/**
 * Parse a currency-ish value into integer cents. Accepts numbers (assumed
 * dollars) and strings with $, commas, and parenthesised negatives, which is
 * how accounting spreadsheets write them: "$1,200.50", "(300)", "-45".
 * Returns null for anything that is not a number.
 */
export function parseMoneyToCents(value: unknown): number | null {
  if (value == null || value === "") return null
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value * 100) : null
  }
  let s = String(value).trim()
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

  const cents = Math.round(parseFloat(s) * 100)
  return negative ? -cents : cents
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
