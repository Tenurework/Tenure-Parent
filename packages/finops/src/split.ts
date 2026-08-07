import {
  CurrencyMismatchError,
  allocateByWeight,
  compare,
  money,
  negate,
  sum,
  type Money,
  type RoundingMode,
} from "./money"

/**
 * PAY-070-004 — multi-recipient split rules, with a reversal that is exact.
 *
 * `allocateByWeight` is a correct largest-remainder splitter and was the only
 * thing in this package close to a split rule. What it does not have is a
 * recipient: it returns an array whose meaning is positional, so nothing records
 * who received which share, and nothing can therefore reverse a split.
 *
 * ## Why a reversal must not be re-derived
 *
 * This is the whole reason the module exists. A largest-remainder split hands
 * the leftover units to whoever was rounded furthest from their exact share. Run
 * the same rule on the reversal and the leftover units land somewhere else,
 * because the rounding mode's behaviour is not symmetric under negation for
 * every mode — `half-up` rounds toward `+Infinity`, so an exact half goes up on
 * the way out and down on the way back.
 *
 * The total still nets to zero, which is exactly what makes the bug survive:
 * every total-level assertion passes while two recipients are left permanently
 * one unit out of pocket, in opposite directions. So a split is recorded, and
 * `reverseSplit` REPLAYS the recorded per-recipient amounts. It never re-runs
 * the allocator.
 *
 * ## Who calls this
 *
 * `allocate()` in `./allocation.ts` — every shared AWS cost a driver covers is
 * split here, and the recording travels out on `AllocationResult.splits` to the
 * Studio's FinOps Center, which renders each recipient's share beside what a
 * reversal would return them.
 */

/** One recipient's claim on an amount. */
export interface SplitRule {
  /** Whoever receives the share — a tenant id, an organization id, an account. */
  recipientId: string
  /**
   * Relative share. Any non-negative finite number: a headcount, bytes
   * processed, an agreed percentage. A weight rather than a percentage so a
   * caller never has to make a set of them add to 100 and then explain the
   * rounding of the remainder.
   */
  weight: number
}

export interface SplitPart {
  recipientId: string
  amount: Money
}

/**
 * A split as it happened, kept so it can be reversed exactly.
 *
 * `rules` and `rounding` are carried alongside `parts` because they are what
 * justifies the split to whoever disputes it — but `reverseSplit` deliberately
 * reads `parts` and not them.
 */
export interface RecordedSplit {
  /** Names the split, so a reversal can be tied to what it reverses. */
  splitId: string
  amount: Money
  rounding: RoundingMode
  rules: readonly SplitRule[]
  parts: readonly SplitPart[]
}

export class SplitReversalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SplitReversalError"
  }
}

/**
 * Split an amount across named recipients so the parts add back to exactly the
 * whole.
 *
 * Built on `allocateByWeight`, so exact-sum is inherited rather than
 * re-implemented — there is one largest-remainder algorithm in this package and
 * this is not a second one.
 */
export function splitAmount(
  amount: Money,
  rules: readonly SplitRule[],
  rounding: RoundingMode,
  splitId: string,
): RecordedSplit {
  if (rules.length === 0) {
    throw new RangeError(
      "A split needs at least one recipient. Splitting across nobody records an amount as " +
        "distributed and leaves it nowhere.",
    )
  }
  const seen = new Set<string>()
  for (const rule of rules) {
    if (!rule.recipientId.trim()) {
      throw new RangeError("A split rule names no recipient.")
    }
    if (seen.has(rule.recipientId)) {
      throw new RangeError(
        `Recipient "${rule.recipientId}" appears twice in one split. Two claims on one amount by ` +
          `the same recipient is one claim with the weights added, and guessing which was meant ` +
          `is not this function's decision.`,
      )
    }
    seen.add(rule.recipientId)
  }

  const parts = allocateByWeight(
    amount,
    rules.map((rule) => rule.weight),
    rounding,
  ).map((share, index) => ({ recipientId: rules[index].recipientId, amount: share }))

  return { splitId, amount, rounding, rules, parts }
}

/**
 * Reverse a recorded split, by replaying what each recipient actually received.
 *
 * `amount` is the amount being reversed and it must equal what was split. It is
 * taken as an argument rather than read off the record so that a caller
 * reversing the wrong thing is refused rather than quietly reversing the right
 * thing: a partial reversal is a different operation with a different answer,
 * and it cannot be a replay.
 *
 * Every part is negated and nothing is recomputed. That is the invariant:
 * split-then-reverse nets to zero FOR EVERY RECIPIENT, not merely in total.
 */
export function reverseSplit(previous: RecordedSplit, amount: Money): SplitPart[] {
  if (previous.amount.currency !== amount.currency) {
    throw new CurrencyMismatchError(previous.amount.currency, amount.currency)
  }
  if (compare(previous.amount, amount) !== 0) {
    throw new SplitReversalError(
      `Split "${previous.splitId}" distributed ${previous.amount.units} ${previous.amount.currency} ` +
        `minor-scale units and this reversal is for ${amount.units}. A partial reversal is not a ` +
        `replay of a split — re-deriving it would move the leftover units between recipients — so ` +
        `state the partial amounts per recipient instead.`,
    )
  }

  return previous.parts.map((part) => ({
    recipientId: part.recipientId,
    amount: negate(part.amount),
  }))
}

/**
 * What a split and its reversal leave each recipient holding.
 *
 * Zero for every recipient, or the function is wrong. Returned rather than
 * asserted so the Studio can show it: an operator disputing a shared-cost share
 * needs to see that reversing it returns exactly what it took, per tenant.
 */
export function netAfterReversal(previous: RecordedSplit, reversal: readonly SplitPart[]): SplitPart[] {
  const byRecipient = new Map(reversal.map((part) => [part.recipientId, part.amount]))
  return previous.parts.map((part) => {
    const back = byRecipient.get(part.recipientId)
    if (!back) {
      throw new SplitReversalError(
        `The reversal of split "${previous.splitId}" says nothing about recipient ` +
          `"${part.recipientId}", who received ${part.amount.units}.`,
      )
    }
    return {
      recipientId: part.recipientId,
      amount: money(part.amount.units + back.units, part.amount.currency),
    }
  })
}

/** Σ of a split's parts. Equal to the amount split, by construction. */
export function splitTotal(split: RecordedSplit): Money {
  return sum(
    split.parts.map((part) => part.amount),
    split.amount.currency,
  )
}
