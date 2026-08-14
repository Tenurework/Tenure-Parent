/**
 * What changing this tenant's configuration would do to its bill.
 *
 * The configuration page answers three questions in order — what is this tenant
 * configured to do, what does that cost, and *what would changing it cost*. The
 * first two were already on the page. The third was not, and it is the one an
 * operator actually opens the editor to find out: an edit to a LIVE tenant is a
 * change to a bill, and a form that shows a price per option but no delta makes
 * the operator do the arithmetic that decides whether they may press Publish.
 *
 * ## Why the arithmetic is here and not in the page
 *
 * Because a page cannot be mutation-tested. Every rule below — which direction
 * a change moves the bill, which options are locked, how they group — is a
 * decision, and a decision inside JSX is a decision nothing can red. The page
 * renders what this returns and adds no arithmetic of its own.
 *
 * ## Why nothing here computes money
 *
 * `runningTotal` is the engine's, from `@tenure/finops`, and it is what the
 * total on the page above is already made of. This module calls it with ONE
 * option to learn what that one option is worth at the stated seat count, and
 * subtracts through `Money` rather than through numbers. A second multiplication
 * of `perSeatMinor` by `seats` written here would be a second pricing
 * implementation, and the day the two disagreed the one on the screen would be
 * the one nobody validated.
 *
 * The same applies to *whether an option is charged today*: that is
 * `isChargeable` in `@tenure/configuration`, applied by the caller against the
 * RESOLVED value, and passed in as `chargedToday`. It is not re-derived here.
 */

import { negate, runningTotal, subtract, toDecimal, type Money, type OptionPrice } from "@tenure/finops"

/**
 * One option an operator could change, as this page knows it.
 *
 * Deliberately not `ConfigDefinition`. That type carries a Zod schema, an owner
 * and a merge strategy, none of which decide anything below — and taking it
 * would mean every test fixture here had to build a schema to exercise a sign.
 */
export interface ConfigurableOption {
  key: string
  description: string
  /** The domain the bible names, from `domainOf(key)`. Never a schema shape. */
  domainId: string
  /** That domain's one-line `governs`, so a group can say what it is. */
  domainGoverns: string
  price: OptionPrice
  /**
   * Whether this option is being charged for RIGHT NOW.
   *
   * The engine's `isChargeable(definition, effectiveValue)`, decided by the
   * caller against the resolved configuration. A boolean is charged while it is
   * on; anything else is charged while it differs from the platform default.
   */
  chargedToday: boolean
  /** `definition.requiresCapability`, or null when the key is ungated. */
  requiresCapability: string | null
  /** What the editor renders for it, which decides what "changing it" means. */
  input: "string" | "number" | "boolean" | "unsupported"
}

/** Which way a change moves the bill. A word, because a sign is not readable. */
export type BillDirection = "adds" | "removes" | "unchanged"

export interface ChangeCost {
  key: string
  description: string
  chargedToday: boolean
  /** What this option is worth per month at the stated seats, on its own. */
  monthly: Money
  /** Signed against today's bill: positive adds, negative removes. */
  delta: Money
  direction: BillDirection
  /** What "changing it" concretely means for this option, in words. */
  change: string
  /** Why it costs nothing, when it costs nothing. Null when it is charged. */
  includedBecause: string | null
  /**
   * Why this operator may not publish this key, or null.
   *
   * Present so it can be RENDERED. An option gated by a capability nobody here
   * holds is shown and disabled with this reason — hiding it is how an operator
   * spends twenty minutes looking for a setting that was never going to be
   * theirs, and then asks why the console lied.
   */
  lockedReason: string | null
  input: ConfigurableOption["input"]
}

export interface DomainChangeCosts {
  domainId: string
  governs: string
  options: readonly ChangeCost[]
  /** How many of them this operator may not publish. */
  locked: number
}

/**
 * The reason a gated option is not editable, written for the person reading it.
 *
 * It names the capability, says who holds it here, and says what the engine
 * does about it — because "you can't change this" with no mechanism behind it
 * reads as a bug in the console rather than as a control.
 */
export function lockReason(capability: string, held: readonly string[]): string {
  const holds =
    held.length === 0
      ? "this console publishes with no capabilities at all"
      : `this console holds ${[...held].sort().join(", ")}`
  return (
    `Requires the capability "${capability}" — ${holds}. ` +
    `A publication carrying this key is refused by the engine, not by this form, ` +
    `so changing it is a request to whoever holds that capability.`
  )
}

/** What changing this option means, given what it is and what it is set to. */
function changeVerb(option: ConfigurableOption): string {
  if (option.input === "unsupported") {
    return "Editing it — lists and objects have no editor here yet, so this is not a change anyone can make from this page."
  }
  if (option.input === "boolean") {
    return option.chargedToday ? "Turning it off" : "Turning it on"
  }
  return option.chargedToday
    ? "Returning it to the platform default"
    : "Choosing anything other than the platform default"
}

/**
 * What each option would do to the monthly bill if it were changed, grouped by
 * the domain that governs it.
 *
 * Grouping order is the order the options arrive in, which the caller takes
 * from the domain registry — so the groups come out in the bible's order rather
 * than alphabetically or by whichever key happened to be declared first.
 *
 * Throws only what the engine throws: a price in a currency `runningTotal`
 * refuses, or a seat count that is not a whole number. Both are defects in the
 * build rather than facts about a tenant, and the page catches them and says so
 * rather than rendering a bill that is wrong.
 */
export function changeCostsByDomain(
  options: readonly ConfigurableOption[],
  seats: number,
  heldCapabilities: readonly string[],
): readonly DomainChangeCosts[] {
  const held = new Set(heldCapabilities)
  const groups: DomainChangeCosts[] = []
  const byId = new Map<string, ChangeCost[]>()

  for (const option of options) {
    // The engine's quote for exactly this one option at exactly these seats.
    const monthly = runningTotal([{ key: option.key, price: option.price }], seats).total

    // An option worth nothing changes nothing, whichever way it is moved. That
    // is a third answer and not a rounded-down "adds 0.00", because "this is
    // included" and "this costs less than a cent" are different facts.
    const direction: BillDirection =
      monthly.units === 0 ? "unchanged" : option.chargedToday ? "removes" : "adds"

    const cost: ChangeCost = {
      key: option.key,
      description: option.description,
      chargedToday: option.chargedToday,
      monthly,
      delta:
        direction === "unchanged"
          ? { units: 0, currency: monthly.currency }
          : direction === "removes"
            ? negate(monthly)
            : monthly,
      direction,
      change: changeVerb(option),
      includedBecause: option.price.includedBecause ?? null,
      lockedReason:
        option.requiresCapability && !held.has(option.requiresCapability)
          ? lockReason(option.requiresCapability, heldCapabilities)
          : null,
      input: option.input,
    }

    let bucket = byId.get(option.domainId)
    if (!bucket) {
      bucket = []
      byId.set(option.domainId, bucket)
      groups.push({ domainId: option.domainId, governs: option.domainGoverns, options: bucket, locked: 0 })
    }
    bucket.push(cost)
  }

  return groups.map((group) => ({
    ...group,
    locked: group.options.filter((option) => option.lockedReason !== null).length,
  }))
}

export interface BillDelta {
  from: Money
  to: Money
  /** `to − from`. Positive means the change adds to the monthly bill. */
  delta: Money
  direction: BillDirection
}

/**
 * The difference between two monthly bills, or null when there is no honest
 * difference to state.
 *
 * Null rather than zero when the two are in different currencies. A cross-
 * currency subtraction is not a number, and rendering it as one — or as a
 * reassuring "no change" — would be exactly the defect the `Money` type exists
 * to prevent. The caller renders "not known" and says why.
 */
export function billDelta(from: Money, to: Money): BillDelta | null {
  if (from.currency !== to.currency) return null
  const delta = subtract(to, from)
  return {
    from,
    to,
    delta,
    direction: delta.units === 0 ? "unchanged" : delta.units > 0 ? "adds" : "removes",
  }
}

/**
 * An amount with its sign made explicit, for a column of deltas.
 *
 * `toDecimal` already writes the minus; the plus is added here so a reader
 * scanning a column can see which way a row goes without comparing it to its
 * neighbours. `half-even` because this is a display figure, the same mode the
 * running total above it is rendered with — two rounding modes on one page is
 * two answers to "what does this cost".
 *
 * The sign is never the only signal: every row that carries one also carries
 * the word `adds` or `removes`, because meaning conveyed by a glyph alone is
 * not meaning conveyed at all.
 */
export function signedAmount(value: Money): string {
  const decimal = toDecimal(value, "half-even")
  const sign = value.units > 0 ? "+" : ""
  return `${sign}${decimal} ${value.currency}`
}

export interface ChangeSpread {
  /** How many options this page can price a change for. */
  priced: number
  /** How many of them are not this operator's to change. */
  locked: number
  /** How many cost the same however they are set. */
  free: number
  /** The currency the two extremes below are in, or null when nothing moves. */
  currency: string | null
  /** The single change that would add the most to the monthly bill. */
  largestAddition: { key: string; amount: Money } | null
  /** The single change that would remove the most from it. */
  largestRemoval: { key: string; amount: Money } | null
  /**
   * Options that move the bill in some OTHER currency, and are therefore not
   * candidates for either extreme above.
   *
   * Counted rather than silently skipped. Comparing 900 JPY against 4.00 USD by
   * their minor units would name the wrong extreme and look right doing it, so
   * the comparison is confined to one currency and the remainder is declared.
   */
  inOtherCurrencies: number
}

/**
 * The one-sentence shape of the whole editor: how far the bill could move, and
 * how much of it is not this operator's to move.
 *
 * Extremes rather than a sum, deliberately. A sum of every possible change is a
 * total nobody would ever produce — it prices turning on everything at once —
 * whereas "the most expensive single change here adds X" is a bound an operator
 * can carry into a decision.
 */
export function changeSpread(groups: readonly DomainChangeCosts[]): ChangeSpread {
  const options = groups.flatMap((group) => group.options)
  const moving = options.filter((option) => option.direction !== "unchanged")
  // The currency the comparison happens in: the first one that actually moves
  // the bill. Everything else is counted and left out rather than compared.
  const currency = moving.length > 0 ? moving[0].delta.currency : null

  let largestAddition: ChangeSpread["largestAddition"] = null
  let largestRemoval: ChangeSpread["largestRemoval"] = null
  let inOtherCurrencies = 0

  for (const option of moving) {
    if (option.delta.currency !== currency) {
      inOtherCurrencies += 1
      continue
    }
    if (option.direction === "adds") {
      if (!largestAddition || option.delta.units > largestAddition.amount.units) {
        largestAddition = { key: option.key, amount: option.delta }
      }
    }
    if (option.direction === "removes") {
      if (!largestRemoval || option.delta.units < largestRemoval.amount.units) {
        largestRemoval = { key: option.key, amount: option.delta }
      }
    }
  }

  return {
    priced: options.length,
    locked: options.filter((option) => option.lockedReason !== null).length,
    free: options.filter((option) => option.direction === "unchanged").length,
    currency,
    largestAddition,
    largestRemoval,
    inOtherCurrencies,
  }
}
