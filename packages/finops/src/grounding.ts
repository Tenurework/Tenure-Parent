import {
  add,
  fromMinorUnits,
  money,
  roundToInteger,
  subtract,
  sum,
  toDecimal,
  toMinorUnits,
  type Money,
  type RoundingMode,
} from "./money"
import { PriceError, type OptionPrice } from "./pricing"

/**
 * STUDIO-070-004 / PAY-160-002 — a tenant's shape, priced from AWS's own
 * published rates rather than from a table somebody typed.
 *
 * ## The requirement this closes, and the one it does not
 *
 * The standing product requirement is that EVERY configuration option, at every
 * stage where a tenant is set up, carries a price — per seat AND for the whole
 * organisation — with a running total, so the tenant knows what they are
 * agreeing to while they are still agreeing to it. `pricing.ts` next door
 * already computes that total. What it computes it FROM is
 * `OptionPrice.perSeatMinor` and `perOrgMinor`, and those are transcribed: right
 * on the day they were typed and wrong from the next AWS price change onwards,
 * with nothing in the product able to say which day it is.
 *
 * This module is the half that grounds them. It takes RESOLVED RATES as input —
 * it does not fetch them, and it deliberately cannot: the fetch is
 * `apps/system-studio/src/lib/aws/pricing.ts`, an app, and an app may not be
 * imported by a package. The dependency runs one way and this is the end it runs
 * from. What travels between them is a structural type, `ResolvedShapeRate`
 * below, which the reader's own `ShapeRate` satisfies without either side
 * importing the other.
 *
 * ## An unresolved rate is UNKNOWN, and UNKNOWN propagates
 *
 * This is the whole point and everything else here is in service of it. A
 * composer that shows a running total while one of its inputs is unpriced has
 * quoted the customer a number that is too low, and the customer finds out at
 * the first invoice. That is the exact cost surprise the per-option price tag
 * exists to prevent, so producing one has to be impossible rather than
 * discouraged:
 *
 *   * `GroundedCost` has three arms and only `COMPLETE` carries a total. There
 *     is no arm with an optional total, no arm with a zero stand-in and no
 *     function here that returns a total from a partial set. A surface that
 *     wants a number must narrow first, which is the same mechanism `AwsRead`
 *     uses in the Studio and `ShapeRate` uses one level below this.
 *   * `INCOMPLETE` carries the lines that DID price, because an operator needs
 *     to see which component is missing — but it carries no aggregate of them.
 *     A partial subtotal is a total that will be read as one.
 *   * `toOptionPrice` takes `CompleteGroundedCost`, not `GroundedCost`. An
 *     incomplete cost cannot become a price tag; it does not type-check.
 *
 * A component whose rate is missing from the rate table is treated exactly like
 * one whose rate came back `unknown`. "Nobody asked" and "we asked and there is
 * no answer" are both "this is unpriced", and neither is zero.
 *
 * ## Money is integer minor units, and the rounding is the caller's
 *
 * Every amount is a `Money` — an integer count of 10^-SCALE minor units with its
 * currency attached — and every figure that leaves this module as a bare number
 * is a whole count of minor units produced by `toMinorUnits` under a
 * `RoundingMode` the caller stated. There is no default rounding here for the
 * reason `money.ts` gives: a default is `Math.round` wearing a name. The mode is
 * echoed on every arm of the result so the figure on the screen can say how it
 * was rounded.
 *
 * Rates in two different currencies do not add. That is a third arm,
 * `MIXED_CURRENCY`, rather than a thrown `CurrencyMismatchError`, because it is
 * a real thing a partition boundary can produce — the China partition publishes
 * CNY — and a page that throws is a page that shows nothing at all.
 *
 * ## Quoting only
 *
 * Nothing here moves money and nothing here may. This module imports `./money`
 * and `./pricing` and nothing else: no gateway, no settlement, no ledger write,
 * no `@tenure/payments`. Multiplying a published rate by a number of hours is
 * arithmetic, not a transaction, and this file must never become the place one
 * starts.
 */

/* ─────────────────────────────────────────────────── the shape vocabulary ── */

/**
 * The billable meters a Tenure tenant's infrastructure actually turns.
 *
 * A closed union, and the same fourteen the Studio's Price List adapter reads.
 * The vocabulary is declared HERE rather than imported from there because the
 * dependency runs one way — but the two lists are the same list, and a component
 * this package cannot name is one the reader cannot price.
 *
 * Closed rather than an open string for the reason `ShapeKey` is closed: a
 * component key a caller invents is a line on a quote that nothing can resolve a
 * rate for, and it would arrive as "unpriced" when what actually happened is
 * that somebody typed a meter that does not exist.
 */
export type InfrastructureComponent =
  | "alb-hour"
  | "alb-lcu-hour"
  | "cloudfront-data-transfer-out"
  | "cloudfront-requests"
  | "dynamodb-read-request-units"
  | "dynamodb-write-request-units"
  | "elasticache-node-hour"
  | "fargate-gb-hour"
  | "fargate-vcpu-hour"
  | "rds-instance-hour"
  | "s3-requests"
  | "s3-storage"
  | "ses-outbound-message"
  | "sqs-requests"

/** Sorted, so two renderings of the same shape list its components identically. */
export const INFRASTRUCTURE_COMPONENTS: readonly InfrastructureComponent[] = [
  "alb-hour",
  "alb-lcu-hour",
  "cloudfront-data-transfer-out",
  "cloudfront-requests",
  "dynamodb-read-request-units",
  "dynamodb-write-request-units",
  "elasticache-node-hour",
  "fargate-gb-hour",
  "fargate-vcpu-hour",
  "rds-instance-hour",
  "s3-requests",
  "s3-storage",
  "ses-outbound-message",
  "sqs-requests",
]

/* ───────────────────────────────────────────────────── the resolved rates ── */

/**
 * One published rate, as this module needs it.
 *
 * Structurally a subset of the Studio reader's `Rate`, so a `Rate` is assignable
 * to this without a cast and without either module importing the other. The
 * fields it drops — `publishedDecimal`, `free` — are for rendering and for
 * telling "AWS gives this away" apart from "we could not read it", and neither
 * is arithmetic.
 *
 * `perQuantity` is required and is not decorative. A rate finer than `Money`
 * holds exactly is published by the reader as an amount per 10 or per 100 units
 * rather than truncated to zero, and a caller that ignores the field is wrong by
 * a power of ten.
 */
export interface ResolvedRate {
  /** Integer minor units at `money.ts`'s scale. Never a float, never a string. */
  readonly amount: Money
  /** How many `unit`s `amount` buys. Must be finite and positive. */
  readonly perQuantity: number
  /** AWS's own unit — "Hrs", "GB-Mo", "Requests". Never invented here. */
  readonly unit: string
  /** ISO 4217, and it must agree with `amount.currency`. */
  readonly currency: string
}

/** One rung of a published ladder. `toUnits` is null for the open top rung. */
export interface ResolvedTier {
  readonly fromUnits: number
  readonly toUnits: number | null
  readonly rate: ResolvedRate
}

/**
 * A rate as the reader resolved it — or the reason there is none.
 *
 * Four arms, and only two carry an amount. `unknown` and `ambiguous` have no
 * rate field at all, which is what makes "this component is unpriced" impossible
 * to confuse with "this component is free" anywhere downstream of here.
 *
 * The Studio's `ShapeRate` is assignable to this arm for arm: its `flat` carries
 * `rate`, its `tiered` carries `tiers`, and its `unknown` / `ambiguous` carry
 * `why`. The extra fields it also carries — `sku`, `rateCode`, `effectiveDate`,
 * `candidates` — are provenance for a surface, not inputs to arithmetic.
 */
export type ResolvedShapeRate =
  | { readonly kind: "flat"; readonly rate: ResolvedRate }
  | { readonly kind: "tiered"; readonly tiers: readonly ResolvedTier[] }
  | { readonly kind: "unknown"; readonly why: string }
  | { readonly kind: "ambiguous"; readonly why: string }

/**
 * Every rate the caller managed to resolve, by component.
 *
 * `Partial`, deliberately. The reader prices each shape independently and a
 * denied Fargate read leaves the DynamoDB one priced, so a rate table with holes
 * in it is the normal case rather than an error. A hole is treated exactly as
 * `unknown` is — see `rateProblem` — and never as an absence of cost.
 */
export type ResolvedRates = Readonly<Partial<Record<InfrastructureComponent, ResolvedShapeRate>>>

/* ──────────────────────────────────────────────────────── the tenant shape ── */

/**
 * How much of one meter a configuration option turns in a month.
 *
 * Split into the part that is the same however many people the organisation has
 * and the part that scales with seats, because that is the split the product
 * requirement asks for: a ledger costs the same for ten officers and two
 * hundred, and messaging does not. A single blended figure would force whoever
 * renders it to invent the split, and they would invent it differently on each
 * of the five stages of the composer.
 */
export interface ComponentUsage {
  readonly component: InfrastructureComponent
  /** Per month, whatever the seat count. In the rate's own unit. */
  readonly perOrgQuantity: number
  /** Per month, for each seat. In the rate's own unit. */
  readonly perSeatQuantity: number
  /**
   * Where the quantity came from.
   *
   * Required, and it is the field that keeps this from being a second
   * transcribed table. A grounded rate multiplied by a felt quantity is a felt
   * price with a citation on the wrong half of it, so every quantity says what
   * measured or specified it — a Terraform task definition, a CloudWatch
   * reading, a stated sizing rule.
   */
  readonly basis: string
}

/** One configuration option's infrastructure footprint. */
export interface TenantShape {
  /** The option this footprint belongs to — the key a quote line carries. */
  readonly optionKey: string
  readonly usage: readonly ComponentUsage[]
}

/* ───────────────────────────────────────────────────────────── the results ── */

/** Why one component could not be priced. Never rendered as a zero. */
export interface UnpricedComponent {
  readonly component: InfrastructureComponent
  readonly basis: string
  readonly why: string
}

/**
 * One priced meter, with both halves of its price and how they were derived.
 *
 * `quotedTotal` and `exactTotal` are the same figure for a flat rate and can
 * differ by a rounding unit for a graduated one — see `costComponent`. Both are
 * carried rather than one, because the difference is the kind of thing that
 * makes a bill and a quote disagree by a cent and nobody able to say why.
 */
export interface GroundedComponentLine {
  readonly component: InfrastructureComponent
  readonly basis: string
  readonly unit: string
  readonly perOrgQuantity: number
  readonly perSeatQuantity: number
  /** Cost of the per-organisation quantity. */
  readonly organization: Money
  /** Cost attributable to one seat, at the seat count this was computed for. */
  readonly perSeat: Money
  /** `organization + perSeat × seats` — what a quote built from the two shows. */
  readonly quotedTotal: Money
  /** What the meter actually costs at this seat count, before any decomposition. */
  readonly exactTotal: Money
  /**
   * `linear` — a flat rate, where per-seat and per-organisation add back exactly.
   * `graduated` — a tier ladder, where they add back to within a rounding unit.
   */
  readonly decomposition: "linear" | "graduated"
}

/** A cost that resolved completely. The only arm that carries a total. */
export interface CompleteGroundedCost {
  readonly state: "COMPLETE"
  readonly optionKey: string
  readonly currency: string
  readonly seats: number
  /** Stated, never implied. Every rounded figure below was rounded under it. */
  readonly rounding: RoundingMode
  readonly lines: readonly GroundedComponentLine[]
  /** Σ per-seat, exact. */
  readonly perSeat: Money
  /** Σ per-organisation, exact. */
  readonly organization: Money
  /** What the shape actually costs at this seat count, exact. */
  readonly exactTotal: Money
  /** The per-seat price tag, in whole minor units. */
  readonly perSeatMinor: number
  /** The per-organisation price tag, in whole minor units. */
  readonly perOrgMinor: number
  /** `perSeatMinor × seats + perOrgMinor` — the number a composer displays. */
  readonly totalMinor: number
  /** `exactTotal` in whole minor units, for comparison with the above. */
  readonly exactTotalMinor: number
  /** `totalMinor − exactTotalMinor`. Stated so it is never a mystery cent. */
  readonly roundingDifferenceMinor: number
}

/**
 * What a shape costs, or why nothing here will say.
 *
 * The `INCOMPLETE` arm carries `priced` so a surface can show what IS known and
 * name what is not. It carries no sum of them, and there is no function in this
 * module that will produce one, because a subtotal on a page whose heading says
 * "total" is a total.
 */
export type GroundedCost =
  | CompleteGroundedCost
  | {
      readonly state: "INCOMPLETE"
      readonly optionKey: string
      readonly seats: number
      readonly rounding: RoundingMode
      /** The components that priced. Deliberately not summed. */
      readonly priced: readonly GroundedComponentLine[]
      readonly unpriced: readonly UnpricedComponent[]
      readonly why: string
    }
  | {
      readonly state: "MIXED_CURRENCY"
      readonly optionKey: string
      readonly seats: number
      readonly rounding: RoundingMode
      /** Which components resolved in which currency, so the split is visible. */
      readonly byCurrency: readonly {
        readonly currency: string
        readonly components: readonly InfrastructureComponent[]
      }[]
      readonly why: string
    }

/* ─────────────────────────────────────────────────────── the extension math ── */

/** An amount, or the reason there is not one. No third state, and no zero. */
export type ExtendedAmount =
  | { readonly resolved: true; readonly cost: Money }
  | { readonly resolved: false; readonly why: string }

/**
 * The largest product this module will form without saying it could not.
 *
 * `Money` is a JavaScript number holding an exact integer, which stops being
 * exact above 2^53. A trillion SQS requests at a rate whose units are already
 * scaled is comfortably inside it; something that is not is a quantity nobody
 * meant to type, and reporting it unresolved is the only answer that is not a
 * silently wrong price.
 */
const EXACT_INTEGER_LIMIT = Number.MAX_SAFE_INTEGER

/** Whether a quantity is a number this module will multiply a rate by. */
function quantityProblem(quantity: number, what: string): string | null {
  if (!Number.isFinite(quantity)) return `${what} is ${quantity}, which is not a quantity`
  if (quantity < 0) return `${what} is ${quantity}; a negative quantity is a credit, not a usage`
  return null
}

/**
 * What `quantity` units of a flat rate cost.
 *
 * Every way this can fail returns an unresolved amount rather than a zero or a
 * throw. A rate whose `perQuantity` is zero, whose stated currency disagrees
 * with the currency on its own money, or whose product does not fit in exact
 * integer arithmetic is a rate this module did not understand — and a price it
 * did not understand rendered as free is the failure this whole file is built
 * around.
 */
export function extendResolvedRate(
  rate: ResolvedRate,
  quantity: number,
  rounding: RoundingMode,
): ExtendedAmount {
  const badQuantity = quantityProblem(quantity, "the quantity")
  if (badQuantity) return { resolved: false, why: badQuantity }

  if (!Number.isFinite(rate.perQuantity) || rate.perQuantity <= 0) {
    return {
      resolved: false,
      why:
        `the rate buys ${rate.perQuantity} ${rate.unit || "unit"}s, which is not a quantity a price ` +
        `can be divided over`,
    }
  }
  if (rate.amount.currency !== rate.currency) {
    return {
      resolved: false,
      why:
        `the rate says it is in ${rate.currency} and its amount says ${rate.amount.currency}. ` +
        `A price whose two halves disagree about the currency is not an amount of anything.`,
    }
  }

  const exact = (rate.amount.units * quantity) / rate.perQuantity
  if (!Number.isFinite(exact) || Math.abs(exact) > EXACT_INTEGER_LIMIT) {
    return {
      resolved: false,
      why:
        `${quantity} ${rate.unit || "unit"}s at this rate does not fit in exact integer arithmetic ` +
        `at this engine's money scale. Reported unresolved rather than rounded: a price that lost ` +
        `its low digits is a price nobody can reconcile against a bill.`,
    }
  }

  return { resolved: true, cost: money(roundToInteger(exact, rounding), rate.currency) }
}

/**
 * What `quantity` units cost against a published tier ladder, graduated.
 *
 * Graduated and not "the tier the quantity lands in": AWS's storage and
 * CloudFront ladders charge the first band at the first band's price whatever
 * the total is, and pricing the whole quantity at the marginal rate would
 * undercharge the first gigabyte and overcharge nothing, which is a quote that
 * is wrong in the customer's favour and therefore wrong.
 *
 * The ladder is checked before it is used, and every check that fails produces
 * an unresolved amount:
 *
 *   * it must start at zero — a ladder starting at 100 leaves the first 100
 *     units with no published price, and charging them at nothing is inventing
 *     a free tier AWS did not publish;
 *   * it must be contiguous — a gap between rungs is a range with no price;
 *   * it must cover the quantity — a closed top rung below the quantity leaves
 *     the overage unpriced;
 *   * every rung must be in the same currency.
 *
 * Each rung's contribution is rounded under the stated mode and then added as an
 * integer, rather than the real values being accumulated and rounded once. The
 * difference is at most one unit of 10^-6 of a minor unit per rung; the reason
 * to prefer it is that each rung's figure is then separately reproducible, which
 * is what makes a ladder auditable at all.
 */
export function extendTierLadder(
  tiers: readonly ResolvedTier[],
  quantity: number,
  rounding: RoundingMode,
): ExtendedAmount {
  const badQuantity = quantityProblem(quantity, "the quantity")
  if (badQuantity) return { resolved: false, why: badQuantity }
  if (tiers.length === 0) {
    return { resolved: false, why: "the published ladder has no tiers, so no quantity has a price" }
  }

  const currencies = [...new Set(tiers.map((tier) => tier.rate.currency))].sort()
  if (currencies.length > 1) {
    return {
      resolved: false,
      why: `the published ladder mixes ${currencies.join(" and ")}; a ladder is not a ladder across currencies`,
    }
  }

  const sorted = [...tiers].sort((left, right) => left.fromUnits - right.fromUnits)

  for (const tier of sorted) {
    if (!Number.isFinite(tier.fromUnits) || tier.fromUnits < 0) {
      return { resolved: false, why: `a tier begins at ${tier.fromUnits}, which is not a boundary` }
    }
    if (tier.toUnits !== null && (!Number.isFinite(tier.toUnits) || tier.toUnits <= tier.fromUnits)) {
      return {
        resolved: false,
        why: `a tier runs from ${tier.fromUnits} to ${tier.toUnits}, which is not a range`,
      }
    }
  }

  if (sorted[0].fromUnits !== 0) {
    return {
      resolved: false,
      why:
        `the published ladder starts at ${sorted[0].fromUnits} ${sorted[0].rate.unit || "unit"}s, so the ` +
        `units below that have no price. This engine will not charge them at nothing.`,
    }
  }

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]
    if (previous.toUnits === null) {
      return {
        resolved: false,
        why: `a tier with no upper bound is followed by another starting at ${sorted[index].fromUnits}`,
      }
    }
    if (previous.toUnits !== sorted[index].fromUnits) {
      return {
        resolved: false,
        why:
          `the published ladder jumps from ${previous.toUnits} to ${sorted[index].fromUnits}; the range ` +
          `between them has no price`,
      }
    }
  }

  const top = sorted[sorted.length - 1]
  if (top.toUnits !== null && quantity > top.toUnits) {
    return {
      resolved: false,
      why:
        `the published ladder ends at ${top.toUnits} ${top.rate.unit || "unit"}s and this shape consumes ` +
        `${quantity}. The overage has no published price and is not free.`,
    }
  }

  let units = 0
  for (const tier of sorted) {
    const upper = tier.toUnits === null ? quantity : Math.min(quantity, tier.toUnits)
    const span = upper - tier.fromUnits
    if (span <= 0) continue
    const segment = extendResolvedRate(tier.rate, span, rounding)
    if (!segment.resolved) return segment
    units += segment.cost.units
    if (Math.abs(units) > EXACT_INTEGER_LIMIT) {
      return {
        resolved: false,
        why: "the ladder's total does not fit in exact integer arithmetic at this engine's money scale",
      }
    }
  }

  return { resolved: true, cost: money(units, currencies[0]) }
}

/* ───────────────────────────────────────────────────────── one component ── */

interface ComponentOutcome {
  readonly line: GroundedComponentLine | null
  readonly unpriced: UnpricedComponent | null
}

/**
 * One meter's two price halves, at a stated seat count.
 *
 * ## Why a flat rate and a ladder decompose differently
 *
 * A flat rate is linear, so `organization` and `perSeat` are just the rate
 * extended over each quantity and they add back to the exact cost with no
 * remainder at all.
 *
 * A ladder is not linear, and this is the part that cannot be quietly fudged.
 * The hundredth seat's gigabytes may fall in a cheaper band than the first
 * seat's, so there is no single number that is "the per-seat price" and also
 * makes `organization + perSeat × seats` come out exactly right. This module
 * therefore states its decomposition rather than implying one:
 *
 *   * `organization` is the ladder at the per-organisation quantity alone —
 *     what the tenant pays with no seats at all;
 *   * everything the seats add is the ladder at the full quantity minus that,
 *     which is exact;
 *   * `perSeat` is that block divided by the seat count and rounded under the
 *     caller's mode — an average, and it is the only kind of per-seat figure a
 *     graduated meter has.
 *
 * The residue is carried as `roundingDifferenceMinor` on the total rather than
 * absorbed, because a quote and a bill that differ by a cent with no field
 * explaining it is how a customer stops believing both.
 *
 * At zero seats there is no average to take, so `perSeat` is the marginal cost
 * of the FIRST seat — which is the question a composer at zero seats is actually
 * asking: what does adding somebody cost.
 */
export function costComponent(
  usage: ComponentUsage,
  rate: ResolvedShapeRate | undefined,
  seats: number,
  rounding: RoundingMode,
): ComponentOutcome {
  const unresolved = (why: string): ComponentOutcome => ({
    line: null,
    unpriced: { component: usage.component, basis: usage.basis, why },
  })

  // The three ways there is no price, taken before anything is computed — and
  // taken as EARLY RETURNS rather than as a boolean, so that below this point
  // `priced` is narrowed to the two arms that carry an amount. A branch here
  // that fell through would not compile: `unknown` has no `rate` field and
  // `ambiguous` has no `tiers`, so "treat an unreadable rate as zero" is a type
  // error rather than a decision somebody has to remember not to take.
  if (!rate) {
    return unresolved(
      `no rate was resolved for ${usage.component}. A component missing from the rate table is ` +
        `unpriced, not free — the two are the same on a running total and opposite on an invoice.`,
    )
  }
  if (rate.kind === "unknown") {
    return unresolved(`the published rate for ${usage.component} is unknown — ${rate.why}`)
  }
  if (rate.kind === "ambiguous") {
    return unresolved(
      `the published rate for ${usage.component} is ambiguous — ${rate.why} This engine will not ` +
        `pick one; picking is a commercial decision.`,
    )
  }

  const priced: Extract<ResolvedShapeRate, { kind: "flat" | "tiered" }> = rate
  const unit = priced.kind === "flat" ? priced.rate.unit : priced.tiers[0]?.rate.unit ?? ""
  const at = (quantity: number): ExtendedAmount =>
    priced.kind === "flat"
      ? extendResolvedRate(priced.rate, quantity, rounding)
      : extendTierLadder(priced.tiers, quantity, rounding)

  const organization = at(usage.perOrgQuantity)
  if (!organization.resolved) return unresolved(organization.why)

  const seatQuantity = usage.perSeatQuantity * seats
  const badTotal = quantityProblem(seatQuantity, `${usage.perSeatQuantity} per seat over ${seats} seat(s)`)
  if (badTotal) return unresolved(badTotal)

  const exactTotal = at(usage.perOrgQuantity + seatQuantity)
  if (!exactTotal.resolved) return unresolved(exactTotal.why)

  let perSeat: Money
  if (priced.kind === "flat") {
    // Linear: one seat's quantity at the rate, exactly. No division, no residue.
    const one = extendResolvedRate(priced.rate, usage.perSeatQuantity, rounding)
    if (!one.resolved) return unresolved(one.why)
    perSeat = one.cost
  } else if (seats > 0) {
    const block = subtract(exactTotal.cost, organization.cost)
    perSeat = money(roundToInteger(block.units / seats, rounding), block.currency)
  } else {
    // No seats to average over. The marginal cost of the first one is the
    // question being asked, and it is exact.
    const first = at(usage.perOrgQuantity + usage.perSeatQuantity)
    if (!first.resolved) return unresolved(first.why)
    perSeat = subtract(first.cost, organization.cost)
  }

  const quotedTotal = add(
    organization.cost,
    money(perSeat.units * seats, perSeat.currency),
  )

  return {
    line: {
      component: usage.component,
      basis: usage.basis,
      unit,
      perOrgQuantity: usage.perOrgQuantity,
      perSeatQuantity: usage.perSeatQuantity,
      organization: organization.cost,
      perSeat,
      quotedTotal,
      exactTotal: exactTotal.cost,
      decomposition: priced.kind === "flat" ? "linear" : "graduated",
    },
    unpriced: null,
  }
}

/* ────────────────────────────────────────────────────────── one shape ── */

export interface GroundingOptions {
  /** Whole, non-negative. Echoed on every arm — a total with an implied seat count is uncheckable. */
  readonly seats: number
  /** Required. See money.ts: a default rounding mode is `Math.round` wearing a name. */
  readonly rounding: RoundingMode
}

/** A shape whose usage list this module will not accept, and why. */
function shapeProblems(shape: TenantShape): string[] {
  const problems: string[] = []
  const seen = new Set<string>()

  for (const usage of shape.usage) {
    if (seen.has(usage.component)) {
      problems.push(
        `"${shape.optionKey}" declares ${usage.component} twice. Two quantities for one meter is two ` +
          `answers to one question, and nothing here will choose between them.`,
      )
    }
    seen.add(usage.component)

    if (!INFRASTRUCTURE_COMPONENTS.includes(usage.component)) {
      problems.push(
        `"${shape.optionKey}" declares ${JSON.stringify(usage.component)}, which is not a component ` +
          `this engine prices. It takes ${INFRASTRUCTURE_COMPONENTS.join(", ")}.`,
      )
    }
    for (const [field, value] of [
      ["perOrgQuantity", usage.perOrgQuantity],
      ["perSeatQuantity", usage.perSeatQuantity],
    ] as const) {
      const bad = quantityProblem(value, `"${shape.optionKey}" ${usage.component} ${field}`)
      if (bad) problems.push(bad)
    }
    if (usage.perOrgQuantity === 0 && usage.perSeatQuantity === 0) {
      problems.push(
        `"${shape.optionKey}" declares ${usage.component} and consumes none of it. A meter listed at ` +
          `zero usage makes an unresolved rate look priced; leave it out instead.`,
      )
    }
    if (!usage.basis.trim()) {
      problems.push(
        `"${shape.optionKey}" states no basis for its ${usage.component} quantity. A grounded rate ` +
          `multiplied by a felt quantity is a felt price.`,
      )
    }
  }

  return problems
}

/**
 * What one configuration option's infrastructure costs, per seat and for the
 * organisation, at real rates.
 *
 * Throws `PriceError` only for a shape this module cannot read as a shape — a
 * duplicated meter, a negative quantity, a missing basis, a fractional seat
 * count. Those are the caller's own structure and a wrong one should not
 * compile into a quote. Everything about the RATES degrades instead: an
 * unresolved rate makes the whole cost `INCOMPLETE`, which carries no total.
 */
export function groundShapeCost(
  shape: TenantShape,
  rates: ResolvedRates,
  options: GroundingOptions,
): GroundedCost {
  const { seats, rounding } = options
  if (!Number.isInteger(seats) || seats < 0) {
    throw new PriceError(
      `A grounded cost needs a whole, non-negative seat count; got ${seats}. There is no fractional ` +
        `seat, and a quote for a negative one is a refund.`,
    )
  }

  const problems = shapeProblems(shape)
  if (problems.length > 0) throw new PriceError(problems.join("\n"))

  const lines: GroundedComponentLine[] = []
  const unpriced: UnpricedComponent[] = []

  // Sorted, so the same shape always renders its lines in the same order. A
  // report that reshuffles its rows between refreshes is one nobody can diff.
  const usages = [...shape.usage].sort((left, right) => left.component.localeCompare(right.component))

  for (const usage of usages) {
    const outcome = costComponent(usage, rates[usage.component], seats, rounding)
    if (outcome.line) lines.push(outcome.line)
    if (outcome.unpriced) unpriced.push(outcome.unpriced)
  }

  if (unpriced.length > 0) {
    return {
      state: "INCOMPLETE",
      optionKey: shape.optionKey,
      seats,
      rounding,
      priced: lines,
      unpriced,
      why:
        `${unpriced.length} of ${usages.length} component(s) of "${shape.optionKey}" could not be priced: ` +
        `${unpriced.map((entry) => `${entry.component} (${entry.why})`).join("; ")}. No total is ` +
        `offered: an unpriced component counted as zero is exactly the cost surprise a priced ` +
        `configuration exists to prevent.`,
    }
  }

  const currencies = [...new Set(lines.map((line) => line.organization.currency))].sort()
  if (currencies.length > 1) {
    return {
      state: "MIXED_CURRENCY",
      optionKey: shape.optionKey,
      seats,
      rounding,
      byCurrency: currencies.map((currency) => ({
        currency,
        components: lines
          .filter((line) => line.organization.currency === currency)
          .map((line) => line.component),
      })),
      why:
        `"${shape.optionKey}" resolved rates in ${currencies.join(" and ")}. A total across currencies ` +
        `is not a total; convert with a stated rate and date, or quote them separately.`,
    }
  }

  // An option that provisions nothing resolves to exactly zero in the platform's
  // list currency. It is a real state — a configuration flag that turns on no
  // infrastructure — and it is distinguishable from an unpriced one by which arm
  // it arrives on, never by the value of a number.
  const currency = currencies[0] ?? "USD"

  const perSeat = sum(lines.map((line) => line.perSeat), currency)
  const organization = sum(lines.map((line) => line.organization), currency)
  const exactTotal = sum(lines.map((line) => line.exactTotal), currency)

  const perSeatMinor = toMinorUnits(perSeat, rounding)
  const perOrgMinor = toMinorUnits(organization, rounding)
  const totalMinor = perSeatMinor * seats + perOrgMinor
  const exactTotalMinor = toMinorUnits(exactTotal, rounding)

  return {
    state: "COMPLETE",
    optionKey: shape.optionKey,
    currency,
    seats,
    rounding,
    lines,
    perSeat,
    organization,
    exactTotal,
    perSeatMinor,
    perOrgMinor,
    totalMinor,
    exactTotalMinor,
    roundingDifferenceMinor: totalMinor - exactTotalMinor,
  }
}

/* ──────────────────────────────────────────────────── the running total ── */

/** One option's contribution to the running total, when every option priced. */
export interface GroundedTotalLine {
  readonly optionKey: string
  readonly perSeatMinor: number
  readonly perOrgMinor: number
  readonly totalMinor: number
}

/**
 * The running total across a whole configuration — or the refusal.
 *
 * The `INCOMPLETE` arm names every option that failed and every component inside
 * it, and carries no figure. This is the arm the mutation proof drives: make one
 * rate unknown and the total stops existing rather than getting smaller.
 */
export type GroundedRunningTotal =
  | {
      readonly state: "COMPLETE"
      readonly currency: string
      readonly seats: number
      readonly rounding: RoundingMode
      readonly options: readonly CompleteGroundedCost[]
      readonly lines: readonly GroundedTotalLine[]
      readonly perSeatMinor: number
      readonly perOrgMinor: number
      /** `perSeatMinor × seats + perOrgMinor`. The number the composer shows. */
      readonly totalMinor: number
    }
  | {
      readonly state: "INCOMPLETE"
      readonly seats: number
      readonly rounding: RoundingMode
      /** The options that priced completely. Deliberately not summed. */
      readonly priced: readonly CompleteGroundedCost[]
      /** The options that did not, each carrying its own refusal. */
      readonly refused: readonly Exclude<GroundedCost, CompleteGroundedCost>[]
      readonly why: string
    }

/**
 * Price every option of a configuration and total them.
 *
 * The total is `COMPLETE` only when every option is. There is no partial total,
 * no "priced so far" figure and no flag a caller can ignore — the shape of the
 * value is the enforcement.
 */
export function groundedRunningTotal(
  shapes: readonly TenantShape[],
  rates: ResolvedRates,
  options: GroundingOptions,
): GroundedRunningTotal {
  const { seats, rounding } = options
  const costs = shapes.map((shape) => groundShapeCost(shape, rates, options))

  const priced = costs.filter((cost): cost is CompleteGroundedCost => cost.state === "COMPLETE")
  const refused = costs.filter(
    (cost): cost is Exclude<GroundedCost, CompleteGroundedCost> => cost.state !== "COMPLETE",
  )

  if (refused.length > 0) {
    return {
      state: "INCOMPLETE",
      seats,
      rounding,
      priced,
      refused,
      why:
        `${refused.length} of ${costs.length} configuration option(s) could not be grounded: ` +
        `${refused.map((cost) => `"${cost.optionKey}" — ${cost.why}`).join(" | ")}. The running total ` +
        `is withheld rather than shown short.`,
    }
  }

  const currencies = [...new Set(priced.map((cost) => cost.currency))].sort()
  if (currencies.length > 1) {
    return {
      state: "INCOMPLETE",
      seats,
      rounding,
      // Every option DID price; they simply do not add. `priced` therefore
      // carries all of them, so the page can still show each option's own
      // figure in its own currency — what it must not show is their sum.
      priced,
      refused: [],
      why:
        `the configuration's options priced in ${currencies.join(" and ")}. A running total across ` +
        `currencies is not a total; quote them separately or convert with a stated rate and date.`,
    }
  }

  const currency = currencies[0] ?? "USD"
  const perSeatMinor = priced.reduce((running, cost) => running + cost.perSeatMinor, 0)
  const perOrgMinor = priced.reduce((running, cost) => running + cost.perOrgMinor, 0)

  return {
    state: "COMPLETE",
    currency,
    seats,
    rounding,
    options: priced,
    lines: priced.map((cost) => ({
      optionKey: cost.optionKey,
      perSeatMinor: cost.perSeatMinor,
      perOrgMinor: cost.perOrgMinor,
      totalMinor: cost.totalMinor,
    })),
    perSeatMinor,
    perOrgMinor,
    totalMinor: perSeatMinor * seats + perOrgMinor,
  }
}

/* ─────────────────────────────────────────── the bridge to the price tag ── */

/**
 * A grounded cost as the price tag the composer already renders.
 *
 * Takes `CompleteGroundedCost` and NOT `GroundedCost`, which is the whole point:
 * an incomplete cost cannot be turned into an `OptionPrice` because it does not
 * type-check, and `OptionPrice` is what `quoteConfiguration` and `runningTotal`
 * in `./pricing` build the composer's running total out of. The refusal
 * therefore cannot be lost between the two modules by anybody forgetting to
 * check a flag.
 *
 * `includedBecause` is filled in when both figures are zero, because
 * `validateDefinition` in `@tenure/configuration` refuses an option priced at
 * nothing with no reason — and because zero is a commercial statement that has
 * to be true. The two ways a grounded cost reaches zero are genuinely different
 * and the sentence says which one happened: AWS published no charge for what
 * this shape consumes, or it published a charge so small that a month of it
 * rounds away at this currency's precision.
 */
export function toOptionPrice(cost: CompleteGroundedCost): OptionPrice {
  if (cost.perSeatMinor !== 0 || cost.perOrgMinor !== 0) {
    return {
      perSeatMinor: cost.perSeatMinor,
      perOrgMinor: cost.perOrgMinor,
      currency: cost.currency,
      rounding: cost.rounding,
    }
  }

  const exactlyZero = cost.perSeat.units === 0 && cost.organization.units === 0
  const includedBecause = exactlyZero
    ? cost.lines.length === 0
      ? `"${cost.optionKey}" provisions no billable infrastructure, so there is nothing to charge for.`
      : `every AWS rate for what "${cost.optionKey}" consumes is published at no charge: ` +
        `${cost.lines.map((line) => `${line.component} (${line.basis})`).join(", ")}.`
    : `"${cost.optionKey}" costs ${toDecimal(cost.exactTotal, cost.rounding)} ${cost.currency} a month ` +
      `at ${cost.seats} seat(s) — below one minor unit of ${cost.currency}, so it rounds to nothing ` +
      `under ${cost.rounding}. It is not free; it is smaller than this currency can invoice.`

  return {
    perSeatMinor: 0,
    perOrgMinor: 0,
    currency: cost.currency,
    rounding: cost.rounding,
    includedBecause,
  }
}

/* ───────────────────────────────────────────────────────────── rendering ── */

/** What a surface prints. One funnel, so the states cannot drift between pages. */
export interface GroundedLine {
  readonly label: string
  readonly text: string
}

/** The sentence for one option's grounded cost, in every arm. */
export function describeGroundedCost(cost: GroundedCost): string {
  switch (cost.state) {
    case "COMPLETE": {
      const perSeat = `${toDecimal(cost.perSeat, cost.rounding)} ${cost.currency} per seat`
      const org = `${toDecimal(cost.organization, cost.rounding)} ${cost.currency} per organisation`
      const total = `${toDecimal(
        // Rebuilt from the quoted minor units rather than from the exact total,
        // so the sentence says the number the composer shows.
        fromMinorUnits(cost.totalMinor, cost.currency),
        cost.rounding,
      )} ${cost.currency} a month at ${cost.seats} seat(s)`
      const drift =
        cost.roundingDifferenceMinor === 0
          ? ""
          : ` · quoted total differs from the metered cost by ${cost.roundingDifferenceMinor} minor ` +
            `unit(s), from decomposing a graduated meter into a per-seat figure`
      return `${perSeat} + ${org} = ${total}, rounded ${cost.rounding}, from ${cost.lines.length} metered component(s)${drift}`
    }
    case "INCOMPLETE":
      return `no total — ${cost.why}`
    case "MIXED_CURRENCY":
      return `no total — ${cost.why}`
  }
}

/** Every line a pricing surface prints for a whole configuration. */
export function groundedLines(total: GroundedRunningTotal): readonly GroundedLine[] {
  if (total.state === "INCOMPLETE") {
    return [
      { label: "Running total", text: `UNAVAILABLE — ${total.why}` },
      ...total.priced.map((cost) => ({
        label: cost.optionKey,
        text: describeGroundedCost(cost),
      })),
      ...total.refused.map((cost) => ({
        label: cost.optionKey,
        text: describeGroundedCost(cost),
      })),
    ]
  }

  return [
    {
      label: "Running total",
      text:
        `${toDecimal(fromMinorUnits(total.totalMinor, total.currency), total.rounding)} ` +
        `${total.currency} a month at ${total.seats} seat(s) — ` +
        `${total.perSeatMinor} minor unit(s) per seat + ${total.perOrgMinor} per organisation, ` +
        `across ${total.options.length} option(s), rounded ${total.rounding}`,
    },
    ...total.options.map((cost) => ({ label: cost.optionKey, text: describeGroundedCost(cost) })),
  ]
}
