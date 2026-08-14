/**
 * What the composition would cost — and what it says when it cannot say.
 *
 * ## Why this is a module and not four lines in the form
 *
 * The composer answers "what am I about to create, and what will it cost". The
 * second half of that question went through `activationPreview` in a `useMemo`,
 * unguarded, and `activationPreview` REFUSES rather than guesses:
 *
 *   * `quoteConfiguration` throws `PriceError` when any selected option's price
 *     is absent, fractional, negative, not ISO 4217 or declares a rounding mode
 *     that is not one of the four;
 *   * `sum` throws `CurrencyMismatchError` the moment two selected options
 *     denominate in different currencies, because adding dollars to euros
 *     produces a total that is wrong in a way that looks right;
 *   * both are correct refusals, and both were thrown during render of a client
 *     component with no boundary under them. The composer did not show a wrong
 *     price. It showed NOTHING — the whole surface came down, on a page whose
 *     job is to state a price before a decision is taken.
 *
 * Today every module in `MODULE_CATALOG` is USD and validated by
 * `ModuleCatalog.of`, so none of those fire. That is exactly why this is worth
 * building now: the day somebody prices a module in EUR, the failure is a blank
 * page rather than a sentence, and nothing in the type system sees it coming.
 *
 * ## The rule this file implements
 *
 * **An option whose price cannot be resolved says so, and is never silently
 * priced at zero.** Zero is a commercial statement — it says Tenure gives this
 * away — and on a form with a running total it is indistinguishable from "nobody
 * has priced this yet". So there are three outcomes here and not two: PRICED,
 * INCLUDED (zero, with the reason stated), and UNPRICEABLE (named, itemised, and
 * never contributing 0 to a total that then reads as complete).
 *
 * ## Pure, and therefore provable
 *
 * Nothing here imports React, `next/*`, a Prisma client or `@/lib/aws`. It takes
 * numbers and returns a discriminated union, so `quote.test.tsx` can drive every
 * arm — including the two that cannot happen with today's catalog — without a
 * browser and without a server.
 */

import {
  activationPreview,
  priceProblems,
  fromMinorUnits,
  toDecimal,
  type ActivationPreview,
  type OptionPrice,
} from "@tenure/finops"

/**
 * An option as the composer holds it, which is NOT `PricedOption`.
 *
 * `PricedOption.price` is required, and `ComposeModule.price` is required for
 * the same deliberate reason: a caller that forgets a price should not compile.
 * This one is optional, because `tsc` guarantees the SHAPE of a value and not
 * its presence at runtime — a manifest deserialised from anywhere, a catalog
 * projected with one field dropped, and the required field is `undefined` on a
 * page that has already type-checked. Accepting the wider input here is what
 * lets that be reported instead of thrown.
 */
export interface SelectedOption {
  optionKey: string
  price: OptionPrice | undefined
}

/** One reason a figure could not be produced, attributed to what caused it. */
export interface QuoteProblem {
  /** The option at fault, or `null` when the selection as a whole is. */
  optionKey: string | null
  detail: string
}

/**
 * Why the composition could not be totalled.
 *
 * Four distinct reasons because they have four distinct remedies: fix the seat
 * count, fix a manifest's price, decide which currency the catalog lists in, or
 * read the message the pricing engine refused with. A single "unavailable" would
 * send an operator to the wrong one three times out of four.
 */
export type QuoteRefusal = "SEAT_COUNT" | "OPTION_PRICE" | "MIXED_CURRENCY" | "REFUSED"

export type SelectionQuote =
  | { state: "QUOTED"; preview: ActivationPreview }
  | { state: "UNPRICEABLE"; reason: QuoteRefusal; problems: readonly QuoteProblem[] }

/** The headline each refusal carries. Distinct, because the remedies are. */
export const REFUSAL_HEADLINE: Readonly<Record<QuoteRefusal, string>> = {
  SEAT_COUNT: "Cannot be totalled — the seat count is not a whole number of people",
  OPTION_PRICE: "Cannot be totalled — a selected option has no usable price",
  MIXED_CURRENCY: "Cannot be totalled — the selected options are not in one currency",
  REFUSED: "Cannot be totalled — the pricing engine refused the selection",
}

/** What to do next, per refusal. Never "try again", and never a default figure. */
export const REFUSAL_REMEDY: Readonly<Record<QuoteRefusal, string>> = {
  SEAT_COUNT:
    "State a whole, non-negative number of seats. Per-seat pricing over a fraction of a person is not a figure anybody can be invoiced for, so nothing is quoted until it is one.",
  OPTION_PRICE:
    "The prices below come from each module's own manifest in modules/index.ts, which validateManifest already checks. A problem here means a selected option reached this form carrying a price the catalog would not have admitted — treat it as a catalog defect, not as a free option.",
  MIXED_CURRENCY:
    "A total that adds two currencies is wrong in a way that looks right, so none is shown. Every option on one quote has to list in the same currency; the disagreeing options are named above.",
  REFUSED:
    "The message above is the pricing engine's own, carried verbatim. It is a refusal to produce a figure, not a figure of zero — nothing here is free because of it.",
}

/**
 * PAY-160-002 — a price in whole minor units, rendered at its currency's own
 * precision.
 *
 * Through `@tenure/finops` rather than `(minor / 100).toFixed(2)`: the divisor is
 * not 100 for every currency, and `toDecimal` reads the exponent off the `Money`
 * it is given. `half-even` because it is a display rounding with no bias, stated
 * rather than defaulted.
 */
export function priceLabel(minor: number, currency: string): string {
  const rendered = toDecimal(fromMinorUnits(minor, currency), "half-even")
  return currency === "USD" ? `$${rendered}` : `${rendered} ${currency}`
}

/**
 * A seat count the operator typed, as a whole number of people or as a stated
 * refusal.
 *
 * The form used to hold this as a `number` and coerce: `Math.max(0, Number(""))`
 * is `0` and `Math.max(0, Number("abc"))` is `NaN`, so an empty box quoted the
 * configuration at zero seats — a real figure, silently answering a question
 * nobody had answered — and a typo quoted it at `NaN`. Both are the same defect
 * as pricing an unpriced option at zero: an unstated input rendered as a stated
 * one.
 *
 * `^\d+$` rather than `Number.isInteger(Number(raw))`, because the second admits
 * `"2.0"`, `"1e3"`, `" 12 "` and `"0x10"` — four strings whose meaning a reader
 * and a parser disagree about.
 */
export function parseSeats(raw: string): { ok: true; seats: number } | { ok: false; detail: string } {
  const trimmed = raw.trim()
  if (trimmed === "") {
    return {
      ok: false,
      detail:
        "Seats is blank. Nothing is quoted at an unstated seat count — a per-seat charge over an unknown number of people is not a price.",
    }
  }
  if (!/^\d+$/.test(trimmed)) {
    return {
      ok: false,
      detail: `Seats is "${trimmed}", which is not a whole, non-negative number of people. There is no fractional seat and a negative one is a refund.`,
    }
  }
  const seats = Number(trimmed)
  if (!Number.isSafeInteger(seats)) {
    return {
      ok: false,
      detail: `Seats is "${trimmed}", which is past the largest integer this arithmetic stays exact at (${Number.MAX_SAFE_INTEGER}). A total computed past it is wrong by an amount nobody can predict.`,
    }
  }
  return { ok: true, seats }
}

/**
 * The quote for a selection, or the itemised reason there is none.
 *
 * The order of the checks is the order of the remedies: an operator with a bad
 * seat count should be told about the seat count rather than about the third
 * module's currency, because fixing the seat count is what they can do.
 *
 * The final `try` is a BACKSTOP, not the mechanism. Everything above it exists so
 * that the refusals this console can name are named; the catch is what keeps a
 * refusal nobody anticipated from taking the surface down with it, and it carries
 * the engine's own message rather than replacing it with a shrug.
 */
export function quoteSelection(
  selected: readonly SelectedOption[],
  seats: number,
): SelectionQuote {
  // 0. The seat count, first, because it is the input the operator can fix and
  //    because every per-seat figure below is a multiplication by it. `NaN`
  //    reaches here whenever the box is coerced rather than parsed, and `NaN`
  //    propagates silently through arithmetic all the way to a rendered total.
  if (!Number.isInteger(seats) || seats < 0) {
    return {
      state: "UNPRICEABLE",
      reason: "SEAT_COUNT",
      problems: [
        {
          optionKey: null,
          detail: `The quote was asked for ${seats} seats, which is not a whole, non-negative number of people.`,
        },
      ],
    }
  }

  // 1. Every option's price is usable on its own terms. `priceProblems` is the
  //    SAME check `validateManifest` runs, imported rather than restated, so a
  //    price this form refuses and a price the catalog refuses cannot disagree.
  const priced: QuoteProblem[] = []
  for (const option of selected) {
    for (const detail of priceProblems(option.price, `Option "${option.optionKey}"`)) {
      priced.push({ optionKey: option.optionKey, detail })
    }
    // Zero on both axes with no reason is unpriced, not free. `validateManifest`
    // refuses it in the catalog; this refuses it on the surface, because the
    // surface is where "free" would be read.
    const price = option.price
    if (
      price &&
      price.perSeatMinor === 0 &&
      price.perOrgMinor === 0 &&
      !price.includedBecause?.trim()
    ) {
      priced.push({
        optionKey: option.optionKey,
        detail:
          `Option "${option.optionKey}" is priced at zero on both axes and states no reason. Zero is a ` +
          `commercial statement — it says Tenure gives this away — and an option that does not make it ` +
          `is unpriced rather than free.`,
      })
    }
  }
  if (priced.length > 0) return { state: "UNPRICEABLE", reason: "OPTION_PRICE", problems: priced }

  // 2. One currency. `quoteConfiguration` takes the first option's currency as
  //    the quote's and then adds every line into it, so a second currency throws
  //    CurrencyMismatchError out of `add`. Detected here so the operator is told
  //    WHICH options disagree instead of being handed an exception's two-code
  //    message.
  const currencies = [...new Set(selected.map((o) => o.price!.currency))]
  if (currencies.length > 1) {
    return {
      state: "UNPRICEABLE",
      reason: "MIXED_CURRENCY",
      problems: selected.map((o) => ({
        optionKey: o.optionKey,
        detail: `Option "${o.optionKey}" lists in ${o.price!.currency}.`,
      })),
    }
  }

  // 3. The extension stays exact. `perSeatMinor × seats` is integer
  //    multiplication, and integer multiplication in JavaScript stops being
  //    exact past 2^53 - 1 — at which point the total is wrong by an amount that
  //    depends on the inputs. Checked against the real product rather than
  //    against an invented seat cap, so the refusal is a fact and not a policy.
  for (const option of selected) {
    if (!Number.isSafeInteger(option.price!.perSeatMinor * seats)) {
      return {
        state: "UNPRICEABLE",
        reason: "SEAT_COUNT",
        problems: [
          {
            optionKey: option.optionKey,
            detail:
              `Option "${option.optionKey}" at ${option.price!.perSeatMinor} minor units per seat, times ` +
              `${seats} seats, is past the largest integer this arithmetic stays exact at ` +
              `(${Number.MAX_SAFE_INTEGER}).`,
          },
        ],
      }
    }
  }

  try {
    return {
      state: "QUOTED",
      preview: activationPreview(
        // Narrowed by step 1: `priceProblems` refuses an absent price, so every
        // option here has one. The assertion is the compiler being told what the
        // loop above proved, not a claim made without a check.
        selected.map((o) => ({ optionKey: o.optionKey, price: o.price! })),
        seats,
      ),
    }
  } catch (error) {
    return {
      state: "UNPRICEABLE",
      reason: "REFUSED",
      problems: [
        {
          optionKey: null,
          detail:
            error instanceof Error && error.message
              ? error.message
              : "The pricing engine refused the selection and threw a value carrying no message.",
        },
      ],
    }
  }
}

/* ─────────────────────────────── the statement beside one option ──────────── */

export type PriceStatement =
  | { state: "PRICED"; text: string }
  | { state: "INCLUDED"; text: string }
  | { state: "UNPRICEABLE"; text: string }

/**
 * What goes beside a single checkbox — per seat AND for the organisation, always
 * both, and never a blank.
 *
 * Both, always: quote only the per-seat figure and a two-hundred-officer faculty
 * is charged like a two-person club; quote only the per-organisation figure and
 * the reverse. A blank beside a checkbox on a form with a running total is not
 * read as "unpriced". It is read as "free".
 *
 * `extendedMinor` is the quote's own line for a ticked option, so the figure
 * beside the box and the figure in the total are the same arithmetic rather than
 * two copies of it. For an unticked option there is no line, so `null` asks this
 * to compute what ticking it would add.
 */
export function optionPriceStatement(
  optionKey: string,
  price: OptionPrice | undefined,
  seats: number | null,
  extendedMinor: number | null,
): PriceStatement {
  const problems = priceProblems(price, `Option "${optionKey}"`)
  if (problems.length > 0 || !price) {
    return {
      state: "UNPRICEABLE",
      text: `Price cannot be resolved. ${problems.join(" ")} This option is not free and it is not included; nothing on this page can total it.`,
    }
  }

  if (price.perSeatMinor === 0 && price.perOrgMinor === 0) {
    const because = price.includedBecause?.trim()
    return because
      ? { state: "INCLUDED", text: `Included at no charge — ${because}` }
      : {
          state: "UNPRICEABLE",
          text:
            "Price cannot be resolved. It is zero on both axes and states no reason, and zero without " +
            "a reason is an option nobody has priced rather than one Tenure gives away.",
        }
  }

  const perSeat = priceLabel(price.perSeatMinor, price.currency)
  const perOrg = priceLabel(price.perOrgMinor, price.currency)

  if (seats === null || !Number.isInteger(seats) || seats < 0) {
    return {
      state: "PRICED",
      text: `${perSeat} per seat · ${perOrg} per organization · the extension is not shown, because the seat count is not a whole number of people.`,
    }
  }

  const extended = extendedMinor ?? price.perOrgMinor + price.perSeatMinor * seats
  if (!Number.isSafeInteger(extended)) {
    return {
      state: "PRICED",
      text: `${perSeat} per seat · ${perOrg} per organization · the extension at ${seats} seat(s) is past the largest exact integer, so it is not shown.`,
    }
  }
  return {
    state: "PRICED",
    text: `${perSeat} per seat · ${perOrg} per organization · ${priceLabel(extended, price.currency)} at ${seats} seat(s)`,
  }
}
