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
 *
 * ── The correction this module exists to make ───────────────────────────────
 *
 * `tag:GetResources` is not a census. It is a REGIONAL index, and it does not
 * carry every resource type. Both of those mean the same dangerous thing:
 *
 *   an ARN absent from the index is NOT an untagged resource.
 *
 * It may be a CloudFront distribution or a Route 53 hosted zone, whose ARNs
 * carry no region at all and which a regional index therefore never returns. It
 * may be a bucket in another region. It may be a resource type the API does not
 * carry. Every one of those renders identically to "somebody forgot to tag it"
 * if the two are conflated, and a cost report built on that conflation
 * misattributes silently — the worst failure a cost report has, because it
 * still adds up.
 *
 * So coverage is modelled explicitly, in four classes plus the one the type
 * system forces:
 *
 *   tagged-to-tenant    the tag says a slug
 *   tagged-shared       the tag says `tenure:shared` — somebody DECIDED
 *   untagged            tags were read, and there is no `tenure:tenant`.
 *                       A FINDING: this is spend nobody owns.
 *   not-coverable       this API cannot answer for this resource. Read the
 *                       service's own tag API instead — named, per resource.
 *   unknown             the read itself failed. STUDIO-000-007: a denial is not
 *                       a zero, and it is emphatically not "untagged".
 *
 * Where a service's own API exposes tags — S3's `GetBucketTagging`, Cognito's
 * `UserPoolTags` — that answer is preferred over the index, because it is the
 * service speaking about its own resource rather than an index that may not
 * have caught up. Every answer carries the path it came from (`TagSource`), so
 * a surface can print WHICH read decided an attribution rather than asserting
 * one flatly.
 */

import {
  REQUIRED_RESOURCE_TAGS,
  SHARED,
  tagProblems,
  tenantAttribution,
  type TagProblem,
} from "@tenure/provisioning"

import { INVENTORY_REFRESH_MS, type Capability } from "./capabilities"
// Type-only, deliberately. `identity.ts` is a reader with its own runtime graph,
// and this module is imported by a component rendered under apps/web's jest;
// pulling a second reader's graph in behind it would make every consumer of a
// pure projection pay for an SDK call path it never makes. The identity ARRIVES
// as an argument — resolved by the surface, which has already resolved it.
import type { Identity } from "./identity"
import {
  describeRead,
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
  /**
   * The untagged resources themselves, not just how many.
   *
   * Spend nobody owns is an operational finding, so it is output rather than a
   * residue of a count. Each carries the ARN, the service, the path that
   * decided it and the sentence that fixes it — which is what an operator needs
   * to act, and what "unattributable: 3" can never give them.
   */
  unowned: readonly UnownedResource[]
}

export function tagCompliance(resources: readonly TaggedResource[]): TagCompliance {
  // Through the coverage core, not a second filter over the same array. Two
  // implementations of "which of these is nobody's" is exactly how the panel on
  // /platform/estate and a tenant's own page come to disagree.
  const covered = coverageFromIndex(resources)
  const summary = coverageSummary(covered)
  return {
    total: summary.total,
    attributed: summary.tenant,
    shared: summary.shared,
    unattributable: summary.untagged,
    nonCompliant: covered.filter((r) => r.problems !== null && r.problems.length > 0).length,
    unowned: unownedResources(covered),
  }
}

/** The resources tagged for one tenant, and the ones nobody claimed. */
export function forTenant(
  resources: readonly TaggedResource[],
  slug: string,
): {
  mine: readonly TaggedResource[]
  unattributable: readonly TaggedResource[]
  /** The same resources as `unattributable`, as findings an operator can act on. */
  unowned: readonly UnownedResource[]
} {
  // `coverageFromIndex` is 1:1 and order-preserving with `resources`, so the
  // two lists are zipped by position rather than joined on ARN. An ARN is not a
  // primary key in a survey — the same bucket can appear twice across two pages
  // — and a join would silently deduplicate what the API actually returned.
  const covered = coverageFromIndex(resources)
  const mine: TaggedResource[] = []
  const unattributable: TaggedResource[] = []
  covered.forEach((c, i) => {
    if (c.coverage.kind === "tenant" && c.coverage.tenantSlug === slug) mine.push(resources[i])
    if (c.coverage.kind === "untagged") unattributable.push(resources[i])
  })
  return {
    mine,
    // Travels with the tenant's own list deliberately. A page showing only the
    // four resources it could attribute lets an operator believe the estate is
    // fully attributed, and the whole point of the third arm is that somebody
    // has to see it.
    unattributable,
    unowned: unownedResources(covered),
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

/* ═══════════════════════════════════════════════════════ ARN anatomy ═════ */

/**
 * An ARN, taken apart.
 *
 * Parsed rather than pattern-matched because two of the coverage decisions below
 * turn on fields inside it: `region` is `""` for a global resource, and a global
 * resource's absence from a REGIONAL index proves nothing at all. Deriving that
 * from the ARN means the rule holds for every service, including ones nobody has
 * written a reader for yet, instead of only for the ones somebody remembered to
 * put in a list.
 *
 * `arn:PARTITION:SERVICE:REGION:ACCOUNT:RESOURCE`, where RESOURCE is one of
 * `id`, `type/id` or `type:id`. Returns null rather than a partly-filled record
 * — a half-parsed ARN joined against the index matches nothing, which reads
 * exactly like an untagged resource, which is the confusion this file exists to
 * prevent.
 */
export interface ParsedArn {
  /** `aws`, `aws-us-gov`, `aws-cn`. Whatever the ARN says; never assumed. */
  partition: string
  /** The ARN's service segment: `s3`, `cognito-idp`, `elasticloadbalancing`. */
  service: string
  /** `""` for a global resource — CloudFront, Route 53, IAM, an S3 bucket. */
  region: string
  /** `""` where the ARN carries none, as S3 bucket and Route 53 ARNs do. */
  accountId: string
  /** `distribution` in `.../distribution/E123`. `""` when the ARN has no type. */
  resourceType: string
  resourceId: string
}

export function parseArn(arn: string): ParsedArn | null {
  if (typeof arn !== "string") return null
  const parts = arn.split(":")
  if (parts.length < 6 || parts[0] !== "arn") return null
  const [, partition, service, region, accountId] = parts
  if (!partition || !service) return null
  const rest = parts.slice(5).join(":")
  if (rest === "") return null

  // `type/id` and `type:id` are both real ARN forms and a resource id may
  // contain either character — a log group id contains `:`, an object key
  // contains `/`. The FIRST separator is the one that divides type from id;
  // anything after it belongs to the id.
  const slash = rest.indexOf("/")
  const colon = rest.indexOf(":")
  const cut =
    slash === -1 && colon === -1
      ? -1
      : slash === -1
        ? colon
        : colon === -1
          ? slash
          : Math.min(slash, colon)

  return {
    partition,
    service,
    region,
    accountId,
    resourceType: cut === -1 ? "" : rest.slice(0, cut),
    resourceId: cut === -1 ? rest : rest.slice(cut + 1),
  }
}

/* ═══════════════════════════════════ the scope the index answered for ════ */

/**
 * The partition, region and account an answer is about.
 *
 * `tag:GetResources` is not merely regional — it is regional AND single-account
 * AND single-partition. It indexes the resources of the account the caller's
 * credentials resolve to, in the region the client resolved to, in that
 * account's partition, and nothing else. Three separate ways for a resource to
 * be absent from it for reasons that say nothing whatsoever about its tags.
 *
 * Every field is nullable and null means UNRESOLVED — not "aws", not the
 * region an environment variable happens to hold, not the account somebody
 * pasted in a comment. STUDIO-000-007 in miniature: an unresolved scope makes
 * absences render `unknown`, never `untagged`, because "I do not know which
 * account the index answered for" cannot be turned into a finding against a
 * resource.
 */
export interface ArnScope {
  /** `aws`, `aws-us-gov`, `aws-cn`. Null until something resolves it. */
  partition: string | null
  /** The region `tag:GetResources` was called in. Null until resolved. */
  region: string | null
  /** The account whose resources the index carries. Null until resolved. */
  accountId: string | null
}

/** Nothing resolved. The starting point, and never a silent default. */
export const UNRESOLVED_SCOPE: ArnScope = { partition: null, region: null, accountId: null }

/**
 * The scope a resolved identity establishes.
 *
 * `resolveIdentity` learns all three from `sts:GetCallerIdentity` — the account
 * from `Account`, the partition from the caller ARN's second segment, the region
 * from the client's own resolved config. A denied or errored identity yields
 * nulls rather than a partial guess, because a scope that is half-invented is
 * indistinguishable downstream from one that was read.
 */
export function arnScopeOf(identity: AwsRead<Identity>): ArnScope {
  if (identity.state !== "ACTUAL" && identity.state !== "STALE") return UNRESOLVED_SCOPE
  const { partition, region, accountId } = identity.value
  return {
    partition: partition || null,
    region: region || null,
    accountId: accountId || null,
  }
}

/**
 * The scope the index's OWN results prove, when nothing else resolved one.
 *
 * The ARNs `tag:GetResources` returned are, by construction, resources of the
 * account and partition it answered for. So the scope can be learnt from the
 * data rather than assumed — which matters because a console with no STS
 * permission can still read the tag index, and would otherwise have to render
 * every absence as unknown.
 *
 * Unanimity is required. A field is only concluded when every ARN that STATES
 * it states the same thing; a disagreement yields null, because a scope inferred
 * from a contradiction is worse than an unresolved one. Segments an ARN leaves
 * empty — an S3 bucket names no region and no account — are skipped rather than
 * counted as a value, since `""` is a fact about the ARN form and not about the
 * index.
 */
export function scopeFromIndex(resources: readonly TaggedResource[]): ArnScope {
  const partitions = new Set<string>()
  const regions = new Set<string>()
  const accounts = new Set<string>()
  for (const r of resources) {
    const parsed = parseArn(r.arn)
    if (!parsed) continue
    if (parsed.partition) partitions.add(parsed.partition)
    if (parsed.region) regions.add(parsed.region)
    if (parsed.accountId) accounts.add(parsed.accountId)
  }
  const only = (seen: Set<string>) => (seen.size === 1 ? [...seen][0] : null)
  return { partition: only(partitions), region: only(regions), accountId: only(accounts) }
}

/**
 * Field-wise preference between two scopes.
 *
 * Not an object spread: a `preferred` whose region is null must fall through to
 * the fallback's region rather than overwrite it with null. That is the whole
 * reason this exists — an identity that resolved an account but whose region
 * came back empty should still let the gateway's resolved region decide.
 */
export function mergeScope(preferred: ArnScope, fallback: ArnScope): ArnScope {
  return {
    partition: preferred.partition ?? fallback.partition,
    region: preferred.region ?? fallback.region,
    accountId: preferred.accountId ?? fallback.accountId,
  }
}

/* ══════════════════════════════════════════════ what the index misses ════ */

/**
 * A resource type this console does not let the Resource Groups Tagging API
 * answer for.
 *
 * Two different reasons live in one table, and both end at the same conclusion —
 * "absent from the index" is not an answer here:
 *
 *   there is a BETTER read     S3 and Cognito return their own tags, from the
 *                              service that owns the resource. `readInstead`
 *                              names the capability, and it is a real one from
 *                              `capabilities.ts` — this console can perform it
 *                              today.
 *   there is NO read at all    Route 53 and CloudFront tags need
 *                              `route53:ListTagsForResource` and
 *                              `cloudfront:ListTagsForResource`, neither of
 *                              which is in the capability registry. `remedy`
 *                              names the action a human must add. Until then
 *                              these render `not-coverable`, which is honest,
 *                              rather than `untagged`, which would be a
 *                              fabricated finding against a resource that is
 *                              very probably tagged correctly.
 *
 * The table is deliberately short. It is not an attempt to mirror AWS's
 * service-support matrix, which changes without notice and which nothing here
 * can verify; the general rule below — a global ARN cannot be concluded from a
 * regional index — catches the whole class without anyone maintaining a list.
 */
export interface TagApiGap {
  /** The ARN's service segment this gap applies to. */
  service: string
  /** The resource type, or `"*"` for every type in the service. `""` matches typeless ARNs. */
  resourceType: string
  why: string
  /** The capability that answers instead, when this console holds one. */
  readInstead: Capability | null
  /** What a human must add when `readInstead` is null. Never a claim that it exists. */
  remedy: string
}

export const TAG_API_GAPS: readonly TagApiGap[] = [
  {
    service: "s3",
    resourceType: "",
    why:
      "an S3 bucket ARN carries no region, so a regional tag index can neither confirm nor deny " +
      "a bucket's tags — absence means untagged OR in another region, and those are different facts",
    readInstead: "s3:GetBucketTagging",
    remedy: "",
  },
  {
    service: "cognito-idp",
    resourceType: "userpool",
    why:
      "cognito-idp:DescribeUserPool returns UserPoolTags — the service's own answer about its own " +
      "resource — which does not depend on the tag index having caught up",
    readInstead: "cognito-idp:DescribeUserPool",
    remedy: "",
  },
  {
    service: "route53",
    resourceType: "hostedzone",
    why:
      "a Route 53 hosted zone ARN carries no region, and this console holds no Route 53 tag " +
      "capability, so nothing here can state this zone's tags either way",
    readInstead: null,
    remedy:
      "add route53:ListTagsForResource to the capability registry and a reader for it; until then " +
      "a hosted zone's tenant tag is unread, not missing",
  },
  {
    service: "route53",
    resourceType: "healthcheck",
    why:
      "a Route 53 health check ARN carries no region, and this console holds no Route 53 tag " +
      "capability",
    readInstead: null,
    remedy:
      "add route53:ListTagsForResource to the capability registry and a reader for it; until then " +
      "a health check's tenant tag is unread, not missing",
  },
  {
    service: "cloudfront",
    resourceType: "distribution",
    why:
      "a CloudFront distribution is a global resource whose ARN carries no region, and this " +
      "console holds no CloudFront tag capability",
    readInstead: null,
    remedy:
      "add cloudfront:ListTagsForResource to the capability registry and a reader for it; until " +
      "then a distribution's tenant tag is unread, not missing",
  },
]

/** The gap covering this ARN, or null when the index is allowed to answer for it. */
export function tagApiGapFor(parsed: ParsedArn | null): TagApiGap | null {
  if (!parsed) return null
  return (
    TAG_API_GAPS.find(
      (gap) =>
        gap.service === parsed.service &&
        (gap.resourceType === "*" || gap.resourceType === parsed.resourceType),
    ) ?? null
  )
}

/* ═══════════════════════════════════════════════════════ the coverage ════ */

/**
 * Which read produced an answer.
 *
 * Carried on every arm that HAS an answer, because "this is tenant acme's" and
 * "the estate index, read 40 seconds ago in us-east-1, says this is tenant
 * acme's" are two different degrees of claim, and a cost report should be able
 * to print the second.
 */
export type TagSource =
  /** `tag:GetResources`. Regional — the region it answered for is part of the answer. */
  | { path: "tag-index"; capability: Capability; region: string | null }
  /** The service's own tag API, which outranks the index for its own resources. */
  | { path: "service-native"; capability: string }

/**
 * What a service's own tag API said, adapted by the reader that called it.
 *
 * A plain discriminated union rather than an `AwsRead`, so a reader can hand
 * over whatever its own tag fact looks like — `buckets.ts` has `BucketTagsFact`,
 * `cognito.ts` has `PoolDetail.tags` — without this module importing either and
 * without either having to restate its read state in a second vocabulary.
 *
 * `none` and `unreadable` are separate for the same reason `EMPTY` and `DENIED`
 * are separate in `AwsRead`: S3 answering `NoSuchTagSet` is a definitive
 * untagged, and S3 refusing the call is not an answer about tags at all.
 */
export type NativeTagAnswer =
  | { kind: "tags"; capability: string; tags: Readonly<Record<string, string>> }
  /** The service answered, and there are genuinely no tags. A finding. */
  | { kind: "none"; capability: string; why: string }
  /** The call failed. Not a finding — a hole. */
  | { kind: "unreadable"; capability: string; why: string }

/**
 * Who a resource belongs to, and how much this console is entitled to claim.
 *
 * The four coverage classes plus `unknown`. `unknown` is not a fifth kind of
 * ownership — it is the absence of a read, and STUDIO-000-007 requires it to be
 * impossible to render as a zero or a default. `buckets.ts` and `cognito.ts`
 * each grew the same fourth arm independently before this existed; this is the
 * one both of them should be expressed in.
 */
export type TagCoverage =
  | { kind: "tenant"; tenantSlug: string; via: TagSource }
  | { kind: "shared"; via: TagSource }
  /** Tags WERE read and carry no `tenure:tenant`. Spend nobody owns. */
  | { kind: "untagged"; via: TagSource }
  /** This API cannot answer here. `readInstead`/`remedy` say what can. */
  | { kind: "not-coverable"; why: string; readInstead: Capability | null; remedy: string }
  /** Nothing answered. Carries the reason, which carries the IAM statement. */
  | { kind: "unknown"; why: string }

/** One resource, with its coverage decided and the tags that decided it. */
export interface CoveredResource {
  arn: string
  /** Null when the ARN could not be parsed — itself worth seeing on a page. */
  parsed: ParsedArn | null
  coverage: TagCoverage
  /** The tags that decided it, or null when none were read. Never `{}` for "unread". */
  tags: Readonly<Record<string, string>> | null
  /**
   * Contract problems, or null when tags were never read.
   *
   * Null rather than `[]`, because an empty problem list is the shape of a
   * COMPLIANT resource and a resource nobody could read must not join the
   * compliant pile.
   */
  problems: readonly TagProblem[] | null
}

/** Everything needed to decide one resource's coverage. */
export interface CoverageQuestion {
  arn: string
  /** The index read itself, so a denial renders as a denial rather than as an absence. */
  index: AwsRead<readonly TaggedResource[]>
  /** ARN → tags, from `tagIndex()`. */
  indexed: ReadonlyMap<string, Readonly<Record<string, string>>>
  /**
   * The partition, region and account `tag:GetResources` answered for.
   *
   * Required, not optional, and that is deliberate: this field replaced a plain
   * `indexRegion`, and making the replacement optional would have let every
   * existing construction site keep compiling while silently losing the
   * partition and account arms. An omitted field is invisible to `tsc`; a
   * changed required one is not. Both construction sites in this repository
   * (`estateCoverage`'s `decide`, and `tags.test.ts`'s `ask`) were updated.
   */
  indexScope: ArnScope
  /** What the service's own tag API said, when the reader that found this resource asked it. */
  native?: NativeTagAnswer
}

/**
 * The one decision. Every surface's answer to "whose is this" comes through
 * here.
 *
 * Order is the whole design:
 *
 *   1. the service's own answer, when there is one — it is the service speaking
 *      about its own resource, and it does not depend on an index having caught
 *      up with a resource created ninety seconds ago
 *   2. the index, when it answered and carries this ARN
 *   3. coverage reasoning, when the index answered and does NOT carry this ARN —
 *      and this is the step whose absence misattributes a bill
 *   4. `unknown`, when nothing answered
 *
 * Note this is the opposite precedence from the one `buckets.ts` implements
 * (index first, bucket second) and the same as `cognito.ts`'s (pool first,
 * index second). The two disagreeing is itself a defect; native-first is the
 * correct order and this is where it is now written down once.
 */
export function coverageFor(question: CoverageQuestion): TagCoverage {
  const { arn, index, indexed, indexScope, native } = question
  const parsed = parseArn(arn)

  if (native?.kind === "tags") {
    return fromTags(native.tags, { path: "service-native", capability: native.capability })
  }
  if (native?.kind === "none") {
    // The service itself says this resource carries no tags. That is not a gap
    // in coverage — it is the finding, from the most authoritative possible
    // source, and no amount of index reasoning improves on it.
    return { kind: "untagged", via: { path: "service-native", capability: native.capability } }
  }

  const indexAnswered =
    index.state === "ACTUAL" || index.state === "STALE" || index.state === "EMPTY"
  const via: TagSource = {
    path: "tag-index",
    capability: "tag:GetResources",
    region: indexScope.region,
  }

  if (indexAnswered) {
    const tags = indexed.get(arn)
    if (tags !== undefined) return fromTags(tags, via)

    // Absent from an index that answered. Everything below decides whether that
    // absence is a fact about the resource or a fact about the index.
    const gap = tagApiGapFor(parsed)
    if (gap) {
      return {
        kind: "not-coverable",
        why: `${arn} is absent from the estate tag index, and ${gap.why}`,
        readInstead: gap.readInstead,
        remedy: gap.remedy,
      }
    }
    if (!parsed) {
      return {
        kind: "unknown",
        why:
          `${arn} is not an ARN this engine can take apart, so it cannot be told whether the ` +
          `estate tag index covers it. Reporting it as untagged would be a claim about a ` +
          `resource, from a failure to read a string.`,
      }
    }
    const outside = outOfIndexScope(arn, parsed, indexScope)
    if (outside) return outside
    // In the index's own partition, region and account, of a type it carries,
    // and not in it. Only here is "untagged" a statement about the resource.
    return { kind: "untagged", via }
  }

  const nativeNote =
    native?.kind === "unreadable"
      ? ` Its own service's tags were not readable either: ${native.why}`
      : ""
  return {
    kind: "unknown",
    why: `${describeRead(index, "the estate tag index")}${nativeNote}`,
  }
}

/**
 * Why this ARN's absence from the index proves nothing — or null when it does.
 *
 * Three axes, checked in the order that produces the most useful sentence:
 * partition, then region, then account. Each has two failure modes and they are
 * NOT the same answer:
 *
 *   the scope resolved and DISAGREES   `not-coverable`. A definite statement:
 *                                      this index could not have carried this
 *                                      resource, and here is the read that
 *                                      would.
 *   the scope did not resolve          `unknown`. This engine cannot tell
 *                                      whether the index covered it, so it says
 *                                      so. Every one of these arms exists
 *                                      because the alternative is a fabricated
 *                                      finding — "untagged" asserted against a
 *                                      resource in an account nobody confirmed
 *                                      was ever indexed.
 *
 * The account arm only engages for ARNs that STATE an account. An S3 bucket and
 * a Route 53 zone name none, and an empty segment is a fact about the ARN form
 * rather than evidence of a different owner; those are settled above by the gap
 * table and the global-resource arm.
 */
function outOfIndexScope(arn: string, parsed: ParsedArn, scope: ArnScope): TagCoverage | null {
  if (scope.partition === null) {
    return {
      kind: "unknown",
      why:
        `${arn} is absent from the estate tag index, but the partition that index answered in ` +
        `could not be resolved — no identity was supplied and the index returned no ARN to ` +
        `learn it from — so this engine cannot tell whether the index covered this resource ` +
        `at all.`,
    }
  }
  if (parsed.partition !== scope.partition) {
    return {
      kind: "not-coverable",
      why:
        `${arn} is in the ${parsed.partition} partition and the estate tag index answered in ` +
        `${scope.partition}. tag:GetResources cannot see across partitions; a resource in ` +
        `another partition is absent from it whether it is tagged or not.`,
      readInstead: null,
      remedy: `read tag:GetResources from a client resolved into the ${parsed.partition} partition`,
    }
  }

  if (parsed.region === "") {
    return {
      kind: "not-coverable",
      why:
        `${arn} is a global resource — its ARN carries no region — and tag:GetResources is a ` +
        `regional index${scope.region ? ` that answered for ${scope.region}` : ""}. Its absence ` +
        `from that index says nothing about its tags.`,
      readInstead: null,
      remedy:
        `read ${parsed.service}'s own tag API for this resource; this console holds no ` +
        `capability for it today`,
    }
  }
  if (scope.region === null) {
    return {
      kind: "unknown",
      why:
        `${arn} is absent from the estate tag index, but the region that index answered for ` +
        `could not be resolved, so this engine cannot tell whether the index covered this ` +
        `resource's region (${parsed.region}) at all.`,
    }
  }
  if (parsed.region !== scope.region) {
    return {
      kind: "not-coverable",
      why:
        `${arn} is in ${parsed.region} and the estate tag index answered for ${scope.region}. ` +
        `tag:GetResources is regional; a resource in another region is absent from it whether ` +
        `it is tagged or not.`,
      readInstead: null,
      remedy: `read tag:GetResources again with the client resolved to ${parsed.region}`,
    }
  }

  if (parsed.accountId !== "") {
    if (scope.accountId === null) {
      return {
        kind: "unknown",
        why:
          `${arn} belongs to account ${parsed.accountId}, and the account the estate tag index ` +
          `answered for could not be resolved, so this engine cannot tell whether that index ` +
          `covered this resource's account.`,
      }
    }
    if (parsed.accountId !== scope.accountId) {
      return {
        kind: "not-coverable",
        why:
          `${arn} belongs to account ${parsed.accountId} and the estate tag index answered for ` +
          `account ${scope.accountId}. tag:GetResources indexes one account — the caller's — so ` +
          `a resource in another account is absent from it whether it is tagged or not.`,
        readInstead: null,
        remedy:
          `read tag:GetResources with credentials resolved into account ${parsed.accountId}; ` +
          `this console reads one account`,
      }
    }
  }

  return null
}

function fromTags(tags: Readonly<Record<string, string>>, via: TagSource): TagCoverage {
  const decided = attributionOf(tags)
  switch (decided.kind) {
    case "tenant":
      return { kind: "tenant", tenantSlug: decided.tenantSlug, via }
    case "shared":
      return { kind: "shared", via }
    case "unattributed":
      return { kind: "untagged", via }
  }
}

/**
 * The resources the index itself returned, as covered resources.
 *
 * Trivial by construction and that is the point: a resource the index RETURNED
 * had its tags read, so there is no coverage question about it — only an
 * attribution. `tagCompliance` and `forTenant` both run through this, so the
 * counts a page renders and the coverage model are the same code.
 *
 * Order-preserving and 1:1 with the input.
 */
export function coverageFromIndex(
  resources: readonly TaggedResource[],
  options: { region?: string | null } = {},
): readonly CoveredResource[] {
  const via: TagSource = {
    path: "tag-index",
    capability: "tag:GetResources",
    region: options.region ?? null,
  }
  return resources.map((r) => ({
    arn: r.arn,
    parsed: parseArn(r.arn),
    coverage: fromTags(r.tags, via),
    tags: r.tags,
    problems: r.problems,
  }))
}

/* ═══════════════════════════════════════════════ the two questions ═══════ */

/**
 * Which resources belong to tenant X.
 *
 * Only the `tenant` arm, and only on an exact slug match. `acme-staging` is a
 * different customer from `acme`; a prefix or a `startsWith` here would charge
 * one for the other, which is the failure the whole tag contract exists to
 * prevent.
 */
export function resourcesForTenant(
  covered: readonly CoveredResource[],
  slug: string,
): readonly CoveredResource[] {
  return covered.filter((r) => r.coverage.kind === "tenant" && r.coverage.tenantSlug === slug)
}

/**
 * A resource nobody owns — the finding, not the leftovers.
 *
 * Spend with no `tenure:tenant` is money leaving the account that no cost report
 * can allocate and no tenant deletion will ever clean up. It gets a shape with
 * an ARN, a service, the path that decided it and a remedy, so it can be
 * rendered as a row an operator acts on rather than counted into a number.
 */
export interface UnownedResource {
  /**
   * The ARN, or null for a resource whose own reader could not produce one.
   *
   * Null is rare and it is a fact, not a hole to paper over: `logs.ts`,
   * `cognito.ts`, `ecr.ts` and others all declare `arn: string | null` because
   * the AWS API they call sometimes omits it. Such a resource can still be
   * proven untagged — its own service can answer about its tags without anyone
   * knowing its ARN — and dropping it would make "spend nobody owns" quietly
   * exclude exactly the resources whose identity is already shaky.
   *
   * Print `label`, which is never null. An `{arn}` rendered straight into JSX
   * shows an empty cell.
   */
  arn: string | null
  /** Always printable: the ARN when there is one, else the reader's own name for it. */
  label: string
  /** From the ARN, so it groups without anyone maintaining a service list. */
  service: string
  /** The ARN's region, or null for a global resource. */
  region: string | null
  /** The ARN's account. Null when the ARN states none, as an S3 bucket ARN does. */
  accountId: string | null
  /** The ARN's partition — what a console link has to be built in. Never assumed. */
  partition: string | null
  /** Which read established that this is untagged. Never assumed. */
  via: TagSource
  /** The sentence a surface prints. */
  why: string
  /** What fixes it, naming the key and the value form for a deliberate share. */
  remedy: string
  /** Every contract problem, so fixing the tenant tag does not hide eleven more. */
  problems: readonly TagProblem[] | null
}

/**
 * Every resource proven to carry no `tenure:tenant`, as findings.
 *
 * `unidentified` is a second argument rather than a second function because the
 * count on a page must not be able to disagree with the list under it: a
 * resource counted `untagged` in `coverageSummary` and absent from `unowned` is
 * an operator being told three things are unowned and shown two. The two call
 * sites that omit it — `tagCompliance` and `forTenant` — see only resources the
 * index itself returned, every one of which has an ARN by construction.
 */
export function unownedResources(
  covered: readonly CoveredResource[],
  unidentified: readonly UnidentifiedResource[] = [],
): readonly UnownedResource[] {
  const out: UnownedResource[] = []
  for (const r of covered) {
    if (r.coverage.kind !== "untagged") continue
    out.push({
      arn: r.arn,
      label: r.arn,
      service: r.parsed?.service ?? "",
      region: r.parsed && r.parsed.region !== "" ? r.parsed.region : null,
      accountId: r.parsed && r.parsed.accountId !== "" ? r.parsed.accountId : null,
      partition: r.parsed?.partition ?? null,
      via: r.coverage.via,
      why: describeCoverage(r.coverage),
      remedy:
        `set ${TENANT_TAG} on ${r.arn} — to the owning tenant's slug, or to "${SHARED_TAG}" if it ` +
        `genuinely belongs to no tenant. Leaving it unset is not the same as either.`,
      problems: r.problems,
    })
  }
  for (const u of unidentified) {
    if (u.coverage.kind !== "untagged") continue
    out.push({
      arn: null,
      label: u.label,
      service: u.service,
      // Nothing about a region, an account or a partition is known for a
      // resource with no ARN, and nothing is guessed. The remedy sends the
      // operator to the reader that DOES know which resource this is.
      region: null,
      accountId: null,
      partition: null,
      via: u.coverage.via,
      why: describeCoverage(u.coverage),
      remedy:
        `set ${TENANT_TAG} on ${u.label} — to the owning tenant's slug, or to "${SHARED_TAG}" if ` +
        `it genuinely belongs to no tenant. ${u.source} listed this resource without an ARN, so ` +
        `it cannot be linked to; find it by name in that service.`,
      problems: u.problems,
    })
  }
  return out
}

/**
 * The resources this API cannot answer for, kept as a first-class list.
 *
 * Separate from `unownedResources` on purpose, and the separation IS the
 * feature: folding these into "untagged" produces a tidy report that charges
 * platform overhead to a CloudFront distribution nobody failed to tag.
 */
export function notCoverableResources(
  covered: readonly CoveredResource[],
): readonly CoveredResource[] {
  return covered.filter((r) => r.coverage.kind === "not-coverable")
}

/** Coverage counted the way an operator asks about it. Five classes, none folded. */
export interface CoverageSummary {
  total: number
  tenant: number
  shared: number
  untagged: number
  notCoverable: number
  unknown: number
  /** The tenant slugs seen, sorted, so a surface need not re-derive them. */
  tenants: readonly string[]
}

/**
 * Counted from anything that HAS a coverage — a `CoveredResource`, or an
 * `UnidentifiedResource` that never got an ARN.
 *
 * The parameter is structural rather than `readonly CoveredResource[]` on
 * purpose: it is a RELAXATION, so every existing caller still compiles
 * unchanged, and it means a resource with no ARN is counted in the same total
 * as one with an ARN instead of being quietly left out of the estate's own
 * headline number.
 */
export function coverageSummary(covered: readonly { coverage: TagCoverage }[]): CoverageSummary {
  const tenants = new Set<string>()
  let tenant = 0
  let shared = 0
  let untagged = 0
  let notCoverable = 0
  let unknown = 0
  for (const r of covered) {
    switch (r.coverage.kind) {
      case "tenant":
        tenant += 1
        tenants.add(r.coverage.tenantSlug)
        break
      case "shared":
        shared += 1
        break
      case "untagged":
        untagged += 1
        break
      case "not-coverable":
        notCoverable += 1
        break
      case "unknown":
        unknown += 1
        break
    }
  }
  return {
    total: covered.length,
    tenant,
    shared,
    untagged,
    notCoverable,
    unknown,
    tenants: [...tenants].sort(),
  }
}

/**
 * The sentence a surface prints for one resource's coverage.
 *
 * Built ON `describeAttribution` for the three arms they share, so the wording
 * an operator already reads on /platform/estate cannot drift from the wording
 * the coverage model produces. The path is appended rather than substituted:
 * "acme" stays the first thing on the line, and "via the estate tag index
 * (tag:GetResources) in us-east-1" is the provenance after it.
 */
export function describeCoverage(coverage: TagCoverage): string {
  switch (coverage.kind) {
    case "tenant":
      return `${describeAttribution({ kind: "tenant", tenantSlug: coverage.tenantSlug })} — ${describeSource(coverage.via)}`
    case "shared":
      return `${describeAttribution({ kind: "shared" })} — ${describeSource(coverage.via)}`
    case "untagged":
      return `${describeAttribution({ kind: "unattributed" })} — ${describeSource(coverage.via)}`
    case "not-coverable":
      return (
        `not coverable by tag:GetResources — ${coverage.why} ` +
        (coverage.readInstead
          ? `Read ${coverage.readInstead} instead.`
          : `No capability in this console answers for it: ${coverage.remedy}.`)
      )
    case "unknown":
      return `unknown — ${coverage.why}`
  }
}

/** Which read said so, in one clause. One renderer, so two pages cannot word it differently. */
export function describeSource(source: TagSource): string {
  return source.path === "tag-index"
    ? `via the estate tag index (${source.capability})${source.region ? ` in ${source.region}` : ""}`
    : `via ${source.capability}, the service's own tags`
}

/* ══════════════════════════════════════════════════ the composed read ════ */

/**
 * A resource some other reader found, offered for attribution.
 *
 * This is how a service the tag index does not carry gets attributed at all:
 * `cognito.ts`, `dns.ts`, `cdn.ts` and the rest already list their own
 * resources, and each can hand its ARNs — with its own tag answer where its API
 * has one — to `estateCoverage`. Nothing in this module reads a service API
 * itself; readers are the only path to the SDK.
 */
export interface DeclaredResource {
  arn: string
  /** What the reader calls it. Optional: an ARN already prints. */
  label?: string
  /** The reader or capability that declared it, for a page that has to say where a row came from. */
  source?: string
  native?: NativeTagAnswer
}

/**
 * A resource a reader listed but could not give an ARN for.
 *
 * This case is not hypothetical and it is not rare enough to ignore:
 * `logs.ts`, `ecr.ts`, `cognito.ts`, `elasticache.ts`, `keys.ts` and `secrets.ts`
 * every one declare `arn: string | null`, because the AWS API they call can
 * return an entry without one. Such a resource cannot be joined to the tag
 * index — there is no key to join on — and the tempting move is to drop it.
 *
 * Dropping it is the fifth way this module could misattribute a bill: the
 * estate's total silently shrinks, and it shrinks precisely around the resources
 * whose identity was already incomplete. So they are kept, carried, counted in
 * the same summary, and rendered by their own reader's name for them.
 *
 * Their tags are still knowable — a service that answers `ListTagsForResource`
 * does not need this console to know the ARN — so `coverage` is a full
 * `TagCoverage` and an unidentified resource can legitimately be attributed,
 * shared, untagged or unknown.
 */
export interface UnidentifiedResource {
  /** The reader's own name for it. Always printable; this is what a page shows. */
  label: string
  /** The ARN's service segment, supplied by the reader since no ARN states it. */
  service: string
  /** Which reader declared it, so an operator knows where to go looking. */
  source: string
  coverage: TagCoverage
  /** The tags that decided it, or null when none were read. Never `{}` for "unread". */
  tags: Readonly<Record<string, string>> | null
  /** Null when tags were never read — an unread resource is not a compliant one. */
  problems: readonly TagProblem[] | null
}

/** One resource as a reader holds it, before this module decides anything. */
export interface ReaderResource {
  /** Null when the reader's own API did not return one. Not an error; a fact. */
  arn: string | null
  /** The reader's name for it: a table name, a pool id, a log group, a repository. */
  label: string
  /** The reader's own tag answer, where its API has one. Preferred over the index. */
  native?: NativeTagAnswer
}

/**
 * What one reader contributes to the estate's attribution.
 *
 * Both lists come back together, from one call, and the caller has to
 * destructure both to use either. That is the point: an API that returned only
 * `declared` would make losing the ARN-less resources the path of least
 * resistance, and this whole module exists because the convenient answer and the
 * honest one differ.
 */
export interface Declarations {
  declared: readonly DeclaredResource[]
  unidentified: readonly UnidentifiedResource[]
}

/**
 * Adapt one reader's resources into declarations.
 *
 * Nothing here reads AWS. The readers are the only path to the SDK, and every
 * one of them already exposes what this needs — an `arn: string | null`, a name,
 * and for some (`buckets.ts`, `cognito.ts`) a native tag answer. So a surface
 * that has already read a service composes it in one line rather than this
 * module growing an import of twenty-four readers and their runtime graphs.
 */
export function declarationsFrom(
  reader: {
    /** The capability that listed these — `logs:DescribeLogGroups`, and a real one. */
    capability: string
    /** The ARN service segment these belong to: `logs`, `cognito-idp`, `ecr`. */
    service: string
  },
  items: readonly ReaderResource[],
): Declarations {
  const declared: DeclaredResource[] = []
  const unidentified: UnidentifiedResource[] = []
  for (const item of items) {
    if (item.arn) {
      declared.push({
        arn: item.arn,
        label: item.label,
        source: reader.capability,
        native: item.native,
      })
      continue
    }
    const tags = nativeTags(item.native)
    unidentified.push({
      label: item.label,
      service: reader.service,
      source: reader.capability,
      coverage: coverageWithoutArn(item, reader.capability),
      tags,
      // Only where tags were actually read. `null`, not `[]`: an empty problem
      // list is the shape of a COMPLIANT resource, and a resource nobody could
      // read must not join the compliant pile.
      problems: tags === null ? null : tagProblems(tags),
    })
  }
  return { declared, unidentified }
}

/** The tags a native answer established, or null when it established none. */
function nativeTags(
  native: NativeTagAnswer | undefined,
): Readonly<Record<string, string>> | null {
  if (native?.kind === "tags") return native.tags
  // A definitive "no tags" IS a read: the empty set, which fails all twelve keys.
  if (native?.kind === "none") return {}
  return null
}

/**
 * The coverage of a resource with no ARN.
 *
 * The index is not consulted, and cannot be: a join needs a key. Everything here
 * therefore rests on what the resource's own service said, and where it said
 * nothing the answer is `unknown` — never `untagged`, which would be a finding
 * manufactured out of a missing identifier.
 */
function coverageWithoutArn(item: ReaderResource, capability: string): TagCoverage {
  const native = item.native
  if (native?.kind === "tags") {
    return fromTags(native.tags, { path: "service-native", capability: native.capability })
  }
  if (native?.kind === "none") {
    return { kind: "untagged", via: { path: "service-native", capability: native.capability } }
  }
  const why =
    native?.kind === "unreadable"
      ? `${capability} listed ${item.label} without an ARN, and its own tags were not readable: ${native.why}`
      : `${capability} listed ${item.label} without an ARN, so the estate tag index cannot be ` +
        `asked about it — there is no key to join on — and no service tag answer accompanied it.`
  return { kind: "unknown", why }
}

/** The whole estate's attribution, with the holes named rather than filled in. */
export interface EstateCoverage {
  /**
   * The partition, region and account the tag index answered for.
   *
   * Resolved — from the identity a surface passes in, or from the ARNs the index
   * itself returned, or from the client's own region. Never a literal, and null
   * fields make absences render `unknown` rather than becoming findings.
   *
   * This replaced a bare `indexRegion: string | null`. The only construction
   * site is the return of `estateCoverage` below; the only readers are
   * `tags.test.ts` and any surface that composes this, and nothing outside this
   * module imported the type when it changed.
   */
  indexScope: ArnScope
  /** The index read itself, so a surface can render its denial with the IAM statement. */
  index: AwsRead<readonly TaggedResource[]>
  /** Everything: the index's own resources, plus every declared resource. */
  resources: readonly CoveredResource[]
  /** Resources a reader listed with no ARN. Counted in `summary`, never dropped. */
  unidentified: readonly UnidentifiedResource[]
  /** Spend nobody owns, from both lists. First-class output. */
  unowned: readonly UnownedResource[]
  /** Resources this API cannot answer for, each naming what can. */
  notCoverable: readonly CoveredResource[]
  /** Counts across `resources` AND `unidentified`, so the headline is the whole estate. */
  summary: CoverageSummary
}

/**
 * Attribution across every service the console can read.
 *
 * Deliberately NOT an `AwsRead<EstateCoverage>`: a denied tag index does not
 * make the answer unknowable, because a reader that supplied its own service's
 * tags still answered for its own resources. The index read is carried INSIDE
 * the result so a surface renders its denial — principal, action, pasteable
 * statement — while still showing what the native paths established.
 *
 * The region comes from the gateway's own resolution. If that throws — no
 * credentials, no metadata service — it is null, every absent resource becomes
 * `unknown` rather than `untagged`, and the console still boots. A page that
 * 500s because STS is unreachable is not an acceptable refusal.
 */
export async function estateCoverage(
  declared: readonly DeclaredResource[] = [],
  supplied?: AwsGateway,
  options: {
    now?: () => Date
    denial?: DenialContext
    /** A tag index already read this request. Passed to avoid a second call. */
    index?: AwsRead<readonly TaggedResource[]>
    /**
     * The identity the surface already resolved. Its account and partition are
     * what make "untagged" sayable at all for an ARN that states them.
     */
    identity?: AwsRead<Identity>
    /** An explicit scope, when the caller has one that did not come from an identity. */
    scope?: ArnScope
    /** Resources readers listed without ARNs, from `declarationsFrom`. */
    unidentified?: readonly UnidentifiedResource[]
  } = {},
): Promise<EstateCoverage> {
  const gw = supplied ?? liveGateway()
  const index =
    options.index ?? (await taggedResources(gw, { now: options.now, denial: options.denial }))

  const fromIndex =
    index.state === "ACTUAL" || index.state === "STALE" ? index.value : []

  // Three sources, in order of authority, merged field by field so a partial
  // answer from one is completed by the next rather than blocking it:
  //
  //   1. what the caller resolved   an identity from sts:GetCallerIdentity, or
  //                                 an explicit scope
  //   2. the client's own region    what the SDK resolved this call into
  //   3. the index's own results    the account and partition its ARNs prove
  //
  // Every one of them is READ. None of them is a literal, and a field no source
  // resolved stays null — which makes an absence render `unknown` rather than
  // becoming a finding against a resource nobody confirmed was ever indexed.
  const stated = options.scope ?? (options.identity ? arnScopeOf(options.identity) : UNRESOLVED_SCOPE)
  let clientRegion: string | null = null
  if (stated.region === null) {
    try {
      clientRegion = (await gw.resolvedRegion()) || null
    } catch {
      // No credentials, no metadata service, no region. The console still boots
      // and every absence becomes `unknown`; a page that 500s here is not an
      // acceptable refusal.
      clientRegion = null
    }
  }
  const scope = mergeScope(
    stated,
    mergeScope({ partition: null, region: clientRegion, accountId: null }, scopeFromIndex(fromIndex)),
  )

  const indexed = tagIndex(fromIndex)
  const declaredByArn = new Map(declared.map((d) => [d.arn, d]))

  const resources: CoveredResource[] = []
  const seen = new Set<string>()

  for (const r of fromIndex) {
    seen.add(r.arn)
    const d = declaredByArn.get(r.arn)
    if (!d) {
      // In the index, nothing else claimed it: its tags were read, full stop.
      resources.push({
        arn: r.arn,
        parsed: parseArn(r.arn),
        coverage: fromTags(r.tags, {
          path: "tag-index",
          capability: "tag:GetResources",
          region: scope.region,
        }),
        tags: r.tags,
        problems: r.problems,
      })
      continue
    }
    resources.push(decide(d))
  }

  for (const d of declared) {
    if (seen.has(d.arn)) continue
    seen.add(d.arn)
    resources.push(decide(d))
  }

  const unidentified = options.unidentified ?? []

  return {
    indexScope: scope,
    index,
    resources,
    unidentified,
    unowned: unownedResources(resources, unidentified),
    notCoverable: notCoverableResources(resources),
    // Both lists, one total. A resource whose reader could not produce an ARN
    // still costs money and still has to be counted somewhere an operator looks.
    summary: coverageSummary([...resources, ...unidentified]),
  }

  function decide(d: DeclaredResource): CoveredResource {
    const coverage = coverageFor({
      arn: d.arn,
      index,
      indexed,
      indexScope: scope,
      native: d.native,
    })
    const tags =
      d.native?.kind === "tags"
        ? d.native.tags
        : d.native?.kind === "none"
          ? {}
          : (indexed.get(d.arn) ?? null)
    return {
      arn: d.arn,
      parsed: parseArn(d.arn),
      coverage,
      tags,
      // Only where tags were actually read. A resource nobody could read must
      // not arrive in the compliant pile carrying an empty problem list.
      problems: tags === null ? null : tagProblems(tags),
    }
  }
}
