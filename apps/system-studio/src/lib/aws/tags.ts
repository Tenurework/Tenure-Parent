/**
 * STUDIO-000-008 / STUDIO-070-002 — the join key between an AWS resource and a
 * tenant.
 *
 * Attribution comes from a tag and from nothing else. The alternative that
 * always gets proposed — inferring the tenant from a resource NAME — is how a
 * bill gets charged to `acme` because a bucket happens to start with "acme",
 * and how `acme-staging` is silently attributed to `acme`. A name is a label
 * somebody typed; a tag is a fact somebody set.
 *
 * The Resource Groups Tagging API is the right reader for this because it is
 * the only one that answers "every resource in this region, with its tags" in
 * one paged call. Asking each service for its own resources and then asking for
 * their tags is N+1 calls against N different throttles.
 */

import {
  REQUIRED_RESOURCE_TAGS,
  SHARED,
  tagProblems,
  tenantAttribution,
  type TagProblem,
} from "@tenure/provisioning"

import { INVENTORY_REFRESH_MS } from "./capabilities"
import {
  liveGateway,
  readAws,
  type AwsGateway,
  type AwsRead,
  type DenialContext,
} from "./read"

/**
 * The tag every provisioned resource carries. One spelling, in one place — and
 * that place is `@tenure/provisioning`, because the same twelve keys are what
 * the Terraform in `infrastructure/` is checked against. A second spelling here
 * would be a console that cannot read the estate its own stacks tag.
 */
export const TENANT_TAG = REQUIRED_RESOURCE_TAGS[0]

/**
 * The VALUE `tenure:tenant` carries when a resource deliberately belongs to no
 * tenant.
 *
 * A value, not a separate key. "Somebody decided this is shared" and "nobody
 * tagged it" have to be different facts, and a missing key can only ever mean
 * the second — so the first needs somewhere to be written down.
 */
export const SHARED_TAG = SHARED

export { REQUIRED_RESOURCE_TAGS, tagProblems }
export type { TagProblem }

export interface TaggedResource {
  arn: string
  tags: Readonly<Record<string, string>>
  /**
   * Who it belongs to. Decided here, once, on the way out of the API.
   *
   * Carried on the resource rather than recomputed per surface, so the estate
   * page, the findings and a tenant's own page cannot disagree about which
   * resources are somebody's.
   */
  attribution: Attribution
  /**
   * Every way this resource fails the twelve-key contract.
   *
   * Computed for EVERY result, not for a sample and not only for the ones that
   * attributed — the resources that fail the contract are precisely the ones a
   * filtered survey would leave out. Empty means compliant.
   */
  problems: readonly TagProblem[]
}

/** The Tagging API's shape, declared rather than imported — see client.ts. */
interface GetResourcesResponse {
  PaginationToken?: string
  ResourceTagMappingList?: Array<{
    ResourceARN?: string
    Tags?: Array<{ Key?: string; Value?: string }>
  }>
}

/** How many pages to walk before giving up. A runaway page loop is an outage. */
const MAX_PAGES = 20

export async function taggedResources(
  supplied?: AwsGateway,
  options: { now?: () => Date; denial?: DenialContext } = {},
): Promise<AwsRead<readonly TaggedResource[]>> {
  const gw = supplied ?? liveGateway()
  return readAws<readonly TaggedResource[]>(
    "tag:GetResources",
    async () => {
      const out: TaggedResource[] = []
      let token: string | undefined
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const response = (await gw.call("tag:GetResources", {
          PaginationToken: token,
        })) as GetResourcesResponse

        for (const mapping of response?.ResourceTagMappingList ?? []) {
          if (!mapping.ResourceARN) continue
          const tags: Record<string, string> = {}
          for (const tag of mapping.Tags ?? []) {
            if (tag.Key) tags[tag.Key] = tag.Value ?? ""
          }
          // STUDIO-070-002. The contract is applied HERE, on every result, at
          // the one place every result passes through. A caller that wanted to
          // skip it would have to work at it.
          out.push({
            arn: mapping.ResourceARN,
            tags,
            attribution: attributionOf(tags),
            problems: tagProblems(tags),
          })
        }

        token = response?.PaginationToken || undefined
        if (!token) break
      }
      return out
    },
    { now: options.now, denial: options.denial },
  )
}

/** How a resource is attributed. Three answers, and "unattributed" is one of them. */
export type Attribution =
  | { kind: "tenant"; tenantSlug: string }
  | { kind: "shared" }
  | { kind: "unattributed" }

/**
 * Which tenant owns a resource, from its tags alone.
 *
 * STUDIO-070-002. The decision itself is `tenantAttribution` in
 * `@tenure/provisioning`, which is also what the Terraform that WRITES the tags
 * is checked against (`tests/architecture/resource-tags.test.mjs`). This
 * function is the shape adapter, and it is deliberately nothing more: two
 * independent implementations of "which tenant owns this" is how the stack
 * writes `tenure:tenant = tenure:shared` and the console reads back a tenant
 * whose slug is literally "tenure:shared".
 *
 * That was not hypothetical. This function previously keyed `shared` off a
 * SEPARATE tag (`tenure:shared = "true"`) while the contract makes it a VALUE of
 * `tenure:tenant`, so every control-plane resource in the studio stack would
 * have been attributed to a tenant that does not exist — and billed to it.
 *
 * `unattributed` is returned rather than guessed, and it is the finding: an
 * untagged resource cannot be charged to anybody, cannot be found when a tenant
 * is deleted, and is exactly what STUDIO-080-007 looks for.
 */
export function attributionOf(tags: Readonly<Record<string, string>>): Attribution {
  const decided = tenantAttribution(tags)
  switch (decided.kind) {
    case "tenant":
      return { kind: "tenant", tenantSlug: decided.slug }
    case "shared":
      return { kind: "shared" }
    case "unattributable":
      return { kind: "unattributed" }
  }
}

/**
 * What a survey of the estate found, counted the way an operator asks about it.
 *
 * `unattributable` is separate from `shared` and always will be. Folding the
 * two — which is what any "tenant ?? 'shared'" would do — is how an untagged
 * NAT gateway becomes forty customers' problem.
 */
export interface TagCompliance {
  total: number
  attributed: number
  shared: number
  unattributable: number
  /** Carrying at least one contract problem, attributed or not. */
  nonCompliant: number
}

export function tagCompliance(resources: readonly TaggedResource[]): TagCompliance {
  return {
    total: resources.length,
    attributed: resources.filter((r) => r.attribution.kind === "tenant").length,
    shared: resources.filter((r) => r.attribution.kind === "shared").length,
    unattributable: resources.filter((r) => r.attribution.kind === "unattributed").length,
    nonCompliant: resources.filter((r) => r.problems.length > 0).length,
  }
}

/** The resources tagged for one tenant, and the ones nobody claimed. */
export function forTenant(
  resources: readonly TaggedResource[],
  slug: string,
): { mine: readonly TaggedResource[]; unattributable: readonly TaggedResource[] } {
  return {
    mine: resources.filter(
      (r) => r.attribution.kind === "tenant" && r.attribution.tenantSlug === slug,
    ),
    // Travels with the tenant's own list deliberately. A page showing only the
    // four resources it could attribute lets an operator believe the estate is
    // fully attributed, and the whole point of the third arm is that somebody
    // has to see it.
    unattributable: resources.filter((r) => r.attribution.kind === "unattributed"),
  }
}

/**
 * The sentence a surface prints for one resource's attribution.
 *
 * One renderer, for the same reason `describeRead` is one renderer: an
 * unattributable resource must not read as "shared" on one page and as "—" on
 * another. The unattributable arm carries the missing key by name, because
 * "unknown" sends an operator looking and "missing tenure:tenant" sends them to
 * the fix.
 */
export function describeAttribution(attribution: Attribution): string {
  switch (attribution.kind) {
    case "tenant":
      return attribution.tenantSlug
    case "shared":
      return `shared (${SHARED_TAG}) — platform overhead, decided`
    case "unattributed":
      return "unattributable — missing tenure:tenant"
  }
}

/** A lookup from ARN to tags, for joining a service read against the tag index. */
export function tagIndex(resources: readonly TaggedResource[]): Map<string, Readonly<Record<string, string>>> {
  return new Map(resources.map((r) => [r.arn, r.tags]))
}

export { INVENTORY_REFRESH_MS }
