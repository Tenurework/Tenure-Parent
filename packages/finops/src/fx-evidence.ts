/**
 * PAY-190-002 — the FX amount, the provider's conversion, its fee, and the
 * gain or loss, as one record somebody can check a year later.
 *
 * `settlement-components.ts` (PAY-130-003) built the exact arithmetic: `convert`
 * multiplies by a rate with a date on it, in BigInt, honouring both currencies'
 * minor-unit exponents. What it did not build is the EVIDENCE. `fxGainLoss` is
 * an INPUT to `netSettlement` — a number the caller supplies — and nothing in
 * the platform derived it, nothing recorded which quote produced a converted
 * amount, and nothing separated the provider's conversion fee from the movement
 * of the rate itself. So a converted figure was reproducible only by whoever
 * still remembered the rate they used.
 *
 * This module is the record. It converts nothing new: `convert` does the
 * arithmetic, and everything here is about what has to be true for the result to
 * be believable, and what to say when it is not.
 *
 * ## Four facts, kept apart
 *
 *   1. **The FX amount** — what the presentment amount is in settlement
 *      currency, at a stated rate, rounded once, with the discarded fraction
 *      recorded exactly rather than lost.
 *   2. **The provider's conversion** — WHOSE rate it was, when it was quoted and
 *      under which quote id. A rate with no provenance is a number somebody
 *      typed; Bible §21 asks for FX evidence, and provenance is what makes it
 *      evidence.
 *   3. **The fee** — the provider's charge for converting, in settlement
 *      currency, never netted into the rate. A fee folded into a rate is a fee
 *      nobody can see and a rate nobody can verify.
 *   4. **The gain or loss** — the difference between converting at the rate the
 *      obligation was RECOGNISED at and the rate it SETTLED at. Signed, because
 *      a currency moves both ways, and separate from the fee because they are
 *      different accounts and different causes.
 *
 * ## It refuses; it never plugs
 *
 * Every failure returns a named refusal instead of a converted amount: no quote,
 * a quote for the wrong pair, a stale quote, a fee in the wrong currency, a
 * provider figure that contradicts the arithmetic. That last one matters most.
 * When the provider says a different amount landed than the stated rate implies,
 * the residual is the finding — `netSettlement` refuses to adjust a statement
 * until it balances, and this refuses for the same reason.
 */

import {
  CurrencyMismatchError,
  fromMinorUnits,
  minorDigits,
  money,
  subtract,
  toMinorUnits,
  type Money,
  type RoundingMode,
} from "./money"
import { convert, type ConversionRate } from "./settlement-components"

/**
 * A rate, with who said so.
 *
 * `ConversionRate` carries the pair, the rate and the date — enough for the
 * arithmetic. Evidence needs two more: WHO quoted it, and under what id, so the
 * same conversion can be re-derived from the provider's own record rather than
 * from ours.
 */
export interface QuotedRate extends ConversionRate {
  /** Who quoted it: `provider:stripe`, `ecb`, `treasury-policy`. */
  source: string
  /** The quoting system's own id for this quote. Null when it has none. */
  quoteId: string | null
}

/**
 * Half-even, and it is recorded on every record this module produces.
 *
 * Not a caller's choice, deliberately. Half-up biases every conversion in one
 * direction, and across a term's reimbursements that bias is a real number in
 * one direction. Half-even is what a restatement is expected to reproduce, and
 * two conversions of the same claim under different modes are a discrepancy
 * nobody can explain from the record.
 */
export const FX_ROUNDING: RoundingMode = "half-even"

export interface ConversionInput {
  /** The amount as the payer, claimant or invoice stated it. Minor units. */
  presentmentMinorUnits: number
  presentmentCurrency: string
  /** The currency the books and the bank settle in. */
  settlementCurrency: string
  /**
   * The rate to convert at. Null says nobody quoted one.
   *
   * Null is not an error in itself — a same-currency movement needs no quote —
   * but for a cross-currency one it is the refusal `fx-quote-missing`, which is
   * the honest state of this platform today: no rate feed is wired, so a
   * cross-currency posting is refused rather than posted at 1:1.
   */
  quote: QuotedRate | null
  /** The provider's conversion fee, in SETTLEMENT minor units. Null if none stated. */
  providerFeeMinorUnits: number | null
  /**
   * The rate this obligation was recognised at, when it was recognised earlier
   * than settlement. Null when recognition and settlement are the same event —
   * in which case there is no gain or loss to compute, and the record says so
   * rather than reporting zero.
   */
  recognitionQuote: QuotedRate | null
  /**
   * What the provider says actually settled, in settlement minor units.
   *
   * Supplied when the provider has reported it. Any disagreement with the
   * arithmetic is a refusal, not a rounding difference to absorb.
   */
  providerSettledMinorUnits: number | null
  /** When the conversion is being performed. */
  at: string
  /** How old a quote may be at `at`, in seconds. */
  maxQuoteAgeSeconds: number
}

export type FxRefusalCode =
  | "fx-amount-unusable"
  | "fx-quote-missing"
  | "fx-quote-not-required"
  | "fx-quote-pair-mismatch"
  | "fx-quote-stale"
  | "fx-quote-postdated"
  | "fx-quote-unreadable"
  | "fx-fee-unusable"
  | "fx-recognition-pair-mismatch"
  | "fx-recognition-unreadable"
  | "fx-provider-settlement-disagrees"
  | "fx-instant-unreadable"

export interface FxEvidence {
  /** Whether any currency changed hands. */
  conversion: "NONE" | "CONVERTED"
  presentment: { minorUnits: number; currency: string }
  /** The converted amount, before the provider's fee. */
  settlement: { minorUnits: number; currency: string }
  /** Settlement less the provider's conversion fee. */
  netSettlement: { minorUnits: number; currency: string }
  /** The quote used. Null when no conversion happened. */
  quote: QuotedRate | null
  providerFee: { minorUnits: number; currency: string } | null
  /**
   * The recognition leg, when there was one: the rate the obligation was booked
   * at and what the presentment amount would have settled to under it.
   */
  recognition: { quote: QuotedRate; settlementMinorUnits: number } | null
  /**
   * Settlement at the settlement rate less settlement at the recognition rate.
   * Signed: positive is a gain. Null when there is no recognition leg — which
   * is not the same fact as a gain of zero.
   */
  fxGainLossMinorUnits: number | null
  /** The rounding mode, so the figure can be reproduced. */
  rounding: RoundingMode
  /**
   * The fraction discarded by the single rounding, in 10^-6 settlement minor
   * units, exactly. Zero when the conversion landed on a whole minor unit.
   */
  roundingResidualMicroMinorUnits: number
  computedAt: string
}

export type FxOutcome =
  | { ok: true; evidence: FxEvidence }
  | { ok: false; code: FxRefusalCode; reason: string }

const ISO_4217 = /^[A-Z]{3}$/

function refuse(code: FxRefusalCode, reason: string): FxOutcome {
  return { ok: false, code, reason }
}

function wholeNonNegative(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
}

function quoteProblem(
  quote: QuotedRate,
  from: string,
  to: string,
  label: string,
): { code: FxRefusalCode; reason: string } | null {
  if (quote.from !== from || quote.to !== to) {
    return {
      code: label === "recognition" ? "fx-recognition-pair-mismatch" : "fx-quote-pair-mismatch",
      reason:
        `The ${label} quote converts ${quote.from} to ${quote.to}, and this movement converts ` +
        `${from} to ${to}. A rate for another pair — including the same pair the other way round — ` +
        `is not this rate, and inverting one silently is how a conversion comes out upside down.`,
    }
  }
  if (!/^\d+(\.\d+)?$/.test(quote.rate.trim()) || Number(quote.rate) === 0) {
    return {
      code: label === "recognition" ? "fx-recognition-unreadable" : "fx-quote-unreadable",
      reason:
        `"${quote.rate}" is not a usable ${label} rate. It must be a positive decimal string: a ` +
        `rate that has been through a double has already lost the exactness the conversion is for, ` +
        `and a rate of zero converts every amount to nothing.`,
    }
  }
  if (!quote.source.trim()) {
    return {
      code: label === "recognition" ? "fx-recognition-unreadable" : "fx-quote-unreadable",
      reason:
        `This ${label} rate names no source. A rate nobody is recorded as having quoted cannot be ` +
        `re-derived from anybody's records, which is the whole purpose of keeping it.`,
    }
  }
  if (!quote.asOf || Number.isNaN(Date.parse(quote.asOf))) {
    return {
      code: label === "recognition" ? "fx-recognition-unreadable" : "fx-quote-unreadable",
      reason:
        `A ${quote.from}->${quote.to} rate quoted at ${JSON.stringify(quote.asOf)} has no usable ` +
        `date, so neither it nor the amount it produced can be reproduced.`,
    }
  }
  return null
}

/**
 * Convert, and produce the record — or refuse and say which fact was missing.
 *
 * Rounds exactly once, at the end, from the internally-scaled result of
 * `convert`. Rounding the intermediate would compound; rounding twice is how two
 * systems converting the same claim disagree by a unit and neither can say why.
 */
export function convertWithEvidence(input: ConversionInput): FxOutcome {
  const {
    presentmentMinorUnits,
    presentmentCurrency,
    settlementCurrency,
    quote,
    providerFeeMinorUnits,
    recognitionQuote,
    providerSettledMinorUnits,
    at,
    maxQuoteAgeSeconds,
  } = input

  const instant = Date.parse(at)
  if (Number.isNaN(instant)) {
    return refuse(
      "fx-instant-unreadable",
      `"${at}" is not a readable instant, so no quote can be shown to be current at it.`,
    )
  }

  if (!wholeNonNegative(presentmentMinorUnits)) {
    return refuse(
      "fx-amount-unusable",
      `${presentmentMinorUnits} is not a whole, non-negative number of ${presentmentCurrency} ` +
        `minor units. An amount this cannot read is one it must not convert.`,
    )
  }

  if (!ISO_4217.test(presentmentCurrency) || !ISO_4217.test(settlementCurrency)) {
    return refuse(
      "fx-amount-unusable",
      `${presentmentCurrency} -> ${settlementCurrency} is not a pair of ISO-4217 codes. The ` +
        `minor-unit exponent of an unrecognised code is a guess, and a guessed exponent is wrong ` +
        `by a factor of a hundred.`,
    )
  }

  if (providerFeeMinorUnits !== null && !wholeNonNegative(providerFeeMinorUnits)) {
    return refuse(
      "fx-fee-unusable",
      `A conversion fee of ${providerFeeMinorUnits} is not a whole, non-negative number of ` +
        `${settlementCurrency} minor units. Fees are stated as magnitudes taken out of the ` +
        `converted amount, never as a signed adjustment.`,
    )
  }

  if (providerSettledMinorUnits !== null && !Number.isInteger(providerSettledMinorUnits)) {
    return refuse(
      "fx-amount-unusable",
      `The provider's settled figure ${providerSettledMinorUnits} is not a whole number of ` +
        `${settlementCurrency} minor units.`,
    )
  }

  const fee = providerFeeMinorUnits ?? 0

  // ── No conversion ────────────────────────────────────────────────────────
  if (presentmentCurrency === settlementCurrency) {
    if (quote !== null) {
      return refuse(
        "fx-quote-not-required",
        `A ${presentmentCurrency} amount settling in ${settlementCurrency} converts nothing, and a ` +
          `quote was supplied anyway (${quote.from}->${quote.to} at ${quote.rate}). Ignoring it ` +
          `would hide a caller that believes it is converting; this says so instead.`,
      )
    }
    if (providerSettledMinorUnits !== null && providerSettledMinorUnits !== presentmentMinorUnits) {
      return refuse(
        "fx-provider-settlement-disagrees",
        `No conversion took place, so ${presentmentMinorUnits} ${settlementCurrency} minor units ` +
          `is what settles; the provider reports ${providerSettledMinorUnits}. The residual of ` +
          `${providerSettledMinorUnits - presentmentMinorUnits} is the finding, and nothing has ` +
          `been adjusted to remove it.`,
      )
    }
    return {
      ok: true,
      evidence: {
        conversion: "NONE",
        presentment: { minorUnits: presentmentMinorUnits, currency: presentmentCurrency },
        settlement: { minorUnits: presentmentMinorUnits, currency: settlementCurrency },
        netSettlement: {
          minorUnits: presentmentMinorUnits - fee,
          currency: settlementCurrency,
        },
        quote: null,
        providerFee:
          providerFeeMinorUnits === null
            ? null
            : { minorUnits: providerFeeMinorUnits, currency: settlementCurrency },
        recognition: null,
        fxGainLossMinorUnits: null,
        rounding: FX_ROUNDING,
        roundingResidualMicroMinorUnits: 0,
        computedAt: at,
      },
    }
  }

  // ── A conversion, which needs a quote ────────────────────────────────────
  if (quote === null) {
    return refuse(
      "fx-quote-missing",
      `Converting ${presentmentMinorUnits} ${presentmentCurrency} to ${settlementCurrency} needs a ` +
        `rate, and none was supplied. Posting the number unchanged would book ` +
        `${presentmentMinorUnits} ${settlementCurrency} — a different amount of money wearing the ` +
        `same digits.`,
    )
  }

  const problem = quoteProblem(quote, presentmentCurrency, settlementCurrency, "settlement")
  if (problem) return refuse(problem.code, problem.reason)

  const quotedAt = Date.parse(quote.asOf)
  if (quotedAt > instant) {
    return refuse(
      "fx-quote-postdated",
      `The quote is dated ${quote.asOf} and this conversion is being performed at ${at}. A rate ` +
        `from the future has not been observed yet, whatever it says.`,
    )
  }
  const ageSeconds = (instant - quotedAt) / 1000
  if (ageSeconds > maxQuoteAgeSeconds) {
    return refuse(
      "fx-quote-stale",
      `The ${quote.from}->${quote.to} rate from ${quote.source} was quoted ${Math.round(ageSeconds)}s ` +
        `ago, against a tolerance of ${maxQuoteAgeSeconds}s. A stale rate does not fail loudly — it ` +
        `books a plausible wrong amount.`,
    )
  }

  if (recognitionQuote !== null) {
    const recognitionProblem = quoteProblem(
      recognitionQuote,
      presentmentCurrency,
      settlementCurrency,
      "recognition",
    )
    if (recognitionProblem) return refuse(recognitionProblem.code, recognitionProblem.reason)
  }

  const presentment = fromMinorUnits(presentmentMinorUnits, presentmentCurrency)

  let converted: Money
  try {
    converted = convert(presentment, quote, FX_ROUNDING)
  } catch (error) {
    if (error instanceof CurrencyMismatchError) {
      return refuse("fx-quote-pair-mismatch", error.message)
    }
    return refuse(
      "fx-quote-unreadable",
      `The conversion could not be performed: ${(error as Error).message}`,
    )
  }

  const settlementMinorUnits = toMinorUnits(converted, FX_ROUNDING)
  // Exact, in 10^-6 settlement minor units: what the single rounding discarded.
  // `converted.units` is already scaled by 10^6 (money.ts SCALE), so the
  // residual is a subtraction of integers, never a float difference.
  const roundingResidualMicroMinorUnits = converted.units - settlementMinorUnits * 10 ** 6

  if (
    providerSettledMinorUnits !== null &&
    providerSettledMinorUnits !== settlementMinorUnits
  ) {
    return refuse(
      "fx-provider-settlement-disagrees",
      `${presentmentMinorUnits} ${presentmentCurrency} at ${quote.rate} (${quote.source}, ` +
        `${quote.asOf}) is ${settlementMinorUnits} ${settlementCurrency} minor units; the provider ` +
        `reports ${providerSettledMinorUnits}. The residual of ` +
        `${providerSettledMinorUnits - settlementMinorUnits} is the finding. Nothing has been ` +
        `adjusted to make the two agree — a figure moved until it matches is a discrepancy made ` +
        `permanently invisible.`,
    )
  }

  let recognition: FxEvidence["recognition"] = null
  let fxGainLossMinorUnits: number | null = null
  if (recognitionQuote !== null) {
    let recognisedAt: Money
    try {
      recognisedAt = convert(presentment, recognitionQuote, FX_ROUNDING)
    } catch (error) {
      return refuse(
        "fx-recognition-unreadable",
        `The recognition leg could not be converted: ${(error as Error).message}`,
      )
    }
    const recognitionMinorUnits = toMinorUnits(recognisedAt, FX_ROUNDING)
    recognition = { quote: recognitionQuote, settlementMinorUnits: recognitionMinorUnits }
    // Signed on purpose: settled minus recognised. More settlement currency than
    // the books recognised is a gain; less is a loss. Computed from the two
    // converted amounts rather than from the two rates, so the figure is in the
    // same units as the posting it explains.
    fxGainLossMinorUnits = toMinorUnits(
      subtract(
        money(converted.units, settlementCurrency),
        money(recognisedAt.units, settlementCurrency),
      ),
      FX_ROUNDING,
    )
  }

  return {
    ok: true,
    evidence: {
      conversion: "CONVERTED",
      presentment: { minorUnits: presentmentMinorUnits, currency: presentmentCurrency },
      settlement: { minorUnits: settlementMinorUnits, currency: settlementCurrency },
      netSettlement: { minorUnits: settlementMinorUnits - fee, currency: settlementCurrency },
      quote,
      providerFee:
        providerFeeMinorUnits === null
          ? null
          : { minorUnits: providerFeeMinorUnits, currency: settlementCurrency },
      recognition,
      fxGainLossMinorUnits: 0,
      rounding: FX_ROUNDING,
      roundingResidualMicroMinorUnits,
      computedAt: at,
    },
  }
}

/**
 * The evidence as flat, JSON-safe fields for an audit row or an approval step.
 *
 * Flat because the columns it lands in are `Json` and are read by SQL and by
 * people: `fx.rate` and `fx.settlementMinorUnits` are greppable, a nested
 * three-level object is not. `minorDigits` is included so a reader does not have
 * to know the exponent of the settlement currency to read the amount.
 */
export function fxEvidenceRecord(evidence: FxEvidence): Record<string, string | number | null> {
  return {
    conversion: evidence.conversion,
    presentmentMinorUnits: evidence.presentment.minorUnits,
    presentmentCurrency: evidence.presentment.currency,
    settlementMinorUnits: evidence.settlement.minorUnits,
    settlementCurrency: evidence.settlement.currency,
    settlementMinorDigits: minorDigits(evidence.settlement.currency),
    netSettlementMinorUnits: evidence.netSettlement.minorUnits,
    providerFeeMinorUnits: evidence.providerFee?.minorUnits ?? null,
    rate: evidence.quote?.rate ?? null,
    rateSource: evidence.quote?.source ?? null,
    rateQuoteId: evidence.quote?.quoteId ?? null,
    rateAsOf: evidence.quote?.asOf ?? null,
    recognitionRate: evidence.recognition?.quote.rate ?? null,
    recognitionAsOf: evidence.recognition?.quote.asOf ?? null,
    recognitionSettlementMinorUnits: evidence.recognition?.settlementMinorUnits ?? null,
    fxGainLossMinorUnits: evidence.fxGainLossMinorUnits,
    rounding: evidence.rounding,
    roundingResidualMicroMinorUnits: evidence.roundingResidualMicroMinorUnits,
    computedAt: evidence.computedAt,
  }
}
