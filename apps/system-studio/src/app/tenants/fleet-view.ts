import { SERVING, TERMINAL, type TenantState } from "@tenure/provisioning"

import type { BadgeTone } from "../../components/md3"
import type { UnknownRead } from "../../components/md3/UnknownState"
import type { AwsRead } from "../../lib/aws/read"
import type { FleetReadings } from "../../lib/aws/health"
import {
  TRANSITIONAL,
  type HealthObservation,
  type HealthSignal,
  type TenantHealth,
} from "../../lib/fleet-health"

/**
 * Everything `/tenants` DECIDES, separated from everything it draws.
 *
 * The page is an async server component that reads DynamoDB, resolves an AWS
 * identity and calls two AWS APIs. Nothing inside it can be asserted without a
 * table, a role and a browser — which is exactly how the last defect on this
 * surface survived: `hasDeployment` was a literal `true` in the JSX and the
 * helper's own unit test passed the whole time, because a helper's test cannot
 * see a producer that stopped using it.
 *
 * So every judgement this page makes lives here as a function of its arguments:
 * what the lead sentence says, what order the fleet is listed in, which badge
 * tone a lifecycle state gets, which source each signal came from, and which
 * readings could not be taken. `fleet-view.test.ts` runs all of it through
 * apps/web's jest, with no table and no browser.
 *
 * Nothing here imports a client, a session or `server-only`. The two AWS imports
 * are `import type`, so the compiled module has no AWS in its graph at all.
 */

/**
 * The question this page exists to answer, in the operator's own words.
 *
 * Rendered at the top, above every panel, because the panels are apparatus: a
 * filter, a seventeen-column inventory and a list of file-bound systems are all
 * things you reach for AFTER you know whether anything is wrong.
 */
export const THE_QUESTION =
  "Which tenants exist, what state is each in, and which need me right now?"

/* ------------------------------------------------------------ the answer -- */

export interface LeadInput {
  throttled: boolean
  failure: boolean
  configured: boolean
  registered: number
  /** How many of them are in a state that serves requests. */
  serving: number
  needingAttention: number
}

/**
 * The answer to `THE_QUESTION`, in one sentence.
 *
 * Every arm names its own uncertainty rather than falling through to a count.
 * "0 need attention" computed from a registry read that failed is the specific
 * false green this console must never print, and the three failure arms below
 * are what stop the sentence being said at all in that case.
 */
export function leadAnswer(input: LeadInput): string {
  if (input.throttled) {
    return "The tenant registry asked this console to back off, so the fleet is not known right now. Nothing below is a claim that it is healthy."
  }
  if (input.failure) {
    return "The tenant registry could not be read, so this page does not know what the fleet is. The systems bound by file, further down, are still true."
  }
  if (!input.configured) {
    return "No tenant registry is configured for this console, so it knows only the systems bound by file. That is a missing connection, not an empty fleet."
  }
  if (input.registered === 0) {
    return "No tenant has been composed through this console yet."
  }
  // All three halves of the question, in the order it asks them: how many exist,
  // what state they are in, and who needs an operator.
  const exist = `${input.registered} ${input.registered === 1 ? "tenant is" : "tenants are"} registered`
  const state = `${input.serving} of them serving`
  return input.needingAttention === 0
    ? `${exist}, ${state}, and none of them need an operator.`
    : `${exist}, ${state}, and ${input.needingAttention} need an operator. Both tables below are ordered worst first, so they are at the top of each.`
}

/* ------------------------------------------------- the lifecycle, quietly -- */

/**
 * A lifecycle state's badge tone, from the lifecycle's own vocabulary.
 *
 * This used to be `SERVING.has(state) ? "ok" : "warn"`, which is a two-word
 * adjective set imposed on a twenty-five-state machine: it painted DRAFT,
 * PLANNED, READY, SUSPENDED_LOGICAL and LEGAL_HOLD in the same warning tone as
 * FAILED. A page where a third of the fleet is always shouting is a page where
 * nobody hears the one that means something.
 *
 * So the tone is derived from the sets `packages/provisioning` already declares
 * — `SERVING`, `TERMINAL` and the `TRANSITIONAL` list health is computed from —
 * and no new adjective is invented for any state:
 *
 *   * `FAILED` is the one state the machine itself calls a failure.
 *   * `SERVING` — ACTIVE and IDLE — is the good case, and is quiet.
 *   * `TRANSITIONAL` is informational: it is moving, which is neither good nor
 *     bad until it has been moving too long, and `stalled` is the signal that
 *     says so.
 *   * everything else — DRAFT, PLANNED, READY, SUSPENDED_LOGICAL, LEGAL_HOLD,
 *     PURGE_PENDING, TERMINAL — is neutral. Somebody put the tenant there on
 *     purpose.
 *
 * The word is always drawn beside the tone, so nothing here is carried by
 * colour alone.
 */
export function lifecycleTone(state: TenantState): BadgeTone {
  if (state === "FAILED") return "bad"
  if (SERVING.has(state)) return "ok"
  if (TRANSITIONAL.includes(state)) return "info"
  if (TERMINAL.has(state)) return "neutral"
  return "neutral"
}

/**
 * The tone of the attention badge.
 *
 * `null` is NEUTRAL, not "ok". A healthy tenant does not need to be loud, and a
 * fleet of twenty green badges is a fleet whose one warning badge is harder to
 * see than it would be on a page of grey.
 */
export function attentionTone(attention: HealthSignal | null): BadgeTone {
  if (attention === null) return "neutral"
  if (attention === "failed" || attention === "dependency-failing") return "bad"
  return "warn"
}

/* ------------------------------------------------ two sources, told apart -- */

/**
 * Where a fact on this page came from.
 *
 * The registry is a DynamoDB table this console writes; the live estate is AWS,
 * read from outside the tenant. They disagree routinely and legitimately — the
 * registry row says ACTIVE for as long as nobody moves it, while the
 * certificate in front of the tenant expires — and a row that prints both
 * without saying which is which is a row an operator cannot act on.
 */
export type FactSource = "registry" | "estate"

export const SOURCE_LABEL: Readonly<Record<FactSource, string>> = {
  registry: "registry",
  estate: "live estate",
}

/**
 * Which of the two produced each health signal.
 *
 * Typed as a total `Record<HealthSignal, …>`, so a tenth signal added to
 * `fleet-health.ts` stops this file compiling rather than quietly rendering
 * unattributed — which is the failure this map exists to prevent.
 *
 * Seven come from the registry row (its state, its timestamps, its deployment
 * and configuration rows). Two come from looking at the running system:
 * `dependency-failing` is something AWS reported broken, and `unobserved` is the
 * admission that AWS told this console nothing at all.
 */
export const SIGNAL_SOURCE: Readonly<Record<HealthSignal, FactSource>> = {
  serving: "registry",
  resting: "registry",
  stalled: "registry",
  failed: "registry",
  terminal: "registry",
  "never-deployed": "registry",
  "config-behind": "registry",
  "dependency-failing": "estate",
  unobserved: "estate",
}

/**
 * The signals a tenant carries, grouped under the source that produced them.
 *
 * `"registry: serving, config behind · live estate: unobserved"` rather than
 * `"serving, config-behind, unobserved"`. The second reads as one verdict from
 * one place, and half of it is a claim about a DynamoDB row while the other half
 * is a claim about a certificate.
 */
export function describeSignals(signals: readonly HealthSignal[]): string {
  if (signals.length === 0) return "no signal"
  const groups: FactSource[] = ["registry", "estate"]
  return groups
    .map((source) => ({
      source,
      words: signals.filter((s) => SIGNAL_SOURCE[s] === source).map((s) => s.replace(/-/g, " ")),
    }))
    .filter((group) => group.words.length > 0)
    .map((group) => `${SOURCE_LABEL[group.source]}: ${group.words.join(", ")}`)
    .join(" · ")
}

/* ---------------------------------------------- when, and from where, read -- */

export interface Provenance {
  /** When the registry row behind this tenant was read, and when it last moved. */
  registry: string
  /** When the running system was last looked at, and how much of it answered. */
  estate: string
}

/**
 * Per tenant: when its state was last read, and from which of the two sources.
 *
 * The registry half is the instant THIS request read the table, plus the
 * timestamp the row itself carries — those are different facts and both matter:
 * a row read a second ago that last moved in March is a settled tenant, and a
 * row read a second ago that last moved four minutes ago is one in flight.
 *
 * The estate half is the newest instant any observation of this tenant was
 * taken, and how many of the six sources came back with something definite.
 * `0/6` is the honest rendering of a fleet nobody is watching, and it is
 * deliberately not a blank — a blank in this column would read as "fine".
 */
export function provenanceOf(input: {
  registryReadAt: string
  /** The registry row's own `updatedAt`. Empty string when it has none. */
  movedAt: string
  observations: readonly HealthObservation[]
}): Provenance {
  const moved = input.movedAt
    ? `last moved ${input.movedAt}`
    : "no movement recorded on the row"

  if (input.observations.length === 0) {
    return {
      registry: `read ${input.registryReadAt} · ${moved}`,
      estate: "not observed — no reading was taken of the running system",
    }
  }

  const instants = input.observations
    .map((o) => ({ raw: o.asOf, at: Date.parse(o.asOf) }))
    .filter((o) => !Number.isNaN(o.at))
  const definite = input.observations.filter((o) => o.status !== "unknown").length
  const answered = `${definite}/${input.observations.length} sources answered`

  if (instants.length === 0) {
    // Every observation carried an unreadable timestamp. Reporting the newest of
    // nothing as "just now" is the one thing this must not do.
    return {
      registry: `read ${input.registryReadAt} · ${moved}`,
      estate: `observed at an unreadable time · ${answered}`,
    }
  }

  const newest = instants.reduce((a, b) => (b.at > a.at ? b : a))
  return {
    registry: `read ${input.registryReadAt} · ${moved}`,
    estate: `observed ${newest.raw} · ${answered}`,
  }
}

/* ---------------------------------------------------- worst first, always -- */

/**
 * Put the fleet in the order `byUrgency` already decided.
 *
 * The inventory used to be listed in whatever order DynamoDB's Scan returned
 * partitions in — so a tenant stuck mid-provision appeared wherever its
 * partition hashed to, and an operator paging through twenty-five rows at a
 * time could have the only stalled tenant on page three.
 *
 * `order` is `byUrgency(health).map(h => h.slug)` rather than a second sort of
 * this module's own. There is one ranking of urgency in this console and it
 * lives in `fleet-health.ts`; a page that re-derived it would be a page that
 * could disagree with its own attention list about which tenant is worst.
 *
 * A row whose slug is not in `order` — a tenant the health pass did not cover —
 * keeps its position after every ranked row rather than being dropped or
 * promoted. `Array.prototype.sort` is stable, so their relative order is the
 * registry's.
 */
export function rankFleetRows<Row extends { slug: string }>(
  rows: readonly Row[],
  order: readonly string[],
): Row[] {
  const rank = new Map(order.map((slug, index) => [slug, index]))
  const unranked = order.length
  return [...rows].sort(
    (a, b) => (rank.get(a.slug) ?? unranked) - (rank.get(b.slug) ?? unranked),
  )
}

/* --------------------------------------------- a read that was not taken -- */

export interface UnknownReading {
  key: string
  /** What could not be read, in the operator's language. */
  what: string
  read: UnknownRead
}

/**
 * The observation reads that produced no value, ready for `UnknownState`.
 *
 * STUDIO-000-007. The fleet's health chips are counts over six sources per
 * tenant, and two of those sources are single AWS calls made once for the whole
 * fleet. When `acm:ListCertificates` is refused, every tenant reads
 * `unobserved` — true, and it does not tell the operator that the remedy is one
 * IAM statement rather than twenty investigations. This surfaces the refusal
 * itself, once, with the principal, the action and the pasteable statement.
 *
 * The four valueless arms are all included, and `STALE` and `EMPTY` deliberately
 * are not: a stale reading has a value and an empty one is a real answer.
 */
export function unknownReadings(readings: FleetReadings): readonly UnknownReading[] {
  const candidates: readonly { key: string; what: string; read: AwsRead<unknown> }[] = [
    {
      key: "certificates",
      what: "the certificates every tenant here is observed against",
      read: readings.certificates,
    },
    {
      key: "alarms",
      what: "the alarm state behind every tenant here",
      read: readings.alarms,
    },
  ]
  return candidates.flatMap((candidate) =>
    isUnknown(candidate.read) ? [{ key: candidate.key, what: candidate.what, read: candidate.read }] : [],
  )
}

/**
 * Whether a reading carries no value.
 *
 * A predicate over the four arm NAMES rather than `!("value" in read)`, because
 * `EMPTY` also carries no value and is not unknown — it is the answer "there is
 * genuinely nothing", which is the one thing STUDIO-000-007 says must be
 * distinguishable from the four below.
 */
function isUnknown(read: AwsRead<unknown>): read is UnknownRead {
  return (
    read.state === "DENIED" ||
    read.state === "THROTTLED" ||
    read.state === "UNCONFIGURED" ||
    read.state === "ERROR"
  )
}

/**
 * How many tenants a health pass could say something definite about.
 *
 * Rendered beside the chips, because `12 serving` computed over a fleet nobody
 * could observe is a number that reads as a measurement and is a restatement of
 * twelve DynamoDB rows.
 */
export function observedCount(health: readonly TenantHealth[]): number {
  return health.filter((h) => h.observations.some((o) => o.status !== "unknown")).length
}
