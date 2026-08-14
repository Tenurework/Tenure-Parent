/**
 * STUDIO-070-004 (CloudWatch dashboards) — the dashboard nobody reads back.
 *
 * `infrastructure/terraform/cloudwatch.tf` provisions `${name_prefix}-ops` with
 * four widgets — ECS running tasks, ALB request count and 5xx, RDS CPU, and a
 * Logs Insights query over the app log group — and nothing in this engine has
 * ever read it back. So the console cannot answer the question the dashboard
 * exists to answer:
 *
 *   * does the dashboard still point at services that exist, or at an ECS
 *     service that was renamed and a load balancer that was replaced;
 *   * and, the other way round, which of the estate's services appear on NO
 *     dashboard and in NO alarm — the intersection nobody is watching.
 *
 * The second question is the operational one, and it is a set difference. It
 * cannot be computed by eyeballing a JSON blob, so this module parses the body
 * down to the metric namespaces, alarm names and log groups each widget
 * references and returns them as data. The intersection itself belongs to a
 * surface that also holds the inventory; `unwatchedNamespaces` is the half of it
 * this module can answer honestly.
 *
 * ## A dashboard body is JSON in a string, and a bad one is a state
 *
 * `GetDashboard` returns `DashboardBody` as a STRING. Nothing validates it after
 * `PutDashboard` accepts it, and a hand-edited dashboard, a truncated one, or a
 * body from a newer console than this parser knows about are all things that
 * happen. `JSON.parse` throwing is therefore a reading — `{ kind: "malformed" }`
 * with an excerpt — and not an exception that takes the page down with it. A
 * dashboard whose body cannot be parsed is a dashboard whose coverage is
 * UNKNOWN, which is the one thing it must not be confused with: watching
 * nothing.
 *
 * ## Four absences, kept apart
 *
 * `DashboardContent` has no arm carrying optional widgets, for the same reason
 * `AwsRead<T>` has no arm carrying an optional `T`:
 *
 *   watching          the body parsed and these are the references in it
 *   watching-nothing  the body parsed and has no widgets — a real and alarming
 *                     reading, and the only one of the four that is a claim
 *   malformed         the body is not JSON this reader can walk
 *   not-read          `cloudwatch:GetDashboard` was refused, throttled or failed
 *                     for THIS dashboard
 *
 * The referenced namespaces live ON the `watching` arm rather than on the row,
 * so a caller cannot read `row.namespaces` off a dashboard whose body was
 * refused and get `[]` — which would say "this dashboard watches nothing" about
 * a dashboard nobody was allowed to open.
 *
 * ## Degrading per dashboard, not per load
 *
 * `ListDashboards` is one call and `GetDashboard` is one call PER dashboard.
 * A policy that grants the list and scopes the get — or a single dashboard whose
 * get is throttled — must leave every other row intact. Each get is its own
 * `readAws`, and its refusal becomes that row's `not-read` sentence. The load as
 * a whole stays ACTUAL, and `coverage` drops from `complete` to `partial` and
 * names the dashboards it could not open, because a set difference computed over
 * an incomplete set is not a finding.
 *
 * ## What this reader will not guess
 *
 * Metric math is resolved only where it is unambiguous. An expression over ids
 * declared in the same widget (`m1+m2`) references no namespace of its own —
 * metric math can only reference ids in its own widget, plus `SEARCH` — so it is
 * `arithmetic` and costs coverage nothing. A `SEARCH('{AWS/ECS,ClusterName}',…)`
 * names its namespace in the query literal and is resolved to it. Anything else
 * — a SEARCH whose query is built dynamically, an `explorer` widget that names
 * resource TYPES rather than namespaces, a `custom` widget rendered by a Lambda
 * — is `unresolved`, which makes the coverage answer `partial` and says why.
 * Guessing there would produce exactly the reassuring default this read plane
 * exists against.
 *
 * ## Region and partition
 *
 * From the resolved identity: `sts:GetCallerIdentity` for the account and the
 * partition, the SDK's own resolved region for the region. There is no literal
 * region in this file and no `"aws"` fallback — GE-010-007 was a data-residency
 * defect caused by exactly that fallback. Widgets carry their OWN region when
 * they name one, because a widget pointing at another region is a real thing and
 * a dashboard that looks complete while watching an estate in a region this
 * account does not deploy to is the kind of thing this surface should show.
 *
 * ## Attribution, and a deviation stated
 *
 * `tags.ts` keeps `shared` (somebody decided this belongs to no tenant) apart
 * from `unattributed` (nobody tagged it), and this module adds a fourth arm,
 * `unknown`, exactly as `metrics.ts` does: a dashboard whose tag index could not
 * be read has an attribution this engine does not know, which is not the same as
 * one somebody deliberately marked shared. The brief says "mark it shared where
 * no tag says so"; folding an unread index into `shared` would make a denial
 * render as a decision, so the fourth arm stays and this sentence is the record
 * of the deviation.
 */

import { CAPABILITIES, type Capability } from "./capabilities"
import { denialContextFrom, resolveIdentity, type Identity } from "./identity"
import {
  describeRead,
  liveGateway,
  readAws,
  safeDetail,
  type AwsGateway,
  type AwsRead,
  type DenialContext,
} from "./read"
import { attributionOf, tagIndex, taggedResources, type TaggedResource } from "./tags"
import { READ_ATTEMPTS, backoffMs } from "./throttle"

/* ---------------------------------------------------------------- bounds -- */

/** Listing the dashboards. Named once. */
const LIST: Capability = "cloudwatch:ListDashboards"

/** Opening one dashboard's body. One call per dashboard, and each can fail alone. */
const GET: Capability = "cloudwatch:GetDashboard"

/**
 * Pages of `ListDashboards` walked before the answer is declared truncated.
 *
 * A reader with no bound is how one page takes the console down; a reader that
 * silently stops at the first page is the same lie as an empty list. So it stops
 * and says so, through `Truncation`.
 */
export const MAX_LIST_PAGES = 20

/**
 * Bodies opened in one load.
 *
 * `GetDashboard` is a request per dashboard. An account with four hundred
 * dashboards would spend four hundred requests on one page render, so the ones
 * past the cap are listed with `not-read` content naming the cap — visible, and
 * counted against coverage — rather than dropped.
 */
export const MAX_DASHBOARDS_READ = 100

/**
 * Widgets parsed per dashboard. CloudWatch's own documented maximum is 500, so
 * a body claiming more than this is already outside what the service accepts.
 */
export const MAX_WIDGETS_PER_DASHBOARD = 500

/**
 * The largest body this reader will parse, in characters.
 *
 * Not the API's limit — this reader's. A body larger than this is reported
 * `malformed` with the size in the sentence rather than parsed, because the cost
 * of `JSON.parse` on an unbounded string is paid by an operator waiting for a
 * page.
 */
export const MAX_BODY_CHARS = 500_000

/** The retry schedule is throttle.ts's, not a literal. See its header on jitter. */
const RETRY: { attempts: number; backoffMs: number } = {
  attempts: READ_ATTEMPTS,
  // `backoffMs(2)` is the pause after the first failure; readAws doubles it.
  backoffMs: backoffMs(2),
}

/* ------------------------------------------------------------ references -- */

export interface MetricDimension {
  name: string
  value: string
}

/** One metric a widget draws, as the body names it. */
export interface MetricReference {
  namespace: string
  metricName: string
  /** Sorted by name, so two reads of one widget produce one string. */
  dimensions: readonly MetricDimension[]
}

/**
 * One alarm a widget shows, by ARN.
 *
 * `name` is null when the ARN did not parse, and the raw ARN is kept either way:
 * a surface joining dashboards to `alarms.ts` joins on the NAME, and inventing
 * one out of a string that is not an alarm ARN would produce a join that
 * silently matches nothing.
 */
export interface AlarmReference {
  arn: string
  name: string | null
  region: string | null
  accountId: string | null
}

/**
 * What this reader could make of one metric-math expression.
 *
 * A union rather than a boolean, so a caller cannot treat "we resolved nothing
 * from this" as "this references nothing".
 */
export type ExpressionResolution =
  | {
      /** References only ids declared in this widget, so it names no new namespace. */
      kind: "arithmetic"
    }
  | { kind: "search"; namespaces: readonly string[] }
  | { kind: "unresolved"; why: string }

export interface ExpressionReference {
  expression: string
  resolution: ExpressionResolution
}

export interface DashboardWidget {
  /** Position in the body's `widgets` array. The only stable handle a widget has. */
  index: number
  /** The body's own `type` string, echoed — never normalised into a closed set. */
  type: string
  title: string | null
  /** The widget's own region when it names one. A widget may watch another region. */
  region: string | null
  /** The widget's own account when it names one — a cross-account widget. */
  accountId: string | null
  metrics: readonly MetricReference[]
  alarms: readonly AlarmReference[]
  logGroups: readonly string[]
  expressions: readonly ExpressionReference[]
  /**
   * Everything about this widget this reader could not resolve, in sentences.
   *
   * Non-empty means the coverage answer for this dashboard is `partial`. That is
   * the whole point of collecting them: an unparsed widget must reduce what the
   * console is willing to claim, not disappear.
   */
  problems: readonly string[]
}

/* --------------------------------------------------------------- content -- */

/**
 * What one dashboard's body turned out to be. Four arms, and only one is a claim.
 *
 * The reference sets live on the `watching` arm and nowhere else, so a caller
 * cannot read an empty namespace list off a dashboard that was never opened.
 */
export type DashboardContent =
  | {
      kind: "watching"
      widgets: readonly DashboardWidget[]
      /** Deduped and sorted. Every namespace any widget in this body references. */
      namespaces: readonly string[]
      /** Alarm NAMES, for joining against `alarms.ts`. Unparseable ARNs are in `unresolved`. */
      alarmNames: readonly string[]
      logGroups: readonly string[]
      /** Every region a widget named, resolved region included only if a widget said so. */
      regions: readonly string[]
      /**
       * Why this body's reference sets may be incomplete. Empty means they are
       * not — which is what lets `coverage` say `complete`.
       */
      unresolved: readonly string[]
    }
  | {
      /** The body parsed and declares no widgets. A dashboard watching nothing. */
      kind: "watching-nothing"
      why: string
    }
  | { kind: "malformed"; why: string; excerpt: string }
  | { kind: "not-read"; why: string }

/** Which tenant a dashboard belongs to. See the header on the fourth arm. */
export type DashboardAttribution =
  | { kind: "tenant"; tenantSlug: string }
  | { kind: "shared" }
  | { kind: "unattributed" }
  | { kind: "unknown"; why: string }

export interface DashboardRow {
  name: string
  /** From the listing. Null when `ListDashboards` returned an entry without one. */
  arn: string | null
  /** ISO-8601 UTC. Null when the listing carried no parseable `LastModified`. */
  lastModified: string | null
  /** The body's size in bytes as the LISTING reports it. Null when absent. */
  sizeBytes: number | null
  content: DashboardContent
  attribution: DashboardAttribution
  /** From the resolved identity. Never a literal, never parsed out of a host. */
  region: string | null
  partition: string | null
  accountId: string | null
  /** This capability's own declared cadence, from the registry. */
  refreshMs: number
  asOf: string
}

/* -------------------------------------------------------------- coverage -- */

/**
 * What the whole estate's dashboards watch, and whether that is the whole answer.
 *
 * `partial` exists because the question this feeds — which services appear on no
 * dashboard — is a set DIFFERENCE, and a set difference against an incomplete
 * set produces false findings in the dangerous direction: a service that is on a
 * dashboard nobody was allowed to open would be reported as unwatched.
 */
export type DashboardCoverage =
  | {
      kind: "complete"
      namespaces: readonly string[]
      alarmNames: readonly string[]
      logGroups: readonly string[]
    }
  | {
      kind: "partial"
      namespaces: readonly string[]
      alarmNames: readonly string[]
      logGroups: readonly string[]
      why: string
      /** The dashboards whose contribution is missing or incomplete, by name. */
      incompleteDashboards: readonly string[]
    }
  | { kind: "not-read"; why: string }

/**
 * The answer to "which of these is on no dashboard", and a refusal to answer it
 * when the coverage set is not whole.
 */
export type UnwatchedNamespaces =
  | { kind: "decidable"; namespaces: readonly string[] }
  | {
      kind: "undecidable"
      why: string
      /**
       * The namespaces that are on no dashboard this load COULD read. Named
       * differently from the decidable arm on purpose: it is a shortlist to
       * check, not a finding to act on.
       */
      notOnAnyDashboardRead: readonly string[]
    }

/** Whether the load's own bounds were hit before AWS ran out of dashboards. */
export type Truncation =
  | { kind: "complete" }
  | {
      kind: "more-available"
      why: string
      pagesRead: number
      /** Dashboards the listing named. */
      listed: number
      /** Dashboards whose body this load opened. */
      opened: number
    }

export interface DashboardReadings {
  identity: AwsRead<Identity>
  /** The tag index, or the sentence saying why it is not one. Never a silent absence. */
  tagged: AwsRead<readonly TaggedResource[]>
  /**
   * The dashboards. DENIED here is a refused `cloudwatch:ListDashboards` and is
   * NEVER `[]` — an operator reading "no dashboards" when the truth is "we were
   * not allowed to look" is the single most dangerous thing this surface can say.
   */
  dashboards: AwsRead<readonly DashboardRow[]>
  coverage: DashboardCoverage
  truncation: Truncation
  asOf: string
  refreshMs: number
}

/* ------------------------------------------------------- the API's shapes -- */

/** Declared rather than imported — `client.ts` is the only module that may hold the SDK. */
interface ListDashboardsResponse {
  DashboardEntries?: Array<{
    DashboardName?: string
    DashboardArn?: string
    LastModified?: string | Date
    Size?: number
  }>
  NextToken?: string
}

interface GetDashboardResponse {
  DashboardName?: string
  DashboardArn?: string
  DashboardBody?: string
}

interface ListedDashboard {
  name: string
  arn: string | null
  lastModified: string | null
  sizeBytes: number | null
}

/* ---------------------------------------------------------------- helpers -- */

/**
 * Deterministic across platforms: code-unit order, never `localeCompare`.
 *
 * A generated artefact that sorts by locale differs by checkout, which is a
 * defect this programme has already shipped once.
 */
function sortedUnique(values: Iterable<string>): readonly string[] {
  return [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asIso(value: string | Date | undefined): string | null {
  if (value === undefined || value === null) return null
  const date = value instanceof Date ? value : new Date(value)
  const time = date.getTime()
  return Number.isFinite(time) ? date.toISOString() : null
}

/**
 * The alarm name out of an alarm ARN.
 *
 * `arn:PARTITION:cloudwatch:REGION:ACCOUNT:alarm:NAME`. An alarm name may itself
 * contain a colon, so the name is everything after the `alarm:` segment rather
 * than the last colon-separated field. Returns nulls rather than guessing: a
 * fabricated name would join against `alarms.ts` and match nothing, silently.
 */
export function parseAlarmArn(arn: string): AlarmReference {
  const parts = arn.split(":")
  if (parts.length < 7 || parts[0] !== "arn" || parts[2] !== "cloudwatch" || parts[5] !== "alarm") {
    return { arn, name: null, region: null, accountId: null }
  }
  const name = parts.slice(6).join(":")
  return {
    arn,
    name: name || null,
    region: parts[3] || null,
    accountId: parts[4] || null,
  }
}

/**
 * What one metric-math expression references.
 *
 * See the header: an expression with no `SEARCH` in it can only reference ids
 * declared in its own widget, which are already in `metrics`, so it names no
 * namespace and costs coverage nothing. A `SEARCH` names its namespace inside
 * the query literal — `SEARCH('{AWS/ECS,ClusterName} MetricName="CPUUtilization"', 'Average')`
 * — and anything this reader cannot pull a namespace out of is `unresolved`.
 */
export function classifyExpression(expression: string): ExpressionResolution {
  if (!/\bSEARCH\s*\(/i.test(expression)) return { kind: "arithmetic" }

  const literals = [...expression.matchAll(/SEARCH\s*\(\s*(['"])([\s\S]*?)\1/g)]
  const searches = (expression.match(/\bSEARCH\s*\(/gi) ?? []).length
  if (literals.length < searches) {
    return {
      kind: "unresolved",
      why:
        `this expression calls SEARCH ${searches} time(s) and ${literals.length} of them open with a ` +
        `quoted query this reader could read. A SEARCH whose query is assembled rather than written ` +
        `out names namespaces that are not in this body, so what it watches is unknown.`,
    }
  }

  const namespaces: string[] = []
  for (const literal of literals) {
    const query = literal[2]
    const braced = /\{\s*([^,}\s]+)/.exec(query)
    if (!braced) {
      return {
        kind: "unresolved",
        why:
          `this expression's SEARCH query ${JSON.stringify(query.slice(0, 120))} does not open with a ` +
          `{namespace…} literal, so the namespaces it matches are not stated in this body.`,
      }
    }
    namespaces.push(braced[1])
  }
  return { kind: "search", namespaces: sortedUnique(namespaces) }
}

/**
 * One entry of a metric widget's `metrics` array, with the console's shorthand
 * resolved against the entry before it.
 *
 * The console writes `[".", ".", ".", "i-98765"]` to mean "as the previous entry
 * except the last dimension value", and `["...", "i-98765"]` to mean the same
 * with one token standing for several. A reader that took those literally would
 * report a metric in the namespace `"."`, which is not a namespace and is not
 * anything. Returns `null` values with a problem when there is nothing to
 * resolve against — never a fabricated namespace.
 */
function resolveMetricEntry(
  entry: readonly unknown[],
  previous: readonly string[] | null,
): { values: string[] | null; expression: string | null; problem: string | null } {
  if (entry.length === 0) {
    return { values: null, expression: null, problem: "a metrics entry is an empty array." }
  }

  if (isPlainObject(entry[0])) {
    const expression = entry[0].expression
    if (typeof expression === "string" && expression.trim()) {
      return { values: null, expression, problem: null }
    }
    return {
      values: null,
      expression: null,
      problem:
        `a metrics entry opens with an object carrying no \`expression\`: ` +
        `${JSON.stringify(Object.keys(entry[0]).slice(0, 8))}. This reader does not know what it draws.`,
    }
  }

  // The trailing options object is rendering, not reference. Dropped, not parsed.
  const tokens = entry.slice(0, isPlainObject(entry[entry.length - 1]) ? entry.length - 1 : entry.length)

  const out: string[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (typeof token !== "string") {
      return {
        values: null,
        expression: null,
        problem: `a metrics entry carries ${JSON.stringify(token)} where a string was expected.`,
      }
    }
    if (token === "...") {
      const after = tokens.length - i - 1
      if (!previous || previous.length - after < out.length) {
        return {
          values: null,
          expression: null,
          problem:
            `a metrics entry uses the "..." shorthand with no earlier entry it can stand for, so the ` +
            `namespace and metric it draws are not stated anywhere in this body.`,
        }
      }
      out.push(...previous.slice(out.length, previous.length - after))
      continue
    }
    if (token === ".") {
      if (!previous || previous.length <= out.length) {
        return {
          values: null,
          expression: null,
          problem:
            `a metrics entry uses the "." shorthand at position ${out.length} with no earlier entry ` +
            `carrying that position, so what it draws is not stated anywhere in this body.`,
        }
      }
      out.push(previous[out.length])
      continue
    }
    out.push(token)
  }

  if (out.length < 2) {
    return {
      values: null,
      expression: null,
      problem: `a metrics entry resolved to ${JSON.stringify(out)}, which names no namespace and metric.`,
    }
  }
  return { values: out, expression: null, problem: null }
}

/** The log groups a Logs Insights widget reads, out of its `SOURCE` clauses. */
function logGroupsOfQuery(query: string): { groups: string[]; problem: string | null } {
  const groups = [...query.matchAll(/SOURCE\s+'([^']+)'/g)].map((m) => m[1])
  const sources = (query.match(/\bSOURCE\b/g) ?? []).length
  if (sources > groups.length) {
    return {
      groups,
      problem:
        `this log widget's query names ${sources} SOURCE clause(s) and ${groups.length} of them are a ` +
        `quoted log-group name. The rest select groups by prefix or function, so which groups it reads ` +
        `is not stated in this body.`,
    }
  }
  if (sources === 0) {
    return {
      groups,
      problem:
        "this log widget's query names no SOURCE clause, so the log group it reads is not stated in " +
        "this body.",
    }
  }
  return { groups, problem: null }
}

/* ---------------------------------------------------------- body parsing -- */

/** Widget types this reader knows how to walk. Anything else is reported, not guessed. */
const UNDERSTOOD_WIDGET_TYPES = new Set(["metric", "log", "text", "alarm"])

function parseWidget(raw: unknown, index: number): DashboardWidget {
  const problems: string[] = []
  const metrics: MetricReference[] = []
  const alarms: AlarmReference[] = []
  const logGroups: string[] = []
  const expressions: ExpressionReference[] = []

  if (!isPlainObject(raw)) {
    return {
      index,
      type: "unknown",
      title: null,
      region: null,
      accountId: null,
      metrics: [],
      alarms: [],
      logGroups: [],
      expressions: [],
      problems: [`widget ${index} is ${JSON.stringify(raw)}, not an object.`],
    }
  }

  const type = typeof raw.type === "string" && raw.type ? raw.type : "unknown"
  const properties = isPlainObject(raw.properties) ? raw.properties : {}
  if (!isPlainObject(raw.properties)) {
    problems.push(`widget ${index} carries no \`properties\` object, so it references nothing this reader can see.`)
  }

  const title = typeof properties.title === "string" && properties.title ? properties.title : null
  const region = typeof properties.region === "string" && properties.region ? properties.region : null
  const accountId =
    typeof properties.accountId === "string" && properties.accountId ? properties.accountId : null

  if (!UNDERSTOOD_WIDGET_TYPES.has(type)) {
    problems.push(
      `widget ${index} is of type ${JSON.stringify(type)}, which this reader does not walk. An ` +
        `explorer widget names resource types rather than namespaces and a custom widget is rendered ` +
        `by a Lambda, so what either watches is not stated in this body.`,
    )
  }

  /* -- metrics, with the console's shorthand resolved -- */
  const rawMetrics = properties.metrics
  if (Array.isArray(rawMetrics)) {
    let previous: readonly string[] | null = null
    for (const entry of rawMetrics) {
      if (!Array.isArray(entry)) {
        problems.push(`widget ${index} carries a metrics entry that is not an array: ${JSON.stringify(entry)}.`)
        continue
      }
      const resolved = resolveMetricEntry(entry, previous)
      if (resolved.problem) {
        problems.push(`widget ${index}: ${resolved.problem}`)
        continue
      }
      if (resolved.expression !== null) {
        const resolution = classifyExpression(resolved.expression)
        expressions.push({ expression: resolved.expression, resolution })
        if (resolution.kind === "unresolved") {
          problems.push(`widget ${index}: ${resolution.why}`)
        }
        continue
      }
      const values = resolved.values
      if (values === null) continue
      previous = values

      const dimensionTokens = values.slice(2)
      const dimensions: MetricDimension[] = []
      for (let i = 0; i + 1 < dimensionTokens.length; i += 2) {
        dimensions.push({ name: dimensionTokens[i], value: dimensionTokens[i + 1] })
      }
      if (dimensionTokens.length % 2 !== 0) {
        problems.push(
          `widget ${index}: the metric ${values[0]} ${values[1]} carries the dimension name ` +
            `${JSON.stringify(dimensionTokens[dimensionTokens.length - 1])} with no value beside it, so ` +
            `which resource it draws is not stated.`,
        )
      }
      dimensions.sort((a, b) =>
        a.name === b.name
          ? a.value < b.value
            ? -1
            : a.value > b.value
              ? 1
              : 0
          : a.name < b.name
            ? -1
            : 1,
      )
      metrics.push({ namespace: values[0], metricName: values[1], dimensions })
    }
  } else if (rawMetrics !== undefined) {
    problems.push(`widget ${index} carries a \`metrics\` property that is not an array.`)
  }

  /* -- alarms: the alarm widget's own list, and a metric widget's annotations -- */
  const alarmSources: unknown[] = []
  if (Array.isArray(properties.alarms)) alarmSources.push(...properties.alarms)
  const annotations = isPlainObject(properties.annotations) ? properties.annotations : null
  if (annotations && Array.isArray(annotations.alarms)) alarmSources.push(...annotations.alarms)
  for (const candidate of alarmSources) {
    if (typeof candidate !== "string" || !candidate) {
      problems.push(`widget ${index} references an alarm as ${JSON.stringify(candidate)}, which is not an ARN.`)
      continue
    }
    const reference = parseAlarmArn(candidate)
    alarms.push(reference)
    if (reference.name === null) {
      problems.push(
        `widget ${index} references the alarm ${JSON.stringify(candidate)}, which is not shaped like an ` +
          `alarm ARN, so it cannot be joined to the alarms this account actually has.`,
      )
    }
  }

  /* -- log groups -- */
  if (typeof properties.query === "string" && properties.query) {
    const { groups, problem } = logGroupsOfQuery(properties.query)
    logGroups.push(...groups)
    if (problem) problems.push(`widget ${index}: ${problem}`)
  } else if (type === "log") {
    problems.push(`widget ${index} is a log widget with no \`query\`, so the group it reads is not stated.`)
  }

  /* -- a widget that watches nothing at all is a finding, not a silence -- */
  if (
    type === "metric" &&
    metrics.length === 0 &&
    alarms.length === 0 &&
    expressions.length === 0 &&
    problems.length === 0
  ) {
    problems.push(
      `widget ${index} is a metric widget that references no metric, no expression and no alarm. It ` +
        `renders an empty chart, which reads on the console as a healthy flat line.`,
    )
  }

  return { index, type, title, region, accountId, metrics, alarms, logGroups, expressions, problems }
}

/**
 * One dashboard body, from the string AWS returned to what it watches.
 *
 * Exported because it is the whole parsing decision and a surface may want to
 * apply it to a body it already holds. The production path reaches it through
 * `dashboardReadings`, which is what the tests drive.
 */
export function parseDashboardBody(body: string): DashboardContent {
  if (body.length > MAX_BODY_CHARS) {
    return {
      kind: "malformed",
      why:
        `this dashboard's body is ${body.length} characters and this reader parses at most ` +
        `${MAX_BODY_CHARS}. Refused rather than parsed: what it watches is unknown, which is not the ` +
        `same as watching nothing.`,
      excerpt: safeDetail(body.slice(0, 300)),
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch (error) {
    return {
      kind: "malformed",
      why:
        `this dashboard's body is not JSON this reader can parse (${safeDetail(error)}). Nothing ` +
        `validates a dashboard body after PutDashboard accepts it, so this is a state and not a crash — ` +
        `and what this dashboard watches is unknown.`,
      excerpt: safeDetail(body.slice(0, 300)),
    }
  }

  if (!isPlainObject(parsed)) {
    return {
      kind: "malformed",
      why: `this dashboard's body parsed as ${Array.isArray(parsed) ? "an array" : typeof parsed}, not an object.`,
      excerpt: safeDetail(body.slice(0, 300)),
    }
  }

  const rawWidgets = parsed.widgets
  if (rawWidgets === undefined) {
    return {
      kind: "malformed",
      why:
        "this dashboard's body parsed but declares no `widgets` key at all. That is not the same as a " +
        "dashboard with an empty widget list, which is a dashboard somebody emptied.",
      excerpt: safeDetail(body.slice(0, 300)),
    }
  }
  if (!Array.isArray(rawWidgets)) {
    return {
      kind: "malformed",
      why: `this dashboard's body carries a \`widgets\` key that is ${typeof rawWidgets}, not an array.`,
      excerpt: safeDetail(body.slice(0, 300)),
    }
  }

  if (rawWidgets.length === 0) {
    return {
      kind: "watching-nothing",
      why:
        "this dashboard exists and its body declares no widgets. It watches nothing, which is a reading " +
        "an operator should see rather than an empty panel.",
    }
  }

  const unresolved: string[] = []
  const capped = rawWidgets.slice(0, MAX_WIDGETS_PER_DASHBOARD)
  if (rawWidgets.length > MAX_WIDGETS_PER_DASHBOARD) {
    unresolved.push(
      `this body declares ${rawWidgets.length} widgets and this reader parses at most ` +
        `${MAX_WIDGETS_PER_DASHBOARD} (CloudWatch's own documented maximum). The widgets past that are ` +
        `not in the reference sets below.`,
    )
  }

  const widgets = capped.map((widget, index) => parseWidget(widget, index))

  const namespaces: string[] = []
  const alarmNames: string[] = []
  const logGroups: string[] = []
  const regions: string[] = []
  for (const widget of widgets) {
    for (const metric of widget.metrics) namespaces.push(metric.namespace)
    for (const expression of widget.expressions) {
      if (expression.resolution.kind === "search") namespaces.push(...expression.resolution.namespaces)
    }
    for (const alarm of widget.alarms) {
      if (alarm.name !== null) alarmNames.push(alarm.name)
    }
    logGroups.push(...widget.logGroups)
    if (widget.region) regions.push(widget.region)
    unresolved.push(...widget.problems)
  }

  return {
    kind: "watching",
    widgets,
    namespaces: sortedUnique(namespaces),
    alarmNames: sortedUnique(alarmNames),
    logGroups: sortedUnique(logGroups),
    regions: sortedUnique(regions),
    unresolved,
  }
}

/* --------------------------------------------------------------- reading -- */

/** The listing, paginated to the page budget. */
async function listDashboards(
  gw: AwsGateway,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<{ entries: ListedDashboard[]; pagesRead: number; truncated: boolean }>> {
  return readAws(
    LIST,
    async () => {
      const entries: ListedDashboard[] = []
      let token: string | undefined
      let pagesRead = 0
      let truncated = false

      for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
        const response = (await gw.call(LIST, { NextToken: token })) as ListDashboardsResponse
        pagesRead += 1
        for (const entry of response?.DashboardEntries ?? []) {
          if (!entry.DashboardName) continue
          entries.push({
            name: entry.DashboardName,
            arn: entry.DashboardArn ?? null,
            lastModified: asIso(entry.LastModified),
            sizeBytes: typeof entry.Size === "number" && Number.isFinite(entry.Size) ? entry.Size : null,
          })
        }
        token = response?.NextToken || undefined
        if (!token) break
        if (page === MAX_LIST_PAGES - 1) truncated = true
      }

      return { entries, pagesRead, truncated }
    },
    {
      now: options.now,
      denial: options.denial,
      // EMPTY means the listing answered with no dashboards — which is a real,
      // and loud, reading. The page count is not what makes it empty.
      isEmpty: (value) => (value as { entries: ListedDashboard[] }).entries.length === 0,
      ...RETRY,
    },
  )
}

/** One dashboard's body. Its own read, so its refusal is its own row's sentence. */
async function getDashboardBody(
  gw: AwsGateway,
  name: string,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<GetDashboardResponse>> {
  return readAws<GetDashboardResponse>(
    GET,
    async () => (await gw.call(GET, { DashboardName: name })) as GetDashboardResponse,
    {
      now: options.now,
      denial: options.denial,
      // A response object is never "empty" in the sense the union means. A body
      // that is absent or blank is decided below, in words.
      isEmpty: () => false,
      ...RETRY,
    },
  )
}

function attributionFor(
  arn: string | null,
  tagged: AwsRead<readonly TaggedResource[]>,
  index: Map<string, Readonly<Record<string, string>>>,
): DashboardAttribution {
  if (!arn) {
    return {
      kind: "unknown",
      why:
        "cloudwatch:ListDashboards returned this dashboard without an ARN, so there is nothing to join " +
        "against the tag index.",
    }
  }
  if (tagged.state !== "ACTUAL" && tagged.state !== "STALE" && tagged.state !== "EMPTY") {
    return {
      kind: "unknown",
      why: `this dashboard's tags were not read — ${describeRead(tagged, "the tag index")}`,
    }
  }
  const tags = index.get(arn)
  // The tag index answered and this ARN is not in it. The Resource Groups
  // Tagging API returns resources that HAVE tags, so an absence means none —
  // which is `unattributed`, not `shared`.
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
 * Every dashboard, what each one watches, and what could not be established.
 *
 * The production entry point. A route or a page calls it with no gateway and
 * gets `liveGateway()`, which resolves `client.ts` inside the request; a test
 * passes a stand-in gateway to the SAME function, because a test that drove a
 * private helper would stay green on the day the caller stopped calling it.
 */
export async function dashboardReadings(
  supplied?: AwsGateway,
  options: { now?: () => Date; namePrefix?: string } = {},
): Promise<DashboardReadings> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())
  const refreshMs = CAPABILITIES[LIST].refreshMs

  const identity = await resolveIdentity(supplied, { now })
  const denial = denialContextFrom(identity)

  const identityResolved = identity.state === "ACTUAL" || identity.state === "STALE"
  const region = identityResolved ? identity.value.region : null
  const partition = identityResolved ? identity.value.partition : null
  const accountId = identityResolved ? identity.value.accountId : null

  const listing = await listDashboards(gw, { now, denial })
  const asOf = now().toISOString()

  if (listing.state !== "ACTUAL" && listing.state !== "STALE") {
    // Refused, throttled, unconfigured or empty. Each carries no `value`, so
    // there is no branch here that can turn a denial into an array — which is
    // the property `AwsRead` exists to enforce. EMPTY is the one arm that IS a
    // claim: the account has no dashboards, so nothing is watched by one.
    const dashboards: AwsRead<readonly DashboardRow[]> = listing
    return {
      identity,
      tagged: {
        state: "UNCONFIGURED",
        capability: "tag:GetResources",
        why:
          "no dashboard was listed, so the Resource Groups Tagging API was not called — an extra " +
          "request per refresh that would attribute nothing.",
      },
      dashboards,
      coverage:
        listing.state === "EMPTY"
          ? { kind: "complete", namespaces: [], alarmNames: [], logGroups: [] }
          : {
              kind: "not-read",
              why: describeRead(listing, "the dashboards in this account"),
            },
      truncation: { kind: "complete" },
      asOf,
      refreshMs,
    }
  }

  const listed = listing.value.entries
  const wanted =
    options.namePrefix === undefined
      ? listed
      : listed.filter((entry) => entry.name.startsWith(options.namePrefix as string))
  const openedCount = Math.min(wanted.length, MAX_DASHBOARDS_READ)

  const tagged = await taggedResources(supplied, { now, denial })
  const index = tagIndex(tagged.state === "ACTUAL" || tagged.state === "STALE" ? tagged.value : [])

  const rows: DashboardRow[] = []
  for (let position = 0; position < wanted.length; position += 1) {
    const entry = wanted[position]
    const inBudget = position < MAX_DASHBOARDS_READ
    let content: DashboardContent
    if (!inBudget) {
      content = {
        kind: "not-read",
        why:
          `this load opens at most ${MAX_DASHBOARDS_READ} dashboard bodies and ${wanted.length} were ` +
          `listed, so this one was not opened. What it watches is unknown, not nothing.`,
      }
    } else {
      const body = await getDashboardBody(gw, entry.name, { now, denial })
      if (body.state === "ACTUAL" || body.state === "STALE") {
        const raw = body.value.DashboardBody
        content =
          typeof raw === "string" && raw.trim()
            ? parseDashboardBody(raw)
            : {
                kind: "malformed",
                why:
                  "cloudwatch:GetDashboard answered for this dashboard and returned no DashboardBody. " +
                  "A dashboard with no body is not a dashboard watching nothing — it is an answer this " +
                  "reader cannot use.",
                excerpt: "",
              }
      } else {
        // One refused body does not collapse the row to UNKNOWN and does not
        // render as a reassuring default: the row keeps its name, its ARN and
        // its last-modified, and says in words that its coverage is unknown.
        content = { kind: "not-read", why: describeRead(body, `the body of dashboard ${entry.name}`) }
      }
    }

    rows.push({
      name: entry.name,
      arn: entry.arn,
      lastModified: entry.lastModified,
      sizeBytes: entry.sizeBytes,
      content,
      attribution: attributionFor(entry.arn, tagged, index),
      region,
      partition,
      accountId,
      refreshMs,
      asOf,
    })
  }

  const truncation: Truncation =
    listing.value.truncated || wanted.length > openedCount
      ? {
          kind: "more-available",
          why:
            `this load read ${listing.value.pagesRead} listing page(s) (cap ${MAX_LIST_PAGES}) and opened ` +
            `${openedCount} of ${wanted.length} dashboard body(ies) (cap ${MAX_DASHBOARDS_READ}). What ` +
            `is below is not the whole account.`,
          pagesRead: listing.value.pagesRead,
          listed: wanted.length,
          opened: openedCount,
        }
      : { kind: "complete" }

  const dashboards: AwsRead<readonly DashboardRow[]> =
    rows.length === 0
      ? { state: "EMPTY", capability: LIST, asOf }
      : { state: "ACTUAL", capability: LIST, value: rows, asOf, fresh: true }

  return {
    identity,
    tagged,
    dashboards,
    coverage: coverageOf(dashboards, truncation),
    truncation,
    asOf,
    refreshMs,
  }
}

/**
 * What the dashboards collectively watch, and whether that is the whole answer.
 *
 * Exported so a surface holding rows from elsewhere gets the same arithmetic.
 * The `partial` arm is not a nicety: the consumer computes a set difference, and
 * a difference against an incomplete set reports services as unwatched when they
 * are merely on a dashboard nobody could open.
 */
export function coverageOf(
  dashboards: AwsRead<readonly DashboardRow[]>,
  truncation: Truncation = { kind: "complete" },
): DashboardCoverage {
  if (dashboards.state === "EMPTY") {
    // A genuine, and loud, claim: there are no dashboards, so nothing is on one.
    return { kind: "complete", namespaces: [], alarmNames: [], logGroups: [] }
  }
  if (dashboards.state !== "ACTUAL" && dashboards.state !== "STALE") {
    return { kind: "not-read", why: describeRead(dashboards, "the dashboards in this account") }
  }

  const namespaces: string[] = []
  const alarmNames: string[] = []
  const logGroups: string[] = []
  const incomplete: string[] = []
  const reasons: string[] = []

  for (const row of dashboards.value) {
    switch (row.content.kind) {
      case "watching":
        namespaces.push(...row.content.namespaces)
        alarmNames.push(...row.content.alarmNames)
        logGroups.push(...row.content.logGroups)
        if (row.content.unresolved.length > 0) {
          incomplete.push(row.name)
          reasons.push(`${row.name}: ${row.content.unresolved.length} reference(s) this reader could not resolve`)
        }
        break
      case "watching-nothing":
        break
      case "malformed":
        incomplete.push(row.name)
        reasons.push(`${row.name}: its body is malformed, so what it watches is unknown`)
        break
      case "not-read":
        incomplete.push(row.name)
        reasons.push(`${row.name}: its body was not read`)
        break
    }
  }

  if (truncation.kind === "more-available") {
    reasons.push(truncation.why)
  }

  const sets = {
    namespaces: sortedUnique(namespaces),
    alarmNames: sortedUnique(alarmNames),
    logGroups: sortedUnique(logGroups),
  }

  if (reasons.length === 0) return { kind: "complete", ...sets }
  return {
    kind: "partial",
    ...sets,
    incompleteDashboards: sortedUnique(incomplete),
    why:
      `this coverage set is INCOMPLETE, so "on no dashboard" is not a finding this load can make: ` +
      `${reasons.join("; ")}.`,
  }
}

/**
 * Which of the given namespaces appear on no dashboard — and a refusal to say so
 * when the coverage set is not whole.
 *
 * The estate's namespaces come from the inventory, which this module does not
 * hold; the caller supplies them. That keeps the set difference in one place
 * without this module reaching for a second source of truth about what exists.
 */
export function unwatchedNamespaces(
  coverage: DashboardCoverage,
  candidates: readonly string[],
): UnwatchedNamespaces {
  if (coverage.kind === "not-read") {
    return {
      kind: "undecidable",
      why: `the dashboards were not read, so nothing can be said about what is on one — ${coverage.why}`,
      notOnAnyDashboardRead: sortedUnique(candidates),
    }
  }
  const watched = new Set(coverage.namespaces)
  const missing = sortedUnique(candidates.filter((namespace) => !watched.has(namespace)))
  if (coverage.kind === "partial") {
    return {
      kind: "undecidable",
      why: coverage.why,
      notOnAnyDashboardRead: missing,
    }
  }
  return { kind: "decidable", namespaces: missing }
}

/* ------------------------------------------------------------- rendering -- */

/** The sentence a surface prints for one dashboard's body. */
export function describeContent(content: DashboardContent): string {
  switch (content.kind) {
    case "watching":
      return (
        `watching ${content.widgets.length} widget(s) — ` +
        `namespaces: ${content.namespaces.length > 0 ? content.namespaces.join(", ") : "none"} · ` +
        `alarms: ${content.alarmNames.length > 0 ? content.alarmNames.join(", ") : "none"} · ` +
        `log groups: ${content.logGroups.length > 0 ? content.logGroups.join(", ") : "none"}` +
        (content.regions.length > 0 ? ` · widget regions: ${content.regions.join(", ")}` : "") +
        (content.unresolved.length > 0
          ? ` · INCOMPLETE: ${content.unresolved.join(" | ")}`
          : "")
      )
    case "watching-nothing":
      return `watches nothing — ${content.why}`
    case "malformed":
      return `unknown — ${content.why}${content.excerpt ? ` Body begins: ${content.excerpt}` : ""}`
    case "not-read":
      return `unknown — ${content.why}`
  }
}

/** The sentence a surface prints for one dashboard's attribution. */
export function describeDashboardAttribution(attribution: DashboardAttribution): string {
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

/** The sentence a surface prints for one dashboard. */
export function describeDashboard(row: DashboardRow): string {
  const where =
    row.region && row.partition
      ? `${row.region} (partition ${row.partition})`
      : "region unknown — identity is unresolved"
  const modified = row.lastModified
    ? `last modified ${row.lastModified}`
    : "last modified unknown — the listing carried no parseable timestamp"
  const size = row.sizeBytes === null ? "" : ` · ${row.sizeBytes} byte(s)`
  return (
    `${row.name} — ${where} — ${modified}${size} — ` +
    `${describeDashboardAttribution(row.attribution)} — ${describeContent(row.content)} · ` +
    `as of ${row.asOf}, refreshed every ${Math.round(row.refreshMs / 1000)}s`
  )
}

/** The sentence a surface prints for the coverage set. */
export function describeCoverage(coverage: DashboardCoverage): string {
  switch (coverage.kind) {
    case "complete":
      return (
        `complete — every dashboard body was read and parsed. Watched namespaces: ` +
        `${coverage.namespaces.length > 0 ? coverage.namespaces.join(", ") : "none"}. ` +
        `Alarms shown: ${coverage.alarmNames.length > 0 ? coverage.alarmNames.join(", ") : "none"}.`
      )
    case "partial":
      return (
        `PARTIAL — ${coverage.why} Read so far: ` +
        `${coverage.namespaces.length > 0 ? coverage.namespaces.join(", ") : "none"}. ` +
        `Incomplete: ${coverage.incompleteDashboards.join(", ")}.`
      )
    case "not-read":
      return `unknown — ${coverage.why}`
  }
}

/** The sentence a surface prints for the load's own bounds. */
export function describeTruncation(truncation: Truncation): string {
  switch (truncation.kind) {
    case "complete":
      return "complete — the listing ran out of dashboards before this load ran out of budget"
    case "more-available":
      return `TRUNCATED — ${truncation.why}`
  }
}

export interface DashboardLine {
  label: string
  text: string
}

/**
 * What a dashboard surface prints.
 *
 * The route agent renders exactly these strings, and the tests assert on them —
 * which is what makes the mutation proofs land on the production path rather
 * than on a helper nothing calls.
 */
export function dashboardLines(readings: DashboardReadings): readonly DashboardLine[] {
  const lines: DashboardLine[] = [
    {
      label: "Dashboards",
      text: describeRead(
        readings.dashboards,
        `the CloudWatch dashboards in this account, refreshed every ` +
          `${Math.round(readings.refreshMs / 1000)}s`,
      ),
    },
    { label: "Coverage", text: describeCoverage(readings.coverage) },
    { label: "Completeness", text: describeTruncation(readings.truncation) },
  ]
  if (readings.dashboards.state === "ACTUAL" || readings.dashboards.state === "STALE") {
    for (const row of readings.dashboards.value) {
      lines.push({ label: row.name, text: describeDashboard(row) })
    }
  }
  return lines
}
