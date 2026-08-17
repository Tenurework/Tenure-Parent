import {
  CurrencyMismatchError,
  add,
  compare,
  isZero,
  money,
  negate,
  subtract,
  sum,
  zero,
  type Money,
} from "./money"

/**
 * FIN-010-003 — record-to-report arithmetic: trial balance, account analysis,
 * flux/variance, financial statements and item-level account reconciliation,
 * over posted journal lines.
 *
 * Nothing in this repository computed any of it. `docs/architecture/fin-finance-surface-inventory.md`
 * §C records `Balance`, `Reconciliation` and `Adjustment` as ABSENT, and grep
 * for "trial balance" across `apps`, `packages`, `modules` and `blueprints`
 * returns nothing outside CSS transforms. What existed was one comparison —
 * `financeIntegrity` in `apps/web/src/lib/finance.ts`, which asks whether
 * `BudgetLine.actualCents` equals the sum of that line's postings. That is a
 * cache check, not a ledger: it never looks at `LedgerEntry.account`, never adds
 * a debit to a credit, and cannot answer "do the books tie".
 *
 * ## Why the sign is kept and the side is declared
 *
 * `LedgerEntry` in `apps/web/prisma/schema.prisma` carries BOTH a `side`
 * (`LedgerSide`) and a SIGNED `amountCents` ("SPEND +, REIMBURSEMENT/RECEIPT
 * −"). Two representations of one fact, and collapsing them is how a ledger
 * stops tying: `Math.abs` on a −$50 recovery turns a credit into a debit of the
 * same magnitude and the trial balance ties while the books are wrong by $100.
 *
 * So a line here states its column (`side`) and its amount stays exactly as
 * signed. Column totals sum signed amounts, which is what makes a contra amount
 * — a negative debit, which real ledgers post — behave: it reduces the debit
 * column rather than silently becoming a credit. The tie test is
 * `Σdebits − Σcredits === 0`, and when it is not zero the residual is REPORTED.
 * Nothing here ever plugs a difference; an out-of-balance ledger that has been
 * adjusted until it balances is the one state from which the error can never be
 * found.
 *
 * ## Why dates are compared as strings, and which strings are refused
 *
 * Every bound and every line date is an ISO instant in UTC (`…Z`) or a bare
 * `YYYY-MM-DD`. Both compare correctly with `<`/`>` as text, which makes every
 * window in this module exact, allocation-free and identical on every machine —
 * whereas `new Date(s).getTime()` on a date-only string is midnight UTC, on a
 * `YYYY-MM-DD HH:mm` string is midnight LOCAL in some engines, and a report that
 * moves its period boundary with the reader's timezone is a report two people
 * cannot reconcile.
 *
 * A string carrying a numeric offset (`2026-03-31T23:00:00+05:30`) is therefore
 * REFUSED rather than parsed: it sorts as text into the wrong place, and the
 * wrongness is invisible — it only shows up as a handful of entries landing in
 * the wrong period at each month end. The caller converts to UTC first, which is
 * a decision it can make correctly and this module cannot.
 *
 * ## What this deliberately does not do
 *
 * It does not persist anything, and it does not know what a period is. Period
 * OPEN/CLOSED state is a table this schema does not have (`Period` is ABSENT in
 * §C of the inventory, `FIN-000-002` is BLOCKED_EXTERNAL on it), so nothing here
 * can refuse a posting for period state — it can only report, from the dates on
 * the rows, which entries arrived after the month they belong to
 * (`lateAdjustments`). That distinction is the honest half of `FIN-010-004`, and
 * its ledger row says so.
 */

export type PostingSide = "DEBIT" | "CREDIT"

export class GeneralLedgerInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "GeneralLedgerInputError"
  }
}

/**
 * One side of one posted journal, as read back out of the books.
 *
 * `lineId` is required and must be unique across the input. A duplicated row is
 * the most common way a balance goes wrong by exactly a factor — two `findMany`
 * results concatenated, a join fanning out — and it is undetectable downstream:
 * the doubled trial balance still ties.
 *
 * `recordedAt` is required too, and is not `effectiveAt`. Without both, "the
 * books as they stood on 31 March, as known on 5 April" is a question with no
 * answer, and every restatement becomes unreproducible.
 */
export interface PostedLine {
  journalId: string
  lineId: string
  /** Chart-of-accounts code this side hits. */
  account: string
  side: PostingSide
  /** Signed. The sign is never absorbed; see the module note. */
  amount: Money
  /** When it takes effect in the books. `YYYY-MM-DD` or a UTC instant. */
  effectiveAt: string
  /** When the row was written. `YYYY-MM-DD` or a UTC instant. */
  recordedAt: string
  /**
   * The external item this line answers — a bank statement line, a supplier
   * invoice number, a receipt id. Optional because most manual postings have
   * none, and `reconcileAccountBalance` reports the unreferenced rather than
   * pretending they matched nothing.
   */
  reference?: string
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?Z$/

/**
 * Reject anything that would compare wrongly as text.
 *
 * `where` names the field so the message points at the row rather than at this
 * function — the caller is usually mapping hundreds of database rows and needs
 * to know which one.
 */
function checkInstant(value: string, where: string): string {
  if (typeof value !== "string" || (!DATE_ONLY.test(value) && !UTC_INSTANT.test(value))) {
    throw new GeneralLedgerInputError(
      `${where} is ${JSON.stringify(value)}. Every date here must be \`YYYY-MM-DD\` or a UTC ` +
        `instant ending in Z, because these are compared as text: an offset like +05:30 sorts into ` +
        `the wrong period and nothing downstream can tell. Convert to UTC first — that is a ` +
        `decision the caller can make correctly and this module cannot.`,
    )
  }
  return value
}

/** A date-only lower bound means the whole of that day. */
function lowerBound(value: string): string {
  return DATE_ONLY.test(value) ? `${value}T00:00:00.000Z` : value
}

/**
 * A date-only upper bound means the whole of that day, inclusive.
 *
 * Without this, `through: "2026-03-31"` excludes an entry effective
 * `2026-03-31T14:00:00Z` — "as at 31 March" silently means "as at the first
 * instant of 31 March", and a month-end trial balance drops that day's postings.
 */
function upperBound(value: string): string {
  return DATE_ONLY.test(value) ? `${value}T23:59:59.999Z` : value
}

/** The accounting month a date falls in, as `YYYY-MM`. Sliced, never parsed. */
export function periodOf(instant: string): string {
  return checkInstant(instant, "period date").slice(0, 7)
}

export interface TrialBalanceAccount {
  account: string
  /** Σ of signed amounts posted to the debit column. */
  debits: Money
  /** Σ of signed amounts posted to the credit column. */
  credits: Money
  /** debits − credits. Positive is a debit balance. */
  net: Money
  lineCount: number
}

export interface UnbalancedJournal {
  journalId: string
  currency: string
  debits: Money
  credits: Money
  /** debits − credits, as it stands. Never plugged. */
  outOfBalance: Money
}

export interface TrialBalanceSection {
  currency: string
  accounts: readonly TrialBalanceAccount[]
  debits: Money
  credits: Money
  /** debits − credits. Zero, or the books do not tie. */
  outOfBalance: Money
  balanced: boolean
  refusal: { code: "TRIAL_BALANCE_DOES_NOT_TIE"; detail: string } | null
  /** Journals that do not tie on their own, inside this currency. */
  unbalancedJournals: readonly UnbalancedJournal[]
}

export interface TrialBalance {
  /** One per currency present. A total across currencies is not a total. */
  sections: readonly TrialBalanceSection[]
  /**
   * `null` when no line fell inside the window — "we looked and found nothing"
   * is not "balanced". A boolean here would report an empty period as a clean
   * one, which is the single most reassuring wrong answer this module could
   * give.
   */
  balanced: boolean | null
  window: { from: string | null; through: string | null; knownAt: string | null }
  considered: number
  included: number
  excluded: { beforeWindow: number; afterWindow: number; notYetRecorded: number }
  detail: string
}

export interface TrialBalanceOptions {
  /** Inclusive effective-date lower bound. */
  from?: string
  /** Inclusive effective-date upper bound. */
  through?: string
  /**
   * Only lines recorded at or before this instant — the "as known at" half of
   * an as-of report. A restatement is reproducible only if this is stated.
   */
  knownAt?: string
}

function requireUniqueLineIds(lines: readonly PostedLine[]): void {
  const seen = new Set<string>()
  const duplicated: string[] = []
  for (const line of lines) {
    if (!line.lineId) {
      throw new GeneralLedgerInputError(
        `A posted line in journal ${JSON.stringify(line.journalId)} has no lineId. Without one a ` +
          `duplicate cannot be detected, and a doubled row makes a trial balance that still ties.`,
      )
    }
    if (seen.has(line.lineId)) duplicated.push(line.lineId)
    seen.add(line.lineId)
  }
  if (duplicated.length > 0) {
    throw new GeneralLedgerInputError(
      `These posted lines appear more than once: ${duplicated.join(", ")}. Refused rather than ` +
        `summed: a doubled posting doubles a balance and the trial balance still ties, so nothing ` +
        `downstream would notice.`,
    )
  }
}

function sideTotals(lines: readonly PostedLine[], currency: string): { debits: Money; credits: Money } {
  return {
    debits: sum(
      lines.filter((l) => l.side === "DEBIT").map((l) => l.amount),
      currency,
    ),
    credits: sum(
      lines.filter((l) => l.side === "CREDIT").map((l) => l.amount),
      currency,
    ),
  }
}

function checkSide(line: PostedLine): void {
  if (line.side !== "DEBIT" && line.side !== "CREDIT") {
    throw new GeneralLedgerInputError(
      `Line ${JSON.stringify(line.lineId)} declares side ${JSON.stringify(line.side)}. A line whose ` +
        `column is unknown cannot be totalled into either one, and defaulting it to DEBIT is how a ` +
        `credit becomes a debit of the same magnitude.`,
    )
  }
}

/**
 * The trial balance: every account's debits, credits and net, per currency,
 * with the tie-out stated rather than assumed.
 *
 * `unbalancedJournals` is measured here as well as globally, because the two
 * failures are different incidents. A global out-of-balance means postings were
 * lost; a global zero with two journals out by equal and opposite amounts means
 * two postings were mis-coded and cancelled each other — which no total will
 * ever show. `buildJournal` in `packages/payments/src/posting.ts` refuses to
 * EMIT an unbalanced journal; this reads posted history back and checks it
 * happened, which is a different claim about a different moment.
 */
export function trialBalance(
  lines: readonly PostedLine[],
  options: TrialBalanceOptions = {},
): TrialBalance {
  requireUniqueLineIds(lines)

  const from = options.from ? lowerBound(checkInstant(options.from, "options.from")) : null
  const through = options.through ? upperBound(checkInstant(options.through, "options.through")) : null
  const knownAt = options.knownAt ? upperBound(checkInstant(options.knownAt, "options.knownAt")) : null

  let beforeWindow = 0
  let afterWindow = 0
  let notYetRecorded = 0
  const included: PostedLine[] = []

  for (const line of lines) {
    checkSide(line)
    const effective = checkInstant(line.effectiveAt, `line ${line.lineId} effectiveAt`)
    const recorded = checkInstant(line.recordedAt, `line ${line.lineId} recordedAt`)
    if (knownAt !== null && recorded > knownAt) {
      notYetRecorded++
      continue
    }
    if (from !== null && effective < from) {
      beforeWindow++
      continue
    }
    if (through !== null && effective > through) {
      afterWindow++
      continue
    }
    included.push(line)
  }

  const currencies = [...new Set(included.map((l) => l.amount.currency))].sort()
  const sections: TrialBalanceSection[] = currencies.map((currency) => {
    const inCurrency = included.filter((l) => l.amount.currency === currency)
    const accounts = [...new Set(inCurrency.map((l) => l.account))].sort().map((account) => {
      const forAccount = inCurrency.filter((l) => l.account === account)
      const { debits, credits } = sideTotals(forAccount, currency)
      return {
        account,
        debits,
        credits,
        net: subtract(debits, credits),
        lineCount: forAccount.length,
      }
    })
    const { debits, credits } = sideTotals(inCurrency, currency)
    const outOfBalance = subtract(debits, credits)
    const balanced = isZero(outOfBalance)

    const unbalancedJournals: UnbalancedJournal[] = []
    for (const journalId of [...new Set(inCurrency.map((l) => l.journalId))].sort()) {
      const forJournal = inCurrency.filter((l) => l.journalId === journalId)
      const totals = sideTotals(forJournal, currency)
      const journalResidual = subtract(totals.debits, totals.credits)
      if (!isZero(journalResidual)) {
        unbalancedJournals.push({
          journalId,
          currency,
          debits: totals.debits,
          credits: totals.credits,
          outOfBalance: journalResidual,
        })
      }
    }

    return {
      currency,
      accounts,
      debits,
      credits,
      outOfBalance,
      balanced,
      unbalancedJournals,
      refusal: balanced
        ? null
        : {
            code: "TRIAL_BALANCE_DOES_NOT_TIE" as const,
            detail:
              `${currency}: debits ${debits.units} against credits ${credits.units} leaves ` +
              `${outOfBalance.units} minor-scale units unexplained across ${accounts.length} ` +
              `account(s). Reported as it stands — a ledger adjusted until it ties is one whose ` +
              `error can never be found.`,
          },
    }
  })

  const balanced = sections.length === 0 ? null : sections.every((s) => s.balanced)

  return {
    sections,
    balanced,
    window: { from: from ?? null, through: through ?? null, knownAt: knownAt ?? null },
    considered: lines.length,
    included: included.length,
    excluded: { beforeWindow, afterWindow, notYetRecorded },
    detail:
      balanced === null
        ? `No posted line fell inside the window (${lines.length} considered: ${beforeWindow} before, ` +
          `${afterWindow} after, ${notYetRecorded} not yet recorded). That is "nothing to report", ` +
          `not "the books tie".`
        : balanced
          ? `${included.length} posted line(s) across ${sections.length} currency(ies) tie: ` +
            sections.map((s) => `${s.currency} ${s.debits.units} Dr = ${s.credits.units} Cr`).join("; ") +
            "."
          : sections
              .filter((s) => !s.balanced)
              .map((s) => s.refusal!.detail)
              .join(" "),
  }
}

export interface AccountAnalysisEntry {
  lineId: string
  journalId: string
  effectiveAt: string
  recordedAt: string
  side: PostingSide
  amount: Money
  /** Net after this entry, in posting order. */
  runningNet: Money
  reference: string | null
}

export interface AccountAnalysisSection {
  currency: string
  entries: readonly AccountAnalysisEntry[]
  closingNet: Money
}

export interface AccountAnalysis {
  account: string
  sections: readonly AccountAnalysisSection[]
  /** True when the account has no line in the window at all. */
  empty: boolean
}

/**
 * Every movement on one account, in posting order, with the running net.
 *
 * This is the drill-through step §3.3 requires ("every balance drills to
 * journal…"): each entry carries its own `journalId` and `lineId`, so a figure
 * in a statement leads to the rows that made it rather than to a re-query the
 * reader has to trust.
 *
 * Ordering is `effectiveAt`, then `recordedAt`, then `lineId` — three keys
 * because two are not enough to be deterministic. Same-day postings are
 * commonplace, and a running balance whose intermediate values depend on
 * `readdirSync`-style incidental order is a column two readers will disagree
 * about while both reports are "correct".
 */
export function accountAnalysis(
  lines: readonly PostedLine[],
  account: string,
  options: TrialBalanceOptions = {},
): AccountAnalysis {
  const balance = trialBalance(lines, options)
  const window = balance.window
  const inWindow = lines.filter((l) => {
    if (l.account !== account) return false
    if (window.knownAt !== null && l.recordedAt > window.knownAt) return false
    if (window.from !== null && l.effectiveAt < window.from) return false
    if (window.through !== null && l.effectiveAt > window.through) return false
    return true
  })

  const currencies = [...new Set(inWindow.map((l) => l.amount.currency))].sort()
  const sections = currencies.map((currency) => {
    const ordered = inWindow
      .filter((l) => l.amount.currency === currency)
      .slice()
      .sort(
        (a, b) =>
          (a.effectiveAt < b.effectiveAt ? -1 : a.effectiveAt > b.effectiveAt ? 1 : 0) ||
          (a.recordedAt < b.recordedAt ? -1 : a.recordedAt > b.recordedAt ? 1 : 0) ||
          (a.lineId < b.lineId ? -1 : a.lineId > b.lineId ? 1 : 0),
      )
    let running = zero(currency)
    const entries = ordered.map((line) => {
      running = line.side === "DEBIT" ? add(running, line.amount) : subtract(running, line.amount)
      return {
        lineId: line.lineId,
        journalId: line.journalId,
        effectiveAt: line.effectiveAt,
        recordedAt: line.recordedAt,
        side: line.side,
        amount: line.amount,
        runningNet: running,
        reference: line.reference ?? null,
      }
    })
    return { currency, entries, closingNet: running }
  })

  return { account, sections, empty: sections.length === 0 }
}

/**
 * Why a flux percentage could not be computed, when it could not.
 *
 * Five states, because one boolean would hide four different facts. The rule
 * this repository is built on is that "we looked and found nothing" and "we
 * could not look" are different answers: an account that moved from 0 to 40,000
 * has not risen by 0%, and an account that did not exist last period has not
 * been flat.
 */
export type FluxBasis =
  | "MEASURED"
  | "NO_PRIOR_PERIOD"
  | "NEW_ACCOUNT"
  | "CLOSED_ACCOUNT"
  | "PRIOR_IS_ZERO"

export interface FluxRow {
  account: string
  current: Money | null
  prior: Money | null
  /** current − prior, treating an absent side as zero. Always computable. */
  change: Money
  /**
   * Signed percentage as a decimal string with two places, or `null` when it
   * cannot be computed. Never 0 as a stand-in for "unknown".
   */
  changePercent: string | null
  basis: FluxBasis
  /** True when the row crosses a threshold the caller stated. */
  material: boolean
  detail: string
}

export interface FluxReport {
  currency: string
  rows: readonly FluxRow[]
  materialRows: readonly FluxRow[]
  /** Accounts whose percentage could not be computed, with the reason. */
  unexplainable: readonly { account: string; basis: FluxBasis }[]
  detail: string
}

export interface FluxThresholds {
  /** Absolute percentage, as a decimal string. e.g. "10" for ten percent. */
  percent?: string
  /** Absolute amount, in the section's currency. */
  amount?: Money
}

const ZERO_BIG = BigInt(0)
const HUNDRED = BigInt(100)

/**
 * Signed percentage of `part` against `whole`, as an exact integer count of
 * hundredths of a percent.
 *
 * An integer, not a float, and not a string that later gets `Number()`d. A
 * threshold comparison done in doubles is how "10%" stops catching a movement of
 * exactly 10% — `Number("10.00") >= Number("10")` happens to hold, and
 * `0.1 + 0.2 >= 0.3` does not, and which of those shapes a future edit produces
 * is not something this module should be relying on.
 */
function percentHundredths(part: number, whole: number): number {
  return Number((BigInt(part) * HUNDRED * HUNDRED) / BigInt(whole))
}

/** Hundredths of a percent, as the two-place decimal string a report shows. */
function formatHundredths(value: number): string {
  const negative = value < 0
  const magnitude = negative ? -value : value
  return `${negative ? "-" : ""}${Math.trunc(magnitude / 100)}.${String(magnitude % 100).padStart(2, "0")}`
}

/**
 * A stated percentage threshold as hundredths, exactly.
 *
 * Digits beyond two places are truncated rather than rounded, and that is the
 * conservative direction: a threshold of "10.009" becomes 10.00, which catches
 * one more row than it was asked to rather than one fewer. A materiality check
 * that silently lets a movement through is the failure worth avoiding.
 */
function thresholdHundredths(decimal: string): number {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(decimal.trim())
  if (!m) {
    throw new GeneralLedgerInputError(
      `Flux threshold ${JSON.stringify(decimal)} is not a decimal percentage. Write "10" or "7.5"; ` +
        `a threshold nobody can parse is a review that quietly checks nothing.`,
    )
  }
  const [, sign, whole, frac = ""] = m
  const value = Number(whole) * 100 + Number(`${frac}00`.slice(0, 2))
  return sign === "-" ? -value : value
}

function absCompare(amount: Money, limit: Money): number {
  const magnitude = amount.units < 0 ? money(-amount.units, amount.currency) : amount
  const bound = limit.units < 0 ? money(-limit.units, limit.currency) : limit
  return compare(magnitude, bound)
}

/**
 * Period-on-period variance, account by account, with the reason attached when
 * a percentage does not exist.
 *
 * `prior` is `null`-able on purpose: a first period is a real state, and the
 * honest report for it says "no prior period" against every account rather than
 * showing a 100% rise on each one.
 */
export function flux(
  current: TrialBalanceSection,
  prior: TrialBalanceSection | null,
  thresholds: FluxThresholds = {},
): FluxReport {
  if (prior !== null && prior.currency !== current.currency) {
    throw new CurrencyMismatchError(current.currency, prior.currency)
  }
  const currency = current.currency
  const currentBy = new Map(current.accounts.map((a) => [a.account, a.net]))
  const priorBy = new Map((prior?.accounts ?? []).map((a) => [a.account, a.net]))
  const accounts = [...new Set([...currentBy.keys(), ...priorBy.keys()])].sort()

  const rows: FluxRow[] = accounts.map((account) => {
    const now = currentBy.get(account) ?? null
    const was = priorBy.get(account) ?? null
    const change = subtract(now ?? zero(currency), was ?? zero(currency))

    let basis: FluxBasis
    if (prior === null) basis = "NO_PRIOR_PERIOD"
    else if (was === null) basis = "NEW_ACCOUNT"
    else if (now === null) basis = "CLOSED_ACCOUNT"
    else if (was.units === 0) basis = "PRIOR_IS_ZERO"
    else basis = "MEASURED"

    const moved = basis === "MEASURED" ? percentHundredths(change.units, was!.units) : null
    const changePercent = moved === null ? null : formatHundredths(moved)

    const overPercent =
      moved !== null &&
      thresholds.percent !== undefined &&
      Math.abs(moved) >= Math.abs(thresholdHundredths(thresholds.percent))
    const overAmount = thresholds.amount !== undefined && absCompare(change, thresholds.amount) >= 0
    // An unexplainable row is material by default when a threshold was asked
    // for at all. A new account with a large balance is exactly what a flux
    // review is looking for, and it has no percentage to exceed — filtering by
    // percentage alone would hide every one of them.
    const noPercentButMoved =
      changePercent === null &&
      (thresholds.percent !== undefined || thresholds.amount !== undefined) &&
      change.units !== 0

    const material = overPercent || overAmount || noPercentButMoved

    return {
      account,
      current: now,
      prior: was,
      change,
      changePercent,
      basis,
      material,
      detail:
        basis === "MEASURED"
          ? `${account}: ${was!.units} → ${now!.units} (${changePercent}%).`
          : basis === "NO_PRIOR_PERIOD"
            ? `${account}: ${now!.units} this period. No prior period was supplied, so no movement ` +
              `can be computed — not 0%.`
            : basis === "NEW_ACCOUNT"
              ? `${account}: ${now!.units} this period, absent from the prior. A new account has no ` +
                `percentage change.`
              : basis === "CLOSED_ACCOUNT"
                ? `${account}: ${was!.units} last period, no movement this one. Reported rather than ` +
                  `dropped — an account that stops appearing is a finding.`
                : `${account}: 0 → ${now!.units}. A percentage against a zero base does not exist; ` +
                  `the amount does.`,
    }
  })

  const materialRows = rows.filter((r) => r.material)
  const unexplainable = rows
    .filter((r) => r.changePercent === null)
    .map((r) => ({ account: r.account, basis: r.basis }))

  return {
    currency,
    rows,
    materialRows,
    unexplainable,
    detail:
      `${rows.length} account(s) compared in ${currency}; ${materialRows.length} material; ` +
      `${unexplainable.length} with no computable percentage ` +
      `(${[...new Set(unexplainable.map((u) => u.basis))].sort().join(", ") || "none"}).`,
  }
}

export type StatementGroup = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE"

export interface AccountClassification {
  account: string
  group: StatementGroup
  /** Which column this account normally sits in. Decides the presented sign. */
  normalBalance: PostingSide
  /** The statement line it rolls into, e.g. "Cash and equivalents". */
  line: string
}

export interface StatementLine {
  line: string
  group: StatementGroup
  /** Presented in the account's normal direction, so a liability reads positive. */
  amount: Money
  accounts: readonly string[]
}

export interface FinancialStatements {
  currency: string
  balanceSheet: {
    assets: Money
    liabilities: Money
    equity: Money
    lines: readonly StatementLine[]
  }
  incomeStatement: {
    revenue: Money
    expenses: Money
    netIncome: Money
    lines: readonly StatementLine[]
  }
  /** assets − (liabilities + equity + netIncome). Zero, or the statements do not tie. */
  residual: Money
  ties: boolean
  /** Accounts with a balance and no classification. Never silently dropped. */
  unclassified: readonly string[]
  refusal:
    | { code: "ACCOUNTS_NOT_CLASSIFIED"; detail: string }
    | { code: "STATEMENTS_DO_NOT_TIE"; detail: string }
    | null
  detail: string
}

/**
 * Balance sheet and income statement from a trial-balance section and a stated
 * chart-of-accounts classification.
 *
 * The classification is an ARGUMENT, not a table in here. §12 and §3.1 of the
 * Bible put the chart of accounts and its segment hierarchies in the tenant's
 * configuration, and §24 forbids hard-coding accounting rules; a module that
 * shipped its own map of account codes to statement lines would be asserting one
 * chart for every tenant in the platform.
 *
 * An unclassified account with a balance is a REFUSAL, not a footnote. The
 * alternative — dropping it — produces a balance sheet that balances and is
 * wrong, which is strictly worse than one that says it cannot be produced.
 */
export function financialStatements(
  section: TrialBalanceSection,
  classification: readonly AccountClassification[],
): FinancialStatements {
  const currency = section.currency
  const byAccount = new Map(classification.map((c) => [c.account, c]))
  const unclassified = section.accounts
    .filter((a) => !byAccount.has(a.account))
    .map((a) => a.account)
    .sort()

  const presented = (net: Money, normalBalance: PostingSide) =>
    normalBalance === "DEBIT" ? net : negate(net)

  // Keyed by group and line, with the line NAME carried in the value rather than
  // recovered from the key. A composite key split apart again returns "Cash" for
  // "Cash and equivalents" — a statement line silently renamed by its own first
  // word.
  const lineFor = new Map<
    string,
    { group: StatementGroup; line: string; amount: Money; accounts: string[] }
  >()
  for (const balance of section.accounts) {
    const c = byAccount.get(balance.account)
    if (!c) continue
    const amount = presented(balance.net, c.normalBalance)
    const key = `${c.group} :: ${c.line}`
    const existing = lineFor.get(key)
    if (existing) {
      existing.amount = add(existing.amount, amount)
      existing.accounts.push(balance.account)
    } else {
      lineFor.set(key, { group: c.group, line: c.line, amount, accounts: [balance.account] })
    }
  }

  const lines: StatementLine[] = [...lineFor.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, value]) => ({
      line: value.line,
      group: value.group,
      amount: value.amount,
      accounts: value.accounts.slice().sort(),
    }))

  const totalOf = (group: StatementGroup) =>
    sum(
      lines.filter((l) => l.group === group).map((l) => l.amount),
      currency,
    )

  const assets = totalOf("ASSET")
  const liabilities = totalOf("LIABILITY")
  const equity = totalOf("EQUITY")
  const revenue = totalOf("REVENUE")
  const expenses = totalOf("EXPENSE")
  const netIncome = subtract(revenue, expenses)

  // Assets = liabilities + equity + the period's result. Equity here is the
  // OPENING position as posted; the period's own surplus has not been closed
  // into it yet, which is why it appears as a term rather than being assumed
  // inside `equity`. Closing it early is how a balance sheet ties in a period
  // and is out by the result in the next one.
  const residual = subtract(assets, add(add(liabilities, equity), netIncome))
  const ties = isZero(residual) && unclassified.length === 0

  const refusal =
    unclassified.length > 0
      ? {
          code: "ACCOUNTS_NOT_CLASSIFIED" as const,
          detail:
            `${unclassified.length} account(s) carry a balance and no classification: ` +
            `${unclassified.join(", ")}. No statement is produced from them. Dropping them would ` +
            `produce a balance sheet that balances and is wrong.`,
        }
      : !isZero(residual)
        ? {
            code: "STATEMENTS_DO_NOT_TIE" as const,
            detail:
              `Assets ${assets.units} against liabilities ${liabilities.units} plus equity ` +
              `${equity.units} plus net income ${netIncome.units} leaves ${residual.units} ` +
              `minor-scale units unexplained. Reported, not plugged.`,
          }
        : null

  return {
    currency,
    balanceSheet: {
      assets,
      liabilities,
      equity,
      lines: lines.filter((l) => l.group === "ASSET" || l.group === "LIABILITY" || l.group === "EQUITY"),
    },
    incomeStatement: {
      revenue,
      expenses,
      netIncome,
      lines: lines.filter((l) => l.group === "REVENUE" || l.group === "EXPENSE"),
    },
    residual,
    ties,
    unclassified,
    refusal,
    detail:
      refusal !== null
        ? refusal.detail
        : `Assets ${assets.units} = liabilities ${liabilities.units} + equity ${equity.units} + net ` +
          `income ${netIncome.units} in ${currency}, across ${lines.length} statement line(s).`,
  }
}

export interface SupportingItem {
  /** The external identifier both sides carry. */
  reference: string
  amount: Money
  description?: string
}

export interface ReconciliationItem {
  reference: string
  ledger: Money
  supporting: Money
  difference: Money
}

export interface AccountReconciliation {
  account: string
  currency: string
  /** Net of the ledger lines for this account, in the window given. */
  ledgerBalance: Money
  /** Σ of the supporting detail. */
  supportingBalance: Money
  /** ledger − supporting. Zero, or the account does not reconcile. */
  variance: Money
  reconciles: boolean
  matched: readonly ReconciliationItem[]
  /** Present on both sides, different amounts. */
  amountMismatches: readonly ReconciliationItem[]
  /** In the ledger, not in the supporting detail. */
  unmatchedInLedger: readonly { reference: string; amount: Money }[]
  /** In the supporting detail, not in the ledger. */
  unmatchedInSupporting: readonly SupportingItem[]
  /**
   * Ledger lines carrying no reference at all. They cannot be matched item by
   * item; saying so is not the same as saying they matched nothing.
   */
  unreferenced: readonly { lineId: string; amount: Money }[]
  refusal: { code: "ACCOUNT_DOES_NOT_RECONCILE"; detail: string } | null
  detail: string
}

/**
 * Reconcile one account to its supporting detail, ITEM BY ITEM.
 *
 * Not a second `reconcileToJournal` (`./settlement`). That function compares two
 * AGGREGATES per account — what was allocated against what was posted — and its
 * answer to a mismatch is a variance figure. It cannot say which item is
 * missing, because by the time it runs the items have been summed. A month-end
 * account reconciliation is exactly the job of naming the item: an accrual that
 * was released twice and a receipt that never arrived produce the same
 * aggregate variance and are different problems.
 *
 * So this matches on `reference`, reports four disjoint buckets and one honest
 * fifth — the ledger rows that carry no reference and therefore could not be
 * matched at all. A reconciliation that quietly treats those as "unmatched in
 * supporting" invents a discrepancy; one that ignores them hides a real one.
 */
export function reconcileAccountBalance(input: {
  account: string
  lines: readonly PostedLine[]
  supporting: readonly SupportingItem[]
  currency?: string
  window?: TrialBalanceOptions
}): AccountReconciliation {
  const analysis = accountAnalysis(input.lines, input.account, input.window ?? {})
  const currency =
    input.currency ?? analysis.sections[0]?.currency ?? input.supporting[0]?.amount.currency
  if (currency === undefined) {
    throw new GeneralLedgerInputError(
      `Nothing to reconcile for account ${JSON.stringify(input.account)}: no ledger line and no ` +
        `supporting item, so there is no currency to state a balance in. An empty reconciliation ` +
        `reported as "reconciles" would be a clean answer to a question nobody asked.`,
    )
  }
  const section = analysis.sections.find((s) => s.currency === currency)
  const entries = section?.entries ?? []
  const ledgerBalance = section?.closingNet ?? zero(currency)

  for (const item of input.supporting) {
    if (item.amount.currency !== currency) {
      throw new CurrencyMismatchError(currency, item.amount.currency)
    }
  }

  // Signed by side, so the item-level figures add to the same balance the
  // running net reaches. A credit stated as a positive number in a "difference"
  // column is the classic reconciliation that reconciles in the wrong direction.
  const signed = (entry: (typeof entries)[number]) =>
    entry.side === "DEBIT" ? entry.amount : negate(entry.amount)

  const referenced = entries.filter((e) => e.reference !== null)
  const unreferenced = entries
    .filter((e) => e.reference === null)
    .map((e) => ({ lineId: e.lineId, amount: signed(e) }))

  const ledgerByReference = new Map<string, Money>()
  for (const entry of referenced) {
    const reference = entry.reference!
    const running = ledgerByReference.get(reference)
    ledgerByReference.set(reference, running ? add(running, signed(entry)) : signed(entry))
  }
  const supportingByReference = new Map<string, Money>()
  for (const item of input.supporting) {
    const running = supportingByReference.get(item.reference)
    supportingByReference.set(item.reference, running ? add(running, item.amount) : item.amount)
  }

  const matched: ReconciliationItem[] = []
  const amountMismatches: ReconciliationItem[] = []
  for (const reference of [...ledgerByReference.keys()].sort()) {
    const ledger = ledgerByReference.get(reference)!
    const supporting = supportingByReference.get(reference)
    if (supporting === undefined) continue
    const difference = subtract(ledger, supporting)
    const row = { reference, ledger, supporting, difference }
    if (isZero(difference)) matched.push(row)
    else amountMismatches.push(row)
  }

  const unmatchedInLedger = [...ledgerByReference.keys()]
    .filter((reference) => !supportingByReference.has(reference))
    .sort()
    .map((reference) => ({ reference, amount: ledgerByReference.get(reference)! }))

  const unmatchedInSupporting = input.supporting
    .filter((item) => !ledgerByReference.has(item.reference))
    .slice()
    .sort((a, b) => (a.reference < b.reference ? -1 : a.reference > b.reference ? 1 : 0))

  const supportingBalance = sum(
    input.supporting.map((i) => i.amount),
    currency,
  )
  const variance = subtract(ledgerBalance, supportingBalance)
  const reconciles = isZero(variance) && amountMismatches.length === 0 && unmatchedInLedger.length === 0 && unmatchedInSupporting.length === 0

  return {
    account: input.account,
    currency,
    ledgerBalance,
    supportingBalance,
    variance,
    reconciles,
    matched,
    amountMismatches,
    unmatchedInLedger,
    unmatchedInSupporting,
    unreferenced,
    refusal: reconciles
      ? null
      : {
          code: "ACCOUNT_DOES_NOT_RECONCILE" as const,
          detail:
            `${input.account}: ledger ${ledgerBalance.units} against supporting detail ` +
            `${supportingBalance.units} in ${currency} — variance ${variance.units}. ` +
            `${matched.length} item(s) matched, ${amountMismatches.length} differ in amount, ` +
            `${unmatchedInLedger.length} only in the ledger, ${unmatchedInSupporting.length} only ` +
            `in the detail, ${unreferenced.length} ledger line(s) carry no reference and could not ` +
            `be matched at all.`,
        },
    detail:
      reconciles
        ? `${input.account} reconciles: ${matched.length} item(s), ${ledgerBalance.units} ${currency}` +
          (unreferenced.length > 0
            ? ` — with ${unreferenced.length} unreferenced ledger line(s) that no item-level match could see.`
            : ".")
        : `${input.account} does not reconcile; variance ${variance.units} ${currency}.`,
  }
}

export interface LateAdjustment {
  lineId: string
  journalId: string
  account: string
  effectiveAt: string
  recordedAt: string
  /** The accounting month the entry belongs to. */
  effectivePeriod: string
  /** The accounting month it was actually written in. */
  recordedPeriod: string
  amount: Money
  side: PostingSide
}

/**
 * Postings written into a month later than the one they belong to.
 *
 * The visible half of §15's "late posting" control, and the only half this
 * schema can support: with no `Period` table there is no OPEN/CLOSED state to
 * refuse against, so a late entry cannot be BLOCKED — but it can be found, from
 * the two dates already on every row. Reporting it is what makes the gap
 * measurable rather than assumed; `FIN-010-004`'s ledger row states which half
 * this is.
 *
 * Compared as month strings, not durations. "Late" in accounting means "after
 * the period it belongs to closed", which is a calendar fact; an entry recorded
 * on 1 April for 31 March is one day and one period late, and an entry recorded
 * on 30 March for 1 March is 29 days and no periods late. A day count would rank
 * those the wrong way round.
 */
export function lateAdjustments(lines: readonly PostedLine[]): readonly LateAdjustment[] {
  return lines
    .filter((line) => periodOf(line.recordedAt) > periodOf(line.effectiveAt))
    .map((line) => ({
      lineId: line.lineId,
      journalId: line.journalId,
      account: line.account,
      effectiveAt: line.effectiveAt,
      recordedAt: line.recordedAt,
      effectivePeriod: periodOf(line.effectiveAt),
      recordedPeriod: periodOf(line.recordedAt),
      amount: line.amount,
      side: line.side,
    }))
    .sort(
      (a, b) =>
        (a.recordedPeriod < b.recordedPeriod ? -1 : a.recordedPeriod > b.recordedPeriod ? 1 : 0) ||
        (a.lineId < b.lineId ? -1 : a.lineId > b.lineId ? 1 : 0),
    )
}
