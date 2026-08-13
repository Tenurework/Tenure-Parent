/**
 * STUDIO-070-004 (SQS) — the queues the estate owns, their backlog, and the
 * dead-letter queues that are the record of a delivery nobody was told about.
 *
 * `infrastructure/terraform/sqs.tf` creates five queues. Three carry work —
 * `default` (search indexing, embeddings, analytics), `email` (transactional
 * mail) and `notifications` (approvals) — and two are dead-letter queues,
 * `default-dlq` and `email-dlq`, which every one of the three redrives into
 * after three or five failed receives. Nothing in the running product had ever
 * issued an SQS call, so a message that failed five times and landed in
 * `email-dlq` produced exactly the same console as a queue that was never
 * written to: nothing at all.
 *
 * ## Two capabilities, two readings, on purpose
 *
 * `sqs:ListQueues` and `sqs:GetQueueAttributes` are separate IAM actions and a
 * role is routinely granted one without the other. Folding the depth reads into
 * the listing would make a denied `GetQueueAttributes` render as "refused
 * sqs:ListQueues", so the minimum statement an operator pastes into a policy
 * would not contain the action that is actually missing — they would grant it,
 * redeploy, and be refused identically. `retained.ts` paid for that lesson with
 * `backup:ListBackupVaults`; this module is built the way that one ended up.
 *
 * So the listing is one `AwsRead`, and EVERY queue carries its own `AwsRead` for
 * its depth. A queue whose attributes were refused still appears, saying it was
 * refused — it does not vanish, and it does not read as empty.
 *
 * ## A dead-letter queue with messages in it is a state, not a number
 *
 * A backlog on a worker queue is a number that goes up and down. A message in a
 * dead-letter queue is a job that has already failed its last retry and will
 * never run: it is a delivery that failed and nobody was told. Rendering that as
 * one more cell in a table is how it stays unread for a week, so it is lifted
 * out into `DeadLetterState` — a union whose `failed-deliveries` arm names the
 * queues, the counts and the source queues that fed them, and whose other arms
 * are careful never to claim "clear" about queues that were not read.
 *
 * Which queues ARE dead-letter queues is derived from data, never from the name:
 * a queue is a dead-letter queue when another queue's `RedrivePolicy` names its
 * ARN, or when its own `RedriveAllowPolicy` is `byQueue` and lists sources. A
 * rule keyed on the suffix `-dlq` is a rule that misses the queue somebody named
 * `failed-email` and invents one for a queue named `dlq-inbox-archive`.
 *
 * ## What this module cannot read, said out loud
 *
 * **The age of the oldest message is not available to this engine.** It is not
 * an SQS queue attribute — the SQS API has no such attribute, in any SDK version
 * — it is the CloudWatch metric `AWS/SQS ApproximateAgeOfOldestMessage`, which
 * needs `cloudwatch:GetMetricData`. The capability registry holds exactly one
 * CloudWatch entry, `cloudwatch:DescribeAlarms`, and this module does not get to
 * add one. So every queue carries an `oldestMessage` field whose only arm is
 * NOT_READABLE and which names the capability that would answer it. A field that
 * silently held `null`, or that was left off the type, would let a surface print
 * a queue's row with no age and let an operator read that as "nothing old in
 * here".
 *
 * ## Region and partition
 *
 * Both come from the resolved identity — `sts:GetCallerIdentity` for the account
 * and the partition, the SDK's own resolved region for the region — and from the
 * `QueueArn` AWS returns for each queue. There is no literal region in this file
 * and no `"aws"` partition fallback. GE-010-007 was a data-residency defect
 * caused by exactly that fallback, and a queue URL parsed for its region is the
 * same guess wearing a different hat: the URL host is `sqs.<region>.amazonaws.com`
 * in the commercial partition, something else in China, and something else again
 * behind a VPC endpoint.
 *
 * ## Attribution
 *
 * Through `tags.ts` and the Resource Groups Tagging API, so a queue attributes
 * the same way an RDS instance does. Note the deliberate deviation from "mark it
 * shared where no tag says otherwise": `tags.ts` keeps `shared` (somebody
 * decided) and `unattributed` (nobody tagged it) apart, and folding them is how
 * an untagged queue gets billed to a tenant that did not create it. This module
 * adds a FOURTH answer, `unknown`, for when the tag index itself could not be
 * read — "we could not look up this queue's tags" is not "this queue has no
 * tenant tag", and the whole read plane exists to keep those apart.
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
 * How many `ListQueues` pages to walk. A runaway page loop is an outage in a
 * server render with a person waiting, and `MaxResults` is 1000 per page in
 * `client.ts`, so this is twenty thousand queues before it gives up.
 */
const MAX_PAGES = 20

/**
 * How many queues get a depth read in one load.
 *
 * `GetQueueAttributes` is one call per queue and the SQS throttle is per
 * account. The estate has five queues; the cap exists so an account that has
 * grown a thousand does not turn one page render into a thousand API calls.
 *
 * Queues past the cap are NOT dropped and do not render as empty: they carry an
 * UNCONFIGURED depth whose `why` says the engine stopped, which is a different
 * sentence from "this queue has no messages".
 */
export const MAX_QUEUE_DEPTH_READS = 200

/** How many depth reads are in flight at once. Bounded so one load is not a burst. */
const DEPTH_CONCURRENCY = 8

/* ---------------------------------------------------------------- shapes -- */

/** The API's shapes, declared rather than imported — see client.ts's one-owner rule. */
interface ListQueuesResponse {
  QueueUrls?: string[]
  NextToken?: string
}

interface GetQueueAttributesResponse {
  Attributes?: Record<string, string>
}

/**
 * A queue's `RedrivePolicy` — where its poison messages go.
 *
 * `none` and `unreadable` are separate arms because they are separate facts and
 * they have opposite remedies. "This queue has no dead-letter queue" is a
 * finding an operator acts on by adding one; "this queue's RedrivePolicy did not
 * parse" is a finding they act on by looking at the policy. Collapsing the
 * second into the first invents a missing DLQ for a queue that has one.
 */
export type RedrivePolicy =
  | { kind: "redrives-to"; deadLetterTargetArn: string; maxReceiveCount: number }
  | { kind: "none" }
  | { kind: "unreadable"; raw: string; why: string }

/**
 * A queue's `RedriveAllowPolicy` — who is permitted to use it as a DLQ.
 *
 * `absent` is its own arm rather than being reported as `all`. SQS's documented
 * default when the attribute is missing IS `allowAll`, but "AWS did not return
 * this attribute" and "AWS returned allowAll" are different observations, and
 * only the second is something somebody chose.
 */
export type RedriveAllowPolicy =
  | { kind: "all" }
  | { kind: "deny-all" }
  | { kind: "by-queue"; sourceQueueArns: readonly string[] }
  | { kind: "absent" }
  | { kind: "unreadable"; raw: string; why: string }

/**
 * The age of the oldest message in a queue.
 *
 * One arm, deliberately. See the module header: SQS has no such attribute, the
 * fact lives in CloudWatch, and the capability that would read it is not in the
 * registry. This type exists so the absence is a value a surface must render
 * rather than a field a surface can forget.
 */
export interface OldestMessageAge {
  state: "NOT_READABLE"
  /** The capability that would answer it. Not held by this engine today. */
  needs: "cloudwatch:GetMetricData"
  /** Metric namespace and name, so the grant that would fix it is unambiguous. */
  metric: "AWS/SQS ApproximateAgeOfOldestMessage"
  why: string
}

/** The same object every time: nothing about it varies per queue. */
export const OLDEST_MESSAGE_NOT_READABLE: OldestMessageAge = {
  state: "NOT_READABLE",
  needs: "cloudwatch:GetMetricData",
  metric: "AWS/SQS ApproximateAgeOfOldestMessage",
  why:
    "the age of the oldest message is not an SQS queue attribute — it is the CloudWatch metric " +
    "AWS/SQS ApproximateAgeOfOldestMessage, and this engine holds no cloudwatch:GetMetricData " +
    "capability. Unknown, not zero.",
}

/** What one `GetQueueAttributes` answered. Counts are numbers or the read failed. */
export interface QueueDepth {
  /** AWS's own answer for this queue's ARN, not one this engine assembled. */
  arn: string
  visible: number
  inFlight: number
  delayed: number
  redrive: RedrivePolicy
  redriveAllow: RedriveAllowPolicy
  /** Configuration. Null is honest here: it is absent, not a count this engine guessed. */
  visibilityTimeoutSeconds: number | null
  messageRetentionSeconds: number | null
  createdAt: string | null
  lastModifiedAt: string | null
}

/**
 * Which tenant a queue belongs to.
 *
 * `tags.ts`'s three answers plus `unknown`, which the three cannot express: the
 * tag index is its own AWS read and it can be denied, throttled or broken. A
 * queue whose tags were never read must not render as "unattributable — missing
 * tenure:tenant", because that sentence sends an operator to add a tag that is
 * probably already there.
 */
export type QueueAttribution =
  | { kind: "tenant"; tenantSlug: string }
  | { kind: "shared" }
  | { kind: "unattributed" }
  | { kind: "unknown"; why: string }

export interface QueueReading {
  /** The queue URL, which is what every SQS call takes as its handle. */
  url: string
  /** The last path segment of the URL. A label for a human; never an attribution key. */
  name: string
  /** From the queue's own `QueueArn` where the depth read succeeded, else derived. */
  arn: string | null
  /** Where the ARN came from, or why there is none. Never silent. */
  arnProvenance: string
  region: string | null
  partition: string | null
  accountId: string | null
  attribution: QueueAttribution
  /** Refused, throttled, broken or read — per queue, with its own action named. */
  depth: AwsRead<QueueDepth>
  oldestMessage: OldestMessageAge
  /** This queue's depth cadence, from the capability's own declaration. */
  refreshMs: number
  asOf: string
}

/** A dead-letter queue holding messages: a delivery that failed and was not reported. */
export interface DeliveryFailure {
  queueName: string
  queueUrl: string
  queueArn: string
  /** Messages waiting in the dead-letter queue. Every one is a job that will not run. */
  messages: number
  /** Being consumed right now — a redrive in progress, or somebody draining it by hand. */
  inFlight: number
  /** The queues whose RedrivePolicy names this one. Where the failures came FROM. */
  sourceQueueArns: readonly string[]
  attribution: QueueAttribution
  asOf: string
}

/**
 * Whether anything has landed in a dead-letter queue.
 *
 * Lifted out of the queue table because it is the one SQS fact that is an
 * incident rather than a metric. Every arm is careful about what it claims:
 * `clear` carries the queues it could NOT read alongside the ones it could, so
 * "clear" never quietly means "clear as far as we bothered to look".
 */
export type DeadLetterState =
  /** The queue listing itself was not readable, so nothing can be said. */
  | { kind: "unknown"; why: string }
  /** Every queue answered, and none is a dead-letter target. Itself a finding. */
  | { kind: "none-configured"; queuesRead: number }
  /** Dead-letter queues exist and the ones that answered are empty. */
  | {
      kind: "clear"
      deadLetterQueueArns: readonly string[]
      /** Queues whose depth could not be read. Named, so "clear" is qualified. */
      unreadable: readonly string[]
    }
  /** At least one dead-letter queue holds messages. This is the alarm. */
  | {
      kind: "failed-deliveries"
      failures: readonly DeliveryFailure[]
      totalMessages: number
      unreadable: readonly string[]
    }

/** Everything an SQS surface needs, in one load. */
export interface SqsReadings {
  identity: AwsRead<Identity>
  tagged: AwsRead<readonly TaggedResource[]>
  /**
   * The queues. DENIED here is a refused `sqs:ListQueues` and is NEVER `[]` —
   * an operator reading "no queues" when the truth is "we were not allowed to
   * look" is the single most dangerous thing this surface can say.
   */
  queues: AwsRead<readonly QueueReading[]>
  deadLetters: DeadLetterState
  /** When this whole load was assembled. Explicit, so a surface need not invent one. */
  asOf: string
  /** Each capability's own declared cadence, read from the registry, not retyped. */
  refreshMs: { queues: number; depth: number }
}

/* --------------------------------------------------------------- parsing -- */

/**
 * A count AWS must have returned.
 *
 * Throws rather than defaulting to zero, and the throw happens inside `readAws`,
 * so the queue's depth becomes ERROR with the reason. Zero is a claim — "this
 * queue is empty" — and it is the claim that makes a backlog invisible.
 */
function requiredCount(
  attributes: Record<string, string>,
  key: string,
  queueUrl: string,
): number {
  const raw = attributes[key]
  if (raw === undefined) {
    throw new Error(
      `sqs:GetQueueAttributes answered for ${queueUrl} without ${key}. ` +
        `A count this engine did not read must not render as zero.`,
    )
  }
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `sqs:GetQueueAttributes returned ${key}=${JSON.stringify(raw)} for ${queueUrl}, ` +
        `which is not a message count.`,
    )
  }
  return value
}

/** A configuration number, or null. Absent configuration is not a miscount. */
function optionalNumber(attributes: Record<string, string>, key: string): number | null {
  const raw = attributes[key]
  if (raw === undefined) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

/**
 * An SQS epoch-seconds timestamp as an ISO string.
 *
 * `CreatedTimestamp` and `LastModifiedTimestamp` are seconds, not milliseconds.
 * Multiplying is not cosmetic: read as milliseconds, a queue created in 2024
 * renders as having been created in 1970.
 */
function epochSecondsToIso(attributes: Record<string, string>, key: string): string | null {
  const seconds = optionalNumber(attributes, key)
  if (seconds === null) return null
  const date = new Date(seconds * 1000)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** Truncated so a malformed policy cannot become an unbounded string in a render. */
function shortRaw(raw: string): string {
  return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw
}

export function parseRedrivePolicy(raw: string | undefined): RedrivePolicy {
  if (raw === undefined || raw.trim() === "") return { kind: "none" }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { kind: "unreadable", raw: shortRaw(raw), why: "RedrivePolicy is not JSON" }
  }
  const policy = parsed as { deadLetterTargetArn?: unknown; maxReceiveCount?: unknown } | null
  const target = typeof policy?.deadLetterTargetArn === "string" ? policy.deadLetterTargetArn : ""
  if (!target) {
    return {
      kind: "unreadable",
      raw: shortRaw(raw),
      why: "RedrivePolicy names no deadLetterTargetArn",
    }
  }
  const maxReceiveCount = Number(policy?.maxReceiveCount)
  if (!Number.isFinite(maxReceiveCount)) {
    return {
      kind: "unreadable",
      raw: shortRaw(raw),
      why: "RedrivePolicy carries no numeric maxReceiveCount",
    }
  }
  return { kind: "redrives-to", deadLetterTargetArn: target, maxReceiveCount }
}

export function parseRedriveAllowPolicy(raw: string | undefined): RedriveAllowPolicy {
  if (raw === undefined || raw.trim() === "") return { kind: "absent" }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { kind: "unreadable", raw: shortRaw(raw), why: "RedriveAllowPolicy is not JSON" }
  }
  const policy = parsed as { redrivePermission?: unknown; sourceQueueArns?: unknown } | null
  const permission = policy?.redrivePermission
  if (permission === "allowAll") return { kind: "all" }
  if (permission === "denyAll") return { kind: "deny-all" }
  if (permission === "byQueue") {
    const arns = Array.isArray(policy?.sourceQueueArns)
      ? policy.sourceQueueArns.filter((a): a is string => typeof a === "string")
      : []
    return { kind: "by-queue", sourceQueueArns: arns }
  }
  return {
    kind: "unreadable",
    raw: shortRaw(raw),
    why: `RedriveAllowPolicy has an unrecognised redrivePermission ${JSON.stringify(permission)}`,
  }
}

/**
 * The queue name from its URL: the last path segment.
 *
 * A label only. Nothing in this module joins, attributes or classifies on it —
 * see the module header on why `-dlq` is not a rule.
 */
export function queueNameFromUrl(url: string): string {
  const withoutQuery = url.split("?")[0]
  const segments = withoutQuery.split("/").filter(Boolean)
  return segments.length > 0 ? segments[segments.length - 1] : url
}

/**
 * The account id from a queue URL: the segment before the name.
 *
 * Read rather than assumed to be the caller's own account. A queue URL for a
 * queue in another account is a legal thing to hold, and reporting it under this
 * account's id would attribute somebody else's backlog to this estate.
 */
export function accountIdFromUrl(url: string): string | null {
  const withoutQuery = url.split("?")[0]
  const segments = withoutQuery.split("/").filter(Boolean)
  if (segments.length < 2) return null
  const candidate = segments[segments.length - 2]
  return /^[0-9]{12}$/.test(candidate) ? candidate : null
}

/**
 * A queue's ARN, assembled from the resolved identity.
 *
 * Only used when `GetQueueAttributes` could not be read — when it can, AWS's own
 * `QueueArn` is used instead. The partition and region come from `identity`,
 * never from the URL host and never from a literal: `sqs.<region>.amazonaws.com`
 * is only the commercial partition's host, and a partition guessed as "aws" is
 * the GE-010-007 shape of defect.
 *
 * Returns null when identity is unresolved, because half an ARN is worse than
 * none: it would join against the tag index and match nothing, which reads
 * exactly like an untagged queue.
 */
export function deriveQueueArn(url: string, identity: AwsRead<Identity>): string | null {
  if (identity.state !== "ACTUAL" && identity.state !== "STALE") return null
  const name = queueNameFromUrl(url)
  const accountId = accountIdFromUrl(url) ?? identity.value.accountId
  if (!name || !accountId) return null
  return `arn:${identity.value.partition}:sqs:${identity.value.region}:${accountId}:${name}`
}

/* ----------------------------------------------------------- the reading -- */

/** The retry schedule is throttle.ts's, not a literal. See its header on jitter. */
const RETRY: { attempts: number; backoffMs: number } = {
  attempts: READ_ATTEMPTS,
  // `backoffMs(2)` is the pause after the first failure; readAws doubles it.
  backoffMs: backoffMs(2),
}

async function listQueueUrls(
  gw: AwsGateway,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<readonly string[]>> {
  return readAws<readonly string[]>(
    "sqs:ListQueues",
    async () => {
      const urls: string[] = []
      let token: string | undefined
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const response = (await gw.call("sqs:ListQueues", {
          NextToken: token,
        })) as ListQueuesResponse
        for (const url of response?.QueueUrls ?? []) {
          if (typeof url === "string" && url) urls.push(url)
        }
        token = response?.NextToken || undefined
        if (!token) break
        if (page === MAX_PAGES - 1) {
          // Not a truncated list rendered as complete. A partial answer that
          // looks whole is the failure this whole read plane is built against.
          throw new Error(
            `sqs:ListQueues still had pages after ${MAX_PAGES}. This engine will not render a ` +
              `partial queue list as if it were the estate.`,
          )
        }
      }
      // Sorted so two loads of the same estate produce the same order. ListQueues
      // does not promise one, and an order that changes between renders makes a
      // diff of two screenshots unreadable.
      return urls.sort()
    },
    { now: options.now, denial: options.denial, ...RETRY },
  )
}

async function readQueueDepth(
  gw: AwsGateway,
  url: string,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<QueueDepth>> {
  return readAws<QueueDepth>(
    "sqs:GetQueueAttributes",
    async () => {
      const response = (await gw.call("sqs:GetQueueAttributes", {
        QueueUrl: url,
      })) as GetQueueAttributesResponse
      const attributes = response?.Attributes ?? {}
      const arn = attributes.QueueArn
      if (!arn) {
        throw new Error(
          `sqs:GetQueueAttributes answered for ${url} without QueueArn. The queue cannot be ` +
            `attributed or matched to a redrive target from this.`,
        )
      }
      return {
        arn,
        visible: requiredCount(attributes, "ApproximateNumberOfMessages", url),
        inFlight: requiredCount(attributes, "ApproximateNumberOfMessagesNotVisible", url),
        delayed: requiredCount(attributes, "ApproximateNumberOfMessagesDelayed", url),
        redrive: parseRedrivePolicy(attributes.RedrivePolicy),
        redriveAllow: parseRedriveAllowPolicy(attributes.RedriveAllowPolicy),
        visibilityTimeoutSeconds: optionalNumber(attributes, "VisibilityTimeout"),
        messageRetentionSeconds: optionalNumber(attributes, "MessageRetentionPeriod"),
        createdAt: epochSecondsToIso(attributes, "CreatedTimestamp"),
        lastModifiedAt: epochSecondsToIso(attributes, "LastModifiedTimestamp"),
      }
    },
    {
      now: options.now,
      denial: options.denial,
      // A queue's attributes are never meaningfully "empty": an answer with
      // nothing in it is a fault, and it throws above. EMPTY here would be a
      // queue reported as having no attributes, which is not a thing.
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
): QueueAttribution {
  if (tagged.state !== "ACTUAL" && tagged.state !== "STALE" && tagged.state !== "EMPTY") {
    return {
      kind: "unknown",
      why: `this queue's tags were not read — ${describeRead(tagged, "the tag index")}`,
    }
  }
  if (!arn) {
    return {
      kind: "unknown",
      why:
        "this queue has no ARN this engine can state, so it cannot be joined against the tag " +
        "index. Unattributed would be a claim about its tags; this is a claim about ours.",
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
 * Every queue the estate owns, with its depth, its redrive policy and its tenant.
 *
 * The production entry point. A route or a page calls it with no arguments and
 * gets the live gateway; a test passes a stand-in gateway to the SAME function,
 * because a test that drove a private helper would stay green on the day the
 * caller stopped calling it.
 */
export async function queueReadings(
  supplied?: AwsGateway,
  options: { now?: () => Date } = {},
): Promise<SqsReadings> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())

  const identity = await resolveIdentity(supplied, { now })
  const denial = denialContextFrom(identity)
  const tagged = await taggedResources(supplied, { now, denial })
  const index = tagIndex(
    tagged.state === "ACTUAL" || tagged.state === "STALE" ? tagged.value : [],
  )

  const listed = await listQueueUrls(gw, { now, denial })
  const asOf = now().toISOString()
  const refreshMs = {
    queues: CAPABILITIES["sqs:ListQueues"].refreshMs,
    depth: CAPABILITIES["sqs:GetQueueAttributes"].refreshMs,
  }

  // DENIED, THROTTLED, ERROR, UNCONFIGURED and EMPTY all travel unchanged. In
  // particular there is no branch here that turns any of them into an array.
  if (listed.state !== "ACTUAL" && listed.state !== "STALE") {
    // No cast: the arms left after this narrowing are precisely the ones with no
    // `value` field, so they are already an `AwsRead<QueueReading[]>`. A cast
    // here would be the place a future empty array could be smuggled in.
    const queues: AwsRead<readonly QueueReading[]> = listed
    return {
      identity,
      tagged,
      queues,
      deadLetters: deadLetterState(queues),
      asOf,
      refreshMs,
    }
  }

  const urls = listed.value
  const depths: Array<AwsRead<QueueDepth>> = new Array(urls.length)
  for (let start = 0; start < urls.length; start += DEPTH_CONCURRENCY) {
    const batch = urls.slice(start, start + DEPTH_CONCURRENCY)
    const read = await Promise.all(
      batch.map((url, offset) => {
        const position = start + offset
        if (position >= MAX_QUEUE_DEPTH_READS) {
          const skipped: AwsRead<QueueDepth> = {
            state: "UNCONFIGURED",
            capability: "sqs:GetQueueAttributes",
            why:
              `this engine reads at most ${MAX_QUEUE_DEPTH_READS} queue depths per load and this ` +
              `queue is number ${position + 1} of ${urls.length}. Its depth was not read — which ` +
              `is not the same as its being empty.`,
          }
          return Promise.resolve(skipped)
        }
        return readQueueDepth(gw, url, { now, denial })
      }),
    )
    for (let i = 0; i < read.length; i += 1) depths[start + i] = read[i]
  }

  const readings: QueueReading[] = urls.map((url, i) => {
    const depth = depths[i]
    const fromAws = depth.state === "ACTUAL" || depth.state === "STALE" ? depth.value.arn : null
    const derived = fromAws ? null : deriveQueueArn(url, identity)
    const arn = fromAws ?? derived
    const arnProvenance = fromAws
      ? "AWS's own QueueArn attribute"
      : derived
        ? "assembled from the resolved identity's partition, region and this URL's account id — " +
          "the queue's own attributes were not readable"
        : "none — the queue's attributes were not readable and identity is unresolved, so this " +
          "engine will not assemble an ARN it cannot stand behind"

    const parts = arn ? arn.split(":") : []
    const identityResolved = identity.state === "ACTUAL" || identity.state === "STALE"
    return {
      url,
      name: queueNameFromUrl(url),
      arn,
      arnProvenance,
      // From the ARN when there is one — AWS's answer beats anything assembled —
      // and otherwise from the resolved identity. Never from the URL host.
      partition: parts.length >= 6 ? parts[1] : identityResolved ? identity.value.partition : null,
      region: parts.length >= 6 ? parts[3] : identityResolved ? identity.value.region : null,
      accountId: parts.length >= 6 ? parts[4] : accountIdFromUrl(url),
      attribution: attributionFor(arn, tagged, index),
      depth,
      oldestMessage: OLDEST_MESSAGE_NOT_READABLE,
      refreshMs: refreshMs.depth,
      asOf,
    }
  })

  const queues: AwsRead<readonly QueueReading[]> = { ...listed, value: readings }
  return { identity, tagged, queues, deadLetters: deadLetterState(queues), asOf, refreshMs }
}

/* ------------------------------------------------------- dead letters -- */

/**
 * Whether anything has landed in a dead-letter queue.
 *
 * Exported and pure, so the derivation can be reasoned about on its own — but
 * `queueReadings` is the only production caller and the tests drive it through
 * there, not through here.
 */
export function deadLetterState(queues: AwsRead<readonly QueueReading[]>): DeadLetterState {
  if (queues.state !== "ACTUAL" && queues.state !== "STALE") {
    return { kind: "unknown", why: describeRead(queues, "the SQS queue listing") }
  }

  const readings = queues.value

  // Which queues are dead-letter targets, and which queues feed them. Both
  // facts come from a policy AWS returned, never from a name.
  const sourcesByTarget = new Map<string, string[]>()
  for (const queue of readings) {
    const depth = queue.depth
    if (depth.state !== "ACTUAL" && depth.state !== "STALE") continue
    if (depth.value.redrive.kind !== "redrives-to") continue
    const target = depth.value.redrive.deadLetterTargetArn
    const sources = sourcesByTarget.get(target) ?? []
    sources.push(depth.value.arn)
    sourcesByTarget.set(target, sources)
  }

  const unreadable: string[] = []
  const deadLetters: Array<{ queue: QueueReading; depth: QueueDepth; sources: readonly string[] }> = []

  for (const queue of readings) {
    const depth = queue.depth
    if (depth.state !== "ACTUAL" && depth.state !== "STALE") {
      unreadable.push(queue.name)
      continue
    }
    const namedBy = sourcesByTarget.get(depth.value.arn)
    // A `byQueue` RedriveAllowPolicy naming sources is itself a declaration that
    // this queue receives redrives — and it survives the case where the SOURCE
    // queue's own attributes were refused, which is exactly when a DLQ would
    // otherwise go unnoticed. `allowAll` is not used: it is every queue's
    // default, so treating it as a signal would make every queue a DLQ.
    const declared =
      depth.value.redriveAllow.kind === "by-queue" &&
      depth.value.redriveAllow.sourceQueueArns.length > 0
        ? depth.value.redriveAllow.sourceQueueArns
        : []
    if (!namedBy && declared.length === 0) continue
    const sources = [...new Set([...(namedBy ?? []), ...declared])].sort()
    deadLetters.push({ queue, depth: depth.value, sources })
  }

  const failures: DeliveryFailure[] = deadLetters
    .filter(({ depth }) => depth.visible > 0 || depth.inFlight > 0)
    .map(({ queue, depth, sources }) => ({
      queueName: queue.name,
      queueUrl: queue.url,
      queueArn: depth.arn,
      messages: depth.visible,
      inFlight: depth.inFlight,
      sourceQueueArns: sources,
      attribution: queue.attribution,
      asOf: queue.asOf,
    }))

  if (failures.length > 0) {
    return {
      kind: "failed-deliveries",
      failures,
      totalMessages: failures.reduce((sum, f) => sum + f.messages, 0),
      unreadable,
    }
  }
  if (deadLetters.length > 0) {
    return {
      kind: "clear",
      deadLetterQueueArns: deadLetters.map(({ depth }) => depth.arn).sort(),
      unreadable,
    }
  }
  if (unreadable.length > 0) {
    // No queue DECLARED a dead-letter target, but some queues did not answer.
    // "No dead-letter queue is configured" would be a claim about queues this
    // engine never read.
    return {
      kind: "unknown",
      why:
        `no queue that answered names a dead-letter target, and ${unreadable.length} queue(s) ` +
        `could not be read (${unreadable.join(", ")}). Whether a dead-letter queue exists is unknown.`,
    }
  }
  return { kind: "none-configured", queuesRead: readings.length }
}

/* ------------------------------------------------------------ rendering -- */

/**
 * The sentence a surface prints for a dead-letter state.
 *
 * Four states, four visibly different sentences, and only one of them contains a
 * number of failed deliveries. One renderer for the same reason `describeRead`
 * is one renderer: an incident must not be worded as an absence on one surface
 * and correctly on another.
 */
export function describeDeadLetterState(state: DeadLetterState): string {
  switch (state.kind) {
    case "unknown":
      return `unknown — ${state.why}`
    case "none-configured":
      return (
        `no dead-letter queue is configured — all ${state.queuesRead} queue(s) answered and none ` +
        `is any other queue's redrive target. A failed message is retried and then dropped.`
      )
    case "clear": {
      const qualifier =
        state.unreadable.length === 0
          ? ""
          : `, though ${state.unreadable.length} queue(s) could not be read (${state.unreadable.join(", ")})`
      return (
        `no failed deliveries — ${state.deadLetterQueueArns.length} dead-letter queue(s) answered ` +
        `and every one is empty${qualifier}`
      )
    }
    case "failed-deliveries": {
      const named = state.failures
        .map(
          (f) =>
            `${f.queueName} holds ${f.messages} message(s)` +
            `${f.inFlight > 0 ? ` and ${f.inFlight} in flight` : ""}` +
            `${f.sourceQueueArns.length > 0 ? `, redriven from ${f.sourceQueueArns.join(", ")}` : ""}`,
        )
        .join("; ")
      const qualifier =
        state.unreadable.length === 0
          ? ""
          : ` A further ${state.unreadable.length} queue(s) could not be read.`
      return (
        `FAILED DELIVERIES — ${state.totalMessages} message(s) reached a dead-letter queue and ` +
        `nobody was told: ${named}.${qualifier}`
      )
    }
  }
}

/** The sentence a surface prints for one queue's attribution. */
export function describeQueueAttribution(attribution: QueueAttribution): string {
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

/** The sentence a surface prints for one queue's redrive policy. */
export function describeRedrive(redrive: RedrivePolicy): string {
  switch (redrive.kind) {
    case "redrives-to":
      return `redrives to ${redrive.deadLetterTargetArn} after ${redrive.maxReceiveCount} receive(s)`
    case "none":
      return "no dead-letter queue — a message that keeps failing is dropped"
    case "unreadable":
      return `redrive policy unreadable — ${redrive.why}`
  }
}

/** The sentence a surface prints for one queue. One funnel, so states cannot drift. */
export function describeQueue(queue: QueueReading): string {
  const where =
    queue.region && queue.partition
      ? `${queue.region} (partition ${queue.partition})`
      : "region unknown — identity is unresolved"
  const head = `${queue.name} — ${where} — ${describeQueueAttribution(queue.attribution)}`

  if (queue.depth.state === "ACTUAL" || queue.depth.state === "STALE") {
    const d = queue.depth.value
    return (
      `${head} — ${d.visible} visible, ${d.inFlight} in flight, ${d.delayed} delayed · ` +
      `${describeRedrive(d.redrive)} · oldest message: ${queue.oldestMessage.why} · ` +
      `as of ${queue.asOf}, refreshed every ${Math.round(queue.refreshMs / 1000)}s`
    )
  }
  // Every other state goes through the one renderer, so a refused depth reads as
  // a refusal here exactly as it does everywhere else — never as "0 messages".
  return `${head} — ${describeRead(queue.depth, `${queue.name} depth`)}`
}

export interface SqsLine {
  label: string
  text: string
}

/**
 * What an SQS surface prints.
 *
 * The route agent renders exactly these strings. The tests assert on them,
 * which is what makes the mutation proofs land on the production path rather
 * than on a helper nothing calls.
 */
export function sqsLines(readings: SqsReadings): readonly SqsLine[] {
  const lines: SqsLine[] = [
    {
      label: "Queues",
      text: describeRead(
        readings.queues,
        `queues read from AWS, refreshed every ${Math.round(readings.refreshMs.queues / 1000)}s`,
      ),
    },
    { label: "Failed deliveries", text: describeDeadLetterState(readings.deadLetters) },
  ]
  if (readings.queues.state === "ACTUAL" || readings.queues.state === "STALE") {
    for (const queue of readings.queues.value) {
      lines.push({ label: queue.name, text: describeQueue(queue) })
    }
  }
  return lines
}
