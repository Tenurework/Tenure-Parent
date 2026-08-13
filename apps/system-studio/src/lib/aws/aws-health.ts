/**
 * STUDIO-070-004 / STUDIO-000-007 — "is it us, or is it AWS".
 *
 * That is the first question of every incident, and until this module the
 * console could not answer it at all. `/platform/health` renders CloudWatch
 * alarms, which describe THIS estate's symptoms; nothing in the running product
 * had ever asked AWS whether AWS itself was having an event. So a firing alarm
 * and an AWS-side networking issue in the region the estate runs in looked
 * identical from the console, and the first twenty minutes of an incident went
 * into re-reading our own deploys.
 *
 * ## Four things this module refuses to do
 *
 * **It never renders a refusal as calm.** Every call goes through `readAws`, so
 * a refused `health:DescribeEvents` arrives as `DENIED` carrying the principal,
 * the action and a pasteable minimum statement, and the surface leads with
 * "unknown". An empty list here would read as "AWS is fine", which is the single
 * most expensive wrong sentence this page could print during an outage.
 *
 * **It never renders "no support plan" as "no events".** The Health API is only
 * available on Business, Enterprise On-Ramp and Enterprise Support. On anything
 * less it raises `SubscriptionRequiredException`, which `read.ts` maps to
 * UNCONFIGURED with the plan named. No IAM statement fixes that, so rendering
 * the minimum statement would send an operator to edit a policy that is already
 * correct; and no absence of events is implied by it, so rendering EMPTY would
 * be a claim nobody made.
 *
 * **It never decides "that event is somewhere else" from a literal region.** The
 * comparison is against the region STS resolved for this process
 * (`identity.ts`), and when identity could not be read the verdict is
 * `OPEN_REGION_UNKNOWN` rather than a guess. A hardcoded `us-east-1` here is
 * GE-010-007 — the residency defect — wearing a different hat: an estate in
 * eu-west-1 would have been told that every eu-west-1 event was "another
 * region's problem".
 *
 * **It never says an event touches nothing when it was not allowed to look.**
 * The affected entities come from a SECOND IAM action
 * (`health:DescribeAffectedEntities`), so events can be readable while entities
 * are not. That partial state is carried explicitly — `entitiesKnown: false`
 * with a sentence naming the action that was refused — instead of an empty
 * entity list that reads as "none of our resources are involved".
 *
 * ## Attribution
 *
 * An affected entity is joined against the Resource Groups Tagging API index
 * (`tags.ts`), which is the one place this console decides who owns a resource.
 * The Health entity's own `tags` map is what AWS recorded when the event was
 * raised; the tagging index is what is true now, so the index wins where it has
 * an answer and the entity's map is the fallback for a resource the index does
 * not carry.
 *
 * The three-armed `Attribution` from `tags.ts` is kept as-is, deliberately:
 * `shared` means somebody set `tenure:tenant = tenure:shared`, and
 * `unattributed` means nobody tagged it at all. Folding the second into the
 * first — "no tag, therefore shared" — is exactly the fold `tags.ts` was
 * rewritten to prevent, and during an incident it is the difference between
 * "this is platform overhead" and "nobody knows whose this is".
 *
 * ## No `@aws-sdk` import
 *
 * Every call goes through the `AwsGateway` seam declared in `read.ts`, so this
 * module loads — and is proven — outside a server component, and
 * `tests/architecture/forbidden-clients.test.mjs` keeps the one client where it
 * is. Response shapes are declared here rather than imported for the same
 * reason `identity.ts` declares its own.
 */

import { AWS_HEALTH_TTL_MS } from "./capabilities"
import { denialContextFrom, resolveIdentity, type Identity } from "./identity"
import {
  describeRead,
  liveGateway,
  readAws,
  type AwsGateway,
  type AwsRead,
} from "./read"
import {
  attributionOf,
  describeAttribution,
  tagIndex,
  taggedResources,
  type Attribution,
  type TaggedResource,
} from "./tags"

/* ---------------------------------------------------------- the verdicts -- */

export const HEALTH_VERDICTS = [
  /** AWS says this event touches resources in THIS account. The loudest arm. */
  "AFFECTING_US",
  /** Scheduled, not yet started — a retirement or a mandatory upgrade window. */
  "UPCOMING",
  /** An account notification: AWS telling us something, not an impairment. */
  "NOTIFICATION",
  /** Public event, in the region this process resolved for itself. */
  "OPEN_IN_OUR_REGION",
  /** Public event, in a region this account did not resolve to. Informational. */
  "OPEN_ELSEWHERE",
  /** Public event, and we could not resolve our own region, so we do not know. */
  "OPEN_REGION_UNKNOWN",
  /** The call was refused. The whole surface, never a short list. */
  "UNAUTHORIZED",
] as const

export type HealthVerdict = (typeof HEALTH_VERDICTS)[number]

/** A word per verdict. Bible §26.3.2: never colour alone. */
export const HEALTH_WORDS: Readonly<Record<HealthVerdict, string>> = {
  AFFECTING_US: "Our resources",
  UPCOMING: "Scheduled",
  NOTIFICATION: "Notice",
  OPEN_IN_OUR_REGION: "Our region",
  OPEN_ELSEWHERE: "Another region",
  OPEN_REGION_UNKNOWN: "Region unknown",
  UNAUTHORIZED: "Unknown",
}

/* ------------------------------------------------------------- the shapes -- */

export interface AffectedEntityRow {
  /** The event this entity was returned for. */
  eventArn: string
  /** AWS Health's own ARN for the entity record, when it gave one. */
  entityArn: string | null
  /** The resource itself — an ARN, or an id like `i-0abc` when it is not one. */
  entityValue: string
  /** `IMPAIRED` / `UNIMPAIRED` / `UNKNOWN` / `PENDING` / `RESOLVED`. AWS's word. */
  statusCode: string
  lastUpdatedTime: string | null
  /** The tagging index's tags where it has them, the event's own map otherwise. */
  tags: Readonly<Record<string, string>>
  attribution: Attribution
  /** The sentence a surface prints for the attribution. One renderer, in tags.ts. */
  attributionText: string
}

export interface HealthEventRow {
  arn: string
  /** `EC2`, `RDS`, `MULTIPLE_SERVICES` — AWS's service code, not normalised. */
  service: string
  eventTypeCode: string
  /** `issue` / `accountNotification` / `scheduledChange` / `investigation`. */
  category: string
  /** The event's region, or `global` when it names none. */
  region: string
  availabilityZone: string | null
  /** `open` / `upcoming`. Closed events are not asked for — see client.ts. */
  statusCode: string
  /** `ACCOUNT_SPECIFIC` / `PUBLIC` / `NONE`. Decides AFFECTING_US. */
  scope: string
  startTime: string | null
  endTime: string | null
  lastUpdatedTime: string | null
  verdict: HealthVerdict
  /** The sentence the table prints; carries the times the verdict turned on. */
  detail: string
  /** Entities AWS named for this event, attributed. Empty when not readable. */
  entities: readonly AffectedEntityRow[]
  /**
   * Whether the entity read answered for this event.
   *
   * False is not "no entities" — it is "we were not allowed to ask, or the ask
   * failed". A row rendering `entities.length` without consulting this would
   * print "0 affected resources" about an event nobody looked into.
   */
  entitiesKnown: boolean
  /** What to print instead of a count when `entitiesKnown` is false. */
  entitiesDetail: string
  /** Distinct tenant slugs among the entities that ARE known. */
  tenants: readonly string[]
}

export interface AwsHealthSurface {
  identity: AwsRead<Identity>
  /** The events read. DENIED / UNCONFIGURED / THROTTLED are all distinct here. */
  events: AwsRead<readonly HealthEventRow[]>
  /** The second action's read. Its own state, because it is its own grant. */
  entities: AwsRead<readonly AffectedEntityRow[]>
  /** The tag index the attribution was joined against. */
  tagged: AwsRead<readonly TaggedResource[]>
  /** Never `[]` on a denial — one UNAUTHORIZED row, so absence cannot be read. */
  rows: readonly HealthEventRow[]
  /** The sentence the page leads with. One funnel, so denial cannot read as calm. */
  headline: string
  /** The second sentence: what is known about which of OUR resources are hit. */
  entityHeadline: string
  /** Resolved, never assumed. Null when identity could not be read. */
  accountId: string | null
  region: string | null
  partition: string | null
  /** The explicit "as of". Every surface in this directory carries one. */
  asOf: string
  /** This capability's own cadence, from the registry — not a page's guess. */
  refreshMs: number
}

/* ------------------------------------------------------- the API's shapes -- */

/**
 * Declared, not imported. The Health API models its members in lowerCamelCase
 * — `events`, `arn`, `eventTypeCode` — unlike most of the services this console
 * reads, and a shape copied from a neighbouring module would silently read
 * `undefined` from every field.
 */
interface DescribeEventsResponse {
  events?: RawEvent[]
  nextToken?: string
}

interface RawEvent {
  arn?: string
  service?: string
  eventTypeCode?: string
  eventTypeCategory?: string
  region?: string
  availabilityZone?: string
  startTime?: string | Date
  endTime?: string | Date
  lastUpdatedTime?: string | Date
  statusCode?: string
  eventScopeCode?: string
}

interface DescribeAffectedEntitiesResponse {
  entities?: RawEntity[]
  nextToken?: string
}

interface RawEntity {
  entityArn?: string
  eventArn?: string
  entityValue?: string
  awsAccountId?: string
  lastUpdatedTime?: string | Date
  statusCode?: string
  tags?: Record<string, string>
}

/* ------------------------------------------------------------- utilities -- */

/** A timestamp as ISO, or null. Never a partially-parsed date rendered as NaN. */
function iso(value: string | Date | undefined): string | null {
  if (!value) return null
  const time = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

/** How many pages to walk before giving up. A runaway page loop is an outage. */
const MAX_PAGES = 20

/**
 * How many event ARNs one `DescribeAffectedEntities` filter accepts.
 *
 * Ten is the API's own maximum, not a batch size chosen for tidiness: a filter
 * with eleven ARNs is rejected outright, so a fleet with eleven open events
 * would have produced a ValidationException rendered as ERROR — "the entity
 * read is broken" — for what is really a paging rule.
 */
const MAX_EVENT_ARNS_PER_FILTER = 10

export function chunkEventArns(
  arns: readonly string[],
  size: number = MAX_EVENT_ARNS_PER_FILTER,
): readonly (readonly string[])[] {
  const out: string[][] = []
  for (let i = 0; i < arns.length; i += size) out.push(arns.slice(i, i + size))
  return out
}

/**
 * The ARN a tag index can be keyed by, for one entity.
 *
 * `entityValue` is the resource identifier and is an ARN for most services;
 * `entityArn` is AWS Health's own record. Preferring the value is what makes the
 * join work at all — the health record's ARN is never in the tagging index.
 * Returns null rather than passing `i-0abc` to a map of ARNs, so a miss is a
 * miss and not a lookup that happened to fail.
 */
export function taggableArnOf(entity: { entityValue?: string; entityArn?: string }): string | null {
  const value = entity.entityValue ?? ""
  if (value.startsWith("arn:")) return value
  const arn = entity.entityArn ?? ""
  return arn.startsWith("arn:") ? arn : null
}

/* -------------------------------------------------------------- verdicts -- */

/**
 * One event's verdict.
 *
 * Order is the argument.
 *
 *   * `ACCOUNT_SPECIFIC` + open outranks everything: AWS has already told us
 *     this touches resources in this account, and no region comparison can
 *     improve on that.
 *   * `upcoming` outranks the region arms: a scheduled retirement in another
 *     region is still an action somebody has to take.
 *   * The region comparison is LAST, and it is against `ourRegion`, which is
 *     STS's answer. `null` means identity did not answer, and the verdict says
 *     so rather than assuming the event is somebody else's problem.
 */
export function verdictFor(
  event: RawEvent,
  options: { ourRegion: string | null; now: Date },
): { verdict: HealthVerdict; detail: string } {
  const scope = event.eventScopeCode ?? "NONE"
  const status = (event.statusCode ?? "").toLowerCase()
  const category = event.eventTypeCategory ?? "unknown"
  const region = event.region ?? "global"
  const started = iso(event.startTime)
  const ends = iso(event.endTime)

  if (scope === "ACCOUNT_SPECIFIC" && status === "open") {
    return {
      verdict: "AFFECTING_US",
      detail:
        `AWS reports this event as account-specific and open — it names resources in THIS account. ` +
        `Started ${started ?? "at an unknown time"}${ends ? `, expected to end ${ends}` : ", with no end time given"}.`,
    }
  }

  if (status === "upcoming") {
    const hours =
      started === null
        ? null
        : Math.round((Date.parse(started) - options.now.getTime()) / 3_600_000)
    return {
      verdict: "UPCOMING",
      detail:
        `scheduled, not started — ${category} in ${region}, beginning ${started ?? "at an unstated time"}` +
        `${hours === null ? "" : ` (${hours} hour(s) from this reading)`}. ` +
        `${scope === "ACCOUNT_SPECIFIC" ? "Account-specific: this one is ours to act on." : "Public: AWS-wide, not raised against this account."}`,
    }
  }

  if (category === "accountNotification") {
    return {
      verdict: "NOTIFICATION",
      detail: `an account notification from AWS about ${event.service ?? "an unnamed service"} in ${region}. Not an impairment.`,
    }
  }

  if (region === "global") {
    return {
      verdict: "OPEN_IN_OUR_REGION",
      detail: `open, and global — AWS did not scope it to a region, so it is not ruled out for this estate.`,
    }
  }

  if (options.ourRegion === null) {
    return {
      verdict: "OPEN_REGION_UNKNOWN",
      detail:
        `open in ${region}. Whether that is this estate's region is UNKNOWN — sts:GetCallerIdentity has not ` +
        `answered, so there is nothing to compare against. This is not a claim that the event is elsewhere.`,
    }
  }

  if (region === options.ourRegion) {
    return {
      verdict: "OPEN_IN_OUR_REGION",
      detail: `open in ${region}, which is the region this process resolved for itself.`,
    }
  }

  return {
    verdict: "OPEN_ELSEWHERE",
    detail:
      `open in ${region}; this process resolved ${options.ourRegion}. Informational — it is still worth ` +
      `reading if anything this estate depends on is cross-region.`,
  }
}

/* ---------------------------------------------------------------- reads -- */

interface ReadContext {
  now: () => Date
  denial: ReturnType<typeof denialContextFrom>
  ourRegion: string | null
  attempts?: number
  sleep?: (ms: number) => Promise<void>
}

async function readEvents(
  gw: AwsGateway,
  ctx: ReadContext,
): Promise<AwsRead<readonly HealthEventRow[]>> {
  return readAws<readonly HealthEventRow[]>(
    "health:DescribeEvents",
    async () => {
      const rows: HealthEventRow[] = []
      let token: string | undefined
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const response = (await gw.call("health:DescribeEvents", {
          nextToken: token,
        })) as DescribeEventsResponse

        for (const event of response?.events ?? []) {
          if (!event.arn) continue
          const { verdict, detail } = verdictFor(event, {
            ourRegion: ctx.ourRegion,
            now: ctx.now(),
          })
          rows.push({
            arn: event.arn,
            service: event.service ?? "unnamed service",
            eventTypeCode: event.eventTypeCode ?? "unnamed event type",
            category: event.eventTypeCategory ?? "unknown",
            region: event.region ?? "global",
            availabilityZone: event.availabilityZone ?? null,
            statusCode: event.statusCode ?? "unknown",
            scope: event.eventScopeCode ?? "NONE",
            startTime: iso(event.startTime),
            endTime: iso(event.endTime),
            lastUpdatedTime: iso(event.lastUpdatedTime),
            verdict,
            detail,
            // Filled in by the entity read, which is a separate grant and
            // therefore a separate answer. Defaulted to "not known" rather
            // than to "none": the two are the whole point of this module.
            entities: [],
            entitiesKnown: false,
            entitiesDetail: "affected resources have not been read yet",
            tenants: [],
          })
        }

        token = response?.nextToken || undefined
        if (!token) break
      }
      return rows
    },
    { now: ctx.now, denial: ctx.denial, attempts: ctx.attempts, sleep: ctx.sleep },
  )
}

async function readEntities(
  gw: AwsGateway,
  ctx: ReadContext,
  events: AwsRead<readonly HealthEventRow[]>,
  tags: Map<string, Readonly<Record<string, string>>>,
): Promise<AwsRead<readonly AffectedEntityRow[]>> {
  // The call is never made when there is nothing to ask about, and UNCONFIGURED
  // says exactly that. EMPTY here would claim AWS answered "no affected
  // entities", which nobody asked it. UNCONFIGURED is `isUnknown`, so it reaches
  // the surface as an unknown rather than as an absence.
  if (events.state !== "ACTUAL" && events.state !== "STALE") {
    return {
      state: "UNCONFIGURED",
      capability: "health:DescribeAffectedEntities",
      // The subject is spelled inside `why` because `describeRead` renders
      // UNCONFIGURED as "not configured — <why>" and drops its label.
      why:
        `the resources affected by AWS Health events were not read — the events they are ` +
        `enumerated from ${events.state === "EMPTY" ? "came back empty, so there is nothing to ask about" : "could not be read"}. ` +
        describeRead(events, "AWS Health events"),
    }
  }

  const eventArns = events.value.map((row) => row.arn)

  return readAws<readonly AffectedEntityRow[]>(
    "health:DescribeAffectedEntities",
    async () => {
      const out: AffectedEntityRow[] = []
      for (const chunk of chunkEventArns(eventArns)) {
        let token: string | undefined
        for (let page = 0; page < MAX_PAGES; page += 1) {
          const response = (await gw.call("health:DescribeAffectedEntities", {
            eventArns: [...chunk],
            nextToken: token,
          })) as DescribeAffectedEntitiesResponse

          for (const entity of response?.entities ?? []) {
            if (!entity.eventArn) continue
            const arn = taggableArnOf(entity)
            const indexed = arn ? tags.get(arn) : undefined
            // The index wins where it has an answer: the event's own tag map is
            // what AWS recorded when the event was raised, and ownership today
            // is who gets called today.
            const merged: Record<string, string> = { ...(entity.tags ?? {}), ...(indexed ?? {}) }
            const attribution = attributionOf(merged)
            out.push({
              eventArn: entity.eventArn,
              entityArn: entity.entityArn ?? null,
              entityValue: entity.entityValue ?? entity.entityArn ?? "unnamed entity",
              statusCode: entity.statusCode ?? "UNKNOWN",
              lastUpdatedTime: iso(entity.lastUpdatedTime),
              tags: merged,
              attribution,
              attributionText: describeAttribution(attribution),
            })
          }

          token = response?.nextToken || undefined
          if (!token) break
        }
      }
      return out
    },
    { now: ctx.now, denial: ctx.denial, attempts: ctx.attempts, sleep: ctx.sleep },
  )
}

/* -------------------------------------------------------------- surface -- */

export interface AwsHealthOptions {
  now?: () => Date
  /** Attempts before a throttle is reported. Passed to `readAws`. */
  attempts?: number
  /** Injected so a throttle case is instant under test rather than a real wait. */
  sleep?: (ms: number) => Promise<void>
  /** Supplied by a caller that already read identity, so it is read once a page. */
  identity?: AwsRead<Identity>
  /** Supplied by a caller that already read the tag index, for the same reason. */
  tagged?: AwsRead<readonly TaggedResource[]>
}

/**
 * Open and upcoming AWS Health events, attributed to this estate.
 *
 * The production path passes no gateway: `liveGateway()` resolves `client.ts`
 * on first call, which is the only module in this app holding a Health client.
 */
export async function awsHealthSurface(
  supplied?: AwsGateway,
  options: AwsHealthOptions = {},
): Promise<AwsHealthSurface> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())

  const identity = options.identity ?? (await resolveIdentity(supplied, { now }))
  const denial = denialContextFrom(identity)
  const resolved = identity.state === "ACTUAL" || identity.state === "STALE" ? identity.value : null

  const ctx: ReadContext = {
    now,
    denial,
    // STS's answer, or null. Never a literal, and never a default: an estate in
    // eu-west-1 compared against a hardcoded us-east-1 is GE-010-007.
    ourRegion: resolved?.region ?? null,
    attempts: options.attempts,
    sleep: options.sleep,
  }

  const events = await readEvents(gw, ctx)

  // The tag index is only worth a call once there is something to attribute.
  // Skipping it is a decision, so it is recorded as one rather than as an empty
  // index that would silently make every entity "unattributed".
  const tagged: AwsRead<readonly TaggedResource[]> =
    events.state === "ACTUAL" || events.state === "STALE"
      ? (options.tagged ?? (await taggedResources(supplied, { now, denial })))
      : {
          state: "UNCONFIGURED",
          capability: "tag:GetResources",
          why:
            `the tag index was not read — there are no AWS Health events to attribute. ` +
            describeRead(events, "AWS Health events"),
        }

  const entities = await readEntities(
    gw,
    ctx,
    events,
    tagIndex(tagged.state === "ACTUAL" || tagged.state === "STALE" ? tagged.value : []),
  )

  const asOf = now().toISOString()
  const rows = composeRows(events, entities, tagged)

  return {
    identity,
    events,
    entities,
    tagged,
    rows,
    headline: headlineFor(events, rows, asOf, resolved),
    entityHeadline: entityHeadlineFor(events, entities, tagged, rows),
    accountId: resolved?.accountId ?? null,
    region: resolved?.region ?? null,
    partition: resolved?.partition ?? null,
    asOf,
    refreshMs: AWS_HEALTH_TTL_MS,
  }
}

/**
 * Rows, with the entity read folded in.
 *
 * A denial produces ONE row saying the surface is unauthorized, not `[]`. The
 * page renders that row; an empty array would render an empty table, which is
 * the sentence "AWS is having no events" written in whitespace.
 */
function composeRows(
  events: AwsRead<readonly HealthEventRow[]>,
  entities: AwsRead<readonly AffectedEntityRow[]>,
  tagged: AwsRead<readonly TaggedResource[]>,
): readonly HealthEventRow[] {
  if (events.state === "DENIED") {
    return [
      {
        arn: "every AWS Health event for this account",
        service: "health",
        eventTypeCode: events.action,
        category: "unreadable",
        region: events.region ?? "unknown",
        availabilityZone: null,
        statusCode: "unknown",
        scope: "NONE",
        startTime: null,
        endTime: null,
        lastUpdatedTime: null,
        verdict: "UNAUTHORIZED",
        detail:
          `this engine's role was refused ${events.action} (${events.errorCode}) as ${events.principal}. ` +
          `Minimum statement: ${events.minimumStatement}`,
        entities: [],
        entitiesKnown: false,
        entitiesDetail: "unknown — the events themselves could not be read",
        tenants: [],
      },
    ]
  }

  if (events.state !== "ACTUAL" && events.state !== "STALE") return []

  const known = entities.state === "ACTUAL" || entities.state === "STALE"
  const byEvent = new Map<string, AffectedEntityRow[]>()
  if (known) {
    for (const entity of entities.value) {
      const list = byEvent.get(entity.eventArn)
      if (list) list.push(entity)
      else byEvent.set(entity.eventArn, [entity])
    }
  }

  // An EMPTY entity read is a real answer — AWS named no entities — and is the
  // only non-ACTUAL state that may render as a count rather than as an unknown.
  const answered = known || entities.state === "EMPTY"
  // The tag index did not answer. Attribution then rests on whatever tags AWS
  // Health carried on the entity itself, which is a weaker fact, and the row
  // says so instead of presenting the two as the same reading.
  const tagIndexUnknown =
    tagged.state !== "ACTUAL" && tagged.state !== "STALE" && tagged.state !== "EMPTY"

  return events.value.map((row) => {
    const mine = byEvent.get(row.arn) ?? []
    const tenants = [
      ...new Set(
        mine
          .map((e) => (e.attribution.kind === "tenant" ? e.attribution.tenantSlug : null))
          .filter((slug): slug is string => slug !== null),
      ),
    ].sort()
    return {
      ...row,
      entities: mine,
      entitiesKnown: answered,
      entitiesDetail: answered
        ? `${mine.length} affected resource(s) in this account` +
          (mine.length === 0
            ? " — AWS named none for this event"
            : `; ${tenants.length === 0 ? "no tenant tag on any of them" : `tenant(s): ${tenants.join(", ")}`}`) +
          (tagIndexUnknown
            ? ` (attribution is from the event's own tags only — ${describeRead(tagged, "the tag index")})`
            : "")
        : `unknown — ${describeRead(entities, "affected resources")}`,
      tenants,
    }
  })
}

/**
 * The sentence the page leads with.
 *
 * One funnel, for the reason `describeRead` is one funnel: a denial must not be
 * worded as an absence on one surface and correctly on another. Each arm
 * produces provably different text — the DENIED arm contains the action and the
 * minimum statement, the EMPTY arm contains the word "none" and neither of
 * those, the THROTTLED arm names a retry, and the UNCONFIGURED arm names the
 * support plan.
 */
function headlineFor(
  events: AwsRead<readonly HealthEventRow[]>,
  rows: readonly HealthEventRow[],
  asOf: string,
  identity: Identity | null,
): string {
  const where = identity
    ? `account ${identity.accountId}, region ${identity.region}, partition ${identity.partition}`
    : "an account this engine could not resolve (sts:GetCallerIdentity has not answered)"

  switch (events.state) {
    case "ACTUAL":
    case "STALE": {
      const counts = HEALTH_VERDICTS.map(
        (v) => [v, rows.filter((r) => r.verdict === v).length] as const,
      ).filter(([, n]) => n > 0)
      return (
        `${rows.length} open or upcoming AWS Health event(s) for ${where}, as of ${asOf} — ` +
        counts.map(([v, n]) => `${n} ${HEALTH_WORDS[v]}`).join(", ")
      )
    }
    case "EMPTY":
      return (
        `none — AWS Health answered with no open or upcoming events for ${where}, as of ${asOf}. ` +
        `That is AWS's answer, not an absence of permission.`
      )
    case "DENIED":
      return (
        `unknown — AWS Health could not be read: ${events.action} was refused (${events.errorCode}) ` +
        `as ${events.principal}. This is NOT "AWS is healthy". ` +
        `Minimum statement: ${events.minimumStatement}`
      )
    case "THROTTLED":
      return (
        `throttled — AWS rate-limited health:DescribeEvents; retrying in ${events.retryAfterMs}ms, ` +
        `as of ${events.asOf}. Nothing is known about AWS-side events until it answers.`
      )
    case "UNCONFIGURED":
      return (
        `unknown — this account cannot be asked whether AWS is having an incident: ${events.why} ` +
        `Remedy: raise this account's AWS Support plan to Business or higher, or accept that ` +
        `"is it us or is it AWS" has no answer on this surface.`
      )
    case "ERROR":
      return `error — health:DescribeEvents failed (${events.code}): ${events.safeDetail}`
  }
}

/** The second sentence: what is known about which of OUR resources are hit. */
function entityHeadlineFor(
  events: AwsRead<readonly HealthEventRow[]>,
  entities: AwsRead<readonly AffectedEntityRow[]>,
  tagged: AwsRead<readonly TaggedResource[]>,
  rows: readonly HealthEventRow[],
): string {
  if (events.state === "DENIED") {
    return `unknown — the events were refused, so nothing was asked about affected resources.`
  }
  // Not "unknown". AWS answered that there are no open or upcoming events, so
  // there is nothing an affected-entity call could be made about, and saying
  // "unknown" here would manufacture doubt out of a clean answer.
  if (events.state === "EMPTY") {
    return `no open or upcoming events, so no resources in this account are affected by one.`
  }
  if (entities.state === "DENIED") {
    return (
      `${rows.length} event(s) are readable, but WHICH of this account's resources they touch is unknown — ` +
      `${entities.action} was refused (${entities.errorCode}) as ${entities.principal}. ` +
      `Minimum statement: ${entities.minimumStatement}`
    )
  }
  if (entities.state === "THROTTLED") {
    return (
      `${rows.length} event(s) are readable; affected resources are unknown — AWS rate-limited ` +
      `${entities.capability}, retrying in ${entities.retryAfterMs}ms.`
    )
  }
  if (entities.state === "UNCONFIGURED" || entities.state === "ERROR") {
    return `affected resources are unknown — ${describeRead(entities, "affected resources")}`
  }

  const all = rows.flatMap((r) => r.entities)
  const tenants = [...new Set(rows.flatMap((r) => r.tenants))].sort()
  const untagged = all.filter((e) => e.attribution.kind === "unattributed").length
  const shared = all.filter((e) => e.attribution.kind === "shared").length
  const tagNote =
    tagged.state === "ACTUAL" || tagged.state === "STALE" || tagged.state === "EMPTY"
      ? ""
      : ` Attribution used only the tags AWS Health carried on each entity — ${describeRead(tagged, "the tag index")}`

  if (all.length === 0) {
    return `AWS Health named no resources in this account for these event(s).${tagNote}`
  }
  return (
    `${all.length} resource(s) in this account named across ${rows.length} event(s) — ` +
    `${tenants.length} tenant(s)${tenants.length ? ` (${tenants.join(", ")})` : ""}, ` +
    `${shared} shared, ${untagged} with no tenure:tenant tag at all.${tagNote}`
  )
}

/* ------------------------------------------------------------- selectors -- */

/**
 * The tenants an incident touches, across every readable event.
 *
 * Returned with the unknown count beside it, deliberately: "three tenants are
 * affected" and "three tenants are affected and eleven resources could not be
 * attributed" are different briefings, and a caller taking only the first would
 * tell a room the blast radius is smaller than anybody can support.
 */
export function tenantsAffected(surface: AwsHealthSurface): {
  tenants: readonly string[]
  unattributedEntities: number
  eventsWithUnknownEntities: number
} {
  const rows = surface.rows
  return {
    tenants: [...new Set(rows.flatMap((r) => r.tenants))].sort(),
    unattributedEntities: rows
      .flatMap((r) => r.entities)
      .filter((e) => e.attribution.kind === "unattributed").length,
    eventsWithUnknownEntities: rows.filter((r) => !r.entitiesKnown).length,
  }
}

export { AWS_HEALTH_TTL_MS }
