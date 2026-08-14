/**
 * The decisions `/platform/data` makes, with no React, no client and no AWS in
 * them.
 *
 * ── Why this file exists at all ─────────────────────────────────────────────
 *
 * The page composes five readers. Every one of them already decided what ONE
 * resource's posture is — `dynamodb-tables.ts` decided that a table with PITR
 * off is unrecoverable, `buckets.ts` decided that a bucket S3 itself calls
 * public is exposed, `elasticache.ts` decided that a single-node cluster has no
 * failover. None of them decided what the PAGE says when four of those are true
 * at once, which is the decision an operator actually reads, and which — written
 * as a ternary chain inside a render — is a decision nothing can reach.
 *
 * So the ordering lives here, pure, and `answer.test.ts` drives every arm of it
 * at the node level. In particular it drives the arms that cannot be produced
 * from a browser: a registry table whose PITR is off, a bucket S3 reports as
 * public, a forced RDS maintenance date, and — the one that matters most — an
 * estate where every read was refused.
 *
 * ── The two rules the ordering encodes ──────────────────────────────────────
 *
 * **The registry outranks everything.** `TENANT_TABLE` is the fleet's own record
 * of itself: which tenants exist, what was provisioned for them, who approved
 * it. Point-in-time recovery off on that table is not one unrecoverable store
 * among several — it is the loss of the record that says what the others were.
 * `RISK_RANK` puts `REGISTRY_UNRECOVERABLE` at 0 and `tableRows` puts the
 * registry row at index 0 regardless of how clean it is, because a row an
 * operator has to scroll to find is a row that gets found late.
 *
 * **PROTECTED is unreachable while anything is unknown.** `verdictOf` refuses to
 * return PROTECTED when `unknowns` is non-empty, whatever the rows say. That is
 * the single most important line in this file: this console runs against an
 * estate where STS is frequently unreachable, and a page that renders "every
 * store is protected" from four refused reads is exactly the failure
 * `lib/aws/read.ts` was built to make impossible one layer down.
 *
 * Every sentence about ONE resource is the reader's own `describe*` function
 * rather than one written here. Two vocabularies for the same fact is how a
 * denial ends up worded as an absence on one surface and correctly on another.
 */

import type { AwsRead } from "../../../lib/aws/read"
import { describeRead } from "../../../lib/aws/read"
import type {
  DatabaseInstanceReading,
  EventSignificance,
  ScheduledOutage,
} from "../../../lib/aws/database"
import {
  describeOutageSchedule,
  describeRecoveryPoint,
  describeBackup,
} from "../../../lib/aws/database"
import type {
  DynamoDbReadings,
  PointInTimeRecovery,
  RegistryProtection,
  TableReading,
} from "../../../lib/aws/dynamodb-tables"
import {
  describeDeletionProtection,
  describePointInTimeRecovery,
  describeEncryption as describeTableEncryption,
} from "../../../lib/aws/dynamodb-tables"
import type { S3Readings } from "../../../lib/aws/buckets"
import {
  publicAccessGaps,
  describeEncryption as describeBucketEncryption,
  describePolicyStatus,
  describePublicAccessBlock,
  describeVersioning,
} from "../../../lib/aws/buckets"
import type {
  CacheClusterReading,
  ElastiCacheReadings,
  ReplicationGroupReading,
  ScheduledInterruption,
} from "../../../lib/aws/elasticache"
import { describeEncryptionState, describeFailover } from "../../../lib/aws/elasticache"

/* ─────────────────────────────────────────────────────── the vocabulary ── */

/**
 * The words this page prints, worst first.
 *
 * A closed list rather than free text, because the same fact reaches this page
 * from five readers that each have their own wording for it, and an operator
 * comparing a bucket row against a table row needs the two to be comparable.
 * `RISK_RANK` is the ONLY place the ordering is written down.
 */
export const DATA_RISKS = [
  "REGISTRY_UNRECOVERABLE",
  "PUBLIC",
  "UNRECOVERABLE",
  "PLAINTEXT",
  "FORCED_INTERRUPTION",
  "NO_FAILOVER",
  "DELETABLE",
  "UNKNOWN",
  "ROUTINE",
  "PROTECTED",
] as const

export type DataRisk = (typeof DATA_RISKS)[number]

export type VerdictTone = "neutral" | "info" | "ok" | "warn" | "bad"

/** 0 is worst. Sorting, the lead verdict and the badge all read this one map. */
export const RISK_RANK: Readonly<Record<DataRisk, number>> = {
  REGISTRY_UNRECOVERABLE: 0,
  PUBLIC: 1,
  UNRECOVERABLE: 2,
  PLAINTEXT: 3,
  FORCED_INTERRUPTION: 4,
  NO_FAILOVER: 5,
  DELETABLE: 6,
  // Deliberately WORSE than ROUTINE. A fact this console could not read must
  // never sort below, or read as calmer than, a queued action AWS told us about
  // and that nobody has to do anything about.
  UNKNOWN: 7,
  ROUTINE: 8,
  PROTECTED: 9,
}

/**
 * The word an operator reads. Never a colour, never an icon.
 *
 * `UNKNOWN` reads "Not known" rather than anything softer: it is the answer for
 * a read that did not happen, and every gentler word for that has been read as
 * "fine" by somebody at some point.
 */
export const RISK_WORD: Readonly<Record<DataRisk, string>> = {
  REGISTRY_UNRECOVERABLE: "Registry unrecoverable",
  PUBLIC: "Open to the internet",
  UNRECOVERABLE: "No restore point",
  PLAINTEXT: "Not encrypted",
  FORCED_INTERRUPTION: "Interruption forced",
  NO_FAILOVER: "No failover",
  DELETABLE: "Deletable",
  UNKNOWN: "Not known",
  ROUTINE: "Routine",
  PROTECTED: "Protected",
}

/** Loudness, which never carries meaning on its own — see `RISK_WORD`. */
export const RISK_TONE: Readonly<Record<DataRisk, VerdictTone>> = {
  REGISTRY_UNRECOVERABLE: "bad",
  PUBLIC: "bad",
  UNRECOVERABLE: "bad",
  PLAINTEXT: "bad",
  FORCED_INTERRUPTION: "warn",
  NO_FAILOVER: "warn",
  DELETABLE: "warn",
  UNKNOWN: "warn",
  ROUTINE: "neutral",
  PROTECTED: "ok",
}

/** What each word on this page means, printed in the page's own legend. */
export const RISK_MEANING: Readonly<Record<DataRisk, string>> = {
  REGISTRY_UNRECOVERABLE:
    "The DynamoDB table TENANT_TABLE names has no point-in-time recovery, or is not where this engine was told it is. That table is the fleet's own record of itself; losing it loses the record of what everything else was.",
  PUBLIC:
    "S3 itself reports the bucket as public, or its public-access block is absent or has one of its four flags off. Ranked hardest of the bucket findings because it is the only one an outsider can act on.",
  UNRECOVERABLE:
    "There is no restore point: point-in-time recovery is off, automated backups are off, versioning was never enabled, or AWS reports no restorable time at all.",
  PLAINTEXT:
    "Encryption is off, or the key is unreachable. AWS saying nothing about encryption is NOT counted here — that lands in Not known, because a silence is not a yes and it is not a no either.",
  FORCED_INTERRUPTION:
    "AWS has queued an action it will apply on a fixed date whether or not anybody opts in, or a queued change that restarts the resource.",
  NO_FAILOVER:
    "One node, or failover switched off. Losing the node loses the cache until it is rebuilt.",
  DELETABLE: "Deletion protection is off, so a single API call removes the store.",
  ROUTINE:
    "AWS has queued this and applying it neither restarts the resource nor happens on a date somebody else chose. It is listed because a queued change nobody was told about is how a surprise starts, not because it needs action.",
  UNKNOWN:
    "This console could not read the fact. It is not a report that the fact is fine, and no count on this page includes it as one.",
  PROTECTED:
    "Every fact this console reads about the resource answered, and none of them is a finding.",
}

/** The worst of a set of risks. `PROTECTED` when the set is empty. */
export function worstRisk(risks: readonly DataRisk[]): DataRisk {
  let worst: DataRisk = "PROTECTED"
  for (const risk of risks) {
    if (RISK_RANK[risk] < RISK_RANK[worst]) worst = risk
  }
  return worst
}

/* ───────────────────────────────────────────────── reading-state helpers ── */

/** The arms of a reading that carry no value — what `UnknownState` renders. */
export type UnknownArm = Extract<
  AwsRead<unknown>,
  { state: "DENIED" | "THROTTLED" | "UNCONFIGURED" | "ERROR" }
>

export function unknownArm<T>(read: AwsRead<T>): UnknownArm | null {
  switch (read.state) {
    case "DENIED":
    case "THROTTLED":
    case "UNCONFIGURED":
    case "ERROR":
      return read
    default:
      return null
  }
}

/** Whether a read produced an answer — which `EMPTY` is, and `DENIED` is not. */
function readAnswered(state: AwsRead<unknown>["state"]): boolean {
  return state === "ACTUAL" || state === "STALE" || state === "EMPTY"
}

/** The items of a listing, and `[]` ONLY when the listing itself answered. */
function itemsOf<T>(read: AwsRead<readonly T[]>): readonly T[] {
  return read.state === "ACTUAL" || read.state === "STALE" ? read.value : []
}

/**
 * Whether a table with no rows may say "there is nothing", or must say "we could
 * not look".
 *
 * ── The defect this exists to close ─────────────────────────────────────────
 *
 * `DataTable` takes an `empty` node and renders it whenever `rows.length === 0`.
 * That is correct only when the reads BEHIND those rows answered. Two tables on
 * this page derived their rows from readings that can land in a valueless arm
 * and then printed a bare claim anyway — "Nothing is queued against a cache" and
 * "No store on this page has a continuous restore point" — because a row builder
 * that returns `[]` for a refusal is indistinguishable, at the call site, from
 * one that returns `[]` for a genuinely empty estate.
 *
 * That is `lib/aws/read.ts`'s founding defect wearing a different hat. The type
 * makes it impossible to reach `read.value` without narrowing; it cannot make it
 * impossible to DROP the narrowed result on the floor and render a zero. So the
 * question "is an empty table a claim here?" is asked once, explicitly, of the
 * reads themselves rather than of the rows they produced.
 *
 * `EMPTY` counts as answered — that is the one arm that IS the claim. `STALE`
 * counts too: it carries a value that was really read, just not recently, and
 * the card's own `StaleIndicator` is what says so.
 */
export function mayClaimEmpty(reads: readonly AwsRead<unknown>[]): boolean {
  return reads.every((read) => readAnswered(read.state))
}

/** The stamp every card carries. Never invented — null renders as an admission. */
export function asOf(at: string | null): string {
  return at === null ? "This reading carries no timestamp, so it cannot be aged." : `As of ${at}.`
}

/** One sentence saying what a card is, with the instant it describes. */
export function statedAsOf(what: string, at: string | null): string {
  const trimmed = what.trim()
  const sentence = trimmed.endsWith(".") ? trimmed : `${trimmed}.`
  return `${sentence} ${asOf(at)}`
}

/* ─────────────────────────────────────── what is about to interrupt: RDS ── */

/** One RDS maintenance action AWS has queued, with the date it stops being optional. */
export interface MaintenanceRow {
  key: string
  instanceId: string
  action: string
  /** The reader's own sentence for the schedule. `FORCED on …` when there is a date. */
  when: string
  /** Set only when AWS returned a `ForcedApplyDate`. Sorted on, and printed alone. */
  forcedOn: string | null
  interrupts: boolean
  optInStatus: string | null
  description: string | null
  risk: DataRisk
}

/**
 * Every queued RDS action, forced ones first and soonest first inside that.
 *
 * A forced action is the only thing on this page with a date on which somebody
 * else acts, so it is sorted to the top by that date rather than by instance
 * name. Interrupting-but-not-forced comes next, because it is the set an
 * operator schedules around; everything else is housekeeping.
 *
 * Reads `ScheduledOutage` rather than the instance rows: `database.ts` already
 * separated "AWS has nothing queued" from "we could not read what AWS has
 * queued", and re-deriving that here would be a second chance to get it wrong.
 */
export function maintenanceRows(outage: ScheduledOutage): readonly MaintenanceRow[] {
  if (outage.kind !== "pending") return []
  const rows = outage.actions.map((queued): MaintenanceRow => {
    const schedule = queued.action.schedule
    const forcedOn = schedule.kind === "forced" ? schedule.forcedApplyDate : null
    return {
      key: `${queued.instanceId}:${queued.action.action}`,
      instanceId: queued.instanceId,
      action: queued.action.action,
      when: describeOutageSchedule(schedule),
      forcedOn,
      interrupts: queued.action.interrupts,
      optInStatus: queued.action.optInStatus,
      description: queued.action.description,
      risk: forcedOn !== null || queued.action.interrupts ? "FORCED_INTERRUPTION" : "ROUTINE",
    }
  })
  return [...rows].sort((a, b) => {
    if (a.forcedOn !== null && b.forcedOn !== null) {
      if (a.forcedOn !== b.forcedOn) return a.forcedOn < b.forcedOn ? -1 : 1
      return a.key.localeCompare(b.key)
    }
    if (a.forcedOn !== null) return -1
    if (b.forcedOn !== null) return 1
    if (a.interrupts !== b.interrupts) return a.interrupts ? -1 : 1
    return a.key.localeCompare(b.key)
  })
}

/** One thing that happened to a database, in the window `database.ts` reads. */
export interface DatabaseEventRow {
  key: string
  instanceId: string
  at: string
  significance: EventSignificance
  message: string | null
}

/** The three significances this page reports, and nothing else. */
const REPORTED_SIGNIFICANCE: ReadonlySet<EventSignificance> = new Set<EventSignificance>([
  "failover",
  "restart",
  "low-storage",
])

/**
 * Recent failovers, restarts and low-storage events, newest first.
 *
 * `unread` names every instance whose `rds:DescribeEvents` did not answer.
 * Without it an estate where the event read is refused renders an empty table,
 * which reads as "nothing has happened to these databases" — the exact sentence
 * this console must never produce from a refusal.
 */
export function databaseEventRows(instances: AwsRead<readonly DatabaseInstanceReading[]>): {
  rows: readonly DatabaseEventRow[]
  unread: readonly string[]
} {
  const rows: DatabaseEventRow[] = []
  const unread: string[] = []
  for (const instance of itemsOf(instances)) {
    if (!readAnswered(instance.events.state)) {
      unread.push(instance.instanceId)
      continue
    }
    if (instance.events.state !== "ACTUAL" && instance.events.state !== "STALE") continue
    for (const event of instance.events.value.events) {
      if (!REPORTED_SIGNIFICANCE.has(event.significance)) continue
      rows.push({
        key: `${instance.instanceId}:${event.at}:${event.significance}`,
        instanceId: instance.instanceId,
        at: event.at,
        significance: event.significance,
        message: event.message,
      })
    }
  }
  rows.sort((a, b) => (a.at === b.at ? a.key.localeCompare(b.key) : a.at < b.at ? 1 : -1))
  return { rows, unread }
}

/* ─────────────────────────────── what is about to interrupt: ElastiCache ── */

/** One queued ElastiCache change, and whether applying it stops the node. */
export interface CacheChangeRow {
  key: string
  resourceId: string
  resourceKind: "cluster" | "replication group"
  field: string
  from: string | null
  to: string
  restarts: boolean
  why: string
  risk: DataRisk
}

/** Queued cache changes, the restarting ones first. */
export function cacheChangeRows(interruption: ScheduledInterruption): readonly CacheChangeRow[] {
  if (interruption.kind !== "pending") return []
  const rows = interruption.changes.map(
    (queued): CacheChangeRow => ({
      key: `${queued.resourceKind}:${queued.resourceId}:${queued.change.field}`,
      resourceId: queued.resourceId,
      resourceKind: queued.resourceKind,
      field: queued.change.field,
      from: queued.change.from,
      to: queued.change.to,
      restarts: queued.change.restarts,
      why: queued.change.why,
      risk: queued.change.restarts ? "FORCED_INTERRUPTION" : "ROUTINE",
    }),
  )
  return [...rows].sort((a, b) => {
    if (a.restarts !== b.restarts) return a.restarts ? -1 : 1
    return a.key.localeCompare(b.key)
  })
}

/* ────────────────────────────────────────────────────── DynamoDB tables ── */

/** One DynamoDB table, with the three facts this page ranks on. */
export interface TableRow {
  key: string
  name: string
  isRegistry: boolean
  pitr: string
  deletionProtection: string
  encryption: string
  concerns: readonly string[]
  risk: DataRisk
}

/**
 * The risk of one table's point-in-time recovery reading.
 *
 * Split out because it is the fact the registry is ranked on and the one the
 * verdict escalates: `enabled` is the only arm that is not a finding, `disabled`
 * is a finding, and `unstated` — AWS answered without a
 * `PointInTimeRecoveryDescription` — is UNKNOWN and never `enabled`.
 */
function pitrRisk(read: AwsRead<PointInTimeRecovery>, isRegistry: boolean): DataRisk {
  if (read.state !== "ACTUAL" && read.state !== "STALE") return "UNKNOWN"
  if (read.value.kind === "enabled") return "PROTECTED"
  if (read.value.kind === "unstated") return "UNKNOWN"
  return isRegistry ? "REGISTRY_UNRECOVERABLE" : "UNRECOVERABLE"
}

/**
 * Every table, the registry first and the rest worst-first.
 *
 * The registry is pinned to index 0 whatever its risk. That is deliberate and it
 * is the one place on this page where the ordering is not purely by severity: an
 * operator opening this card is asking about the fleet's own record of itself
 * before they are asking about anything else, and a clean registry sorted into
 * the middle of forty tables is a fact they have to hunt for.
 */
export function tableRows(readings: DynamoDbReadings): readonly TableRow[] {
  const rows = itemsOf(readings.tables).map((table): TableRow => {
    const concerns: string[] = []
    const risks: DataRisk[] = []

    const pitr = pitrRisk(table.backups, table.isTenantRegistry)
    risks.push(pitr)
    if (pitr !== "PROTECTED") {
      concerns.push(
        pitr === "UNKNOWN"
          ? "point-in-time recovery could not be established"
          : "point-in-time recovery is off — there is no restore",
      )
    }

    if (table.detail.state === "ACTUAL" || table.detail.state === "STALE") {
      const detail = table.detail.value
      if (detail.deletionProtection.kind === "disabled") {
        risks.push("DELETABLE")
        concerns.push("deletion protection is off — one DeleteTable call removes it")
      } else if (detail.deletionProtection.kind === "unstated") {
        risks.push("UNKNOWN")
        concerns.push("AWS did not say whether deletion protection is on")
      }
      if (detail.encryption.kind === "inaccessible") {
        risks.push("PLAINTEXT")
        concerns.push("the encryption key is unreachable — the table cannot be read at all")
      } else if (detail.encryption.kind === "unstated") {
        risks.push("UNKNOWN")
        concerns.push("AWS returned an encryption description this engine does not recognise")
      }
    } else {
      risks.push("UNKNOWN")
      concerns.push("this table's DescribeTable did not answer")
    }

    return {
      key: table.name,
      name: table.name,
      isRegistry: table.isTenantRegistry,
      pitr: describeTablePitr(table),
      deletionProtection:
        table.detail.state === "ACTUAL" || table.detail.state === "STALE"
          ? describeDeletionProtection(table.detail.value.deletionProtection)
          : "unknown — DescribeTable did not answer",
      encryption:
        table.detail.state === "ACTUAL" || table.detail.state === "STALE"
          ? describeTableEncryption(table.detail.value.encryption, table.keyManagement)
          : "unknown — DescribeTable did not answer",
      concerns,
      risk: worstRisk(risks),
    }
  })

  return [...rows].sort((a, b) => {
    if (a.isRegistry !== b.isRegistry) return a.isRegistry ? -1 : 1
    if (RISK_RANK[a.risk] !== RISK_RANK[b.risk]) return RISK_RANK[a.risk] - RISK_RANK[b.risk]
    return a.name.localeCompare(b.name)
  })
}

/** The PITR sentence, from the reader, with the read's own state when it failed. */
function describeTablePitr(table: TableReading): string {
  if (table.backups.state === "ACTUAL" || table.backups.state === "STALE") {
    return describePointInTimeRecovery(table.backups.value)
  }
  return `unknown — dynamodb:DescribeContinuousBackups did not answer (${table.backups.state})`
}

/* ──────────────────────────────────────────────────────────── S3 buckets ── */

/** One bucket, with the four facts this page ranks on. */
export interface BucketRow {
  key: string
  name: string
  publicAccess: string
  policyStatus: string
  encryption: string
  versioning: string
  concerns: readonly string[]
  risk: DataRisk
}

/**
 * Every bucket, public access ranked hardest.
 *
 * Two independent facts produce PUBLIC and either alone is enough: S3's own
 * `GetBucketPolicyStatus` saying `IsPublic`, and a public-access block that is
 * absent or has any one of its four flags off. They are separate grants and a
 * role routinely holds one without the other, so requiring both would make a
 * missing permission read as a closed bucket.
 */
export function bucketRows(readings: S3Readings): readonly BucketRow[] {
  const rows = itemsOf(readings.buckets).map((bucket): BucketRow => {
    const concerns: string[] = []
    const risks: DataRisk[] = []

    if (bucket.policyStatus.state === "ACTUAL" || bucket.policyStatus.state === "STALE") {
      if (bucket.policyStatus.value.kind === "public") {
        risks.push("PUBLIC")
        concerns.push("S3 itself reports this bucket as public")
      }
    } else {
      risks.push("UNKNOWN")
      concerns.push("whether S3 considers this bucket public could not be read")
    }

    if (
      bucket.publicAccessBlock.state === "ACTUAL" ||
      bucket.publicAccessBlock.state === "STALE"
    ) {
      const gaps = publicAccessGaps(bucket.publicAccessBlock.value)
      if (gaps.length > 0) {
        risks.push("PUBLIC")
        concerns.push(`public-access block incomplete: ${gaps.join(", ")} not set`)
      }
    } else {
      risks.push("UNKNOWN")
      concerns.push("the public-access block could not be read")
    }

    if (bucket.encryption.state === "ACTUAL" || bucket.encryption.state === "STALE") {
      if (bucket.encryption.value.kind === "none") {
        risks.push("PLAINTEXT")
        concerns.push("no default encryption rule — new objects are not encrypted by the bucket")
      } else if (bucket.encryption.value.kind === "unrecognised") {
        risks.push("UNKNOWN")
        concerns.push(
          `default encryption uses ${bucket.encryption.value.algorithm}, which this engine does not recognise`,
        )
      }
    } else {
      risks.push("UNKNOWN")
      concerns.push("default encryption could not be read")
    }

    if (bucket.versioning.state === "ACTUAL" || bucket.versioning.state === "STALE") {
      if (bucket.versioning.value.status !== "Enabled") {
        risks.push("UNRECOVERABLE")
        concerns.push(
          bucket.versioning.value.status === "Suspended"
            ? "versioning was enabled and is now suspended — an overwrite is final"
            : "versioning has never been enabled — an overwrite or a delete is final",
        )
      }
    } else {
      risks.push("UNKNOWN")
      concerns.push("versioning could not be read")
    }

    return {
      key: bucket.name,
      name: bucket.name,
      publicAccess: describePublicAccessBlock(bucket.publicAccessBlock),
      policyStatus: describePolicyStatus(bucket.policyStatus),
      encryption: describeBucketEncryption(bucket.encryption),
      versioning: describeVersioning(bucket.versioning),
      concerns,
      risk: worstRisk(risks),
    }
  })

  return [...rows].sort((a, b) => {
    if (RISK_RANK[a.risk] !== RISK_RANK[b.risk]) return RISK_RANK[a.risk] - RISK_RANK[b.risk]
    return a.name.localeCompare(b.name)
  })
}

/* ──────────────────────────────────────────────────────────── ElastiCache ── */

/** One cache, with encryption on both legs and whether it survives a node loss. */
export interface CacheRow {
  key: string
  id: string
  kind: "cluster" | "replication group"
  atRest: string
  inTransit: string
  failover: string
  concerns: readonly string[]
  risk: DataRisk
}

/**
 * Encryption and failover for one cache, whichever kind it is.
 *
 * A cluster that is a member of a replication group answers `member-of-group`
 * for failover, which is neither a finding nor a pass — the group answers it,
 * and the group is its own row. Counting the member as "no failover" is a false
 * alarm an operator would act on, so it is not counted at all.
 */
function cacheRowFrom(
  id: string,
  kind: "cluster" | "replication group",
  cache: Pick<CacheClusterReading, "atRest" | "inTransit" | "failover">,
): CacheRow {
  const concerns: string[] = []
  const risks: DataRisk[] = []

  for (const [state, what] of [
    [cache.atRest, "at rest"],
    [cache.inTransit, "in transit"],
  ] as const) {
    if (state.kind === "disabled") {
      risks.push("PLAINTEXT")
      concerns.push(`not encrypted ${what}`)
    } else if (state.kind === "unstated") {
      risks.push("UNKNOWN")
      concerns.push(`AWS did not state encryption ${what}`)
    }
  }

  switch (cache.failover.kind) {
    case "single-node":
      risks.push("NO_FAILOVER")
      concerns.push("one node and no replica — losing it loses the cache until it is rebuilt")
      break
    case "multi-node-no-failover":
    case "failover-disabled":
      risks.push("NO_FAILOVER")
      concerns.push("more than one node and no automatic failover")
      break
    case "in-transition":
    case "unknown":
      risks.push("UNKNOWN")
      concerns.push("whether this cache survives a node loss could not be established")
      break
    case "automatic-failover":
    case "member-of-group":
      break
  }

  return {
    key: `${kind}:${id}`,
    id,
    kind,
    atRest: describeEncryptionState(cache.atRest, "at rest"),
    inTransit: describeEncryptionState(cache.inTransit, "in transit"),
    failover: describeFailover(cache.failover),
    concerns,
    risk: worstRisk(risks),
  }
}

/** Every cluster and every replication group, worst first. */
export function cacheRows(readings: ElastiCacheReadings): readonly CacheRow[] {
  const clusters = itemsOf<CacheClusterReading>(readings.clusters).map((cluster) =>
    cacheRowFrom(cluster.clusterId, "cluster", cluster),
  )
  const groups = itemsOf<ReplicationGroupReading>(readings.replicationGroups).map((group) =>
    cacheRowFrom(group.replicationGroupId, "replication group", group),
  )
  return [...clusters, ...groups].sort((a, b) => {
    if (RISK_RANK[a.risk] !== RISK_RANK[b.risk]) return RISK_RANK[a.risk] - RISK_RANK[b.risk]
    return a.key.localeCompare(b.key)
  })
}

/* ───────────────────────────────────────────── restore points, by store ── */

/**
 * The newest moment one store could be restored to.
 *
 * `ageMs` is null when there is no restorable time at all, and the row is sorted
 * first in that case: "there is no restore point" and "the restore point is old"
 * are both findings, and the first outranks the second.
 *
 * The age is a NUMBER here rather than a formatted string. `components/md3`
 * already owns the wording of an age and importing it into this module would
 * pull React into a file whose whole purpose is to be drivable without it.
 */
export interface RecoveryRow {
  key: string
  resource: string
  /** Which continuous-backup mechanism this came from, named, never implied. */
  source: string
  newestAt: string | null
  ageMs: number | null
  detail: string
  risk: DataRisk
}

/**
 * Every store's newest restore point, from the two mechanisms that have one.
 *
 * RDS automated backups and DynamoDB point-in-time recovery are continuous, so
 * each carries its own latest restorable time and this is a real per-resource
 * answer. AWS Backup recovery points are NOT here, and the page says so in
 * words: the only reader in this console that lists them
 * (`lib/aws/retained.ts`) filters them to a single tenant and does not carry
 * `CreationDate` through into `RetainedResource`, so there is no honest way to
 * age them from this surface. Rendering a vault's points without their dates
 * would be a panel that looks like an answer and is not one.
 */
export function recoveryRows(
  instances: AwsRead<readonly DatabaseInstanceReading[]>,
  tables: AwsRead<readonly TableReading[]>,
  nowMs: number,
): readonly RecoveryRow[] {
  const rows: RecoveryRow[] = []

  for (const instance of itemsOf(instances)) {
    const point = instance.recoveryPoint
    rows.push({
      key: `rds:${instance.instanceId}`,
      resource: instance.instanceId,
      source: "RDS automated backups",
      newestAt: point.kind === "restorable" ? point.at : null,
      ageMs: point.kind === "restorable" ? point.ageMs : null,
      detail: `${describeRecoveryPoint(point)} · ${describeBackup(instance.backup)}`,
      risk:
        point.kind === "restorable"
          ? point.stale
            ? "UNRECOVERABLE"
            : "PROTECTED"
          : "UNRECOVERABLE",
    })
  }

  for (const table of itemsOf(tables)) {
    if (table.backups.state !== "ACTUAL" && table.backups.state !== "STALE") {
      rows.push({
        key: `ddb:${table.name}`,
        resource: table.name,
        source: "DynamoDB point-in-time recovery",
        newestAt: null,
        ageMs: null,
        detail: `unknown — dynamodb:DescribeContinuousBackups did not answer (${table.backups.state})`,
        risk: "UNKNOWN",
      })
      continue
    }
    const pitr = table.backups.value
    if (pitr.kind !== "enabled") {
      rows.push({
        key: `ddb:${table.name}`,
        resource: table.name,
        source: "DynamoDB point-in-time recovery",
        newestAt: null,
        ageMs: null,
        detail: describePointInTimeRecovery(pitr),
        risk: pitr.kind === "disabled" ? "UNRECOVERABLE" : "UNKNOWN",
      })
      continue
    }
    const latest = pitr.latestRestorableAt
    const parsed = latest === null ? Number.NaN : Date.parse(latest)
    const ageMs = Number.isFinite(parsed) ? nowMs - parsed : null
    rows.push({
      key: `ddb:${table.name}`,
      resource: table.name,
      source: "DynamoDB point-in-time recovery",
      newestAt: latest,
      ageMs,
      detail: describePointInTimeRecovery(pitr),
      // PITR is on: the restore exists. An age this engine could not compute is
      // an unknown age, not an unknown restore, so the row stays PROTECTED and
      // the missing age is printed in its own column.
      risk: "PROTECTED",
    })
  }

  return rows.sort((a, b) => {
    if (RISK_RANK[a.risk] !== RISK_RANK[b.risk]) return RISK_RANK[a.risk] - RISK_RANK[b.risk]
    if (a.ageMs === null && b.ageMs !== null) return -1
    if (b.ageMs === null && a.ageMs !== null) return 1
    if (a.ageMs !== null && b.ageMs !== null && a.ageMs !== b.ageMs) return b.ageMs - a.ageMs
    return a.key.localeCompare(b.key)
  })
}

/* ────────────────────────────────────────────────────────────── the lead ── */

/**
 * Everything the one-line answer is computed from.
 *
 * A struct of already-derived rows rather than the four `*Readings` objects,
 * for two reasons. The rows are where the per-resource decisions were made and
 * re-deriving them here would be a second implementation of the same rule. And
 * a test can construct this in four lines, which is what makes the arms that
 * only appear during an incident — a public bucket, a forced upgrade, an estate
 * where every read was refused — reachable at all.
 *
 * Every field is REQUIRED. An optional field on this type would be a field a
 * caller can omit invisibly to `tsc`, and the field most likely to be omitted is
 * `unknowns` — which is the one that stops this page printing PROTECTED over a
 * refusal. There is exactly one production construction site: `page.tsx` in this
 * directory.
 */
export interface VerdictInput {
  registry: RegistryProtection
  tables: readonly TableRow[]
  buckets: readonly BucketRow[]
  caches: readonly CacheRow[]
  maintenance: readonly MaintenanceRow[]
  cacheChanges: readonly CacheChangeRow[]
  recovery: readonly RecoveryRow[]
  /** Every read that did not answer, already worded by `describeRead`. */
  unknowns: readonly string[]
}

export interface ProtectionVerdict {
  risk: DataRisk
  word: string
  tone: VerdictTone
  /** The one line this page leads with, in the operator's words. */
  headline: string
  /** Every finding behind it, worst first. Never empty when `risk` is a finding. */
  findings: readonly string[]
  /** Whether the reads this verdict rests on all answered. */
  complete: boolean
}

/** The risk the registry itself contributes, and the sentence that says why. */
function registryFinding(registry: RegistryProtection): { risk: DataRisk; finding: string } | null {
  switch (registry.kind) {
    case "no-point-in-time-recovery":
      return {
        risk: "REGISTRY_UNRECOVERABLE",
        finding:
          `The tenant registry ${registry.tableName} has NO point-in-time recovery. ` +
          `If it is corrupted or deleted there is no restore, and the fleet's own record ` +
          `of which tenants exist and what was provisioned for them goes with it.`,
      }
    case "missing":
      return {
        risk: "REGISTRY_UNRECOVERABLE",
        finding:
          `The table TENANT_TABLE names — ${registry.tableName} — is not in this region. ` +
          `Either the fleet's registry is gone or this engine is pointed at the wrong table. ` +
          `Both mean nothing on this page can be trusted to describe the whole fleet.`,
      }
    case "unnamed":
      return {
        risk: "UNKNOWN",
        finding: `This engine does not know which table is the tenant registry — ${registry.why}`,
      }
    case "unknown":
      return {
        risk: "UNKNOWN",
        finding: `The tenant registry ${registry.tableName} could not be read — ${registry.why}`,
      }
    case "protected":
      return registry.weaknesses.length === 0
        ? null
        : {
            risk: "DELETABLE",
            finding:
              `The tenant registry ${registry.tableName} is recoverable, and is not otherwise ` +
              `clean: ${registry.weaknesses.join("; ")}.`,
          }
  }
}

/**
 * The answer, in one line.
 *
 * ── The guard that must never be switched off ───────────────────────────────
 *
 * `PROTECTED` is returned only when `unknowns` is empty. Not "mostly empty", not
 * "empty except identity". This console's own e2e environment cannot reach AWS
 * at all, so every read there lands in a valueless arm — and a page that prints
 * "everything is protected" from nine refusals would pass every screenshot,
 * satisfy every reviewer, and be wrong on the only morning it mattered.
 */
export function verdictOf(input: VerdictInput): ProtectionVerdict {
  const findings: { risk: DataRisk; text: string }[] = []

  const registry = registryFinding(input.registry)
  if (registry) findings.push({ risk: registry.risk, text: registry.finding })

  const openBuckets = input.buckets.filter((row) => row.risk === "PUBLIC")
  if (openBuckets.length > 0) {
    findings.push({
      risk: "PUBLIC",
      text:
        `${openBuckets.length} bucket(s) are open to the internet or have a public-access ` +
        `block that is not fully set: ${openBuckets.map((row) => row.name).join(", ")}.`,
    })
  }

  const unrecoverable = input.recovery.filter((row) => row.risk === "UNRECOVERABLE")
  if (unrecoverable.length > 0) {
    findings.push({
      risk: "UNRECOVERABLE",
      text:
        `${unrecoverable.length} store(s) have no usable restore point: ` +
        `${unrecoverable.map((row) => row.resource).join(", ")}.`,
    })
  }

  const unversioned = input.buckets.filter((row) => row.risk === "UNRECOVERABLE")
  if (unversioned.length > 0) {
    findings.push({
      risk: "UNRECOVERABLE",
      text:
        `${unversioned.length} bucket(s) have no versioning, so an overwrite or a delete is ` +
        `final: ${unversioned.map((row) => row.name).join(", ")}.`,
    })
  }

  const plaintext = [
    ...input.caches.filter((row) => row.risk === "PLAINTEXT").map((row) => row.id),
    ...input.buckets.filter((row) => row.risk === "PLAINTEXT").map((row) => row.name),
    ...input.tables.filter((row) => row.risk === "PLAINTEXT").map((row) => row.name),
  ]
  if (plaintext.length > 0) {
    findings.push({
      risk: "PLAINTEXT",
      text: `${plaintext.length} store(s) are not encrypted, or their key is unreachable: ${plaintext.join(", ")}.`,
    })
  }

  const forced = input.maintenance.filter((row) => row.forcedOn !== null)
  if (forced.length > 0) {
    findings.push({
      risk: "FORCED_INTERRUPTION",
      text:
        `AWS will apply ${forced.length} maintenance action(s) whether or not anybody opts in — ` +
        `soonest ${forced[0].forcedOn} on ${forced[0].instanceId} (${forced[0].action}).`,
    })
  }
  const restarting = input.cacheChanges.filter((row) => row.restarts)
  if (restarting.length > 0) {
    findings.push({
      risk: "FORCED_INTERRUPTION",
      text:
        `${restarting.length} queued cache change(s) restart the node when applied: ` +
        `${restarting.map((row) => `${row.resourceId} (${row.field})`).join(", ")}.`,
    })
  }

  const noFailover = input.caches.filter((row) => row.risk === "NO_FAILOVER")
  if (noFailover.length > 0) {
    findings.push({
      risk: "NO_FAILOVER",
      text:
        `${noFailover.length} cache(s) do not survive losing a node: ` +
        `${noFailover.map((row) => row.id).join(", ")}.`,
    })
  }

  const deletable = input.tables.filter((row) => row.risk === "DELETABLE")
  if (deletable.length > 0) {
    findings.push({
      risk: "DELETABLE",
      text:
        `${deletable.length} table(s) have deletion protection off: ` +
        `${deletable.map((row) => row.name).join(", ")}.`,
    })
  }

  findings.sort((a, b) => RISK_RANK[a.risk] - RISK_RANK[b.risk])
  const complete = input.unknowns.length === 0

  /*
   * THE GUARD. A finding outranks an unknown — a public bucket is still public
   * when the cache read was refused — but the absence of findings is NOT a pass
   * while anything went unread. `worstRisk([])` is PROTECTED, and this is the
   * line that stops that reaching the badge.
   */
  const found = worstRisk(findings.map((finding) => finding.risk))
  const risk: DataRisk = found === "PROTECTED" && !complete ? "UNKNOWN" : found

  return {
    risk,
    word: RISK_WORD[risk],
    tone: RISK_TONE[risk],
    headline: headlineFor(risk, findings[0]?.text ?? null, input),
    findings: findings.map((finding) => finding.text),
    complete,
  }
}

/** The lead sentence for a verdict. The finding when there is one, the state otherwise. */
function headlineFor(
  risk: DataRisk,
  worstFinding: string | null,
  input: VerdictInput,
): string {
  if (risk === "PROTECTED") {
    return (
      `Every store this console read is encrypted, has a restore point and is closed to the ` +
      `internet, and AWS has nothing queued that will interrupt one. ` +
      `${input.tables.length} DynamoDB table(s), ${input.buckets.length} bucket(s) and ` +
      `${input.caches.length} cache(s) answered every question this page asks.`
    )
  }
  if (risk === "UNKNOWN" && worstFinding === null) {
    return (
      `This console cannot say whether this platform's state is protected. ` +
      `${input.unknowns.length} read(s) did not answer, and an unanswered read is not a ` +
      `report that there is nothing to find. Each one is named below with the principal, ` +
      `the action and the statement that would fix it.`
    )
  }
  const qualifier = input.unknowns.length === 0
    ? ""
    : ` Beyond this, ${input.unknowns.length} read(s) did not answer, so this is the floor of what is wrong rather than the whole of it.`
  return `${worstFinding ?? RISK_MEANING[risk]}${qualifier}`
}

/*
 * There is deliberately no exposure helper here.
 *
 * The buckets card prints `buckets.ts`'s own `describePublicExposure`, which
 * already qualifies "nothing is public" with the buckets it could NOT fully
 * read. A second sentence written in this file would be a second chance to drop
 * that qualification, which is the whole point of the sentence.
 */

/* ──────────────────────────────────────────────────── where it came from ── */

export interface Provenance {
  label: string
  value: string
  /** True when this read landed in an arm carrying no value. Drives nothing else. */
  unknown: boolean
}

/** One read this page made, named the way an operator would name it. */
export interface ProvenanceRead {
  label: string
  /** What was being asked for, in the operator's language. */
  what: string
  read: AwsRead<unknown>
}

/**
 * Where every fact on this page came from, and what state that read landed in.
 *
 * The sentence is `describeRead`'s, never one written here: it is the one
 * function in the console that turns a reading into words, and a refusal worded
 * differently on this page from the one next to it is how "unknown" quietly
 * becomes "none". `unknown` is derived from the same value rather than passed
 * in, so a caller cannot mark a refusal as answered.
 */
export function provenanceOf(reads: readonly ProvenanceRead[]): readonly Provenance[] {
  return reads.map((entry) => ({
    label: entry.label,
    value: describeRead(entry.read, entry.what),
    unknown: !readAnswered(entry.read.state),
  }))
}

/** Every read that did not answer, worded once, for `VerdictInput.unknowns`. */
export function unknownSentences(reads: readonly ProvenanceRead[]): readonly string[] {
  return provenanceOf(reads)
    .filter((entry) => entry.unknown)
    .map((entry) => `${entry.label} — ${entry.value}`)
}
