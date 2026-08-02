import "server-only"

import { allocate, reconcile, summarize, type AllocationDriver, type CostLine } from "@tenure/finops"

/**
 * Where the FinOps Center's numbers come from.
 *
 * STUDIO-120-008 says to ingest CUR/Data Exports. There is nothing to ingest
 * from: the AWS Organization does not exist yet, there is no Cost and Usage
 * Report configured, and no role this engine could assume to call Cost
 * Explorer. That is a real blocker, recorded as BLOCKED_EXTERNAL with the
 * commands an operator would run.
 *
 * What this module does NOT do is fill the gap with something. The bible's
 * prohibited-shortcut list names "fake cost" explicitly, and a demo figure on a
 * page an operator uses to approve spending is worse than an empty page —
 * an empty page is obviously empty, whereas $4,182.55 is actionable and wrong.
 *
 * So `costSource()` returns a discriminated result and the page renders the
 * arm it gets. When CUR lands, `CONNECTED` gains a real reader and every figure
 * below it already works, because `@tenure/finops` was built and proven against
 * the shapes CUR actually produces rather than against whatever an adapter
 * happened to return.
 */

export type CostSource =
  | { state: "CONNECTED"; report: CostReport }
  | { state: "NOT_CONFIGURED"; why: string; operatorSteps: readonly string[] }

export interface CostReport {
  summary: ReturnType<typeof summarize>
  reconciliation: ReturnType<typeof reconcile>
  tenants: ReturnType<typeof allocate>["tenants"]
  unallocated: ReturnType<typeof allocate>["unallocated"]
}

/**
 * The environment variables a real ingest would need.
 *
 * Named rather than guessed at, so the "not configured" state can say precisely
 * what is missing instead of "cost is unavailable" — which tells an operator
 * nothing they can act on.
 */
const CUR_BUCKET = "FINOPS_CUR_BUCKET"
const CUR_PREFIX = "FINOPS_CUR_PREFIX"

export async function costSource(): Promise<CostSource> {
  const bucket = process.env[CUR_BUCKET]
  const prefix = process.env[CUR_PREFIX]

  if (!bucket || !prefix) {
    return {
      state: "NOT_CONFIGURED",
      why:
        "No Cost and Usage Report is connected, so this engine has no billing data to allocate. " +
        "Nothing is shown rather than an estimate: a figure on the page an operator approves spending " +
        "from has to come from the bill.",
      operatorSteps: [
        `Create the CUR 2.0 / Data Export in the payer account, delivered to an S3 bucket the engine can read.`,
        `aws cur put-report-definition --report-definition file://cur.json --region us-east-1`,
        `Grant the engine's task role s3:GetObject and s3:ListBucket on that prefix.`,
        `Set ${CUR_BUCKET} and ${CUR_PREFIX} on the Studio service, then redeploy.`,
        `Tag every provisioned resource with tenure:tenant — untagged spend is reported unallocated, not spread.`,
      ],
    }
  }

  // Reached only once a bucket is configured, which cannot happen before the
  // AWS Organization exists. Deliberately not written as a stub returning
  // fabricated lines: an unreachable branch that returns nothing real is
  // honest, whereas one that returns plausible numbers is the exact failure
  // this module exists to avoid.
  const lines: CostLine[] = await readCurLines(bucket, prefix)
  const drivers: Readonly<Record<string, AllocationDriver>> = await readDrivers()
  const tenantIds = await tenantIdsInScope()

  const result = allocate({ lines, drivers, tenantIds })
  const asOf = new Date().toISOString()

  return {
    state: "CONNECTED",
    report: {
      summary: summarize(result, asOf, periodCompleteness(new Date()), new Date()),
      reconciliation: reconcile(result),
      tenants: result.tenants,
      unallocated: result.unallocated,
    },
  }
}

/** How far through the current calendar month we are, 0–1. */
export function periodCompleteness(now: Date): number {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
  return (now.getTime() - start) / (end - start)
}

async function readCurLines(bucket: string, prefix: string): Promise<CostLine[]> {
  throw new Error(
    `A CUR reader is not implemented yet (${bucket}/${prefix}). STUDIO-120-008 is BLOCKED_EXTERNAL on the AWS ` +
      `Organization; this throws rather than returning [] so that a configured-but-unimplemented source can never ` +
      `render as "$0.00 spent".`,
  )
}

async function readDrivers(): Promise<Readonly<Record<string, AllocationDriver>>> {
  throw new Error("Allocation drivers are configured per fleet and none exist yet.")
}

async function tenantIdsInScope(): Promise<string[]> {
  throw new Error("Tenant scope for cost allocation is resolved from the registry once a CUR is connected.")
}
