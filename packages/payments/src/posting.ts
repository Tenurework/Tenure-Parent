/**
 * PAY-130-002 — posting templates, balanced entries, effective dating.
 *
 * The ledger this replaces is single-sided. `LedgerEntry` carried one
 * `amountCents`, one `budgetLineId` and a `kind`, and the entire posting rule
 * was a signum function: `ledgerSignedCents(kind, magnitude)`. That is a
 * spend register, not a ledger. It cannot say which account was credited when
 * a club spends, so it cannot answer what the club owes the member who paid,
 * and nothing anywhere asserted that debits equal credits — because there were
 * no credits.
 *
 * Three properties, and each exists because its absence is a specific way to be
 * quietly wrong:
 *
 *   * **Templates.** The accounts a transaction hits are data, versioned by
 *     effective date, not a branch in a server action. Bible §13: "Posting
 *     templates are versioned by legal entity, ledger/book, transaction type,
 *     provider flow, currency, tax and effective date."
 *   * **Balance.** `buildJournal` refuses to produce an unbalanced journal.
 *     An unbalanced journal is not a bad row; it is a ledger that no longer
 *     reconciles to anything, and it is discovered at close, months later.
 *   * **Effective dating that REFUSES.** `postingFor` throws when no revision
 *     is effective at the instant asked about. Falling back to the newest is
 *     the tempting behaviour and it is how a July transaction gets posted under
 *     an August revision — silently, and correctly-looking.
 *
 * Integer minor units throughout. Floating point never touches a total (Bible
 * §5: "never binary floating point").
 */

export type PostingSide = "debit" | "credit"

/** A named amount the caller supplies. Resolved against `amounts` at build. */
export type AmountRef = string

export interface PostingLine {
  /** Chart-of-accounts code. Stable; the journal is keyed on it. */
  account: string
  side: PostingSide
  from: AmountRef
  /**
   * True when this line carries the budget-line dimension.
   *
   * Exactly one side of a club expense does. The expense hits a budget line;
   * the payable to the member who fronted the cash does not — it is an
   * organization-level liability, and dimensioning it by budget line would
   * double the line's actual and make `Σ amountCents` zero.
   */
  budgetDimensioned: boolean
}

export interface PostingTemplate {
  /** Stable across revisions. Revisions differ by effective window. */
  id: string
  /** ISO instant this revision starts applying, inclusive. */
  effectiveFrom: string
  /** ISO instant it stops, exclusive. Null for open-ended. */
  effectiveTo: string | null
  /** ISO 4217. One journal, one currency (Bible §5). */
  currency: string
  lines: readonly PostingLine[]
  description: string
}

export class PostingError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "PostingError"
    this.code = code
  }
}

/** The expense account a club's budget line rolls up to. */
export const PROGRAM_EXPENSE_ACCOUNT = "6000-program-expense"
/** What the club owes a member who paid out of pocket. */
export const REIMBURSEMENT_PAYABLE_ACCOUNT = "2100-reimbursement-payable"
/** Recoverable tax, split out from gross by the current revision. */
export const RECOVERABLE_TAX_ACCOUNT = "1400-recoverable-tax"
/** Where a recovery lands. */
export const CASH_CLEARING_ACCOUNT = "1000-cash-clearing"

export const REIMBURSEMENT_TEMPLATE = "reimbursement.member-expense"
export const MANUAL_SPEND_TEMPLATE = "ledger.manual-spend"
export const MANUAL_RECOVERY_TEMPLATE = "ledger.manual-recovery"

/**
 * Every posting template, including superseded revisions.
 *
 * The two revisions of `reimbursement.member-expense` are why superseded ones
 * stay: a transaction that occurred in March must post under the rules that
 * were in force in March, and deleting the March revision would silently
 * re-post it under July's. The July revision splits recoverable tax out of
 * gross, which is a different set of accounts for the same event.
 */
export const POSTING_TEMPLATES: readonly PostingTemplate[] = [
  {
    id: REIMBURSEMENT_TEMPLATE,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: "2026-07-01T00:00:00.000Z",
    currency: "USD",
    description:
      "Member reimbursement, pre-fiscal-2027. Gross expense against the budget line, payable to the member.",
    lines: [
      { account: PROGRAM_EXPENSE_ACCOUNT, side: "debit", from: "gross", budgetDimensioned: true },
      {
        account: REIMBURSEMENT_PAYABLE_ACCOUNT,
        side: "credit",
        from: "gross",
        budgetDimensioned: false,
      },
    ],
  },
  {
    id: REIMBURSEMENT_TEMPLATE,
    // The fiscal year opens in July — `platform.localization.fiscalYearStartMonth`
    // defaults to 7 for exactly this reason.
    effectiveFrom: "2026-07-01T00:00:00.000Z",
    effectiveTo: null,
    currency: "USD",
    description:
      "Member reimbursement, fiscal 2027 onward. Recoverable tax is split out of gross, so the budget line carries net.",
    lines: [
      { account: PROGRAM_EXPENSE_ACCOUNT, side: "debit", from: "net", budgetDimensioned: true },
      { account: RECOVERABLE_TAX_ACCOUNT, side: "debit", from: "tax", budgetDimensioned: false },
      {
        account: REIMBURSEMENT_PAYABLE_ACCOUNT,
        side: "credit",
        from: "gross",
        budgetDimensioned: false,
      },
    ],
  },
  {
    id: MANUAL_SPEND_TEMPLATE,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: null,
    currency: "USD",
    description: "A spend posted by hand against a budget line.",
    lines: [
      { account: PROGRAM_EXPENSE_ACCOUNT, side: "debit", from: "gross", budgetDimensioned: true },
      {
        account: REIMBURSEMENT_PAYABLE_ACCOUNT,
        side: "credit",
        from: "gross",
        budgetDimensioned: false,
      },
    ],
  },
  {
    id: MANUAL_RECOVERY_TEMPLATE,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: null,
    currency: "USD",
    description: "Money the club recovered, reducing the line's actual.",
    lines: [
      { account: CASH_CLEARING_ACCOUNT, side: "debit", from: "gross", budgetDimensioned: false },
      { account: PROGRAM_EXPENSE_ACCOUNT, side: "credit", from: "gross", budgetDimensioned: true },
    ],
  },
]

/**
 * The revision of `templateId` in force at `at`.
 *
 * Refuses when none is. The alternative — return the newest and hope — posts a
 * March transaction under July's accounts and produces a journal that balances,
 * reconciles and is wrong, which is the worst of the available failures because
 * nothing downstream can detect it.
 */
export function postingFor(templateId: string, at: string): PostingTemplate {
  const when = Date.parse(at)
  if (Number.isNaN(when)) {
    throw new PostingError("posting-bad-as-of", `"${at}" is not a date.`)
  }

  const revisions = POSTING_TEMPLATES.filter((t) => t.id === templateId)
  if (revisions.length === 0) {
    throw new PostingError(
      "posting-template-unknown",
      `No posting template "${templateId}". A journal cannot be built from a template that does not exist.`,
    )
  }

  const effective = revisions.filter(
    (t) =>
      when >= Date.parse(t.effectiveFrom) &&
      (t.effectiveTo === null || when < Date.parse(t.effectiveTo)),
  )

  if (effective.length === 0) {
    const windows = revisions
      .map((t) => `${t.effectiveFrom} → ${t.effectiveTo ?? "open"}`)
      .join("; ")
    throw new PostingError(
      "posting-template-not-effective",
      `No revision of "${templateId}" is effective at ${at}. Known windows: ${windows}. ` +
        `Refusing rather than using the newest: posting an out-of-window transaction under a ` +
        `later revision produces a journal that balances and is wrong.`,
    )
  }

  if (effective.length > 1) {
    throw new PostingError(
      "posting-template-ambiguous",
      `${effective.length} revisions of "${templateId}" are effective at ${at}. Overlapping ` +
        `windows mean two answers to one question.`,
    )
  }

  return effective[0]
}

export interface JournalEntry {
  account: string
  side: PostingSide
  /** Always positive. The side carries the direction. */
  amountMinorUnits: number
  budgetDimensioned: boolean
  /** Debit-positive signed value, for the budget-line actual projection. */
  signedMinorUnits: number
}

export interface Journal {
  journalId: string
  templateId: string
  effectiveAt: string
  currency: string
  entries: readonly JournalEntry[]
  totalDebitMinorUnits: number
  totalCreditMinorUnits: number
}

export interface JournalOptions {
  journalId: string
  effectiveAt: string
}

/**
 * Build a journal from a template and a set of named amounts.
 *
 * Refuses, rather than repairing, on every one of:
 *
 *   * an amount the template names and the caller did not supply — the missing
 *     one would otherwise be posted as zero and the journal would balance;
 *   * an amount the caller supplied and no line posts — money handed to the
 *     ledger that lands nowhere;
 *   * a negative or non-integer amount — a negative debit is a credit wearing
 *     the wrong sign, and a fractional minor unit is floating point that got in;
 *   * debits not equal to credits.
 */
export function buildJournal(
  template: PostingTemplate,
  amounts: Readonly<Record<AmountRef, number>>,
  options: JournalOptions,
): Journal {
  if (Number.isNaN(Date.parse(options.effectiveAt))) {
    throw new PostingError("posting-bad-effective-at", `"${options.effectiveAt}" is not a date.`)
  }
  if (!options.journalId) {
    throw new PostingError(
      "posting-no-journal-id",
      "A journal with no id cannot have its halves found again.",
    )
  }

  const needed = new Set(template.lines.map((l) => l.from))
  for (const ref of needed) {
    if (!(ref in amounts)) {
      throw new PostingError(
        "posting-amount-missing",
        `Template "${template.id}" posts "${ref}" and no such amount was supplied. Treating it ` +
          `as zero would balance and would be a different transaction.`,
      )
    }
  }
  for (const ref of Object.keys(amounts)) {
    if (!needed.has(ref)) {
      throw new PostingError(
        "posting-amount-unposted",
        `Amount "${ref}" was supplied and template "${template.id}" posts it nowhere.`,
      )
    }
  }

  const entries: JournalEntry[] = []
  let totalDebit = 0
  let totalCredit = 0

  for (const line of template.lines) {
    const value = amounts[line.from]
    if (!Number.isInteger(value)) {
      throw new PostingError(
        "posting-amount-not-integer",
        `Amount "${line.from}" is ${value}. Money is integer minor units; a fraction here is ` +
          `floating point that reached the ledger.`,
      )
    }
    if (value < 0) {
      throw new PostingError(
        "posting-amount-negative",
        `Amount "${line.from}" is ${value}. A negative debit is a credit with the wrong sign; ` +
          `use the side, not the sign.`,
      )
    }
    if (line.side === "debit") totalDebit += value
    else totalCredit += value
    entries.push({
      account: line.account,
      side: line.side,
      amountMinorUnits: value,
      budgetDimensioned: line.budgetDimensioned,
      signedMinorUnits: line.side === "debit" ? value : -value,
    })
  }

  if (totalDebit !== totalCredit) {
    throw new PostingError(
      "posting-unbalanced",
      `Journal ${options.journalId} from "${template.id}" debits ${totalDebit} and credits ` +
        `${totalCredit} ${template.currency}. A ledger that does not balance reconciles to ` +
        `nothing, and the difference is found at close rather than here.`,
    )
  }

  return {
    journalId: options.journalId,
    templateId: template.id,
    effectiveAt: options.effectiveAt,
    currency: template.currency,
    entries,
    totalDebitMinorUnits: totalDebit,
    totalCreditMinorUnits: totalCredit,
  }
}
