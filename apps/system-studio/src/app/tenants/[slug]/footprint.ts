/**
 * "Where it is" — one tenant's live AWS resources, grouped by service, and
 * attributed by tag.
 *
 * ── The question this answers, and the one it refuses to ───────────────────
 *
 * An operator looking at a tenant asks "what is actually running for this
 * customer, and where". Until this existed the page could answer neither: it
 * showed what the ARTIFACT wanted (drift), what could be OBSERVED of the host
 * (certificates, alarms, backups) and what the state was SUPPOSED to retain
 * (the residual note) — three surfaces, none of which is an inventory.
 *
 * Attribution comes from the `tenure:tenant` tag and from nothing else. That
 * decision is not made here: `tags.ts` makes it once, on the way out of the
 * Tagging API, and carries it on the resource. This module reads the decision
 * and never re-derives it, because two implementations of "which tenant owns
 * this" is how a bucket called `acme-backups` gets charged to `acme` and
 * `acme-staging` gets silently folded into it.
 *
 * ── Unattributable is a finding, not a rounding error ──────────────────────
 *
 * `forTenant` returns the tenant's resources AND the ones nobody claimed, and
 * this keeps them apart all the way to the render. A page showing only the seven
 * resources it could attribute lets an operator believe the estate is fully
 * attributed; the whole point of the third arm is that somebody has to see it.
 *
 * ── An ARN that does not parse is counted, never dropped ───────────────────
 *
 * `parseArn` returns null rather than half a parse. A resource whose ARN this
 * console cannot read is still a resource the tenant is holding and still costs
 * money, so it is counted and named as unreadable rather than filed under a
 * service called "" — which would render as a blank row somebody scrolls past.
 *
 * No `server-only` and no `@/` alias, so a plain Node test can drive it. See the
 * same note at the top of `summary.ts`.
 */

import { parseArn } from "../../../lib/aws/inventory"
import { forTenant, type TaggedResource } from "../../../lib/aws/tags"

/** One AWS service, and everything this tenant holds in it. */
export interface ServiceFootprint {
  /** The ARN's service field — `ecs`, `rds`, `s3`. Never a name prefix. */
  service: string
  count: number
  /**
   * Every region these resources are in, deduplicated and sorted.
   *
   * An ARN with an empty region field is reported as such rather than as
   * "global": S3 and IAM both leave it empty and only one of them means the
   * resource is not regional, so calling either one global would be this console
   * inventing a fact about placement.
   */
  regions: readonly string[]
  /** The ARNs themselves, sorted, so two renders of the same estate agree. */
  arns: readonly string[]
}

export interface TenantFootprint {
  services: readonly ServiceFootprint[]
  /** How many resources carry this tenant's tag. */
  total: number
  /** Resources nobody claimed, across the whole estate. A finding in its own right. */
  unattributable: number
  /**
   * This tenant's resources whose ARN could not be parsed.
   *
   * Included in `total` — they are held — and excluded from `services`, because
   * there is no service to file them under. Named so the count and the rows can
   * be reconciled by eye.
   */
  unreadableArns: readonly string[]
}

/** What an ARN with no region says, in words rather than as an empty cell. */
export const REGION_NOT_IN_ARN = "not named in the ARN"

/**
 * What this tenant holds, from a completed read of the Tagging API.
 *
 * Takes the resources rather than performing the read, so every arm is
 * reachable from a test — and so the page passes the reading it already made
 * for the drift comparison instead of asking AWS twice.
 *
 * The filter is `forTenant` from `tags.ts`, called rather than reimplemented.
 */
export function footprintOf(
  resources: readonly TaggedResource[],
  slug: string,
): TenantFootprint {
  const { mine, unattributable } = forTenant(resources, slug)

  const byService = new Map<string, { arns: string[]; regions: Set<string> }>()
  const unreadableArns: string[] = []

  for (const resource of mine) {
    const parsed = parseArn(resource.arn)
    if (parsed === null) {
      unreadableArns.push(resource.arn)
      continue
    }
    const entry = byService.get(parsed.service) ?? { arns: [], regions: new Set<string>() }
    entry.arns.push(resource.arn)
    entry.regions.add(parsed.region === "" ? REGION_NOT_IN_ARN : parsed.region)
    byService.set(parsed.service, entry)
  }

  const services: ServiceFootprint[] = [...byService.entries()]
    .map(([service, entry]) => ({
      service,
      count: entry.arns.length,
      regions: [...entry.regions].sort(),
      arns: [...entry.arns].sort(),
    }))
    // Biggest first, then alphabetical. Deterministic, because an operator
    // comparing this page against the same page an hour ago is comparing the
    // ORDER as much as the numbers.
    .sort((a, b) => b.count - a.count || a.service.localeCompare(b.service))

  return {
    services,
    total: mine.length,
    unattributable: unattributable.length,
    unreadableArns: unreadableArns.sort(),
  }
}

/**
 * The sentence the footprint panel opens with.
 *
 * Says what was counted and what it was counted FROM, because "3 resources" is
 * a number an operator cannot argue with and "3 resources carrying
 * tenure:tenant=acme" is one they can.
 */
export function describeFootprint(footprint: TenantFootprint, slug: string): string {
  const held =
    footprint.total === 0
      ? `Nothing in this estate carries tenure:tenant=${slug}.`
      : `${footprint.total} ${footprint.total === 1 ? "resource carries" : "resources carry"} ` +
        `tenure:tenant=${slug}, across ${footprint.services.length} ` +
        `${footprint.services.length === 1 ? "service" : "services"}.`

  const unreadable =
    footprint.unreadableArns.length === 0
      ? ""
      : ` ${footprint.unreadableArns.length} of them have an ARN this console could not parse and ` +
        "are listed below rather than filed under a service."

  const orphans =
    footprint.unattributable === 0
      ? " Every resource the Tagging API returned is attributed to a tenant or marked shared."
      : ` A further ${footprint.unattributable} ${
          footprint.unattributable === 1 ? "resource in this estate carries" : "resources in this estate carry"
        } no tenure:tenant tag at all, so ${
          footprint.unattributable === 1 ? "it cannot" : "they cannot"
        } be charged to anybody or found when a tenant is deleted. That is an estate finding rather than this tenant's, and it is here because a page that hid it would let an operator believe the estate is fully attributed.`

  return `${held}${unreadable}${orphans}`
}
