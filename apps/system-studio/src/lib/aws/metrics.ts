/**
 * STUDIO-070-004 (CloudWatch metric data) — the number behind the alarm.
 *
 * `alarms.ts` reads alarm STATE and nothing in this engine has ever read a
 * metric. So an operator sees `OK` for a queue whose backlog has quadrupled in
 * twenty minutes and is four minutes from crossing the threshold, and the
 * console has no way to say so: an alarm's state is a step function over a number
 * nobody here could look at. `sqs.ts` says the same thing from the other side —
 * its `OLDEST_MESSAGE_NOT_READABLE` names `cloudwatch:GetMetricData` as the
 * capability that would answer "how old is the oldest message", and until this
 * module that capability had no reader.
 *
 * ## A gap is not a zero
 *
 * This is the whole defect this module exists not to have. CloudWatch does not
 * publish a datapoint for a period in which nothing happened; `Timestamps` and
 * `Values` simply do not contain that minute. Filling it with `0` turns "the
 * agent stopped reporting" into "the queue is empty" and "the task died" into
 * "CPU is idle" — the two most reassuring lies available in a metric surface.
 *
 * So the datapoints are returned exactly as CloudWatch published them, sparse,
 * and the summary is a UNION whose arms are `datapoints`, `no-datapoints` and
 * `not-read`. There is no arm carrying an optional mean, so a caller cannot
 * reach `.mean` on a series that has none — the same mechanism `AwsRead<T>`
 * uses for the same reason. `Coverage` states how many datapoints the window and
 * the period imply and how many actually arrived, so "sparse" is a number on the
 * page rather than something a reader has to notice.
 *
 * ## Refused per metric, not just per call
 *
 * `GetMetricData` can answer 200 and still refuse an individual query: the
 * result carries `StatusCode: "Forbidden"` when a policy condition scopes the
 * grant by namespace. That result has no values in it, and a reader that mapped
 * "no values" to "no data" would print "no datapoints in this window" about a
 * metric it was not allowed to read. Every series therefore carries its own
 * `SeriesStatus`, and a `Forbidden` or `InternalError` result summarises as
 * `not-read` with the status code in it — never as an absence, never as a zero.
 *
 * ## Batched, bounded, and made to state its own cost
 *
 * `GetMetricData` is billed per metric requested per request, and it is trivial
 * to make expensive: 500 queries over a 90-day window at a 60-second period is a
 * bill and a page that never renders. Three bounds, all refusals rather than
 * silent truncations:
 *
 *   * the caller MUST name an explicit window, and it is checked — parseable,
 *     ordered, at least `MIN_WINDOW_MS` and at most `MAX_WINDOW_MS` wide;
 *   * the implied datapoint count across every query is capped at
 *     `MAX_TOTAL_DATAPOINTS`;
 *   * at most `MAX_QUERIES_PER_BATCH` (the API's own limit) go in one request and
 *     at most `MAX_BATCHES` requests are made.
 *
 * A request that breaks one of these returns UNCONFIGURED and NO AWS CALL IS
 * MADE. Pagination past `MAX_PAGES_PER_BATCH` returns an explicit
 * `more-available` truncation rather than a first page rendered as the whole
 * series — a partial answer that looks whole is the failure the read plane
 * exists against.
 *
 * ## Deviation from "shared where no tag says otherwise", stated
 *
 * `tags.ts` keeps `shared` (somebody decided this belongs to no tenant) apart
 * from `unattributed` (nobody tagged it), and folding them is how an untagged
 * resource gets billed to a tenant that did not create it. This module keeps
 * both and adds a fourth, `unknown`, exactly as `sqs.ts` does: a metric whose
 * resource ARN was never given, or whose tag index could not be read, has an
 * attribution this engine does not know — which is not the same as a resource
 * somebody deliberately marked shared.
 *
 * The tag index is read only when at least one query names a `resourceArn`.
 * Charging every metric refresh an extra Resource Groups Tagging API call to
 * attribute nothing is a cost with no reading behind it; when it is skipped the
 * `tagged` reading says so in words rather than looking like a denial.
 *
 * ## Region and partition
 *
 * From the resolved identity — `sts:GetCallerIdentity` for the account and the
 * partition, the SDK's own resolved region for the region. There is no literal
 * region in this file and no `"aws"` fallback: GE-010-007 was a data-residency
 * defect caused by exactly that fallback, and a metric attributed to the wrong
 * region is a metric read from the wrong estate.
 */

import { CAPABILITIES, type Capability } from "./capabilities"
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

/* ---------------------------------------------------------------- bounds -- */

/** The capability every read here is made under. Named once. */
const CAPABILITY: Capability = "cloudwatch:GetMetricData"

/**
 * Queries per request. The API's own documented limit is 500, and this is that
 * number rather than a smaller one somebody felt safer about: the point of
 * batching is that one request carries the whole dashboard.
 */
export const MAX_QUERIES_PER_BATCH = 500

/**
 * Requests per load. Two thousand metrics is already far past anything a page
 * renders; a caller asking for more is refused rather than served a prefix.
 */
export const MAX_BATCHES = 4

/**
 * Pages walked per batch before the answer is declared truncated.
 *
 * `client.ts` sends `MaxDatapoints: 1440` and `ScanBy: "TimestampDescending"`,
 * so a page is at most 1440 datapoints across the whole request and the FIRST
 * page is the recent end of the window. Ten pages is 14,400 datapoints per
 * batch; past that the load stops and says it stopped.
 */
export const MAX_PAGES_PER_BATCH = 10

/** A window narrower than one period cannot contain a datapoint. */
export const MIN_WINDOW_MS = 60_000

/** Fifteen days. CloudWatch keeps 15 months, and a 15-month window is a bill. */
export const MAX_WINDOW_MS = 15 * 86_400_000

/**
 * The implied datapoint count across every query in one load.
 *
 * `window / period` per query, summed. This is the number that makes
 * `GetMetricData` expensive, and it is checked BEFORE the call rather than
 * discovered on the invoice.
 */
export const MAX_TOTAL_DATAPOINTS = 100_800

/**
 * The statistics a caller may ask for.
 *
 * A closed set, for the reason `capabilities.ts` is a closed set: `Stat` is a
 * free string in the API and accepts metric-math-adjacent forms such as
 * `TM(10%:90%)`. Enumerating what the console can ask for is what lets a
 * reviewer answer "what can this thing do" from the source.
 */
export const ALLOWED_STATS = [
  "Average",
  "Sum",
  "Minimum",
  "Maximum",
  "SampleCount",
  "IQM",
  "p50",
  "p90",
  "p95",
  "p99",
  "p99.9",
] as const

export type MetricStat = (typeof ALLOWED_STATS)[number]

/**
 * Periods CloudWatch accepts: the high-resolution set, or any multiple of 60.
 *
 * Checked rather than passed through. A period of 45 is rejected by the API for
 * the whole request, so one bad query in a batch of 500 would lose the other
 * 499 — and the resulting ERROR would name none of them.
 */
const HIGH_RESOLUTION_PERIODS = new Set([1, 5, 10, 20, 30])

export function isValidPeriod(seconds: number): boolean {
  if (!Number.isInteger(seconds) || seconds <= 0) return false
  return HIGH_RESOLUTION_PERIODS.has(seconds) || seconds % 60 === 0
}

/** The retry schedule is throttle.ts's, not a literal. See its header on jitter. */
const RETRY: { attempts: number; backoffMs: number } = {
  attempts: READ_ATTEMPTS,
  // `backoffMs(2)` is the pause after the first failure; readAws doubles it.
  backoffMs: backoffMs(2),
}

/* ----------------------------------------------------------------- input -- */

export interface MetricDimension {
  name: string
  value: string
}

/**
 * One metric a caller wants, named by the caller.
 *
 * `key` is the caller's own handle and travels through to the result, so a
 * surface joins on something it chose rather than on a CloudWatch query id this
 * module invented. Keys must be unique in one load: two series under one key is
 * a table that silently renders one of them.
 */
export interface MetricQuerySpec {
  key: string
  namespace: string
  metricName: string
  dimensions?: readonly MetricDimension[]
  stat: MetricStat
  periodSeconds: number
  /** What a chart legend should say. CloudWatch echoes it back; optional. */
  label?: string
  /**
   * The resource this metric is about, for attribution.
   *
   * Optional because a namespace-wide metric is about no single resource. When
   * it is absent the attribution is `unknown` with that reason in it — never
   * `shared`, which would be a claim somebody made a decision.
   */
  resourceArn?: string
}

/**
 * The window. Both ends, explicitly, from the caller.
 *
 * There is no default and there will not be one. A default window is how a page
 * asks for 90 days because nobody passed anything, and the caller is the only
 * thing that knows whether it is drawing a five-minute incident or a month.
 */
export interface MetricWindow {
  startIso: string
  endIso: string
}

/* ---------------------------------------------------------------- output -- */

export interface Datapoint {
  /** UTC, always. `toISOString()` on whatever the SDK handed back. */
  at: string
  value: number
}

/**
 * What CloudWatch said about one query, as opposed to about the call.
 *
 * `partial` is `StatusCode: "PartialData"` — more data exists past the page
 * budget. It is not an error and it is not completeness; a surface that printed
 * a mean over a partial series without saying so would be averaging a prefix.
 */
export type SeriesStatus =
  | { kind: "complete" }
  | { kind: "partial"; why: string }
  | { kind: "not-read"; why: string; statusCode: string | null }

/**
 * The compact answer, so a surface does not re-derive it — and so it cannot
 * re-derive it wrongly.
 *
 * Three arms and no optional numbers. `no-datapoints` and `not-read` are the two
 * absences this module exists to keep apart: the first is "CloudWatch published
 * nothing in this window", which is a real and often alarming reading, and the
 * second is "we did not get to look", which is not a reading at all.
 */
export type MetricSummary =
  | {
      kind: "datapoints"
      count: number
      latest: Datapoint
      earliest: Datapoint
      min: number
      max: number
      mean: number
    }
  | { kind: "no-datapoints"; why: string }
  | { kind: "not-read"; why: string }

/**
 * How much of the window actually arrived.
 *
 * `expectedDatapoints` is the window divided by the period — what a continuously
 * published metric would produce. `missingDatapoints` is the difference, and it
 * is a count of gaps, not a count of zeros.
 */
export interface Coverage {
  expectedDatapoints: number
  presentDatapoints: number
  missingDatapoints: number
  /**
   * Pairs CloudWatch returned that were not a finite number, or timestamps with
   * no value beside them. Excluded from the summary and counted here rather than
   * dropped silently: a metric that returns NaN is a fault worth seeing.
   */
  malformedDatapoints: number
}

/** Which tenant a metric's resource belongs to. See the header on the fourth arm. */
export type MetricAttribution =
  | { kind: "tenant"; tenantSlug: string }
  | { kind: "shared" }
  | { kind: "unattributed" }
  | { kind: "unknown"; why: string }

export interface MetricSeries {
  /** The caller's own handle, echoed. */
  key: string
  namespace: string
  metricName: string
  /** Sorted by name, so two loads of one metric produce one string. */
  dimensions: readonly MetricDimension[]
  stat: MetricStat
  periodSeconds: number
  /** CloudWatch's label when it returned one, else the caller's, else null. */
  label: string | null
  /** Sparse and ascending by timestamp. A period with no datapoint is absent. */
  datapoints: readonly Datapoint[]
  status: SeriesStatus
  summary: MetricSummary
  coverage: Coverage
  attribution: MetricAttribution
  /** From the resolved identity. Never a literal, never parsed out of a host. */
  region: string | null
  partition: string | null
  accountId: string | null
  /** This capability's own declared cadence, from the registry. */
  refreshMs: number
  asOf: string
}

/** Whether the page budget was spent before CloudWatch ran out of data. */
export type Truncation =
  | { kind: "complete" }
  | {
      kind: "more-available"
      why: string
      pagesRead: number
      /** The keys whose series are a prefix. Named, so "complete" is never implied. */
      keys: readonly string[]
    }

/** A batch that produced no series, and the queries that were in it. */
export interface UnreadableBatch {
  batch: number
  keys: readonly string[]
  why: string
}

/**
 * What one load actually cost, measured rather than estimated.
 *
 * Counted over the requests that ANSWERED, pagination included. A batch that was
 * refused or throttled is not counted here — it is in `unreadableBatches`, with
 * its own sentence — because a refused request is not a metric this account was
 * charged for, and an estimate that guessed either way would be a number on a
 * cost panel that nobody can reconcile against a bill.
 */
export interface RequestCost {
  batches: number
  /** `GetMetricData` calls that answered, pagination included. Each is billed. */
  requests: number
  /** Metrics named across those requests. This is the billed unit. */
  metricsRequested: number
}

export interface MetricReadings {
  identity: AwsRead<Identity>
  /**
   * The tag index, or the sentence saying it was deliberately not read. Never a
   * silent absence: an unread index and a denied one must not look alike.
   */
  tagged: AwsRead<readonly TaggedResource[]>
  window: MetricWindow
  /**
   * The series. DENIED here is a refused `cloudwatch:GetMetricData` and is NEVER
   * `[]` — an operator reading "no metrics" when the truth is "we were not
   * allowed to look" is the single most dangerous thing this surface can say.
   */
  series: AwsRead<readonly MetricSeries[]>
  truncation: Truncation
  unreadableBatches: readonly UnreadableBatch[]
  cost: RequestCost
  asOf: string
  refreshMs: number
}

/* ------------------------------------------------------------ the request -- */

/** The API's shapes, declared rather than imported — see client.ts's one-owner rule. */
interface GetMetricDataResponse {
  MetricDataResults?: Array<{
    Id?: string
    Label?: string
    Timestamps?: Array<string | Date>
    Values?: number[]
    StatusCode?: string
    Messages?: Array<{ Code?: string; Value?: string }>
  }>
  NextToken?: string
  Messages?: Array<{ Code?: string; Value?: string }>
}

/**
 * The id CloudWatch knows a query by, within one batch.
 *
 * Generated, not taken from the caller: the id must match `[a-z][a-zA-Z0-9_]*`
 * and a caller-supplied one that does not fails the WHOLE request, losing every
 * other query in the batch. The caller's own `key` travels beside it.
 */
function queryId(indexInBatch: number): string {
  return `m${indexInBatch}`
}

function sortedDimensions(spec: MetricQuerySpec): readonly MetricDimension[] {
  return [...(spec.dimensions ?? [])].sort((a, b) =>
    a.name === b.name ? (a.value < b.value ? -1 : a.value > b.value ? 1 : 0) : a.name < b.name ? -1 : 1,
  )
}

/* -------------------------------------------------------------- refusals -- */

/**
 * Why a load was refused before any call was made.
 *
 * UNCONFIGURED rather than ERROR because nothing is broken and no IAM statement
 * would help: the request itself is the thing that is wrong, and `why` says so
 * in the caller's terms.
 */
function refuse(why: string): AwsRead<readonly MetricSeries[]> {
  return { state: "UNCONFIGURED", capability: CAPABILITY, why }
}

/**
 * Everything wrong with a request, checked before it is sent.
 *
 * Returns null when the request is answerable. Every branch names the offending
 * key or number, because "invalid request" is a sentence an operator cannot act
 * on.
 */
export function validateRequest(
  specs: readonly MetricQuerySpec[],
  window: MetricWindow,
): string | null {
  if (specs.length === 0) {
    return "no metric query was named. This engine does not have a default set of metrics to read."
  }

  const start = Date.parse(window.startIso)
  const end = Date.parse(window.endIso)
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return (
      `the window must be two parseable ISO-8601 instants and this one is ` +
      `${JSON.stringify(window.startIso)} to ${JSON.stringify(window.endIso)}. ` +
      `cloudwatch:GetMetricData is billed per metric per request and this engine will not ` +
      `guess a window.`
    )
  }
  const span = end - start
  if (span <= 0) {
    return `the window ends at or before it starts (${window.startIso} to ${window.endIso}).`
  }
  if (span < MIN_WINDOW_MS) {
    return (
      `the window is ${span}ms wide and the narrowest window that can contain a datapoint is ` +
      `${MIN_WINDOW_MS}ms.`
    )
  }
  if (span > MAX_WINDOW_MS) {
    return (
      `the window is ${Math.round(span / 86_400_000)} day(s) wide and this engine reads at most ` +
      `${MAX_WINDOW_MS / 86_400_000}. An unbounded window is how one page becomes a line on the bill.`
    )
  }

  if (specs.length > MAX_QUERIES_PER_BATCH * MAX_BATCHES) {
    return (
      `${specs.length} metric queries were named and this engine sends at most ` +
      `${MAX_BATCHES} request(s) of ${MAX_QUERIES_PER_BATCH}. Refused rather than truncated: a ` +
      `prefix rendered as the whole set is the failure this read plane exists against.`
    )
  }

  const seen = new Set<string>()
  let impliedDatapoints = 0
  for (const spec of specs) {
    if (!spec.key) return "a metric query was named with an empty key."
    if (seen.has(spec.key)) {
      return `two metric queries share the key ${JSON.stringify(spec.key)}; a surface keyed on it would render one of them.`
    }
    seen.add(spec.key)
    if (!spec.namespace) return `metric query ${JSON.stringify(spec.key)} names no namespace.`
    if (!spec.metricName) return `metric query ${JSON.stringify(spec.key)} names no metric.`
    if (!(ALLOWED_STATS as readonly string[]).includes(spec.stat)) {
      return (
        `metric query ${JSON.stringify(spec.key)} asks for the statistic ` +
        `${JSON.stringify(spec.stat)}, which is not one of ${ALLOWED_STATS.join(", ")}.`
      )
    }
    if (!isValidPeriod(spec.periodSeconds)) {
      return (
        `metric query ${JSON.stringify(spec.key)} asks for a period of ${spec.periodSeconds}s. ` +
        `CloudWatch accepts 1, 5, 10, 20, 30 or any multiple of 60.`
      )
    }
    for (const dimension of spec.dimensions ?? []) {
      if (!dimension.name || !dimension.value) {
        return (
          `metric query ${JSON.stringify(spec.key)} carries a dimension with an empty name or ` +
          `value, which CloudWatch rejects for the whole request.`
        )
      }
    }
    impliedDatapoints += Math.ceil(span / 1000 / spec.periodSeconds)
  }

  if (impliedDatapoints > MAX_TOTAL_DATAPOINTS) {
    return (
      `this request implies ${impliedDatapoints} datapoints across ${specs.length} metric(s) and ` +
      `this engine reads at most ${MAX_TOTAL_DATAPOINTS} in one load. Widen the period or narrow ` +
      `the window.`
    )
  }
  return null
}

/* --------------------------------------------------------------- reading -- */

interface RawSeries {
  label: string | null
  datapoints: Datapoint[]
  malformed: number
  statusCode: string | null
  messages: string[]
  /** The batch's page budget ran out with a NextToken still in hand. */
  truncated: boolean
}

/** A batch's answer: one raw series per query id that CloudWatch returned. */
interface BatchResult {
  byId: Map<string, RawSeries>
  pagesRead: number
  requests: number
  truncated: boolean
}

function timestampOf(raw: string | Date): string | null {
  const date = raw instanceof Date ? raw : new Date(raw)
  const time = date.getTime()
  return Number.isFinite(time) ? date.toISOString() : null
}

/**
 * One batch, paginated to the page budget.
 *
 * Results for one id can be split across pages, so pages MERGE into the same
 * `RawSeries` rather than replacing it. A reader that kept the last page would
 * return the oldest slice of the window and call it the series.
 */
async function readBatch(
  gw: AwsGateway,
  specs: readonly MetricQuerySpec[],
  window: MetricWindow,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<BatchResult>> {
  return readAws<BatchResult>(
    CAPABILITY,
    async () => {
      const byId = new Map<string, RawSeries>()
      let token: string | undefined
      let pagesRead = 0
      let requests = 0
      let truncated = false

      for (let page = 0; page < MAX_PAGES_PER_BATCH; page += 1) {
        const response = (await gw.call(CAPABILITY, {
          MetricDataQueries: specs.map((spec, i) => ({
            Id: queryId(i),
            MetricStat: {
              Metric: {
                Namespace: spec.namespace,
                MetricName: spec.metricName,
                Dimensions: sortedDimensions(spec).map((d) => ({ Name: d.name, Value: d.value })),
              },
              Period: spec.periodSeconds,
              Stat: spec.stat,
            },
            Label: spec.label,
          })),
          StartTime: window.startIso,
          EndTime: window.endIso,
          NextToken: token,
        })) as GetMetricDataResponse

        pagesRead += 1
        requests += 1

        for (const result of response?.MetricDataResults ?? []) {
          if (!result.Id) continue
          const existing = byId.get(result.Id)
          const series: RawSeries = existing ?? {
            label: null,
            datapoints: [],
            malformed: 0,
            statusCode: null,
            messages: [],
            truncated: false,
          }
          if (result.Label) series.label = result.Label
          if (result.StatusCode) series.statusCode = result.StatusCode
          for (const message of result.Messages ?? []) {
            const text = [message.Code, message.Value].filter(Boolean).join(": ")
            if (text) series.messages.push(text)
          }

          const timestamps = result.Timestamps ?? []
          const values = result.Values ?? []
          const paired = Math.min(timestamps.length, values.length)
          // A timestamp with no value beside it, or the reverse, is a fault and
          // is counted — never paired with a zero to make the arrays line up.
          series.malformed += Math.abs(timestamps.length - values.length)
          for (let i = 0; i < paired; i += 1) {
            const at = timestampOf(timestamps[i])
            const value = values[i]
            if (at === null || typeof value !== "number" || !Number.isFinite(value)) {
              series.malformed += 1
              continue
            }
            series.datapoints.push({ at, value })
          }
          byId.set(result.Id, series)
        }

        token = response?.NextToken || undefined
        if (!token) break
        if (page === MAX_PAGES_PER_BATCH - 1) {
          // Not thrown. A truncated series is still the recent end of the window
          // — `client.ts` scans newest-first — and it is worth rendering as long
          // as the page says out loud that it is a prefix.
          truncated = true
        }
      }

      for (const series of byId.values()) series.truncated = truncated

      // No results at all is a genuinely empty answer, and `readAws` turns an
      // empty map into EMPTY. That is different from every result being empty,
      // which is ACTUAL with `no-datapoints` summaries — "CloudWatch returned
      // nothing" and "CloudWatch returned these metrics and none has published a
      // datapoint" are two readings and only the second is about the metrics.
      return { byId, pagesRead, requests, truncated }
    },
    {
      now: options.now,
      denial: options.denial,
      isEmpty: (value) => (value as BatchResult).byId.size === 0,
      ...RETRY,
    },
  )
}

/* ------------------------------------------------------------ assembling -- */

function summarise(raw: RawSeries, status: SeriesStatus): MetricSummary {
  if (status.kind === "not-read") {
    return { kind: "not-read", why: status.why }
  }
  if (raw.datapoints.length === 0) {
    return {
      kind: "no-datapoints",
      why:
        `CloudWatch published no datapoint for this metric in this window. That is a reading — ` +
        `a metric that stopped being published looks exactly like this — and it is not zero.`,
    }
  }
  const values = raw.datapoints.map((d) => d.value)
  let min = values[0]
  let max = values[0]
  let sum = 0
  for (const value of values) {
    if (value < min) min = value
    if (value > max) max = value
    sum += value
  }
  return {
    kind: "datapoints",
    count: values.length,
    // Ascending by timestamp, so the last is the newest. `client.ts` scans
    // newest-first, which is why sorting happens here rather than being assumed.
    earliest: raw.datapoints[0],
    latest: raw.datapoints[raw.datapoints.length - 1],
    min,
    max,
    mean: sum / values.length,
  }
}

/** CloudWatch's status codes, as a series-level state. */
function statusOf(raw: RawSeries | undefined, key: string): SeriesStatus {
  if (raw === undefined) {
    return {
      kind: "not-read",
      statusCode: null,
      why:
        `cloudwatch:GetMetricData returned no result for ${JSON.stringify(key)}. The query was ` +
        `sent and nothing came back for it, which is not the same as the metric having no data.`,
    }
  }
  const code = raw.statusCode
  const messages = raw.messages.length > 0 ? ` (${raw.messages.join("; ")})` : ""
  switch (code) {
    case "Complete":
    case null:
      return { kind: "complete" }
    case "PartialData":
      return {
        kind: "partial",
        why:
          `CloudWatch returned PartialData for this metric${messages}: more datapoints exist past ` +
          `what this load read. Any summary below is over the part that arrived.`,
      }
    case "Forbidden":
      return {
        kind: "not-read",
        statusCode: code,
        why:
          `cloudwatch:GetMetricData answered but refused this metric (Forbidden)${messages}. The ` +
          `call was permitted and this metric was not — a policy condition scopes the grant. ` +
          `Unknown, not zero, and not "no data".`,
      }
    default:
      return {
        kind: "not-read",
        statusCode: code,
        why: `cloudwatch:GetMetricData returned StatusCode ${JSON.stringify(code)} for this metric${messages}.`,
      }
  }
}

/** Attribution from the tag index, with `unknown` when there is nothing to join on. */
function attributionFor(
  spec: MetricQuerySpec,
  tagged: AwsRead<readonly TaggedResource[]>,
  index: Map<string, Readonly<Record<string, string>>>,
): MetricAttribution {
  if (!spec.resourceArn) {
    return {
      kind: "unknown",
      why:
        "this metric query names no resource ARN, so there is nothing to join against the tag " +
        "index. Shared would be a claim somebody decided; this is a claim about what was asked for.",
    }
  }
  if (tagged.state !== "ACTUAL" && tagged.state !== "STALE" && tagged.state !== "EMPTY") {
    return {
      kind: "unknown",
      why: `this metric's resource tags were not read — ${describeRead(tagged, "the tag index")}`,
    }
  }
  const tags = index.get(spec.resourceArn)
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

/* ----------------------------------------------------------- the surface -- */

/**
 * The metric data behind the alarms, batched, bounded and honest about gaps.
 *
 * The production entry point. A route or a page calls it with the queries it
 * wants and gets the live gateway; a test passes a stand-in gateway to the SAME
 * function, because a test that drove a private helper would stay green on the
 * day the caller stopped calling it.
 */
export async function metricReadings(
  specs: readonly MetricQuerySpec[],
  window: MetricWindow,
  supplied?: AwsGateway,
  options: { now?: () => Date } = {},
): Promise<MetricReadings> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())
  const refreshMs = CAPABILITIES[CAPABILITY].refreshMs

  const identity = await resolveIdentity(supplied, { now })
  const denial = denialContextFrom(identity)

  const invalid = validateRequest(specs, window)
  if (invalid !== null) {
    // No AWS call is made. The request is what is wrong, and sending it anyway
    // would spend money to be told so.
    return {
      identity,
      tagged: {
        state: "UNCONFIGURED",
        capability: "tag:GetResources",
        why: "the metric request was refused before any read, so the tag index was not read either.",
      },
      window,
      series: refuse(invalid),
      truncation: { kind: "complete" },
      unreadableBatches: [],
      cost: { batches: 0, requests: 0, metricsRequested: 0 },
      asOf: now().toISOString(),
      refreshMs,
    }
  }

  // Read only when something can be attributed with it. See the header.
  const wantsTags = specs.some((spec) => Boolean(spec.resourceArn))
  const tagged: AwsRead<readonly TaggedResource[]> = wantsTags
    ? await taggedResources(supplied, { now, denial })
    : {
        state: "UNCONFIGURED",
        capability: "tag:GetResources",
        why:
          "no metric query named a resource ARN, so the tag index was not read. Not a refusal — " +
          "an extra Resource Groups Tagging API call per refresh that would attribute nothing.",
      }
  const index = tagIndex(
    tagged.state === "ACTUAL" || tagged.state === "STALE" ? tagged.value : [],
  )

  const batches: MetricQuerySpec[][] = []
  for (let start = 0; start < specs.length; start += MAX_QUERIES_PER_BATCH) {
    batches.push(specs.slice(start, start + MAX_QUERIES_PER_BATCH))
  }

  const series: MetricSeries[] = []
  const unreadableBatches: UnreadableBatch[] = []
  const truncatedKeys: string[] = []
  let pagesRead = 0
  let requests = 0
  let metricsRequested = 0
  let firstUnreadable: AwsRead<BatchResult> | null = null

  const identityResolved = identity.state === "ACTUAL" || identity.state === "STALE"
  const region = identityResolved ? identity.value.region : null
  const partition = identityResolved ? identity.value.partition : null
  const accountId = identityResolved ? identity.value.accountId : null
  const asOf = now().toISOString()

  const spanMs = Date.parse(window.endIso) - Date.parse(window.startIso)

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex]
    const read = await readBatch(gw, batch, window, { now, denial })

    if (read.state !== "ACTUAL" && read.state !== "STALE") {
      // One refused batch does not collapse the batches that answered. Its keys
      // are named with the refusal's own sentence, so nothing in it renders as
      // an absence or as a default.
      if (firstUnreadable === null) firstUnreadable = read
      unreadableBatches.push({
        batch: batchIndex,
        keys: batch.map((spec) => spec.key),
        why: describeRead(read, `metric batch ${batchIndex + 1} of ${batches.length}`),
      })
      continue
    }

    pagesRead += read.value.pagesRead
    requests += read.value.requests
    metricsRequested += batch.length * read.value.requests

    for (let i = 0; i < batch.length; i += 1) {
      const spec = batch[i]
      const raw = read.value.byId.get(queryId(i))
      const status = statusOf(raw, spec.key)
      const datapoints = raw
        ? [...raw.datapoints].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
        : []
      const deduped: Datapoint[] = []
      for (const point of datapoints) {
        // Pagination can repeat a boundary datapoint. Two identical timestamps
        // would double its weight in the mean.
        if (deduped.length > 0 && deduped[deduped.length - 1].at === point.at) continue
        deduped.push(point)
      }
      const expected = Math.max(0, Math.floor(spanMs / 1000 / spec.periodSeconds))
      const coverage: Coverage = {
        expectedDatapoints: expected,
        presentDatapoints: deduped.length,
        missingDatapoints: Math.max(0, expected - deduped.length),
        malformedDatapoints: raw?.malformed ?? 0,
      }
      const normalised: RawSeries = {
        label: raw?.label ?? null,
        datapoints: deduped,
        malformed: coverage.malformedDatapoints,
        statusCode: raw?.statusCode ?? null,
        messages: raw?.messages ?? [],
        truncated: raw?.truncated ?? false,
      }
      if (normalised.truncated) truncatedKeys.push(spec.key)

      series.push({
        key: spec.key,
        namespace: spec.namespace,
        metricName: spec.metricName,
        dimensions: sortedDimensions(spec),
        stat: spec.stat,
        periodSeconds: spec.periodSeconds,
        label: normalised.label ?? spec.label ?? null,
        datapoints: deduped,
        status,
        summary: summarise(normalised, status),
        coverage,
        attribution: attributionFor(spec, tagged, index),
        region,
        partition,
        accountId,
        refreshMs,
        asOf,
      })
    }
  }

  const truncation: Truncation =
    truncatedKeys.length === 0
      ? { kind: "complete" }
      : {
          kind: "more-available",
          pagesRead,
          keys: truncatedKeys,
          why:
            `this engine read ${MAX_PAGES_PER_BATCH} page(s) per batch and CloudWatch still had ` +
            `more. The series below are the RECENT end of the window, not the whole of it.`,
        }

  // Every batch failed: the top-level reading is that failure, unchanged and
  // with no `value` on it. There is no branch here that turns a denial into an
  // array, which is the property `AwsRead` exists to enforce.
  if (series.length === 0 && firstUnreadable !== null) {
    const failed: AwsRead<readonly MetricSeries[]> = firstUnreadable
    return {
      identity,
      tagged,
      window,
      series: failed,
      truncation,
      unreadableBatches,
      cost: { batches: batches.length, requests, metricsRequested },
      asOf,
      refreshMs,
    }
  }

  const read: AwsRead<readonly MetricSeries[]> =
    series.length === 0
      ? { state: "EMPTY", capability: CAPABILITY, asOf }
      : { state: "ACTUAL", capability: CAPABILITY, value: series, asOf, fresh: true }

  return {
    identity,
    tagged,
    window,
    series: read,
    truncation,
    unreadableBatches,
    cost: { batches: batches.length, requests, metricsRequested },
    asOf,
    refreshMs,
  }
}

/* ------------------------------------------------------------ rendering -- */

/**
 * A number a human reads, with the platform-independent formatting spelled out.
 *
 * `toPrecision` rather than `toLocaleString`: the locale is the host's, and a
 * surface that prints `1,024.5` on one machine and `1.024,5` on another produces
 * artefacts that differ by checkout.
 */
export function formatValue(value: number): string {
  if (!Number.isFinite(value)) return "not a number"
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value)
  return String(Number.parseFloat(value.toPrecision(6)))
}

/** The sentence a surface prints for one series' summary. */
export function describeSummary(summary: MetricSummary): string {
  switch (summary.kind) {
    case "datapoints":
      return (
        `latest ${formatValue(summary.latest.value)} at ${summary.latest.at} · ` +
        `min ${formatValue(summary.min)}, max ${formatValue(summary.max)}, ` +
        `mean ${formatValue(summary.mean)} over ${summary.count} datapoint(s) ` +
        `from ${summary.earliest.at}`
      )
    case "no-datapoints":
      return `no datapoint — ${summary.why}`
    case "not-read":
      return `unknown — ${summary.why}`
  }
}

/** The sentence a surface prints for one series' attribution. */
export function describeMetricAttribution(attribution: MetricAttribution): string {
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

/** The sentence a surface prints for the page budget. */
export function describeTruncation(truncation: Truncation): string {
  switch (truncation.kind) {
    case "complete":
      return "complete — CloudWatch had no more pages for this window"
    case "more-available":
      return (
        `TRUNCATED — ${truncation.why} Affected: ${truncation.keys.join(", ")} ` +
        `(${truncation.pagesRead} page(s) read)`
      )
  }
}

/**
 * The sentence a surface prints for one series.
 *
 * One funnel, for the same reason `describeRead` is one funnel: a refused metric
 * must not read as "no data" on one surface and correctly on another.
 */
export function describeSeries(series: MetricSeries): string {
  const dimensions =
    series.dimensions.length === 0
      ? "no dimensions"
      : series.dimensions.map((d) => `${d.name}=${d.value}`).join(", ")
  const where =
    series.region && series.partition
      ? `${series.region} (partition ${series.partition})`
      : "region unknown — identity is unresolved"
  const gaps =
    series.coverage.missingDatapoints > 0
      ? ` · ${series.coverage.missingDatapoints} of ${series.coverage.expectedDatapoints} period(s) ` +
        `published nothing — a gap, not a zero`
      : ` · ${series.coverage.presentDatapoints} of ${series.coverage.expectedDatapoints} period(s) published`
  const malformed =
    series.coverage.malformedDatapoints > 0
      ? ` · ${series.coverage.malformedDatapoints} datapoint(s) CloudWatch returned were not usable`
      : ""
  const partial = series.status.kind === "partial" ? ` · ${series.status.why}` : ""
  return (
    `${series.namespace} ${series.metricName} [${dimensions}] ${series.stat}@${series.periodSeconds}s — ` +
    `${where} — ${describeMetricAttribution(series.attribution)} — ${describeSummary(series.summary)}` +
    `${gaps}${malformed}${partial} · as of ${series.asOf}, refreshed every ` +
    `${Math.round(series.refreshMs / 1000)}s`
  )
}

export interface MetricLine {
  label: string
  text: string
}

/**
 * What a metric surface prints.
 *
 * The route agent renders exactly these strings. The tests assert on them,
 * which is what makes the mutation proofs land on the production path rather
 * than on a helper nothing calls.
 */
export function metricLines(readings: MetricReadings): readonly MetricLine[] {
  const lines: MetricLine[] = [
    {
      label: "Metrics",
      text: describeRead(
        readings.series,
        `${readings.window.startIso} to ${readings.window.endIso}, refreshed every ` +
          `${Math.round(readings.refreshMs / 1000)}s`,
      ),
    },
    {
      label: "Cost",
      text:
        `${readings.cost.requests} GetMetricData request(s) across ${readings.cost.batches} batch(es), ` +
        `${readings.cost.metricsRequested} metric(s) requested — billed per metric per request`,
    },
    { label: "Completeness", text: describeTruncation(readings.truncation) },
  ]
  for (const batch of readings.unreadableBatches) {
    lines.push({
      label: `Batch ${batch.batch + 1}`,
      text: `${batch.why} — not read: ${batch.keys.join(", ")}`,
    })
  }
  if (readings.series.state === "ACTUAL" || readings.series.state === "STALE") {
    for (const one of readings.series.value) {
      lines.push({ label: one.key, text: describeSeries(one) })
    }
  }
  return lines
}
