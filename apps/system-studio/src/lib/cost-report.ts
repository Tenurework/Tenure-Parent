import {
  allocate,
  fromMinorUnits,
  previewPlanCost,
  reconcile,
  reverseSplit,
  summarize,
  toMinorUnits,
  type AllocationDriver,
  type ApprovalLevel,
  type CostLine,
  type CostThreshold,
  type FigureSource,
  type RecordedSplit,
  type RoundingMode,
  type SplitPart,
} from "@tenure/finops"
import { CONTROL_PLANE_SCHEMA_VERSIONS, parseCostFigure, type CostFigure } from "@tenure/contracts"

/**
 * What the FinOps Center renders, and the one place a cost figure gets its
 * provenance.
 *
 * Deliberately NOT `server-only`, unlike `./cost-source` which imports it. The
 * reading half needs an S3 client and an environment; this half is arithmetic
 * over lines somebody has already read. Separating them is what makes the
 * rendered citation assertable: `costSource()` cannot reach its CONNECTED arm
 * until an AWS Organization exists, and a citation nothing can render is a
 * citation nobody has checked (PAY-180-003).
 */

export interface CostReport {
  summary: ReturnType<typeof summarize>
  reconciliation: ReturnType<typeof reconcile>
  tenants: ReturnType<typeof allocate>["tenants"]
  unallocated: ReturnType<typeof allocate>["unallocated"]
  /**
   * PAY-070-004 — every shared cost that was split, with what a reversal returns.
   *
   * An operator disputing a tenant's share of a NAT gateway needs two things:
   * who received what, and what reversing it puts back. The second is not the
   * first negated by whoever renders it — a largest-remainder split re-derived
   * on the reversal moves the leftover units between recipients — so it is
   * computed by `reverseSplit`, which replays the recorded amounts.
   */
  splits: readonly { split: RecordedSplit; reversal: readonly SplitPart[] }[]
}

/**
 * How a share that does not land on a unit is rounded, stated once for the
 * whole ingest — PAY-030-002.
 *
 * `down` for a billed line: the CUR is already authoritative to more decimal
 * places than are kept, and rounding a million lines up would invent money the
 * bill does not contain. It is stated here rather than defaulted in the package,
 * so changing it is a change to this file with this comment beside it.
 */
export const CUR_ROUNDING: RoundingMode = "down"

/**
 * Everything the FinOps Center renders, from the lines that were read.
 *
 * This is the ONE place a figure's provenance is stated. PAY-180-003 asks that
 * an operator can see which system a number came from, and the answer here is
 * exact: the Cost and Usage Report, at this bucket and prefix, read at this
 * moment. The `NOT_CONFIGURED` arm of `costSource` builds no figure at all, so
 * there is no path on which a citation can be invented.
 */
export function buildCostReport(input: {
  lines: readonly CostLine[]
  drivers: Readonly<Record<string, AllocationDriver>>
  tenantIds: readonly string[]
  bucket: string
  prefix: string
  now: Date
}): CostReport {
  const { lines, drivers, tenantIds, bucket, prefix, now } = input

  const result = allocate({ lines: [...lines], drivers, tenantIds, rounding: CUR_ROUNDING })
  const asOf = now.toISOString()
  const source: FigureSource = {
    system: "aws-cur",
    reference: `s3://${bucket}/${prefix}`,
    retrievedAt: asOf,
  }

  return {
    summary: summarize(result, asOf, periodCompleteness(now), now, source, CUR_ROUNDING),
    reconciliation: reconcile(result),
    tenants: result.tenants,
    unallocated: result.unallocated,
    splits: result.splits.map((split) => ({
      split,
      // Replayed from the recorded amounts, never re-derived from the weights.
      reversal: reverseSplit(split, split.amount),
    })),
  }
}

/* ------------------------------------------- what a planned change commits -- */

/**
 * STUDIO-060-003 / STUDIO-120-010 — the recurring monthly cost of ADDING or
 * REMOVING one resource, in whole USD minor units, or `null` where nothing here
 * can honestly say.
 *
 * ## This is an estimate, and it is not the bill
 *
 * `costSource()` refuses to render a figure that did not come from the Cost and
 * Usage Report, and that rule is untouched: nothing below ever reaches the
 * FinOps Center's actual/amortized/forecast figures. These are LIST PRICES for
 * a change that has not happened yet, which is the only kind of number a
 * pre-execution approval threshold can possibly be assessed on — `approvalFor`
 * takes `estimated`, and an approval gate with no estimate is a gate that
 * approves everything.
 *
 * ## Every figure below is derived, not felt
 *
 * us-east-1 on-demand list price, one instance, 730 hours a month:
 *
 *   * `ecs:service` — Fargate, 0.5 vCPU + 1 GB, one task:
 *     730 × (0.5 × $0.04048 + 1 × $0.004445) = $17.02 → 1702
 *   * `rds:db` — db.t4g.medium single-AZ + 100 GiB gp3:
 *     730 × $0.065 + 100 × $0.115 = $58.95 → 5895
 *   * `cloudfront:distribution` — a distribution itself is not billed; its
 *     traffic is, and traffic is not a property of creating one. `0`, which is
 *     a statement, not an absence.
 *   * `acm:certificate` — public certificates are free. `0`.
 *
 * Anything not listed is `null`: **not computed**, which an approval threshold
 * must never read as free. The distinction is the reason the contract's
 * `monthlyCostDeltaMinor` is `number | null` rather than defaulting to zero.
 */
export const RESOURCE_MONTHLY_ESTIMATE_MINOR: Readonly<Record<string, number>> = {
  "ecs:service": 1702,
  "rds:db": 5895,
  "cloudfront:distribution": 0,
  "acm:certificate": 0,
}

/** The estimate for a resource type, or null when this build has none. */
export function estimateMonthlyMinor(resourceType: string): number | null {
  return resourceType in RESOURCE_MONTHLY_ESTIMATE_MINOR
    ? RESOURCE_MONTHLY_ESTIMATE_MINOR[resourceType]
    : null
}

/** The currency the estimates above are quoted in. AWS list prices are USD. */
export const ESTIMATE_CURRENCY = "USD"

export interface PlanCostAssessment {
  /** The published, versioned figure — the shape anything outside this process reads. */
  figure: CostFigure
  /** How much approval the plan's total needs, from the STUDIO-120-010 bands. */
  level: ApprovalLevel
  /** Net recurring monthly change, in whole minor units. Negative is a saving. */
  totalMinor: number
  /** Changes this build could not price. Named, because they are not free. */
  unpriced: readonly string[]
}

/**
 * Assess a plan's recurring cost through the published threshold engine.
 *
 * The one place `previewPlanCost` is reached from a request path. Before this,
 * `packages/finops` could compute an approval level and nothing ever asked it
 * to — the ledger records the threshold policy as "published and computable but
 * not yet enforced", with no pipeline to wire into. `resourceChangeDiff` in
 * `lib/aws/drift.ts` is that pipeline, and this is where its numbers become an
 * approval level.
 *
 * The returned figure goes through `parseCostFigure`, so a figure that cannot
 * state its currency, its period or where it came from does not exist rather
 * than rendering as a number somebody trusts.
 */
export function assessPlanCost(input: {
  changes: readonly { change: string; monthlyMinor: number | null }[]
  now: Date
  reference: string
}): PlanCostAssessment {
  const priced: CostThreshold[] = input.changes
    .filter((c) => c.monthlyMinor !== null)
    .map((c) => ({ change: c.change, estimated: fromMinorUnits(c.monthlyMinor as number, ESTIMATE_CURRENCY) }))

  const preview = previewPlanCost(priced, ESTIMATE_CURRENCY)
  const totalMinor = toMinorUnits(preview.total, CUR_ROUNDING)

  const start = new Date(Date.UTC(input.now.getUTCFullYear(), input.now.getUTCMonth(), 1))
  const end = new Date(Date.UTC(input.now.getUTCFullYear(), input.now.getUTCMonth() + 1, 1))

  return {
    figure: parseCostFigure({
      schemaVersion: CONTROL_PLANE_SCHEMA_VERSIONS.CostFigure,
      dimension: "plan",
      key: input.reference,
      // A plan's cost is a forecast of a recurring commitment, never an ACTUAL.
      // Publishing it as ACTUAL is precisely how an estimate gets read as a bill.
      kind: "FORECAST",
      amountMinor: totalMinor,
      currency: ESTIMATE_CURRENCY,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      sourceSystem: "tenure-plan-estimate",
      sourceReference: input.reference,
      retrievedAt: input.now.toISOString(),
    }),
    level: preview.level,
    totalMinor,
    unpriced: input.changes.filter((c) => c.monthlyMinor === null).map((c) => c.change),
  }
}

/** How far through the current calendar month we are, 0–1. */
export function periodCompleteness(now: Date): number {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
  return (now.getTime() - start) / (end - start)
}
