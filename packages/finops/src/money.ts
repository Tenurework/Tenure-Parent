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
 */

/** Extra digits kept below the minor unit, so sub-cent line items survive. */
export const SCALE = 6

export interface Money {
  /** Integer, in 10^-SCALE minor units. Cents × 10^6 for USD. */
  readonly units: number
  readonly currency: string
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
  const digits = 2 + SCALE
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
 * Split an amount across weights so the parts add back to exactly the whole.
 *
 * The largest-remainder method. Allocating a shared NAT gateway across nine
 * tenants by request count gives nine fractions; rounding each independently
 * loses or invents units, and then the FinOps page's tenant column does not add
 * up to its total. A page whose columns do not add up is one an operator stops
 * reading, and the discrepancy is always small enough to look like a rounding
 * bug and large enough to matter at fleet scale.
 *
 * Ties break toward the earlier index, so the same input always splits the same
 * way — a report that reshuffles cents between tenants on every refresh is not
 * something anyone can reconcile against a bill.
 */
export function allocateByWeight(amount: Money, weights: readonly number[]): Money[] {
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
  const floors = exact.map(Math.floor)
  let remainder = amount.units - floors.reduce((running, unit) => running + unit, 0)

  // Hand the leftover units to the largest fractional parts, earliest first.
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index)

  const units = [...floors]
  for (const { index } of order) {
    if (remainder <= 0) break
    units[index] += 1
    remainder -= 1
  }

  return units.map((value) => money(value, amount.currency))
}

/** For display and for tests: the decimal string, at the currency's own precision. */
export function toDecimal(amount: Money, minorDigits = 2): string {
  const divisor = 10 ** SCALE
  const minor = amount.units / divisor
  const rounded = Math.round(minor) / 10 ** (2 - minorDigits)
  const negative = rounded < 0
  const absolute = Math.abs(rounded)
  const whole = Math.floor(absolute / 10 ** minorDigits)
  const fraction = String(Math.round(absolute % 10 ** minorDigits)).padStart(minorDigits, "0")
  return `${negative ? "-" : ""}${whole}${minorDigits > 0 ? `.${fraction}` : ""}`
}
