import {
  CurrencyMismatchError,
  isZero,
  subtract,
  sum,
  zero,
  type Money,
} from "./money"
import {
  netSettlement,
  settlementComponentEntries,
  type NetSettlement,
  type SettlementComponents,
} from "./settlement-components"

/**
 * PAY-080-007 — reconcile what the platform says it allocated against what the
 * journal actually holds, and against the balance the settling system reports.
 *
 * `reconcile()` in `./allocation.ts` already exists and reconciles a different
 * thing: direct + allocated + unallocated against the ingested total, which is
 * an internal consistency check on one AWS cost report. It has no notion of a
 * clearing account, a cash balance or a journal, and nothing anywhere compared a
 * platform-held figure against the postings that are supposed to justify it.
 *
 * That gap is not theoretical. `BudgetLine.actualCents` is maintained by a
 * relative `increment` in `apps/web/src/app/(app)/approvals/actions.ts`, so it
 * is a CACHE of Σ `LedgerEntry.amountCents` — and a cache that nothing ever
 * checks is a cache that is eventually wrong with no way to notice.
 *
 * ## Three rules this function keeps
 *
 * 1. **It never adjusts.** Not the allocation, not the journal, not the
 *    clearing balance. The output of an unbalanced reconciliation is a variance,
 *    named and signed. An implementation that plugs the difference into the
 *    largest account produces a report that always balances and never tells the
 *    truth.
 * 2. **`balanced` is true only at exactly zero unexplained variance.** Not "small
 *    enough", not "within a minor unit". A tolerance is where a systematic
 *    one-unit rounding error hides for a year.
 * 3. **One comparator.** It reuses `subtract`/`sum`/`CurrencyMismatchError` from
 *    `./money` and the `Money` type `./settlement-components` uses, rather than
 *    a second, independently-wrong idea of what equality means.
 */

/** One side of the reconciliation: an account and what it is said to hold. */
export interface AccountBalance {
  /** Whatever names the account — a budget line id, a GL code, a tenant id. */
  account: string
  amount: Money
}

/**
 * What the settling system says it is holding, and — when it states it — how.
 *
 * `components` is optional and its absence is meaningful: it says the settling
 * system reported a balance and nothing about its make-up. The application's own
 * budget roll-up is exactly that case, which is why `financeIntegrity` in
 * `apps/web/src/lib/finance.ts` passes a bare balance. When a payment provider
 * IS connected, its statement arrives with all eight components and
 * `reconcileToJournal` proves them against each other as part of the same pass
 * (PAY-130-003), so a provider whose own statement does not add up cannot be
 * reconciled against the journal as though it did.
 */
export interface ClearingPosition {
  balance: Money
  components?: SettlementComponents
}

export interface AccountVariance {
  account: string
  /** What the platform says the account holds. */
  allocated: Money
  /** What the journal's postings for that account add up to. */
  posted: Money
  /** allocated − posted. Signed, and never rounded. */
  variance: Money
}

export interface UnexplainedVariance {
  account: string
  variance: Money
  detail: string
}

export interface VarianceReport {
  currency: string
  accounts: readonly AccountVariance[]
  /** Every account whose variance is not exactly zero, plus the clearing leg. */
  unexplained: readonly UnexplainedVariance[]
  clearing: {
    /** Σ of the journal's postings — what the settling system ought to be holding. */
    expected: Money
    /** What it says it holds. */
    reported: Money
    /** expected − reported. */
    variance: Money
  }
  /** The provider's own statement, when one was supplied. Null otherwise. */
  settlement: NetSettlement | null
  /** True only at exactly zero unexplained variance. */
  balanced: boolean
}

export class ReconciliationInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ReconciliationInputError"
  }
}

/**
 * Reconcile allocations to a journal and to a clearing balance.
 *
 * Pure: no database, no provider call, no clock. Everything it needs is in the
 * argument, which is what makes the property — that it never quietly balances —
 * something a test can hold it to.
 */
export function reconcileToJournal(input: {
  allocations: readonly AccountBalance[]
  journalPostings: readonly AccountBalance[]
  clearing: ClearingPosition
}): VarianceReport {
  const { allocations, journalPostings, clearing } = input

  const currency = clearing.balance.currency
  for (const entry of [...allocations, ...journalPostings]) {
    if (entry.amount.currency !== currency) {
      throw new CurrencyMismatchError(currency, entry.amount.currency)
    }
  }
  if (clearing.components) {
    for (const { component, amount } of settlementComponentEntries(clearing.components)) {
      if (amount.currency !== currency) {
        throw new ReconciliationInputError(
          `The clearing balance is in ${currency} and its ${component} component is in ` +
            `${amount.currency}. Convert with a stated rate and date before reconciling — a total ` +
            `across currencies is not a total.`,
        )
      }
    }
  }

  const postedByAccount = new Map<string, Money>()
  for (const posting of journalPostings) {
    const running = postedByAccount.get(posting.account) ?? zero(currency)
    postedByAccount.set(posting.account, {
      units: running.units + posting.amount.units,
      currency,
    })
  }

  const allocatedByAccount = new Map<string, Money>()
  for (const allocation of allocations) {
    if (allocatedByAccount.has(allocation.account)) {
      throw new ReconciliationInputError(
        `Account "${allocation.account}" is allocated twice. Two allocations to one account is one ` +
          `allocation with the amounts added, and guessing which was meant would make the variance ` +
          `depend on argument order.`,
      )
    }
    allocatedByAccount.set(allocation.account, allocation.amount)
  }

  // Every account either side knows about. An account with postings and no
  // allocation is exactly the case a naive left-join misses, and it is money the
  // journal holds that the platform does not think it has.
  const accountNames = [...new Set([...allocatedByAccount.keys(), ...postedByAccount.keys()])].sort()

  const accounts: AccountVariance[] = accountNames.map((account) => {
    const allocated = allocatedByAccount.get(account) ?? zero(currency)
    const posted = postedByAccount.get(account) ?? zero(currency)
    return { account, allocated, posted, variance: subtract(allocated, posted) }
  })

  const unexplained: UnexplainedVariance[] = []
  for (const entry of accounts) {
    // Exactly zero. No tolerance, no rounding to the minor unit: a systematic
    // one-unit error is precisely what a tolerance is built to hide.
    if (isZero(entry.variance)) continue
    unexplained.push({
      account: entry.account,
      variance: entry.variance,
      detail: !allocatedByAccount.has(entry.account)
        ? `The journal holds ${entry.posted.units} against "${entry.account}", which the platform ` +
          `does not allocate to at all.`
        : !postedByAccount.has(entry.account)
          ? `The platform allocates ${entry.allocated.units} to "${entry.account}" and the journal ` +
            `has no postings for it.`
          : `"${entry.account}" is allocated ${entry.allocated.units} and posted ` +
            `${entry.posted.units}; the difference of ${entry.variance.units} is unexplained.`,
    })
  }

  const expected = sum(
    journalPostings.map((posting) => posting.amount),
    currency,
  )
  const clearingVariance = subtract(expected, clearing.balance)
  if (!isZero(clearingVariance)) {
    unexplained.push({
      account: "(clearing)",
      variance: clearingVariance,
      detail:
        `The journal's postings total ${expected.units} and the settling system reports ` +
        `${clearing.balance.units}. Nothing has been adjusted to close this.`,
    })
  }

  // When the settling system stated how its balance is made up, its own
  // statement is proved before it is used as the other side of a comparison.
  const settlement = clearing.components ? netSettlement(clearing.components) : null
  if (settlement && !settlement.settles) {
    unexplained.push({
      account: "(settlement)",
      variance: settlement.residual,
      detail: settlement.refusal!.detail,
    })
  }

  return {
    currency,
    accounts,
    unexplained,
    clearing: { expected, reported: clearing.balance, variance: clearingVariance },
    settlement,
    balanced: unexplained.length === 0,
  }
}
