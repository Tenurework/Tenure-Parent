/**
 * The rates a quote is built from — the fourth answer on `/platform/cost`.
 *
 * ── Why this is on the FinOps Center and not somewhere else ────────────────
 *
 * The standing product requirement is that every configuration option carries a
 * price tag — per seat and for the whole organisation — with a running total, so
 * cost is known before the decision rather than after the invoice. A quote is
 * only worth having if the RATES underneath it are real, and the catalogue's
 * rates are transcribed: right on the day somebody typed them and wrong from the
 * next AWS price change onward, with nothing in the product able to say which
 * day it is.
 *
 * `lib/aws/pricing.ts` reads the published on-demand rates for the shapes this
 * estate actually provisions. This module turns that reading into the rows and
 * the total the page renders, and it is separate from the markup for the reason
 * `cost-decisions.ts` is: the rules below are the part that can be wrong in a way
 * nobody sees, and a rule is only checkable when it can be called without a
 * browser.
 *
 * ── The money rules, which are the whole point ─────────────────────────────
 *
 *   1. **Integer minor units, explicit currency, never a float.** Every amount
 *      here is a `Money` from `@tenure/finops`, and the arithmetic is
 *      `extendRate` and `add` — both integer. The currency is read off the
 *      Price List response and travels with the amount; nothing here defaults to
 *      USD, because the China partition publishes CNY and a total that adds
 *      dollars to yuan is wrong in a way that looks right.
 *
 *   2. **A rate that could not be resolved is UNKNOWN, and it propagates.** A
 *      total that quietly leaves out an unpriced shape has priced it at zero,
 *      and quoting an unpriced item as free is precisely the cost surprise the
 *      requirement exists to prevent. So `standingMonthly` returns an amount
 *      only when EVERY shape in the reading resolved: one denial, one throttle,
 *      one ambiguous SKU and the total is `known: false` with the shapes that
 *      caused it named. There is no arm carrying a partial sum, because a
 *      partial sum rendered beside the word "total" is read as a total.
 *
 *   3. **A published rate is never rendered at the currency's display
 *      precision.** A Fargate vCPU-hour is $0.0000166667 on some price lists,
 *      and `$0.00` is how a real charge becomes "free" on a screen. The rate
 *      cells therefore print AWS's own published decimal and carry the exact
 *      integer — `Money.units`, at 10^-6 minor units — in the title. The
 *      currency-precision formatter is used only where a figure is genuinely at
 *      that scale: the monthly extension.
 *
 *   4. **No quantity is invented.** A monthly figure exists only for a rate
 *      whose unit is an hour, where the quantity is one unit for
 *      `HOURS_PER_MONTH` hours and both halves are stated on the page. A
 *      per-request or per-GB rate gets no monthly figure at all — its monthly
 *      cost is a function of volume this surface does not know, and inventing a
 *      volume is inventing the answer.
 *
 * Quoting only. Nothing on this path moves money, provisions anything or writes
 * to AWS; `pricing.ts` reads the public Price List and this module does
 * arithmetic on what it read.
 *
 * ── What this module may import ────────────────────────────────────────────
 *
 * `@tenure/finops` and `lib/aws/pricing`, at runtime, plus `lib/aws/read` for
 * the union's one renderer. `pricing.ts` reaches the SDK only through
 * `liveGateway()`'s dynamic `import("./client")`, so nothing here pulls the AWS
 * SDK or `server-only` into a test process — which is what lets
 * `cost-rates.test.tsx` run in apps/web's jest with no server, no browser and no
 * credentials — it renders the panel there too, through
 * `renderToStaticMarkup`. Imports are relative for the reason `CostReportView.tsx` gives:
 * apps/web's jest maps `@/` to its own `src`.
 */

import {
  approvalFor,
  add,
  zero,
  type ApprovalLevel,
  type Money,
  type RoundingMode,
  SCALE,
} from "@tenure/finops"

import type { BadgeTone, UnknownRead } from "../../../components/md3"
import {
  describeShapeRate,
  extendRate,
  SHAPES,
  type PricingReadings,
  type Rate,
  type ShapeKey,
  type ShapeReading,
} from "../../../lib/aws/pricing"
import { describeRead } from "../../../lib/aws/read"

import { formatAmount, minorUnits, unknownArm } from "./cost-decisions"

/* ------------------------------------------------------------ the clock -- */

/**
 * The hours in a month a standing hourly rate is extended over.
 *
 * 730, which is 8,760 / 12 — AWS's own convention in its published pricing and
 * in its calculator, so the figure here and the figure an operator gets from
 * AWS for the same shape are the same figure. It is a named constant on the
 * page as well as in this file: a monthly cost is a rate times a quantity, and a
 * page that shows the product while hiding the quantity is showing an opinion.
 *
 * It is deliberately NOT the length of the current month. A quote that is 3%
 * larger in March than in February is a quote whose variation carries no
 * information, and the approval bands below are policy constants that were not
 * chosen per-month either.
 */
export const HOURS_PER_MONTH = 730

/**
 * How the monthly extension drops precision.
 *
 * `half-up` rather than `down`. `@tenure/finops` has no ceiling mode, and of the
 * four it has, truncation is the one that can only ever understate a
 * commitment — which is the direction that gets a change approved under a band
 * it should have been over. The residue either way is below 10^-6 of a minor
 * unit, so this is a statement of intent as much as an arithmetic difference,
 * and stating it is the requirement: a default rounding mode is `Math.round`
 * wearing a name.
 */
export const MONTHLY_ROUNDING: RoundingMode = "half-up"

/**
 * Units whose quantity is a span of time, so that one unit for one month is a
 * quantity this engine knows rather than one it would have to invent.
 *
 * Matches AWS's own vocabulary: `Hrs`, `Hours`, `vCPU-Hours`, `GB-Hours`,
 * `LCU-Hrs`. It deliberately does not match `GB-Mo`, `Requests` or `Messages` —
 * see rule 4 in the header.
 */
const HOURLY_UNIT = /(^|[-\s])h(ou)?rs?$/i

export function isHourly(unit: string): boolean {
  return HOURLY_UNIT.test(unit.trim())
}

/* ----------------------------------------------------------- the figures -- */

/**
 * One figure in a cell, with the exact integers behind it.
 *
 * `known: false` is a real arm and not an empty string: a blank money cell beside
 * a resource name is read as zero, and zero is the one thing an unresolved rate
 * must never look like. The text of an unknown figure is the word `Unknown`, and
 * the title says what would resolve it.
 */
export interface RateFigure {
  text: string
  /** The whole truth, for the cell's `title`. Never empty. */
  title: string
  known: boolean
}

/**
 * The exact integer behind an amount, at the scale it is actually held.
 *
 * NOT `minorUnits()` for a unit rate. That helper rounds to whole minor units,
 * which is right for a monthly figure and catastrophic for a per-request rate: a
 * price of 0.0000004 USD rendered as "0 minor units of USD" is a real charge
 * displayed as nothing, in the field whose whole job is to prove there is no
 * float in the number.
 */
export function exactUnits(amount: Money): string {
  return `${amount.units} × 10^-${SCALE} minor units of ${amount.currency}`
}

/** How a rate's denominator reads: "Hrs", or "1000000 Requests". */
export function perUnit(rate: Rate): string {
  return rate.perQuantity === 1 ? rate.unit : `${rate.perQuantity} ${rate.unit}`
}

/**
 * A published unit rate, at AWS's own precision.
 *
 * The published decimal is the text, not `formatAmount`. See rule 3: a rate
 * finer than the currency's minor unit — which most metered AWS rates are —
 * formats to `$0.00`, and a real charge shown as $0.00 is worse than no figure
 * at all, because it is a claim.
 */
export function unitFigure(rate: Rate): RateFigure {
  const per = perUnit(rate)
  if (rate.free) {
    return {
      text: `no charge, per ${per}`,
      title:
        `AWS publishes ${rate.publishedDecimal} ${rate.currency} for this dimension. That is a ` +
        `commercial statement — a free tier — and it is a different fact from a rate this engine ` +
        `could not read, which renders as Unknown.`,
      known: true,
    }
  }
  return {
    text: `${rate.publishedDecimal} ${rate.currency} per ${per}`,
    title:
      `${exactUnits(rate.amount)} per ${per}, published as ${rate.publishedDecimal}. Held as an ` +
      `integer end to end: the decimal string is shifted with BigInt digit arithmetic, never parsed ` +
      `into a float.`,
    known: true,
  }
}

/**
 * What one unit of a shape costs for a month, or why that question has no
 * answer for it.
 *
 * The arms are the four the page has to keep apart. `not-timed` is not a
 * failure — a rate per request is perfectly well known, and its monthly cost
 * simply depends on a volume this surface does not have.
 */
export type MonthlyExtension =
  | { kind: "amount"; amount: Money; rate: Rate }
  | { kind: "not-timed"; why: string }
  | { kind: "needs-quantity"; why: string }
  | { kind: "unknown"; why: string }

export function monthlyFor(reading: ShapeReading): MonthlyExtension {
  const rate = reading.rate
  switch (rate.kind) {
    case "flat":
      if (!isHourly(rate.rate.unit)) {
        return {
          kind: "not-timed",
          why:
            `priced per ${perUnit(rate.rate)}, so a monthly figure is a function of volume. This ` +
            `engine will not invent a volume: the quantity belongs to the plan being quoted.`,
        }
      }
      return {
        kind: "amount",
        rate: rate.rate,
        amount: extendRate(rate.rate, HOURS_PER_MONTH, MONTHLY_ROUNDING),
      }
    case "tiered": {
      const timed = rate.tiers.some((tier) => isHourly(tier.rate.unit))
      return timed
        ? {
            kind: "needs-quantity",
            why:
              `published as ${rate.tiers.length} time tiers, and which tier applies depends on how ` +
              `much is bought. Quoting the first tier for a whole month would be quoting the ` +
              `cheapest one.`,
          }
        : {
            kind: "not-timed",
            why:
              `published as ${rate.tiers.length} volume tiers, so a monthly figure is a function of ` +
              `volume. The ladder is beside this cell; the quantity belongs to the plan.`,
          }
    }
    case "ambiguous":
      return {
        kind: "unknown",
        why: `several published rates match this shape, and this engine will not pick one: ${rate.why}`,
      }
    case "unknown":
      return { kind: "unknown", why: rate.why }
  }
}

/* -------------------------------------------------------------- the rows -- */

export interface RateRow {
  key: ShapeKey
  /** What the shape is, in the operator's language, from the reader's own spec. */
  reads: string
  /** The region the price was asked for, or why there is none. Never blank. */
  where: string
  /** One word for the rate's kind. Never a tick and never blank. */
  status: string
  tone: BadgeTone
  unit: RateFigure
  monthly: RateFigure
  /** The SKU, rate code and effective date, so a disputed figure can be traced. */
  evidence: string
}

export function rateRows(readings: PricingReadings): readonly RateRow[] {
  return readings.shapes.map((reading) => ({
    key: reading.shape,
    reads: SHAPES[reading.shape].reads,
    where: reading.query.regionCode
      ? `region ${reading.query.regionCode}`
      : reading.query.regionProvenance,
    ...statusOf(reading),
    unit: unitFigureOf(reading),
    monthly: monthlyFigure(monthlyFor(reading)),
    evidence: evidenceFor(reading),
  }))
}

function statusOf(reading: ShapeReading): { status: string; tone: BadgeTone } {
  switch (reading.rate.kind) {
    case "flat":
      return { status: "priced", tone: "ok" }
    case "tiered":
      return { status: "tiered", tone: "ok" }
    case "ambiguous":
      return { status: "ambiguous", tone: "warn" }
    case "unknown":
      return { status: "unknown", tone: "warn" }
  }
}

/**
 * Where a row's figure came from: the SKU, the rate code, the effective date and
 * the state of the read that produced it.
 *
 * `describeShapeRate` is the reader's own funnel and it is used here only for
 * the two arms that carry no amount — because for the arms that DO, it prints
 * the rate through the currency's display precision, and `0.00 USD (0 minor
 * units of USD)` beside a real sub-cent charge is precisely the rendering this
 * surface refuses. The provenance half still goes through `describeRead`, so a
 * denial is worded here exactly as it is on every other surface.
 */
function evidenceFor(reading: ShapeReading): string {
  const provenance = `${describeRead(reading.products, `${reading.query.serviceCode} products`)}${
    reading.truncated ? " · TRUNCATED: more pages existed than this engine reads" : ""
  }`
  const rate = reading.rate

  switch (rate.kind) {
    case "flat":
      return (
        `${rate.rate.publishedDecimal} ${rate.rate.currency} per ${perUnit(rate.rate)} — ` +
        `${exactUnits(rate.rate.amount)}. ${rate.description} (SKU ${rate.sku}, rate ` +
        `${rate.rateCode}${rate.effectiveDate ? `, effective ${rate.effectiveDate}` : ""}) · ${provenance}`
      )
    case "tiered":
      return (
        `${rate.tiers.length} published tier(s) — ` +
        `${rate.tiers
          .map((tier) => {
            const upper = tier.toUnits === null ? "and above" : `to ${tier.toUnits}`
            return `${tier.fromUnits} ${upper}: ${tier.rate.publishedDecimal} ${tier.rate.currency} per ${perUnit(tier.rate)}`
          })
          .join(" · ")} (SKU ${rate.sku}${
          rate.effectiveDate ? `, effective ${rate.effectiveDate}` : ""
        }) · ${provenance}`
      )
    case "ambiguous":
    case "unknown":
      return `${describeShapeRate(rate)} · ${provenance}`
  }
}

function unitFigureOf(reading: ShapeReading): RateFigure {
  const rate = reading.rate
  switch (rate.kind) {
    case "flat":
      return unitFigure(rate.rate)
    case "tiered": {
      const first = rate.tiers[0]
      if (!first) {
        return {
          text: "Unknown",
          title: "AWS published a tiered price with no tiers in it, so there is no rate to show.",
          known: false,
        }
      }
      const ladder = rate.tiers
        .map((tier) => {
          const upper = tier.toUnits === null ? "and above" : `to ${tier.toUnits}`
          return `${tier.fromUnits} ${upper}: ${tier.rate.publishedDecimal} ${tier.rate.currency}`
        })
        .join(" · ")
      return {
        text: `${rate.tiers.length} tiers, from ${first.rate.publishedDecimal} ${first.rate.currency} per ${perUnit(first.rate)}`,
        title: `${ladder}. Each tier's amount is an integer: ${rate.tiers
          .map((tier) => exactUnits(tier.rate.amount))
          .join(" · ")}`,
        known: true,
      }
    }
    case "ambiguous":
      return {
        text: "Unknown",
        title: `${rate.why} Candidates: ${rate.candidates.join(" | ")}`,
        known: false,
      }
    case "unknown":
      return { text: "Unknown", title: rate.why, known: false }
  }
}

function monthlyFigure(monthly: MonthlyExtension): RateFigure {
  switch (monthly.kind) {
    case "amount":
      return {
        text: formatAmount(monthly.amount),
        title:
          `${minorUnits(monthly.amount)} — exactly ${exactUnits(monthly.amount)}. One unit at ` +
          `${monthly.rate.publishedDecimal} ${monthly.rate.currency} per ${perUnit(monthly.rate)}, ` +
          `for ${HOURS_PER_MONTH} hours, rounded ${MONTHLY_ROUNDING}.`,
        known: true,
      }
    case "not-timed":
    case "needs-quantity":
      // NOT the word Unknown, and not a blank. The rate is known; a monthly
      // figure for it is a different question, and conflating the two would
      // make a perfectly readable price look like a failed read.
      return { text: "depends on volume", title: monthly.why, known: true }
    case "unknown":
      return { text: "Unknown", title: monthly.why, known: false }
  }
}

/* ------------------------------------------------------------- the total -- */

/** One shape left out of the standing total, and the stated reason. */
export interface ExcludedShape {
  shape: ShapeKey
  why: string
}

/**
 * The running total, or the fact that there is not one.
 *
 * There is deliberately no arm carrying an amount AND a list of things missing
 * from it. A figure printed under the word "total" is read as the total, however
 * carefully the caveat beside it is worded, and the requirement this page serves
 * exists because an unpriced line item silently costed at zero is how a
 * commitment gets approved for less than it costs.
 */
export type StandingMonthly =
  | {
      known: true
      amount: Money
      currency: string
      /** The shapes summed, so the composition of the figure is on the page. */
      included: readonly ShapeKey[]
      /** The shapes not summed, each with why. Never silently dropped. */
      excluded: readonly ExcludedShape[]
      approval: ApprovalLevel | null
      approvalDetail: string
    }
  | {
      known: false
      why: string
      /** What made it unknown. Named, so the gap is closable. */
      missing: readonly ShapeKey[]
      excluded: readonly ExcludedShape[]
    }

/**
 * What one unit of every hourly shape this estate provisions costs for a month,
 * added up.
 *
 * The quantity is stated rather than implied: ONE unit of each, for
 * `HOURS_PER_MONTH` hours. It is not a forecast of the fleet's bill — the fleet
 * runs many units of some shapes and none of others, and what it actually spent
 * is the month-to-date answer at the top of this page. It is the running total
 * of the RATES a quote is built from, which is the figure the approval bands are
 * assessed against.
 *
 * A shape whose rate did not resolve makes the whole total unknown, including
 * when that shape is one the total would have excluded anyway. That is not
 * pedantry: whether an unresolved rate is hourly is itself unknown, so leaving
 * it out is an assumption that it would not have counted — which is the same
 * assumption as pricing it at zero.
 */
export function standingMonthly(readings: PricingReadings): StandingMonthly {
  const included: ShapeKey[] = []
  const excluded: ExcludedShape[] = []
  const missing: ShapeKey[] = []
  const amounts: Money[] = []

  for (const reading of readings.shapes) {
    const monthly = monthlyFor(reading)
    switch (monthly.kind) {
      case "amount":
        included.push(reading.shape)
        amounts.push(monthly.amount)
        break
      case "not-timed":
        excluded.push({ shape: reading.shape, why: monthly.why })
        break
      case "needs-quantity":
      case "unknown":
        missing.push(reading.shape)
        break
    }
  }

  if (missing.length > 0) {
    return {
      known: false,
      missing,
      excluded,
      why:
        `${missing.length} of ${readings.shapes.length} shape(s) have no resolved rate — ` +
        `${missing.join(", ")}. The total is reported unknown rather than summed without them: a ` +
        `sum that leaves out an unpriced shape has priced it at zero, and an item quoted as free is ` +
        `exactly the surprise a price tag exists to prevent.`,
    }
  }

  // A currency is read off each price list, never assumed. Two currencies do not
  // add, and `@tenure/finops` throws rather than coercing — checked here so the
  // page reports it instead of the throw becoming a 500 on the whole route.
  const currencies = [...new Set(amounts.map((amount) => amount.currency))].sort()
  if (currencies.length > 1) {
    return {
      known: false,
      missing: [],
      excluded,
      why:
        `the resolved rates are published in ${currencies.join(" and ")}. A total across currencies ` +
        `is not a total; it needs a conversion rate and a date, and neither is this engine's to ` +
        `invent.`,
    }
  }

  if (included.length === 0) {
    return {
      known: false,
      missing: [],
      excluded,
      why:
        `not one of the ${readings.shapes.length} shape(s) read is priced by the hour, so there is ` +
        `no standing monthly figure to state. Each shape's own rate is in the table.`,
    }
  }

  const currency = currencies[0]
  const amount = amounts.reduce((running, next) => add(running, next), zero(currency))

  /*
   * The approval bands are USD constants in `@tenure/finops`. Handing them a CNY
   * amount would compare a number of fen against a threshold of cents and land
   * the commitment in the wrong band, so the verdict is stated only in the
   * currency the policy is written in — and its absence is said out loud rather
   * than rendering as "none required".
   */
  const assessable = currency === "USD"
  const decision = assessable
    ? approvalFor({
        change: `One unit of each hourly shape this estate provisions, for ${HOURS_PER_MONTH} hours`,
        estimated: amount,
      })
    : null

  return {
    known: true,
    amount,
    currency,
    included,
    excluded,
    approval: decision?.level ?? null,
    approvalDetail: decision
      ? decision.detail
      : `The approval bands on this page are denominated in USD and these rates are published in ` +
        `${currency}. This engine will not compare them: a threshold of cents applied to an amount ` +
        `of another currency's minor units lands a commitment in the wrong band.`,
  }
}

/**
 * What each approval verdict is called, in the operator's language.
 *
 * `@tenure/finops` speaks in `TWO_PERSON`; a page does not. The wording is
 * deliberately not identical to the approval-band table's own cells further down
 * the page: that table is the policy, this is the policy read against one
 * figure, and two identical phrases in two places invite a reader to think one
 * is quoting the other.
 */
const APPROVAL_WORD: Readonly<Record<ApprovalLevel, string>> = {
  NONE: "no approval gate at this figure",
  PEER: "one reviewer",
  TWO_PERSON: "two approvers, and neither may be the requester",
  EXECUTIVE: "an executive decision, not an engineering one",
}

export function approvalWord(level: ApprovalLevel | null): string {
  return level === null ? "not assessed" : APPROVAL_WORD[level]
}

/* ------------------------------------------------------------ the answer -- */

export interface RatesAnswer {
  headline: string
  badge: string
  tone: BadgeTone
  priced: number
  unresolved: number
  total: number
}

/**
 * The sentence the panel leads with.
 *
 * It never opens with the total. A page that leads with a figure and mentions
 * further down that four of its inputs are missing has already been read.
 */
export function ratesAnswer(readings: PricingReadings, standing: StandingMonthly): RatesAnswer {
  const total = readings.shapes.length
  const unresolved = readings.shapes.filter(
    (reading) => reading.rate.kind === "unknown" || reading.rate.kind === "ambiguous",
  ).length
  const priced = total - unresolved

  if (total === 0) {
    return {
      headline:
        "No shape was priced on this page load, so nothing here is grounded in a published rate.",
      badge: "nothing read",
      tone: "warn",
      priced: 0,
      unresolved: 0,
      total: 0,
    }
  }

  if (unresolved > 0) {
    return {
      headline:
        `${priced} of ${total} shape(s) this estate provisions have a rate from AWS's own published ` +
        `price list; ${unresolved} do not, and no total is stated while any of them is unpriced. ` +
        `An unpriced item silently costed at zero is the cost surprise a price tag exists to prevent.`,
      badge: `${unresolved} unpriced`,
      tone: "warn",
      priced,
      unresolved,
      total,
    }
  }

  return {
    headline: standing.known
      ? `All ${total} shape(s) are priced from AWS's own published list. One unit of each hourly ` +
        `shape costs ${formatAmount(standing.amount)} for ${HOURS_PER_MONTH} hours — the rate a ` +
        `quote is built from, not what the fleet is running.`
      : `All ${total} shape(s) are priced from AWS's own published list, and no standing monthly ` +
        `total is stated: ${standing.why}`,
    badge: standing.known ? "priced" : "priced, no total",
    tone: standing.known ? "ok" : "warn",
    priced,
    unresolved,
    total,
  }
}

/* ---------------------------------------------------- the refusals, once -- */

/**
 * The failed reads, grouped so the panel renders one refusal per distinct
 * failure rather than fourteen copies of it.
 *
 * STUDIO-000-007 requires that a read this engine could not perform renders
 * through `UnknownState` — with the principal, the action and a pasteable
 * minimum IAM statement — and never as an empty list. Fourteen identical
 * denials would satisfy the letter of that and defeat its purpose: a page of
 * repeated panels is a page nobody reads to the end. Grouping is by the arm and
 * the capability, which is exactly what the remedy depends on; the shapes that
 * share it are named in `what`, so no shape's failure disappears into a summary.
 */
export interface UnknownGroup {
  key: string
  what: string
  read: UnknownRead
  shapes: readonly ShapeKey[]
}

export function unknownGroups(readings: PricingReadings): readonly UnknownGroup[] {
  const groups = new Map<string, { read: UnknownRead; shapes: ShapeKey[] }>()

  for (const reading of readings.shapes) {
    const arm = unknownArm(reading.products)
    if (!arm) continue
    // The reason, not just the arm: two shapes UNCONFIGURED for different
    // reasons need different remedies, and folding them would print one of the
    // two sentences and lose the other.
    const reason = arm.state === "UNCONFIGURED" ? arm.why : arm.state === "ERROR" ? arm.code : ""
    const key = `${arm.state}|${arm.capability}|${reason}`
    const existing = groups.get(key)
    if (existing) existing.shapes.push(reading.shape)
    else groups.set(key, { read: arm, shapes: [reading.shape] })
  }

  return [...groups.entries()]
    .map(([key, group]) => ({
      key,
      read: group.read,
      shapes: group.shapes,
      what:
        group.shapes.length === 1
          ? `the published rate for ${group.shapes[0]}`
          : `the published rates for ${group.shapes.length} shapes — ${group.shapes.join(", ")}`,
    }))
    // Stable, so two renders of the same reading order the panels identically.
    .sort((left, right) => left.key.localeCompare(right.key))
}

/* ------------------------------------------------- what is NOT here, and why -- */

/*
 * There is no per-seat figure on this module, and its absence is deliberate.
 *
 * The standing requirement asks for a price tag per seat AND for the whole
 * organisation. A per-seat figure is an organisation figure divided by a seat
 * count, and this surface has no seat count: `/platform/cost` describes the
 * fleet's estate, not one tenant's plan. Dividing by a number nobody supplied
 * would be inventing the denominator, which is the same class of defect as
 * inventing the rate — and it is the defect this page exists to refuse.
 *
 * What this module owes the composer is the half it can be authoritative about:
 * the GROUNDED unit rate and the integer arithmetic that extends it. The seat
 * count belongs to the plan being quoted, and the per-seat division belongs
 * beside it.
 */
