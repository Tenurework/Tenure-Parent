/**
 * STUDIO-070-004 (DATABASE) — the RDS facts that decide whether the product is
 * about to be taken offline, and which this console could not see.
 *
 * `infrastructure/terraform/rds.tf` provisions the database the whole tenant
 * plane runs on, and the two reads this engine already had say almost nothing
 * about it. `inventory.ts` calls `rds:DescribeDBInstances` and keeps four
 * fields — the ARN, the identifier, the status and the subnet group — because it
 * is an inventory. `retained.ts` calls `rds:DescribeDBSnapshots` and keeps the
 * ones tagged for a tenant that has stopped serving, because it is a bill.
 * Neither of them answers a question an operator asks at 02:00.
 *
 * The four that matter, and where each comes from:
 *
 * ## "Is a maintenance action pending, and when does it stop being optional"
 *
 * `rds:DescribePendingMaintenanceActions`. A pending action carries up to three
 * dates and they are not interchangeable. `ForcedApplyDate` is the one that
 * matters: on that date AWS applies the action whether or not anybody opted in,
 * during or OUTSIDE the preferred maintenance window, and for an engine-version
 * upgrade that is a restart nobody scheduled and nobody was told about.
 * `AutoAppliedAfterDate` is softer — the next window on or after that date.
 * `CurrentApplyDate` is where it currently sits, which moves when somebody opts
 * in. `OutageSchedule` keeps all four cases apart, most-binding first, because a
 * console that renders "pending" as one badge has flattened the difference
 * between "sometime" and "Tuesday, ready or not".
 *
 * ## "Did this instance restart, and why"
 *
 * `rds:DescribeEvents` over the last window. Classification is keyed on AWS's
 * own `EventCategories` — `failover`, `availability`, `low storage`,
 * `read replica`, `failure` — rather than on message text, for the reason
 * `read.ts` matches error NAMES rather than messages: the wording changes
 * between releases and a rule keyed on it degrades silently to "other", which
 * renders as a quiet night. The message is carried alongside because it is the
 * only place the *reason* is written down, and a category with no message tells
 * an operator that something happened and nothing about what.
 *
 * ## "Is storage autoscaling on, and how close is it to the ceiling"
 *
 * `MaxAllocatedStorage` on the instance description is the autoscaling ceiling;
 * its ABSENCE is how AWS says autoscaling is off, so the absent case is a state
 * of its own (`fixed`) and never a zero. What this is NOT is free disk space:
 * that is a CloudWatch `FreeStorageSpace` metric and this module does not have
 * it. `StorageHeadroom` says which of the two it is measuring in its own `why`,
 * because "94% of the ceiling" and "94% full" are different emergencies.
 *
 * ## "Is rds.force_ssl actually set" — and the honest answer is: not from here
 *
 * A parameter VALUE needs `rds:DescribeDBParameters`, and that capability is not
 * in `capabilities.ts`. This module does not get to add one. So every instance
 * carries an `SslEnforcement` whose only arm is NOT_READABLE, naming the
 * capability and the IAM action that would answer it — the same one-armed shape
 * `elasticache.ts` uses for engine-version currency, and for the same reason: a
 * field that could be silently absent renders as reassurance.
 *
 * What IS readable is which parameter groups are attached and whether they are
 * AWS's engine-default groups. RDS names the engine default `default.<family>`
 * and a default group cannot be modified at all, so an instance sitting on one
 * is provably running every parameter at its engine default — which is a real
 * fact about `rds.force_ssl` without being a claim about its value. An instance
 * on a custom group is provably NOT provable from here. Both sentences are in
 * the `why`; neither of them says "SSL is enforced".
 *
 * Backup retention and the latest restorable time travel with the snapshots the
 * existing reader already sees, because they are the same question asked twice:
 * `BackupRetentionPeriod = 0` means there is no point-in-time recovery at all,
 * and a `LatestRestorableTime` an hour behind means the recovery point an
 * operator thinks they have is an hour older than they think.
 *
 * ## Region and partition
 *
 * From the resolved identity — `sts:GetCallerIdentity` for the account and the
 * partition, the SDK's own resolved region — and from the ARN RDS returns on
 * each instance. There is no literal region in this file and no `"aws"`
 * fallback: GE-010-007 was a data-residency defect caused by exactly that.
 *
 * ## Sub-calls degrade independently
 *
 * Six reads happen here and each fails on its own: the instance listing, the
 * account-wide pending-maintenance listing, the parameter-group listing, the
 * snapshot listing, the tag index, and one `DescribeEvents` per instance. A
 * denied `rds:DescribePendingMaintenanceActions` does not collapse the instance
 * rows to UNKNOWN — it makes each row's `pendingMaintenance` a `not-read` arm
 * that names the refused action, and `not-read` is deliberately NOT `none`. A
 * denied `DescribeEvents` for one instance leaves that row's events DENIED,
 * naming that action, and every other fact about the instance stands.
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
 * How many `Marker` pages to walk on any one listing.
 *
 * `client.ts` asks for `MaxRecords: 100` on the maintenance, event and
 * parameter-group calls, so this is two thousand rows before the engine stops.
 * A page loop with no bound is how one server render with a person waiting
 * becomes an outage; a reader that silently returns the first page is the same
 * lie as an empty list. Hitting the cap is therefore neither — it is reported in
 * `Truncation`, and the surface prints it.
 */
export const MAX_PAGES = 20

/**
 * How many instances get their event history read in one load.
 *
 * `rds:DescribeEvents` is one call per instance and cannot be batched. The
 * estate declares one database; the cap exists so an account that has grown two
 * hundred does not turn one page render into two hundred paged calls. Instances
 * past the cap carry an UNCONFIGURED event read whose `why` says the engine
 * stopped — which is a different sentence from "this instance had no events".
 */
export const MAX_EVENT_INSTANCE_READS = 25

/** How many event reads are in flight at once. Bounded so a load is not a burst. */
const EVENT_CONCURRENCY = 4

/**
 * How far back the event read looks, in minutes.
 *
 * A day. Long enough to cover the night a database restarted itself, which is
 * the read's whole purpose; `client.ts` defaults to the same number and this
 * passes it explicitly so the window is a stated property of the reading rather
 * than a default two files away.
 */
export const EVENT_WINDOW_MINUTES = 1440

/**
 * Where "close to the ceiling" starts, as a percentage of `MaxAllocatedStorage`.
 *
 * Ninety, because RDS storage autoscaling adds capacity in steps and an instance
 * already at ninety percent of a ceiling it may not raise has one step left. A
 * named constant rather than a literal at the call site: the number is an
 * argument about the resource and an argument needs somewhere to live.
 */
export const STORAGE_CEILING_WARN_PERCENT = 90

/**
 * How old a recovery point may be before it is worth saying out loud.
 *
 * RDS advances `LatestRestorableTime` roughly every five minutes. Thirty
 * minutes is six of those, which is past jitter and into "something is wrong
 * with the backup pipeline for this instance".
 */
export const RECOVERY_POINT_STALE_MS = 30 * 60_000

/**
 * The parameter that decides whether the database refuses an unencrypted
 * connection, per engine family.
 *
 * PostgreSQL spells it `rds.force_ssl`; MySQL and MariaDB spell the same
 * decision `require_secure_transport`. Named here so the sentence an operator
 * reads names the parameter that exists on THEIR engine — telling a MySQL
 * operator to check `rds.force_ssl` sends them looking for a parameter their
 * engine does not have.
 */
export const SSL_PARAMETERS: Readonly<Record<string, string>> = {
  postgres: "rds.force_ssl",
  "aurora-postgresql": "rds.force_ssl",
  mysql: "require_secure_transport",
  "aurora-mysql": "require_secure_transport",
  mariadb: "require_secure_transport",
}

/** The capability that would answer a parameter's value, and does not exist here. */
export const PARAMETER_VALUE_CAPABILITY = "rds:DescribeDBParameters"

/* ------------------------------------------------------- the API's shapes -- */

/** Declared rather than imported — see `client.ts`'s one-owner rule for SDK types. */
interface DBParameterGroupStatusShape {
  DBParameterGroupName?: string
  ParameterApplyStatus?: string
}

interface PendingModifiedValuesShape {
  DBInstanceClass?: string
  AllocatedStorage?: number
  MasterUserPassword?: string
  Port?: number
  BackupRetentionPeriod?: number
  MultiAZ?: boolean
  EngineVersion?: string
  StorageType?: string
  CACertificateIdentifier?: string
  IAMDatabaseAuthenticationEnabled?: boolean
  DBInstanceIdentifier?: string
}

interface DBInstanceShape {
  DBInstanceIdentifier?: string
  DBInstanceArn?: string
  DbiResourceId?: string
  Engine?: string
  EngineVersion?: string
  DBInstanceClass?: string
  DBInstanceStatus?: string
  AllocatedStorage?: number
  MaxAllocatedStorage?: number
  StorageType?: string
  StorageEncrypted?: boolean
  MultiAZ?: boolean
  PubliclyAccessible?: boolean
  DeletionProtection?: boolean
  BackupRetentionPeriod?: number
  PreferredBackupWindow?: string
  PreferredMaintenanceWindow?: string
  LatestRestorableTime?: string | Date
  AutoMinorVersionUpgrade?: boolean
  DBParameterGroups?: DBParameterGroupStatusShape[]
  PendingModifiedValues?: PendingModifiedValuesShape
  DBSubnetGroup?: { DBSubnetGroupName?: string; VpcId?: string }
}

interface DescribeDBInstancesResponse {
  DBInstances?: DBInstanceShape[]
  Marker?: string
}

interface PendingMaintenanceActionShape {
  Action?: string
  AutoAppliedAfterDate?: string | Date
  ForcedApplyDate?: string | Date
  OptInStatus?: string
  CurrentApplyDate?: string | Date
  Description?: string
}

interface ResourcePendingMaintenanceActionsShape {
  ResourceIdentifier?: string
  PendingMaintenanceActionDetails?: PendingMaintenanceActionShape[]
}

interface DescribePendingMaintenanceActionsResponse {
  PendingMaintenanceActions?: ResourcePendingMaintenanceActionsShape[]
  Marker?: string
}

interface EventShape {
  SourceIdentifier?: string
  SourceType?: string
  Message?: string
  EventCategories?: string[]
  Date?: string | Date
  SourceArn?: string
}

interface DescribeEventsResponse {
  Events?: EventShape[]
  Marker?: string
}

interface DBParameterGroupShape {
  DBParameterGroupName?: string
  DBParameterGroupFamily?: string
  Description?: string
  DBParameterGroupArn?: string
}

interface DescribeDBParameterGroupsResponse {
  DBParameterGroups?: DBParameterGroupShape[]
  Marker?: string
}

interface DBSnapshotShape {
  DBSnapshotIdentifier?: string
  DBSnapshotArn?: string
  DBInstanceIdentifier?: string
  SnapshotCreateTime?: string | Date
  Status?: string
  SnapshotType?: string
  AllocatedStorage?: number
  Encrypted?: boolean
}

interface DescribeDBSnapshotsResponse {
  DBSnapshots?: DBSnapshotShape[]
  Marker?: string
}

/* ---------------------------------------------------------- the vocabulary -- */

/**
 * Whether a listing was walked to the end.
 *
 * Three arms, because "we read everything", "we stopped early and there was
 * more" and "we never read it" are three different things a surface has to be
 * able to say. The middle one is why this type exists: a truncated list rendered
 * as a complete one is the same class of lie as an empty list rendered for a
 * denial.
 */
export type Truncation =
  | { kind: "complete" }
  | {
      kind: "truncated"
      pagesRead: number
      maxPages: number
      /** The marker AWS was still handing back when this engine stopped. */
      nextMarker: string
      why: string
    }
  | { kind: "not-read"; why: string }

/**
 * A boolean AWS may simply not have returned.
 *
 * `unstated` is a state, not a false. Every use of this here is a security or
 * availability property — storage encryption, Multi-AZ, public accessibility —
 * and for all three "AWS did not say" must not render as the safe answer.
 */
export type StatedBoolean =
  | { kind: "yes" }
  | { kind: "no"; why: string }
  | { kind: "unstated"; field: string; why: string }

/**
 * When AWS is allowed to take the instance down for maintenance.
 *
 * `unreadable` exists because a window this engine could not parse must not read
 * as "no window": every RDS instance has one, and "we did not understand it"
 * sends an operator to look at the string, which is the correct next action.
 *
 * Deliberately not shared with `elasticache.ts`'s window type even though the
 * `ddd:hh24:mi` shape matches: RDS's BACKUP window is `hh24:mi-hh24:mi` with no
 * day at all, so this module needs two parsers regardless and a borrowed type
 * whose `why` names ElastiCache would be worse than a local one.
 */
export type MaintenanceWindow =
  | {
      kind: "window"
      raw: string
      startDay: string
      startTimeUtc: string
      endDay: string
      endTimeUtc: string
    }
  | { kind: "absent"; why: string }
  | { kind: "unreadable"; raw: string; why: string }

/** The daily backup window, which has times and no days. */
export type BackupWindow =
  | { kind: "window"; raw: string; startTimeUtc: string; endTimeUtc: string }
  | { kind: "absent"; why: string }
  | { kind: "unreadable"; raw: string; why: string }

/**
 * When a pending maintenance action stops being optional.
 *
 * Ordered by how binding it is, and read in that order: a `ForcedApplyDate` is
 * the answer whenever AWS returned one, because it is the date the action
 * happens regardless of the maintenance window and regardless of anybody's
 * opt-in. Collapsing these four into "pending" is how a forced engine upgrade
 * reads the same as a housekeeping task nobody has to think about.
 */
export type OutageSchedule =
  | {
      kind: "forced"
      /** AWS applies it on this date, in or out of the maintenance window. */
      forcedApplyDate: string
      currentApplyDate: string | null
      why: string
    }
  | {
      kind: "auto-applied-after"
      /** The first maintenance window on or after this date takes it. */
      autoAppliedAfterDate: string
      currentApplyDate: string | null
      why: string
    }
  | { kind: "scheduled"; currentApplyDate: string; why: string }
  | { kind: "unscheduled"; why: string }

/** One action AWS has queued against one database. */
export interface PendingMaintenanceAction {
  /** AWS's own action name: `system-update`, `db-upgrade`, `hardware-maintenance`, `ca-certificate-rotation`. */
  action: string
  /** AWS's sentence about it. The only place the reason is written down. */
  description: string | null
  /** `next-maintenance`, `immediate`, or null when nobody has opted in. */
  optInStatus: string | null
  schedule: OutageSchedule
  /**
   * Whether applying it interrupts the database.
   *
   * True for the actions AWS applies by restarting or replacing the instance.
   * `db-upgrade` and `os-upgrade` restart it; `hardware-maintenance` moves it to
   * new hardware, which on a Single-AZ instance is downtime; a CA rotation needs
   * a reboot to take effect. `system-update` is applied without one. Marking
   * everything as an interruption is how a real one stops being read.
   */
  interrupts: boolean
  why: string
}

/**
 * What this engine knows about one instance's pending maintenance.
 *
 * `not-read` is a separate arm from `none` and always will be. They are the two
 * answers this whole read plane exists to keep apart, and the account-wide
 * maintenance call failing must not make every instance row say "nothing
 * scheduled".
 */
export type PendingMaintenanceView =
  | { kind: "not-read"; why: string }
  | { kind: "none"; why: string }
  | {
      kind: "pending"
      actions: readonly PendingMaintenanceAction[]
      /** The most binding schedule among them — what an operator plans around. */
      soonest: OutageSchedule
    }

/** What an RDS event was about, keyed on AWS's own categories. */
export type EventSignificance =
  | "failover"
  | "restart"
  | "low-storage"
  | "replication"
  | "backup"
  | "configuration"
  | "maintenance"
  | "failure"
  | "other"

/** One thing that happened to a database, with the reason AWS gave. */
export interface DatabaseEvent {
  at: string
  /** AWS's categories verbatim, sorted. The classification's evidence. */
  categories: readonly string[]
  significance: EventSignificance
  /** AWS's message. Null when it returned an event with no message at all. */
  message: string | null
}

/** One instance's event history over the window, already sorted into the questions. */
export interface InstanceEvents {
  instanceId: string
  windowMinutes: number
  events: readonly DatabaseEvent[]
  /** The ones that took the database away, newest first. */
  restarts: readonly DatabaseEvent[]
  failovers: readonly DatabaseEvent[]
  lowStorage: readonly DatabaseEvent[]
  replication: readonly DatabaseEvent[]
  truncation: Truncation
}

/**
 * How much room storage autoscaling has left.
 *
 * `fixed` is how AWS says autoscaling is OFF — it omits `MaxAllocatedStorage`
 * rather than returning a zero — so the absent case is its own arm and never a
 * ceiling of nought. None of these arms is free disk space; see the module
 * header and each arm's `why`.
 */
export type StorageHeadroom =
  | {
      kind: "autoscaling"
      allocatedGib: number
      ceilingGib: number
      headroomGib: number
      /** How far up the autoscaling range the instance currently sits. */
      percentOfCeiling: number
      /** True at or past STORAGE_CEILING_WARN_PERCENT. */
      nearCeiling: boolean
      why: string
    }
  | { kind: "fixed"; allocatedGib: number; why: string }
  | { kind: "unknown"; why: string }

/** Whether point-in-time recovery exists at all, and for how long. */
export type BackupPosture =
  | { kind: "disabled"; why: string }
  | { kind: "retained"; days: number; window: BackupWindow; why: string }
  | { kind: "unknown"; why: string }

/** The most recent moment this database could be restored to. */
export type RecoveryPoint =
  | { kind: "restorable"; at: string; ageMs: number; stale: boolean; why: string }
  | { kind: "none"; why: string }

/** One parameter group attached to an instance, and whether it can differ from the default. */
export interface AttachedParameterGroup {
  name: string
  /** `in-sync`, `pending-reboot`, `applying` — whether the group's values are live. */
  applyStatus: string | null
  /** From the group listing. Null when that listing did not answer or did not carry it. */
  family: string | null
  arn: string | null
  /**
   * Whether this is AWS's unmodifiable engine-default group.
   *
   * `true` is a real fact about every parameter in it, including the SSL one: a
   * `default.<family>` group cannot be modified, so an instance on one is at
   * engine defaults. `false` means the group MAY differ and this engine cannot
   * say how. `null` means the group listing did not answer, so neither.
   */
  engineDefault: boolean | null
  why: string
}

/** What this engine knows about an instance's parameter groups. Never a silent empty. */
export type ParameterGroupView =
  | { kind: "not-read"; why: string }
  | { kind: "none"; why: string }
  | { kind: "attached"; groups: readonly AttachedParameterGroup[] }

/**
 * Whether the database refuses unencrypted connections.
 *
 * One arm, deliberately. The fact lives behind `rds:DescribeDBParameters`, which
 * is not a capability this console holds, and a field that could be silently
 * absent renders as reassurance. What it CAN carry is the parameter's name on
 * this engine and whether the attached groups are unmodifiable engine defaults —
 * facts, neither of which is a claim that SSL is enforced.
 */
export interface SslEnforcement {
  state: "NOT_READABLE"
  needs: typeof PARAMETER_VALUE_CAPABILITY
  iamAction: typeof PARAMETER_VALUE_CAPABILITY
  /** `rds.force_ssl`, `require_secure_transport`, or null for an engine with neither name known. */
  parameter: string | null
  /** All groups engine-default, some custom, or unknown because the listing failed. */
  groupsAreEngineDefault: boolean | null
  why: string
}

/** One queued change on the instance, and whether applying it stops the database. */
export interface PendingChange {
  field: string
  from: string | null
  to: string
  restarts: boolean
  why: string
}

/** One snapshot, reduced to what a recovery conversation needs. */
export interface SnapshotSummary {
  snapshotId: string
  arn: string | null
  createdAt: string | null
  status: string | null
  /** `automated`, `manual`, `awsbackup` — who made it decides who deletes it. */
  type: string | null
  allocatedGib: number | null
}

/** What this engine knows about one instance's snapshots. `not-read` is not `none`. */
export type SnapshotView =
  | { kind: "not-read"; why: string }
  | { kind: "none"; why: string }
  | {
      kind: "snapshots"
      count: number
      automated: number
      manual: number
      /** Newest first. The whole set for this instance, already sorted. */
      snapshots: readonly SnapshotSummary[]
    }

/** Which tenant a database belongs to. `unknown` is "we could not look". */
export type DatabaseAttribution =
  | { kind: "tenant"; tenantSlug: string }
  | { kind: "shared" }
  | { kind: "unattributed" }
  | { kind: "unknown"; why: string }

export interface DatabaseInstanceReading {
  instanceId: string
  arn: string | null
  /** Where the ARN came from, or why there is none. Never silent. */
  arnProvenance: string
  region: string | null
  partition: string | null
  accountId: string | null
  engine: string | null
  engineVersion: string | null
  instanceClass: string | null
  status: string | null
  multiAz: StatedBoolean
  storageEncrypted: StatedBoolean
  publiclyAccessible: StatedBoolean
  deletionProtection: StatedBoolean
  storage: StorageHeadroom
  backup: BackupPosture
  recoveryPoint: RecoveryPoint
  maintenanceWindow: MaintenanceWindow
  autoMinorVersionUpgrade: StatedBoolean
  /** From the account-wide read; `not-read` when it failed, never `none`. */
  pendingMaintenance: PendingMaintenanceView
  /** Changes already queued on the instance itself, distinct from AWS's actions. */
  pendingChanges: readonly PendingChange[]
  parameterGroups: ParameterGroupView
  sslEnforcement: SslEnforcement
  /** Its own read, with its own action named — a denial here is not the listing's. */
  events: AwsRead<InstanceEvents>
  snapshots: SnapshotView
  attribution: DatabaseAttribution
  /** This capability's own declared cadence, from the registry, never retyped. */
  refreshMs: number
  asOf: string
}

/** One parameter group in the account, as the listing returned it. */
export interface ParameterGroupReading {
  name: string
  family: string | null
  description: string | null
  arn: string | null
  engineDefault: boolean
}

/** One snapshot in the account, with the instance it came from. */
export interface SnapshotReading extends SnapshotSummary {
  instanceId: string | null
  encrypted: StatedBoolean
}

/** One resource AWS has queued actions against, as the maintenance listing returned it. */
export interface PendingMaintenanceResource {
  /** The instance ARN AWS keys the actions by. */
  resourceIdentifier: string
  actions: readonly PendingMaintenanceAction[]
}

/** One queued action, attributed to the database it will happen to. */
export interface ScheduledMaintenance {
  instanceId: string
  action: PendingMaintenanceAction
  /** When AWS may take it, for the actions that wait for the window. */
  window: MaintenanceWindow
}

/**
 * Whether anything is queued that will take a database offline.
 *
 * Lifted out of the per-instance row because it is the one RDS fact that is an
 * event with a date on it rather than a property with a value, and because it is
 * the sentence that belongs at the top of a page.
 */
export type ScheduledOutage =
  | { kind: "unknown"; why: string }
  | { kind: "none"; instancesRead: number; unreadable: readonly string[] }
  | {
      kind: "pending"
      actions: readonly ScheduledMaintenance[]
      /** The subset AWS applies on a date whether or not anybody agrees. */
      forced: readonly ScheduledMaintenance[]
      /** The subset that restarts the database. What an operator schedules around. */
      interrupting: readonly ScheduledMaintenance[]
      unreadable: readonly string[]
    }

/** Everything a database surface needs, in one load. */
export interface DatabaseReadings {
  identity: AwsRead<Identity>
  tagged: AwsRead<readonly TaggedResource[]>
  /**
   * The instances. DENIED here is a refused `rds:DescribeDBInstances` and is
   * NEVER `[]` — an operator reading "no databases" when the truth is "we were
   * not allowed to look" is the failure the whole read plane exists against.
   */
  instances: AwsRead<readonly DatabaseInstanceReading[]>
  /** The account-wide maintenance read's own state, so a surface can say why. */
  pendingMaintenance: AwsRead<readonly PendingMaintenanceResource[]>
  parameterGroups: AwsRead<readonly ParameterGroupReading[]>
  snapshots: AwsRead<readonly SnapshotReading[]>
  outage: ScheduledOutage
  truncation: {
    instances: Truncation
    pendingMaintenance: Truncation
    parameterGroups: Truncation
    snapshots: Truncation
  }
  /** When this whole load was assembled. Explicit, so a surface need not invent one. */
  asOf: string
  /** Each capability's own declared cadence, read from the registry, never retyped. */
  refreshMs: {
    instances: number
    pendingMaintenance: number
    events: number
    parameterGroups: number
    snapshots: number
  }
}

/* --------------------------------------------------------------- parsing -- */

const DAY_NAMES: Readonly<Record<string, string>> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
}

const WINDOW_SHAPE = /^([a-z]{3}):([0-2][0-9]):([0-5][0-9])-([a-z]{3}):([0-2][0-9]):([0-5][0-9])$/
const BACKUP_WINDOW_SHAPE = /^([0-2][0-9]):([0-5][0-9])-([0-2][0-9]):([0-5][0-9])$/

/** A string AWS may not have returned. Empty is treated as absent, not as a value. */
function statedString(value: string | undefined | null): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null
}

/** A number AWS may not have returned. Null rather than a zero this engine invented. */
function statedNumber(value: number | undefined | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/** An AWS timestamp, which the SDK hands back as a Date and a fixture as a string. */
export function statedTime(value: string | Date | undefined | null): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value !== "string" || value.trim() === "") return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

/**
 * A boolean AWS may not have returned, with the field named so the remedy is
 * "go and look at THAT field" rather than a `why` every gap shares.
 */
export function statedBoolean(
  value: boolean | undefined,
  field: string,
  resourceId: string,
  noMeans: string,
): StatedBoolean {
  if (value === true) return { kind: "yes" }
  if (value === false) return { kind: "no", why: `RDS returned ${field}=false for ${resourceId}: ${noMeans}` }
  return {
    kind: "unstated",
    field,
    why:
      `RDS answered for ${resourceId} without ${field}. "AWS did not say" is not "AWS said false", ` +
      `and it is emphatically not the safe answer.`,
  }
}

/**
 * AWS's `ddd:hh24:mi-ddd:hh24:mi` maintenance window, in UTC.
 *
 * The window is half the answer to "when will this restart", so a string that
 * does not parse is `unreadable` and never `absent`: every RDS instance has a
 * window, and reporting "none" for one whose format changed would tell an
 * operator there is no scheduled interruption when there is.
 */
export function parseMaintenanceWindow(raw: string | undefined | null): MaintenanceWindow {
  const value = statedString(raw)
  if (!value) {
    return {
      kind: "absent",
      why:
        "RDS did not return a PreferredMaintenanceWindow for this instance. Every instance has " +
        "one, so this is a gap in what was read, not an instance AWS will never touch.",
    }
  }
  const match = WINDOW_SHAPE.exec(value.trim().toLowerCase())
  if (!match) {
    return {
      kind: "unreadable",
      raw: value,
      why: `PreferredMaintenanceWindow ${JSON.stringify(value)} is not AWS's ddd:hh24:mi-ddd:hh24:mi shape`,
    }
  }
  const [, startDay, startHour, startMinute, endDay, endHour, endMinute] = match
  const start = DAY_NAMES[startDay]
  const end = DAY_NAMES[endDay]
  if (!start || !end) {
    return {
      kind: "unreadable",
      raw: value,
      why: `PreferredMaintenanceWindow ${JSON.stringify(value)} names a day this engine does not recognise`,
    }
  }
  return {
    kind: "window",
    raw: value,
    startDay: start,
    startTimeUtc: `${startHour}:${startMinute}`,
    endDay: end,
    endTimeUtc: `${endHour}:${endMinute}`,
  }
}

/**
 * AWS's `hh24:mi-hh24:mi` backup window, in UTC. Days do not appear: it is daily.
 *
 * `absent` is a real answer here and not a gap — an instance with
 * `BackupRetentionPeriod = 0` has no backup window because it takes no backups —
 * so the sentence says which of the two it is rather than assuming.
 */
export function parseBackupWindow(raw: string | undefined | null): BackupWindow {
  const value = statedString(raw)
  if (!value) {
    return {
      kind: "absent",
      why:
        "RDS returned no PreferredBackupWindow. An instance with backup retention of zero has no " +
        "backup window at all; one with retention has a window this engine did not read.",
    }
  }
  const match = BACKUP_WINDOW_SHAPE.exec(value.trim())
  if (!match) {
    return {
      kind: "unreadable",
      raw: value,
      why: `PreferredBackupWindow ${JSON.stringify(value)} is not AWS's hh24:mi-hh24:mi shape`,
    }
  }
  const [, startHour, startMinute, endHour, endMinute] = match
  return {
    kind: "window",
    raw: value,
    startTimeUtc: `${startHour}:${startMinute}`,
    endTimeUtc: `${endHour}:${endMinute}`,
  }
}

/* ----------------------------------------------------- maintenance actions -- */

/**
 * The actions AWS applies by taking the database away.
 *
 * `db-upgrade` and `os-upgrade` restart it. `hardware-maintenance` moves it to
 * different hardware, which on a Single-AZ instance is downtime and on a
 * Multi-AZ one is a failover. A CA certificate rotation needs a reboot before it
 * takes effect. `system-update` is applied without one, and calling it an
 * interruption is how a real one stops being read.
 */
const INTERRUPTING_ACTIONS: ReadonlySet<string> = new Set([
  "db-upgrade",
  "os-upgrade",
  "hardware-maintenance",
  "ca-certificate-rotation",
])

/**
 * When one action stops being optional, read most-binding-first.
 *
 * The order is the whole point. `ForcedApplyDate` wins whenever AWS returned
 * one, because on that date the action is applied outside the maintenance window
 * and without an opt-in; reading `CurrentApplyDate` first would report the
 * softer date for an action that has a hard one, which is the reading an
 * operator plans around and then misses.
 */
export function outageScheduleOf(
  detail: PendingMaintenanceActionShape,
  action: string,
  instanceId: string,
): OutageSchedule {
  const forced = statedTime(detail.ForcedApplyDate)
  const current = statedTime(detail.CurrentApplyDate)
  const auto = statedTime(detail.AutoAppliedAfterDate)

  if (forced) {
    return {
      kind: "forced",
      forcedApplyDate: forced,
      currentApplyDate: current,
      why:
        `AWS applies ${action} to ${instanceId} on ${forced} whether or not anybody opts in, and ` +
        `outside the preferred maintenance window if it has to. This is a scheduled outage with a ` +
        `deadline, not a suggestion.`,
    }
  }
  if (auto) {
    return {
      kind: "auto-applied-after",
      autoAppliedAfterDate: auto,
      currentApplyDate: current,
      why:
        `AWS applies ${action} to ${instanceId} in the first preferred maintenance window on or ` +
        `after ${auto}. No forced date was returned, so the window still contains it.`,
    }
  }
  if (current) {
    return {
      kind: "scheduled",
      currentApplyDate: current,
      why: `${action} is currently scheduled against ${instanceId} for ${current}`,
    }
  }
  return {
    kind: "unscheduled",
    why:
      `AWS has ${action} queued against ${instanceId} and returned no forced, auto-apply or ` +
      `current apply date. It waits for the next maintenance window or for an opt-in; when that ` +
      `is has not been stated.`,
  }
}

/** How binding a schedule is, so "the soonest" can be picked without comparing strings. */
function bindingRank(schedule: OutageSchedule): number {
  switch (schedule.kind) {
    case "forced":
      return 0
    case "auto-applied-after":
      return 1
    case "scheduled":
      return 2
    case "unscheduled":
      return 3
  }
}

/** The date a schedule turns on, for ordering. Null where it has none. */
function scheduleAt(schedule: OutageSchedule): string | null {
  switch (schedule.kind) {
    case "forced":
      return schedule.forcedApplyDate
    case "auto-applied-after":
      return schedule.autoAppliedAfterDate
    case "scheduled":
      return schedule.currentApplyDate
    case "unscheduled":
      return null
  }
}

/**
 * The action an operator has to plan around first.
 *
 * Most binding wins, and among equally binding ones the earliest date. A forced
 * action next month outranks an unscheduled one, because the unscheduled one may
 * never happen and the forced one has a date on it.
 */
export function soonestSchedule(
  actions: readonly PendingMaintenanceAction[],
): OutageSchedule {
  const sorted = [...actions].sort((a, b) => {
    const rank = bindingRank(a.schedule) - bindingRank(b.schedule)
    if (rank !== 0) return rank
    const at = scheduleAt(a.schedule) ?? ""
    const bt = scheduleAt(b.schedule) ?? ""
    return at.localeCompare(bt)
  })
  return (
    sorted[0]?.schedule ?? {
      kind: "unscheduled",
      why: "no pending maintenance action was returned for this instance",
    }
  )
}

function actionsFrom(
  details: readonly PendingMaintenanceActionShape[],
  instanceId: string,
): readonly PendingMaintenanceAction[] {
  const built: PendingMaintenanceAction[] = []
  for (const detail of details) {
    const action = statedString(detail.Action)
    if (!action) continue
    const interrupts = INTERRUPTING_ACTIONS.has(action)
    built.push({
      action,
      description: statedString(detail.Description),
      optInStatus: statedString(detail.OptInStatus),
      schedule: outageScheduleOf(detail, action, instanceId),
      interrupts,
      why: interrupts
        ? `AWS applies ${action} by restarting or replacing the instance; while it does, the ` +
          `database is not serving.`
        : `AWS applies ${action} without restarting the instance`,
    })
  }
  return built.sort((a, b) => a.action.localeCompare(b.action))
}

/* --------------------------------------------------------------- events -- */

/**
 * What an event was about, from AWS's own categories.
 *
 * Keyed on `EventCategories` rather than on message text for the reason
 * `read.ts` keys on error names: the message wording changes between releases
 * and a rule keyed on it degrades silently to `other`, which renders as a quiet
 * night. The message is still carried on the event — it is the only place the
 * reason is written down — it is just not what decides the classification.
 */
export function significanceOf(categories: readonly string[]): EventSignificance {
  const set = new Set(categories.map((c) => c.toLowerCase()))
  if (set.has("failover")) return "failover"
  if (set.has("low storage")) return "low-storage"
  if (set.has("read replica")) return "replication"
  if (set.has("availability")) return "restart"
  if (set.has("failure")) return "failure"
  if (set.has("backup")) return "backup"
  if (set.has("maintenance")) return "maintenance"
  if (set.has("configuration change")) return "configuration"
  return "other"
}

function eventFrom(shape: EventShape): DatabaseEvent | null {
  const at = statedTime(shape.Date)
  if (!at) return null
  const categories = [...(shape.EventCategories ?? [])]
    .filter((c): c is string => typeof c === "string" && c !== "")
    .sort()
  return {
    at,
    categories,
    significance: significanceOf(categories),
    message: statedString(shape.Message),
  }
}

/* ------------------------------------------------------------- storage -- */

/**
 * How much room autoscaling has left, and a sentence saying what it is not.
 *
 * AWS omits `MaxAllocatedStorage` when autoscaling is off, so the absent case is
 * the `fixed` arm rather than a ceiling of zero — a zero ceiling would render as
 * "100% of the ceiling", which is a false alarm on every instance that simply
 * does not autoscale.
 */
export function storageHeadroomOf(
  allocated: number | null,
  ceiling: number | null,
  instanceId: string,
): StorageHeadroom {
  if (allocated === null) {
    return {
      kind: "unknown",
      why: `RDS answered for ${instanceId} without AllocatedStorage, so its storage cannot be stated`,
    }
  }
  if (ceiling === null) {
    return {
      kind: "fixed",
      allocatedGib: allocated,
      why:
        `${instanceId} has ${allocated} GiB and no MaxAllocatedStorage, which is how RDS says ` +
        `storage autoscaling is OFF. It will not grow itself: when the volume fills, the database ` +
        `stops accepting writes. How full it is now is a CloudWatch FreeStorageSpace metric and is ` +
        `not readable from the instance description.`,
    }
  }
  const headroom = ceiling - allocated
  const percent = ceiling > 0 ? Math.round((allocated / ceiling) * 1000) / 10 : 100
  const nearCeiling = percent >= STORAGE_CEILING_WARN_PERCENT
  return {
    kind: "autoscaling",
    allocatedGib: allocated,
    ceilingGib: ceiling,
    headroomGib: headroom,
    percentOfCeiling: percent,
    nearCeiling,
    why:
      `${instanceId} is provisioned at ${allocated} GiB and autoscales to ${ceiling} GiB — ` +
      `${percent}% of the way up its range, ${headroom} GiB of ceiling left` +
      `${nearCeiling ? `, at or past the ${STORAGE_CEILING_WARN_PERCENT}% mark where the next step may not fit` : ""}. ` +
      `This is headroom to the AUTOSCALING CEILING, not free disk space: how full the volume is ` +
      `now is a CloudWatch FreeStorageSpace metric this read does not carry.`,
  }
}

/* --------------------------------------------------------------- backup -- */

export function backupPostureOf(
  retentionDays: number | null,
  window: BackupWindow,
  instanceId: string,
): BackupPosture {
  if (retentionDays === null) {
    return {
      kind: "unknown",
      why:
        `RDS answered for ${instanceId} without BackupRetentionPeriod. Whether this database can ` +
        `be restored to a point in time is unknown — which is not "it can".`,
    }
  }
  if (retentionDays === 0) {
    return {
      kind: "disabled",
      why:
        `${instanceId} has BackupRetentionPeriod=0. Automated backups are OFF: there is no ` +
        `point-in-time recovery and no automated snapshot to restore from. Whatever manual ` +
        `snapshots exist are the entire recovery story.`,
    }
  }
  return {
    kind: "retained",
    days: retentionDays,
    window,
    why:
      `${instanceId} keeps ${retentionDays} day(s) of automated backups, so point-in-time ` +
      `recovery reaches back ${retentionDays} day(s) and no further.`,
  }
}

/**
 * The most recent moment the database could be restored to, and how old it is.
 *
 * RDS advances `LatestRestorableTime` about every five minutes. Its absence is
 * `none` and not a zero-age recovery point, because an instance with backups off
 * has no restorable time at all and rendering that as "now" is the worst
 * possible reading of it.
 */
export function recoveryPointOf(
  latest: string | null,
  asOf: string,
  instanceId: string,
): RecoveryPoint {
  if (!latest) {
    return {
      kind: "none",
      why:
        `RDS returned no LatestRestorableTime for ${instanceId}. With automated backups off there ` +
        `is none; with them on, this is a gap in what was read. Either way there is no recovery ` +
        `point this engine can name.`,
    }
  }
  const ageMs = new Date(asOf).getTime() - new Date(latest).getTime()
  const stale = ageMs > RECOVERY_POINT_STALE_MS
  return {
    kind: "restorable",
    at: latest,
    ageMs,
    stale,
    why: stale
      ? `${instanceId} can be restored to ${latest}, which is ${Math.round(ageMs / 60_000)} minute(s) ` +
        `behind this reading. RDS normally advances this every five minutes, so anything past ` +
        `${Math.round(RECOVERY_POINT_STALE_MS / 60_000)} minutes means more has been lost than an ` +
        `operator would assume.`
      : `${instanceId} can be restored to ${latest}, ${Math.round(ageMs / 60_000)} minute(s) behind ` +
        `this reading`,
  }
}

/* ------------------------------------------------------ pending changes -- */

/**
 * The changes already queued on the instance itself.
 *
 * Distinct from AWS's pending maintenance ACTIONS: these are modifications
 * somebody asked for that have not applied yet. `MasterUserPassword` appears in
 * this API's response and is deliberately not read here — a password is not a
 * value this console carries, prints or holds in memory, and the fact that one
 * is queued is not worth the risk of carrying it.
 */
export function pendingChangesOf(
  pending: PendingModifiedValuesShape | undefined,
  current: {
    engineVersion?: string | null
    instanceClass?: string | null
    allocatedStorage?: number | null
    backupRetentionDays?: number | null
  },
): readonly PendingChange[] {
  if (!pending) return []
  const changes: PendingChange[] = []

  const engineVersion = statedString(pending.EngineVersion)
  if (engineVersion) {
    changes.push({
      field: "engine version",
      from: current.engineVersion ?? null,
      to: engineVersion,
      restarts: true,
      why:
        "an engine-version change is applied by restarting the database at the maintenance window. " +
        "On a Single-AZ instance that restart is downtime.",
    })
  }

  const instanceClass = statedString(pending.DBInstanceClass)
  if (instanceClass) {
    changes.push({
      field: "instance class",
      from: current.instanceClass ?? null,
      to: instanceClass,
      restarts: true,
      why: "an instance-class change replaces the host; the database restarts on the new one",
    })
  }

  const storage = statedNumber(pending.AllocatedStorage)
  if (storage !== null) {
    changes.push({
      field: "allocated storage",
      from: current.allocatedStorage === null || current.allocatedStorage === undefined
        ? null
        : `${current.allocatedStorage} GiB`,
      to: `${storage} GiB`,
      restarts: false,
      why: "storage is grown online; the database keeps serving, though I/O is slower while it moves",
    })
  }

  const retention = statedNumber(pending.BackupRetentionPeriod)
  if (retention !== null) {
    changes.push({
      field: "backup retention",
      from: current.backupRetentionDays === null || current.backupRetentionDays === undefined
        ? null
        : `${current.backupRetentionDays} day(s)`,
      to: `${retention} day(s)`,
      restarts: false,
      why:
        retention === 0
          ? "backups are being turned OFF; point-in-time recovery ends when this applies"
          : "the retention window changes without taking the database down",
    })
  }

  if (pending.MultiAZ !== undefined) {
    changes.push({
      field: "Multi-AZ",
      from: null,
      to: pending.MultiAZ ? "enabled" : "disabled",
      restarts: true,
      why: "changing Multi-AZ moves the instance between deployment shapes; the endpoint fails over while it does",
    })
  }

  const port = statedNumber(pending.Port)
  if (port !== null) {
    changes.push({
      field: "port",
      from: null,
      to: String(port),
      restarts: true,
      why: "a port change restarts the database, and every client holding the old port stops connecting",
    })
  }

  const storageType = statedString(pending.StorageType)
  if (storageType) {
    changes.push({
      field: "storage type",
      from: null,
      to: storageType,
      restarts: false,
      why: "a storage-type change is applied online, at reduced I/O until it finishes",
    })
  }

  const ca = statedString(pending.CACertificateIdentifier)
  if (ca) {
    changes.push({
      field: "CA certificate",
      from: null,
      to: ca,
      restarts: true,
      why:
        "a CA rotation needs a reboot to take effect, and clients that pin the old CA stop " +
        "connecting once it does",
    })
  }

  if (pending.IAMDatabaseAuthenticationEnabled !== undefined) {
    changes.push({
      field: "IAM database authentication",
      from: null,
      to: pending.IAMDatabaseAuthenticationEnabled ? "enabled" : "disabled",
      restarts: false,
      why: "IAM authentication is switched without taking the database down",
    })
  }

  return changes
}

/* ------------------------------------------------------------- SSL / params -- */

/** The SSL-enforcement parameter's name on this engine, or null when unknown. */
export function sslParameterFor(engine: string | null): string | null {
  if (!engine) return null
  return SSL_PARAMETERS[engine.toLowerCase()] ?? null
}

/**
 * Whether a group is AWS's unmodifiable engine default.
 *
 * Tested against the exact `default.<family>` name when the family is known,
 * rather than against the `default.` prefix alone, because the exact test is the
 * one that cannot be fooled by a name that merely looks like one.
 */
export function isEngineDefaultGroup(name: string, family: string | null): boolean {
  if (family) return name === `default.${family}`
  return name.startsWith("default.")
}

/**
 * What can and cannot be said about SSL enforcement, per instance.
 *
 * Never returns a value for the parameter, because it never has one. What it
 * varies is the sentence: an instance on unmodifiable engine-default groups is
 * provably at the engine default, an instance on a custom group is provably not
 * provable from here, and an instance whose group listing failed is neither.
 */
export function sslEnforcementFor(
  engine: string | null,
  groups: ParameterGroupView,
  instanceId: string,
): SslEnforcement {
  const parameter = sslParameterFor(engine)
  const named = parameter ?? "the engine's SSL-enforcement parameter"
  const base =
    `whether ${named} is set on ${instanceId} is NOT readable by this engine: the value needs ` +
    `${PARAMETER_VALUE_CAPABILITY}, which is not a capability this console holds. Unknown, not enforced.`

  if (groups.kind === "not-read") {
    return {
      state: "NOT_READABLE",
      needs: PARAMETER_VALUE_CAPABILITY,
      iamAction: PARAMETER_VALUE_CAPABILITY,
      parameter,
      groupsAreEngineDefault: null,
      why: `${base} The parameter-group listing did not answer either, so not even the group this instance sits on is known.`,
    }
  }
  if (groups.kind === "none") {
    return {
      state: "NOT_READABLE",
      needs: PARAMETER_VALUE_CAPABILITY,
      iamAction: PARAMETER_VALUE_CAPABILITY,
      parameter,
      groupsAreEngineDefault: null,
      why: `${base} RDS returned no parameter group on this instance, so there is nothing to ask about either.`,
    }
  }
  const decided = groups.groups.map((g) => g.engineDefault)
  const allDefault = decided.length > 0 && decided.every((d) => d === true)
  const anyUnknown = decided.some((d) => d === null)
  if (allDefault) {
    return {
      state: "NOT_READABLE",
      needs: PARAMETER_VALUE_CAPABILITY,
      iamAction: PARAMETER_VALUE_CAPABILITY,
      parameter,
      groupsAreEngineDefault: true,
      why:
        `${base} What IS known: every group attached to ${instanceId} is an AWS engine-default ` +
        `group (${groups.groups.map((g) => g.name).join(", ")}), and a default group cannot be ` +
        `modified — so every parameter on this instance, ${named} included, is at its engine ` +
        `default. Which value that default IS remains unread.`,
    }
  }
  return {
    state: "NOT_READABLE",
    needs: PARAMETER_VALUE_CAPABILITY,
    iamAction: PARAMETER_VALUE_CAPABILITY,
    parameter,
    groupsAreEngineDefault: anyUnknown ? null : false,
    why:
      `${base} What IS known: ${instanceId} sits on ` +
      `${groups.groups.map((g) => g.name).join(", ")}, which is not exclusively AWS's unmodifiable ` +
      `engine-default group, so its parameters may differ from the engine default in ways this ` +
      `engine cannot see.`,
  }
}

/* ------------------------------------------------------------------ ARNs -- */

function arnParts(arn: string | null): string[] {
  return arn ? arn.split(":") : []
}

/**
 * An instance's ARN, assembled from the resolved identity.
 *
 * Only used when RDS did not return one. The partition and region come from
 * identity, never from a literal — see the module header on GE-010-007 — and
 * this returns null rather than half an ARN when identity is unresolved, because
 * half an ARN joins against the tag index and matches nothing, which reads
 * exactly like an untagged instance.
 */
export function deriveInstanceArn(instanceId: string, identity: AwsRead<Identity>): string | null {
  if (identity.state !== "ACTUAL" && identity.state !== "STALE") return null
  if (!instanceId) return null
  const { partition, region, accountId } = identity.value
  if (!partition || !region || !accountId) return null
  return `arn:${partition}:rds:${region}:${accountId}:db:${instanceId}`
}

/* ----------------------------------------------------------- attribution -- */

function attributionFor(
  arn: string | null,
  tagged: AwsRead<readonly TaggedResource[]>,
  index: Map<string, Readonly<Record<string, string>>>,
): DatabaseAttribution {
  if (tagged.state !== "ACTUAL" && tagged.state !== "STALE" && tagged.state !== "EMPTY") {
    return {
      kind: "unknown",
      why: `this database's tags were not read — ${describeRead(tagged, "the tag index")}`,
    }
  }
  if (!arn) {
    return {
      kind: "unknown",
      why:
        "this database has no ARN this engine can state, so it cannot be joined against the tag " +
        "index. Unattributed would be a claim about its tags; this is a claim about ours.",
    }
  }
  const tags = index.get(arn)
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

/* ------------------------------------------------------------ the readings -- */

/** The retry schedule is throttle.ts's, not a literal. See its header on jitter. */
const RETRY: { attempts: number; backoffMs: number } = {
  attempts: READ_ATTEMPTS,
  // `backoffMs(2)` is the pause after the first failure; readAws doubles it.
  backoffMs: backoffMs(2),
}

interface Page<T> {
  items: readonly T[]
  truncation: Truncation
}

/**
 * Walk a marker-paged listing to the end, or to the cap and say so.
 *
 * The cap is not a silent truncation and it is not a thrown error: the surface
 * CAN qualify a partial answer — `Truncation` is a field it renders — so the
 * pages that were read are returned with an explicit "there was more", which is
 * strictly more information than an error carrying none of them.
 */
async function pagedRead<Item>(
  call: (marker: string | undefined) => Promise<{ items: readonly Item[]; marker: string | undefined }>,
  what: string,
): Promise<Page<Item>> {
  const items: Item[] = []
  let marker: string | undefined
  // Held separately so the truncated arm carries a `string` and not a
  // `string | undefined` narrowed by an argument about loop bounds. The
  // "there was more" signal is the whole point of this branch; it does not get
  // to be optional.
  let lastMarker = ""
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await call(marker)
    items.push(...response.items)
    marker = response.marker
    if (!marker) return { items, truncation: { kind: "complete" } }
    lastMarker = marker
  }
  return {
    items,
    truncation: {
      kind: "truncated",
      pagesRead: MAX_PAGES,
      maxPages: MAX_PAGES,
      nextMarker: lastMarker,
      why:
        `${what} still had pages after ${MAX_PAGES}. This engine stopped there. What is shown is ` +
        `the first ${items.length} it read and is NOT the whole estate.`,
    },
  }
}

/** A page is EMPTY only when it is both empty AND complete: stopping early is not nothing. */
function emptyOnlyIfComplete(value: unknown): boolean {
  const page = value as Page<unknown>
  return page.items.length === 0 && page.truncation.kind === "complete"
}

async function readInstances(
  gw: AwsGateway,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<Page<DBInstanceShape>>> {
  return readAws<Page<DBInstanceShape>>(
    "rds:DescribeDBInstances",
    async () =>
      pagedRead<DBInstanceShape>(async (marker) => {
        const response = (await gw.call("rds:DescribeDBInstances", {
          Marker: marker,
        })) as DescribeDBInstancesResponse
        return {
          items: (response?.DBInstances ?? []).filter((i) => statedString(i?.DBInstanceIdentifier)),
          marker: response?.Marker || undefined,
        }
      }, "rds:DescribeDBInstances"),
    { now: options.now, denial: options.denial, isEmpty: emptyOnlyIfComplete, ...RETRY },
  )
}

async function readPendingMaintenance(
  gw: AwsGateway,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<Page<ResourcePendingMaintenanceActionsShape>>> {
  return readAws<Page<ResourcePendingMaintenanceActionsShape>>(
    "rds:DescribePendingMaintenanceActions",
    async () =>
      // Account-wide: no `ResourceIdentifier`. One paged call answers for every
      // instance, where per-instance calls would be N calls against one throttle
      // to learn the same thing.
      pagedRead<ResourcePendingMaintenanceActionsShape>(async (marker) => {
        const response = (await gw.call("rds:DescribePendingMaintenanceActions", {
          Marker: marker,
        })) as DescribePendingMaintenanceActionsResponse
        return {
          items: (response?.PendingMaintenanceActions ?? []).filter((a) =>
            statedString(a?.ResourceIdentifier),
          ),
          marker: response?.Marker || undefined,
        }
      }, "rds:DescribePendingMaintenanceActions"),
    { now: options.now, denial: options.denial, isEmpty: emptyOnlyIfComplete, ...RETRY },
  )
}

async function readParameterGroups(
  gw: AwsGateway,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<Page<DBParameterGroupShape>>> {
  return readAws<Page<DBParameterGroupShape>>(
    "rds:DescribeDBParameterGroups",
    async () =>
      pagedRead<DBParameterGroupShape>(async (marker) => {
        const response = (await gw.call("rds:DescribeDBParameterGroups", {
          Marker: marker,
        })) as DescribeDBParameterGroupsResponse
        return {
          items: (response?.DBParameterGroups ?? []).filter((g) =>
            statedString(g?.DBParameterGroupName),
          ),
          marker: response?.Marker || undefined,
        }
      }, "rds:DescribeDBParameterGroups"),
    { now: options.now, denial: options.denial, isEmpty: emptyOnlyIfComplete, ...RETRY },
  )
}

async function readSnapshots(
  gw: AwsGateway,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<Page<DBSnapshotShape>>> {
  return readAws<Page<DBSnapshotShape>>(
    "rds:DescribeDBSnapshots",
    async () =>
      pagedRead<DBSnapshotShape>(async (marker) => {
        const response = (await gw.call("rds:DescribeDBSnapshots", {
          Marker: marker,
        })) as DescribeDBSnapshotsResponse
        return {
          items: (response?.DBSnapshots ?? []).filter((s) => statedString(s?.DBSnapshotIdentifier)),
          marker: response?.Marker || undefined,
        }
      }, "rds:DescribeDBSnapshots"),
    { now: options.now, denial: options.denial, isEmpty: emptyOnlyIfComplete, ...RETRY },
  )
}

async function readEvents(
  gw: AwsGateway,
  instanceId: string,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<InstanceEvents>> {
  return readAws<InstanceEvents>(
    "rds:DescribeEvents",
    async () => {
      const page = await pagedRead<EventShape>(async (marker) => {
        const response = (await gw.call("rds:DescribeEvents", {
          SourceIdentifier: instanceId,
          SourceType: "db-instance",
          Duration: EVENT_WINDOW_MINUTES,
          Marker: marker,
        })) as DescribeEventsResponse
        return { items: response?.Events ?? [], marker: response?.Marker || undefined }
      }, `rds:DescribeEvents for ${instanceId}`)

      const events = page.items
        .map(eventFrom)
        .filter((e): e is DatabaseEvent => e !== null)
        // Newest first: the question is "what happened last night", and the
        // answer an operator reads first should be the most recent thing.
        .sort((a, b) => b.at.localeCompare(a.at))

      return {
        instanceId,
        windowMinutes: EVENT_WINDOW_MINUTES,
        events,
        restarts: events.filter((e) => e.significance === "restart"),
        failovers: events.filter((e) => e.significance === "failover"),
        lowStorage: events.filter((e) => e.significance === "low-storage"),
        replication: events.filter((e) => e.significance === "replication"),
        truncation: page.truncation,
      }
    },
    {
      now: options.now,
      denial: options.denial,
      // An instance with a quiet day answers with no events, and that IS the
      // answer to "did it restart" — so an object with an empty list is ACTUAL,
      // not EMPTY. EMPTY here would render as "we found nothing", which is the
      // same words for "nothing happened" and would lose the window.
      isEmpty: () => false,
      ...RETRY,
    },
  )
}

/* ------------------------------------------------------------- the surface -- */

/**
 * Every database in the estate, what AWS has scheduled against it, what already
 * happened to it, and how much room it has left.
 *
 * The production entry point. A route or a page calls it with no arguments and
 * gets `liveGateway()`, which resolves `client.ts` on first call; a test passes
 * a stand-in gateway to the SAME function, because a test that drove a private
 * helper would stay green on the day the caller stopped calling it.
 */
export async function databaseReadings(
  supplied?: AwsGateway,
  options: { now?: () => Date } = {},
): Promise<DatabaseReadings> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())

  const identity = await resolveIdentity(supplied, { now })
  const denial = denialContextFrom(identity)
  const tagged = await taggedResources(supplied, { now, denial })
  const index = tagIndex(tagged.state === "ACTUAL" || tagged.state === "STALE" ? tagged.value : [])

  // Four independent reads. None of their failures is allowed to decide
  // another's state, which is why they are four `readAws` calls and not one
  // try block over four awaits.
  const instanceRead = await readInstances(gw, { now, denial })
  const maintenanceRead = await readPendingMaintenance(gw, { now, denial })
  const parameterGroupRead = await readParameterGroups(gw, { now, denial })
  const snapshotRead = await readSnapshots(gw, { now, denial })

  const asOf = now().toISOString()
  const refreshMs = {
    instances: CAPABILITIES["rds:DescribeDBInstances"].refreshMs,
    pendingMaintenance: CAPABILITIES["rds:DescribePendingMaintenanceActions"].refreshMs,
    events: CAPABILITIES["rds:DescribeEvents"].refreshMs,
    parameterGroups: CAPABILITIES["rds:DescribeDBParameterGroups"].refreshMs,
    snapshots: CAPABILITIES["rds:DescribeDBSnapshots"].refreshMs,
  }

  const rawInstances =
    instanceRead.state === "ACTUAL" || instanceRead.state === "STALE"
      ? [...instanceRead.value.items].sort((a, b) =>
          String(a.DBInstanceIdentifier).localeCompare(String(b.DBInstanceIdentifier)),
        )
      : []

  /* -------------------------------------------- the parameter-group listing -- */

  const groupsRead = parameterGroupRead.state === "ACTUAL" || parameterGroupRead.state === "STALE"
  const groupReadings: ParameterGroupReading[] = (
    groupsRead ? [...parameterGroupRead.value.items] : []
  )
    .map((group) => {
      const name = String(group.DBParameterGroupName)
      const family = statedString(group.DBParameterGroupFamily)
      return {
        name,
        family,
        description: statedString(group.Description),
        arn: statedString(group.DBParameterGroupArn),
        engineDefault: isEngineDefaultGroup(name, family),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  const groupsByName = new Map(groupReadings.map((g) => [g.name, g]))
  // EMPTY is a read that answered. Only the arms that did NOT answer make the
  // per-instance view `not-read`.
  const groupListingAnswered = groupsRead || parameterGroupRead.state === "EMPTY"

  /* ------------------------------------------------ the maintenance listing -- */

  const maintenanceAnswered =
    maintenanceRead.state === "ACTUAL" ||
    maintenanceRead.state === "STALE" ||
    maintenanceRead.state === "EMPTY"
  const maintenanceResources: PendingMaintenanceResource[] = (
    maintenanceRead.state === "ACTUAL" || maintenanceRead.state === "STALE"
      ? [...maintenanceRead.value.items]
      : []
  )
    .map((resource) => {
      const resourceIdentifier = String(resource.ResourceIdentifier)
      // AWS keys pending actions by the instance ARN. The id an operator knows
      // is the last ARN segment, and it is what the sentence names.
      const instanceId = resourceIdentifier.split(":").pop() || resourceIdentifier
      return {
        resourceIdentifier,
        actions: actionsFrom(resource.PendingMaintenanceActionDetails ?? [], instanceId),
      }
    })
    .sort((a, b) => a.resourceIdentifier.localeCompare(b.resourceIdentifier))

  /* --------------------------------------------------- the snapshot listing -- */

  const snapshotsAnswered =
    snapshotRead.state === "ACTUAL" ||
    snapshotRead.state === "STALE" ||
    snapshotRead.state === "EMPTY"
  const snapshotReadings: SnapshotReading[] = (
    snapshotRead.state === "ACTUAL" || snapshotRead.state === "STALE"
      ? [...snapshotRead.value.items]
      : []
  )
    .map((snapshot) => {
      const snapshotId = String(snapshot.DBSnapshotIdentifier)
      return {
        snapshotId,
        arn: statedString(snapshot.DBSnapshotArn),
        createdAt: statedTime(snapshot.SnapshotCreateTime),
        status: statedString(snapshot.Status),
        type: statedString(snapshot.SnapshotType),
        allocatedGib: statedNumber(snapshot.AllocatedStorage),
        instanceId: statedString(snapshot.DBInstanceIdentifier),
        encrypted: statedBoolean(
          snapshot.Encrypted,
          "Encrypted",
          snapshotId,
          "this snapshot's contents are stored unencrypted",
        ),
      }
    })
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))

  /* ------------------------------ the event sub-reads: one per instance, capped -- */

  const eventReads = new Map<string, AwsRead<InstanceEvents>>()
  const reachable = rawInstances
    .map((i) => String(i.DBInstanceIdentifier))
    .slice(0, MAX_EVENT_INSTANCE_READS)
  for (let start = 0; start < reachable.length; start += EVENT_CONCURRENCY) {
    const batch = reachable.slice(start, start + EVENT_CONCURRENCY)
    const read = await Promise.all(batch.map((id) => readEvents(gw, id, { now, denial })))
    batch.forEach((id, i) => eventReads.set(id, read[i]))
  }
  for (const instance of rawInstances.slice(MAX_EVENT_INSTANCE_READS)) {
    eventReads.set(String(instance.DBInstanceIdentifier), {
      state: "UNCONFIGURED",
      capability: "rds:DescribeEvents",
      why:
        `this engine reads event history for at most ${MAX_EVENT_INSTANCE_READS} instances per ` +
        `load and ${String(instance.DBInstanceIdentifier)} is past that. Its events were not ` +
        `read — which is not the same as its having had none.`,
    })
  }

  /* ------------------------------------------------------- the instance rows -- */

  const instanceReadings: DatabaseInstanceReading[] = rawInstances.map((instance) => {
    const instanceId = String(instance.DBInstanceIdentifier)
    const fromAws = statedString(instance.DBInstanceArn)
    const derived = fromAws ? null : deriveInstanceArn(instanceId, identity)
    const arn = fromAws ?? derived
    const arnProvenance = fromAws
      ? "RDS's own DBInstanceArn field"
      : derived
        ? "assembled from the resolved identity's partition, region and account — RDS returned no " +
          "ARN for this instance"
        : "none — RDS returned no ARN and identity is unresolved, so this engine will not assemble " +
          "one it cannot stand behind"

    const parts = arnParts(arn)
    const identityResolved = identity.state === "ACTUAL" || identity.state === "STALE"
    const engine = statedString(instance.Engine)
    const engineVersion = statedString(instance.EngineVersion)
    const instanceClass = statedString(instance.DBInstanceClass)
    const allocated = statedNumber(instance.AllocatedStorage)
    const retention = statedNumber(instance.BackupRetentionPeriod)
    const backupWindow = parseBackupWindow(instance.PreferredBackupWindow)

    /* -- parameter groups: the listing may have failed on its own, and says so -- */
    const attachedNames = (instance.DBParameterGroups ?? [])
      .map((g) => ({
        name: statedString(g?.DBParameterGroupName),
        applyStatus: statedString(g?.ParameterApplyStatus),
      }))
      .filter((g): g is { name: string; applyStatus: string | null } => g.name !== null)

    let parameterGroups: ParameterGroupView
    if (attachedNames.length === 0) {
      parameterGroups = {
        kind: "none",
        why:
          `RDS answered for ${instanceId} without a DBParameterGroups entry. Every instance has at ` +
          `least one group, so this is a gap in what was read rather than an instance with no ` +
          `parameters.`,
      }
    } else if (!groupListingAnswered) {
      parameterGroups = {
        kind: "not-read",
        why:
          `${instanceId} names ${attachedNames.map((g) => g.name).join(", ")}, but the ` +
          `parameter-group listing did not answer — ${describeRead(parameterGroupRead, "rds:DescribeDBParameterGroups")}`,
      }
    } else {
      parameterGroups = {
        kind: "attached",
        groups: attachedNames.map((attached) => {
          const known = groupsByName.get(attached.name)
          return {
            name: attached.name,
            applyStatus: attached.applyStatus,
            family: known?.family ?? null,
            arn: known?.arn ?? null,
            engineDefault: known ? known.engineDefault : null,
            why: known
              ? known.engineDefault
                ? `${attached.name} is AWS's engine-default group for ${known.family ?? "this family"}; ` +
                  `a default group cannot be modified, so its values are the engine defaults`
                : `${attached.name} is a custom group; its values may differ from the engine default ` +
                  `and this engine cannot read them`
              : `${attached.name} was not in the parameter-group listing this engine read, so whether ` +
                `it is AWS's unmodifiable default group is unknown`,
          }
        }),
      }
    }

    /* -- pending maintenance: joined by ARN, and `not-read` is not `none` -- */
    let pendingMaintenance: PendingMaintenanceView
    if (!maintenanceAnswered) {
      pendingMaintenance = {
        kind: "not-read",
        why:
          `whether AWS has maintenance queued against ${instanceId} was not read — ` +
          `${describeRead(maintenanceRead, "rds:DescribePendingMaintenanceActions")}. This is not ` +
          `"nothing is scheduled".`,
      }
    } else {
      const matched = arn
        ? maintenanceResources.find((r) => r.resourceIdentifier === arn)
        : undefined
      if (!arn) {
        pendingMaintenance = {
          kind: "not-read",
          why:
            `AWS keys pending maintenance by instance ARN and this engine has no ARN it can state ` +
            `for ${instanceId}, so the listing could not be joined to it. Unknown, not none.`,
        }
      } else if (!matched || matched.actions.length === 0) {
        pendingMaintenance = {
          kind: "none",
          why:
            `rds:DescribePendingMaintenanceActions answered and returned no action against ` +
            `${instanceId}. Nothing is queued as of ${asOf}.`,
        }
      } else {
        pendingMaintenance = {
          kind: "pending",
          actions: matched.actions,
          soonest: soonestSchedule(matched.actions),
        }
      }
    }

    /* -- snapshots: the listing may have failed on its own, and says so -- */
    let snapshots: SnapshotView
    if (!snapshotsAnswered) {
      snapshots = {
        kind: "not-read",
        why:
          `the snapshots for ${instanceId} were not read — ` +
          `${describeRead(snapshotRead, "rds:DescribeDBSnapshots")}. This is not "there are none".`,
      }
    } else {
      const mine = snapshotReadings.filter((s) => s.instanceId === instanceId)
      if (mine.length === 0) {
        snapshots = {
          kind: "none",
          why:
            `rds:DescribeDBSnapshots answered and returned no snapshot for ${instanceId}. ` +
            `Whatever recovery this database has is point-in-time recovery, or nothing.`,
        }
      } else {
        snapshots = {
          kind: "snapshots",
          count: mine.length,
          automated: mine.filter((s) => s.type === "automated").length,
          manual: mine.filter((s) => s.type === "manual").length,
          snapshots: mine,
        }
      }
    }

    return {
      instanceId,
      arn,
      arnProvenance,
      partition: parts.length >= 6 ? parts[1] : identityResolved ? identity.value.partition : null,
      region: parts.length >= 6 ? parts[3] : identityResolved ? identity.value.region : null,
      accountId: parts.length >= 6 ? parts[4] : identityResolved ? identity.value.accountId : null,
      engine,
      engineVersion,
      instanceClass,
      status: statedString(instance.DBInstanceStatus),
      multiAz: statedBoolean(
        instance.MultiAZ,
        "MultiAZ",
        instanceId,
        "there is no standby; a host failure is downtime until AWS rebuilds it",
      ),
      storageEncrypted: statedBoolean(
        instance.StorageEncrypted,
        "StorageEncrypted",
        instanceId,
        "the volume and its snapshots are stored unencrypted, and this cannot be changed in place",
      ),
      publiclyAccessible: statedBoolean(
        instance.PubliclyAccessible,
        "PubliclyAccessible",
        instanceId,
        "the instance has no public address; reachability is the security group's question",
      ),
      deletionProtection: statedBoolean(
        instance.DeletionProtection,
        "DeletionProtection",
        instanceId,
        "a delete call against this instance succeeds",
      ),
      storage: storageHeadroomOf(allocated, statedNumber(instance.MaxAllocatedStorage), instanceId),
      backup: backupPostureOf(retention, backupWindow, instanceId),
      recoveryPoint: recoveryPointOf(statedTime(instance.LatestRestorableTime), asOf, instanceId),
      maintenanceWindow: parseMaintenanceWindow(instance.PreferredMaintenanceWindow),
      autoMinorVersionUpgrade: statedBoolean(
        instance.AutoMinorVersionUpgrade,
        "AutoMinorVersionUpgrade",
        instanceId,
        "AWS will not take this instance through a minor upgrade by itself, which also means it " +
          "stays on this version until somebody moves it",
      ),
      pendingMaintenance,
      pendingChanges: pendingChangesOf(instance.PendingModifiedValues, {
        engineVersion,
        instanceClass,
        allocatedStorage: allocated,
        backupRetentionDays: retention,
      }),
      parameterGroups,
      sslEnforcement: sslEnforcementFor(engine, parameterGroups, instanceId),
      events:
        eventReads.get(instanceId) ??
        ({
          state: "UNCONFIGURED",
          capability: "rds:DescribeEvents",
          why: `${instanceId} was listed but its event history was never requested`,
        } as AwsRead<InstanceEvents>),
      snapshots,
      attribution: attributionFor(arn, tagged, index),
      refreshMs: refreshMs.instances,
      asOf,
    }
  })

  /* ------------------------------------------------- assembling the readings -- */

  // No cast on the non-value arms: after this narrowing the arms left are
  // precisely the ones with no `value` field, so they already ARE an
  // `AwsRead<readonly …[]>`. A cast here would be where an empty array could one
  // day be smuggled in.
  const instances: AwsRead<readonly DatabaseInstanceReading[]> =
    instanceRead.state === "ACTUAL" || instanceRead.state === "STALE"
      ? { ...instanceRead, value: instanceReadings }
      : instanceRead
  const pendingMaintenance: AwsRead<readonly PendingMaintenanceResource[]> =
    maintenanceRead.state === "ACTUAL" || maintenanceRead.state === "STALE"
      ? { ...maintenanceRead, value: maintenanceResources }
      : maintenanceRead
  const parameterGroups: AwsRead<readonly ParameterGroupReading[]> =
    parameterGroupRead.state === "ACTUAL" || parameterGroupRead.state === "STALE"
      ? { ...parameterGroupRead, value: groupReadings }
      : parameterGroupRead
  const snapshots: AwsRead<readonly SnapshotReading[]> =
    snapshotRead.state === "ACTUAL" || snapshotRead.state === "STALE"
      ? { ...snapshotRead, value: snapshotReadings }
      : snapshotRead

  return {
    identity,
    tagged,
    instances,
    pendingMaintenance,
    parameterGroups,
    snapshots,
    outage: scheduledOutage(instances, maintenanceRead),
    truncation: {
      instances: truncationOf(instanceRead, "the instance listing"),
      pendingMaintenance: truncationOf(maintenanceRead, "the pending-maintenance listing"),
      parameterGroups: truncationOf(parameterGroupRead, "the parameter-group listing"),
      snapshots: truncationOf(snapshotRead, "the snapshot listing"),
    },
    asOf,
    refreshMs,
  }
}

function truncationOf(read: AwsRead<Page<unknown>>, what: string): Truncation {
  if (read.state === "ACTUAL" || read.state === "STALE") return read.value.truncation
  if (read.state === "EMPTY") return { kind: "complete" }
  return { kind: "not-read", why: describeRead(read, what) }
}

/* -------------------------------------------------------- estate question -- */

/**
 * Whether anything is queued that will take a database offline.
 *
 * Exported and pure so the derivation can be reasoned about on its own;
 * `databaseReadings` is the only production caller and the tests drive it
 * through there.
 *
 * A refused instance listing is `unknown` and never `none`, and a refused
 * MAINTENANCE listing is `unknown` even when the instance listing succeeded —
 * knowing which databases exist says nothing about what AWS has scheduled
 * against them, and "no outage scheduled" is exactly the reassurance an operator
 * must not be given on the strength of a read that did not happen.
 */
export function scheduledOutage(
  instances: AwsRead<readonly DatabaseInstanceReading[]>,
  maintenanceRead: AwsRead<unknown>,
): ScheduledOutage {
  if (instances.state !== "ACTUAL" && instances.state !== "STALE" && instances.state !== "EMPTY") {
    return {
      kind: "unknown",
      why: `the databases were not read — ${describeRead(instances, "rds:DescribeDBInstances")}`,
    }
  }
  if (
    maintenanceRead.state !== "ACTUAL" &&
    maintenanceRead.state !== "STALE" &&
    maintenanceRead.state !== "EMPTY"
  ) {
    return {
      kind: "unknown",
      why:
        `what AWS has queued against these databases was not read — ` +
        `${describeRead(maintenanceRead, "rds:DescribePendingMaintenanceActions")}`,
    }
  }

  const rows = instances.state === "EMPTY" ? [] : instances.value
  const unreadable: string[] = []
  const actions: ScheduledMaintenance[] = []
  for (const row of rows) {
    if (row.pendingMaintenance.kind === "not-read") {
      unreadable.push(`${row.instanceId}: ${row.pendingMaintenance.why}`)
      continue
    }
    if (row.pendingMaintenance.kind === "none") continue
    for (const action of row.pendingMaintenance.actions) {
      actions.push({ instanceId: row.instanceId, action, window: row.maintenanceWindow })
    }
  }

  if (actions.length === 0) {
    return { kind: "none", instancesRead: rows.length, unreadable }
  }
  return {
    kind: "pending",
    actions,
    forced: actions.filter((a) => a.action.schedule.kind === "forced"),
    interrupting: actions.filter((a) => a.action.interrupts),
    unreadable,
  }
}

/* ------------------------------------------------------------- renderers -- */

/** The sentence a surface prints for a listing's completeness. */
export function describeTruncation(truncation: Truncation): string {
  switch (truncation.kind) {
    case "complete":
      return "read to the end"
    case "truncated":
      return `TRUNCATED — ${truncation.why}`
    case "not-read":
      return `not read — ${truncation.why}`
  }
}

/** The sentence a surface prints for a boolean AWS may not have stated. */
export function describeStatedBoolean(value: StatedBoolean, what: string): string {
  switch (value.kind) {
    case "yes":
      return `${what}: yes`
    case "no":
      return `${what}: NO — ${value.why}`
    case "unstated":
      return `${what}: unknown — ${value.why}`
  }
}

/** The sentence a surface prints for a maintenance window. */
export function describeMaintenanceWindow(window: MaintenanceWindow): string {
  switch (window.kind) {
    case "window":
      return `${window.startDay} ${window.startTimeUtc} → ${window.endDay} ${window.endTimeUtc} UTC`
    case "absent":
      return `no window stated — ${window.why}`
    case "unreadable":
      return `unreadable window ${JSON.stringify(window.raw)} — ${window.why}`
  }
}

/** The sentence a surface prints for a backup window. */
export function describeBackupWindow(window: BackupWindow): string {
  switch (window.kind) {
    case "window":
      return `${window.startTimeUtc} → ${window.endTimeUtc} UTC daily`
    case "absent":
      return `no backup window stated — ${window.why}`
    case "unreadable":
      return `unreadable backup window ${JSON.stringify(window.raw)} — ${window.why}`
  }
}

/**
 * The sentence a surface prints for when an action stops being optional.
 *
 * `forced` is the only arm that carries the word FORCED, and it carries the
 * date. One renderer, so a forced upgrade cannot read as "pending" on one
 * surface and correctly on another.
 */
export function describeOutageSchedule(schedule: OutageSchedule): string {
  switch (schedule.kind) {
    case "forced":
      return `FORCED on ${schedule.forcedApplyDate} — ${schedule.why}`
    case "auto-applied-after":
      return `auto-applied in the first window on or after ${schedule.autoAppliedAfterDate} — ${schedule.why}`
    case "scheduled":
      return `scheduled for ${schedule.currentApplyDate} — ${schedule.why}`
    case "unscheduled":
      return `queued with no date — ${schedule.why}`
  }
}

/** The sentence a surface prints for one instance's pending maintenance. */
export function describePendingMaintenance(view: PendingMaintenanceView): string {
  switch (view.kind) {
    case "not-read":
      return `unknown — ${view.why}`
    case "none":
      return `nothing queued — ${view.why}`
    case "pending":
      return (
        `${view.actions.length} action(s) queued: ` +
        view.actions
          .map(
            (a) =>
              `${a.action} (${describeOutageSchedule(a.schedule)})` +
              `${a.interrupts ? " — INTERRUPTS the database" : " — applied without a restart"}` +
              `${a.description ? ` · ${a.description}` : ""}`,
          )
          .join("; ")
      )
  }
}

/** The sentence a surface prints for storage headroom. Never says "free space". */
export function describeStorage(storage: StorageHeadroom): string {
  switch (storage.kind) {
    case "autoscaling":
      return (
        `${storage.allocatedGib} GiB, autoscaling to ${storage.ceilingGib} GiB ` +
        `(${storage.percentOfCeiling}% of the ceiling${storage.nearCeiling ? ", NEAR CEILING" : ""}) — ${storage.why}`
      )
    case "fixed":
      return `${storage.allocatedGib} GiB, AUTOSCALING OFF — ${storage.why}`
    case "unknown":
      return `storage unknown — ${storage.why}`
  }
}

/** The sentence a surface prints for backup retention. */
export function describeBackup(backup: BackupPosture): string {
  switch (backup.kind) {
    case "disabled":
      return `NO AUTOMATED BACKUPS — ${backup.why}`
    case "retained":
      return `${backup.days} day(s) retained, ${describeBackupWindow(backup.window)} — ${backup.why}`
    case "unknown":
      return `backup retention unknown — ${backup.why}`
  }
}

/** The sentence a surface prints for the latest restorable time. */
export function describeRecoveryPoint(point: RecoveryPoint): string {
  switch (point.kind) {
    case "restorable":
      return `${point.stale ? "STALE recovery point" : "restorable"} to ${point.at} — ${point.why}`
    case "none":
      return `no recovery point — ${point.why}`
  }
}

/** The sentence a surface prints for the parameter groups attached to an instance. */
export function describeParameterGroups(view: ParameterGroupView): string {
  switch (view.kind) {
    case "not-read":
      return `parameter groups unknown — ${view.why}`
    case "none":
      return `no parameter group returned — ${view.why}`
    case "attached":
      return view.groups
        .map(
          (g) =>
            `${g.name}` +
            `${g.family ? ` (${g.family})` : ""}` +
            `${g.applyStatus ? `, apply status ${g.applyStatus}` : ""}` +
            ` — ${g.why}`,
        )
        .join(" | ")
  }
}

/** The sentence a surface prints for SSL enforcement. It never says "enforced". */
export function describeSslEnforcement(ssl: SslEnforcement): string {
  return `${ssl.parameter ?? "SSL enforcement"}: unknown — ${ssl.why}`
}

/** The sentence a surface prints for one instance's events over the window. */
export function describeEvents(events: AwsRead<InstanceEvents>): string {
  if (events.state === "ACTUAL" || events.state === "STALE") {
    const e = events.value
    if (e.events.length === 0) {
      return `no event in the last ${e.windowMinutes} minute(s) — the database was not restarted and did not fail over`
    }
    const notable = [
      ...e.failovers.map((x) => `FAILOVER ${x.at}: ${x.message ?? "no message"}`),
      ...e.restarts.map((x) => `RESTART ${x.at}: ${x.message ?? "no message"}`),
      ...e.lowStorage.map((x) => `LOW STORAGE ${x.at}: ${x.message ?? "no message"}`),
      ...e.replication.map((x) => `REPLICATION ${x.at}: ${x.message ?? "no message"}`),
    ]
    return (
      `${e.events.length} event(s) in the last ${e.windowMinutes} minute(s)` +
      `${notable.length > 0 ? ` — ${notable.join("; ")}` : " — none of them a restart, failover, low-storage or replication event"}` +
      `${e.truncation.kind === "truncated" ? ` · ${describeTruncation(e.truncation)}` : ""}`
    )
  }
  return describeRead(events, "this instance's event history")
}

/** The sentence a surface prints for one instance's snapshots. */
export function describeSnapshots(view: SnapshotView): string {
  switch (view.kind) {
    case "not-read":
      return `snapshots unknown — ${view.why}`
    case "none":
      return `no snapshot — ${view.why}`
    case "snapshots": {
      const newest = view.snapshots[0]
      return (
        `${view.count} snapshot(s), ${view.automated} automated / ${view.manual} manual` +
        `${newest ? ` — newest ${newest.snapshotId} at ${newest.createdAt ?? "an unstated time"} (${newest.status ?? "status not returned"})` : ""}`
      )
    }
  }
}

/** The sentence a surface prints for one database's attribution. */
export function describeDatabaseAttribution(attribution: DatabaseAttribution): string {
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

/** The sentence a surface prints for what AWS has scheduled across the estate. */
export function describeScheduledOutage(outage: ScheduledOutage): string {
  switch (outage.kind) {
    case "unknown":
      return `unknown — ${outage.why}`
    case "none": {
      const qualifier =
        outage.unreadable.length === 0
          ? ""
          : ` ${outage.unreadable.length} instance(s) could not be joined to the listing (${outage.unreadable.join("; ")}), so this is qualified.`
      return (
        `nothing scheduled — ${outage.instancesRead} database(s) answered with no pending ` +
        `maintenance action.${qualifier}`
      )
    }
    case "pending": {
      const named = outage.actions
        .map(
          (a) =>
            `${a.instanceId} ${a.action.action} — ${describeOutageSchedule(a.action.schedule)}` +
            `${a.action.interrupts ? ` — INTERRUPTS, window ${describeMaintenanceWindow(a.window)}` : " — no restart"}`,
        )
        .join("; ")
      const head =
        outage.forced.length > 0
          ? `SCHEDULED OUTAGE — ${outage.forced.length} of ${outage.actions.length} queued action(s) have a forced apply date`
          : outage.interrupting.length > 0
            ? `queued — ${outage.interrupting.length} of ${outage.actions.length} action(s) interrupt the database, none forced yet`
            : `queued, none interrupting — ${outage.actions.length} action(s)`
      return `${head}: ${named}`
    }
  }
}

/** The sentence a surface prints for one database. One funnel, so states cannot drift. */
export function describeDatabaseInstance(instance: DatabaseInstanceReading): string {
  const where =
    instance.region && instance.partition
      ? `${instance.region} (partition ${instance.partition})`
      : "region unknown — identity is unresolved and RDS returned no ARN"
  const engine =
    instance.engine && instance.engineVersion
      ? `${instance.engine} ${instance.engineVersion}`
      : (instance.engine ?? "engine not returned")
  return (
    `${instance.instanceId} — ${engine} on ${instance.instanceClass ?? "an unstated class"} ` +
    `(${instance.status ?? "status not returned"}) — ${where} — ` +
    `${describeDatabaseAttribution(instance.attribution)} · ` +
    `${describeStatedBoolean(instance.multiAz, "Multi-AZ")} · ` +
    `${describeStatedBoolean(instance.storageEncrypted, "storage encrypted")} · ` +
    `${describeStorage(instance.storage)} · ${describeBackup(instance.backup)} · ` +
    `${describeRecoveryPoint(instance.recoveryPoint)} · ` +
    `maintenance window ${describeMaintenanceWindow(instance.maintenanceWindow)} · ` +
    `pending maintenance: ${describePendingMaintenance(instance.pendingMaintenance)} · ` +
    `${instance.pendingChanges.length > 0 ? `queued changes: ${instance.pendingChanges.map((c) => `${c.field} → ${c.to}${c.restarts ? " (restarts)" : ""}`).join(", ")} · ` : ""}` +
    `events: ${describeEvents(instance.events)} · ` +
    `parameter groups: ${describeParameterGroups(instance.parameterGroups)} · ` +
    `${describeSslEnforcement(instance.sslEnforcement)} · ` +
    `snapshots: ${describeSnapshots(instance.snapshots)} · as of ${instance.asOf}, refreshed every ` +
    `${Math.round(instance.refreshMs / 1000)}s`
  )
}

export interface DatabaseLine {
  label: string
  text: string
}

/**
 * What a database surface prints.
 *
 * A surface agent renders exactly these strings. The tests assert on them, which
 * is what makes the mutation proofs land on the production path rather than on a
 * helper nothing calls.
 */
export function databaseLines(readings: DatabaseReadings): readonly DatabaseLine[] {
  const lines: DatabaseLine[] = [
    {
      label: "Databases",
      // The truncation sentence is appended rather than folded into
      // `describeRead`'s subject, because the DENIED and THROTTLED arms
      // deliberately drop that subject — and "was this list complete" is a
      // question whose answer must survive the state that makes it matter most.
      text:
        `${describeRead(
          readings.instances,
          `database instances read from AWS, refreshed every ${Math.round(readings.refreshMs.instances / 1000)}s`,
        )} · listing ${describeTruncation(readings.truncation.instances)}`,
    },
    {
      label: "Pending maintenance",
      text:
        `${describeRead(
          readings.pendingMaintenance,
          `pending maintenance actions read from AWS, refreshed every ` +
            `${Math.round(readings.refreshMs.pendingMaintenance / 1000)}s`,
        )} · listing ${describeTruncation(readings.truncation.pendingMaintenance)}`,
    },
    {
      label: "Parameter groups",
      text:
        `${describeRead(
          readings.parameterGroups,
          `parameter groups read from AWS, refreshed every ` +
            `${Math.round(readings.refreshMs.parameterGroups / 1000)}s`,
        )} · listing ${describeTruncation(readings.truncation.parameterGroups)}`,
    },
    {
      label: "Snapshots",
      text:
        `${describeRead(
          readings.snapshots,
          `snapshots read from AWS, refreshed every ${Math.round(readings.refreshMs.snapshots / 1000)}s`,
        )} · listing ${describeTruncation(readings.truncation.snapshots)}`,
    },
    { label: "Scheduled outage", text: describeScheduledOutage(readings.outage) },
  ]
  if (readings.instances.state === "ACTUAL" || readings.instances.state === "STALE") {
    for (const instance of readings.instances.value) {
      lines.push({ label: instance.instanceId, text: describeDatabaseInstance(instance) })
    }
  }
  return lines
}
