/**
 * What is watching this estate, and what nothing is watching.
 *
 * ── Why this is a module beside `answer.ts` and not more of it ──────────────
 *
 * `answer.ts` decides the page's LEAD: is anything broken right now, and is it
 * us or is it AWS. That question is answered from alarms and from AWS Health.
 * This module answers a different one, on a different clock: of the things this
 * estate is producing telemetry FROM, which of them is nothing looking at.
 *
 * The two are kept apart because they fail differently. A firing alarm is an
 * event; a log group that no dashboard reads and no metric filter measures is a
 * standing condition that has been true since somebody forgot, and folding it
 * into the incident verdict would make every load of this page during a real
 * incident louder about a month-old omission than about the outage.
 *
 * ── The join, and why neither reader can make it alone ──────────────────────
 *
 * `lib/aws/dashboards.ts` parses each dashboard body down to the metric
 * NAMESPACES, ALARM NAMES and LOG GROUPS its widgets reference, and returns them
 * as data specifically so somebody else can subtract. It cannot subtract itself,
 * because it does not know what exists.
 *
 * `lib/aws/logs.ts` knows every log group in the account, which of them has a
 * metric filter, and which metric namespace each filter emits into. It cannot
 * say whether anything DRAWS that namespace, because it never opens a dashboard.
 *
 * `lib/aws/alarms.ts` knows every alarm that exists, by name. `dashboards.ts`
 * knows every alarm a widget NAMES. Neither knows about the other.
 *
 * Put together, this module can state four things that were previously
 * unstatable in this console:
 *
 *   1. a log group nothing reads and nothing measures — its content reaches no
 *      screen and no metric, so whatever it says, nobody will ever see it;
 *   2. a metric namespace this estate's own log pipeline emits into that no
 *      dashboard draws — a metric filter somebody wrote and nobody plotted;
 *   3. an alarm that exists and appears on no dashboard — it can still page
 *      somebody, and it is invisible to anyone looking at a wall;
 *   4. an alarm a dashboard NAMES that this account does not have — the widget
 *      renders as a grey box, which on a wall reads as "not firing".
 *
 * ── Why every one of the four can refuse to be a finding ────────────────────
 *
 * Each is a set DIFFERENCE, and a difference against an incomplete set produces
 * false findings in the dangerous direction: a log group on a dashboard nobody
 * was allowed to open would be reported as unwatched, and somebody would go and
 * build a second dashboard for it. So `DashboardCoverage`'s own `complete` /
 * `partial` / `not-read` decides whether this module is willing to subtract at
 * all, and `unwatchedNamespaces` — the reader's own arithmetic, reused rather
 * than rewritten — returns `undecidable` with a shortlist rather than a finding.
 *
 * The same rule applies one level down, per group: a group whose metric filters
 * were refused might well be feeding a namespace somebody is plotting, so it is
 * UNDECIDABLE and never UNWATCHED.
 *
 * ── What this module deliberately does NOT claim ────────────────────────────
 *
 * The candidate set is not a service inventory. It is the log groups this
 * account holds and the alarms it holds — the two things this page already
 * reads. A service that writes no logs and has no alarm is invisible to this
 * join and is not reported as unwatched, because this page has no evidence it
 * exists. `estateInventory` holds that evidence and composes roughly fifty
 * reads to get it; making an incident page pay for those on every load is not a
 * trade this surface makes, and pretending the narrower candidate set is the
 * whole fleet would be exactly the reassuring answer the read plane exists
 * against. `candidatesWhy` says this on the page, in the card.
 *
 * Everything here is pure. The only AWS imports are types and the four `describe*`
 * renderers the readers own, so `e2e/health-page-logic.spec.ts` drives every
 * branch at the node level with no browser, no server and no estate.
 */

import type { AlarmRow } from "../../../lib/aws/alarms"
import {
  unwatchedNamespaces,
  type DashboardCoverage,
  type DashboardReadings,
  type DashboardRow,
  type UnwatchedNamespaces,
} from "../../../lib/aws/dashboards"
import type {
  LastEventAge,
  LogGroupReading,
  LogsReadings,
  RetentionPosture,
} from "../../../lib/aws/logs"
import { describeRead, type AwsRead } from "../../../lib/aws/read"
import { readAnswered, type VerdictTone } from "./answer"

/* ────────────────────────────────────────────────────── the silence probe ── */

/**
 * How far back this page asks CloudWatch whether a log group received anything.
 *
 * Twenty-four hours, and the number is a judgement rather than an AWS default.
 * `logs.ts` makes the probe opt-in because `FilterLogEvents` is billed for the
 * BYTES IT SCANS over the window, so the window is the cost — and this page,
 * which an operator opens during an incident and refreshes, is exactly the
 * caller that has to choose it deliberately.
 *
 * A day is chosen because it is longer than this estate's deploy cadence and
 * shorter than a weekend. A group that has received nothing for a day has a
 * writer that has stopped, and on a dashboard counting errors a stopped writer
 * and a healthy service are the same flat line at zero. A shorter window would
 * report a low-traffic group as silent; a longer one costs more to scan and
 * still would not tell an operator anything a day does not.
 *
 * The reader caps the probe at its own budget of groups per load and reports
 * UNREADABLE — never SILENT — for the ones past it.
 */
export const SILENCE_WINDOW_MS = 24 * 60 * 60 * 1000

/** The sentence the card prints about what the probe cost and what it can claim. */
export const SILENCE_PROBE_WHY =
  "Each group was asked once, over a 24-hour window, whether anything arrived — one bounded " +
  "logs:FilterLogEvents call per group, which is billed for the bytes it scans and returns no log " +
  "line to this page. SILENT means nothing in that window, which is a lower bound on how long the " +
  "writer has been stopped, not the age of the last event."

/* ───────────────────────────────────────────────────────────── retention ── */

/** The word this page prints for a retention posture. */
export const RETENTION_WORD: Readonly<Record<RetentionPosture["kind"], string>> = {
  "never-expires": "Never expires",
  "too-short": "Too short",
  retained: "Retained",
  unreadable: "Unreadable",
}

/**
 * How loud each posture is.
 *
 * `never-expires` and `too-short` are both BAD and they are bad in opposite
 * directions — one is an unbounded bill and a retention-policy breach, the other
 * is evidence deleted before anybody reviews the incident. Neither is a warning:
 * both are somebody's compliance problem the day it is asked about.
 */
export const RETENTION_TONE: Readonly<Record<RetentionPosture["kind"], VerdictTone>> = {
  "never-expires": "bad",
  "too-short": "bad",
  retained: "ok",
  unreadable: "warn",
}

/** What the account's retention posture adds up to. Counts, never percentages. */
export interface RetentionCensus {
  /** False when the group listing did not answer. Then every count below is 0 and means nothing. */
  known: boolean
  /** When `known` is false, the reader's own sentence about why. */
  because: string | null
  groups: number
  neverExpires: number
  tooShort: number
  retained: number
  unreadable: number
  /** Bytes AWS reported, summed. Groups that reported none are counted separately, never as zero. */
  storedBytes: number
  groupsNotReportingBytes: number
  /** Groups whose key is the AWS-owned one rather than a key this estate can revoke. */
  withoutCustomerKey: number
  /** Groups whose NAME marks them as carrying tenant data. Not a content claim. */
  markedTenantData: number
}

export function retentionCensus(groups: AwsRead<readonly LogGroupReading[]>): RetentionCensus {
  const empty: RetentionCensus = {
    known: false,
    because: null,
    groups: 0,
    neverExpires: 0,
    tooShort: 0,
    retained: 0,
    unreadable: 0,
    storedBytes: 0,
    groupsNotReportingBytes: 0,
    withoutCustomerKey: 0,
    markedTenantData: 0,
  }

  if (groups.state === "EMPTY") {
    // A successful read of nothing. That IS an answer — this account holds no
    // log group at all — and it is knowable, so the counts of zero are true.
    return { ...empty, known: true }
  }
  if (groups.state !== "ACTUAL" && groups.state !== "STALE") {
    return { ...empty, because: describeRead(groups, "the log groups in this account") }
  }

  const census = { ...empty, known: true, groups: groups.value.length }
  for (const group of groups.value) {
    switch (group.retention.kind) {
      case "never-expires":
        census.neverExpires += 1
        break
      case "too-short":
        census.tooShort += 1
        break
      case "retained":
        census.retained += 1
        break
      case "unreadable":
        census.unreadable += 1
        break
    }
    if (group.storedBytes === null) census.groupsNotReportingBytes += 1
    else census.storedBytes += group.storedBytes
    if (group.encryption.kind === "aws-owned-key") census.withoutCustomerKey += 1
    if (group.sensitivity.kind === "tenant-data") census.markedTenantData += 1
  }
  return census
}

/**
 * Bytes, in the unit an operator reads a bill in.
 *
 * Powers of 1024 with the exact byte count kept beside it, because "1.2 GiB" is
 * what somebody scans and the integer is what they paste into a ticket. Never
 * rounded to a unit that hides an order of magnitude.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return `${String(bytes)} bytes`
  const units = ["bytes", "KiB", "MiB", "GiB", "TiB", "PiB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const shown = unit === 0 ? String(bytes) : `${value.toFixed(1)} ${units[unit]}`
  return unit === 0 ? `${shown} bytes` : `${shown} (${bytes} bytes)`
}

/* ────────────────────────────────────────────────────────────── freshness ── */

/** The word this page prints for a log group's freshness. */
export const FRESHNESS_WORD: Readonly<Record<LastEventAge["state"], string>> = {
  NOT_PROBED: "Not probed",
  RECEIVING: "Receiving",
  SILENT: "Silent",
  UNREADABLE: "Not known",
}

/**
 * How loud each freshness state is.
 *
 * SILENT is BAD and UNREADABLE is a warning, and the gap between them is the
 * whole point of the state existing: one is an observation that nothing arrived,
 * the other is this console not having looked. Rendering them alike is how a
 * refused probe becomes a quiet service.
 */
export const FRESHNESS_TONE: Readonly<Record<LastEventAge["state"], VerdictTone>> = {
  NOT_PROBED: "neutral",
  RECEIVING: "ok",
  SILENT: "bad",
  UNREADABLE: "warn",
}

export interface SilenceCensus {
  known: boolean
  because: string | null
  receiving: number
  silent: number
  notProbed: number
  unreadable: number
  /** The groups that received nothing in the window, by name, sorted. */
  silentGroups: readonly string[]
}

export function silenceCensus(groups: AwsRead<readonly LogGroupReading[]>): SilenceCensus {
  const empty: SilenceCensus = {
    known: false,
    because: null,
    receiving: 0,
    silent: 0,
    notProbed: 0,
    unreadable: 0,
    silentGroups: [],
  }
  if (groups.state === "EMPTY") return { ...empty, known: true }
  if (groups.state !== "ACTUAL" && groups.state !== "STALE") {
    return { ...empty, because: describeRead(groups, "the log groups in this account") }
  }

  const silentGroups: string[] = []
  const census = { ...empty, known: true }
  for (const group of groups.value) {
    switch (group.lastEvent.state) {
      case "RECEIVING":
        census.receiving += 1
        break
      case "SILENT":
        census.silent += 1
        silentGroups.push(group.logGroupName)
        break
      case "NOT_PROBED":
        census.notProbed += 1
        break
      case "UNREADABLE":
        census.unreadable += 1
        break
    }
  }
  return { ...census, silentGroups: [...silentGroups].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) }
}

/**
 * The sentence the LEAD card prints when something has stopped writing, or null.
 *
 * This is deliberately on "Right now" rather than only on the log card. A
 * stopped writer is the one finding on this page that is invisible by
 * construction: the alarm over its error count sits in OK forever, AWS Health
 * has nothing to say about it, and every panel above reads calm. A page that
 * puts it forty rows down has described the estate accurately and told the
 * operator nothing.
 *
 * It does NOT enter `fleetVerdict`. Silence is a bound — "nothing in the last
 * 24 hours" — and a group that is legitimately idle overnight would otherwise
 * turn the whole page's verdict on a schedule. The sentence names the groups and
 * lets a person decide, which is the honest shape of a bounded observation.
 */
export function silenceWarning(census: SilenceCensus): string | null {
  if (!census.known || census.silent === 0) return null
  const named = census.silentGroups.join(", ")
  return (
    `${census.silent} log group${census.silent === 1 ? " has" : "s have"} received nothing for at ` +
    `least 24 hours: ${named}. Whatever writes to ${census.silent === 1 ? "it" : "them"} has stopped, ` +
    `or was never deployed — and on a chart counting errors that is the same flat line as having none.`
  )
}

/* ──────────────────────────────────────────────────────────── dashboards ── */

export interface DashboardCensus {
  known: boolean
  because: string | null
  total: number
  /** Bodies that parsed and reference at least one widget. */
  watching: number
  /** Bodies that parsed and declare no widget at all. A dashboard somebody emptied. */
  watchingNothing: number
  /** Bodies this reader could not parse, and bodies it was not allowed to open. */
  unknownContent: number
  /** The most recent `LastModified` across every listed dashboard, or null. */
  lastChanged: string | null
}

export function dashboardCensus(dashboards: AwsRead<readonly DashboardRow[]>): DashboardCensus {
  const empty: DashboardCensus = {
    known: false,
    because: null,
    total: 0,
    watching: 0,
    watchingNothing: 0,
    unknownContent: 0,
    lastChanged: null,
  }
  if (dashboards.state === "EMPTY") return { ...empty, known: true }
  if (dashboards.state !== "ACTUAL" && dashboards.state !== "STALE") {
    return { ...empty, because: describeRead(dashboards, "the dashboards in this account") }
  }

  const census = { ...empty, known: true, total: dashboards.value.length }
  let lastChanged: string | null = null
  for (const row of dashboards.value) {
    switch (row.content.kind) {
      case "watching":
        census.watching += 1
        break
      case "watching-nothing":
        census.watchingNothing += 1
        break
      case "malformed":
      case "not-read":
        census.unknownContent += 1
        break
    }
    if (row.lastModified !== null && (lastChanged === null || row.lastModified > lastChanged)) {
      lastChanged = row.lastModified
    }
  }
  return { ...census, lastChanged }
}

/* ───────────────────────────────────────────────────────────── the join ── */

/** Whether anything is looking at a thing, or whether that cannot be decided. */
export type WatchVerdict = "WATCHED" | "UNWATCHED" | "UNDECIDABLE"

export const WATCH_WORD: Readonly<Record<WatchVerdict, string>> = {
  WATCHED: "Watched",
  UNWATCHED: "Nobody is watching",
  UNDECIDABLE: "Cannot say",
}

export const WATCH_TONE: Readonly<Record<WatchVerdict, VerdictTone>> = {
  WATCHED: "ok",
  UNWATCHED: "bad",
  UNDECIDABLE: "warn",
}

/** The rank the table sorts by: the finding first, then the doubt, then the fine. */
const WATCH_RANK: readonly WatchVerdict[] = ["UNWATCHED", "UNDECIDABLE", "WATCHED"]

export interface LogGroupWatch {
  logGroupName: string
  verdict: WatchVerdict
  /** The sentence the table prints. Carries the dashboard or the namespace by name. */
  detail: string
  /** Whether this group also received nothing in the probe window. */
  silent: boolean
}

export interface AlarmWatch {
  /** False when either side of the join did not answer. Then neither list is a finding. */
  decidable: boolean
  because: string | null
  /** Alarms this account has that no dashboard body names. Sorted. */
  onNoDashboard: readonly string[]
  /** Alarms a dashboard names that a successful DescribeAlarms response did not contain. */
  referencedAndAbsent: readonly string[]
  /** How many alarms actually exist, so the two lists above have a denominator. */
  existing: number
}

export interface WatchJoin {
  groups: readonly LogGroupWatch[]
  /**
   * Whether the log group listing answered at all.
   *
   * Separate from `decidable`, and load-bearing: with no listing every count
   * below is 0, and `0 of 0 log groups are unwatched` is a sentence that reads
   * as an estate with nothing wrong in it. A caller renders the counts ONLY
   * when this is true. It is `true` for an EMPTY read, because a successful
   * read of an account with no log group is a real answer.
   */
  groupsKnown: boolean
  /** When `groupsKnown` is false, the reader's own sentence about why. */
  groupsBecause: string | null
  unwatched: number
  undecidable: number
  watched: number
  /** The namespaces this estate's own metric filters emit into. The candidate set. */
  candidateNamespaces: readonly string[]
  /** `dashboards.ts`'s own arithmetic over that set. Reused, never reimplemented. */
  namespaces: UnwatchedNamespaces
  alarms: AlarmWatch
  /** Whether a set difference is a finding at this load at all, and why not. */
  decidable: boolean
  because: string | null
}

/** Deterministic across platforms: code-unit order, never `localeCompare`. */
function sortedUnique(values: Iterable<string>): readonly string[] {
  return [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/**
 * Which metric namespaces one group's filters emit into, and whether that is
 * knowable at all.
 *
 * `null` is not "no namespaces" — it is "this engine did not read this group's
 * filters", which is the difference between a group nothing measures and a group
 * nobody looked at. `logs.ts` returns UNCONFIGURED rather than EMPTY for groups
 * past its own budget precisely so this distinction survives, and collapsing it
 * here would throw that away one layer up.
 */
function emittedBy(group: LogGroupReading): readonly string[] | null {
  const filters = group.metricFilters.filters
  if (filters.state === "EMPTY") return []
  if (filters.state !== "ACTUAL" && filters.state !== "STALE") return null
  const namespaces: string[] = []
  for (const filter of filters.value) {
    for (const transformation of filter.transformations) {
      namespaces.push(transformation.metricNamespace)
    }
  }
  return sortedUnique(namespaces)
}

/** Every namespace the estate's log pipeline emits into, across every group read. */
export function emittedNamespaces(groups: AwsRead<readonly LogGroupReading[]>): readonly string[] {
  if (groups.state !== "ACTUAL" && groups.state !== "STALE") return []
  const namespaces: string[] = []
  for (const group of groups.value) {
    for (const namespace of emittedBy(group) ?? []) namespaces.push(namespace)
  }
  return sortedUnique(namespaces)
}

/**
 * Whether anything at all is looking at one log group.
 *
 * Two ways a group is watched, and they are different mechanisms: a dashboard
 * widget can READ the group directly through a Logs Insights `SOURCE` clause, or
 * a metric filter can turn its lines into a metric in some namespace that a
 * dashboard then DRAWS. Both count, and the sentence says which one applies,
 * because the remedy for losing one is not the remedy for losing the other.
 */
function watchOne(group: LogGroupReading, coverage: DashboardCoverage): LogGroupWatch {
  const silent = group.lastEvent.state === "SILENT"
  const tail = silent
    ? " It has also received nothing in the last 24 hours, so there may be nothing left to watch."
    : ""

  if (coverage.kind === "not-read") {
    return {
      logGroupName: group.logGroupName,
      verdict: "UNDECIDABLE",
      silent,
      detail:
        `no dashboard was read, so whether anything displays this group is unknown — ${coverage.why}` +
        tail,
    }
  }

  const readDirectly = coverage.logGroups.includes(group.logGroupName)
  if (readDirectly) {
    return {
      logGroupName: group.logGroupName,
      verdict: "WATCHED",
      silent,
      detail: `a dashboard widget queries this group by name.${tail}`,
    }
  }

  const emitted = emittedBy(group)
  if (emitted === null) {
    return {
      logGroupName: group.logGroupName,
      verdict: "UNDECIDABLE",
      silent,
      detail:
        "this group's metric filters were not read, so whether it feeds a metric somebody plots is " +
        "unknown. That is not the same as its feeding none." +
        tail,
    }
  }

  const drawn = emitted.filter((namespace) => coverage.namespaces.includes(namespace))
  if (drawn.length > 0) {
    return {
      logGroupName: group.logGroupName,
      verdict: "WATCHED",
      silent,
      detail:
        `no dashboard queries this group directly, but a metric filter on it emits into ` +
        `${drawn.join(", ")}, which a dashboard draws.${tail}`,
    }
  }

  if (coverage.kind === "partial") {
    return {
      logGroupName: group.logGroupName,
      verdict: "UNDECIDABLE",
      silent,
      detail:
        `nothing in the dashboards this load could read looks at this group, and the coverage set is ` +
        `incomplete, so "nobody is watching" is not a claim this load can make. ${coverage.why}` +
        tail,
    }
  }

  const measured =
    emitted.length === 0
      ? "no metric filter turns a line in it into a metric"
      : `its metric filters emit into ${emitted.join(", ")}, and no dashboard draws ${
          emitted.length === 1 ? "that namespace" : "any of those namespaces"
        }`
  return {
    logGroupName: group.logGroupName,
    verdict: "UNWATCHED",
    silent,
    detail:
      `no dashboard queries this group and ${measured}. Whatever it records reaches no screen and no ` +
      `metric.${tail}`,
  }
}

/**
 * Which alarms are on a dashboard, and which dashboard references point at an
 * alarm that is not there.
 *
 * The join is by NAME, because that is the only key the two sides share:
 * `dashboards.ts` parses an alarm ARN and keeps the name (and refuses to invent
 * one from an ARN it could not parse), and `alarms.ts` returns names and no
 * namespace. Rows whose `type` is `expected`, `surface` or anything else this
 * page synthesised are excluded from "exists" — a MISSING alarm is precisely one
 * that does not exist, and counting it here would hide the second finding.
 */
function joinAlarms(
  coverage: DashboardCoverage,
  rows: readonly AlarmRow[],
  alarmReadState: string,
): AlarmWatch {
  const real = rows.filter((row) => row.type === "MetricAlarm" || row.type === "CompositeAlarm")
  const existing = sortedUnique(real.map((row) => row.name))

  if (!readAnswered(alarmReadState)) {
    return {
      decidable: false,
      because:
        "the alarm read did not answer, so this console does not know which alarms exist. Neither " +
        "“on no dashboard” nor “named by a dashboard and absent” is a claim it can make.",
      onNoDashboard: [],
      referencedAndAbsent: [],
      existing: 0,
    }
  }
  if (coverage.kind === "not-read") {
    return {
      decidable: false,
      because: `the dashboards were not read, so what they name is unknown — ${coverage.why}`,
      onNoDashboard: [],
      referencedAndAbsent: [],
      existing: existing.length,
    }
  }

  const shown = new Set(coverage.alarmNames)
  const onNoDashboard = existing.filter((name) => !shown.has(name))
  const held = new Set(existing)
  const referencedAndAbsent = coverage.alarmNames.filter((name) => !held.has(name))

  if (coverage.kind === "partial") {
    return {
      decidable: false,
      because: coverage.why,
      onNoDashboard: sortedUnique(onNoDashboard),
      referencedAndAbsent: sortedUnique(referencedAndAbsent),
      existing: existing.length,
    }
  }
  return {
    decidable: true,
    because: null,
    onNoDashboard: sortedUnique(onNoDashboard),
    referencedAndAbsent: sortedUnique(referencedAndAbsent),
    existing: existing.length,
  }
}

/**
 * The whole join: log groups, namespaces and alarms against what the dashboards
 * actually reference.
 *
 * Takes the two readings and the alarm rows this page already holds. Nothing
 * here reads AWS; nothing here is allowed to.
 */
export function watchJoin(input: {
  logs: LogsReadings
  dashboards: DashboardReadings
  alarmRows: readonly AlarmRow[]
  alarmReadState: string
}): WatchJoin {
  const coverage = input.dashboards.coverage
  const groupsRead = input.logs.groups

  const groups =
    groupsRead.state === "ACTUAL" || groupsRead.state === "STALE"
      ? [...groupsRead.value]
          .map((group) => watchOne(group, coverage))
          .sort((a, b) => {
            const rank = WATCH_RANK.indexOf(a.verdict) - WATCH_RANK.indexOf(b.verdict)
            if (rank !== 0) return rank
            return a.logGroupName < b.logGroupName ? -1 : a.logGroupName > b.logGroupName ? 1 : 0
          })
      : []

  const candidateNamespaces = emittedNamespaces(groupsRead)
  const alarms = joinAlarms(coverage, input.alarmRows, input.alarmReadState)

  const reasons: string[] = []
  if (groupsRead.state !== "ACTUAL" && groupsRead.state !== "STALE" && groupsRead.state !== "EMPTY") {
    reasons.push(describeRead(groupsRead, "the log groups in this account"))
  }
  if (coverage.kind !== "complete") reasons.push(coverage.why)
  if (input.logs.completeness.kind === "truncated") reasons.push(input.logs.completeness.why)
  if (!alarms.decidable && alarms.because !== null) reasons.push(alarms.because)

  const groupsKnown =
    groupsRead.state === "ACTUAL" || groupsRead.state === "STALE" || groupsRead.state === "EMPTY"

  return {
    groups,
    groupsKnown,
    groupsBecause: groupsKnown ? null : describeRead(groupsRead, "the log groups in this account"),
    unwatched: groups.filter((group) => group.verdict === "UNWATCHED").length,
    undecidable: groups.filter((group) => group.verdict === "UNDECIDABLE").length,
    watched: groups.filter((group) => group.verdict === "WATCHED").length,
    candidateNamespaces,
    namespaces: unwatchedNamespaces(coverage, candidateNamespaces),
    alarms,
    decidable: reasons.length === 0,
    because: reasons.length === 0 ? null : reasons.join(" "),
  }
}

/**
 * What the candidate set IS, said on the page rather than assumed.
 *
 * Without this sentence "nobody is watching 3 things" reads as a statement about
 * the fleet. It is a statement about the log groups and alarms this account
 * holds, which is narrower, and an operator who takes it for the wider one will
 * conclude that everything not listed is fine.
 */
export const CANDIDATES_WHY =
  "The things compared here are the log groups this account holds and the alarms it holds — the two " +
  "inventories this page already reads. A service that writes no logs and has no alarm does not appear " +
  "above and is not being claimed to be watched: it is invisible to this join, which is a narrower " +
  "statement than a claim about the whole fleet."

/* ─────────────────────────────────────────────────────────────── headline ── */

/** The one-line answer the unwatched card leads with, and how loud it is. */
export interface WatchHeadline {
  verdict: string
  tone: VerdictTone
  sentence: string
}

export function watchHeadline(join: WatchJoin): WatchHeadline {
  const dangling = join.alarms.referencedAndAbsent.length
  const dark = join.unwatched
  const unplotted = join.namespaces.kind === "decidable" ? join.namespaces.namespaces.length : 0

  if (!join.decidable && dark === 0 && dangling === 0) {
    return {
      verdict: "Not known",
      tone: "warn",
      sentence:
        "This console cannot say what nothing is watching. One of the reads it subtracts did not " +
        "answer in full, and a set difference against an incomplete set reports a thing as unwatched " +
        "when it is merely on a dashboard nobody could open.",
    }
  }

  if (dark === 0 && dangling === 0 && unplotted === 0) {
    return {
      verdict: join.decidable ? "All accounted for" : "Nothing found",
      tone: join.decidable ? "ok" : "warn",
      sentence: join.decidable
        ? `Every one of the ${join.groups.length} log group(s) this account holds is either queried by a ` +
          `dashboard or feeds a namespace one draws, every one of the ${join.alarms.existing} alarm(s) ` +
          `that exists is named by a dashboard, and no dashboard names an alarm that is not there.`
        : "Nothing unwatched was found in the part of the estate this load could read, which is not the " +
          "same as nothing being unwatched. The incomplete half is named below.",
    }
  }

  const found: string[] = []
  if (dark > 0) found.push(`${dark} log group(s) nothing reads and nothing measures`)
  if (unplotted > 0) found.push(`${unplotted} metric namespace(s) this estate emits into that no dashboard draws`)
  if (join.alarms.onNoDashboard.length > 0) {
    found.push(`${join.alarms.onNoDashboard.length} alarm(s) that appear on no dashboard`)
  }
  if (dangling > 0) {
    found.push(`${dangling} alarm(s) a dashboard names that this account does not have`)
  }

  return {
    verdict: dark > 0 || dangling > 0 ? "Blind spots" : "Partly unplotted",
    tone: dark > 0 || dangling > 0 ? "bad" : "warn",
    sentence: `${found.join("; ")}.`,
  }
}
