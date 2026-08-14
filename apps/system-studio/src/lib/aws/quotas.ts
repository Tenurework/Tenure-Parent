/**
 * STUDIO-070-011 (Service Quotas) — the ceilings this estate provisions into,
 * read before a provisioning run finds them at 2am.
 *
 * The Global Deployment Engine creates a tenant's stack out of a VPC, security
 * groups and their rules, an ECS service, an application load balancer and its
 * target groups, an RDS instance, a CloudFront distribution, an ACM certificate,
 * a Lambda concurrency reservation, a Cognito user pool and an SES sending
 * allowance. Every one of those has an account or regional ceiling. Terraform
 * provisions the estate and the console has never once asked AWS what the
 * ceilings are, so the engine discovers a quota boundary the only way it can
 * today: a `LimitExceeded` in the middle of a provisioning run, with a
 * half-created tenant behind it.
 *
 * This module asks. It answers one question — *what is the applied value of each
 * quota that bounds tenant creation, and how close are we to it* — and it is
 * built so that every part of that answer it cannot give says so out loud.
 *
 * ## Batched by service, because GetServiceQuota is per quota code
 *
 * Twelve quotas across nine services. Asked one at a time, that is twelve
 * `GetServiceQuota` calls against an API whose throttle is low and whose refresh
 * cadence (`QUOTA_TTL_MS`, six hours) exists precisely because a quota changes
 * when AWS grants an increase — which takes days. So the primary read is ONE
 * `ListServiceQuotas` per service code, nine calls, and `GetServiceQuota` is the
 * fallback for a target the listing did not carry.
 *
 * That fallback is not defensive padding. AWS documents that `ListServiceQuotas`
 * returns the quotas for which an applied value is available and *omits* the
 * rest, so a target genuinely can be missing from a successful listing. Missing
 * is not zero and it is not "fine": it becomes an individual read, and if that
 * fails too the target carries its own failed `AwsRead`.
 *
 * ## The quota codes are a hint, and the API is the authority
 *
 * `QUOTA_TARGETS` carries AWS's published quota code AND the quota's published
 * name for each target. Resolution tries the code first, then an exact name
 * match against the service's own listing, and records in `provenance` which
 * route answered. A target that neither route resolves is `NOT_FOUND` with a
 * sentence naming the service and the code that was looked for — it does not
 * silently disappear from the table, and it does not render as a quota of zero.
 * A hardcoded identifier that turns out to be wrong therefore surfaces as a
 * visible unknown rather than as a wrong number.
 *
 * ## What this module cannot read, said out loud
 *
 * **Whether an applied value has been RAISED from the AWS default is not
 * available to this engine.** The `ServiceQuota` shape that `ListServiceQuotas`
 * and `GetServiceQuota` return carries the applied `Value` and no default; the
 * default lives behind `servicequotas:GetAWSDefaultServiceQuota` /
 * `servicequotas:ListAWSDefaultServiceQuotas`, and neither is in the capability
 * registry. This module does not get to add one. So every quota carries a
 * `defaultValue` whose only arm is NOT_READABLE and which names the capability
 * that would answer it. A field holding `null`, or left off the type, would let a
 * surface print an applied value with no default beside it and let an operator
 * read that as "this is the default" — which for a quota somebody raised eighteen
 * months ago is exactly backwards.
 *
 * **Exact usage is not available either, for most of these.** There is no "how
 * many VPCs exist" in the Service Quotas API; each quota carries a CloudWatch
 * `UsageMetric` naming where the number lives, and this engine holds no
 * `cloudwatch:GetMetricData` capability. Two things are done with that, and
 * neither of them is a guess:
 *
 *   1. A caller that HAS an exact count — a sibling reader that enumerated the
 *      load balancers, say — passes it in `options.usage`, and the headroom is
 *      then `used of applied`, exact, attributed to the reader that counted.
 *   2. Otherwise the tag index is consulted. The Resource Groups Tagging API
 *      returns ARNs, and counting the ones that match a quota's resource shape
 *      gives a real number — but only of resources that carry at least one tag.
 *      It is therefore a LOWER bound on usage, so it is reported as one:
 *      `usedAtLeast`, and the headroom derived from it is `remainingAtMost`.
 *
 * That direction is deliberate. A lower bound on usage is an UPPER bound on
 * headroom, and an upper bound on headroom is the only one of the two that
 * cannot read as reassuring. "At most 1 VPC left" is a sentence an operator acts
 * on; "1 VPC left" from a count that only saw tagged VPCs is a sentence that gets
 * somebody paged.
 *
 * ## Region, partition and attribution
 *
 * Region and partition come from the quota's own `QuotaArn` where AWS returned
 * one, and otherwise from the resolved identity. There is no region literal in
 * this file and no `"aws"` partition fallback — GE-010-007 was a residency defect
 * caused by exactly that fallback. `GlobalQuota` on the API's answer is what
 * decides whether a quota is an account ceiling or a regional one; the scope is
 * not inferred from the service name.
 *
 * Attribution goes through `tags.ts` and the Resource Groups Tagging API like
 * every other resource here. Service Quotas applied values ARE taggable, so a
 * `QuotaArn` can legitimately appear in the tag index. Absent a tag a quota is
 * `shared` rather than `unattributed`, and that is the one deliberate deviation
 * from `tags.ts`: an account or regional ceiling is platform overhead by
 * construction — no tenant owns "VPCs per Region" — so "nobody tagged it" is not
 * a finding here the way it is for a queue somebody forgot. The `why` says so, so
 * the deviation is visible rather than folded in silently. A tag index that could
 * not be READ is still `unknown`, never `shared`.
 */

import { CAPABILITIES } from "./capabilities"
import { denialContextFrom, resolveIdentity, type Identity } from "./identity"
import {
  describeRead,
  liveGateway,
  readAws,
  type AwsGateway,
  type AwsRead,
  type DenialContext,
} from "./read"
import { attributionOf, tagIndex, taggedResources, type TaggedResource } from "./tags"
import { READ_ATTEMPTS, backoffMs } from "./throttle"

/* ---------------------------------------------------------------- limits -- */

/**
 * How many `ListServiceQuotas` pages to walk per service.
 *
 * `client.ts` asks for 100 per page, so this is two thousand quotas for one
 * service before the engine stops. Hitting it does NOT throw and does not report
 * page one as the service: the page carries a `truncated` completeness whose
 * `why` says which service was cut short and that a target not found in it may
 * exist beyond the cap.
 */
export const MAX_QUOTA_PAGES = 20

/**
 * How many individual `GetServiceQuota` calls one load may make.
 *
 * The fallback path only runs for targets a service listing did not carry, so on
 * a healthy estate it runs zero times. The cap exists because `GetServiceQuota`
 * is one call per quota code against a low throttle, and an unbounded fallback is
 * how a page render becomes a rate-limit incident.
 *
 * Targets past the cap are not dropped and do not render as absent: they carry an
 * UNCONFIGURED reading whose `why` says the engine stopped looking.
 */
export const MAX_INDIVIDUAL_QUOTA_READS = 24

/** How many individual reads are in flight at once. Small: this API throttles. */
const INDIVIDUAL_CONCURRENCY = 4

/**
 * The fraction of an applied quota at which a quota is reported as pressure.
 *
 * A constant rather than a literal buried in a comparison, because it is the one
 * number in this module an operator may reasonably want to argue with.
 */
export const QUOTA_PRESSURE_FRACTION = 0.8

/* ------------------------------------------------------------- the targets -- */

/**
 * A quota this estate's provisioning path runs into.
 *
 * `quotaCode` and `quotaName` are both AWS's published identifiers for the same
 * quota, carried together on purpose: the code is what the API keys on and the
 * name is the cross-check that catches a code that has been retyped wrong. See
 * the module header — neither is trusted over the API's own answer.
 */
export interface QuotaTarget {
  /** This module's stable key. What a surface and an injected usage count join on. */
  readonly key: string
  /** AWS's service code, as `ListServiceQuotas` takes it. Not the IAM prefix. */
  readonly serviceCode: string
  /** AWS's published quota code. A hint, verified against the API's answer. */
  readonly quotaCode: string
  /** AWS's published quota name, used as the fallback match. */
  readonly quotaName: string
  /** What running out of it does to a provisioning run, in an operator's words. */
  readonly bounds: string
  /**
   * How an ARN in the tag index is recognised as consuming this quota, or null
   * when nothing in the tag index counts against it.
   *
   * Null is the honest answer for "Inbound or outbound rules per security group"
   * (a rule is not a taggable resource with an ARN), for Lambda concurrency (a
   * number, not a set of resources) and for the SES daily sending quota (a
   * volume, not a count of things). Those report usage as not known rather than
   * as zero.
   */
  readonly countsArn: ((parsed: ParsedArn) => boolean) | null
}

/** An ARN split into the parts this module joins on. Partition-agnostic by design. */
export interface ParsedArn {
  partition: string
  service: string
  region: string
  accountId: string
  /** Everything after the account: `vpc/vpc-0a1b`, `db:tenure-prod`, `function:x`. */
  resource: string
}

/**
 * Split an ARN, or null if it is not one.
 *
 * `arn:PARTITION:SERVICE:REGION:ACCOUNT:RESOURCE`, where RESOURCE may itself
 * contain colons and slashes — an ECS service ARN and a Lambda function ARN both
 * do — so the tail is rejoined rather than indexed.
 */
export function parseArn(arn: string): ParsedArn | null {
  const parts = arn.split(":")
  if (parts.length < 6 || parts[0] !== "arn") return null
  return {
    partition: parts[1],
    service: parts[2],
    region: parts[3],
    accountId: parts[4],
    resource: parts.slice(5).join(":"),
  }
}

/** `service:resource-prefix` matcher, so a target declares its shape once. */
function arnShape(service: string, prefix: string): (parsed: ParsedArn) => boolean {
  return (parsed) => parsed.service === service && parsed.resource.startsWith(prefix)
}

/**
 * The twelve quotas that bound tenant creation in this estate.
 *
 * Declared in the order a provisioning run meets them — network, compute,
 * ingress, data, edge, identity, mail — so the surface reads as the sequence an
 * operator is debugging rather than as an alphabetised list.
 */
export const QUOTA_TARGETS: readonly QuotaTarget[] = [
  {
    key: "vpcs-per-region",
    serviceCode: "vpc",
    quotaCode: "L-F678F1CE",
    quotaName: "VPCs per Region",
    bounds: "a new tenant's network cannot be created at all",
    countsArn: arnShape("ec2", "vpc/"),
  },
  {
    key: "security-groups-per-region",
    serviceCode: "vpc",
    quotaCode: "L-E79EC296",
    quotaName: "VPC security groups per Region",
    bounds: "a tenant's services come up with no security group to attach",
    countsArn: arnShape("ec2", "security-group/"),
  },
  {
    key: "rules-per-security-group",
    serviceCode: "vpc",
    quotaCode: "L-0EA8095F",
    quotaName: "Inbound or outbound rules per security group",
    bounds: "a rule the stack adds for a new tenant is rejected and the stack half-applies",
    // A security-group rule is not a taggable resource with an ARN. Counting
    // security groups here would answer a different question and read as though
    // it answered this one.
    countsArn: null,
  },
  {
    key: "ecs-services-per-cluster",
    serviceCode: "ecs",
    quotaCode: "L-9EF96962",
    quotaName: "Services per cluster",
    bounds: "a tenant's application never starts — the service is not created",
    countsArn: arnShape("ecs", "service/"),
  },
  {
    key: "application-load-balancers-per-region",
    serviceCode: "elasticloadbalancing",
    quotaCode: "L-53DA6B97",
    quotaName: "Application Load Balancers per Region",
    bounds: "a tenant's stack comes up with nothing routing traffic to it",
    countsArn: arnShape("elasticloadbalancing", "loadbalancer/app/"),
  },
  {
    key: "target-groups-per-region",
    serviceCode: "elasticloadbalancing",
    quotaCode: "L-B22855CB",
    quotaName: "Target Groups per Region",
    bounds: "the load balancer exists and has nowhere to send a request",
    countsArn: arnShape("elasticloadbalancing", "targetgroup/"),
  },
  {
    key: "rds-db-instances",
    serviceCode: "rds",
    quotaCode: "L-7B6409FD",
    quotaName: "DB instances",
    bounds: "a tenant's database is not created and the migration step has nothing to run against",
    countsArn: arnShape("rds", "db:"),
  },
  {
    key: "cloudfront-distributions-per-account",
    serviceCode: "cloudfront",
    quotaCode: "L-24B04930",
    quotaName: "Distributions per AWS account",
    bounds: "a tenant has no edge and no custom domain",
    countsArn: arnShape("cloudfront", "distribution/"),
  },
  {
    key: "acm-certificates-per-region",
    serviceCode: "acm",
    quotaCode: "L-F141DD1D",
    quotaName: "ACM certificates",
    bounds: "a tenant's domain cannot be issued a certificate and the distribution cannot serve TLS",
    countsArn: arnShape("acm", "certificate/"),
  },
  {
    key: "cognito-user-pools-per-account",
    serviceCode: "cognito-idp",
    quotaCode: "L-627C1657",
    quotaName: "User pools per account",
    bounds: "a tenant is created that nobody can sign in to",
    countsArn: arnShape("cognito-idp", "userpool/"),
  },
  {
    key: "lambda-concurrent-executions",
    serviceCode: "lambda",
    quotaCode: "L-B99A9384",
    quotaName: "Concurrent executions",
    bounds: "reserving concurrency for a tenant's functions fails, or steals it from another tenant",
    // Concurrency is a number of simultaneous executions, not a set of resources.
    // Counting functions would be a different quota wearing this one's label.
    countsArn: null,
  },
  {
    key: "ses-daily-sending-quota",
    serviceCode: "ses",
    quotaCode: "L-804C8AE8",
    quotaName: "Daily sending quota",
    bounds: "a tenant's invitations, approvals and password resets stop being delivered",
    // A volume of messages per 24 hours. Nothing in the tag index counts against it.
    countsArn: null,
  },
]

/* ---------------------------------------------------------------- shapes -- */

/** The API's shapes, declared rather than imported — see client.ts's one-owner rule. */
interface UsageMetricResponse {
  MetricNamespace?: string
  MetricName?: string
  MetricDimensions?: Record<string, string>
  MetricStatisticRecommendation?: string
}

interface ServiceQuotaResponse {
  ServiceCode?: string
  ServiceName?: string
  QuotaArn?: string
  QuotaCode?: string
  QuotaName?: string
  Value?: number
  Unit?: string
  Adjustable?: boolean
  GlobalQuota?: boolean
  UsageMetric?: UsageMetricResponse
  Period?: { PeriodValue?: number; PeriodUnit?: string }
}

interface ListServiceQuotasResponse {
  Quotas?: ServiceQuotaResponse[]
  NextToken?: string
}

interface GetServiceQuotaResponse {
  Quota?: ServiceQuotaResponse
}

/** Where the number an operator would need to compute usage actually lives. */
export interface UsageMetric {
  namespace: string
  metricName: string
  dimensions: Readonly<Record<string, string>>
  statistic: string | null
}

/**
 * The AWS default for a quota.
 *
 * One arm, deliberately, exactly as `sqs.ts` does for the age of the oldest
 * message. See the module header: the default is not in any response this engine
 * may fetch, and the capability that would answer it is not in the registry. This
 * type exists so that "we do not know whether this was raised" is a value a
 * surface has to render, not a field a surface can forget.
 */
export interface DefaultQuotaValue {
  state: "NOT_READABLE"
  /** The capability that would answer it. Not held by this engine today. */
  needs: "servicequotas:GetAWSDefaultServiceQuota"
  /** The IAM action, spelled as IAM spells it, so the grant is unambiguous. */
  iamAction: "servicequotas:GetAWSDefaultServiceQuota"
  why: string
}

/** The same object every time: nothing about it varies per quota. */
export const DEFAULT_QUOTA_NOT_READABLE: DefaultQuotaValue = {
  state: "NOT_READABLE",
  needs: "servicequotas:GetAWSDefaultServiceQuota",
  iamAction: "servicequotas:GetAWSDefaultServiceQuota",
  why:
    "the applied value is all ListServiceQuotas and GetServiceQuota return — neither carries the " +
    "AWS default, which lives behind servicequotas:GetAWSDefaultServiceQuota, a capability this " +
    "engine does not hold. Whether this value was raised is unknown, not 'no'.",
}

/** How completely a service's quota listing was walked. */
export type Completeness =
  | { kind: "complete" }
  | { kind: "truncated"; pagesRead: number; why: string }

/** One applied quota, as AWS answered it. Every field is AWS's, none assembled. */
export interface AppliedQuota {
  serviceCode: string
  serviceName: string | null
  quotaCode: string
  quotaName: string
  /** AWS's own `QuotaArn`, or null when the answer carried none. Never assembled. */
  arn: string | null
  /** The applied value. The whole point of the read. */
  value: number
  unit: string | null
  /** Whether a quota increase can even be requested for it. AWS's `Adjustable`. */
  adjustable: boolean
  /** Account-wide or per-region, from AWS's `GlobalQuota` — never inferred from the service. */
  scope: "ACCOUNT" | "REGION"
  /** For rate quotas: the window the value applies over, e.g. 1 per DAY. */
  period: { value: number; unit: string } | null
  /** Where the number an operator would need for exact usage lives. */
  usageMetric: UsageMetric | null
  /** Which route resolved it, and by code or by name. Never silent. */
  provenance: string
}

/** How much of a quota is in use. Three answers, and two of them are not numbers. */
export type QuotaUsageState =
  /** A reader enumerated them and this is the count. Exact. */
  | { kind: "known"; used: number; source: string; asOf: string }
  /**
   * A LOWER bound, from the tag index. The Resource Groups Tagging API only
   * returns resources carrying at least one tag, so an untagged VPC is invisible
   * to it. Reported as a bound rather than as a count for that reason.
   */
  | { kind: "at-least"; usedAtLeast: number; source: string; why: string }
  /** Nothing counts against this quota in anything this engine can read. */
  | { kind: "not-known"; why: string; usageMetric: UsageMetric | null }

/**
 * What is left before a provisioning run fails.
 *
 * `upper-bound` exists because a lower bound on usage is an upper bound on
 * headroom, and only the upper bound is safe to print: see the module header.
 * There is no arm carrying a bare "remaining" derived from a partial count.
 */
export type Headroom =
  | { kind: "known"; applied: number; used: number; remaining: number; utilisation: number }
  | {
      kind: "upper-bound"
      applied: number
      usedAtLeast: number
      remainingAtMost: number
      utilisationAtLeast: number
    }
  | { kind: "not-known"; why: string }

/**
 * Which tenant a quota belongs to.
 *
 * `shared` carries a `why` rather than being bare, because for a quota it is a
 * statement about the AWS model — an account ceiling has no owner — and not the
 * `tenure:shared` tag that `tags.ts` means by the same word. `unknown` is
 * separate and is what an unreadable tag index produces.
 */
export type QuotaAttribution =
  | { kind: "tenant"; tenantSlug: string }
  | { kind: "shared"; why: string }
  | { kind: "unknown"; why: string }

/** One target, whatever happened to it. */
export interface QuotaReading {
  /** `QUOTA_TARGETS` key. Stable across loads; what an injected usage count joins on. */
  key: string
  serviceCode: string
  /** The quota code that was looked for. Present even when nothing resolved. */
  quotaCode: string
  /** AWS's published name for it. Present even when nothing resolved. */
  quotaName: string
  /** What running out of it does to a provisioning run. */
  bounds: string
  /**
   * Refused, throttled, broken, or read — per target, with its own action named.
   * A denied `vpc` listing does NOT collapse the ECS row, and a target this
   * engine could not resolve is never a quota of zero.
   */
  quota: AwsRead<AppliedQuota>
  /**
   * How completely this target's SERVICE listing was walked.
   *
   * Carried onto every target because it changes what a missing quota means: in
   * a complete listing "not there" is an observation, and in a truncated one it
   * rules nothing out. A surface that showed the truncation only on the service
   * row would let an operator read a target's absence as a fact.
   */
  listingCompleteness: Completeness
  /** Unknown today, and it says why and what would fix it. See the module header. */
  defaultValue: DefaultQuotaValue
  usage: QuotaUsageState
  headroom: Headroom
  attribution: QuotaAttribution
  /** From the quota's own ARN where there is one, else the resolved identity. */
  region: string | null
  partition: string | null
  accountId: string | null
  /** This capability's own declared cadence, from the registry, not retyped. */
  refreshMs: number
  asOf: string
}

/** One service's listing, and how completely it was walked. */
export interface ServiceQuotaListing {
  serviceCode: string
  quotas: AwsRead<readonly AppliedQuota[]>
  completeness: Completeness
}

/**
 * Which quotas this estate is close to running out of.
 *
 * Lifted out of the table for the same reason `sqs.ts` lifts dead letters out:
 * it is the one quota fact that is an incident rather than a metric. Every arm is
 * careful about what it claims — `clear` carries the targets it could NOT read
 * and the ones whose usage is unknown, so "clear" never quietly means "clear as
 * far as we bothered to look".
 */
export type QuotaPressure =
  /** No target resolved at all. Nothing can be said about any ceiling. */
  | { kind: "unknown"; why: string }
  /**
   * Quotas were read and NOT ONE of them has a usage number. This is the honest
   * state of this engine today for most targets, and it is emphatically not
   * "clear" — nothing was compared against anything.
   */
  | { kind: "no-usage-known"; quotasRead: number; why: string }
  /** Every target with a usage number is below the pressure fraction. */
  | {
      kind: "clear"
      compared: number
      /** Targets whose quota could not be read. Named, so "clear" is qualified. */
      unreadable: readonly string[]
      /** Targets read but with no usage number. Named, for the same reason. */
      usageUnknown: readonly string[]
    }
  /** At least one quota is at or past the pressure fraction. This is the alarm. */
  | {
      kind: "at-risk"
      at: readonly QuotaPressurePoint[]
      unreadable: readonly string[]
      usageUnknown: readonly string[]
    }

/** One quota close enough to its ceiling to stop a provisioning run. */
export interface QuotaPressurePoint {
  key: string
  quotaName: string
  applied: number
  /** Exact where a reader counted, a lower bound where the tag index did. */
  usedAtLeast: number
  /** Upper bound on what is left. Never an exact remainder from a partial count. */
  remainingAtMost: number
  utilisationAtLeast: number
  /** Whether the count behind this is exact, so the surface can say which it is. */
  exact: boolean
  bounds: string
  attribution: QuotaAttribution
  asOf: string
}

/** Everything a quota surface needs, in one load. */
export interface QuotaReadings {
  identity: AwsRead<Identity>
  tagged: AwsRead<readonly TaggedResource[]>
  /** One entry per service code, so a denied service degrades on its own. */
  services: readonly ServiceQuotaListing[]
  /** One entry per `QUOTA_TARGETS` entry, always, whatever happened to it. */
  quotas: readonly QuotaReading[]
  pressure: QuotaPressure
  /** How many individual `GetServiceQuota` calls the fallback path actually made. */
  individualReads: number
  asOf: string
  /** Each capability's own declared cadence, read from the registry, not retyped. */
  refreshMs: { listing: number; individual: number }
}

/**
 * An exact usage count from a sibling reader.
 *
 * Passed in rather than imported: a reader that enumerated the load balancers
 * owns that number, and this module reading it out of another module's internals
 * would be two implementations of "how many are there". `source` is carried so a
 * surface can say where the number came from, which is what makes an exact count
 * distinguishable from this module's own lower bound.
 */
export interface QuotaUsageObservation {
  /** A `QUOTA_TARGETS` key. An observation for an unknown key is ignored, not guessed at. */
  quotaKey: string
  used: number
  /** The reader that counted. Rendered, so an exact number is attributable. */
  source: string
  asOf: string
}

/* --------------------------------------------------------------- parsing -- */

/** The retry schedule is throttle.ts's, not a literal. See its header on jitter. */
const RETRY: { attempts: number; backoffMs: number } = {
  attempts: READ_ATTEMPTS,
  // `backoffMs(2)` is the pause after the first failure; readAws doubles it.
  backoffMs: backoffMs(2),
}

function parseUsageMetric(metric: UsageMetricResponse | undefined): UsageMetric | null {
  if (!metric?.MetricNamespace || !metric?.MetricName) return null
  return {
    namespace: metric.MetricNamespace,
    metricName: metric.MetricName,
    dimensions: { ...(metric.MetricDimensions ?? {}) },
    statistic: metric.MetricStatisticRecommendation ?? null,
  }
}

/**
 * One `ServiceQuota` from AWS, as an `AppliedQuota`.
 *
 * Throws rather than defaulting when the value is missing or not a number, and
 * the throw happens inside `readAws`, so the reading becomes ERROR with the
 * reason. A quota that defaulted to zero would render as an estate that can
 * create nothing; a quota that defaulted to `Infinity` would render as one that
 * can never run out. Both are claims, and neither was read.
 */
function toAppliedQuota(
  quota: ServiceQuotaResponse,
  serviceCode: string,
  provenance: string,
): AppliedQuota {
  const quotaCode = quota.QuotaCode
  const quotaName = quota.QuotaName
  if (!quotaCode || !quotaName) {
    throw new Error(
      `Service Quotas answered for ${serviceCode} with a quota carrying no QuotaCode or QuotaName ` +
        `(code=${JSON.stringify(quotaCode)}, name=${JSON.stringify(quotaName)}). It cannot be ` +
        `identified, so it will not be rendered as though it were.`,
    )
  }
  const value = quota.Value
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(
      `Service Quotas answered for ${serviceCode}/${quotaCode} without a numeric Value ` +
        `(${JSON.stringify(value)}). A ceiling this engine did not read must not render as a number.`,
    )
  }
  return {
    serviceCode: quota.ServiceCode ?? serviceCode,
    serviceName: quota.ServiceName ?? null,
    quotaCode,
    quotaName,
    arn: quota.QuotaArn ?? null,
    value,
    unit: quota.Unit ?? null,
    // AWS omits `Adjustable` for quotas that are not adjustable; false is what
    // the API means by its absence, and it is the conservative reading — it says
    // "you cannot request an increase", which sends an operator to re-architect
    // rather than to a support ticket that would have been refused.
    adjustable: quota.Adjustable === true,
    scope: quota.GlobalQuota === true ? "ACCOUNT" : "REGION",
    period:
      typeof quota.Period?.PeriodValue === "number" && quota.Period?.PeriodUnit
        ? { value: quota.Period.PeriodValue, unit: quota.Period.PeriodUnit }
        : null,
    usageMetric: parseUsageMetric(quota.UsageMetric),
    provenance,
  }
}

/* ----------------------------------------------------------- the reading -- */

/** What one service's listing produced, with its own truncation signal. */
interface ServiceQuotaPage {
  quotas: readonly AppliedQuota[]
  completeness: Completeness
}

async function listServiceQuotas(
  gw: AwsGateway,
  serviceCode: string,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<ServiceQuotaPage>> {
  return readAws<ServiceQuotaPage>(
    "servicequotas:ListServiceQuotas",
    async () => {
      const quotas: AppliedQuota[] = []
      let token: string | undefined
      let completeness: Completeness = { kind: "complete" }
      let pagesRead = 0

      for (let page = 0; page < MAX_QUOTA_PAGES; page += 1) {
        const response = (await gw.call("servicequotas:ListServiceQuotas", {
          ServiceCode: serviceCode,
          NextToken: token,
        })) as ListServiceQuotasResponse
        pagesRead = page + 1

        for (const quota of response?.Quotas ?? []) {
          quotas.push(toAppliedQuota(quota, serviceCode, "servicequotas:ListServiceQuotas"))
        }

        token = response?.NextToken || undefined
        if (!token) break
        if (page === MAX_QUOTA_PAGES - 1) {
          // Not a truncated listing rendered as complete, and not a throw either:
          // the quotas already read are real and a target found among them is
          // answered correctly. What must not happen is a target NOT found in a
          // truncated listing being reported as though the listing were the
          // service — so the signal travels with the page and reaches the target.
          completeness = {
            kind: "truncated",
            pagesRead,
            why:
              `servicequotas:ListServiceQuotas still had pages for ${serviceCode} after ` +
              `${MAX_QUOTA_PAGES}. The quotas below are real; a quota NOT among them may exist ` +
              `beyond this cap and has not been ruled out.`,
          }
        }
      }

      return { quotas, completeness }
    },
    {
      now: options.now,
      denial: options.denial,
      // A service with no quotas is genuinely EMPTY, and the wrapper object
      // around the truncation signal must not hide that behind "an object with
      // keys is not empty".
      isEmpty: (value) => (value as ServiceQuotaPage).quotas.length === 0,
      ...RETRY,
    },
  )
}

async function getServiceQuota(
  gw: AwsGateway,
  target: QuotaTarget,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<AppliedQuota>> {
  return readAws<AppliedQuota>(
    "servicequotas:GetServiceQuota",
    async () => {
      const response = (await gw.call("servicequotas:GetServiceQuota", {
        ServiceCode: target.serviceCode,
        QuotaCode: target.quotaCode,
      })) as GetServiceQuotaResponse
      const quota = response?.Quota
      if (!quota) {
        throw new Error(
          `servicequotas:GetServiceQuota answered for ${target.serviceCode}/${target.quotaCode} ` +
            `with no Quota. The applied value is unknown, which is not the same as unlimited.`,
        )
      }
      return toAppliedQuota(quota, target.serviceCode, "servicequotas:GetServiceQuota")
    },
    {
      now: options.now,
      denial: options.denial,
      // A single quota is never meaningfully "empty": an answer with nothing in
      // it is a fault, and it throws above.
      isEmpty: () => false,
      ...RETRY,
    },
  )
}

/* ------------------------------------------------------------- resolution -- */

/**
 * Find a target in a service's listing: by code, else by exact name.
 *
 * Returns the quota and a sentence saying which route matched, so a code that
 * has been retyped wrong is visible in `provenance` rather than being the silent
 * reason a row went missing.
 */
export function resolveFromListing(
  target: QuotaTarget,
  quotas: readonly AppliedQuota[],
): AppliedQuota | null {
  const byCode = quotas.find((q) => q.quotaCode === target.quotaCode)
  if (byCode) {
    return { ...byCode, provenance: `servicequotas:ListServiceQuotas, matched on quota code` }
  }
  const byName = quotas.find((q) => q.quotaName === target.quotaName)
  if (byName) {
    return {
      ...byName,
      provenance:
        `servicequotas:ListServiceQuotas, matched on quota NAME — the expected code ` +
        `${target.quotaCode} was not in this service's listing, and AWS returned ` +
        `${byName.quotaCode} for a quota named ${JSON.stringify(target.quotaName)}`,
    }
  }
  return null
}

/* ---------------------------------------------------------------- usage -- */

/**
 * How many tagged resources in the estate consume this quota.
 *
 * A LOWER bound, always, and the return type says so. See the module header on
 * why the bound points the way it does.
 */
function usageFromTags(
  target: QuotaTarget,
  tagged: AwsRead<readonly TaggedResource[]>,
): QuotaUsageState | null {
  if (target.countsArn === null) return null
  if (tagged.state !== "ACTUAL" && tagged.state !== "STALE" && tagged.state !== "EMPTY") {
    return {
      kind: "not-known",
      why: `usage could not be estimated — ${describeRead(tagged, "the tag index")}`,
      usageMetric: null,
    }
  }
  const resources = tagged.state === "EMPTY" ? [] : tagged.value
  let count = 0
  for (const resource of resources) {
    const parsed = parseArn(resource.arn)
    if (parsed && target.countsArn(parsed)) count += 1
  }
  return {
    kind: "at-least",
    usedAtLeast: count,
    source: "tag:GetResources",
    why:
      "counted from the Resource Groups Tagging API, which returns only resources carrying at " +
      "least one tag. An untagged resource of this kind is invisible to it, so this is a lower " +
      "bound on usage and therefore an upper bound on headroom.",
  }
}

/** The usage for one target: an injected exact count first, then the tag index. */
function usageFor(
  target: QuotaTarget,
  quota: AwsRead<AppliedQuota>,
  tagged: AwsRead<readonly TaggedResource[]>,
  observations: ReadonlyMap<string, QuotaUsageObservation>,
): QuotaUsageState {
  const observed = observations.get(target.key)
  if (observed) {
    return { kind: "known", used: observed.used, source: observed.source, asOf: observed.asOf }
  }
  const fromTags = usageFromTags(target, tagged)
  if (fromTags) return fromTags

  const usageMetric =
    quota.state === "ACTUAL" || quota.state === "STALE" ? quota.value.usageMetric : null
  return {
    kind: "not-known",
    why:
      "nothing this engine reads counts against this quota — it is not a set of taggable " +
      "resources. The number lives in CloudWatch" +
      (usageMetric ? ` as ${usageMetric.namespace} ${usageMetric.metricName}` : "") +
      ", and this engine holds no cloudwatch:GetMetricData capability. Unknown, not zero.",
    usageMetric,
  }
}

/** Headroom from an applied value and a usage state. Bounds stay bounds. */
export function headroomOf(quota: AwsRead<AppliedQuota>, usage: QuotaUsageState): Headroom {
  if (quota.state !== "ACTUAL" && quota.state !== "STALE") {
    return { kind: "not-known", why: describeRead(quota, "this quota") }
  }
  const applied = quota.value.value
  if (usage.kind === "known") {
    return {
      kind: "known",
      applied,
      used: usage.used,
      remaining: applied - usage.used,
      utilisation: applied > 0 ? usage.used / applied : 0,
    }
  }
  if (usage.kind === "at-least") {
    return {
      kind: "upper-bound",
      applied,
      usedAtLeast: usage.usedAtLeast,
      remainingAtMost: applied - usage.usedAtLeast,
      utilisationAtLeast: applied > 0 ? usage.usedAtLeast / applied : 0,
    }
  }
  return { kind: "not-known", why: usage.why }
}

/* ---------------------------------------------------------- attribution -- */

/**
 * Which tenant a quota belongs to.
 *
 * A quota's ARN is joined against the tag index like any other resource —
 * applied quota values are taggable — and absent a tag the answer is `shared`
 * with a `why` that says it is the AWS model talking and not a tag. An unreadable
 * tag index is `unknown`, never `shared`.
 */
function attributionFor(
  quota: AwsRead<AppliedQuota>,
  tagged: AwsRead<readonly TaggedResource[]>,
  index: ReadonlyMap<string, Readonly<Record<string, string>>>,
): QuotaAttribution {
  if (tagged.state !== "ACTUAL" && tagged.state !== "STALE" && tagged.state !== "EMPTY") {
    return {
      kind: "unknown",
      why: `this quota's tags were not read — ${describeRead(tagged, "the tag index")}`,
    }
  }
  const arn = quota.state === "ACTUAL" || quota.state === "STALE" ? quota.value.arn : null
  if (!arn) {
    return {
      kind: "shared",
      why:
        "an account or regional ceiling with no ARN this engine can state. No tenant owns it, so " +
        "it is platform overhead by construction rather than by tag.",
    }
  }
  const tags = index.get(arn)
  if (tags === undefined) {
    return {
      kind: "shared",
      why:
        "an account or regional ceiling that carries no tags. Unlike a resource, a quota with no " +
        "tenure:tenant tag is not a finding — nobody can own 'VPCs per Region'.",
    }
  }
  const decided = attributionOf(tags)
  switch (decided.kind) {
    case "tenant":
      return { kind: "tenant", tenantSlug: decided.tenantSlug }
    case "shared":
      return { kind: "shared", why: "tagged tenure:tenant = shared — platform overhead, decided" }
    case "unattributed":
      return {
        kind: "shared",
        why:
          "tagged, but with no tenure:tenant. For a quota that is the expected state: an account " +
          "or regional ceiling is platform overhead by construction.",
      }
  }
}

/* ----------------------------------------------------------- the surface -- */

/**
 * Every quota that bounds tenant creation, with its applied value and headroom.
 *
 * The production entry point. A route or a page calls it with no arguments and
 * gets the live gateway; a test passes a stand-in gateway to the SAME function,
 * because a test that drove a private helper would stay green on the day the
 * caller stopped calling it.
 */
export async function quotaReadings(
  supplied?: AwsGateway,
  options: {
    now?: () => Date
    /** Exact counts from sibling readers. Absent, usage falls back to the tag index. */
    usage?: readonly QuotaUsageObservation[]
    /** Which targets to read. Defaults to all of them; narrowed by a focused surface. */
    targets?: readonly QuotaTarget[]
  } = {},
): Promise<QuotaReadings> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())
  const targets = options.targets ?? QUOTA_TARGETS

  const identity = await resolveIdentity(supplied, { now })
  const denial = denialContextFrom(identity)
  const tagged = await taggedResources(supplied, { now, denial })
  const index = tagIndex(
    tagged.state === "ACTUAL" || tagged.state === "STALE" ? tagged.value : [],
  )

  const observations = new Map<string, QuotaUsageObservation>()
  for (const observation of options.usage ?? []) {
    // An observation for a key this module does not know is dropped rather than
    // rendered against a quota it does not describe. Silently attributing a count
    // of load balancers to "VPCs per Region" is the shape of defect that makes a
    // headroom number worse than none.
    if (targets.some((t) => t.key === observation.quotaKey)) {
      observations.set(observation.quotaKey, observation)
    }
  }

  // Batched by service: one listing per service code, however many targets that
  // service carries. Sorted so two loads of the same estate issue the same calls
  // in the same order and a diff of two renders is readable.
  const serviceCodes = [...new Set(targets.map((t) => t.serviceCode))].sort()
  const listings = new Map<string, AwsRead<ServiceQuotaPage>>()
  for (const serviceCode of serviceCodes) {
    listings.set(serviceCode, await listServiceQuotas(gw, serviceCode, { now, denial }))
  }

  // Which targets the batched listings answered, and which need an individual
  // call. Only a target whose service ANSWERED and did not carry it is worth an
  // individual read: when the listing was refused, throttled, empty or broken,
  // that failure IS the answer for every target of that service, and it names
  // the action an operator has to grant. Issuing twelve `GetServiceQuota` calls
  // into the same refusal would report a second refused action and burn a
  // low-throttle API to learn nothing new.
  const resolved = new Map<string, AppliedQuota>()
  const unresolved: QuotaTarget[] = []
  for (const target of targets) {
    const listing = listings.get(target.serviceCode)
    if (!listing) continue
    if (listing.state !== "ACTUAL" && listing.state !== "STALE") continue
    const found = resolveFromListing(target, listing.value.quotas)
    if (found) resolved.set(target.key, found)
    else unresolved.push(target)
  }

  // The cap is applied HERE rather than inside the batch loop, so a target past
  // it simply has no entry and picks up the "engine stopped looking" reading
  // below. That keeps one code path for "there is no individual read for this
  // target" instead of two that could drift.
  const attempted = unresolved.slice(0, MAX_INDIVIDUAL_QUOTA_READS)
  const individual = new Map<string, AwsRead<AppliedQuota>>()
  for (let start = 0; start < attempted.length; start += INDIVIDUAL_CONCURRENCY) {
    const batch = attempted.slice(start, start + INDIVIDUAL_CONCURRENCY)
    const read = await Promise.all(
      batch.map((target) => getServiceQuota(gw, target, { now, denial })),
    )
    for (let i = 0; i < read.length; i += 1) individual.set(batch[i].key, read[i])
  }
  const individualReads = attempted.length

  const asOf = now().toISOString()
  const refreshMs = {
    listing: CAPABILITIES["servicequotas:ListServiceQuotas"].refreshMs,
    individual: CAPABILITIES["servicequotas:GetServiceQuota"].refreshMs,
  }
  const identityResolved = identity.state === "ACTUAL" || identity.state === "STALE"

  const quotas: QuotaReading[] = targets.map((target) => {
    const listing = listings.get(target.serviceCode)
    const found = resolved.get(target.key)

    let quota: AwsRead<AppliedQuota>
    let listingCompleteness: Completeness = { kind: "complete" }
    if (listing && (listing.state === "ACTUAL" || listing.state === "STALE")) {
      listingCompleteness = listing.value.completeness
    }

    if (found && listing && listing.state === "STALE") {
      // The listing that carried it decides the freshness and the timestamp, so a
      // quota served out of a STALE listing does not claim to be fresh.
      quota = {
        state: "STALE",
        capability: listing.capability,
        value: found,
        asOf: listing.asOf,
        ageMs: listing.ageMs,
      }
    } else if (found) {
      quota = {
        state: "ACTUAL",
        capability: "servicequotas:ListServiceQuotas",
        value: found,
        asOf,
        fresh: true,
      }
    } else if (listing && listing.state !== "ACTUAL" && listing.state !== "STALE") {
      // The whole service was refused, throttled, empty or broken. It travels
      // unchanged — no cast, because the arms left after this narrowing are
      // precisely the ones with no `value` field, so nothing here can become a
      // number. Every OTHER service is unaffected, which is what "degrade
      // independently" means here.
      quota = listing
    } else {
      // The service answered and did not carry this quota, so it was asked for
      // individually. `??` is not a guard: it is the reading for a target the
      // per-load cap stopped this engine from asking about at all.
      quota = individual.get(target.key) ?? {
        state: "UNCONFIGURED",
        capability: "servicequotas:GetServiceQuota",
        why:
          `this engine makes at most ${MAX_INDIVIDUAL_QUOTA_READS} individual GetServiceQuota ` +
          `calls per load, and ${target.serviceCode}/${target.quotaCode} was past that cap. Its ` +
          `applied value was not read — which is not the same as its being unlimited.`,
      }
    }

    const usage = usageFor(target, quota, tagged, observations)
    const arn = quota.state === "ACTUAL" || quota.state === "STALE" ? quota.value.arn : null
    const parts = arn ? arn.split(":") : []

    return {
      key: target.key,
      serviceCode: target.serviceCode,
      quotaCode: target.quotaCode,
      quotaName: target.quotaName,
      bounds: target.bounds,
      quota,
      listingCompleteness,
      defaultValue: DEFAULT_QUOTA_NOT_READABLE,
      usage,
      headroom: headroomOf(quota, usage),
      attribution: attributionFor(quota, tagged, index),
      // From AWS's own ARN when there is one — AWS's answer beats anything
      // assembled — and otherwise from the resolved identity. Never a literal.
      // A quota ARN's region segment is empty for an account-wide quota, which
      // is a real answer and not a missing one, so `null` is used rather than "".
      partition: parts.length >= 6 ? parts[1] : identityResolved ? identity.value.partition : null,
      region:
        parts.length >= 6
          ? parts[3] || null
          : identityResolved
            ? identity.value.region
            : null,
      accountId: parts.length >= 6 ? parts[4] || null : identityResolved ? identity.value.accountId : null,
      refreshMs: found ? refreshMs.listing : refreshMs.individual,
      asOf,
    }
  })

  const services: ServiceQuotaListing[] = serviceCodes.map((serviceCode) => {
    const listing = listings.get(serviceCode) as AwsRead<ServiceQuotaPage>
    if (listing.state === "ACTUAL" || listing.state === "STALE") {
      return {
        serviceCode,
        quotas: { ...listing, value: listing.value.quotas },
        completeness: listing.value.completeness,
      }
    }
    return {
      serviceCode,
      // Same narrowing, same absence of a cast: nothing here can become `[]`.
      quotas: listing,
      completeness: { kind: "complete" },
    }
  })

  return {
    identity,
    tagged,
    services,
    quotas,
    pressure: quotaPressure(quotas),
    individualReads,
    asOf,
    refreshMs,
  }
}

/* ------------------------------------------------------------- pressure -- */

/**
 * Which quotas this estate is close to running out of.
 *
 * Exported and pure so the derivation can be reasoned about on its own, but
 * `quotaReadings` is the only production caller and the tests drive it through
 * there, not through here.
 */
export function quotaPressure(quotas: readonly QuotaReading[]): QuotaPressure {
  if (quotas.length === 0) {
    return { kind: "unknown", why: "no quota target was asked for, so no ceiling was read" }
  }

  const unreadable: string[] = []
  const usageUnknown: string[] = []
  const at: QuotaPressurePoint[] = []
  let compared = 0

  for (const reading of quotas) {
    if (reading.quota.state !== "ACTUAL" && reading.quota.state !== "STALE") {
      unreadable.push(reading.key)
      continue
    }
    const headroom = reading.headroom
    if (headroom.kind === "not-known") {
      usageUnknown.push(reading.key)
      continue
    }
    compared += 1
    const exact = headroom.kind === "known"
    const usedAtLeast = exact ? headroom.used : headroom.usedAtLeast
    const remainingAtMost = exact ? headroom.remaining : headroom.remainingAtMost
    const utilisationAtLeast = exact ? headroom.utilisation : headroom.utilisationAtLeast
    if (utilisationAtLeast < QUOTA_PRESSURE_FRACTION) continue
    at.push({
      key: reading.key,
      quotaName: reading.quota.value.quotaName,
      applied: headroom.applied,
      usedAtLeast,
      remainingAtMost,
      utilisationAtLeast,
      exact,
      bounds: reading.bounds,
      attribution: reading.attribution,
      asOf: reading.asOf,
    })
  }

  if (unreadable.length === quotas.length) {
    return {
      kind: "unknown",
      why:
        `not one of the ${quotas.length} quota(s) asked for could be read, so nothing can be said ` +
        `about any ceiling this estate provisions into`,
    }
  }
  if (at.length > 0) {
    return { kind: "at-risk", at, unreadable, usageUnknown }
  }
  if (compared === 0) {
    return {
      kind: "no-usage-known",
      quotasRead: quotas.length - unreadable.length,
      why:
        `${quotas.length - unreadable.length} quota(s) were read and NOT ONE has a usage number to ` +
        `compare against, so no headroom has been established. This is not "clear".`,
    }
  }
  return { kind: "clear", compared, unreadable, usageUnknown }
}

/* ------------------------------------------------------------ rendering -- */

/** A percentage as an integer, so two renders of one estate are byte-identical. */
function percent(fraction: number): number {
  return Math.round(fraction * 100)
}

/** The sentence a surface prints for one quota's usage. */
export function describeQuotaUsage(usage: QuotaUsageState): string {
  switch (usage.kind) {
    case "known":
      return `${usage.used} in use — counted by ${usage.source}, as of ${usage.asOf}`
    case "at-least":
      return `at least ${usage.usedAtLeast} in use — ${usage.why}`
    case "not-known":
      return `usage not known — ${usage.why}`
  }
}

/** The sentence a surface prints for one quota's headroom. */
export function describeHeadroom(headroom: Headroom): string {
  switch (headroom.kind) {
    case "known":
      return (
        `${headroom.used} of ${headroom.applied} used, ${headroom.remaining} left ` +
        `(${percent(headroom.utilisation)}%)`
      )
    case "upper-bound":
      return (
        `at least ${headroom.usedAtLeast} of ${headroom.applied} used, AT MOST ` +
        `${headroom.remainingAtMost} left (at least ${percent(headroom.utilisationAtLeast)}%)`
      )
    case "not-known":
      return `headroom not known — ${headroom.why}`
  }
}

/** The sentence a surface prints for one quota's attribution. */
export function describeQuotaAttribution(attribution: QuotaAttribution): string {
  switch (attribution.kind) {
    case "tenant":
      return attribution.tenantSlug
    case "shared":
      return `shared — ${attribution.why}`
    case "unknown":
      return `attribution unknown — ${attribution.why}`
  }
}

/** The sentence a surface prints for one quota. One funnel, so states cannot drift. */
export function describeQuota(reading: QuotaReading): string {
  const where =
    reading.region && reading.partition
      ? `${reading.region} (partition ${reading.partition})`
      : reading.partition
        ? `account-wide (partition ${reading.partition})`
        : "region unknown — identity is unresolved"
  // A truncated service listing changes what every one of its targets means, so
  // it is said on the target's own line and not only on the service's.
  const truncation =
    reading.listingCompleteness.kind === "truncated"
      ? ` · service listing ${describeCompleteness(reading.listingCompleteness)}`
      : ""
  const head = `${reading.quotaName} [${reading.serviceCode}] — ${where}${truncation}`

  if (reading.quota.state === "ACTUAL" || reading.quota.state === "STALE") {
    const q = reading.quota.value
    return (
      `${head} — applied ${q.value}${q.unit ? ` ${q.unit}` : ""}` +
      `${q.period ? ` per ${q.period.value} ${q.period.unit}` : ""} · ` +
      `${q.scope === "ACCOUNT" ? "account-wide" : "per region"} · ` +
      `${q.adjustable ? "an increase can be requested" : "NOT adjustable — an increase cannot be requested"} · ` +
      `${describeHeadroom(reading.headroom)} · ${describeQuotaUsage(reading.usage)} · ` +
      `default: ${reading.defaultValue.why} · ` +
      `${describeQuotaAttribution(reading.attribution)} · ` +
      `resolved via ${q.provenance} · ` +
      `as of ${reading.asOf}, refreshed every ${Math.round(reading.refreshMs / 1000)}s`
    )
  }
  // Every other state goes through the one renderer, so a refused quota reads as
  // a refusal here exactly as it does everywhere else — never as a ceiling.
  return `${head} — ${describeRead(reading.quota, `${reading.quotaName} applied value`)}`
}

/** The sentence a surface prints for the pressure state. */
export function describeQuotaPressure(pressure: QuotaPressure): string {
  switch (pressure.kind) {
    case "unknown":
      return `unknown — ${pressure.why}`
    case "no-usage-known":
      return `headroom not established — ${pressure.why}`
    case "clear": {
      const qualifier =
        pressure.unreadable.length === 0 && pressure.usageUnknown.length === 0
          ? ""
          : `, though ${pressure.unreadable.length} quota(s) could not be read` +
            `${pressure.unreadable.length > 0 ? ` (${pressure.unreadable.join(", ")})` : ""}` +
            ` and ${pressure.usageUnknown.length} have no usage number` +
            `${pressure.usageUnknown.length > 0 ? ` (${pressure.usageUnknown.join(", ")})` : ""}`
      return (
        `no quota pressure — ${pressure.compared} quota(s) have a usage number and every one is ` +
        `below ${percent(QUOTA_PRESSURE_FRACTION)}% of its applied value${qualifier}`
      )
    }
    case "at-risk": {
      const named = pressure.at
        .map(
          (point) =>
            `${point.quotaName} is ${point.exact ? "" : "at least "}${percent(point.utilisationAtLeast)}% used ` +
            `(${point.usedAtLeast} of ${point.applied}, at most ${point.remainingAtMost} left) — ${point.bounds}`,
        )
        .join("; ")
      const qualifier =
        pressure.unreadable.length === 0
          ? ""
          : ` A further ${pressure.unreadable.length} quota(s) could not be read.`
      return `QUOTA PRESSURE — ${pressure.at.length} quota(s) are near a ceiling: ${named}.${qualifier}`
    }
  }
}

/** The sentence a surface prints for how completely a service was walked. */
export function describeCompleteness(completeness: Completeness): string {
  return completeness.kind === "complete"
    ? "complete"
    : `truncated after ${completeness.pagesRead} page(s) — ${completeness.why}`
}

export interface QuotaLine {
  label: string
  text: string
}

/**
 * What a quota surface prints.
 *
 * The surface agent renders exactly these strings. The tests assert on them,
 * which is what makes the mutation proofs land on the production path rather
 * than on a helper nothing calls.
 */
export function quotaLines(readings: QuotaReadings): readonly QuotaLine[] {
  const lines: QuotaLine[] = [
    { label: "Quota pressure", text: describeQuotaPressure(readings.pressure) },
    {
      label: "Defaults",
      text:
        `not read — ${DEFAULT_QUOTA_NOT_READABLE.why} Grant ` +
        `${DEFAULT_QUOTA_NOT_READABLE.iamAction} and add it to the capability registry to answer it.`,
    },
  ]
  for (const service of readings.services) {
    lines.push({
      label: `Service ${service.serviceCode}`,
      text:
        `${describeRead(service.quotas, `applied quotas for ${service.serviceCode}, refreshed every ${Math.round(readings.refreshMs.listing / 1000)}s`)}` +
        ` · listing ${describeCompleteness(service.completeness)}`,
    })
  }
  for (const reading of readings.quotas) {
    lines.push({ label: reading.key, text: describeQuota(reading) })
  }
  return lines
}
