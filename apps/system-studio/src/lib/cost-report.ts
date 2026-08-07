import {
  allocate,
  reconcile,
  reverseSplit,
  summarize,
  type AllocationDriver,
  type CostLine,
  type FigureSource,
  type RecordedSplit,
  type RoundingMode,
  type SplitPart,
} from "@tenure/finops"

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

/** How far through the current calendar month we are, 0–1. */
export function periodCompleteness(now: Date): number {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
  return (now.getTime() - start) / (end - start)
}
