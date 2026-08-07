import {
  ROUNDING_MODES,
  fromMinorUnits,
  sum,
  toMinorUnits,
  type Money,
  type RoundingMode,
} from "./money"

/**
 * PAY-160-002 — what an option costs, per seat and for the whole organization.
 *
 * The Studio's composer had five stages and no price anywhere in it. A person
 * ticking twelve module checkboxes was assembling a commercial arrangement with
 * no idea what any of it cost, and the only price in the platform was
 * plan-grain and `null`. An option with no price does not read as "unpriced" on
 * a form — it reads as free.
 *
 * ## Two prices, not one
 *
 * Per seat and per organization are genuinely different and both are needed.
 * Messaging costs per person; a ledger costs per organization whether it has ten
 * officers or two hundred. Quoting only one of them means either a two-person
 * club is charged like a faculty or a faculty is charged like a two-person club,
 * and the operator composing the system cannot see which.
 *
 * ## Integer minor units, one currency
 *
 * Every figure is a whole number of minor units — cents for USD, yen for JPY —
 * and the arithmetic goes through `@tenure/finops`'s `Money`, so a quote mixing
 * currencies throws `CurrencyMismatchError` rather than adding dollars to euros
 * and producing a total that is wrong in a way that looks right.
 */

export interface OptionPrice {
  /** Per seat, per month, in whole minor units of `currency`. */
  perSeatMinor: number
  /** For the organization, per month, in whole minor units of `currency`. */
  perOrgMinor: number
  /** ISO 4217. */
  currency: string
  /**
   * How an extended figure that does not land on a minor unit is rounded.
   *
   * Stated on the price rather than chosen by the quoting code, because it is a
   * commercial term: whoever sets the price says whether a part-month or a
   * proration rounds in the customer's favour. `half-up` is what every priced
   * option below declares, and it is stated rather than defaulted.
   */
  rounding: RoundingMode
  /**
   * Why an option that costs nothing costs nothing.
   *
   * Zero is a commercial statement — it says Tenure gives this away — and it is
   * indistinguishable on a form from "nobody has priced this yet". So a price of
   * zero on both axes has to carry the reason, and `validateDefinition` in
   * `@tenure/configuration` refuses a configuration option that does not.
   *
   * Optional on the type rather than required, because the rule only bites where
   * both amounts are zero: a priced option has nothing to explain. The
   * enforcement therefore lives in the validator, which can see both amounts,
   * rather than in the type, which cannot.
   */
  includedBecause?: string
}

/**
 * A price of nothing, with the reason stated.
 *
 * The currency is the platform's list currency even though zero denominates
 * nothing in any of them: a line that costs nothing must not be the thing that
 * trips the mixed-currency check in a quote whose other lines are real.
 */
export function includedInPlan(because: string): OptionPrice {
  return { perSeatMinor: 0, perOrgMinor: 0, currency: "USD", rounding: "half-up", includedBecause: because }
}

/** An option that can appear on a quote — a module, a suite, a coexistence domain. */
export interface PricedOption {
  optionKey: string
  price: OptionPrice
}

export interface QuoteLine {
  optionKey: string
  perSeatMinor: number
  perOrgMinor: number
  /** perOrgMinor + perSeatMinor × seats. What this option adds to the total. */
  extendedMinor: number
}

export interface ConfigurationQuote {
  lines: readonly QuoteLine[]
  /** Σ extendedMinor, in whole minor units. The number the composer shows. */
  runningTotalMinor: number
  currency: string
  seatCount: number
}

export class PriceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PriceError"
  }
}

/**
 * Whether a price is usable, as a list of problems rather than a boolean.
 *
 * Exported because `validateManifest` in `@tenure/module-runtime` calls it: the
 * rule "a module without a usable price fails validation" belongs to the price
 * type, not to a second copy of the rule written beside the manifests.
 */
export function priceProblems(price: OptionPrice | undefined, where: string): string[] {
  const problems: string[] = []
  if (!price) {
    problems.push(
      `${where} declares no price. An option with no price is not free — it is unpriced, and on a ` +
        `composer that shows a running total the two are indistinguishable.`,
    )
    return problems
  }
  for (const [field, value] of [
    ["perSeatMinor", price.perSeatMinor],
    ["perOrgMinor", price.perOrgMinor],
  ] as const) {
    if (!Number.isInteger(value)) {
      problems.push(
        `${where} prices ${field} at ${value}, which is not a whole number of minor units. ` +
          `Fractions of a cent do not survive a total.`,
      )
    } else if (value < 0) {
      problems.push(
        `${where} prices ${field} at ${value}. A negative list price is a discount, which belongs ` +
          `on a contract rather than in the catalog every tenant is quoted from.`,
      )
    }
  }
  if (!/^[A-Z]{3}$/.test(price.currency ?? "")) {
    problems.push(`${where} prices in ${JSON.stringify(price.currency)}, which is not an ISO 4217 code.`)
  }
  if (!ROUNDING_MODES.includes(price.rounding)) {
    problems.push(
      `${where} declares rounding ${JSON.stringify(price.rounding)}; expected one of ` +
        `${ROUNDING_MODES.join(", ")}. How a part-period rounds is a commercial term and cannot be ` +
        `left to whoever renders it.`,
    )
  }
  return problems
}

/**
 * Price a whole configuration: every selected option, per seat and per org, and
 * the running total.
 *
 * Refuses an empty option set and refuses a fractional seat count. Both are the
 * same kind of refusal — a quote for nothing, or for two and a half people, is
 * a number somebody would put in front of a customer.
 */
export function quoteConfiguration(
  options: readonly PricedOption[],
  seatCount: number,
): ConfigurationQuote {
  if (!Number.isInteger(seatCount) || seatCount < 0) {
    throw new PriceError(
      `A quote needs a whole, non-negative seat count; got ${seatCount}. Per-seat pricing over a ` +
        `fraction of a person is not a price anyone can be invoiced for.`,
    )
  }

  const problems = options.flatMap((option) => priceProblems(option.price, `Option "${option.optionKey}"`))
  if (problems.length > 0) throw new PriceError(problems.join("\n"))

  if (options.length === 0) {
    // Nothing selected is a real state of the composer — the operator has not
    // ticked anything yet — and it costs nothing. The currency has to come from
    // somewhere, and the platform's is USD; a quote with lines never uses this.
    return { lines: [], runningTotalMinor: 0, currency: "USD", seatCount }
  }

  const currency = options[0].price.currency
  const lines: QuoteLine[] = []
  const extended: Money[] = []

  for (const option of options) {
    // Through Money, not through bare numbers: a mixed-currency option set
    // throws CurrencyMismatchError here rather than producing a total that adds
    // dollars to euros. Integer multiplication by a whole seat count is exact.
    const perOrg = fromMinorUnits(option.price.perOrgMinor, option.price.currency)
    const perSeatTotal = fromMinorUnits(option.price.perSeatMinor * seatCount, option.price.currency)
    const lineTotal = sum([perOrg, perSeatTotal], currency)
    extended.push(lineTotal)
    lines.push({
      optionKey: option.optionKey,
      perSeatMinor: option.price.perSeatMinor,
      perOrgMinor: option.price.perOrgMinor,
      extendedMinor: toMinorUnits(lineTotal, option.price.rounding),
    })
  }

  return {
    lines,
    runningTotalMinor: toMinorUnits(sum(extended, currency), options[0].price.rounding),
    currency,
    seatCount,
  }
}

/* ──────────────────────────────── the running total on a config surface ────── */

/**
 * Anything a configuration surface can put a price beside: a key and its price.
 *
 * Structural rather than `ConfigDefinition`, so this package does not import the
 * configuration engine and the dependency runs one way. `ConfigDefinition`
 * satisfies it by having a `key` and a `price`, checked by `tsc` where the
 * resolver passes them.
 */
export interface PricedConfigOption {
  readonly key: string
  readonly price: OptionPrice
}

export interface RunningTotalLine {
  key: string
  /** Per seat, per month. */
  perSeat: Money
  /** For the whole organization, per month. */
  organization: Money
  /** `perSeat × seats + organization`. */
  total: Money
  /** True when both amounts are zero. */
  included: boolean
  /** Why it is included at no charge, or null when it is charged. */
  includedBecause: string | null
}

export interface RunningTotal {
  /** The seat count this was computed for. Always stated, never implied. */
  seats: number
  currency: string
  /** Σ per-seat, across every selected option. */
  perSeat: Money
  /** Σ per-organization, across every selected option. */
  organization: Money
  /** `perSeat × seats + organization` — the running total NEXT-SESSION §7 asks for. */
  total: Money
  lines: readonly RunningTotalLine[]
}

/**
 * What a set of chosen configuration options costs, per seat AND for the whole
 * organization, with the running total.
 *
 * `quoteConfiguration` above answers the composer's question — what does each
 * option add — and deliberately returns only the extended figure per line.
 * NEXT-SESSION §7 asks for something it does not compute: the per-seat subtotal
 * and the organization subtotal ACROSS the selection, side by side, so a
 * customer can see both halves of what they are agreeing to rather than one
 * blended number.
 *
 * `seats` is required and echoed back. A running total whose seat count is
 * implicit is a number nobody can check, and "what does a seat cost" and "what
 * does this cost us" are different questions with different answers.
 */
export function runningTotal(
  selected: readonly PricedConfigOption[],
  seats: number,
): RunningTotal {
  if (!Number.isInteger(seats) || seats < 0) {
    throw new PriceError(
      `A running total needs a whole, non-negative seat count; got ${seats}. There is no ` +
        `fractional seat, and a quote for a negative one is a refund.`,
    )
  }

  const problems = selected.flatMap((option) =>
    priceProblems(option.price, `Configuration option "${option.key}"`),
  )
  if (problems.length > 0) throw new PriceError(problems.join("\n"))

  // The currency of the first option that actually charges. When nothing
  // charges, every figure below is exactly zero and the label denominates
  // nothing — USD is the platform's list currency and is used for the label
  // rather than left undefined, so the shape is the same either way.
  const currency =
    selected.find((option) => option.price.perSeatMinor > 0 || option.price.perOrgMinor > 0)
      ?.price.currency ?? "USD"

  const lines: RunningTotalLine[] = selected.map((option) => {
    // Through Money rather than bare integers: an option priced in another
    // currency throws CurrencyMismatchError in `sum` below rather than being
    // added into a total that is wrong in a way that looks right.
    const perSeat = fromMinorUnits(option.price.perSeatMinor, option.price.currency)
    const organization = fromMinorUnits(option.price.perOrgMinor, option.price.currency)
    const perSeatExtended = fromMinorUnits(
      option.price.perSeatMinor * seats,
      option.price.currency,
    )
    return {
      key: option.key,
      perSeat,
      organization,
      total: sum([perSeatExtended, organization], currency),
      included: option.price.perSeatMinor === 0 && option.price.perOrgMinor === 0,
      includedBecause: option.price.includedBecause ?? null,
    }
  })

  const perSeat = sum(
    lines.map((line) => line.perSeat),
    currency,
  )
  const organization = sum(
    lines.map((line) => line.organization),
    currency,
  )
  const total = sum(
    [fromMinorUnits(toMinorUnits(perSeat, "half-up") * seats, currency), organization],
    currency,
  )

  return { seats, currency, perSeat, organization, total, lines }
}

/* ─────────────────────────────────── the pre-activation disclosure ─────────── */

/**
 * The seven things that must be settled before a system is activated —
 * PAY-160-002, Bible §18.
 *
 * Each is either DECIDED, with the value and where the decision is recorded, or
 * UNDECIDED, naming what would record it. There is deliberately no third state
 * and no default: a panel that renders "Merchant of record: Tenure" because a
 * field was blank has made a legal claim on the platform's behalf.
 *
 * This is why the panel is worth building before any of those decisions exist.
 * It is the surface that says, in one place, that they do not — and it refuses
 * to call the configuration ready for activation while any of them is open.
 */
export const DISCLOSURE_TOPICS = [
  "legal-merchant",
  "funds-flow",
  "fees",
  "loss-responsibility",
  "tax",
  "settlement",
  "ledger-preview",
] as const

export type DisclosureTopic = (typeof DISCLOSURE_TOPICS)[number]

export type Disclosure =
  | { topic: DisclosureTopic; label: string; state: "DECIDED"; statement: string; recordedIn: string }
  | { topic: DisclosureTopic; label: string; state: "UNDECIDED"; statement: string; wouldRecordIt: string }

export interface ActivationPreview {
  quote: ConfigurationQuote
  disclosures: readonly Disclosure[]
  /** True only when every topic is DECIDED. Never true by default. */
  readyToActivate: boolean
  /** The topics still open, so the refusal names them rather than being a flag. */
  openTopics: readonly DisclosureTopic[]
}

const DISCLOSURE_LABEL: Record<DisclosureTopic, string> = {
  "legal-merchant": "Legal merchant of record",
  "funds-flow": "Funds flow",
  fees: "Fees",
  "loss-responsibility": "Loss, refund and dispute responsibility",
  tax: "Tax",
  settlement: "Settlement",
  "ledger-preview": "Ledger preview",
}

/**
 * The activation preview for a composed configuration.
 *
 * The ledger preview is DECIDED and real: it is the quote above, which is
 * exactly what would be posted, line by line, if this configuration were
 * activated today. The other six are UNDECIDED, and each names the ADR whose
 * absence is the reason — those are recorded as open in
 * `docs/implementation/payments-treasury-execution-ledger.md` and are decisions
 * for a person, not for this function.
 *
 * When one of them is settled, the arm changes here and every surface that
 * renders a preview shows it. Nothing renders a topic it was not given.
 */
export function activationPreview(
  options: readonly PricedOption[],
  seatCount: number,
): ActivationPreview {
  const quote = quoteConfiguration(options, seatCount)

  const disclosures: Disclosure[] = [
    {
      topic: "ledger-preview",
      label: DISCLOSURE_LABEL["ledger-preview"],
      state: "DECIDED",
      statement:
        `${quote.lines.length} recurring monthly charge line(s) in ${quote.currency}, ` +
        `${quote.runningTotalMinor} minor units in total at ${quote.seatCount} seat(s). ` +
        `Every line is per-organization plus per-seat, in whole minor units, with no proration applied.`,
      recordedIn: "the module catalog — modules/index.ts, one `price` per option",
    },
    ...(
      [
        [
          "legal-merchant",
          "No merchant of record has been approved for this platform, so nothing here can state who is legally selling to this tenant.",
          "PAY-000-002 — an ADR recording the approved merchant-of-record default and its exception paths",
        ],
        [
          "funds-flow",
          "No funds flow is selected. Direct charges, destination charges and separate charges-and-transfers put the money in different places and make different parties liable, and no default has been approved.",
          "PAY-070-002 — the eligible-merchant default and the responsibility decisions it depends on",
        ],
        [
          "fees",
          "The charge lines above are Tenure's list price for the configuration. No processing, interchange or platform fee schedule is connected, so what a payment costs to take is unstated.",
          "PAY-000-003 — an ADR recording the fee-payer selection algorithm",
        ],
        [
          "loss-responsibility",
          "Who bears a refund, a dispute, a negative balance or a fraud loss is unassigned.",
          "PAY-040-002 — the responsibility matrix covering merchant display, fee payer, losses, refunds, disputes and support",
        ],
        [
          "tax",
          "No tax treatment, registration or jurisdiction scope is declared for these charges.",
          "PAY-000-005 — the legal review gate for every new country and account configuration",
        ],
        [
          "settlement",
          "No settlement schedule, payout account or reconciliation cadence is configured; nothing here can say when money would arrive or where.",
          "PAY-130-003 — gross, fees, refunds, disputes, transfers, payouts, FX and net settlement, reconciled against a connected provider",
        ],
      ] as const
    ).map(
      ([topic, statement, wouldRecordIt]): Disclosure => ({
        topic,
        label: DISCLOSURE_LABEL[topic],
        state: "UNDECIDED",
        statement,
        wouldRecordIt,
      }),
    ),
  ]

  const openTopics = disclosures
    .filter((d): d is Extract<Disclosure, { state: "UNDECIDED" }> => d.state === "UNDECIDED")
    .map((d) => d.topic)

  return { quote, disclosures, readyToActivate: openTopics.length === 0, openTopics }
}
