/**
 * CloudWatch Logs — the retention posture of every log group, and the bounded
 * evidence read that answers "what did it actually say".
 *
 * This service is dark. `infrastructure/terraform/ecs.tf` creates exactly one
 * log group — `/ecs/${local.name_prefix}`, at 30 days, with no `kms_key_id` and
 * no `tags` block — `cloudwatch.tf` builds a dashboard widget that queries it
 * for `/ERROR/`, and nothing in the running product has ever issued a
 * `logs:` call. So the console cannot say how many log groups the account
 * actually holds, which of them will never expire, how many bytes they are
 * billing for, whether any of them is encrypted with a customer key, or whether
 * the one group Terraform declares is still receiving anything at all.
 *
 * ## Retention is two different defects wearing one field
 *
 * `retentionInDays` absent means "Never expire". That is an unbounded bill and,
 * for a group carrying student data, a compliance problem — nothing ever ages
 * out of it. `retentionInDays: 1` is the opposite defect: by the time somebody
 * notices an incident the evidence has already been deleted. Both are wrong and
 * they are wrong in opposite directions, so `RetentionPosture` names them
 * separately rather than rendering a number an operator has to interpret.
 *
 * Note especially that `null` retention is NOT rendered as "unknown". AWS's
 * omission of the field is a positive statement — the API says a group with no
 * `retentionInDays` never expires — and reporting that as unknown would hide the
 * exact finding this module exists to surface.
 *
 * ## A silent log group reads exactly like a calm one
 *
 * A group that has received nothing since before the last deploy means the thing
 * that writes to it stopped. On a dashboard that shows error counts, that is
 * indistinguishable from a service having no errors: both are a flat line at
 * zero. `LastEventAge` makes the difference a value.
 *
 * It is not read by default. Deciding whether a group is silent costs a
 * `FilterLogEvents` call, which is billed for the bytes it scans, and a console
 * left open on a page that probed every group in the account is a line on the
 * bill nobody chose. So `logGroupReadings` probes only when the caller passes
 * `probeSilenceWindowMs`, and every group carries `NOT_PROBED` otherwise — a
 * value a surface has to render, not a field it can forget.
 *
 * The probe never returns a log line. It reads one page over a bounded window
 * and keeps the largest timestamp; the messages are discarded inside this
 * module. A timestamp is metadata about whether a writer is alive, and it is the
 * only thing the probe reports.
 *
 * ## What the probe can and cannot claim
 *
 * `RECEIVING` carries `mostRecentSeenAt`, which is a LOWER bound on the true
 * most recent event: `FilterLogEvents` interleaves streams and returns a page,
 * not the tail. The derived `ageMs` is therefore an UPPER bound on the true age.
 * Both are named that way on the type. `SILENT` claims only "nothing in the last
 * N milliseconds", never an exact age, because reading back far enough to find
 * the true last event is an unbounded scan of a billed API.
 *
 * ## The events read is bounded in four directions at once
 *
 * A caller names a group, a window and a pattern. The pattern may not be empty:
 * `client.ts` turns an empty `filterPattern` into `undefined`, which matches
 * every line in the window, so "" is not a narrow search — it is the widest
 * possible one, arriving through a field that looks like a filter. The window
 * may not be inverted and may not exceed `MAX_EVENT_WINDOW_MS`. The event count
 * is capped at `MAX_EVENTS_RETURNED` and the page loop at `MAX_EVENT_PAGES`, and
 * when either bound is hit with a `nextToken` still outstanding the page says
 * `hasMore: true` — it does not return a truncated result that looks whole.
 *
 * No continuation token is handed back. The remedy for "there were more" is a
 * narrower window or a narrower pattern, not an unbounded walk driven from a
 * browser.
 *
 * ## Nothing here redacts by guessing
 *
 * Messages come back verbatim, truncated only at `MAX_MESSAGE_CHARS` with the
 * truncation stated per event and the original length carried, because a
 * silently shortened log line is a log line an operator misreads. What this
 * module does instead is REFUSE: a log group whose NAME marks it as carrying
 * tenant data returns no events at all unless the caller passes
 * `acknowledgeTenantData`, and the refusal names the marker that fired.
 *
 * `no-marker` is emphatically not a certification that a group is free of tenant
 * data. It means the group's name does not say so. This module cannot inspect
 * content and does not pretend to.
 *
 * ## The ARN join has a trap in it
 *
 * `DescribeLogGroups` returns `arn:…:log-group:/ecs/tenure-prod:*` — with a
 * trailing `:*` — and the Resource Groups Tagging API returns the same group as
 * `arn:…:log-group:/ecs/tenure-prod`, without it. Joined raw, every log group in
 * the estate misses the tag index and renders as unattributable, which reads as
 * a tagging failure that is not there. `normalizeLogGroupArn` strips it, once,
 * on the way out of the API.
 *
 * ## Region and partition
 *
 * From the log group's own ARN where AWS returned one, and otherwise from the
 * resolved identity. There is no literal region in this file and no `"aws"`
 * partition fallback — GE-010-007 was a data-residency defect caused by exactly
 * that fallback.
 *
 * ## Sub-reads degrade independently
 *
 * The group listing is one `AwsRead`. Every group's metric filters is its own
 * `AwsRead`, because `logs:DescribeMetricFilters` is a separate IAM action a
 * role is routinely granted without, and folding it into the listing would make
 * a denied filter read print the minimum statement for `logs:DescribeLogGroups`
 * — an operator would grant that, redeploy, and be refused identically. A group
 * whose filters were refused still appears, saying it was refused.
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
 * How many `DescribeLogGroups` pages to walk before saying so.
 *
 * The API returns 50 groups per page by default, so this is a thousand groups.
 * A reader with no bound is how one page render becomes an outage; a reader that
 * silently returns the first page is the same lie as an empty list. Hitting this
 * sets `truncated` on the reading and the surface prints it.
 */
export const MAX_LOG_GROUP_PAGES = 20

/**
 * How many groups get their metric filters read in one load.
 *
 * `DescribeMetricFilters` is one call per group against a per-account throttle.
 * Groups past the budget are UNCONFIGURED naming the budget — never EMPTY, which
 * would claim a group has no filters when nobody looked.
 */
export const MAX_METRIC_FILTER_READS = 100

/** How many metric-filter reads are in flight at once. Bounded so a load is not a burst. */
const METRIC_FILTER_CONCURRENCY = 6

/** How many `DescribeMetricFilters` pages per group. 50 per page in `client.ts`. */
const MAX_METRIC_FILTER_PAGES = 10

/**
 * The hard cap on events returned from one `filterLogEvents` call.
 *
 * `client.ts` already caps the API's own `limit` at 100 per request; this caps
 * the total across pages. Reaching it sets `hasMore` — the caller is told, and
 * gets no continuation token.
 */
export const MAX_EVENTS_RETURNED = 200

/** How many pages the event loop may walk. With the API's 100/page, two fill the cap. */
export const MAX_EVENT_PAGES = 5

/**
 * The widest window `filterLogEvents` will accept, in milliseconds. Seven days.
 *
 * `FilterLogEvents` is billed for the bytes it scans over the window, not for
 * the events it returns, so the window — not the cap — is what a wide query
 * actually costs. Seven days covers an incident review; a month-wide scan of a
 * busy group started from a browser is a bill, and it is rejected by name rather
 * than quietly clamped, because a clamped window returns a partial answer that
 * looks complete.
 */
export const MAX_EVENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/** How much of one event's message is returned. Truncation is stated, never silent. */
export const MAX_MESSAGE_CHARS = 4000

/**
 * Below this many days of retention, an incident is over before anybody can
 * read the evidence.
 *
 * Seven, because on-call rotates weekly: a fault that starts on a Saturday and
 * is escalated on the following Friday must still have its logs. This is a
 * judgement written down and named, not a number AWS publishes.
 */
export const SHORTEST_USEFUL_RETENTION_DAYS = 7

/** The retry schedule is `throttle.ts`'s, not a literal. See its header on jitter. */
const RETRY: { attempts: number; backoffMs: number } = {
  attempts: READ_ATTEMPTS,
  // `backoffMs(2)` is the pause after the first failure; `readAws` doubles it.
  backoffMs: backoffMs(2),
}

/* ---------------------------------------------------------------- shapes -- */

/** The API's shapes, declared rather than imported — see `client.ts`'s one-owner rule. */
interface DescribeLogGroupsResponse {
  logGroups?: Array<{
    logGroupName?: string
    creationTime?: number
    retentionInDays?: number
    metricFilterCount?: number
    arn?: string
    storedBytes?: number
    kmsKeyId?: string
    dataProtectionStatus?: string
    logGroupClass?: string
  }>
  nextToken?: string
}

interface DescribeMetricFiltersResponse {
  metricFilters?: Array<{
    filterName?: string
    filterPattern?: string
    logGroupName?: string
    creationTime?: number
    metricTransformations?: Array<{
      metricName?: string
      metricNamespace?: string
      metricValue?: string
      defaultValue?: number
    }>
  }>
  nextToken?: string
}

interface FilterLogEventsResponse {
  events?: Array<{
    eventId?: string
    logStreamName?: string
    timestamp?: number
    ingestionTime?: number
    message?: string
  }>
  nextToken?: string
}

/* ------------------------------------------------------------- retention -- */

/**
 * What a log group's retention setting actually means.
 *
 * Four arms, because "30 days" and "never expires" and "one day" are three
 * different operational facts and the fourth — AWS returned something that is
 * not a positive number of days — must not be folded into any of them.
 */
export type RetentionPosture =
  /**
   * `retentionInDays` absent. AWS's documented meaning is "Never expire": the
   * group grows forever and nothing ages out of it. A finding, not an unknown.
   */
  | { kind: "never-expires"; why: string }
  /** Shorter than `SHORTEST_USEFUL_RETENTION_DAYS`. The evidence is gone before the review. */
  | { kind: "too-short"; days: number; why: string }
  /** A retention somebody chose that outlives an on-call rotation. */
  | { kind: "retained"; days: number }
  /** AWS answered with something that is not a day count. Reported, never coerced. */
  | { kind: "unreadable"; raw: string; why: string }

export function classifyRetention(retentionInDays: number | undefined | null): RetentionPosture {
  if (retentionInDays === undefined || retentionInDays === null) {
    return {
      kind: "never-expires",
      why:
        "logs:DescribeLogGroups returned no retentionInDays for this group, which AWS defines as " +
        "Never expire. Stored bytes only ever grow, and nothing in it ever ages out — an " +
        "unbounded bill, and for a group carrying tenant data a retention-policy breach.",
    }
  }
  if (!Number.isFinite(retentionInDays) || retentionInDays <= 0) {
    return {
      kind: "unreadable",
      raw: String(retentionInDays),
      why: "retentionInDays is not a positive number of days. Not treated as Never expire and not treated as a setting.",
    }
  }
  if (retentionInDays < SHORTEST_USEFUL_RETENTION_DAYS) {
    return {
      kind: "too-short",
      days: retentionInDays,
      why:
        `${retentionInDays} day(s) of retention is shorter than the ${SHORTEST_USEFUL_RETENTION_DAYS}-day ` +
        `on-call rotation. An incident that starts at the beginning of a week has no evidence left by the ` +
        `time it is reviewed at the end of it.`,
    }
  }
  return { kind: "retained", days: retentionInDays }
}

/** The sentence a surface prints for a retention posture. One renderer, so states cannot drift. */
export function describeRetention(posture: RetentionPosture): string {
  switch (posture.kind) {
    case "never-expires":
      return `NEVER EXPIRES — ${posture.why}`
    case "too-short":
      return `${posture.days} day(s) — TOO SHORT: ${posture.why}`
    case "retained":
      return `${posture.days} day(s) retention`
    case "unreadable":
      return `retention unreadable — ${posture.why} (AWS returned ${posture.raw})`
  }
}

/* ------------------------------------------------------------ encryption -- */

/**
 * Whether a group is encrypted with a customer-managed KMS key.
 *
 * `absent` says what it observed and nothing more. CloudWatch Logs encrypts
 * every group at rest with an AWS-owned key whether or not a `kmsKeyId` is set,
 * so "no CMK" is not "unencrypted" — writing that would be a false finding — but
 * it IS the difference between a key this estate can revoke and one it cannot.
 */
export type LogEncryption =
  | { kind: "customer-key"; kmsKeyArn: string }
  | { kind: "aws-owned-key"; why: string }

export function classifyEncryption(kmsKeyId: string | undefined | null): LogEncryption {
  if (typeof kmsKeyId === "string" && kmsKeyId.trim()) {
    return { kind: "customer-key", kmsKeyArn: kmsKeyId }
  }
  return {
    kind: "aws-owned-key",
    why:
      "no kmsKeyId is set, so this group is encrypted with the AWS-owned CloudWatch Logs key. " +
      "That is encryption at rest, but it is not a key this estate holds, can audit, or can revoke.",
  }
}

/* ----------------------------------------------------------- sensitivity -- */

/**
 * A name fragment that marks a log group as carrying tenant data, and why it
 * does.
 *
 * Ordered and exported so the rule is reviewable rather than buried in a
 * function, and so a test can assert on the exact marker that fired. Matched
 * case-insensitively against the group name.
 *
 * The list deliberately includes the platform's own ECS log prefix. `/ecs/…` is
 * the application task's stdout for a service serving real students: it carries
 * request paths, identifiers and error payloads. It is also the single most
 * useful group during an incident, which is precisely why the guard is an
 * acknowledgement rather than a block.
 */
export const TENANT_DATA_MARKERS: readonly { pattern: RegExp; why: string }[] = [
  {
    pattern: /\/ecs\//i,
    why: "an ECS task's stdout — the application's own request logs for a service carrying real student data",
  },
  { pattern: /student/i, why: "the group name names students" },
  { pattern: /applicant/i, why: "the group name names applicants" },
  { pattern: /tenant/i, why: "the group name names a tenant" },
  { pattern: /pii/i, why: "the group name declares personally identifying information" },
  { pattern: /document/i, why: "the group name names documents, which in this platform are uploads" },
  { pattern: /submission/i, why: "the group name names submissions" },
  { pattern: /transcript/i, why: "the group name names transcripts" },
  { pattern: /recommendation/i, why: "the group name names recommendations, which are written about a person" },
  { pattern: /audit/i, why: "the group name names an audit trail, which records who did what to whom" },
]

/**
 * Whether a group's NAME marks it as carrying tenant data.
 *
 * `no-marker` is not a certification. This module reads names and metadata; it
 * cannot inspect content, and it does not pretend the absence of a marker is
 * evidence of absence. The arm says so in its own `why` so a surface cannot
 * render it as "safe".
 */
export type LogSensitivity =
  | { kind: "tenant-data"; marker: string; why: string }
  | { kind: "no-marker"; why: string }

export function classifyLogGroupSensitivity(logGroupName: string): LogSensitivity {
  for (const marker of TENANT_DATA_MARKERS) {
    if (marker.pattern.test(logGroupName)) {
      return {
        kind: "tenant-data",
        marker: marker.pattern.source,
        why: `${marker.why}. Events are withheld unless the caller acknowledges reading tenant data.`,
      }
    }
  }
  return {
    kind: "no-marker",
    why:
      "no marker in this group's name says it carries tenant data. That is a statement about the " +
      "NAME — this engine cannot inspect content and does not certify the group is free of it.",
  }
}

/* ------------------------------------------------------------- freshness -- */

/**
 * When this group last received anything — and how sure this engine is.
 *
 * `NOT_PROBED` is the default and it is a value, not a null. A surface that
 * printed nothing for an unprobed group would let an operator read a silent
 * writer as a quiet one.
 */
export type LastEventAge =
  /** No `FilterLogEvents` call was made for this group. Billing decision, made by the caller. */
  | { state: "NOT_PROBED"; why: string }
  /**
   * At least one event landed inside the probe window.
   *
   * `mostRecentSeenAt` is a LOWER bound on the true most recent event and
   * `ageMs` an UPPER bound on its true age: the probe reads one page, and
   * `FilterLogEvents` interleaves streams rather than returning the tail.
   */
  | {
      state: "RECEIVING"
      windowMs: number
      mostRecentSeenAt: string
      ageMsUpperBound: number
      asOf: string
    }
  /** Nothing in the window. The true age is longer than this and is not read. */
  | { state: "SILENT"; forAtLeastMs: number; silentSince: string; why: string; asOf: string }
  /** The probe itself was refused, throttled or broken. Never rendered as silence. */
  | { state: "UNREADABLE"; why: string }

/** The sentence a surface prints for a freshness reading. */
export function describeLastEvent(age: LastEventAge): string {
  switch (age.state) {
    case "NOT_PROBED":
      return `last event not probed — ${age.why}`
    case "RECEIVING":
      return (
        `receiving — an event at or after ${age.mostRecentSeenAt}, at most ` +
        `${Math.round(age.ageMsUpperBound / 1000)}s old (a page of a ${Math.round(age.windowMs / 1000)}s window, ` +
        `so this is a lower bound on the true tail)`
      )
    case "SILENT":
      return (
        `SILENT — nothing written for at least ${Math.round(age.forAtLeastMs / 1000)}s, since before ` +
        `${age.silentSince}. ${age.why}`
      )
    case "UNREADABLE":
      return `last event unknown — ${age.why}`
  }
}

/* ---------------------------------------------------------- metric filters -- */

export interface MetricTransformation {
  metricName: string
  metricNamespace: string
  metricValue: string | null
  defaultValue: number | null
}

export interface MetricFilter {
  filterName: string
  /** The pattern that turns a log line into a metric. Verbatim — this is configuration. */
  filterPattern: string
  logGroupName: string | null
  createdAt: string | null
  transformations: readonly MetricTransformation[]
}

/**
 * A group's metric filters, plus what AWS's own count said before we asked.
 *
 * `declaredCount` comes from `DescribeLogGroups`'s `metricFilterCount` and is
 * the reason a group with zero filters costs no second call — but that skip is
 * recorded in `provenance` rather than being invisible, and `discrepancy` names
 * the case where the count and the list disagree, which means somebody changed
 * a filter between the two calls.
 */
export interface MetricFilterReading {
  declaredCount: number | null
  filters: AwsRead<readonly MetricFilter[]>
  /** Whether `DescribeMetricFilters` was called for this group, and if not, why not. */
  provenance: string
  discrepancy: string | null
}

/* ------------------------------------------------------------ attribution -- */

/**
 * Which tenant a log group belongs to.
 *
 * `tags.ts`'s three answers plus `unknown`, which the three cannot express: the
 * tag index is its own AWS read and it can be denied, throttled or broken. A
 * group whose tags were never read must not render as "unattributable — missing
 * tenure:tenant", because that sentence sends an operator to add a tag that is
 * probably already there.
 */
export type LogGroupAttribution =
  | { kind: "tenant"; tenantSlug: string }
  | { kind: "shared" }
  | { kind: "unattributed" }
  | { kind: "unknown"; why: string }

/** The sentence a surface prints for one group's attribution. */
export function describeLogGroupAttribution(attribution: LogGroupAttribution): string {
  switch (attribution.kind) {
    case "tenant":
      return attribution.tenantSlug
    case "shared":
      return "shared — platform overhead, decided"
    case "unattributed":
      return "unattributable — missing tenure:tenant"
    case "unknown":
      return `attribution unknown — ${attribution.why}`
  }
}

/* --------------------------------------------------------------- reading -- */

export interface LogGroupReading {
  logGroupName: string
  /** AWS's own ARN with the trailing `:*` removed — see the module header on the join. */
  arn: string | null
  arnProvenance: string
  region: string | null
  partition: string | null
  accountId: string | null
  attribution: LogGroupAttribution
  retention: RetentionPosture
  encryption: LogEncryption
  sensitivity: LogSensitivity
  /** What the bill is actually for. Null when AWS omitted it — never rendered as zero. */
  storedBytes: number | null
  createdAt: string | null
  /** STANDARD or INFREQUENT_ACCESS. Verbatim; null when AWS did not say. */
  logGroupClass: string | null
  /** AWS's own audit-data-protection status, verbatim. Null when AWS did not say. */
  dataProtectionStatus: string | null
  metricFilters: MetricFilterReading
  lastEvent: LastEventAge
  refreshMs: number
  asOf: string
}

/**
 * Whether the group listing was walked to the end.
 *
 * A separate value rather than a flag buried in the array, because "these are
 * the groups" and "these are the first thousand groups" are different claims and
 * only one of them is safe to draw a retention conclusion from.
 */
export type ListingCompleteness =
  | { kind: "complete"; pagesWalked: number }
  | { kind: "truncated"; pagesWalked: number; why: string }

export interface LogsReadings {
  identity: AwsRead<Identity>
  tagged: AwsRead<readonly TaggedResource[]>
  /**
   * The log groups. DENIED here is a refused `logs:DescribeLogGroups` and is
   * NEVER `[]` — an operator reading "no log groups" when the truth is "we were
   * not allowed to look" is the single most dangerous thing this surface can say.
   */
  groups: AwsRead<readonly LogGroupReading[]>
  completeness: ListingCompleteness
  asOf: string
  refreshMs: { groups: number; metricFilters: number; events: number }
}

/* --------------------------------------------------------------- helpers -- */

/**
 * `DescribeLogGroups` returns `…:log-group:/ecs/tenure-prod:*`; the Resource
 * Groups Tagging API returns the same group without the trailing `:*`. Joined
 * raw, every group in the estate misses the tag index and renders as
 * unattributable — a tagging failure that is not there.
 */
export function normalizeLogGroupArn(arn: string): string {
  return arn.endsWith(":*") ? arn.slice(0, -2) : arn
}

function isoFromEpochMillis(value: number | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** Attribution from the tag index, with `unknown` when the index was not readable. */
function attributionFor(
  arn: string | null,
  tagged: AwsRead<readonly TaggedResource[]>,
  index: Map<string, Readonly<Record<string, string>>>,
): LogGroupAttribution {
  if (tagged.state !== "ACTUAL" && tagged.state !== "STALE" && tagged.state !== "EMPTY") {
    return {
      kind: "unknown",
      why: `this log group's tags were not read — ${describeRead(tagged, "the tag index")}`,
    }
  }
  if (!arn) {
    return {
      kind: "unknown",
      why:
        "this log group has no ARN this engine can state, so it cannot be joined against the tag " +
        "index. Unattributed would be a claim about its tags; this is a claim about ours.",
    }
  }
  const tags = index.get(arn)
  // The tag index answered and this ARN is not in it. That IS an observation:
  // the Resource Groups Tagging API returns resources that have tags, so an
  // absence means no tags at all, which is what `unattributed` says.
  if (tags === undefined) return { kind: "unattributed" }
  const decided = attributionOf(tags)
  switch (decided.kind) {
    case "tenant":
      return { kind: "tenant", tenantSlug: decided.tenantSlug }
    case "shared":
      return { kind: "shared" }
    case "unattributed":
      return { kind: "unattributed" }
  }
}

/* ------------------------------------------------------------ the listing -- */

/** One raw group as AWS returned it, before it is joined against anything. */
interface RawLogGroup {
  logGroupName: string
  arn: string | null
  retentionInDays: number | undefined
  metricFilterCount: number | null
  storedBytes: number | null
  kmsKeyId: string | undefined
  creationTime: number | undefined
  logGroupClass: string | null
  dataProtectionStatus: string | null
}

/**
 * Every log group, paged to the end or to `MAX_LOG_GROUP_PAGES`.
 *
 * The bound does NOT throw. A truncated listing is still the most useful thing
 * this engine has — the retention findings in the first thousand groups are real
 * findings — so it is returned WITH `truncated`, and `logsLines` prints that
 * sentence. What must never happen is a partial list rendered as if it were the
 * estate, and the completeness value is what stops it.
 */
async function listLogGroups(
  gw: AwsGateway,
  options: { now: () => Date; denial: DenialContext },
  seen: { pagesWalked: number; truncated: boolean },
): Promise<AwsRead<readonly RawLogGroup[]>> {
  return readAws<readonly RawLogGroup[]>(
    "logs:DescribeLogGroups",
    async () => {
      const out: RawLogGroup[] = []
      let token: string | undefined
      for (let page = 0; page < MAX_LOG_GROUP_PAGES; page += 1) {
        const response = (await gw.call("logs:DescribeLogGroups", {
          nextToken: token,
        })) as DescribeLogGroupsResponse
        seen.pagesWalked = page + 1
        for (const group of response?.logGroups ?? []) {
          if (typeof group.logGroupName !== "string" || !group.logGroupName) continue
          out.push({
            logGroupName: group.logGroupName,
            arn: typeof group.arn === "string" && group.arn ? normalizeLogGroupArn(group.arn) : null,
            retentionInDays: group.retentionInDays,
            metricFilterCount:
              typeof group.metricFilterCount === "number" ? group.metricFilterCount : null,
            // Null, not zero. "AWS did not report stored bytes" and "this group
            // stores nothing" are different, and only the second is a claim.
            storedBytes: typeof group.storedBytes === "number" ? group.storedBytes : null,
            kmsKeyId: group.kmsKeyId,
            creationTime: group.creationTime,
            logGroupClass:
              typeof group.logGroupClass === "string" ? group.logGroupClass : null,
            dataProtectionStatus:
              typeof group.dataProtectionStatus === "string" ? group.dataProtectionStatus : null,
          })
        }
        token = response?.nextToken || undefined
        if (!token) break
        if (page === MAX_LOG_GROUP_PAGES - 1) seen.truncated = true
      }
      // Sorted so two loads of the same estate produce the same order.
      // `DescribeLogGroups` does not promise one, and an order that changes
      // between renders makes a diff of two screenshots unreadable.
      return out.sort((a, b) => (a.logGroupName < b.logGroupName ? -1 : a.logGroupName > b.logGroupName ? 1 : 0))
    },
    { now: options.now, denial: options.denial, ...RETRY },
  )
}

async function readMetricFilters(
  gw: AwsGateway,
  logGroupName: string,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<readonly MetricFilter[]>> {
  return readAws<readonly MetricFilter[]>(
    "logs:DescribeMetricFilters",
    async () => {
      const out: MetricFilter[] = []
      let token: string | undefined
      for (let page = 0; page < MAX_METRIC_FILTER_PAGES; page += 1) {
        const response = (await gw.call("logs:DescribeMetricFilters", {
          logGroupName,
          nextToken: token,
        })) as DescribeMetricFiltersResponse
        for (const filter of response?.metricFilters ?? []) {
          if (typeof filter.filterName !== "string" || !filter.filterName) continue
          out.push({
            filterName: filter.filterName,
            filterPattern: typeof filter.filterPattern === "string" ? filter.filterPattern : "",
            logGroupName: typeof filter.logGroupName === "string" ? filter.logGroupName : null,
            createdAt: isoFromEpochMillis(filter.creationTime),
            transformations: (filter.metricTransformations ?? [])
              .filter((t) => typeof t.metricName === "string" && typeof t.metricNamespace === "string")
              .map((t) => ({
                metricName: t.metricName as string,
                metricNamespace: t.metricNamespace as string,
                metricValue: typeof t.metricValue === "string" ? t.metricValue : null,
                defaultValue: typeof t.defaultValue === "number" ? t.defaultValue : null,
              })),
          })
        }
        token = response?.nextToken || undefined
        if (!token) break
        if (page === MAX_METRIC_FILTER_PAGES - 1) {
          throw new Error(
            `logs:DescribeMetricFilters still had pages for ${logGroupName} after ` +
              `${MAX_METRIC_FILTER_PAGES}. This engine will not render a partial filter list as if ` +
              `it were the group's configuration.`,
          )
        }
      }
      return out.sort((a, b) => (a.filterName < b.filterName ? -1 : a.filterName > b.filterName ? 1 : 0))
    },
    { now: options.now, denial: options.denial, ...RETRY },
  )
}

/**
 * Has this group received anything in the last `windowMs`?
 *
 * One page, bounded window, and the messages are dropped before they leave this
 * function — only the largest timestamp survives. See the module header on why
 * this is a bound rather than an exact age.
 */
async function probeSilence(
  gw: AwsGateway,
  logGroupName: string,
  windowMs: number,
  options: { now: () => Date; denial: DenialContext },
): Promise<LastEventAge> {
  const at = options.now()
  const endTime = at.getTime()
  const startTime = endTime - windowMs

  const read = await readAws<{ mostRecent: number | null }>(
    "logs:FilterLogEvents",
    async () => {
      const response = (await gw.call("logs:FilterLogEvents", {
        logGroupName,
        startTime,
        endTime,
        // No filterPattern: the question is "did ANYTHING arrive", and a pattern
        // would answer a narrower one. The window is what bounds the scan.
      })) as FilterLogEventsResponse
      let mostRecent: number | null = null
      for (const event of response?.events ?? []) {
        if (typeof event.timestamp !== "number" || !Number.isFinite(event.timestamp)) continue
        if (mostRecent === null || event.timestamp > mostRecent) mostRecent = event.timestamp
      }
      // The message bodies go out of scope here and are never returned. A
      // timestamp says whether a writer is alive; a message is tenant content.
      return { mostRecent }
    },
    {
      now: options.now,
      denial: options.denial,
      // A window with no events is a real, meaningful answer — it is the SILENT
      // finding. `looksEmpty` would turn `{mostRecent: null}` into EMPTY, which
      // renders as "returned nothing" rather than as the finding.
      isEmpty: () => false,
      ...RETRY,
    },
  )

  if (read.state !== "ACTUAL" && read.state !== "STALE") {
    return {
      state: "UNREADABLE",
      why: describeRead(read, `${logGroupName} freshness probe`),
    }
  }
  const asOf = at.toISOString()
  const mostRecent = read.value.mostRecent
  if (mostRecent === null) {
    return {
      state: "SILENT",
      forAtLeastMs: windowMs,
      silentSince: new Date(startTime).toISOString(),
      why:
        "the thing that writes to this group has stopped, or was never deployed. On a dashboard " +
        "counting errors that is indistinguishable from having none.",
      asOf,
    }
  }
  return {
    state: "RECEIVING",
    windowMs,
    mostRecentSeenAt: new Date(mostRecent).toISOString(),
    ageMsUpperBound: Math.max(0, endTime - mostRecent),
    asOf,
  }
}

/* ----------------------------------------------------------- the surface -- */

export interface LogGroupReadingsOptions {
  now?: () => Date
  /**
   * Probe each group for silence over this many milliseconds.
   *
   * Omitted — the default — means no `FilterLogEvents` call is made and every
   * group carries `NOT_PROBED`. Present means one billed call per group, up to
   * `MAX_METRIC_FILTER_READS` groups, which is the caller's decision to make and
   * not this module's.
   */
  probeSilenceWindowMs?: number
}

/**
 * Every log group the account holds, with its retention, its bytes, its key, its
 * metric filters and — when asked — whether anything is still writing to it.
 *
 * The production entry point. A route or a page calls it with no arguments and
 * gets the live gateway; a test passes a stand-in gateway to the SAME function,
 * because a test that drove a private helper would stay green on the day the
 * caller stopped calling it.
 */
export async function logGroupReadings(
  supplied?: AwsGateway,
  options: LogGroupReadingsOptions = {},
): Promise<LogsReadings> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())

  const identity = await resolveIdentity(supplied, { now })
  const denial = denialContextFrom(identity)
  const tagged = await taggedResources(supplied, { now, denial })
  const index = tagIndex(
    tagged.state === "ACTUAL" || tagged.state === "STALE" ? tagged.value : [],
  )

  const seen = { pagesWalked: 0, truncated: false }
  const listed = await listLogGroups(gw, { now, denial }, seen)
  const asOf = now().toISOString()
  const refreshMs = {
    groups: CAPABILITIES["logs:DescribeLogGroups"].refreshMs,
    metricFilters: CAPABILITIES["logs:DescribeMetricFilters"].refreshMs,
    events: CAPABILITIES["logs:FilterLogEvents"].refreshMs,
  }
  const completeness: ListingCompleteness = seen.truncated
    ? {
        kind: "truncated",
        pagesWalked: seen.pagesWalked,
        why:
          `logs:DescribeLogGroups still had pages after ${MAX_LOG_GROUP_PAGES}. These are the first ` +
          `groups this engine read, not every group in the account — no conclusion about the estate's ` +
          `retention posture can be drawn from them.`,
      }
    : { kind: "complete", pagesWalked: seen.pagesWalked }

  // DENIED, THROTTLED, ERROR, UNCONFIGURED and EMPTY all travel unchanged. In
  // particular there is no branch here that turns any of them into an array.
  if (listed.state !== "ACTUAL" && listed.state !== "STALE") {
    // No cast: the arms left after this narrowing are precisely the ones with no
    // `value` field, so they are already an `AwsRead<LogGroupReading[]>`.
    const groups: AwsRead<readonly LogGroupReading[]> = listed
    return { identity, tagged, groups, completeness, asOf, refreshMs }
  }

  const raw = listed.value
  const filterReadings: MetricFilterReading[] = new Array(raw.length)
  const freshness: LastEventAge[] = new Array(raw.length)

  for (let start = 0; start < raw.length; start += METRIC_FILTER_CONCURRENCY) {
    const batch = raw.slice(start, start + METRIC_FILTER_CONCURRENCY)
    await Promise.all(
      batch.map(async (group, offset) => {
        const position = start + offset
        filterReadings[position] = await metricFilterReadingFor(gw, group, position, raw.length, {
          now,
          denial,
        })
        freshness[position] = await freshnessFor(gw, group, position, raw.length, options, {
          now,
          denial,
        })
      }),
    )
  }

  const identityResolved = identity.state === "ACTUAL" || identity.state === "STALE"
  const readings: LogGroupReading[] = raw.map((group, i) => {
    const parts = group.arn ? group.arn.split(":") : []
    const fromArn = parts.length >= 6 && parts[0] === "arn"
    return {
      logGroupName: group.logGroupName,
      arn: group.arn,
      arnProvenance: group.arn
        ? "AWS's own log group ARN, with the trailing :* removed so it joins the tag index"
        : "none — logs:DescribeLogGroups returned this group without an ARN, so it cannot be " +
          "attributed and this engine will not assemble one it cannot stand behind",
      partition: fromArn ? parts[1] : identityResolved ? identity.value.partition : null,
      region: fromArn ? parts[3] : identityResolved ? identity.value.region : null,
      accountId: fromArn ? parts[4] : identityResolved ? identity.value.accountId : null,
      attribution: attributionFor(group.arn, tagged, index),
      retention: classifyRetention(group.retentionInDays),
      encryption: classifyEncryption(group.kmsKeyId),
      sensitivity: classifyLogGroupSensitivity(group.logGroupName),
      storedBytes: group.storedBytes,
      createdAt: isoFromEpochMillis(group.creationTime),
      logGroupClass: group.logGroupClass,
      dataProtectionStatus: group.dataProtectionStatus,
      metricFilters: filterReadings[i],
      lastEvent: freshness[i],
      refreshMs: refreshMs.groups,
      asOf,
    }
  })

  const groups: AwsRead<readonly LogGroupReading[]> = { ...listed, value: readings }
  return { identity, tagged, groups, completeness, asOf, refreshMs }
}

async function metricFilterReadingFor(
  gw: AwsGateway,
  group: RawLogGroup,
  position: number,
  total: number,
  options: { now: () => Date; denial: DenialContext },
): Promise<MetricFilterReading> {
  if (position >= MAX_METRIC_FILTER_READS) {
    return {
      declaredCount: group.metricFilterCount,
      filters: {
        state: "UNCONFIGURED",
        capability: "logs:DescribeMetricFilters",
        why:
          `this engine reads at most ${MAX_METRIC_FILTER_READS} groups' metric filters per load and ` +
          `this group is number ${position + 1} of ${total}. Its filters were not read — which is not ` +
          `the same as its having none.`,
      },
      provenance: `not called — past the ${MAX_METRIC_FILTER_READS}-group budget`,
      discrepancy: null,
    }
  }

  if (group.metricFilterCount === 0) {
    return {
      declaredCount: 0,
      filters: {
        state: "EMPTY",
        capability: "logs:DescribeMetricFilters",
        asOf: options.now().toISOString(),
      },
      provenance:
        "not called — logs:DescribeLogGroups reported metricFilterCount 0 for this group, which is " +
        "AWS's own count and is the same service answering the same question more cheaply",
      discrepancy: null,
    }
  }

  const filters = await readMetricFilters(gw, group.logGroupName, options)
  let discrepancy: string | null = null
  if (
    (filters.state === "ACTUAL" || filters.state === "STALE") &&
    group.metricFilterCount !== null &&
    filters.value.length !== group.metricFilterCount
  ) {
    discrepancy =
      `logs:DescribeLogGroups reported ${group.metricFilterCount} metric filter(s) on this group and ` +
      `logs:DescribeMetricFilters returned ${filters.value.length}. Somebody changed a filter between ` +
      `the two calls, or one of the two answers is stale.`
  }
  if (filters.state === "EMPTY" && group.metricFilterCount !== null && group.metricFilterCount > 0) {
    discrepancy =
      `logs:DescribeLogGroups reported ${group.metricFilterCount} metric filter(s) on this group and ` +
      `logs:DescribeMetricFilters returned none.`
  }
  return {
    declaredCount: group.metricFilterCount,
    filters,
    provenance: "logs:DescribeMetricFilters, paged to the end",
    discrepancy,
  }
}

async function freshnessFor(
  gw: AwsGateway,
  group: RawLogGroup,
  position: number,
  total: number,
  readingsOptions: LogGroupReadingsOptions,
  options: { now: () => Date; denial: DenialContext },
): Promise<LastEventAge> {
  const windowMs = readingsOptions.probeSilenceWindowMs
  if (windowMs === undefined) {
    return {
      state: "NOT_PROBED",
      why:
        "no probeSilenceWindowMs was given. Deciding whether a group is silent costs a " +
        "logs:FilterLogEvents call, which is billed for the bytes it scans, so this engine does not " +
        "spend it on every group of every render unless a caller asks.",
    }
  }
  if (!Number.isFinite(windowMs) || windowMs <= 0 || windowMs > MAX_EVENT_WINDOW_MS) {
    return {
      state: "UNREADABLE",
      why:
        `probeSilenceWindowMs was ${String(windowMs)}, which is not a window between 1ms and ` +
        `${MAX_EVENT_WINDOW_MS}ms. No probe was made; this is not silence.`,
    }
  }
  if (position >= MAX_METRIC_FILTER_READS) {
    return {
      state: "UNREADABLE",
      why:
        `this engine probes at most ${MAX_METRIC_FILTER_READS} groups per load and this group is ` +
        `number ${position + 1} of ${total}. It was not probed — which is not the same as its being quiet.`,
    }
  }
  return probeSilence(gw, group.logGroupName, windowMs, options)
}

/* ------------------------------------------------------------ the events -- */

export interface LogEvent {
  eventId: string | null
  logStreamName: string | null
  /** ISO-8601. AWS returns epoch milliseconds; a group read as seconds renders 1970. */
  timestamp: string | null
  ingestedAt: string | null
  /** Verbatim, truncated only at `MAX_MESSAGE_CHARS` and only with `messageTruncated` set. */
  message: string
  messageTruncated: boolean
  /** The original length, so a truncated line is never mistaken for a short one. */
  messageChars: number
}

export interface LogEventPage {
  logGroupName: string
  /** The window actually asked for, echoed so a surface renders the query, not the intent. */
  startTime: string
  endTime: string
  filterPattern: string
  events: readonly LogEvent[]
  /** True when a page bound or the event cap was hit with more still outstanding. */
  hasMore: boolean
  /** Why `hasMore` is true, in the operator's language. Empty string when it is false. */
  moreWhy: string
  cappedAt: number
  pagesWalked: number
  /** Whether this group's name marked it as tenant-carrying and the caller acknowledged it. */
  tenantDataAcknowledged: boolean
  asOf: string
  refreshMs: number
}

/** Why a query was never sent. Each arm is a decision this engine made, not an AWS answer. */
export type QueryRejection =
  | "NO_LOG_GROUP"
  | "EMPTY_PATTERN"
  | "UNREADABLE_WINDOW"
  | "INVERTED_WINDOW"
  | "WINDOW_TOO_WIDE"
  | "TENANT_DATA_NOT_ACKNOWLEDGED"

/**
 * What came back from an events query.
 *
 * `REJECTED` is deliberately NOT an `AwsRead` arm. Every arm of `AwsRead`
 * describes something AWS did — answered, refused, throttled, broke — and a
 * query this engine declined to send is none of those. Folding it into
 * UNCONFIGURED would put "not configured" in front of a refusal to read tenant
 * data, which is a different sentence with a different remedy.
 */
export type LogEventsOutcome =
  | { outcome: "REJECTED"; reason: QueryRejection; why: string; sensitivity: LogSensitivity }
  | { outcome: "READ"; read: AwsRead<LogEventPage>; sensitivity: LogSensitivity }

export interface LogEventQuery {
  logGroupName: string
  /** ISO-8601. Inclusive. */
  startTime: string
  /** ISO-8601. Exclusive, as `FilterLogEvents` treats it. */
  endTime: string
  /**
   * A CloudWatch Logs filter pattern. May not be empty or whitespace: `client.ts`
   * turns an empty string into `undefined`, which matches every line in the
   * window — the widest possible search arriving through a field that reads like
   * a narrowing one.
   */
  filterPattern: string
  /**
   * Set by a caller that has decided to read a group whose name marks it as
   * carrying tenant data. Absent is the safe default and the reason the field is
   * optional; there is no way to acknowledge by accident.
   */
  acknowledgeTenantData?: boolean
}

function parseInstant(value: string): number | null {
  if (typeof value !== "string" || !value.trim()) return null
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : ms
}

/**
 * Matching log lines from one group over one window.
 *
 * The production entry point for evidence. Bounded in four directions — see the
 * module header — and it refuses outright rather than redacting by guess.
 */
export async function filterLogEvents(
  query: LogEventQuery,
  supplied?: AwsGateway,
  options: { now?: () => Date } = {},
): Promise<LogEventsOutcome> {
  const now = options.now ?? (() => new Date())
  const logGroupName = typeof query?.logGroupName === "string" ? query.logGroupName.trim() : ""
  const sensitivity = classifyLogGroupSensitivity(logGroupName)

  if (!logGroupName) {
    return {
      outcome: "REJECTED",
      reason: "NO_LOG_GROUP",
      why: "no log group was named. This engine does not search every group in the account.",
      sensitivity,
    }
  }

  const pattern = typeof query.filterPattern === "string" ? query.filterPattern.trim() : ""
  if (!pattern) {
    return {
      outcome: "REJECTED",
      reason: "EMPTY_PATTERN",
      why:
        "the filter pattern was empty. An empty pattern is not a narrow search — client.ts sends it " +
        "as no pattern at all, which matches every line in the window. Name what you are looking for.",
      sensitivity,
    }
  }

  const start = parseInstant(query.startTime)
  const end = parseInstant(query.endTime)
  if (start === null || end === null) {
    return {
      outcome: "REJECTED",
      reason: "UNREADABLE_WINDOW",
      why:
        `startTime and endTime must both be ISO-8601 instants; got ` +
        `${JSON.stringify(query.startTime)} and ${JSON.stringify(query.endTime)}. This engine will not ` +
        `default an unreadable bound to "now", which would silently change what was searched.`,
      sensitivity,
    }
  }
  if (end <= start) {
    return {
      outcome: "REJECTED",
      reason: "INVERTED_WINDOW",
      why: `endTime ${query.endTime} is not after startTime ${query.startTime}. An inverted window returns nothing, which reads as "no errors".`,
      sensitivity,
    }
  }
  if (end - start > MAX_EVENT_WINDOW_MS) {
    return {
      outcome: "REJECTED",
      reason: "WINDOW_TOO_WIDE",
      why:
        `the window is ${end - start}ms and this engine reads at most ${MAX_EVENT_WINDOW_MS}ms. ` +
        `logs:FilterLogEvents is billed for the bytes it scans over the window, so a wider search is a ` +
        `cost decision. It is rejected rather than clamped: a clamped window returns a partial answer ` +
        `that looks complete.`,
      sensitivity,
    }
  }
  if (sensitivity.kind === "tenant-data" && query.acknowledgeTenantData !== true) {
    return {
      outcome: "REJECTED",
      reason: "TENANT_DATA_NOT_ACKNOWLEDGED",
      why:
        `${logGroupName} is marked as carrying tenant data — ${sensitivity.why} No events are ` +
        `returned. This engine does not redact by guessing at a log line's shape; it withholds the ` +
        `group until a caller sets acknowledgeTenantData, which is a decision a person makes.`,
      sensitivity,
    }
  }

  const gw = supplied ?? liveGateway()
  const identity = await resolveIdentity(supplied, { now })
  const denial = denialContextFrom(identity)
  const refreshMs = CAPABILITIES["logs:FilterLogEvents"].refreshMs

  const read = await readAws<LogEventPage>(
    "logs:FilterLogEvents",
    async () => {
      const events: LogEvent[] = []
      let token: string | undefined
      let pagesWalked = 0
      let hasMore = false
      let moreWhy = ""

      for (let page = 0; page < MAX_EVENT_PAGES; page += 1) {
        const response = (await gw.call("logs:FilterLogEvents", {
          logGroupName,
          startTime: start,
          endTime: end,
          filterPattern: pattern,
          nextToken: token,
        })) as FilterLogEventsResponse
        pagesWalked = page + 1

        for (const event of response?.events ?? []) {
          const message = typeof event.message === "string" ? event.message : ""
          events.push({
            eventId: typeof event.eventId === "string" ? event.eventId : null,
            logStreamName: typeof event.logStreamName === "string" ? event.logStreamName : null,
            timestamp: isoFromEpochMillis(event.timestamp),
            ingestedAt: isoFromEpochMillis(event.ingestionTime),
            message: message.slice(0, MAX_MESSAGE_CHARS),
            messageTruncated: message.length > MAX_MESSAGE_CHARS,
            messageChars: message.length,
          })
        }

        token = response?.nextToken || undefined

        if (events.length >= MAX_EVENTS_RETURNED) {
          if (token) {
            hasMore = true
            moreWhy =
              `this engine returns at most ${MAX_EVENTS_RETURNED} events and AWS still had more. ` +
              `Narrow the window or the pattern — no continuation token is handed back, because an ` +
              `unbounded walk driven from a browser is how this console takes itself down.`
          }
          break
        }
        if (!token) break
        if (page === MAX_EVENT_PAGES - 1) {
          hasMore = true
          moreWhy =
            `this engine walks at most ${MAX_EVENT_PAGES} pages and AWS still had more. ` +
            `FilterLogEvents returns empty pages while it scans, so a matching event may exist that ` +
            `this read did not reach. Narrow the window.`
        }
      }

      // Sorted so two reads of the same window render in the same order:
      // FilterLogEvents interleaves streams and does not promise one. Ties break
      // on eventId, which AWS makes unique, so the order is total.
      const ordered = events
        .slice(0, MAX_EVENTS_RETURNED)
        .sort((a, b) => {
          const at = a.timestamp ?? ""
          const bt = b.timestamp ?? ""
          if (at !== bt) return at < bt ? -1 : 1
          const ai = a.eventId ?? ""
          const bi = b.eventId ?? ""
          return ai < bi ? -1 : ai > bi ? 1 : 0
        })

      return {
        logGroupName,
        startTime: new Date(start).toISOString(),
        endTime: new Date(end).toISOString(),
        filterPattern: pattern,
        events: ordered,
        hasMore,
        moreWhy,
        cappedAt: MAX_EVENTS_RETURNED,
        pagesWalked,
        tenantDataAcknowledged:
          sensitivity.kind === "tenant-data" && query.acknowledgeTenantData === true,
        asOf: now().toISOString(),
        refreshMs,
      }
    },
    {
      now,
      denial,
      // A window with no matching lines is EMPTY, and that is the whole point:
      // "we looked and there is nothing" has to be a different render from "we
      // were not allowed to look". The page object itself is never empty, so
      // `looksEmpty` would never fire — the emptiness that matters is the events.
      isEmpty: (value) => (value as LogEventPage).events.length === 0,
      ...RETRY,
    },
  )

  return { outcome: "READ", read, sensitivity }
}

/** The sentence a surface prints for an events outcome. One renderer, so states cannot drift. */
export function describeLogEvents(outcome: LogEventsOutcome): string {
  if (outcome.outcome === "REJECTED") {
    return `not read — ${outcome.reason}: ${outcome.why}`
  }
  const read = outcome.read
  if (read.state === "ACTUAL" || read.state === "STALE") {
    const page = read.value
    const more = page.hasMore ? ` THERE WERE MORE — ${page.moreWhy}` : ""
    const acknowledged = page.tenantDataAcknowledged
      ? " (a group marked as carrying tenant data; the caller acknowledged it)"
      : ""
    return (
      `${page.events.length} event(s) matching ${JSON.stringify(page.filterPattern)} in ` +
      `${page.logGroupName} between ${page.startTime} and ${page.endTime}, capped at ${page.cappedAt}` +
      `${acknowledged}.${more}`
    )
  }
  return describeRead(read, "matching log events")
}

/* ------------------------------------------------------------ rendering -- */

/** The sentence a surface prints for one group's metric filters. */
export function describeMetricFilters(reading: MetricFilterReading): string {
  const suffix = reading.discrepancy ? ` DISCREPANCY: ${reading.discrepancy}` : ""
  if (reading.filters.state === "ACTUAL" || reading.filters.state === "STALE") {
    const named = reading.filters.value
      .map(
        (f) =>
          `${f.filterName} → ` +
          (f.transformations.length > 0
            ? f.transformations.map((t) => `${t.metricNamespace}/${t.metricName}`).join(", ")
            : "no metric transformation"),
      )
      .join("; ")
    return `${reading.filters.value.length} metric filter(s): ${named}.${suffix}`
  }
  if (reading.filters.state === "EMPTY") {
    return `no metric filter turns a line in this group into a metric — ${reading.provenance}.${suffix}`
  }
  return `${describeRead(reading.filters, "metric filters")}${suffix}`
}

/** The sentence a surface prints for one log group. One funnel, so states cannot drift. */
export function describeLogGroup(group: LogGroupReading): string {
  const where =
    group.region && group.partition
      ? `${group.region} (partition ${group.partition})`
      : "region unknown — identity is unresolved and AWS returned no ARN"
  const bytes =
    group.storedBytes === null
      ? "stored bytes not reported"
      : `${group.storedBytes} stored byte(s)`
  const encryption =
    group.encryption.kind === "customer-key"
      ? `customer key ${group.encryption.kmsKeyArn}`
      : `AWS-owned key — ${group.encryption.why}`
  const marked =
    group.sensitivity.kind === "tenant-data"
      ? `MARKED TENANT DATA (${group.sensitivity.marker})`
      : "no tenant-data marker in the name"

  return (
    `${group.logGroupName} — ${where} — ${describeLogGroupAttribution(group.attribution)} · ` +
    `${describeRetention(group.retention)} · ${bytes} · ${encryption} · ${marked} · ` +
    `${describeMetricFilters(group.metricFilters)} · ${describeLastEvent(group.lastEvent)} · ` +
    `as of ${group.asOf}, refreshed every ${Math.round(group.refreshMs / 1000)}s`
  )
}

/** The sentence a surface prints for how much of the estate was actually walked. */
export function describeCompleteness(completeness: ListingCompleteness): string {
  switch (completeness.kind) {
    case "complete":
      return `every page walked (${completeness.pagesWalked})`
    case "truncated":
      return `TRUNCATED after ${completeness.pagesWalked} page(s) — ${completeness.why}`
  }
}

export interface LogsLine {
  label: string
  text: string
}

/**
 * What a logs surface prints.
 *
 * The route agent renders exactly these strings. The tests assert on them, which
 * is what makes the mutation proofs land on the production path rather than on a
 * helper nothing calls.
 */
export function logsLines(readings: LogsReadings): readonly LogsLine[] {
  const lines: LogsLine[] = [
    {
      label: "Log groups",
      text: describeRead(
        readings.groups,
        `log groups read from AWS, refreshed every ${Math.round(readings.refreshMs.groups / 1000)}s`,
      ),
    },
    { label: "Listing", text: describeCompleteness(readings.completeness) },
  ]
  if (readings.groups.state === "ACTUAL" || readings.groups.state === "STALE") {
    for (const group of readings.groups.value) {
      lines.push({ label: group.logGroupName, text: describeLogGroup(group) })
    }
  }
  return lines
}
