/**
 * Currency formatting, with no dependencies.
 *
 * Deliberately its own module rather than living in `config/localization.ts`.
 * That file imports `@tenure/configuration`, whose index re-exports the resolver
 * — and the resolver imports `node:crypto` for checksums. `finance.ts` is
 * imported by client components, so importing the formatter from there would
 * drag `node:crypto` into a browser bundle.
 */

export interface MoneyFormat {
  /** BCP 47 locale. */
  locale: string
  /** ISO 4217 code. */
  currency: string
}

/** The platform default, for callers with no tenant in hand. */
export const DEFAULT_MONEY_FORMAT: MoneyFormat = { locale: "en-US", currency: "USD" }

/**
 * Format an integer minor-unit amount.
 *
 * The minor unit is not universally 1/100 of the major unit. JPY has none at
 * all, so a hardcoded divide-by-100 renders ¥1,200 as "¥12" — a hundredfold
 * error on a finance surface. KWD has three digits and is wrong in the other
 * direction. `Intl` knows the exponent for each currency, so this asks rather
 * than assumes.
 *
 * For en-US/USD the output is byte-identical to the hand-rolled formatter this
 * replaced, across positives, negatives, zero, sub-dollar amounts and millions —
 * checked before switching, because 36 call sites render money to people who
 * will notice.
 */
export function formatMoney(cents: number, format: MoneyFormat = DEFAULT_MONEY_FORMAT): string {
  const formatter = new Intl.NumberFormat(format.locale, {
    style: "currency",
    currency: format.currency,
  })
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2
  return formatter.format(cents / 10 ** digits)
}
