import { cellContext, type Partition } from "@/lib/cell-context"

/**
 * GE-010-007 — does the thing this code is about to call actually exist in the
 * partition this process is running in?
 *
 * `cell-context.ts` resolves the partition and validates it (`GE-012-001`).
 * Nothing then asked it anything. Both consumers read `.region` and stopped —
 * `ai.ts` for the model region check, `s3.ts` for the client constructor — so a
 * cell deployed with `AWS_PARTITION=aws-cn` reported `aiConfigured() === true`
 * on the strength of an `ANTHROPIC_API_KEY` and posted tenant content to
 * `api.anthropic.com`. The partition was resolved, printed in logs, and then
 * assumed to contain every service the commercial partition contains.
 *
 * An abstraction that resolves a partition and then ignores it is worse than
 * not having one: it looks like the question was asked.
 *
 * ## Why this is a list and not a lookup
 *
 * There is no API that answers "is service X in partition Y" — AWS publishes it
 * as prose and as an endpoints file that does not cover third-party SaaS at all.
 * So it is a decision, written down, per service this application actually
 * reaches. A service earns a row here when a call site needs it; the matrix is
 * not an inventory of AWS, it is an inventory of *this app's* dependencies.
 *
 * ## Why an unknown partition is a refusal, not a shrug
 *
 * `cellContext()` reports an unrecognised `AWS_PARTITION` in `unresolved` and
 * still hands the string back typed as `Partition` (deliberately — it must not
 * fail the deploy of a running system over a variable production does not set
 * yet). So the value reaching this module can be a partition nobody has made a
 * decision about. Treating that as commercial AWS is precisely the assumption
 * this file exists to delete, so an unknown partition offers nothing.
 */

/**
 * The services this application reaches. Not every AWS service — the ones with
 * a call site in `apps/web`.
 */
export type ServiceId =
  /** Document storage. `lib/s3.ts`. */
  | "s3"
  /**
   * `api.anthropic.com`. Not an AWS service at all: a public-internet SaaS
   * endpoint, which is exactly why it needs a row. It is reachable from a
   * commercial cell and is not part of the GovCloud or China partitions, so a
   * cell in either has no partition-local way to reach it and must not pretend
   * a configured key means it can.
   */
  | "anthropic-public-api"

/**
 * The matrix. One row per partition, exhaustive over `Partition` by its type —
 * adding a fourth partition to `cell-context.ts` will not compile until someone
 * decides what it offers, which is the point.
 */
export const PARTITION_SERVICES: Record<Partition, ReadonlySet<ServiceId>> = {
  // Commercial. The only partition with a route to the public internet endpoint
  // in the deployment shape this app has.
  aws: new Set<ServiceId>(["s3", "anthropic-public-api"]),
  // S3 is a GovCloud service. `api.anthropic.com` is not: sending student
  // records from a GovCloud cell to a commercial SaaS endpoint is the failure
  // an operator chose GovCloud to prevent.
  "aws-us-gov": new Set<ServiceId>(["s3"]),
  // S3 is present in Beijing and Ningxia. `api.anthropic.com` is not reachable
  // as a matter of both partition isolation and the law of the jurisdiction.
  "aws-cn": new Set<ServiceId>(["s3"]),
}

export class PartitionServiceError extends Error {
  constructor(
    readonly service: ServiceId,
    readonly partition: string,
  ) {
    super(
      partition in PARTITION_SERVICES
        ? `"${service}" does not exist in the "${partition}" partition, and this process is running in it. ` +
            `The call site must degrade or use a partition-local equivalent — reaching across a partition ` +
            `boundary is how a tenant who chose that partition stops being in it.`
        : `"${partition}" is not a partition this build knows (aws, aws-us-gov, aws-cn), so nothing can be ` +
            `said about whether "${service}" exists in it. Refusing rather than assuming commercial AWS.`,
    )
    this.name = "PartitionServiceError"
  }
}

/**
 * Whether `service` exists in `partition`.
 *
 * `partition` is `string` rather than `Partition` on purpose: the value that
 * reaches here comes from `AWS_PARTITION` through a cast, so the type is a
 * claim about the environment and not a guarantee about the value.
 */
export function serviceAvailableIn(service: ServiceId, partition: string): boolean {
  const offered: ReadonlySet<ServiceId> | undefined = (
    PARTITION_SERVICES as Record<string, ReadonlySet<ServiceId>>
  )[partition]
  return offered ? offered.has(service) : false
}

/** Whether `service` exists in the partition **this process** is running in. */
export function serviceAvailableHere(service: ServiceId): boolean {
  return serviceAvailableIn(service, cellContext().partition)
}

/**
 * Assert `service` exists here, or throw naming both the service and the
 * partition.
 *
 * For call sites that have no honest degraded behaviour — building a client for
 * a service that is not there produces requests to an endpoint that either does
 * not resolve or, worse, resolves in the wrong partition.
 */
export function requireService(
  service: ServiceId,
  partition: string = cellContext().partition,
): void {
  if (!serviceAvailableIn(service, partition)) {
    throw new PartitionServiceError(service, partition)
  }
}
