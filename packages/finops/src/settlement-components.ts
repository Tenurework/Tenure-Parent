import {
  CurrencyMismatchError,
  add,
  minorDigits,
  money,
  subtract,
  zero,
  type Money,
  type RoundingMode,
} from "./money"

/**
 * PAY-130-003 — the eight components of a settlement, and the arithmetic that
 * proves they add up.
 *
 * None of them was modelled anywhere. `@tenure/finops` was charter-limited to
 * AWS cost allocation, and grep across the packages and the application found no
 * fee, refund, dispute, payout or settlement type at all. There was no FX
 * either: `packages/platform-config/src/money.ts` carries a `MoneyFormat` for
 * FORMATTING, and `CurrencyMismatchError` in `./money` refuses cross-currency
 * arithmetic with the message "convert with a stated rate and date" — pointing
 * at a value type that did not exist. `ConversionRate` below is that type.
 *
 * ## Why a payout is proved rather than reported
 *
 * A settlement statement is a list of numbers a provider asserts. The one thing
 * a platform can independently check is whether they are consistent: gross minus
 * what was taken out of it, plus or minus what the currency moved, has to equal
 * what actually landed. When it does not, the honest output is a refusal naming
 * the residual — never a payout figure adjusted until it balances, which is the
 * one operation that makes the discrepancy permanently invisible.
 */

/**
 * The eight components. Every one a `Money`, every one in the same currency.
 *
 * Signs are magnitudes, not directions: `fees`, `refunds`, `disputes` and
 * `transfers` are all stated as positive amounts that were taken OUT of gross,
 * and `netSettlement` subtracts them. A field that could be either sign
 * according to context is a field two callers will read two ways.
 *
 * `fxGainLoss` is the exception and is signed, because a currency movement
 * genuinely goes both ways.
 */
export interface SettlementComponents {
  /** Everything charged, before anything was taken out of it. */
  gross: Money
  /** Processing and platform fees. Positive. */
  fees: Money
  /** Money returned to payers. Positive. */
  refunds: Money
  /** Chargebacks and dispute amounts withheld. Positive. */
  disputes: Money
  /** Moved on to connected accounts rather than settled here. Positive. */
  transfers: Money
  /** What actually landed in the bank. */
  payouts: Money
  /** Signed: positive is a gain on conversion, negative a loss. */
  fxGainLoss: Money
}

/**
 * A conversion rate, with the date it was true on.
 *
 * The value type `CurrencyMismatchError`'s message has always pointed at. A rate
 * with no date is not a rate — it is a number that was right on some day nobody
 * recorded, and a restatement six months later cannot be reproduced from it.
 *
 * `rate` is a decimal STRING for the same reason `fromDecimal` takes one: 1.1 is
 * not 1.1 in a double, and a rate that has been through a float has already lost
 * the exactness this module exists to keep.
 */
export interface ConversionRate {
  /** ISO 4217 of the amount being converted. */
  from: string
  /** ISO 4217 of the result. */
  to: string
  /** Units of `to` per one unit of `from`, as a decimal string. */
  rate: string
  /** ISO timestamp the rate was quoted at. */
  asOf: string
}

export class ConversionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConversionError"
  }
}

// Written as calls rather than as `0n`/`10n`: both apps compile at ES2017, where
// a BigInt LITERAL is a syntax error while the `BigInt` global is available
// through `lib: esnext`. The exponent operator is avoided for the same reason.
const ZERO = BigInt(0)
const ONE = BigInt(1)
const TWO = BigInt(2)
const TEN = BigInt(10)

function pow10(exponent: number): bigint {
  let value = ONE
  for (let i = 0; i < exponent; i++) value = value * TEN
  return value
}

/**
 * Convert an amount at a stated rate, exactly.
 *
 * No float multiply anywhere in here. The rate's decimal string becomes an
 * integer numerator over a power of ten, the currencies' differing minor-unit
 * exponents become another power of ten, and the whole thing is one BigInt
 * division rounded once under the mode the caller states.
 *
 * The exponent term is the part a naive implementation drops. USD has two minor
 * digits and JPY has none, so converting $100.00 at 150 is not `10000 * 150`
 * in anybody's units — it is ¥15,000, and an implementation that multiplies the
 * unit counts is out by a factor of a hundred in a direction that looks
 * plausible.
 */
export function convert(amount: Money, rate: ConversionRate, rounding: RoundingMode): Money {
  if (amount.currency !== rate.from) {
    throw new CurrencyMismatchError(amount.currency, rate.from)
  }
  if (!/^\d+(\.\d+)?$/.test(rate.rate.trim())) {
    throw new ConversionError(
      `"${rate.rate}" is not a rate. It must be a non-negative decimal string — a number that has ` +
        `been through a double has already lost the exactness this conversion is for.`,
    )
  }
  if (!rate.asOf || Number.isNaN(Date.parse(rate.asOf))) {
    throw new ConversionError(
      `A ${rate.from}->${rate.to} rate quoted at ${JSON.stringify(rate.asOf)} has no usable date. ` +
        `A rate with no date cannot be reproduced, so neither can the settlement that used it.`,
    )
  }

  const [whole, fraction = ""] = rate.rate.trim().split(".")
  const numerator = BigInt(whole + fraction)
  const denominator = pow10(fraction.length)

  // units are counted in 10^-SCALE of each currency's minor unit; SCALE cancels,
  // the minor-digit difference does not.
  const scaledNumerator = BigInt(amount.units) * numerator * pow10(minorDigits(rate.to))
  const scaledDenominator = denominator * pow10(minorDigits(rate.from))

  const quotient = scaledNumerator / scaledDenominator
  const remainder = scaledNumerator % scaledDenominator

  let units: bigint
  if (remainder === ZERO) {
    units = quotient
  } else {
    // Rounding on exact integers: twice the remainder against the denominator
    // decides the tie without ever forming a fraction.
    const negative = scaledNumerator < ZERO
    const absRemainder = remainder < ZERO ? -remainder : remainder
    const twice = absRemainder * TWO
    // BigInt division truncates toward zero, so `quotient` is the magnitude's
    // floor with the sign already applied.
    const stepAwayFromZero = negative ? -ONE : ONE
    if (rounding === "down") {
      units = quotient
    } else if (twice > scaledDenominator) {
      units = quotient + stepAwayFromZero
    } else if (twice < scaledDenominator) {
      units = quotient
    } else if (rounding === "half-away-from-zero") {
      units = quotient + stepAwayFromZero
    } else if (rounding === "half-even") {
      const magnitude = quotient < ZERO ? -quotient : quotient
      units = magnitude % TWO === ZERO ? quotient : quotient + stepAwayFromZero
    } else {
      // half-up — toward +Infinity, so a negative amount stays at its floor.
      units = negative ? quotient : quotient + ONE
    }
  }

  if (units > BigInt(Number.MAX_SAFE_INTEGER) || units < BigInt(-Number.MAX_SAFE_INTEGER)) {
    throw new ConversionError(
      `Converting ${amount.units} ${rate.from} at ${rate.rate} overflows exact integer arithmetic ` +
        `(${units} ${rate.to} units). Refused rather than rounded silently.`,
    )
  }

  return money(Number(units), rate.to)
}

export interface NetSettlement {
  /** gross − fees − refunds − disputes − transfers + fxGainLoss. */
  expectedPayouts: Money
  /** What the provider says landed. */
  payouts: Money
  /** expected − payouts. Zero, or the statement does not settle. */
  residual: Money
  settles: boolean
  /**
   * Named, not a boolean and not a free-text warning. Null when it settles.
   *
   * A refusal a caller can branch on is the difference between a surface that
   * shows the discrepancy and one that logs it.
   */
  refusal: { code: "NET_SETTLEMENT_DOES_NOT_BALANCE"; detail: string } | null
}

/**
 * Prove the eight components against each other, to the unit.
 *
 * Never adjusts anything. If the residual is not zero, `settles` is false, the
 * residual is reported as it stands and the refusal says which direction it goes
 * in — because a settlement that is 40 cents short and a settlement that is 40
 * cents over are different incidents.
 *
 * All seven components must share one currency; `add`/`subtract` refuse
 * otherwise. A statement mixing currencies has to be converted with a stated
 * rate and date first — `convert` above — which is what makes the FX term a
 * number somebody can check rather than a plug.
 */
export function netSettlement(components: SettlementComponents): NetSettlement {
  const { gross, fees, refunds, disputes, transfers, payouts, fxGainLoss } = components
  const currency = gross.currency

  const takenOut = [fees, refunds, disputes, transfers].reduce(
    (running, part) => add(running, part),
    zero(currency),
  )
  // The FX term is added, not subtracted: it is signed, so a conversion loss is
  // already negative. Dropping it here is the mutation this function's test
  // exists to catch — a statement that balances in one currency stops balancing
  // the moment any of it was converted.
  const expectedPayouts = add(subtract(gross, takenOut), fxGainLoss)
  const residual = subtract(expectedPayouts, payouts)
  const settles = residual.units === 0

  return {
    expectedPayouts,
    payouts,
    residual,
    settles,
    refusal: settles
      ? null
      : {
          code: "NET_SETTLEMENT_DOES_NOT_BALANCE",
          detail:
            `Gross ${gross.units} less fees ${fees.units}, refunds ${refunds.units}, disputes ` +
            `${disputes.units} and transfers ${transfers.units}, with FX ${fxGainLoss.units}, comes ` +
            `to ${expectedPayouts.units} ${currency} minor-scale units; the statement says ` +
            `${payouts.units} was paid out. ${residual.units > 0 ? "Short by" : "Over by"} ` +
            `${Math.abs(residual.units)}. Nothing has been adjusted to make this balance.`,
        },
  }
}

/** Every component, so a caller can render or total the statement without listing them. */
export function settlementComponentEntries(
  components: SettlementComponents,
): readonly { component: keyof SettlementComponents; amount: Money }[] {
  return [
    { component: "gross", amount: components.gross },
    { component: "fees", amount: components.fees },
    { component: "refunds", amount: components.refunds },
    { component: "disputes", amount: components.disputes },
    { component: "transfers", amount: components.transfers },
    { component: "fxGainLoss", amount: components.fxGainLoss },
    { component: "payouts", amount: components.payouts },
  ]
}

