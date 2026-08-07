import {
  add,
  compare,
  money,
  roundToInteger,
  subtract,
  sum,
  zero,
  type Money,
  type RoundingMode,
} from "./money"
import type { AllocationResult } from "./allocation"

/**
 * STUDIO-120-009 — what the FinOps Center shows, and what it refuses to imply.
 *
 * > Show actual, amortized, forecast, budget, anomaly, unit cost, cost by
 * > tenant/module/cell/environment/service, and plan-estimate variance with
 * > freshness and currency.
 *
 * The list is long; the requirement hiding in it is the last three words. A
 * cost figure without its as-of and its currency is not a cost figure — it is a
 * number that was true at some point, and an operator deciding whether to
 * approve a database has no way to know whether it is describing this morning
 * or last Tuesday. AWS billing data is hours behind reality at best and settles
 * over days, so "how old is this" is not a nicety here.
 *
 * `Figure` therefore has no constructor that omits either, and `kind`
 * distinguishes what was billed from what was projected. The prohibited-shortcut
 * list in the bible names "fake cost" explicitly, and the most common way to
 * ship one is not inventing a number — it is showing a forecast in the same
 * typeface as an invoice.
 */

export type FigureKind = "ACTUAL" | "AMORTIZED" | "FORECAST" | "BUDGET"

/**
 * PAY-180-003 — which system a number came from, and when it was taken from it.
 *
 * The as-of half of this was already real: `figure()` refuses an unparseable
 * `asOf` and `freshness()` flags staleness. The citation half was absent
 * entirely, and it is the half an operator asks about first. "Spend is $4,182"
 * is not actionable; "spend is $4,182 per the Cost and Usage Report at
 * s3://tenure-cur/fleet, read 20 minutes ago" is, because it says what to go and
 * check when the number looks wrong — and it says, crucially, that the number is
 * not an estimate.
 *
 * Required on `Figure`, not optional. An optional citation is invisible to
 * `tsc`, so a construction site that forgot one compiles, renders blank and
 * reads exactly like a figure that has one.
 */
export interface FigureSource {
  /**
   * The system that produced it — `aws-cur`, `aws-cost-explorer`, `stripe`,
   * `tenure-ledger`. A name an operator can go to, not a description.
   */
  system: string
  /**
   * Where inside that system: an S3 URI, an object id, an API path and version.
   * Specific enough that two people fetch the same thing.
   */
  reference: string
  /**
   * When this engine took the value out of that system.
   *
   * Distinct from `asOf`, which is when the DATA is current as of. A CUR read
   * five minutes ago can still be describing spend from yesterday, and
   * collapsing the two is how a stale figure looks fresh.
   */
  retrievedAt: string
}

/**
 * A citation for a figure computed from another figure.
 *
 * A forecast is not a reading of the CUR; it is arithmetic over one. It keeps
 * the same system and retrieval time — the underlying fact has not been read
 * again — and says in its reference what was done to it, so nothing can present
 * a projection as a billed line.
 */
export function derivedFrom(source: FigureSource, how: string): FigureSource {
  return {
    system: source.system,
    reference: `${source.reference} — derived: ${how}`,
    retrievedAt: source.retrievedAt,
  }
}

export interface Figure {
  amount: Money
  kind: FigureKind
  /** When the underlying data was last refreshed. Never optional. */
  asOf: string
  /** Which system this came from. Never optional — PAY-180-003. */
  source: FigureSource
  /**
   * How complete the period is, 0–1.
   *
   * A month-to-date actual is not comparable to a budget for the whole month,
   * and the commonest FinOps error is putting them side by side. Carrying
   * completeness means the UI can say "40% through the period" rather than
   * implying the tenant is under budget when it is merely early.
   */
  periodCompleteness: number
}

export function figure(
  amount: Money,
  kind: FigureKind,
  asOf: string,
  source: FigureSource,
  periodCompleteness = 1,
): Figure {
  if (!(periodCompleteness >= 0 && periodCompleteness <= 1)) {
    throw new RangeError(`periodCompleteness must be between 0 and 1, got ${periodCompleteness}`)
  }
  if (!asOf || Number.isNaN(Date.parse(asOf))) {
    throw new TypeError("A figure without a valid as-of is not a figure. AWS billing settles over days.")
  }
  // The citation is held to the same standard the as-of already was. A blank
  // system renders as an empty badge, which reads as "no claim made" and is
  // indistinguishable from a figure somebody chose not to cite.
  if (!source || !source.system.trim()) {
    throw new TypeError(
      "A figure without a source system is a number with no provenance. Name the system it came " +
        "from — an operator deciding on this has to know whether it is a bill or an estimate.",
    )
  }
  if (!source.reference.trim()) {
    throw new TypeError(
      `A figure from "${source.system}" cites no reference. "Somewhere in the CUR" is not a place ` +
        `two people can both go and look at.`,
    )
  }
  if (!source.retrievedAt || Number.isNaN(Date.parse(source.retrievedAt))) {
    throw new TypeError(
      `A figure from "${source.system}" says it was retrieved at ${JSON.stringify(source.retrievedAt)}, ` +
        `which is not a time. When a value was read is half of what a citation is for.`,
    )
  }
  return { amount, kind, asOf, source, periodCompleteness }
}

/** How stale the data is, and whether it should be believed without a caveat. */
export interface Freshness {
  asOf: string
  ageHours: number
  /** AWS billing lags; this is the threshold past which the UI says so. */
  stale: boolean
}

/**
 * Cost Explorer is typically several hours behind and CUR settles over days.
 * Twenty-four hours is the point at which a figure stops being "today's" and
 * an operator should be told rather than left to assume.
 */
export const STALE_AFTER_HOURS = 24

export function freshness(asOf: string, now: Date): Freshness {
  const ageHours = (now.getTime() - Date.parse(asOf)) / 3_600_000
  return { asOf, ageHours, stale: ageHours > STALE_AFTER_HOURS }
}

/**
 * A straight-line projection to the end of the period.
 *
 * Deliberately the simplest possible model, and labelled FORECAST so nothing
 * mistakes it for a fact. A more sophisticated projection is a research project
 * that would still be a guess; what matters for the approval decisions this
 * page supports is that the guess is honest about being one, and that it is
 * reproducible — a forecast that changes when nothing changed is one nobody can
 * plan against.
 *
 * Returns null below `MIN_COMPLETENESS_TO_FORECAST`: three days into a month,
 * one backfill job makes the projection absurd, and an absurd number shown
 * confidently is worse than no number.
 */
export const MIN_COMPLETENESS_TO_FORECAST = 0.1

export function forecastPeriod(actual: Figure, now: Date, rounding: RoundingMode): Figure | null {
  if (actual.periodCompleteness < MIN_COMPLETENESS_TO_FORECAST) return null
  const projected = roundToInteger(actual.amount.units / actual.periodCompleteness, rounding)
  return figure(
    money(projected, actual.amount.currency),
    "FORECAST",
    now.toISOString(),
    // The actual's own citation, marked derived. A projection has no source of
    // its own — inventing one would say a system produced a number it never saw.
    derivedFrom(
      actual.source,
      `straight-line to end of period from ${Math.round(actual.periodCompleteness * 100)}% complete`,
    ),
    1,
  )
}

export type BudgetState = "UNDER" | "ON_TRACK" | "AT_RISK" | "OVER" | "NO_BUDGET"

export interface BudgetAssessment {
  state: BudgetState
  budget: Figure | null
  actual: Figure
  forecast: Figure | null
  /** Spent minus budget. Negative is headroom. */
  variance: Money | null
  detail: string
}

/**
 * Where a tenant stands against its budget.
 *
 * Compares the *forecast* to budget, not the actual, because comparing a
 * month-to-date actual against a whole-month budget says "under budget" on
 * every first of the month. `AT_RISK` is the state that earns this function its
 * place: over on trajectory, not yet over in fact, which is the only point at
 * which anyone can still do something about it.
 */
export function assessBudget(
  actual: Figure,
  budget: Figure | null,
  now: Date,
  rounding: RoundingMode,
): BudgetAssessment {
  const forecast = forecastPeriod(actual, now, rounding)

  if (!budget) {
    return {
      state: "NO_BUDGET",
      budget: null,
      actual,
      forecast,
      variance: null,
      detail: "No budget is set, so there is nothing to be over or under. This is not the same as being on track.",
    }
  }

  const variance = subtract(actual.amount, budget.amount)

  if (compare(actual.amount, budget.amount) > 0) {
    return {
      state: "OVER",
      budget,
      actual,
      forecast,
      variance,
      detail: `Already past the budget with ${Math.round((1 - actual.periodCompleteness) * 100)}% of the period left.`,
    }
  }

  if (forecast && compare(forecast.amount, budget.amount) > 0) {
    return {
      state: "AT_RISK",
      budget,
      actual,
      forecast,
      variance,
      detail:
        "Within budget today, but on track to exceed it. Projected from spend so far, straight-line — " +
        "the only point at which this is still actionable.",
    }
  }

  // 80% of budget on trajectory is close enough to want watching, and far
  // enough from the threshold to be worth distinguishing from comfortable.
  const eightyPercent = money(roundToInteger(budget.amount.units * 0.8, rounding), budget.amount.currency)
  if (forecast && compare(forecast.amount, eightyPercent) > 0) {
    return { state: "ON_TRACK", budget, actual, forecast, variance, detail: "Projected to land inside budget." }
  }

  return { state: "UNDER", budget, actual, forecast, variance, detail: "Well inside budget on current trajectory." }
}

export interface Anomaly {
  dimension: string
  key: string
  current: Money
  baseline: Money
  /** Multiple of baseline. 3 means three times the usual. */
  ratio: number
  detail: string
}

/** Below this, a spike is noise — a $2 line tripling is not an incident. */
export const ANOMALY_FLOOR_MINOR_UNITS = 100 * 10 ** 6 // $1.00

/** How many times the baseline counts as anomalous. */
export const ANOMALY_RATIO = 3

/**
 * Spend that is out of character, found by comparison rather than by threshold.
 *
 * Deterministic: same inputs, same anomalies, every time. A detector with any
 * randomness in it produces alerts nobody can reproduce, and the first
 * irreproducible alert is the one that teaches everyone to ignore the rest.
 *
 * The floor matters as much as the ratio. Without it, every service that went
 * from four cents to twelve is an anomaly, the list is a hundred rows long, and
 * the NAT gateway that quadrupled is somewhere in the middle of it.
 */
export function detectAnomalies(
  dimension: string,
  current: Readonly<Record<string, Money>>,
  baseline: Readonly<Record<string, Money>>,
): Anomaly[] {
  const anomalies: Anomaly[] = []

  for (const key of Object.keys(current).sort()) {
    const now = current[key]
    const was = baseline[key] ?? zero(now.currency)

    if (now.units < ANOMALY_FLOOR_MINOR_UNITS) continue

    if (was.units <= 0) {
      anomalies.push({
        dimension,
        key,
        current: now,
        baseline: was,
        ratio: Infinity,
        detail: `${key} is new this period — it had no baseline spend at all.`,
      })
      continue
    }

    const ratio = now.units / was.units
    if (ratio >= ANOMALY_RATIO) {
      anomalies.push({
        dimension,
        key,
        current: now,
        baseline: was,
        ratio,
        detail: `${key} is ${ratio.toFixed(1)}× its baseline.`,
      })
    }
  }

  return anomalies
}

/** Cost grouped by a dimension of the allocation — service, tenant, region, account. */
export function costBy(
  result: AllocationResult,
  dimension: "tenant",
): Record<string, Money>
export function costBy(result: AllocationResult, dimension: "tenant"): Record<string, Money> {
  void dimension
  return Object.fromEntries(result.tenants.map((tenant) => [tenant.tenantId, tenant.total]))
}

export interface UnitCost {
  /** What is being counted — "organization", "active person", "approval". */
  unit: string
  count: number
  cost: Money
  /** Cost per unit, or null when the count is zero. */
  perUnit: Money | null
}

/**
 * Cost per unit of whatever the tenant actually gets.
 *
 * Returns null rather than zero when the count is zero. Dividing by nothing and
 * reporting $0.00 per organization would read as "extremely efficient" for a
 * tenant that is costing money and serving no one, which is the exact opposite
 * of the truth and the case worth catching.
 */
export function unitCost(unit: string, count: number, cost: Money, rounding: RoundingMode): UnitCost {
  if (!Number.isInteger(count) || count < 0) throw new RangeError(`Unit count must be a non-negative integer, got ${count}`)
  return {
    unit,
    count,
    cost,
    perUnit: count === 0 ? null : money(roundToInteger(cost.units / count, rounding), cost.currency),
  }
}

export interface CostSummary {
  currency: string
  actual: Figure
  amortized: Figure
  forecast: Figure | null
  freshness: Freshness
  byTenant: Record<string, Money>
  unallocated: Money
  /** Share of total that reached no tenant. The number the bible wants visible. */
  unallocatedShare: number
  lineCount: number
}

/**
 * The headline the FinOps Center opens with.
 *
 * `source` is threaded onto every figure it produces rather than attached to the
 * summary as a whole, because the three figures are not equally sourced: the
 * actual and the amortized are readings, the forecast is arithmetic over one.
 * `forecastPeriod` marks its own citation derived; nothing else invents a
 * provenance.
 */
export function summarize(
  result: AllocationResult,
  asOf: string,
  periodCompleteness: number,
  now: Date,
  source: FigureSource,
  rounding: RoundingMode,
): CostSummary {
  const actual = figure(result.ingested, "ACTUAL", asOf, source, periodCompleteness)
  return {
    currency: result.currency,
    actual,
    amortized: figure(result.ingestedAmortized, "AMORTIZED", asOf, source, periodCompleteness),
    forecast: forecastPeriod(actual, now, rounding),
    freshness: freshness(asOf, now),
    byTenant: costBy(result, "tenant"),
    unallocated: result.unallocatedTotal,
    unallocatedShare: result.ingested.units === 0 ? 0 : result.unallocatedTotal.units / result.ingested.units,
    lineCount: result.lineCount,
  }
}

export interface CostThreshold {
  /** What triggers it — "new AWS account", "NAT gateway", "provisioned throughput". */
  change: string
  /** Estimated monthly cost of making the change. */
  estimated: Money
}

export type ApprovalLevel = "NONE" | "PEER" | "TWO_PERSON" | "EXECUTIVE"

export interface ThresholdDecision {
  level: ApprovalLevel
  detail: string
}

/**
 * STUDIO-120-010 — how much approval a cost commitment needs.
 *
 * > Require cost preview and approval thresholds for new accounts, NAT
 * > gateways, databases, search/vector, provisioned throughput, Bedrock, data
 * > transfer, retention, and high-volume integrations.
 *
 * Bands rather than one threshold, because the failure mode of a single gate is
 * that everything either sails through or stops. Monthly, not one-off: a NAT
 * gateway is $32 to create and $390 a year to keep, and a threshold applied to
 * the former approves the latter without anyone seeing it.
 */
export const PEER_THRESHOLD_MINOR = 50 * 100 * 10 ** 6 // $50/month
export const TWO_PERSON_THRESHOLD_MINOR = 500 * 100 * 10 ** 6 // $500/month
export const EXECUTIVE_THRESHOLD_MINOR = 5_000 * 100 * 10 ** 6 // $5,000/month

export function approvalFor(threshold: CostThreshold): ThresholdDecision {
  const units = threshold.estimated.units

  if (units >= EXECUTIVE_THRESHOLD_MINOR) {
    return {
      level: "EXECUTIVE",
      detail: `${threshold.change} adds a recurring commitment above the executive threshold. This is a budget decision, not an engineering one.`,
    }
  }
  if (units >= TWO_PERSON_THRESHOLD_MINOR) {
    return {
      level: "TWO_PERSON",
      detail: `${threshold.change} adds a material recurring cost. Two people must agree, and neither may be the requester.`,
    }
  }
  if (units >= PEER_THRESHOLD_MINOR) {
    return {
      level: "PEER",
      detail: `${threshold.change} is small but recurring. One reviewer, so that it is at least seen.`,
    }
  }
  return {
    level: "NONE",
    detail: `${threshold.change} is below the review threshold. The estimate is still recorded, so the pattern is visible even when each instance is not.`,
  }
}

/** Every change in a plan, with what it will cost and who must approve it. */
export function previewPlanCost(changes: readonly CostThreshold[], currency: string): {
  total: Money
  level: ApprovalLevel
  decisions: readonly (ThresholdDecision & { change: string; estimated: Money })[]
} {
  const decisions = changes.map((change) => ({
    ...approvalFor(change),
    change: change.change,
    estimated: change.estimated,
  }))

  const total = sum(changes.map((c) => c.estimated), currency)

  // The plan's own total is assessed too, not just each change. Ten changes at
  // $60 each is $600 a month, and approving them one at a time as "peer" is how
  // a fleet's bill grows without any single decision to grow it.
  const totalLevel = approvalFor({ change: "this plan in total", estimated: total }).level
  const ranked: ApprovalLevel[] = ["NONE", "PEER", "TWO_PERSON", "EXECUTIVE"]
  const level = [...decisions.map((d) => d.level), totalLevel].reduce(
    (highest, current) => (ranked.indexOf(current) > ranked.indexOf(highest) ? current : highest),
    "NONE" as ApprovalLevel,
  )

  return { total, level, decisions }
}

/** Everything the Center needs, in one shape. */
export function fleetCost(
  result: AllocationResult,
  asOf: string,
  periodCompleteness: number,
  now: Date,
  source: FigureSource,
  rounding: RoundingMode,
) {
  const summary = summarize(result, asOf, periodCompleteness, now, source, rounding)
  return {
    summary,
    anomalies: [] as Anomaly[],
    total: sum(result.tenants.map((t) => t.total), result.currency),
    unallocatedTotal: result.unallocatedTotal,
    asOf,
  }
}

export { add, subtract, sum, zero }
