/**
 * STUDIO-070-004 (CloudTrail) — whether the audit trail is actually recording,
 * and who changed a thing.
 *
 * CloudTrail is the one service in this estate whose failure is invisible by
 * construction. `posture.ts` already reads `cloudtrail:DescribeTrails` and asks
 * it a configuration question — is there an organization trail, is it
 * multi-region, is validation on — and every one of those answers is identical
 * for a trail that is logging and a trail somebody stopped three weeks ago.
 * `DescribeTrails` describes the trail's DEFINITION. It has no field that says
 * the trail is running, and it has no field that says the last delivery failed.
 *
 * `GetTrailStatus` is the call that answers it, and nothing in this repository
 * had ever issued one. So the console could show a green "organization trail,
 * multi-region, with log-file validation" row over an account that had recorded
 * nothing since the day the S3 bucket policy was changed underneath it — and
 * the operator's first hint would be the day somebody asked who deleted a
 * database and there was no answer.
 *
 * ## Two capabilities, two readings, and a THIRD that fails per trail
 *
 * `cloudtrail:DescribeTrails` and `cloudtrail:GetTrailStatus` are separate IAM
 * actions on separate resources — the first on `*`, the second on
 * `arn:*:cloudtrail:*:*:trail/*` — and a role is routinely granted the first
 * without the second. Folding the status read into the listing would make a
 * refused `GetTrailStatus` render as "refused cloudtrail:DescribeTrails", so
 * the statement an operator pastes into a policy would not contain the action
 * that is actually missing: they would grant it, redeploy, and be refused
 * identically. `retained.ts` paid for that lesson once and `sqs.ts` is built
 * the way it ended up; this module is built the same way.
 *
 * So the listing is one `AwsRead`, and EVERY trail carries its own `AwsRead`
 * for its status. A trail whose status was refused still appears, saying it was
 * refused — it does not vanish, and it emphatically does not render as logging.
 *
 * ## "Configured" is not "logging", and "logging" is not "delivering"
 *
 * There are three separate facts and this module keeps all three apart:
 *
 *   * the trail EXISTS — `DescribeTrails`
 *   * the trail is LOGGING — `GetTrailStatus.IsLogging`
 *   * the trail is DELIVERING — `LatestDeliveryTime` moving, and
 *     `LatestDeliveryError` empty
 *
 * The third is the one that goes wrong quietly. `IsLogging` stays true when the
 * destination bucket's policy is changed, when the KMS key is disabled, and
 * when the bucket is deleted; CloudTrail keeps capturing and keeps failing to
 * write, and `LatestDeliveryError` is the only place it says so. A surface that
 * printed `IsLogging` alone would be a green light over a silent trail, which is
 * the exact defect this module exists to remove.
 *
 * ## Delivery lateness is bounded, and named as a suspicion
 *
 * `DELIVERY_OVERDUE_AFTER_MS` is a threshold, and a threshold is a judgement.
 * CloudTrail's documented behaviour is delivery "typically within 15 minutes" of
 * the call, in batches roughly every five minutes — but an account with genuinely
 * no API activity has nothing to deliver, so a late delivery is not proof of a
 * fault. That is why the state is called `logging-delivery-overdue` and its `why`
 * says both readings out loud, rather than being called `broken`. It is a
 * prompt to look, not a verdict, and it is still infinitely better than the
 * alternative this replaces, which was no reading at all.
 *
 * ## LookupEvents — bounded, read-only, and never confused with silence
 *
 * `LookupEvents` answers "who changed this" without leaving the console. Three
 * properties are not negotiable:
 *
 *   * **Bounded.** It pages, and it stops. `MAX_LOOKUP_PAGES` pages at the 50
 *     events per page `client.ts` pins, and `maxEvents` on top. When the cap is
 *     reached the result carries `truncation.kind === "more-available"` with the
 *     continuation token — a truncated answer that looked complete would be the
 *     same lie as an empty list.
 *   * **Retention-aware.** CloudTrail's event history holds NINETY DAYS. A query
 *     whose window starts before that returns fewer events, and reads as "nobody
 *     touched it" when the truth is "we cannot see back that far". Every result
 *     carries a `coverage` union that says which it is.
 *   * **Throttle-aware.** `LookupEvents` is throttled harder than any other read
 *     here — two transactions per second per account, shared with anything else
 *     in the account that reads event history. A throttle comes back as
 *     THROTTLED, never as an empty event list, because "we were rate-limited"
 *     and "nobody changed it" are the two answers an investigation must not
 *     confuse.
 *
 * ## What this module deliberately does NOT carry
 *
 * `requestParameters` and `responseElements` from the raw `CloudTrailEvent`
 * JSON are dropped and never surfaced. They are the fields that carry the
 * arguments of the call — a `PutItem` on a tenant table, an SES send, a
 * parameter-store path — and this console renders into an operator plane that
 * must not become a second copy of student data. The fields that identify WHO,
 * WHAT and FROM WHERE are kept; the payload is not.
 *
 * ## Region and partition
 *
 * From the trail's own `TrailARN` where AWS returned one, and otherwise from the
 * resolved identity. There is no literal region in this file and no `"aws"`
 * partition fallback: GE-010-007 was a data-residency defect caused by exactly
 * that fallback. This matters more for CloudTrail than for most services because
 * `DescribeTrails` returns SHADOW trails — replicas of a multi-region trail
 * whose `HomeRegion` is somewhere else — and a shadow trail reported under the
 * caller's region is a claim about where an audit log lives that is simply false.
 *
 * ## Attribution
 *
 * Through `tags.ts` and the Resource Groups Tagging API, as every other service
 * read here does. Note the deliberate deviation from "mark it shared where no
 * tag says so": `tags.ts` keeps `shared` (somebody decided) and `unattributed`
 * (nobody tagged it) apart, because folding them bills an untagged resource to a
 * tenant that did not create it. This module adds a FOURTH answer, `unknown`,
 * for when the tag index itself could not be read — "we could not look up this
 * trail's tags" is not "this trail has no tenant tag".
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
 * How many trails get a status read in one load.
 *
 * `GetTrailStatus` is one call per trail against CloudTrail's own throttle. An
 * account with an organization trail has one or two; an account that has
 * accumulated a shadow trail per region across a large partition can have
 * dozens. Trails past the cap are NOT dropped and do not render as logging: they
 * carry an UNCONFIGURED status whose `why` says the engine stopped, which is a
 * different sentence from "this trail is fine".
 */
export const MAX_TRAIL_STATUS_READS = 64

/** How many status reads are in flight at once. Bounded so one load is not a burst. */
const STATUS_CONCURRENCY = 6

/**
 * How many `LookupEvents` pages to walk before stopping and SAYING so.
 *
 * `client.ts` pins `MaxResults: 50`, so this is a thousand events. The cap is
 * not an error — a broad window legitimately has more — which is why hitting it
 * produces `truncation.kind === "more-available"` and a continuation token
 * rather than a throw.
 */
export const MAX_LOOKUP_PAGES = 20

/** The default hard cap on events returned from one lookup. */
export const DEFAULT_MAX_EVENTS = 500

/** The ceiling a caller may raise `maxEvents` to. 50 per page × MAX_LOOKUP_PAGES. */
export const ABSOLUTE_MAX_EVENTS = MAX_LOOKUP_PAGES * 50

/**
 * How long CloudTrail's event history keeps management events.
 *
 * Ninety days, fixed by the service and not configurable. A window reaching
 * further back does not fail — it silently returns less, which is why
 * `lookupCoverage` exists.
 */
export const EVENT_HISTORY_RETENTION_MS = 90 * 24 * 3_600_000

/**
 * After how long without a delivered log file a trail is called overdue.
 *
 * Six hours. CloudTrail batches deliveries roughly every five minutes and
 * documents "typically within 15 minutes", so six hours is far outside normal
 * operation — but a genuinely idle account has nothing to deliver, so this
 * threshold produces a suspicion and not a verdict. See the module header.
 */
export const DELIVERY_OVERDUE_AFTER_MS = 6 * 3_600_000

/* ---------------------------------------------------------------- shapes -- */

/** The API's shapes, declared rather than imported — see client.ts's one-owner rule. */
interface DescribeTrailsResponse {
  trailList?: Array<{
    Name?: string
    TrailARN?: string
    HomeRegion?: string
    S3BucketName?: string
    S3KeyPrefix?: string
    KmsKeyId?: string
    SnsTopicARN?: string
    CloudWatchLogsLogGroupArn?: string
    IncludeGlobalServiceEvents?: boolean
    IsMultiRegionTrail?: boolean
    IsOrganizationTrail?: boolean
    LogFileValidationEnabled?: boolean
    HasCustomEventSelectors?: boolean
    HasInsightSelectors?: boolean
  }>
}

/**
 * `GetTrailStatus`'s answer.
 *
 * Every timestamp is typed `unknown` on the way in because the SDK hands back
 * `Date` objects while a serialised fixture, a cached response and the wire
 * format all hand back strings or epoch numbers. `isoOf` normalises all three
 * and returns null for anything it cannot read, rather than `new Date(x)`
 * producing an Invalid Date that renders as the word "Invalid".
 */
interface GetTrailStatusResponse {
  IsLogging?: boolean
  LatestDeliveryTime?: unknown
  LatestDeliveryError?: string
  LatestNotificationTime?: unknown
  LatestNotificationError?: string
  LatestDigestDeliveryTime?: unknown
  LatestDigestDeliveryError?: string
  LatestCloudWatchLogsDeliveryTime?: unknown
  LatestCloudWatchLogsDeliveryError?: string
  StartLoggingTime?: unknown
  StopLoggingTime?: unknown
  TimeLoggingStarted?: string
  TimeLoggingStopped?: string
}

interface LookupEventsResponse {
  Events?: Array<{
    EventId?: string
    EventName?: string
    EventTime?: unknown
    EventSource?: string
    Username?: string
    AccessKeyId?: string
    ReadOnly?: unknown
    Resources?: Array<{ ResourceType?: string; ResourceName?: string }>
    CloudTrailEvent?: string
  }>
  NextToken?: string
}

/* ------------------------------------------------------------ the trail -- */

/**
 * Where a trail's log files are encrypted.
 *
 * `s3-managed` is its own arm rather than being reported as "none". CloudTrail
 * without a `KmsKeyId` still writes to an S3 bucket with SSE-S3, so "no KMS key"
 * does NOT mean "unencrypted", and a surface printing "unencrypted" would send
 * an operator to fix something that is not broken. It does mean the key is not
 * one this account controls or can revoke, which is a real and different
 * finding, and that is the sentence `describeEncryption` prints.
 */
export type TrailEncryption =
  | { kind: "kms"; keyId: string }
  | { kind: "s3-managed" }

/** What `DescribeTrails` said about one trail. Configuration, never status. */
export interface TrailConfiguration {
  name: string
  /** AWS's own `TrailARN`, or null when it did not return one. Never assembled. */
  arn: string | null
  /** From the ARN when there is one, else the resolved identity. Never a literal. */
  region: string | null
  partition: string | null
  accountId: string | null
  /** The region the trail was CREATED in. A shadow trail's differs from its ARN's. */
  homeRegion: string | null
  /**
   * A replica of a multi-region trail, seen from a region that is not its home.
   *
   * Null when identity is unresolved: "we do not know which region we are
   * calling from" cannot decide whether what we are looking at is a replica.
   */
  isShadow: boolean | null
  isMultiRegion: boolean
  isOrganizationTrail: boolean
  /** The digest files that make a log file tamper-evident. Off is a finding. */
  logFileValidationEnabled: boolean
  includeGlobalServiceEvents: boolean
  s3BucketName: string | null
  s3KeyPrefix: string | null
  encryption: TrailEncryption
  cloudWatchLogsLogGroupArn: string | null
  snsTopicArn: string | null
}

/** What `GetTrailStatus` said. Parsed, with every timestamp normalised to ISO. */
export interface TrailStatus {
  isLogging: boolean
  /** When a log file last landed in the bucket. Null means never, or not stated. */
  latestDeliveryAt: string | null
  /** The last delivery's error, verbatim from AWS. Null means the last one worked. */
  latestDeliveryError: string | null
  /** Digest files, which is what log-file validation actually depends on. */
  latestDigestDeliveryAt: string | null
  latestDigestDeliveryError: string | null
  /** The CloudWatch Logs mirror, which fails independently of the S3 delivery. */
  latestCloudWatchLogsDeliveryAt: string | null
  latestCloudWatchLogsDeliveryError: string | null
  startedLoggingAt: string | null
  stoppedLoggingAt: string | null
  /** Derived, and the reason this module exists. See `loggingStateOf`. */
  logging: LoggingState
}

/**
 * What a trail is actually doing, as one closed answer.
 *
 * The arms are ordered by how bad they are and they are deliberately not
 * booleans: `IsLogging === true` is the value a naive surface renders green, and
 * three of these four arms have it.
 */
export type LoggingState =
  /** Logging, delivering, no error. The only arm a surface may render as healthy. */
  | { kind: "logging"; since: string | null; lastDeliveryAt: string | null }
  /**
   * Logging and FAILING TO DELIVER. `IsLogging` is true; the bucket policy, the
   * KMS key or the bucket itself is refusing the write. Events are being
   * captured and lost.
   */
  | {
      kind: "logging-delivery-failing"
      error: string
      since: string | null
      lastDeliveryAt: string | null
    }
  /** Logging, no error, and nothing has landed for longer than the threshold. */
  | {
      kind: "logging-delivery-overdue"
      since: string | null
      lastDeliveryAt: string | null
      /** Measured from the last delivery, or from when logging started if none. */
      overdueByMs: number
      why: string
    }
  /** Stopped. The trail exists, describes perfectly, and records nothing. */
  | { kind: "stopped"; stoppedAt: string | null; lastDeliveryAt: string | null }

/**
 * Which tenant a trail belongs to.
 *
 * `tags.ts`'s three answers plus `unknown`, which the three cannot express — the
 * tag index is its own AWS read and it can be denied, throttled or broken. A
 * trail whose tags were never read must not render as "unattributable — missing
 * tenure:tenant", because that sentence sends an operator to add a tag that is
 * probably already there. See the module header on why `shared` and
 * `unattributed` are not folded together.
 */
export type TrailAttribution =
  | { kind: "tenant"; tenantSlug: string }
  | { kind: "shared" }
  | { kind: "unattributed" }
  | { kind: "unknown"; why: string }

export interface TrailReading {
  configuration: TrailConfiguration
  /** Refused, throttled, broken or read — per trail, with its own action named. */
  status: AwsRead<TrailStatus>
  attribution: TrailAttribution
  /** This trail's status cadence, from the capability's own declaration. */
  refreshMs: number
  asOf: string
}

/**
 * Whether the estate's audit trail is recording.
 *
 * Lifted out of the per-trail table because it is the one CloudTrail fact that
 * is an incident rather than a row. Every arm carries `unreadable` — the trails
 * whose status could not be read — so `logging` never quietly means "logging as
 * far as we bothered to look".
 */
export type DeliveryHealth =
  /** The trail LISTING itself was not readable, so nothing can be said at all. */
  | { kind: "unknown"; why: string }
  /** The listing succeeded and there are no trails. Nothing is being recorded. */
  | { kind: "no-trails" }
  /** At least one trail exists and is STOPPED. The loudest arm. */
  | { kind: "not-logging"; stopped: readonly string[]; unreadable: readonly string[] }
  /** Logging, and the last delivery failed. Events are being captured and lost. */
  | {
      kind: "delivery-failing"
      failures: readonly { name: string; error: string; lastDeliveryAt: string | null }[]
      unreadable: readonly string[]
    }
  /** Logging, no error, nothing delivered inside the threshold. A prompt to look. */
  | {
      kind: "delivery-overdue"
      overdue: readonly { name: string; lastDeliveryAt: string | null; overdueByMs: number }[]
      unreadable: readonly string[]
    }
  /** Every trail that answered is logging and delivering. */
  | { kind: "logging"; trails: readonly string[]; unreadable: readonly string[] }
  /**
   * Trails exist and NOT ONE of them answered.
   *
   * Separate from `unknown` because the listing DID succeed: the operator knows
   * trails exist and knows nothing about any of them, which is a different
   * remedy (grant `cloudtrail:GetTrailStatus`) from a refused listing.
   */
  | { kind: "no-status"; unreadable: readonly string[]; why: string }

/** Everything a CloudTrail surface needs, in one load. */
export interface TrailReadings {
  identity: AwsRead<Identity>
  tagged: AwsRead<readonly TaggedResource[]>
  /**
   * The trails. DENIED here is a refused `cloudtrail:DescribeTrails` and is
   * NEVER `[]` — an operator reading "no trails" when the truth is "we were not
   * allowed to look" is the single most dangerous thing this surface can say.
   */
  trails: AwsRead<readonly TrailReading[]>
  delivery: DeliveryHealth
  /** When this whole load was assembled. Explicit, so a surface need not invent one. */
  asOf: string
  /** Each capability's own declared cadence, read from the registry, not retyped. */
  refreshMs: { trails: number; status: number; events: number }
}

/* --------------------------------------------------------------- parsing -- */

/**
 * A timestamp AWS returned, as an ISO string, or null.
 *
 * `Date`, ISO string and epoch (seconds or milliseconds) all arrive here because
 * the SDK, a serialised fixture and a cached response disagree about which. Null
 * for anything unreadable, because "Invalid Date" rendered next to a trail is
 * worse than an honest blank — and because a timestamp this engine invented is
 * how a trail that never delivered reads as having delivered in 1970.
 */
export function isoOf(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    // CloudTrail's own JSON uses epoch SECONDS; the SDK uses milliseconds once
    // it has parsed them. Anything below the year 2286 in milliseconds is before
    // 1970 in seconds, so the discriminator is which of the two is plausible.
    const asMillis = value > 1e11 ? value : value * 1000
    const date = new Date(asMillis)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  return null
}

/** An AWS error string that is present and non-empty, or null. "" is not an error. */
function errorOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null
}

/** Truncated so a pathological AWS message cannot become an unbounded render. */
function shortText(raw: string, limit = 300): string {
  return raw.length > limit ? `${raw.slice(0, limit)}…` : raw
}

/**
 * What a trail is doing, from its status and the clock.
 *
 * Exported and pure so the decision can be reasoned about on its own. The
 * precedence is the argument: STOPPED beats everything, then a delivery ERROR
 * (which is a fact AWS stated), then overdue (which is this engine's suspicion),
 * and only a trail that clears all three is called logging.
 */
export function loggingStateOf(
  status: {
    isLogging: boolean
    latestDeliveryAt: string | null
    latestDeliveryError: string | null
    startedLoggingAt: string | null
    stoppedLoggingAt: string | null
  },
  now: Date,
  overdueAfterMs: number = DELIVERY_OVERDUE_AFTER_MS,
): LoggingState {
  if (!status.isLogging) {
    return {
      kind: "stopped",
      stoppedAt: status.stoppedLoggingAt,
      lastDeliveryAt: status.latestDeliveryAt,
    }
  }
  if (status.latestDeliveryError) {
    return {
      kind: "logging-delivery-failing",
      error: shortText(status.latestDeliveryError),
      since: status.startedLoggingAt,
      lastDeliveryAt: status.latestDeliveryAt,
    }
  }

  // Measured from the last delivery, and from when logging STARTED when there
  // has never been one. A trail switched on ten minutes ago that has not
  // delivered yet is not overdue; a trail switched on last year that has never
  // delivered is the most overdue thing in the account.
  const reference = status.latestDeliveryAt ?? status.startedLoggingAt
  if (reference === null) {
    // No delivery, and AWS did not say when logging started. There is nothing to
    // measure from, so nothing is claimed either way.
    return { kind: "logging", since: null, lastDeliveryAt: null }
  }
  const referenceMs = new Date(reference).getTime()
  if (Number.isNaN(referenceMs)) {
    return { kind: "logging", since: status.startedLoggingAt, lastDeliveryAt: status.latestDeliveryAt }
  }
  const elapsed = now.getTime() - referenceMs
  if (elapsed > overdueAfterMs) {
    return {
      kind: "logging-delivery-overdue",
      since: status.startedLoggingAt,
      lastDeliveryAt: status.latestDeliveryAt,
      overdueByMs: elapsed,
      why:
        status.latestDeliveryAt === null
          ? `this trail reports IsLogging but has never delivered a log file, and it started ` +
            `logging ${Math.round(elapsed / 3_600_000)}h ago. Either the destination is refusing ` +
            `the write without reporting an error, or nothing has happened in this account at all.`
          : `this trail reports IsLogging and no delivery error, but the last log file landed ` +
            `${Math.round(elapsed / 3_600_000)}h ago and the threshold is ` +
            `${Math.round(overdueAfterMs / 3_600_000)}h. An account with genuinely no API ` +
            `activity looks exactly like this, so it is a prompt to look, not a verdict.`,
    }
  }
  return {
    kind: "logging",
    since: status.startedLoggingAt,
    lastDeliveryAt: status.latestDeliveryAt,
  }
}

/** `GetTrailStatus`'s answer, normalised. Exported so the parse can be tested alone. */
export function parseTrailStatus(response: GetTrailStatusResponse, now: Date): TrailStatus {
  // `IsLogging` is the one field with no honest default. AWS returns it on every
  // successful GetTrailStatus; an answer without it is a fault, and defaulting it
  // to `false` would invent a stopped trail while defaulting it to `true` would
  // invent a healthy one. Both are claims, so neither is made here — the throw
  // happens inside `readAws` and the trail's status becomes ERROR with a reason.
  if (typeof response?.IsLogging !== "boolean") {
    throw new Error(
      "cloudtrail:GetTrailStatus answered without IsLogging. Whether this trail is recording " +
        "cannot be stated from that, and a default would be a claim.",
    )
  }
  const base = {
    isLogging: response.IsLogging,
    latestDeliveryAt: isoOf(response.LatestDeliveryTime),
    latestDeliveryError: errorOrNull(response.LatestDeliveryError),
    // `StartLoggingTime` is the SDK's parsed field; `TimeLoggingStarted` is the
    // string form CloudTrail also returns. Either may be the only one present.
    startedLoggingAt: isoOf(response.StartLoggingTime) ?? isoOf(response.TimeLoggingStarted),
    stoppedLoggingAt: isoOf(response.StopLoggingTime) ?? isoOf(response.TimeLoggingStopped),
  }
  return {
    ...base,
    latestDigestDeliveryAt: isoOf(response.LatestDigestDeliveryTime),
    latestDigestDeliveryError: errorOrNull(response.LatestDigestDeliveryError),
    latestCloudWatchLogsDeliveryAt: isoOf(response.LatestCloudWatchLogsDeliveryTime),
    latestCloudWatchLogsDeliveryError: errorOrNull(response.LatestCloudWatchLogsDeliveryError),
    logging: loggingStateOf(base, now),
  }
}

/**
 * A trail's configuration, with its region and partition taken from its own ARN.
 *
 * `arn:PARTITION:cloudtrail:REGION:ACCOUNT:trail/NAME`. When AWS returned no ARN
 * the identity's values are used, and when identity is unresolved the fields are
 * null. Nothing here falls back to a literal — see the module header.
 */
export function parseTrailConfiguration(
  trail: NonNullable<DescribeTrailsResponse["trailList"]>[number],
  identity: AwsRead<Identity>,
): TrailConfiguration {
  const arn = typeof trail.TrailARN === "string" && trail.TrailARN ? trail.TrailARN : null
  const parts = arn ? arn.split(":") : []
  const fromArn = parts.length >= 6 && parts[0] === "arn"
  const identityResolved = identity.state === "ACTUAL" || identity.state === "STALE"

  const homeRegion = typeof trail.HomeRegion === "string" && trail.HomeRegion ? trail.HomeRegion : null
  const callerRegion = identityResolved ? identity.value.region : null

  return {
    name: typeof trail.Name === "string" && trail.Name ? trail.Name : arn ?? "unnamed trail",
    arn,
    region: fromArn ? parts[3] : callerRegion,
    partition: fromArn ? parts[1] : identityResolved ? identity.value.partition : null,
    accountId: fromArn ? parts[4] : identityResolved ? identity.value.accountId : null,
    homeRegion,
    // A shadow trail is one whose home is not where we are calling from. Null
    // rather than false when either half is unknown: `false` would be a claim
    // that this IS the authoritative copy.
    isShadow: homeRegion === null || callerRegion === null ? null : homeRegion !== callerRegion,
    isMultiRegion: trail.IsMultiRegionTrail === true,
    isOrganizationTrail: trail.IsOrganizationTrail === true,
    logFileValidationEnabled: trail.LogFileValidationEnabled === true,
    includeGlobalServiceEvents: trail.IncludeGlobalServiceEvents === true,
    s3BucketName: typeof trail.S3BucketName === "string" && trail.S3BucketName ? trail.S3BucketName : null,
    s3KeyPrefix: typeof trail.S3KeyPrefix === "string" && trail.S3KeyPrefix ? trail.S3KeyPrefix : null,
    encryption:
      typeof trail.KmsKeyId === "string" && trail.KmsKeyId
        ? { kind: "kms", keyId: trail.KmsKeyId }
        : { kind: "s3-managed" },
    cloudWatchLogsLogGroupArn:
      typeof trail.CloudWatchLogsLogGroupArn === "string" && trail.CloudWatchLogsLogGroupArn
        ? trail.CloudWatchLogsLogGroupArn
        : null,
    snsTopicArn:
      typeof trail.SnsTopicARN === "string" && trail.SnsTopicARN ? trail.SnsTopicARN : null,
  }
}

/* ----------------------------------------------------------- the reading -- */

/** The retry schedule is throttle.ts's, not a literal. See its header on jitter. */
const RETRY: { attempts: number; backoffMs: number } = {
  attempts: READ_ATTEMPTS,
  // `backoffMs(2)` is the pause after the first failure; readAws doubles it.
  backoffMs: backoffMs(2),
}

async function describeTrails(
  gw: AwsGateway,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<readonly NonNullable<DescribeTrailsResponse["trailList"]>[number][]>> {
  return readAws<readonly NonNullable<DescribeTrailsResponse["trailList"]>[number][]>(
    "cloudtrail:DescribeTrails",
    async () => {
      const response = (await gw.call("cloudtrail:DescribeTrails")) as DescribeTrailsResponse
      const list = response?.trailList ?? []
      // Sorted by ARN — stable, unique, and present on every trail AWS returns —
      // falling back to the name, so two loads of the same estate render in the
      // same order. `DescribeTrails` promises no ordering, and an order that
      // changes between renders makes a diff of two screenshots unreadable.
      return [...list].sort((a, b) =>
        (a.TrailARN ?? a.Name ?? "").localeCompare(b.TrailARN ?? b.Name ?? ""),
      )
    },
    { now: options.now, denial: options.denial, ...RETRY },
  )
}

async function readTrailStatus(
  gw: AwsGateway,
  /**
   * The trail's ARN where AWS gave one, and its name otherwise.
   *
   * The ARN is preferred deliberately: `GetTrailStatus` documents that the
   * status of a SHADOW trail — the replica of a multi-region trail in a region
   * that is not its home — can only be fetched by ARN. Passing the bare name
   * from a non-home region returns `TrailNotFoundException`, which would render
   * as ERROR on a trail that is perfectly healthy.
   */
  handle: string,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<TrailStatus>> {
  return readAws<TrailStatus>(
    "cloudtrail:GetTrailStatus",
    async () => {
      const response = (await gw.call("cloudtrail:GetTrailStatus", {
        Name: handle,
      })) as GetTrailStatusResponse
      return parseTrailStatus(response ?? {}, options.now())
    },
    {
      now: options.now,
      denial: options.denial,
      // A trail's status is never meaningfully "empty": an answer with nothing
      // in it is a fault and throws above. EMPTY here would be a trail reported
      // as having no status, which a surface would have to invent a meaning for.
      isEmpty: () => false,
      ...RETRY,
    },
  )
}

/** Attribution from the tag index, with `unknown` when the index was not readable. */
function attributionFor(
  arn: string | null,
  tagged: AwsRead<readonly TaggedResource[]>,
  index: Map<string, Readonly<Record<string, string>>>,
): TrailAttribution {
  if (tagged.state !== "ACTUAL" && tagged.state !== "STALE" && tagged.state !== "EMPTY") {
    return {
      kind: "unknown",
      why: `this trail's tags were not read — ${describeRead(tagged, "the tag index")}`,
    }
  }
  if (!arn) {
    return {
      kind: "unknown",
      why:
        "cloudtrail:DescribeTrails returned no TrailARN for this trail, so it cannot be joined " +
        "against the tag index. Unattributed would be a claim about its tags; this is a claim " +
        "about ours.",
    }
  }
  const tags = index.get(arn)
  if (tags === undefined) {
    // The tag index answered and this ARN is not in it. That IS an observation:
    // the Resource Groups Tagging API returns resources that have tags, so an
    // absence means no tags at all, which is what `unattributed` says.
    return { kind: "unattributed" }
  }
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

/* ----------------------------------------------------------- the surface -- */

/**
 * Every trail the estate has, its configuration, and whether it is actually
 * recording.
 *
 * The production entry point. A route or a page calls it with no arguments and
 * gets the live gateway; a test passes a stand-in gateway to the SAME function,
 * because a test that drove a private helper would stay green on the day the
 * caller stopped calling it.
 */
export async function trailReadings(
  supplied?: AwsGateway,
  options: { now?: () => Date } = {},
): Promise<TrailReadings> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())

  const identity = await resolveIdentity(supplied, { now })
  const denial = denialContextFrom(identity)
  const tagged = await taggedResources(supplied, { now, denial })
  const index = tagIndex(
    tagged.state === "ACTUAL" || tagged.state === "STALE" ? tagged.value : [],
  )

  const listed = await describeTrails(gw, { now, denial })
  const asOf = now().toISOString()
  const refreshMs = {
    trails: CAPABILITIES["cloudtrail:DescribeTrails"].refreshMs,
    status: CAPABILITIES["cloudtrail:GetTrailStatus"].refreshMs,
    events: CAPABILITIES["cloudtrail:LookupEvents"].refreshMs,
  }

  // DENIED, THROTTLED, ERROR, UNCONFIGURED and EMPTY all travel unchanged. In
  // particular there is no branch here that turns any of them into an array.
  if (listed.state !== "ACTUAL" && listed.state !== "STALE") {
    // No cast: the arms left after this narrowing are precisely the ones with no
    // `value` field, so they already ARE an `AwsRead<TrailReading[]>`. A cast
    // here would be the place a future empty array could be smuggled in.
    const trails: AwsRead<readonly TrailReading[]> = listed
    return { identity, tagged, trails, delivery: deliveryHealth(trails), asOf, refreshMs }
  }

  const configurations = listed.value.map((trail) => parseTrailConfiguration(trail, identity))
  const statuses: Array<AwsRead<TrailStatus>> = new Array(configurations.length)

  for (let start = 0; start < configurations.length; start += STATUS_CONCURRENCY) {
    const batch = configurations.slice(start, start + STATUS_CONCURRENCY)
    const read = await Promise.all(
      batch.map((configuration, offset) => {
        const position = start + offset
        if (position >= MAX_TRAIL_STATUS_READS) {
          const skipped: AwsRead<TrailStatus> = {
            state: "UNCONFIGURED",
            capability: "cloudtrail:GetTrailStatus",
            why:
              `this engine reads at most ${MAX_TRAIL_STATUS_READS} trail statuses per load and ` +
              `this trail is number ${position + 1} of ${configurations.length}. Whether it is ` +
              `logging was not read — which is not the same as its being healthy.`,
          }
          return Promise.resolve(skipped)
        }
        return readTrailStatus(gw, configuration.arn ?? configuration.name, { now, denial })
      }),
    )
    for (let i = 0; i < read.length; i += 1) statuses[start + i] = read[i]
  }

  const readings: TrailReading[] = configurations.map((configuration, i) => ({
    configuration,
    status: statuses[i],
    attribution: attributionFor(configuration.arn, tagged, index),
    refreshMs: refreshMs.status,
    asOf,
  }))

  const trails: AwsRead<readonly TrailReading[]> = { ...listed, value: readings }
  return { identity, tagged, trails, delivery: deliveryHealth(trails), asOf, refreshMs }
}

/**
 * Whether the estate's audit trail is recording, across every trail.
 *
 * Exported and pure so the derivation can be reasoned about on its own — but
 * `trailReadings` is the only production caller and the tests drive it through
 * there, not through here.
 */
export function deliveryHealth(trails: AwsRead<readonly TrailReading[]>): DeliveryHealth {
  if (trails.state === "EMPTY") return { kind: "no-trails" }
  if (trails.state !== "ACTUAL" && trails.state !== "STALE") {
    return { kind: "unknown", why: describeRead(trails, "the CloudTrail trail listing") }
  }
  const readings = trails.value
  if (readings.length === 0) return { kind: "no-trails" }

  const unreadable: string[] = []
  const stopped: string[] = []
  const failures: { name: string; error: string; lastDeliveryAt: string | null }[] = []
  const overdue: { name: string; lastDeliveryAt: string | null; overdueByMs: number }[] = []
  const healthy: string[] = []

  for (const reading of readings) {
    const status = reading.status
    if (status.state !== "ACTUAL" && status.state !== "STALE") {
      unreadable.push(reading.configuration.name)
      continue
    }
    const logging = status.value.logging
    switch (logging.kind) {
      case "stopped":
        stopped.push(reading.configuration.name)
        break
      case "logging-delivery-failing":
        failures.push({
          name: reading.configuration.name,
          error: logging.error,
          lastDeliveryAt: logging.lastDeliveryAt,
        })
        break
      case "logging-delivery-overdue":
        overdue.push({
          name: reading.configuration.name,
          lastDeliveryAt: logging.lastDeliveryAt,
          overdueByMs: logging.overdueByMs,
        })
        break
      case "logging":
        healthy.push(reading.configuration.name)
        break
    }
  }

  // Worst first. A stopped trail is the loudest fact in this service, and an
  // account with one stopped trail and four healthy ones must not render as
  // "logging" because the majority answered well.
  if (stopped.length > 0) return { kind: "not-logging", stopped, unreadable }
  if (failures.length > 0) return { kind: "delivery-failing", failures, unreadable }
  if (overdue.length > 0) return { kind: "delivery-overdue", overdue, unreadable }
  if (healthy.length > 0) return { kind: "logging", trails: healthy, unreadable }

  // Trails exist and not one answered. "Logging" with an empty list would be the
  // reassuring default this whole module is built against.
  return {
    kind: "no-status",
    unreadable,
    why:
      `${readings.length} trail(s) exist and this engine could not read the status of any of ` +
      `them. Whether anything in this account is being recorded is unknown.`,
  }
}

/* ------------------------------------------------------- who changed this -- */

/**
 * One management event, with the payload deliberately left out.
 *
 * See the module header: `requestParameters` and `responseElements` carry the
 * arguments of the call and this console does not become a second copy of them.
 */
export interface ManagementEvent {
  eventId: string
  eventName: string
  eventSource: string | null
  /** ISO, normalised. Null when AWS returned a time this engine could not read. */
  eventTime: string | null
  /** The `Username` CloudTrail attributes the call to. Null when it stated none. */
  username: string | null
  /** From the event's own `userIdentity`, which is richer than `Username`. */
  principalArn: string | null
  principalType: string | null
  /** Null rather than false: a lookup result that omits `ReadOnly` has not said so. */
  readOnly: boolean | null
  /** The region the CALL was made in — not the region this engine is reading from. */
  awsRegion: string | null
  sourceIpAddress: string | null
  /** Present when the API call itself failed. A denied call is a fact worth seeing. */
  errorCode: string | null
  resources: readonly { type: string | null; name: string | null }[]
}

/** Which lookup filters were actually sent, so a result states its own question. */
export interface LookupFilter {
  key: "EventName" | "ResourceName" | "ResourceType" | "Username" | "EventSource" | "ReadOnly"
  value: string
}

/**
 * Whether the requested window is inside CloudTrail's event history.
 *
 * The whole reason this type exists: a window reaching back further than ninety
 * days returns fewer events and looks exactly like a quiet period. An
 * investigation that concludes "nobody touched it" from a truncated history is
 * the failure mode, and `partly-before-retention` is the sentence that stops it.
 */
export type LookupCoverage =
  | { kind: "within-retention" }
  | {
      kind: "partly-before-retention"
      /** The earliest moment CloudTrail can answer for, from the clock, not a literal. */
      retentionStartsAt: string
      why: string
    }

/** Whether the cap was reached, and how to continue if it was. */
export type LookupTruncation =
  | { kind: "complete" }
  | {
      kind: "more-available"
      /** How many events were returned before the engine stopped asking. */
      returned: number
      /** Which bound stopped it, named, so raising the right one is obvious. */
      reason: string
      /**
       * CloudTrail's continuation token, so a caller can ask for the next page —
       * or null when the cap was reached PART WAY THROUGH the last page AWS sent
       * and there is no further token. The events past the cap on that page were
       * still dropped, so this is still `more-available`: a `complete` there
       * would be an answer that lost events and said it had them all.
       */
      nextToken: string | null
    }

export interface EventLookupQuery {
  /** Inclusive start of the window. A Date or anything `isoOf` can read. */
  startTime: Date | string | number
  endTime: Date | string | number
  eventName?: string
  resourceName?: string
  resourceType?: string
  username?: string
  eventSource?: string
  /** Capped at `ABSOLUTE_MAX_EVENTS` however large a caller asks for. */
  maxEvents?: number
}

export interface EventLookup {
  /** The window that was actually asked for, normalised. */
  window: { startTime: string; endTime: string } | null
  filters: readonly LookupFilter[]
  coverage: LookupCoverage
  /**
   * The events. DENIED is a refused `cloudtrail:LookupEvents` and THROTTLED is a
   * rate limit — neither is `[]`. "Nobody changed it" and "we could not look"
   * are the two answers an investigation must never confuse.
   */
  events: AwsRead<readonly ManagementEvent[]>
  truncation: LookupTruncation
  asOf: string
  refreshMs: number
}

/**
 * The subset of the raw `CloudTrailEvent` JSON this engine reads.
 *
 * A whitelist, not a parse-everything. Anything not named here — including
 * `requestParameters`, `responseElements` and `additionalEventData` — is never
 * read out of the blob, so it cannot end up in a render by accident.
 */
function detailsFrom(raw: string | undefined): {
  principalArn: string | null
  principalType: string | null
  awsRegion: string | null
  sourceIpAddress: string | null
  errorCode: string | null
} {
  const none = {
    principalArn: null,
    principalType: null,
    awsRegion: null,
    sourceIpAddress: null,
    errorCode: null,
  }
  if (typeof raw !== "string" || raw.trim() === "") return none
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Unparseable is not an error worth failing the whole lookup for: the
    // top-level Event fields are still good and they are most of the answer.
    return none
  }
  const event = parsed as {
    userIdentity?: { arn?: unknown; type?: unknown }
    awsRegion?: unknown
    sourceIPAddress?: unknown
    errorCode?: unknown
  } | null
  const text = (value: unknown): string | null =>
    typeof value === "string" && value.trim() !== "" ? shortText(value, 512) : null
  return {
    principalArn: text(event?.userIdentity?.arn),
    principalType: text(event?.userIdentity?.type),
    awsRegion: text(event?.awsRegion),
    sourceIpAddress: text(event?.sourceIPAddress),
    errorCode: text(event?.errorCode),
  }
}

/** `ReadOnly` arrives as the STRING "true"/"false" from LookupEvents, not a boolean. */
function readOnlyOf(value: unknown): boolean | null {
  if (typeof value === "boolean") return value
  if (value === "true") return true
  if (value === "false") return false
  return null
}

/**
 * Which lookup attributes to send, from the query.
 *
 * CloudTrail accepts exactly ONE `LookupAttribute` per call — the API rejects
 * two with `InvalidLookupAttributesException` — so a query naming several is
 * narrowed here, in a stated order, rather than being sent and failing. The
 * order is most-specific first: a resource name identifies one thing, an event
 * name identifies a class of calls.
 */
export function lookupFiltersFor(query: EventLookupQuery): readonly LookupFilter[] {
  const candidates: LookupFilter[] = []
  const push = (key: LookupFilter["key"], value: string | undefined) => {
    if (typeof value === "string" && value.trim() !== "") candidates.push({ key, value: value.trim() })
  }
  push("ResourceName", query.resourceName)
  push("EventName", query.eventName)
  push("Username", query.username)
  push("ResourceType", query.resourceType)
  push("EventSource", query.eventSource)
  return candidates.slice(0, 1)
}

/**
 * Management events in a window, bounded and read-only.
 *
 * The second production entry point, and the one an investigation uses. A page
 * calls it with a window and no gateway; a test passes a stand-in gateway to the
 * SAME function.
 */
export async function lookupManagementEvents(
  query: EventLookupQuery,
  supplied?: AwsGateway,
  options: { now?: () => Date } = {},
): Promise<EventLookup> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())
  const at = now()
  const asOf = at.toISOString()
  const refreshMs = CAPABILITIES["cloudtrail:LookupEvents"].refreshMs

  const startTime = isoOf(query.startTime)
  const endTime = isoOf(query.endTime)
  const filters = lookupFiltersFor(query)

  // A window this engine cannot read is not a call it makes. UNCONFIGURED, whose
  // `why` names the fault, rather than an empty event list — which is the one
  // answer a "who changed this" question must never be given by mistake.
  if (startTime === null || endTime === null || new Date(startTime) >= new Date(endTime)) {
    return {
      window: startTime && endTime ? { startTime, endTime } : null,
      filters,
      coverage: { kind: "within-retention" },
      events: {
        state: "UNCONFIGURED",
        capability: "cloudtrail:LookupEvents",
        why:
          `the window asked for is not one CloudTrail can be asked about ` +
          `(start=${JSON.stringify(query.startTime)}, end=${JSON.stringify(query.endTime)}). ` +
          `A start at or after the end returns nothing, and nothing reads as "no one changed it".`,
      },
      truncation: { kind: "complete" },
      asOf,
      refreshMs,
    }
  }

  const retentionStart = new Date(at.getTime() - EVENT_HISTORY_RETENTION_MS)
  const coverage: LookupCoverage =
    new Date(startTime).getTime() < retentionStart.getTime()
      ? {
          kind: "partly-before-retention",
          retentionStartsAt: retentionStart.toISOString(),
          why:
            `CloudTrail's event history holds 90 days. This window starts at ${startTime}, ` +
            `before ${retentionStart.toISOString()}, so anything earlier than that is not ` +
            `absent — it is unreadable, and this answer covers only the part inside retention.`,
        }
      : { kind: "within-retention" }

  const cap = Math.max(
    1,
    Math.min(query.maxEvents ?? DEFAULT_MAX_EVENTS, ABSOLUTE_MAX_EVENTS),
  )

  // Assigned by the read below and read after it, so the truncation signal
  // survives the `readAws` boundary without being smuggled into the value.
  let truncation: LookupTruncation = { kind: "complete" }

  const events = await readAws<readonly ManagementEvent[]>(
    "cloudtrail:LookupEvents",
    async () => {
      // Reset per attempt. `readAws` re-runs this function after a throttle, and
      // a truncation signal left over from the attempt that was rate-limited
      // would describe a page walk that did not happen.
      truncation = { kind: "complete" }
      const collected: ManagementEvent[] = []
      let token: string | undefined
      /** Set when the cap cut a page short — events AWS sent and this engine dropped. */
      let droppedWithinPage = false
      for (let page = 0; page < MAX_LOOKUP_PAGES; page += 1) {
        const response = (await gw.call("cloudtrail:LookupEvents", {
          StartTime: startTime,
          EndTime: endTime,
          LookupAttributes: filters.map((f) => ({
            AttributeKey: f.key,
            AttributeValue: f.value,
          })),
          NextToken: token,
        })) as LookupEventsResponse

        for (const event of response?.Events ?? []) {
          if (collected.length >= cap) {
            droppedWithinPage = true
            break
          }
          const details = detailsFrom(event.CloudTrailEvent)
          collected.push({
            eventId: typeof event.EventId === "string" ? event.EventId : "",
            eventName: typeof event.EventName === "string" ? event.EventName : "",
            eventSource: typeof event.EventSource === "string" && event.EventSource ? event.EventSource : null,
            eventTime: isoOf(event.EventTime),
            username: typeof event.Username === "string" && event.Username ? event.Username : null,
            principalArn: details.principalArn,
            principalType: details.principalType,
            readOnly: readOnlyOf(event.ReadOnly),
            awsRegion: details.awsRegion,
            sourceIpAddress: details.sourceIpAddress,
            errorCode: details.errorCode,
            resources: (event.Resources ?? []).map((resource) => ({
              type: typeof resource.ResourceType === "string" && resource.ResourceType ? resource.ResourceType : null,
              name: typeof resource.ResourceName === "string" && resource.ResourceName ? resource.ResourceName : null,
            })),
          })
        }

        token = response?.NextToken || undefined

        if (collected.length >= cap && (token || droppedWithinPage)) {
          truncation = {
            kind: "more-available",
            returned: collected.length,
            reason:
              `stopped at the ${cap}-event cap for this lookup. There are more events in this ` +
              `window; narrow it, raise maxEvents (ceiling ${ABSOLUTE_MAX_EVENTS}), or continue ` +
              `from the token.`,
            nextToken: token ?? null,
          }
          break
        }
        if (!token) break
        if (page === MAX_LOOKUP_PAGES - 1) {
          truncation = {
            kind: "more-available",
            returned: collected.length,
            reason:
              `stopped after ${MAX_LOOKUP_PAGES} pages, this engine's page bound. There are more ` +
              `events in this window; narrow it, or continue from the token.`,
            nextToken: token,
          }
        }
      }
      return collected
    },
    { now, denial: denialContextFrom(await resolveIdentity(supplied, { now })), ...RETRY },
  )

  // A read that did not produce events cannot have been truncated. Leaving a
  // stale `more-available` on a DENIED result would be a refusal wearing the
  // clothes of a partial answer.
  if (events.state !== "ACTUAL" && events.state !== "STALE") {
    truncation = { kind: "complete" }
  }

  return {
    window: { startTime, endTime },
    filters,
    coverage,
    events,
    truncation,
    asOf,
    refreshMs,
  }
}

/* ------------------------------------------------------------ rendering -- */

/** The sentence a surface prints for one trail's encryption. */
export function describeEncryption(encryption: TrailEncryption): string {
  switch (encryption.kind) {
    case "kms":
      return `encrypted with ${encryption.keyId}`
    case "s3-managed":
      return (
        "no KMS key — log files are encrypted with S3-managed keys (SSE-S3), which is not " +
        "unencrypted, but is a key this account cannot revoke or audit separately"
      )
  }
}

/** The sentence a surface prints for what a trail is actually doing. */
export function describeLoggingState(state: LoggingState): string {
  switch (state.kind) {
    case "logging":
      return (
        `LOGGING — last log file delivered ${state.lastDeliveryAt ?? "never (no delivery reported yet)"}` +
        `${state.since ? `, logging since ${state.since}` : ""}`
      )
    case "logging-delivery-failing":
      return (
        `LOGGING BUT NOT DELIVERING — CloudTrail is capturing events and failing to write them: ` +
        `${state.error}. Last successful delivery ${state.lastDeliveryAt ?? "never"}.`
      )
    case "logging-delivery-overdue":
      return (
        `DELIVERY OVERDUE — ${Math.round(state.overdueByMs / 3_600_000)}h since the last log file. ` +
        state.why
      )
    case "stopped":
      return (
        `NOT LOGGING — this trail is configured and stopped` +
        `${state.stoppedAt ? `, since ${state.stoppedAt}` : ""}. ` +
        `Nothing has been recorded since. Last delivery ${state.lastDeliveryAt ?? "never"}.`
      )
  }
}

/** The sentence a surface prints for one trail's attribution. */
export function describeTrailAttribution(attribution: TrailAttribution): string {
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

/** The sentence a surface prints for one trail. One funnel, so states cannot drift. */
export function describeTrail(reading: TrailReading): string {
  const c = reading.configuration
  const where =
    c.region && c.partition
      ? `${c.region} (partition ${c.partition})`
      : "region unknown — this trail returned no ARN and identity is unresolved"
  const scope =
    `${c.isMultiRegion ? "multi-region" : `SINGLE-REGION — events outside ${c.homeRegion ?? "its home region"} are not recorded`}` +
    `${c.isOrganizationTrail ? ", organization trail" : ""}` +
    `${c.isShadow === true ? ", a shadow replica of a trail homed elsewhere" : ""}`
  const validation = c.logFileValidationEnabled
    ? "log-file validation ON"
    : "log-file validation OFF — a log file cannot be proven untampered"
  const destination = `to s3://${c.s3BucketName ?? "no bucket reported"}${c.s3KeyPrefix ? `/${c.s3KeyPrefix}` : ""}, ${describeEncryption(c.encryption)}`

  const head = `${c.name} — ${where} — ${scope} — ${validation} — ${destination} — ${describeTrailAttribution(reading.attribution)}`

  if (reading.status.state === "ACTUAL" || reading.status.state === "STALE") {
    const status = reading.status.value
    const digest =
      c.logFileValidationEnabled && status.latestDigestDeliveryError
        ? ` · digest delivery FAILING (${shortText(status.latestDigestDeliveryError, 120)}), so validation is claimed and not achieved`
        : ""
    return (
      `${head} — ${describeLoggingState(status.logging)}${digest} · as of ${reading.asOf}, ` +
      `refreshed every ${Math.round(reading.refreshMs / 1000)}s`
    )
  }
  // Every other state goes through the one renderer, so a refused status reads
  // as a refusal here exactly as it does everywhere else — never as "logging".
  return `${head} — ${describeRead(reading.status, `${c.name} status`)}`
}

/**
 * The sentence a surface prints for the estate's audit health.
 *
 * Seven arms, seven visibly different sentences, and only one of them says the
 * estate is being recorded. One renderer for the same reason `describeRead` is
 * one renderer: an audit gap must not be worded as an absence on one surface and
 * correctly on another.
 */
export function describeDeliveryHealth(health: DeliveryHealth): string {
  const qualifier = (unreadable: readonly string[]) =>
    unreadable.length === 0
      ? ""
      : ` A further ${unreadable.length} trail(s) could not be read (${unreadable.join(", ")}), so this is qualified.`

  switch (health.kind) {
    case "unknown":
      return `unknown — ${health.why}`
    case "no-trails":
      return (
        "NO TRAIL — cloudtrail:DescribeTrails succeeded and returned no trails at all. " +
        "Nothing in this account is being recorded, and nothing can be reconstructed later."
      )
    case "not-logging":
      return (
        `NOT LOGGING — ${health.stopped.length} trail(s) exist and are stopped: ` +
        `${health.stopped.join(", ")}. A stopped trail describes identically to a healthy one.` +
        qualifier(health.unreadable)
      )
    case "delivery-failing":
      return (
        `DELIVERY FAILING — ${health.failures.length} trail(s) report IsLogging and cannot write: ` +
        health.failures
          .map((f) => `${f.name} (${f.error}; last delivery ${f.lastDeliveryAt ?? "never"})`)
          .join("; ") +
        `. Events are being captured and lost.` +
        qualifier(health.unreadable)
      )
    case "delivery-overdue":
      return (
        `DELIVERY OVERDUE — ${health.overdue.length} trail(s) are logging with no error and ` +
        `nothing delivered inside the threshold: ` +
        health.overdue
          .map(
            (o) =>
              `${o.name} (last delivery ${o.lastDeliveryAt ?? "never"}, ${Math.round(o.overdueByMs / 3_600_000)}h ago)`,
          )
          .join("; ") +
        `. A genuinely idle account looks like this too.` +
        qualifier(health.unreadable)
      )
    case "logging":
      return (
        `logging — ${health.trails.length} trail(s) are logging and delivering: ` +
        `${health.trails.join(", ")}.` +
        qualifier(health.unreadable)
      )
    case "no-status":
      return `unknown — ${health.why} Trails: ${health.unreadable.join(", ")}.`
  }
}

/** The sentence a surface prints for a lookup's retention coverage. */
export function describeCoverage(coverage: LookupCoverage): string {
  switch (coverage.kind) {
    case "within-retention":
      return "the whole window is inside CloudTrail's 90-day event history"
    case "partly-before-retention":
      return `PARTIAL WINDOW — ${coverage.why}`
  }
}

/** The sentence a surface prints for a lookup. */
export function describeEventLookup(lookup: EventLookup): string {
  const window = lookup.window
    ? `${lookup.window.startTime} → ${lookup.window.endTime}`
    : "an unreadable window"
  const filters =
    lookup.filters.length === 0
      ? "no filter — every management event in the window"
      : lookup.filters.map((f) => `${f.key}=${f.value}`).join(", ")
  const head = `${window} · ${filters} · ${describeCoverage(lookup.coverage)}`

  if (lookup.events.state === "ACTUAL" || lookup.events.state === "STALE") {
    const truncated =
      lookup.truncation.kind === "more-available"
        ? ` · TRUNCATED: ${lookup.truncation.reason}`
        : " · complete for this window"
    return `${head} — ${lookup.events.value.length} management event(s)${truncated}`
  }
  return `${head} — ${describeRead(lookup.events, "management events")}`
}

/** The sentence a surface prints for one management event. */
export function describeEvent(event: ManagementEvent): string {
  const who = event.principalArn ?? event.username ?? "an unattributed principal"
  const what = event.eventName || "an unnamed event"
  const where = event.awsRegion ? ` in ${event.awsRegion}` : ""
  const from = event.sourceIpAddress ? ` from ${event.sourceIpAddress}` : ""
  const outcome = event.errorCode ? ` — FAILED: ${event.errorCode}` : ""
  const targets =
    event.resources.length === 0
      ? ""
      : ` on ${event.resources.map((r) => `${r.type ?? "resource"} ${r.name ?? "unnamed"}`).join(", ")}`
  return `${event.eventTime ?? "time unknown"} — ${who} called ${what}${where}${from}${targets}${outcome}`
}

export interface TrailLine {
  label: string
  text: string
}

/**
 * What a CloudTrail surface prints.
 *
 * The surface agent renders exactly these strings. The tests assert on them,
 * which is what makes the mutation proofs land on the production path rather
 * than on a helper nothing calls.
 */
export function trailLines(readings: TrailReadings): readonly TrailLine[] {
  const lines: TrailLine[] = [
    {
      label: "Trails",
      text: describeRead(
        readings.trails,
        `trails read from AWS, refreshed every ${Math.round(readings.refreshMs.trails / 1000)}s`,
      ),
    },
    { label: "Audit health", text: describeDeliveryHealth(readings.delivery) },
  ]
  if (readings.trails.state === "ACTUAL" || readings.trails.state === "STALE") {
    for (const reading of readings.trails.value) {
      lines.push({ label: reading.configuration.name, text: describeTrail(reading) })
    }
  }
  return lines
}

/** What a "who changed this" panel prints: the question, then the answers. */
export function eventLines(lookup: EventLookup): readonly TrailLine[] {
  const lines: TrailLine[] = [{ label: "Lookup", text: describeEventLookup(lookup) }]
  if (lookup.events.state === "ACTUAL" || lookup.events.state === "STALE") {
    for (const event of lookup.events.value) {
      lines.push({ label: event.eventId || event.eventName, text: describeEvent(event) })
    }
  }
  return lines
}
