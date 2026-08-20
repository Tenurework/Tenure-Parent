import { parseArn } from "../aws/inventory"
import type { Reading } from "../../app/tenants/[slug]/summary"

/**
 * STUDIO-060-004, the `users` axis — how many people a change reaches.
 *
 * ## Why this module exists at all
 *
 * `blast-radius.ts` shipped eleven axes computed and one — `users` — pushed as
 * an unconditional "could not look", on the stated grounds that "this control
 * plane holds no user table". That is true and it is not the whole truth: the
 * console does not hold user ROWS, and it does read the identity stores those
 * rows live in. `cognito-idp:DescribeUserPool` returns
 * `EstimatedNumberOfUsers`, `lib/aws/cognito.ts` already carries it as
 * `PoolDetail.estimatedUsers`, and a pool is attributed to a tenant by its own
 * tags. A COUNT is not a user record: nothing here reads, stores or logs a
 * person, so `tests/security/no-personal-data.test.mjs` has nothing to object
 * to, and an operator about to suspend a tenant learns how many people that
 * interrupts.
 *
 * ## The four ways this refuses to answer, and why none of them is zero
 *
 * A blast radius that understates is the dangerous direction — the module's own
 * rule about `regions` — so every one of these is `known: false` with the read
 * that would fix it, and none is `0`:
 *
 *   1. the estate was never attributed to this tenant, so which pools are its
 *      pools is unknown;
 *   2. the attribution succeeded and named no user pool, which means this
 *      tenant's people are in a directory this console cannot see — a shared
 *      pool, or the cell's own — and not that it has no users;
 *   3. a pool that IS its own could not be described;
 *   4. a pool was described and AWS returned no estimate for it.
 *
 * Only when every attributed pool answered is a number returned, and it is the
 * SUM: a tenant with two pools has two front doors and both of them are people.
 *
 * Pure. No clock, no network, no environment — the caller supplies the readings.
 */

/** The service half of a user-pool ARN, as IAM spells it. */
export const USER_POOL_SERVICE = "cognito-idp"

/** The resource half. `userpool/us-east-1_ABC123` — the id is what follows. */
const USER_POOL_RESOURCE = /^userpool\/(.+)$/

/** What the axis counts, once it can be counted. */
export interface TenantUsers {
  count: number
  /** The pools the number came from, so a reader can go and look. */
  stores: readonly string[]
}

/** One pool's answer to "how many people are in you". */
export interface PoolUserReading {
  poolId: string
  /**
   * The pool's estimate, the reason it could not be read, or a KNOWN `null`.
   *
   * The three are different: a refused `DescribeUserPool` is `known: false`,
   * and a pool that was described while AWS returned no `EstimatedNumberOfUsers`
   * is `known: true, value: null`. Collapsing them would report a permissions
   * problem as a quirk of the service, and they have different remedies.
   */
  users: Reading<number | null>
}

/**
 * The user-pool ids among a tenant's attributed ARNs.
 *
 * Reads the ARN rather than matching on a name: a pool called
 * `tenure-simon-users` is a string somebody typed, and `cognito.ts` refuses to
 * identify its own console pool by name for exactly this reason. Anything that
 * is not a parseable `cognito-idp` user-pool ARN is simply not one of these —
 * the attributed list carries every service in the estate.
 */
export function userPoolIdsFrom(arns: readonly string[]): readonly string[] {
  const ids: string[] = []
  for (const arn of arns) {
    const parsed = parseArn(arn)
    if (!parsed || parsed.service !== USER_POOL_SERVICE) continue
    const match = USER_POOL_RESOURCE.exec(parsed.resource)
    if (match) ids.push(match[1])
  }
  return [...new Set(ids)].sort()
}

const cannot = (because: string, fix: string): Reading<TenantUsers> => ({
  known: false,
  because,
  fix,
})

/**
 * How many people this tenant's change reaches.
 *
 * @param attributed every ARN the estate attributed to this tenant, or `null`
 *   when the estate was not attributed at all.
 * @param pools what each of its user pools answered. The caller reads these;
 *   deciding which pools to read is `userPoolIdsFrom`'s job, and it is a
 *   separate function so a caller cannot read one set and count another.
 */
export function tenantUsers(
  attributed: readonly string[] | null,
  pools: readonly PoolUserReading[],
): Reading<TenantUsers> {
  if (attributed === null) {
    return cannot(
      "the estate was not attributed to this tenant, so which identity stores are its own is unknown",
      "Give this engine the tag read the estate footprint needs; the user count is derived from the same attribution.",
    )
  }

  const ids = userPoolIdsFrom(attributed)
  if (ids.length === 0) {
    return cannot(
      "no user pool is attributed to this tenant, so the directory its people sign in through is not one this console can see — a pooled tenant shares somebody else's, and a cell-resident directory is not in this estate at all",
      "Tag the tenant's user pool with tenure:tenant, or add a per-tenant user-count read to the cell's operations API and pass it in. Do not copy user rows into the control plane.",
    )
  }

  // Every attributed pool must answer. A sum over the pools that happened to
  // reply is a number smaller than the truth, presented as the truth.
  const unread = pools.filter((p) => !p.users.known)
  if (unread.length > 0) {
    const first = unread[0].users
    if (first.known) throw new Error("unreachable: filtered to unknown readings")
    return cannot(
      `${unread.map((p) => p.poolId).join(", ")} could not be described, and a count over the rest would be smaller than the truth: ${first.because}`,
      first.fix,
    )
  }

  const missing = ids.filter((id) => !pools.some((p) => p.poolId === id))
  if (missing.length > 0) {
    return cannot(
      `${missing.join(", ")} is attributed to this tenant and was not read at all`,
      "Read every pool `userPoolIdsFrom` returns; a count over a subset of a tenant's directories understates who a change reaches.",
    )
  }

  const noEstimate = pools.filter((p) => p.users.known && p.users.value === null)
  if (noEstimate.length > 0) {
    return cannot(
      `${noEstimate.map((p) => p.poolId).join(", ")} was described and returned no EstimatedNumberOfUsers`,
      "Nothing is misconfigured; the service did not supply the figure. Read it again, or count the pool's users in the AWS console.",
    )
  }

  return {
    known: true,
    value: {
      count: pools.reduce((sum, p) => sum + (p.users.known ? (p.users.value ?? 0) : 0), 0),
      stores: pools.map((p) => p.poolId),
    },
  }
}
