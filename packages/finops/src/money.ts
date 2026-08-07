/**
 * Money, in integer minor units.
 *
 * STUDIO-120-009 requires cost "with freshness and currency", and the FinOps
 * Center's whole job is that its arithmetic reconciles. Floating point does not
 * reconcile: `0.1 + 0.2 !== 0.3`, and a fleet page that sums a few thousand CUR
 * line items in dollars-as-floats will disagree with the bill by a few cents in
 * a way nobody can explain and everybody stops trusting.
 *
 * So every amount here is an integer count of the currency's smallest unit, and
 * a currency code travels with it. There is no bare `number` in this package's
 * public surface for a reason: an untagged amount is one that eventually gets
 * added to an amount in another currency.
 *
 * AWS reports unblended cost to more decimal places than a cent — a Lambda
 * invocation line can be $0.0000004. Truncating at ingest would silently zero
 * millions of small line items, so `SCALE` keeps six extra digits and rounding
 * to display units happens once, at the edge.
 *
 * ## The minor unit is not a hundredth (PAY-030-002)
 *
 * This module used to hardcode two minor digits for every currency. That is a
 * hundredfold error on JPY, which has no minor unit at all — `fromDecimal
 * ("1200", "JPY")` counted 120,000 minor units for an amount whose true count
 * is 1,200 — and it silently truncated a legal digit off KWD, which has three.
 * `packages/platform-config/src/money.ts` had already asked `Intl` for the real
 * exponent, so the two money modules in this repository disagreed about what a
 * minor unit is. `minorDigits` below is the answer both now give.
 *
 * ## Rounding is a decision, not a default
 *
 * `Math.round` is half-toward-`+Infinity`: `Math.round(0.5)` is 1 and
 * `Math.round(-0.5)` is -0. A debit and the credit that exactly reverses it
 * therefore rounded to different magnitudes, which is the single most reliable
 * way to make a reconciled ledger stop reconciling. Every function here that has
 * to drop precision takes a `RoundingMode` and the caller states which one; a
 * default would just be `Math.round` wearing a name.
 */

/** Extra digits kept below the minor unit, so sub-cent line items survive. */
export const SCALE = 6

export interface Money {
  /** Integer, in 10^-SCALE minor units. Cents × 10^6 for USD. */
  readonly units: number
  readonly currency: string
}

/**
 * How precision is dropped when an exact value does not land on a unit.
 *
 * Four, because these are the four that mean different things and each is
 * genuinely wanted somewhere:
 *
 *   `half-up`               ties go toward +Infinity. What `Math.round` does,
 *                           named so a caller choosing it has chosen it.
 *   `half-even`             ties go to the even unit — banker's rounding. The
 *                           only mode whose bias over many roundings is zero,
 *                           which is why display totals use it.
 *   `half-away-from-zero`   ties go away from zero. Symmetric under negation,
 *                           so a reversal has the magnitude of what it reverses.
 *   `down`                  truncate toward zero. Never invents a unit, which
 *                           is what an ingest of an already-authoritative
 *                           figure wants.
 */
export type RoundingMode = "half-up" | "half-even" | "half-away-from-zero" | "down"

export const ROUNDING_MODES: readonly RoundingMode[] = [
  "half-up",
  "half-even",
  "half-away-from-zero",
  "down",
]

/**
 * ISO 4217 currencies whose minor unit is not a hundredth.
 *
 * Listed rather than asked of `Intl`, because this package is dependency-free
 * and must behave identically in a Node test, a server component and a browser
 * bundle — and `Intl`'s currency data varies with the ICU build. The two groups
 * that matter are the zero-digit currencies (a JPY amount has no fraction at
 * all) and the three-digit Gulf and North African dinars.
 */
const ZERO_DIGIT_CURRENCIES = [
  "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW",
  "PYG", "RWF", "UGX", "UYI", "VND", "VUV", "XAF", "XOF", "XPF",
] as const

const THREE_DIGIT_CURRENCIES = ["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"] as const

const FOUR_DIGIT_CURRENCIES = ["CLF", "UYW"] as const

const MINOR_DIGITS: ReadonlyMap<string, number> = new Map([
  ...ZERO_DIGIT_CURRENCIES.map((code) => [code, 0] as const),
  ...THREE_DIGIT_CURRENCIES.map((code) => [code, 3] as const),
  ...FOUR_DIGIT_CURRENCIES.map((code) => [code, 4] as const),
])

/**
 * How many digits the currency's minor unit has.
 *
 * Two unless the table says otherwise, which is right for the ~150 currencies
 * that are not in it. An unknown code also gets two — a code this table has
 * never heard of is far more likely to be a hundredth than anything else, and
 * refusing it would make the whole package unusable for a currency AWS started
 * billing in yesterday.
 */
export function minorDigits(currency: string): number {
  return MINOR_DIGITS.get(currency.toUpperCase()) ?? 2
}

export class CurrencyMismatchError extends Error {
  constructor(
    readonly left: string,
    readonly right: string,
  ) {
    super(
      `Cannot combine ${left} with ${right}. A total across currencies is not a total; ` +
        `convert with a stated rate and date, or report them separately.`,
    )
    this.name = "CurrencyMismatchError"
  }
}

export function money(units: number, currency: string): Money {
  if (!Number.isInteger(units)) {
    throw new TypeError(`Money must be integer minor units, got ${units}. Use fromDecimal.`)
  }
  return { units, currency }
}

export function zero(currency: string): Money {
  return { units: 0, currency }
}

/**
 * An amount stated in whole minor units — cents, yen, fils.
 *
 * The bridge between this package's internal scale and every external figure
 * that counts minor units directly: a Stripe balance, a `LedgerEntry.
 * amountCents`, a price in `modules/index.ts`. Multiplying by `10 ** SCALE` is
 * exact for any integer below ~9e9 minor units, which is $90m — past that the
 * guard in `money` fires rather than a total silently losing its low digits.
 */
export function fromMinorUnits(minor: number, currency: string): Money {
  if (!Number.isInteger(minor)) {
    throw new TypeError(`${minor} is not a whole number of minor units of ${currency}.`)
  }
  return money(minor * 10 ** SCALE, currency)
}

/**
 * Parse a decimal string as AWS reports it.
 *
 * Takes a string rather than a number deliberately. `Number("0.0000004")` is
 * exact enough, but `0.1 + 0.2` is not, and accepting a `number` invites a
 * caller to do arithmetic before it gets here — which is the bug this module
 * exists to make impossible.
 */
export function fromDecimal(decimal: string, currency: string): Money {
  const trimmed = decimal.trim()
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new TypeError(`"${decimal}" is not a decimal amount.`)
  }

  const negative = trimmed.startsWith("-")
  const [whole, fraction = ""] = trimmed.replace("-", "").split(".")
  // The currency's own exponent, not two. `fromDecimal("1200", "JPY")` counts
  // 1,200 minor units; before this it counted 120,000.
  const digits = minorDigits(currency) + SCALE
  // Truncate rather than round: a CUR line is already the authoritative figure
  // to more places than we keep, and rounding each of a million lines up would
  // invent money.
  const padded = (fraction + "0".repeat(digits)).slice(0, digits)
  const units = Number(whole) * 10 ** digits + Number(padded)
  return { units: negative ? -units : units, currency }
}

export function add(left: Money, right: Money): Money {
  if (left.currency !== right.currency) throw new CurrencyMismatchError(left.currency, right.currency)
  return { units: left.units + right.units, currency: left.currency }
}

export function subtract(left: Money, right: Money): Money {
  if (left.currency !== right.currency) throw new CurrencyMismatchError(left.currency, right.currency)
  return { units: left.units - right.units, currency: left.currency }
}

export function negate(amount: Money): Money {
  return { units: -amount.units, currency: amount.currency }
}

export function sum(amounts: readonly Money[], currency: string): Money {
  return amounts.reduce((total, amount) => add(total, amount), zero(currency))
}

export function isZero(amount: Money): boolean {
  return amount.units === 0
}

export function compare(left: Money, right: Money): number {
  if (left.currency !== right.currency) throw new CurrencyMismatchError(left.currency, right.currency)
  return left.units - right.units
}

/**
 * Round a real number to an integer under a stated mode.
 *
 * The one place a rounding decision is implemented, so there is one place to
 * read and one place to be wrong. Ties are detected on the exact half rather
 * than by comparing against `Math.round`'s answer, because the whole point is
 * that the four modes disagree about exactly that case.
 */
export function roundToInteger(value: number, rounding: RoundingMode): number {
  if (!Number.isFinite(value)) throw new RangeError(`Cannot round ${value}.`)
  if (Number.isInteger(value)) return value

  const negative = value < 0
  const magnitude = Math.abs(value)
  const floor = Math.floor(magnitude)
  const fraction = magnitude - floor

  let rounded: number
  if (rounding === "down") {
    rounded = floor
  } else if (fraction > 0.5) {
    rounded = floor + 1
  } else if (fraction < 0.5) {
    rounded = floor
  } else if (rounding === "half-away-from-zero") {
    rounded = floor + 1
  } else if (rounding === "half-even") {
    rounded = floor % 2 === 0 ? floor : floor + 1
  } else {
    // half-up — toward +Infinity, so the sign decides.
    rounded = negative ? floor : floor + 1
  }

  return negative ? -rounded : rounded
}

/**
 * The amount as a whole number of the currency's minor units.
 *
 * `SCALE` extra digits exist so sub-cent CUR lines survive ingest; this is where
 * they stop existing, and the caller says how.
 */
export function toMinorUnits(amount: Money, rounding: RoundingMode): number {
  return roundToInteger(amount.units / 10 ** SCALE, rounding)
}

/**
 * Split an amount across weights so the parts add back to exactly the whole.
 *
 * The largest-remainder method. Allocating a shared NAT gateway across nine
 * tenants by request count gives nine fractions; rounding each independently
 * loses or invents units, and then the FinOps page's tenant column does not add
 * up to its total. A page whose columns do not add up is one an operator stops
 * reading, and the discrepancy is always small enough to look like a rounding
 * bug and large enough to matter at fleet scale.
 *
 * `rounding` decides where each share starts; the remainder step then moves
 * whole units until the parts sum to the whole, in whichever direction the
 * chosen mode left them short or long. Ties break toward the earlier index, so
 * the same input always splits the same way — a report that reshuffles cents
 * between tenants on every refresh is not something anyone can reconcile
 * against a bill.
 */
export function allocateByWeight(
  amount: Money,
  weights: readonly number[],
  rounding: RoundingMode,
): Money[] {
  if (weights.length === 0) return []
  if (weights.some((weight) => weight < 0 || !Number.isFinite(weight))) {
    throw new RangeError("Allocation weights must be finite and non-negative.")
  }

  const total = weights.reduce((running, weight) => running + weight, 0)
  if (total === 0) {
    // Nothing to weigh by. Splitting evenly would be a driver nobody chose, so
    // the whole amount stays with the first bucket and the caller — which knows
    // what the buckets are — decides whether that is acceptable. In this
    // package the only caller treats a zero-weight driver as unallocatable.
    return weights.map((_, index) => (index === 0 ? amount : zero(amount.currency)))
  }

  const exact = weights.map((weight) => (amount.units * weight) / total)
  const seats = exact.map((value) => roundToInteger(value, rounding))
  let remainder = amount.units - seats.reduce((running, unit) => running + unit, 0)

  // Whoever was rounded furthest from their exact share is corrected first, and
  // ties break toward the earlier index so the split is reproducible. `down`
  // always leaves a positive remainder; `half-up` on a set of exact halves can
  // leave a negative one, and taking a unit back has to be as deterministic as
  // handing one out.
  const byShortfall = exact
    .map((value, index) => ({ index, shortfall: value - seats[index] }))
    .sort((left, right) => right.shortfall - left.shortfall || left.index - right.index)

  const units = [...seats]
  let cursor = 0
  while (remainder > 0) {
    units[byShortfall[cursor % byShortfall.length].index] += 1
    remainder -= 1
    cursor += 1
  }
  cursor = 0
  while (remainder < 0) {
    // From the end: whoever gained the most over their exact share gives back.
    units[byShortfall[byShortfall.length - 1 - (cursor % byShortfall.length)].index] -= 1
    remainder += 1
    cursor += 1
  }

  return units.map((value) => money(value, amount.currency))
}

/**
 * For display and for tests: the decimal string, at the currency's own precision.
 *
 * The digit count comes from the `Money`'s own currency rather than from a
 * parameter defaulting to 2, so a JPY figure renders as `1200` and a KWD one as
 * `1.234`. `rounding` is required: this is the edge where exactness ends, and a
 * default here is how a debit and its exact reversal came to render with
 * different magnitudes.
 */
export function toDecimal(amount: Money, rounding: RoundingMode): string {
  const digits = minorDigits(amount.currency)
  const minor = toMinorUnits(amount, rounding)
  const negative = minor < 0
  const absolute = Math.abs(minor)
  const whole = Math.floor(absolute / 10 ** digits)
  const fraction = String(absolute % 10 ** digits).padStart(digits, "0")
  return `${negative ? "-" : ""}${whole}${digits > 0 ? `.${fraction}` : ""}`
}
