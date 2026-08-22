import { ALL_PARTITIONS, cellContext, type Partition } from "@/lib/cell-context"

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
 * The matrix. One row per service, one explicit decision per partition.
 *
 * ## Why the type is derived from the table instead of declared beside it
 *
 * `ServiceId` used to be a hand-written union, and the matrix a separate
 * `Record<Partition, ReadonlySet<ServiceId>>`. That checked the two axes very
 * differently, and only one of them was actually checked. The partition axis
 * was exhaustive — a fourth partition will not compile until every row names
 * it. The SERVICE axis was not constrained at all, because a `Set<ServiceId>`
 * governs what may go *into* it and says nothing about what must. A service
 * added to the union and to no row compiled cleanly and answered "unavailable"
 * in all three partitions, including the commercial one that can plainly reach
 * it — so the first symptom would have been the pilot losing a feature, with a
 * refusal message blaming a partition that was not the problem.
 *
 * That is measured, not assumed: adding a third member to the union left
 * `tsc --noEmit` clean and all fifteen tests in this file green.
 *
 * Deriving `ServiceId` from `keyof` makes the state unrepresentable rather than
 * merely detectable. A service name *is* a key of this table, so there is no
 * way to name one the table has not decided; a call site asking for a service
 * with no row fails at the call site, naming it, instead of being quietly told
 * "no" everywhere.
 *
 * `satisfies` closes the other axis at the same time: every row must decide
 * every partition explicitly. Not "listed means yes, absent means no" — in the
 * old shape a `false` somebody reasoned about and an entry nobody wrote were
 * the same absence, and only one of them is a decision.
 */
const SERVICE_AVAILABILITY = {
  /**
   * Document storage. `lib/s3.ts`. Present in GovCloud and in both China
   * regions — the matrix is a statement about reality, not a convenient way to
   * say no, so this row is `true` three times.
   */
  s3: { aws: true, "aws-us-gov": true, "aws-cn": true },
  /**
   * `api.anthropic.com`. Not an AWS service at all, which is exactly why it
   * needs a row: a cell in GovCloud or China has no partition-local route to a
   * public-internet SaaS endpoint, and a configured key does not create one.
   * Sending student records from a GovCloud cell to a commercial endpoint is
   * the failure an operator chose GovCloud to prevent.
   */
  "anthropic-public-api": { aws: true, "aws-us-gov": false, "aws-cn": false },
} as const satisfies Record<string, Record<Partition, boolean>>

/**
 * The services this application reaches. Not every AWS service — the ones with
 * a call site in `apps/web`, which `tests/architecture/forbidden-clients.test.mjs`
 * bounds to the adapters that own a client.
 */
export type ServiceId = keyof typeof SERVICE_AVAILABILITY

/**
 * Every service, enumerable at runtime.
 *
 * A TypeScript union cannot be iterated, so while `ServiceId` was hand-written
 * no test could loop over the services — every assertion had to name one, and a
 * service nobody named was a service nobody checked. Derived from the table's
 * own keys so it cannot be the stale copy.
 */
export const ALL_SERVICES: readonly ServiceId[] = Object.keys(
  SERVICE_AVAILABILITY,
) as ServiceId[]

/**
 * The same matrix keyed the other way: what each partition offers.
 *
 * Derived rather than written, so the two views cannot disagree. A second
 * hand-maintained list would be a second answer, and the one that drifts is
 * whichever nobody looks at.
 */
const partitionServices = {} as Record<Partition, ReadonlySet<ServiceId>>
for (const partition of ALL_PARTITIONS) {
  partitionServices[partition] = new Set(
    ALL_SERVICES.filter((service) => SERVICE_AVAILABILITY[service][partition]),
  )
}

export const PARTITION_SERVICES: Record<Partition, ReadonlySet<ServiceId>> = partitionServices

/**
 * Whether `key` is a row this file wrote, as opposed to one every object has.
 *
 * `key in table` and `table[key]` both walk the prototype chain, so `"toString"`
 * and `"constructor"` answer as though they were services. `serviceAvailableIn`
 * still refused them — `Function.prototype["aws"]` is undefined, so the second
 * lookup failed — but it refused them by luck rather than by construction, and
 * the refusal MESSAGE got it wrong: it reported a real service missing from a
 * partition instead of a name that is not a service at all, which sends whoever
 * reads the log to the wrong place entirely.
 */
function hasOwnRow(table: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(table, key)
}

/**
 * What a refusal says, in the three ways it can be reached.
 *
 * Separated so each branch names the actual problem. "Unavailable" for a
 * service this build has never heard of and "unavailable" for a service
 * deliberately withheld from a partition send an operator to completely
 * different places, and a single message cannot do both.
 */
function refusalMessage(service: string, partition: string): string {
  if (!hasOwnRow(SERVICE_AVAILABILITY, service)) {
    return (
      `"${service}" is not a service this build has decided about, so nothing can be said about ` +
      `whether the "${partition}" partition offers it. Give it a row in SERVICE_AVAILABILITY ` +
      `(lib/partition-services.ts). Refusing rather than assuming it is reachable.`
    )
  }
  if (!hasOwnRow(PARTITION_SERVICES, partition)) {
    return (
      `"${partition}" is not a partition this build knows (${ALL_PARTITIONS.join(", ")}), so ` +
      `nothing can be said about whether "${service}" exists in it. Refusing rather than ` +
      `assuming commercial AWS.`
    )
  }
  return (
    `"${service}" does not exist in the "${partition}" partition, and this process is running ` +
    `in it. The call site must degrade or use a partition-local equivalent — reaching across a ` +
    `partition boundary is how a tenant who chose that partition stops being in it.`
  )
}

export class PartitionServiceError extends Error {
  constructor(
    readonly service: ServiceId,
    readonly partition: string,
  ) {
    super(refusalMessage(service, partition))
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
  // Both lookups are widened to `string` deliberately. The parameters are
  // typed, but a value that crossed a JSON boundary or an `as` cast arrives
  // here unchecked, and this function must answer "no" for it rather than
  // throw a TypeError the caller has no branch for.
  if (!hasOwnRow(SERVICE_AVAILABILITY, service)) return false
  const row: Readonly<Record<string, boolean>> = (
    SERVICE_AVAILABILITY as Readonly<Record<string, Readonly<Record<string, boolean>>>>
  )[service]
  if (!hasOwnRow(row, partition)) return false
  // `=== true`, not truthiness: an absent partition key must read as a refusal
  // and not as an answer.
  return row[partition] === true
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
