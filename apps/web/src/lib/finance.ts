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

// PAY-080-007. The reconciliation arithmetic, not a second copy of it. Pure
// TypeScript with no node builtins, so it travels into the client bundles that
// already import this module.
import { SCALE as FINOPS_SCALE, fromMinorUnits, reconcileToJournal } from "@tenure/finops"

// PAY-020-002. The provider-neutral port, through its CLIENT-SAFE subpath —
// `@tenure/payments` proper reads ADRs off disk with node:fs and hashes with
// node:crypto, and this module travels into client bundles. The port carries no
// write verb, so nothing reachable from here can move money.
import {
  describeMerchant,
  type FundsFlow,
  type ResponsibilityConfig,
} from "@tenure/payments/gateway"

export type BudgetLineInput = {
  category: string
  budgetedCents: number
  actualCents: number
  forecastCents?: number | null
  /**
   * PAY-080-004. The currency these cents are counted in.
   *
   * REQUIRED, not optional. `BudgetLine.currency` has existed in the schema
   * since the model did, and every reader ignored it — so a total was computed
   * by adding integers whose denominations nobody had checked. An optional
   * field here would compile at every existing call site and go on doing
   * exactly that, silently, which is the failure this is meant to end.
   */
  currency: string
}

/**
 * A total across currencies is not a total.
 *
 * The same refusal `@tenure/finops`' `add` makes (packages/finops/src/money.ts),
 * for the same reason: ¥1,000 + $10 is 1,010 of nothing. Throwing beats
 * returning a number nobody can act on, because a wrong total renders happily
 * and a thrown error is one somebody handles.
 */
export class MixedCurrencyError extends Error {
  readonly currencies: readonly string[]

  constructor(currencies: readonly string[]) {
    super(
      `Cannot total lines denominated in ${currencies.join(" and ")}. A total across ` +
        `currencies is not a total; convert with a stated rate and date, or report them ` +
        `separately.`,
    )
    this.name = "MixedCurrencyError"
    this.currencies = currencies
  }
}

export type FinanceSummary = {
  /** The one currency every summed line was denominated in. */
  currency: string
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

/**
 * Total a set of budget lines.
 *
 * PAY-080-004. Refuses a mixed-currency set rather than adding the integers, in
 * the same way and for the same reason `@tenure/finops`' `add` refuses one:
 * before this, a club whose lines were half in USD and half in JPY produced a
 * "total" that was neither, and the portfolio page rendered it next to a dollar
 * sign. The currencies are collected first so the refusal can NAME them —
 * "Cannot total USD and JPY" is something an operator fixes, "invalid input" is
 * not.
 *
 * An empty set has no currency to report, so it takes the platform default.
 * That is the one case where there is nothing to be wrong about: every total is
 * zero.
 */
export function summarize(lines: BudgetLineInput[]): FinanceSummary {
  let totalBudgetedCents = 0
  let totalActualCents = 0
  let totalProjectedCents = 0

  const currencies = new Set<string>()
  for (const line of lines) currencies.add(line.currency)
  if (currencies.size > 1) throw new MixedCurrencyError([...currencies].sort())
  const currency = currencies.size === 1 ? [...currencies][0] : DEFAULT_MONEY_FORMAT.currency

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
    currency,
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

/** One club, as the OSE portfolio roll-up sees it. */
export type PortfolioClubInput = {
  name: string
  slug: string
  lines: BudgetLineInput[]
}

export type PortfolioClub = {
  name: string
  slug: string
  /** Null when the club's own lines disagree about their denomination. */
  currency: string | null
  budgetedCents: number
  actualCents: number
  lineCount: number
  /**
   * True when this club could not be totalled at all. Reported rather than
   * dropped: a club missing from a portfolio because its data was awkward is a
   * club nobody investigates.
   */
  mixedCurrency: boolean
}

export type PortfolioRollUp = {
  clubs: PortfolioClub[]
  /**
   * Totals PER CURRENCY, largest first. Not one number: an institution running
   * a JPY club and a USD club has two totals and no third one, and inventing
   * the third is the failure `MixedCurrencyError` exists to prevent — arriving
   * one level up, where every individual club summed cleanly.
   */
  totals: { currency: string; budgetedCents: number; actualCents: number; clubCount: number }[]
  /** Clubs whose own lines contradict each other. */
  mixedCurrencyClubs: PortfolioClub[]
}

/**
 * PAY-080-004 — the OSE finance portfolio, totalled without adding currencies.
 *
 * The page used to `reduce((s, l) => s + l.budgetedCents, 0)` over every club's
 * lines and then over every club, so a single JPY club silently contributed its
 * yen to a figure rendered with a dollar sign. Both levels go through
 * `summarize` now: a club whose lines disagree is reported as such instead of
 * being totalled, and the institution figure is grouped by currency rather than
 * being one number that is only right when every tenant happens to use one.
 */
export function rollUpPortfolio(clubs: PortfolioClubInput[]): PortfolioRollUp {
  const rows: PortfolioClub[] = clubs.map((club) => {
    try {
      const summary = summarize(club.lines)
      return {
        name: club.name,
        slug: club.slug,
        currency: summary.currency,
        budgetedCents: summary.totalBudgetedCents,
        actualCents: summary.totalActualCents,
        lineCount: summary.lineCount,
        mixedCurrency: false,
      }
    } catch (error) {
      if (!(error instanceof MixedCurrencyError)) throw error
      return {
        name: club.name,
        slug: club.slug,
        currency: null,
        budgetedCents: 0,
        actualCents: 0,
        lineCount: club.lines.length,
        mixedCurrency: true,
      }
    }
  })

  const byCurrency = new Map<
    string,
    { currency: string; budgetedCents: number; actualCents: number; clubCount: number }
  >()
  for (const row of rows) {
    if (row.currency == null) continue
    if (row.budgetedCents === 0 && row.actualCents === 0) continue
    const bucket = byCurrency.get(row.currency) ?? {
      currency: row.currency,
      budgetedCents: 0,
      actualCents: 0,
      clubCount: 0,
    }
    bucket.budgetedCents += row.budgetedCents
    bucket.actualCents += row.actualCents
    bucket.clubCount += 1
    byCurrency.set(row.currency, bucket)
  }

  return {
    clubs: rows,
    totals: [...byCurrency.values()].sort(
      (a, b) => b.budgetedCents - a.budgetedCents || a.currency.localeCompare(b.currency),
    ),
    mixedCurrencyClubs: rows.filter((row) => row.mixedCurrency),
  }
}

// ── General ledger ────────────────────────────────────────────────────────────

export type LedgerKindName =
  | "SPEND"
  | "REIMBURSEMENT"
  | "ADJUSTMENT"
  | "REVERSAL"
  | "RECEIPT"

/**
 * The kinds somebody may post directly.
 *
 * REVERSAL is deliberately absent. A reversal is not a transaction anybody
 * types — it is derived from the entry it reverses, carries that entry's id and
 * negates its exact signed amount, and is raised only by `reverseLedgerEntry`.
 * Offering it in the "post a transaction" menu would let a hand-typed amount
 * claim to reverse something it does not.
 *
 * RECEIPT *is* present: PAY-230-004's whole point is that dues, ticket sales
 * and sponsorships are money a club actually receives and had nowhere to be
 * recorded. Every other kind is outbound.
 */
export const LEDGER_KINDS: LedgerKindName[] = [
  "SPEND",
  "REIMBURSEMENT",
  "ADJUSTMENT",
  "RECEIPT",
]

export const LEDGER_KIND_LABEL: Record<LedgerKindName, string> = {
  SPEND: "Spend",
  REIMBURSEMENT: "Reimbursement",
  ADJUSTMENT: "Adjustment",
  REVERSAL: "Reversal",
  RECEIPT: "Receipt",
}

/**
 * Signed cents effect a ledger entry has on a line's actual spend.
 *
 * SPEND increases actual (+), REIMBURSEMENT recovers it (−), and ADJUSTMENT is
 * taken exactly as signed (a negative input lowers the actual). This is the
 * single rule the server posts by and the drawer displays.
 *
 * REVERSAL is the one arm whose second argument is NOT a magnitude: it is the
 * *signed* amount of the entry being reversed, and the result is its exact
 * negation. That is what makes a reversal sum to zero against its original
 * whatever kind the original was — taking `Math.abs` here would turn the
 * reversal of a −$50 recovery into another −$50, and the line's actual would
 * drift by twice the amount instead of returning to where it started.
 *
 * RECEIPT is inbound money — dues, a ticket batch, a sponsorship — so it takes
 * the OPPOSITE sign to SPEND: it reduces net outflow against the line. This
 * switch is the one place the sign is decided, which is deliberate: a missing
 * arm here would be a silent zero at every call site, so a new kind has to be
 * answered here or it has no effect anywhere.
 */
export function ledgerSignedCents(kind: LedgerKindName, amountCents: number): number {
  if (kind === "REIMBURSEMENT") return -Math.abs(amountCents)
  if (kind === "SPEND") return Math.abs(amountCents)
  if (kind === "RECEIPT") return -Math.abs(amountCents)
  // `|| 0` normalises -0: JSON.stringify writes it as "-0", and an amount of
  // minus nothing is not a thing a ledger should be able to hold.
  if (kind === "REVERSAL") return -amountCents || 0
  return amountCents // ADJUSTMENT: signed as entered
}

/**
 * PAY-020-002 / PAY-040-007 — who the payer is told they paid, from the port.
 *
 * Bible §6 requires the legal merchant and the statement descriptor to be
 * rendered in every payment preview and receipt, and Bible §2 lists the copy
 * that may not be used to do it: "Tenure bank account", "Tenure holds your
 * funds". Both are the same requirement from opposite sides — the sentence has
 * to come from the resolved responsibility matrix, not from whichever component
 * happens to be rendering.
 *
 * So this delegates to `@tenure/payments/gateway`. The subpath, not the package
 * root: this module is imported by client components, and the root reaches
 * node:fs through the capability registry. The port has no write verb, so
 * nothing reachable from a drawer can move money.
 *
 * `blockers` is returned rather than swallowed. A club whose responsibility
 * matrix is unanswered — which is every club today, because nothing is
 * certified — gets an honest "not decided" instead of a confident wrong name.
 */
export type LedgerDisclosure = {
  merchantOfRecord: string | null
  statementDescriptor: string
  sentence: string
  blockers: readonly string[]
}

export function ledgerDisclosure(input: {
  legalName: string
  statementDescriptor: string
  fundsFlow: FundsFlow
  responsibility: ResponsibilityConfig
}): LedgerDisclosure {
  const described = describeMerchant(input)
  return {
    merchantOfRecord: described.merchantOfRecord,
    statementDescriptor: described.statementDescriptor,
    sentence: described.disclosure,
    blockers: described.blockers,
  }
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

// ── Ledger integrity ──────────────────────────────────────────────────────────

/**
 * PAY-080-007 — is a line's `actualCents` still what its ledger says?
 *
 * `BudgetLine.actualCents` is documented in the schema as "the cache of
 * Σ amountCents", and it is maintained by a relative `increment` in
 * `apps/web/src/app/(app)/approvals/actions.ts`. A relative update is only ever
 * as correct as every write that came before it: one interrupted transaction, one
 * entry deleted without the compensating decrement, one migration that moved rows
 * — and the cache is wrong with nothing anywhere to notice. Until this, no code
 * in the repository compared the two.
 *
 * The arithmetic is `reconcileToJournal` from `@tenure/finops`, not a second
 * comparator written here. That matters more than it looks: the rule that a
 * reconciliation is balanced ONLY at exactly zero unexplained variance is the
 * property a local `if (Math.abs(diff) < 1)` would quietly relax, and there is
 * one implementation of it in this repository.
 *
 * Pure — the page does the reading. `finance.ts` is imported by client
 * components, so it must not touch Prisma; `@tenure/finops` is dependency-free
 * TypeScript and travels into a browser bundle without issue.
 */
export type IntegrityLineInput = {
  id: string
  category: string
  /** The cached actual, in minor units of `currency`. */
  actualCents: number
}

export type IntegrityPostingInput = {
  budgetLineId: string
  /** Signed effect on actual spend, in minor units of `currency`. */
  amountCents: number
}

export type FinanceIntegrityLine = {
  lineId: string
  category: string
  /** What `BudgetLine.actualCents` says. */
  actualCents: number
  /** Σ of that line's `LedgerEntry.amountCents`. */
  postedCents: number
  /** actual − posted. Zero, or the cache has drifted. */
  varianceCents: number
}

export type FinanceIntegrity = {
  currency: string
  reconciles: boolean
  lines: FinanceIntegrityLine[]
  /** Only the lines that disagree, with the sentence to show. */
  drifted: { lineId: string; category: string; varianceCents: number; detail: string }[]
  /** Σ actualCents across the lines — the figure the dashboard totals. */
  rollUpCents: number
  /** Σ postedCents across the ledger. */
  journalCents: number
  detail: string
}

export function financeIntegrity(
  lines: readonly IntegrityLineInput[],
  postings: readonly IntegrityPostingInput[],
  currency: string = DEFAULT_MONEY_FORMAT.currency,
): FinanceIntegrity {
  const categoryOf = new Map(lines.map((line) => [line.id, line.category]))
  const rollUpCents = lines.reduce((running, line) => running + line.actualCents, 0)

  const report = reconcileToJournal({
    allocations: lines.map((line) => ({
      account: line.id,
      amount: fromMinorUnits(line.actualCents, currency),
    })),
    journalPostings: postings.map((posting) => ({
      account: posting.budgetLineId,
      amount: fromMinorUnits(posting.amountCents, currency),
    })),
    // The roll-up the finance dashboard displays, standing in for the balance a
    // settling system would report. It has no component breakdown — the budget
    // states a total and nothing about gross, fees or FX — so `components` is
    // deliberately absent rather than filled with zeros, which would assert that
    // every one of them really is zero.
    clearing: { balance: fromMinorUnits(rollUpCents, currency) },
  })

  const toCents = (units: number) => Math.trunc(units / 10 ** FINOPS_SCALE)

  const integrityLines = report.accounts.map((account) => ({
    lineId: account.account,
    category: categoryOf.get(account.account) ?? "(no budget line)",
    actualCents: toCents(account.allocated.units),
    postedCents: toCents(account.posted.units),
    varianceCents: toCents(account.variance.units),
  }))

  const drifted = report.unexplained
    .filter((entry) => entry.account !== "(clearing)" && entry.account !== "(settlement)")
    .map((entry) => ({
      lineId: entry.account,
      category: categoryOf.get(entry.account) ?? "(no budget line)",
      varianceCents: toCents(entry.variance.units),
      detail: entry.detail,
    }))

  const journalCents = toCents(report.clearing.expected.units)

  return {
    currency,
    reconciles: report.balanced,
    lines: integrityLines,
    drifted,
    rollUpCents,
    journalCents,
    detail: report.balanced
      ? `Every line's actual equals the sum of its ledger entries: ${formatCentsIn(rollUpCents, { locale: DEFAULT_MONEY_FORMAT.locale, currency })} across ${integrityLines.length} line(s).`
      : `${drifted.length} line(s) disagree with the ledger. The budget rolls up to ` +
        `${formatCentsIn(rollUpCents, { locale: DEFAULT_MONEY_FORMAT.locale, currency })} and the ledger posts ` +
        `${formatCentsIn(journalCents, { locale: DEFAULT_MONEY_FORMAT.locale, currency })}. Shown, not corrected — ` +
        `a cache silently rewritten to match hides whichever write went missing.`,
  }
}
