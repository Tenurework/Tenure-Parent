/**
 * STUDIO-070-004 (ElastiCache) — the cache the running product depends on, and
 * which this console could not see at all.
 *
 * `infrastructure/terraform/elasticache.tf` creates one `aws_elasticache_cluster`
 * — engine `redis`, `engine_version = "7.1"`, `num_cache_nodes = 1`, a
 * `redis7` parameter group whose only declared parameter is
 * `maxmemory-policy = allkeys-lru` — and `ecs.tf` hands its address to every
 * task as `REDIS_URL`. No `at_rest_encryption_enabled`, no
 * `transit_encryption_enabled` and no `auth_token` appear anywhere in that file,
 * and no replication group is declared at all. Nothing in the running product
 * had ever issued an ElastiCache call, so all of that was invisible: "the cache
 * is fine" and "nobody has ever looked at the cache" were the same blank panel.
 *
 * This module answers the three questions an operator actually asks.
 *
 * ## "Is the cache encrypted"
 *
 * `AtRestEncryptionEnabled` and `TransitEncryptionEnabled` are booleans AWS
 * returns — when it returns them. It omits them for engines and cluster
 * generations where they do not apply, and AWS's documented default for the
 * omission is `false`. This module still keeps `disabled` and `unstated` in
 * separate arms of `EncryptionState`, because "AWS told us it is off" and "AWS
 * did not tell us" are different observations with different next actions: the
 * first is a finding to fix, the second is a question to go and answer. What
 * neither of them may ever render as is *encrypted*. The estate-level
 * `EncryptionPosture` therefore has a distinct `unstated` arm and only claims
 * `encrypted` when every cache said so about both fields, explicitly.
 *
 * ## "Is it a single node with no failover"
 *
 * A standalone `CacheCluster` with `NumCacheNodes = 1` and no
 * `ReplicationGroupId` has no replica and no failover: when the node goes, the
 * cache goes. That is a `FailoverPosture` arm of its own, phrased as the fact it
 * is, rather than a `1` in a node-count column that reads as reassuring.
 * Failover for a cluster that IS a replication-group member is the GROUP's
 * property, so that cluster's posture points at the group instead of answering
 * for it — a cluster answering "no failover" while its group has automatic
 * failover enabled would be a false alarm, and one answering the reverse would
 * be worse.
 *
 * ## "Is there a version upgrade pending that will restart it"
 *
 * `PendingModifiedValues` is the queued change: an `EngineVersion` in it is an
 * upgrade AWS will apply at the preferred maintenance window, and applying it
 * restarts the node. On a single-node cluster with no replica that restart is
 * downtime, which is why `ScheduledInterruption` names the window rather than
 * leaving "pending" as a badge. `AutoMinorVersionUpgrade` is the other half:
 * with it on, AWS may take the node through a minor upgrade in that same window
 * without anybody queueing anything, so the window is reported whether or not
 * something is pending today.
 *
 * ## What this module cannot read, said out loud
 *
 * **Whether the engine version is behind the current default is not readable by
 * this engine.** That comparison needs `elasticache:DescribeCacheEngineVersions`
 * — the API that returns each engine's current default version and its
 * end-of-life dates — and that capability is not in `capabilities.ts`. This
 * module does not get to add one. So every cluster carries a `VersionCurrency`
 * whose only arm is NOT_READABLE and which names the capability and the IAM
 * action that would answer it. A field that silently held `null`, or was left
 * off the type, would let a surface print a version with nothing beside it and
 * let an operator read that as "up to date".
 *
 * ## Region and partition
 *
 * From the resolved identity — `sts:GetCallerIdentity` for the account and the
 * partition, the SDK's own resolved region for the region — and from the `ARN`
 * ElastiCache returns on each cluster and group. There is no literal region in
 * this file and no `"aws"` partition fallback; GE-010-007 was a data-residency
 * defect caused by exactly that fallback. Where the API returns no ARN and
 * identity is unresolved, the ARN is `null` and the provenance field says so,
 * because half an ARN joins against the tag index and matches nothing, which
 * reads exactly like an untagged cluster.
 *
 * ## Attribution
 *
 * Through `tags.ts` and the Resource Groups Tagging API, so a cache attributes
 * the same way an RDS instance does. Note the deliberate deviation from "mark it
 * shared where no tag says otherwise": `tags.ts` keeps `shared` (somebody
 * decided, via the `tenure:tenant` sentinel value) and `unattributed` (nobody
 * tagged it) apart, and folding them is how an untagged cache gets billed to a
 * tenant that did not create it. This module adds a FOURTH answer, `unknown`,
 * for when the tag index itself could not be read — "we could not look up this
 * cluster's tags" is not "this cluster has no tenant tag".
 *
 * ## Sub-calls degrade independently
 *
 * Four reads happen here and each can fail on its own: the cluster listing, the
 * replication-group listing, the tag index, and one `DescribeCacheParameters`
 * per distinct parameter group. A denied `elasticache:DescribeReplicationGroups`
 * does not collapse the cluster rows to UNKNOWN — it makes the failover sentence
 * for group members say the group could not be read, and it puts the group
 * listing's own sentence into the `unreadable` list that qualifies both the
 * encryption posture and the interruption state. A denied
 * `DescribeCacheParameters` leaves that cluster's `parameters` DENIED, naming
 * that action and not the listing's, and every other fact about the cluster
 * stands.
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
 * How many `Marker` pages to walk on either listing.
 *
 * `client.ts` asks for `MaxRecords: 100`, so this is two thousand clusters
 * before the engine stops. A page loop with no bound is how one server render
 * with a person waiting becomes an outage; a reader that silently returns the
 * first page is the same lie as an empty list. Hitting the cap is therefore
 * neither — it is reported, in `Truncation`, and the surface prints it.
 */
export const MAX_PAGES = 20

/**
 * How many distinct parameter groups get read in one load.
 *
 * `DescribeCacheParameters` is one call per group and returns the whole engine
 * default set, hundreds of rows, per call. The estate declares one group. The
 * cap exists so an account that has grown two hundred does not turn one page
 * render into two hundred paged calls; clusters whose group was not reached
 * carry an UNCONFIGURED parameter read whose `why` says the engine stopped,
 * which is a different sentence from "this cluster has no maxmemory policy".
 */
export const MAX_PARAMETER_GROUP_READS = 20

/** How many parameter reads are in flight at once. Bounded so a load is not a burst. */
const PARAMETER_CONCURRENCY = 4

/**
 * The parameter this module lifts out of the group by name.
 *
 * `elasticache.tf` sets exactly one, and it is the one that decides what happens
 * when the cache fills: `allkeys-lru` evicts, `noeviction` starts refusing
 * writes. The rest of the group is counted, not carried — a surface does not
 * need four hundred engine defaults to answer an operational question.
 */
export const MAXMEMORY_POLICY = "maxmemory-policy"

/* ------------------------------------------------------- the API's shapes -- */

/** Declared rather than imported — see `client.ts`'s one-owner rule for SDK types. */
interface EndpointShape {
  Address?: string
  Port?: number
}

interface PendingModifiedValuesShape {
  NumCacheNodes?: number
  CacheNodeIdsToRemove?: string[]
  EngineVersion?: string
  CacheNodeType?: string
  AuthTokenStatus?: string
  TransitEncryptionEnabled?: boolean
  TransitEncryptionMode?: string
  /** Replication groups only. */
  AutomaticFailoverStatus?: string
  PrimaryClusterId?: string
}

interface CacheClusterShape {
  CacheClusterId?: string
  ARN?: string
  Engine?: string
  EngineVersion?: string
  CacheNodeType?: string
  CacheClusterStatus?: string
  NumCacheNodes?: number
  PreferredMaintenanceWindow?: string
  AutoMinorVersionUpgrade?: boolean
  AtRestEncryptionEnabled?: boolean
  TransitEncryptionEnabled?: boolean
  TransitEncryptionMode?: string
  AuthTokenEnabled?: boolean
  AuthTokenLastModifiedDate?: string | Date
  ReplicationGroupId?: string
  SnapshotRetentionLimit?: number
  SnapshotWindow?: string
  CacheParameterGroup?: {
    CacheParameterGroupName?: string
    ParameterApplyStatus?: string
    CacheNodeIdsToReboot?: string[]
  }
  ConfigurationEndpoint?: EndpointShape
  CacheNodes?: Array<{ CacheNodeId?: string; CacheNodeStatus?: string; Endpoint?: EndpointShape }>
  PendingModifiedValues?: PendingModifiedValuesShape
}

interface DescribeCacheClustersResponse {
  CacheClusters?: CacheClusterShape[]
  Marker?: string
}

interface ReplicationGroupShape {
  ReplicationGroupId?: string
  ARN?: string
  Description?: string
  Status?: string
  MemberClusters?: string[]
  AutomaticFailover?: string
  MultiAZ?: string
  ClusterEnabled?: boolean
  CacheNodeType?: string
  Engine?: string
  AtRestEncryptionEnabled?: boolean
  TransitEncryptionEnabled?: boolean
  TransitEncryptionMode?: string
  AuthTokenEnabled?: boolean
  AuthTokenLastModifiedDate?: string | Date
  SnapshotRetentionLimit?: number
  SnapshotWindow?: string
  KmsKeyId?: string
  PendingModifiedValues?: PendingModifiedValuesShape
}

interface DescribeReplicationGroupsResponse {
  ReplicationGroups?: ReplicationGroupShape[]
  Marker?: string
}

interface DescribeCacheParametersResponse {
  Parameters?: Array<{
    ParameterName?: string
    ParameterValue?: string
    Source?: string
    IsModifiable?: boolean
  }>
  Marker?: string
}

/* ------------------------------------------------------------ the vocabulary -- */

/**
 * Whether a listing was walked to the end.
 *
 * Three arms, because "we read everything", "we stopped early and there was
 * more" and "we never read it" are three different things a surface has to be
 * able to say. The middle one is the reason this type exists at all: a truncated
 * list rendered as a complete one is the same class of lie as an empty list
 * rendered for a denial.
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
 * Whether encryption is on.
 *
 * `unstated` is not folded into `disabled` even though AWS's documented default
 * for the missing field is false — see the module header. Neither may render as
 * "encrypted", and `describeEncryptionState` is the one renderer that guarantees
 * it.
 */
export type EncryptionState =
  | { kind: "enabled" }
  | { kind: "disabled"; why: string }
  | { kind: "unstated"; why: string }

/** Whether a client must present a token to use this cache. Same three-way split. */
export type AuthState =
  | { kind: "required"; lastModifiedAt: string | null }
  | { kind: "not-required"; why: string }
  | { kind: "unstated"; why: string }

/**
 * When AWS is allowed to take the cache down for maintenance.
 *
 * The raw string is kept alongside the parsed parts. `unreadable` exists because
 * a window this engine could not parse must not read as "no window": AWS always
 * has one, and "we did not understand it" sends an operator to look at the
 * string, which is the correct next action.
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

/** One queued change AWS will apply, and whether applying it restarts the cache. */
export interface PendingChange {
  /** The field, in the words the console prints. */
  field: string
  /** What it is now, where this engine read it. Null when the API did not say. */
  from: string | null
  /** What AWS will change it to. Never null: a change with no target is not one. */
  to: string
  /**
   * Whether applying it stops the node.
   *
   * True only where AWS applies the change by replacing or restarting nodes — an
   * engine-version upgrade and a node-type change. A node-count change adds or
   * removes nodes without restarting the survivors, and an auth-token rotation
   * is applied online, so both are queued changes that are not interruptions and
   * are not reported as though they were.
   */
  restarts: boolean
  why: string
}

/**
 * Whether the cache survives losing a node.
 *
 * A cluster that is a replication-group member does not answer this itself —
 * failover is the group's property, and a cluster claiming "no failover" while
 * its group has it enabled is a false alarm an operator would act on.
 */
export type FailoverPosture =
  | { kind: "single-node"; nodes: number; why: string }
  | { kind: "multi-node-no-failover"; nodes: number; why: string }
  | { kind: "automatic-failover"; members: number; multiAz: string | null; why: string }
  | { kind: "failover-disabled"; members: number; why: string }
  | { kind: "in-transition"; status: string; members: number; why: string }
  | { kind: "member-of-group"; replicationGroupId: string; why: string }
  | { kind: "unknown"; why: string }

/**
 * Whether this engine version is behind AWS's current default.
 *
 * One arm, deliberately, for the same reason `sqs.ts` has a one-armed
 * `OldestMessageAge`: the fact lives behind an API this engine holds no
 * capability for, and a field that could be silently absent would render as
 * reassurance. The capability named here is NOT in `capabilities.ts`; adding it
 * is a registry change, not a change this module may make.
 */
export interface VersionCurrency {
  state: "NOT_READABLE"
  needs: "elasticache:DescribeCacheEngineVersions"
  iamAction: "elasticache:DescribeCacheEngineVersions"
  why: string
}

/** Whether AWS may upgrade this cache without being asked, and when it would. */
export type AutomaticUpgrade =
  | { kind: "automatic"; window: MaintenanceWindow; why: string }
  | { kind: "manual"; window: MaintenanceWindow; why: string }
  | { kind: "unstated"; window: MaintenanceWindow; why: string }

/** What one `DescribeCacheParameters` answered, reduced to the operational facts. */
export interface CacheParameters {
  groupName: string
  /** `in-sync`, `pending-reboot` — whether the group's values are actually applied. */
  applyStatus: string | null
  /** The policy that decides what happens when the cache fills. Null when absent. */
  maxmemoryPolicy: string | null
  /** Where that value came from: `user` means somebody set it, `system` is the default. */
  maxmemoryPolicySource: string | null
  parametersRead: number
  truncation: Truncation
}

/** Which tenant a cache belongs to. `unknown` is "we could not look", see the header. */
export type CacheAttribution =
  | { kind: "tenant"; tenantSlug: string }
  | { kind: "shared" }
  | { kind: "unattributed" }
  | { kind: "unknown"; why: string }

export interface CacheClusterReading {
  clusterId: string
  arn: string | null
  /** Where the ARN came from, or why there is none. Never silent. */
  arnProvenance: string
  region: string | null
  partition: string | null
  accountId: string | null
  engine: string | null
  engineVersion: string | null
  nodeType: string | null
  status: string | null
  nodes: number | null
  /** The group this cluster belongs to, when it belongs to one. */
  replicationGroupId: string | null
  /** The endpoint the application dials, when AWS returned one. A label, not a secret. */
  endpoint: { address: string; port: number | null } | null
  atRest: EncryptionState
  inTransit: EncryptionState
  auth: AuthState
  failover: FailoverPosture
  maintenance: MaintenanceWindow
  automaticUpgrade: AutomaticUpgrade
  versionCurrency: VersionCurrency
  pending: readonly PendingChange[]
  /** Its own read, with its own action named — a denial here is not the listing's. */
  parameters: AwsRead<CacheParameters>
  attribution: CacheAttribution
  snapshotRetentionDays: number | null
  refreshMs: number
  asOf: string
}

export interface ReplicationGroupReading {
  replicationGroupId: string
  arn: string | null
  arnProvenance: string
  region: string | null
  partition: string | null
  accountId: string | null
  description: string | null
  status: string | null
  engine: string | null
  nodeType: string | null
  /** Cluster mode: sharded across node groups, or one shard. */
  clusterEnabled: boolean | null
  memberClusterIds: readonly string[]
  atRest: EncryptionState
  inTransit: EncryptionState
  auth: AuthState
  failover: FailoverPosture
  /**
   * Derived from the member clusters that were read.
   *
   * `DescribeReplicationGroups` does not return a maintenance window — it is a
   * per-cluster field — so this is assembled from members and says so when it
   * could not be.
   */
  maintenance: MaintenanceWindow
  pending: readonly PendingChange[]
  attribution: CacheAttribution
  snapshotRetentionDays: number | null
  refreshMs: number
  asOf: string
}

/** One cache that is not encrypted, with the fields that say so. */
export interface PlaintextCache {
  id: string
  kind: "cluster" | "replication group"
  atRest: EncryptionState
  inTransit: EncryptionState
  auth: AuthState
}

/**
 * Whether the estate's caches are encrypted.
 *
 * Five arms, and only ONE of them says encrypted. `unstated` is separate from
 * `encrypted` precisely so that a cache AWS said nothing about cannot be counted
 * as one AWS said yes about; `unreadable` travels alongside every arm so that no
 * answer here ever quietly means "as far as we bothered to look".
 */
export type EncryptionPosture =
  | { kind: "unknown"; why: string }
  | { kind: "nothing-to-report"; why: string }
  | { kind: "encrypted"; encrypted: readonly string[]; unreadable: readonly string[] }
  | {
      kind: "unstated"
      unstated: readonly PlaintextCache[]
      encrypted: readonly string[]
      unreadable: readonly string[]
    }
  | {
      kind: "plaintext"
      plaintext: readonly PlaintextCache[]
      encrypted: readonly string[]
      unreadable: readonly string[]
    }

/** One queued change, attributed to the resource it will happen to. */
export interface ScheduledChange {
  resourceKind: "cluster" | "replication group"
  resourceId: string
  change: PendingChange
  /** When AWS applies it. For a group, the window its members reported. */
  window: MaintenanceWindow
}

/**
 * Whether anything is queued that will interrupt the cache.
 *
 * Lifted out of the per-cluster row for the same reason `sqs.ts` lifts the
 * dead-letter state out of the queue table: it is the one ElastiCache fact that
 * is an event with a time on it rather than a property with a value.
 */
export type ScheduledInterruption =
  | { kind: "unknown"; why: string }
  | { kind: "none"; clustersRead: number; groupsRead: number; unreadable: readonly string[] }
  | {
      kind: "pending"
      changes: readonly ScheduledChange[]
      /** The subset that restarts nodes. This is the one an operator schedules around. */
      restarting: readonly ScheduledChange[]
      unreadable: readonly string[]
    }

/** Everything an ElastiCache surface needs, in one load. */
export interface ElastiCacheReadings {
  identity: AwsRead<Identity>
  tagged: AwsRead<readonly TaggedResource[]>
  /**
   * The clusters. DENIED here is a refused `elasticache:DescribeCacheClusters`
   * and is NEVER `[]` — an operator reading "no cache" when the truth is "we
   * were not allowed to look" is the failure the whole read plane exists against.
   */
  clusters: AwsRead<readonly CacheClusterReading[]>
  /** The groups. An honest EMPTY here IS the answer to "is there a failover replica". */
  replicationGroups: AwsRead<readonly ReplicationGroupReading[]>
  encryption: EncryptionPosture
  interruption: ScheduledInterruption
  /** Whether each listing was walked to the end, per listing. */
  truncation: { clusters: Truncation; replicationGroups: Truncation }
  /** When this whole load was assembled. Explicit, so a surface need not invent one. */
  asOf: string
  /** Each capability's own declared cadence, read from the registry, never retyped. */
  refreshMs: { clusters: number; replicationGroups: number; parameters: number }
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

/**
 * AWS's `ddd:hh24:mi-ddd:hh24:mi` maintenance window, in UTC.
 *
 * The window is the answer to "when will this restart", so a string that does
 * not parse is `unreadable` and never `absent`: every ElastiCache cluster has a
 * window, and reporting "none" for one whose format changed would tell an
 * operator there is no scheduled interruption when there is.
 */
export function parseMaintenanceWindow(raw: string | undefined | null): MaintenanceWindow {
  if (raw === undefined || raw === null || raw.trim() === "") {
    return {
      kind: "absent",
      why:
        "ElastiCache did not return a PreferredMaintenanceWindow for this resource. Every cluster " +
        "has one, so this is a gap in what was read, not a cluster AWS will never touch.",
    }
  }
  const match = WINDOW_SHAPE.exec(raw.trim().toLowerCase())
  if (!match) {
    return {
      kind: "unreadable",
      raw,
      why: `PreferredMaintenanceWindow ${JSON.stringify(raw)} is not AWS's ddd:hh24:mi-ddd:hh24:mi shape`,
    }
  }
  const [, startDay, startHour, startMinute, endDay, endHour, endMinute] = match
  const start = DAY_NAMES[startDay]
  const end = DAY_NAMES[endDay]
  if (!start || !end) {
    return {
      kind: "unreadable",
      raw,
      why: `PreferredMaintenanceWindow ${JSON.stringify(raw)} names a day this engine does not recognise`,
    }
  }
  return {
    kind: "window",
    raw,
    startDay: start,
    startTimeUtc: `${startHour}:${startMinute}`,
    endDay: end,
    endTimeUtc: `${endHour}:${endMinute}`,
  }
}

/**
 * A boolean AWS may simply not have returned.
 *
 * `unstated` carries the field name, because the remedy for it is to go and look
 * at that field — and because a `why` that just said "unknown" would be the same
 * sentence for every field, which is how three different gaps become one
 * unreadable panel.
 */
export function encryptionStateOf(
  value: boolean | undefined,
  field: string,
  resourceId: string,
): EncryptionState {
  if (value === true) return { kind: "enabled" }
  if (value === false) {
    return {
      kind: "disabled",
      why: `ElastiCache returned ${field}=false for ${resourceId}`,
    }
  }
  return {
    kind: "unstated",
    why:
      `ElastiCache answered for ${resourceId} without ${field}. AWS's documented default for the ` +
      `omission is false, but "AWS did not say" is not "AWS said false" — and neither is ` +
      `"encrypted". Unknown, not safe.`,
  }
}

function authStateOf(
  enabled: boolean | undefined,
  lastModified: string | Date | undefined,
  resourceId: string,
): AuthState {
  if (enabled === true) {
    const at =
      lastModified instanceof Date
        ? lastModified.toISOString()
        : typeof lastModified === "string" && lastModified
          ? lastModified
          : null
    return { kind: "required", lastModifiedAt: at }
  }
  if (enabled === false) {
    return {
      kind: "not-required",
      why:
        `ElastiCache returned AuthTokenEnabled=false for ${resourceId}: anything that can reach ` +
        `the endpoint on the network can use this cache without a credential.`,
    }
  }
  return {
    kind: "unstated",
    why: `ElastiCache answered for ${resourceId} without AuthTokenEnabled. Unknown, not "no auth needed".`,
  }
}

/** A number AWS may not have returned. Null rather than a zero this engine invented. */
function statedNumber(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/** A string AWS may not have returned. Empty is treated as absent, not as a value. */
function statedString(value: string | undefined): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null
}

/* --------------------------------------------------------- pending changes -- */

/**
 * The queued changes on one resource.
 *
 * `restarts` is set per field rather than for the whole object, because the two
 * classes have to be told apart: an engine-version upgrade takes the node down,
 * an auth-token rotation does not, and reporting the second as an interruption
 * is how a real one stops being read.
 */
export function pendingChangesOf(
  pending: PendingModifiedValuesShape | undefined,
  current: {
    engineVersion?: string | null
    nodeType?: string | null
    nodes?: number | null
    automaticFailover?: string | null
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
        "an engine-version change is applied by restarting the cache nodes at the maintenance " +
        "window. On a cluster with no replica that restart is downtime, and the cache is cold " +
        "when it comes back.",
    })
  }

  const nodeType = statedString(pending.CacheNodeType)
  if (nodeType) {
    changes.push({
      field: "node type",
      from: current.nodeType ?? null,
      to: nodeType,
      restarts: true,
      why:
        "a node-type change is applied by replacing the nodes. The endpoint survives; the data in " +
        "a cluster with no replica does not.",
    })
  }

  const nodes = statedNumber(pending.NumCacheNodes)
  if (nodes !== null) {
    changes.push({
      field: "node count",
      from: current.nodes === null || current.nodes === undefined ? null : String(current.nodes),
      to: String(nodes),
      restarts: false,
      why: "nodes are added or removed without restarting the ones that stay",
    })
  }

  const removing = pending.CacheNodeIdsToRemove ?? []
  if (removing.length > 0) {
    changes.push({
      field: "nodes being removed",
      from: null,
      to: [...removing].sort().join(", "),
      restarts: false,
      why: "these node ids are scheduled for removal at the maintenance window",
    })
  }

  const authStatus = statedString(pending.AuthTokenStatus)
  if (authStatus) {
    changes.push({
      field: "auth token",
      from: null,
      to: authStatus,
      restarts: false,
      why: "an auth-token rotation is applied online; clients holding the old token keep working until it is deleted",
    })
  }

  if (pending.TransitEncryptionEnabled !== undefined) {
    changes.push({
      field: "encryption in transit",
      from: null,
      to: pending.TransitEncryptionEnabled ? "enabled" : "disabled",
      restarts: true,
      why: "changing in-transit encryption is applied by restarting the nodes",
    })
  }

  const failover = statedString(pending.AutomaticFailoverStatus)
  if (failover) {
    changes.push({
      field: "automatic failover",
      from: current.automaticFailover ?? null,
      to: failover,
      restarts: false,
      why: "the failover setting changes without taking the cache down",
    })
  }

  const primary = statedString(pending.PrimaryClusterId)
  if (primary) {
    changes.push({
      field: "primary cluster",
      from: null,
      to: primary,
      restarts: false,
      why: "the primary role is moving to this member; writes fail over to it when it applies",
    })
  }

  return changes
}

/* -------------------------------------------------------------- failover -- */

function clusterFailover(cluster: CacheClusterShape, clusterId: string): FailoverPosture {
  const groupId = statedString(cluster.ReplicationGroupId)
  if (groupId) {
    return {
      kind: "member-of-group",
      replicationGroupId: groupId,
      why:
        `this cluster is a node group member of ${groupId}; whether it fails over is that group's ` +
        `AutomaticFailover setting, not a property of the cluster.`,
    }
  }
  const nodes = statedNumber(cluster.NumCacheNodes)
  if (nodes === null) {
    return {
      kind: "unknown",
      why: `ElastiCache answered for ${clusterId} without NumCacheNodes, so its redundancy cannot be stated`,
    }
  }
  if (nodes <= 1) {
    return {
      kind: "single-node",
      nodes,
      why:
        `${clusterId} is a standalone cluster of one node in no replication group. There is no ` +
        `replica and no failover: when the node goes, the cache goes, and everything behind it ` +
        `takes the miss.`,
    }
  }
  return {
    kind: "multi-node-no-failover",
    nodes,
    why:
      `${clusterId} has ${nodes} nodes and is in no replication group. Nodes in a standalone ` +
      `cluster do not fail over for one another; losing one loses the data on it.`,
  }
}

function groupFailover(group: ReplicationGroupShape, groupId: string): FailoverPosture {
  const members = (group.MemberClusters ?? []).length
  const status = statedString(group.AutomaticFailover)
  const multiAz = statedString(group.MultiAZ)
  if (status === null) {
    return {
      kind: "unknown",
      why: `ElastiCache answered for ${groupId} without AutomaticFailover, so failover cannot be stated`,
    }
  }
  const normalised = status.toLowerCase()
  if (normalised === "enabled") {
    return {
      kind: "automatic-failover",
      members,
      multiAz,
      why: `${groupId} promotes a replica automatically when the primary fails`,
    }
  }
  if (normalised === "enabling" || normalised === "disabling") {
    return {
      kind: "in-transition",
      status,
      members,
      why: `${groupId} reports AutomaticFailover=${status}: the setting is mid-change and is neither yet`,
    }
  }
  return {
    kind: "failover-disabled",
    members,
    why:
      `${groupId} has AutomaticFailover=${status}. A failed primary is promoted by hand, or not ` +
      `at all — the replicas exist and nothing will use them.`,
  }
}

/* -------------------------------------------------------- version currency -- */

/**
 * What this engine can and cannot say about how current an engine version is.
 *
 * Built per cluster so the sentence names the engine and version in front of the
 * operator, and so it cannot be mistaken for a global note nobody reads.
 */
export function versionCurrencyFor(
  engine: string | null,
  engineVersion: string | null,
): VersionCurrency {
  const named =
    engine && engineVersion
      ? `${engine} ${engineVersion}`
      : engine
        ? `${engine} (version not returned)`
        : "this cache"
  return {
    state: "NOT_READABLE",
    needs: "elasticache:DescribeCacheEngineVersions",
    iamAction: "elasticache:DescribeCacheEngineVersions",
    why:
      `whether ${named} is behind AWS's current default engine version is not readable by this ` +
      `engine: the comparison needs elasticache:DescribeCacheEngineVersions, which is not a ` +
      `capability this console holds. Unknown, not up to date.`,
  }
}

function automaticUpgradeOf(
  autoMinor: boolean | undefined,
  window: MaintenanceWindow,
  clusterId: string,
): AutomaticUpgrade {
  if (autoMinor === true) {
    return {
      kind: "automatic",
      window,
      why:
        `${clusterId} has AutoMinorVersionUpgrade=true: AWS may take it through a minor engine ` +
        `upgrade during its maintenance window without anybody asking, and that upgrade restarts ` +
        `the nodes.`,
    }
  }
  if (autoMinor === false) {
    return {
      kind: "manual",
      window,
      why:
        `${clusterId} has AutoMinorVersionUpgrade=false: it will not be upgraded automatically, ` +
        `which also means it stays on this version until somebody moves it.`,
    }
  }
  return {
    kind: "unstated",
    window,
    why: `ElastiCache answered for ${clusterId} without AutoMinorVersionUpgrade`,
  }
}

/* ------------------------------------------------------------------ ARNs -- */

function arnParts(arn: string | null): string[] {
  return arn ? arn.split(":") : []
}

/**
 * A cluster's ARN, assembled from the resolved identity.
 *
 * Only used when ElastiCache did not return one. The partition and region come
 * from identity, never from a literal — see the module header on GE-010-007 —
 * and this returns null rather than half an ARN when identity is unresolved.
 */
export function deriveClusterArn(clusterId: string, identity: AwsRead<Identity>): string | null {
  return deriveArn("cluster", clusterId, identity)
}

/** The same, for a replication group. ElastiCache's ARN resource type is `replicationgroup`. */
export function deriveReplicationGroupArn(
  groupId: string,
  identity: AwsRead<Identity>,
): string | null {
  return deriveArn("replicationgroup", groupId, identity)
}

function deriveArn(
  resourceType: string,
  id: string,
  identity: AwsRead<Identity>,
): string | null {
  if (identity.state !== "ACTUAL" && identity.state !== "STALE") return null
  if (!id) return null
  const { partition, region, accountId } = identity.value
  if (!partition || !region || !accountId) return null
  return `arn:${partition}:elasticache:${region}:${accountId}:${resourceType}:${id}`
}

/* ----------------------------------------------------------- attribution -- */

/** From the tag index, with `unknown` when the index itself was not readable. */
function attributionFor(
  arn: string | null,
  tagged: AwsRead<readonly TaggedResource[]>,
  index: Map<string, Readonly<Record<string, string>>>,
): CacheAttribution {
  if (tagged.state !== "ACTUAL" && tagged.state !== "STALE" && tagged.state !== "EMPTY") {
    return {
      kind: "unknown",
      why: `this cache's tags were not read — ${describeRead(tagged, "the tag index")}`,
    }
  }
  if (!arn) {
    return {
      kind: "unknown",
      why:
        "this cache has no ARN this engine can state, so it cannot be joined against the tag " +
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

/* ----------------------------------------------------------- the readings -- */

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
 * The cap is not a silent truncation and it is not a thrown error: `sqs.ts`
 * throws, which turns a partial answer into ERROR, and that is the right choice
 * for a listing whose completeness the surface cannot qualify. Here the surface
 * CAN — `Truncation` is a field it renders — so the pages that were read are
 * returned with an explicit "there was more", which is strictly more information
 * than an error carrying none of them.
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

async function readClusters(
  gw: AwsGateway,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<Page<CacheClusterShape>>> {
  return readAws<Page<CacheClusterShape>>(
    "elasticache:DescribeCacheClusters",
    async () =>
      pagedRead<CacheClusterShape>(async (marker) => {
        const response = (await gw.call("elasticache:DescribeCacheClusters", {
          Marker: marker,
        })) as DescribeCacheClustersResponse
        return {
          items: (response?.CacheClusters ?? []).filter((c) => statedString(c?.CacheClusterId)),
          marker: response?.Marker || undefined,
        }
      }, "elasticache:DescribeCacheClusters"),
    {
      now: options.now,
      denial: options.denial,
      // An object is never empty by the default test, and "there is genuinely no
      // cache in this account" has to be able to say EMPTY. A truncated read is
      // never EMPTY, because "we stopped early" is not "there is nothing".
      isEmpty: (value) => {
        const page = value as Page<CacheClusterShape>
        return page.items.length === 0 && page.truncation.kind === "complete"
      },
      ...RETRY,
    },
  )
}

async function readReplicationGroups(
  gw: AwsGateway,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<Page<ReplicationGroupShape>>> {
  return readAws<Page<ReplicationGroupShape>>(
    "elasticache:DescribeReplicationGroups",
    async () =>
      pagedRead<ReplicationGroupShape>(async (marker) => {
        const response = (await gw.call("elasticache:DescribeReplicationGroups", {
          Marker: marker,
        })) as DescribeReplicationGroupsResponse
        return {
          items: (response?.ReplicationGroups ?? []).filter((g) =>
            statedString(g?.ReplicationGroupId),
          ),
          marker: response?.Marker || undefined,
        }
      }, "elasticache:DescribeReplicationGroups"),
    {
      now: options.now,
      denial: options.denial,
      isEmpty: (value) => {
        const page = value as Page<ReplicationGroupShape>
        return page.items.length === 0 && page.truncation.kind === "complete"
      },
      ...RETRY,
    },
  )
}

async function readParameters(
  gw: AwsGateway,
  groupName: string,
  applyStatus: string | null,
  options: { now: () => Date; denial: DenialContext },
): Promise<AwsRead<CacheParameters>> {
  return readAws<CacheParameters>(
    "elasticache:DescribeCacheParameters",
    async () => {
      const page = await pagedRead<{
        ParameterName?: string
        ParameterValue?: string
        Source?: string
      }>(async (marker) => {
        const response = (await gw.call("elasticache:DescribeCacheParameters", {
          CacheParameterGroupName: groupName,
          Marker: marker,
        })) as DescribeCacheParametersResponse
        return { items: response?.Parameters ?? [], marker: response?.Marker || undefined }
      }, `elasticache:DescribeCacheParameters for ${groupName}`)

      const policy = page.items.find((p) => p?.ParameterName === MAXMEMORY_POLICY)
      return {
        groupName,
        applyStatus,
        maxmemoryPolicy: statedString(policy?.ParameterValue),
        maxmemoryPolicySource: statedString(policy?.Source),
        parametersRead: page.items.length,
        truncation: page.truncation,
      }
    },
    {
      now: options.now,
      denial: options.denial,
      // A parameter group that answered is never "empty": the engine defaults
      // alone are hundreds of rows, so nothing here would be an answer, and an
      // EMPTY panel would read as "this group sets nothing".
      isEmpty: () => false,
      ...RETRY,
    },
  )
}

/* ------------------------------------------------------------- the surface -- */

/**
 * Every cache in the estate, its encryption, its redundancy and what AWS has
 * queued against it.
 *
 * The production entry point. A route or a page calls it with no arguments and
 * gets `liveGateway()`, which resolves `client.ts` on first call; a test passes
 * a stand-in gateway to the SAME function, because a test that drove a private
 * helper would stay green on the day the caller stopped calling it.
 */
export async function elastiCacheReadings(
  supplied?: AwsGateway,
  options: { now?: () => Date } = {},
): Promise<ElastiCacheReadings> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())

  const identity = await resolveIdentity(supplied, { now })
  const denial = denialContextFrom(identity)
  const tagged = await taggedResources(supplied, { now, denial })
  const index = tagIndex(
    tagged.state === "ACTUAL" || tagged.state === "STALE" ? tagged.value : [],
  )

  // Independent reads. Neither one's failure is allowed to decide the other's
  // state, which is why they are two `readAws` calls and not one try block.
  const clusterRead = await readClusters(gw, { now, denial })
  const groupRead = await readReplicationGroups(gw, { now, denial })

  const asOf = now().toISOString()
  const refreshMs = {
    clusters: CAPABILITIES["elasticache:DescribeCacheClusters"].refreshMs,
    replicationGroups: CAPABILITIES["elasticache:DescribeReplicationGroups"].refreshMs,
    parameters: CAPABILITIES["elasticache:DescribeCacheParameters"].refreshMs,
  }

  const rawClusters =
    clusterRead.state === "ACTUAL" || clusterRead.state === "STALE"
      ? [...clusterRead.value.items].sort((a, b) =>
          String(a.CacheClusterId).localeCompare(String(b.CacheClusterId)),
        )
      : []
  const rawGroups =
    groupRead.state === "ACTUAL" || groupRead.state === "STALE"
      ? [...groupRead.value.items].sort((a, b) =>
          String(a.ReplicationGroupId).localeCompare(String(b.ReplicationGroupId)),
        )
      : []

  /* -- the parameter sub-reads: one per DISTINCT group, capped, degrading alone -- */

  const groupNames: string[] = []
  for (const cluster of rawClusters) {
    const name = statedString(cluster.CacheParameterGroup?.CacheParameterGroupName)
    if (name && !groupNames.includes(name)) groupNames.push(name)
  }
  groupNames.sort()

  const parameterReads = new Map<string, AwsRead<CacheParameters>>()
  const reachable = groupNames.slice(0, MAX_PARAMETER_GROUP_READS)
  for (let start = 0; start < reachable.length; start += PARAMETER_CONCURRENCY) {
    const batch = reachable.slice(start, start + PARAMETER_CONCURRENCY)
    const read = await Promise.all(
      batch.map((name) => {
        const applyStatus =
          statedString(
            rawClusters.find(
              (c) => statedString(c.CacheParameterGroup?.CacheParameterGroupName) === name,
            )?.CacheParameterGroup?.ParameterApplyStatus,
          ) ?? null
        return readParameters(gw, name, applyStatus, { now, denial })
      }),
    )
    batch.forEach((name, i) => parameterReads.set(name, read[i]))
  }
  for (const name of groupNames.slice(MAX_PARAMETER_GROUP_READS)) {
    parameterReads.set(name, {
      state: "UNCONFIGURED",
      capability: "elasticache:DescribeCacheParameters",
      why:
        `this engine reads at most ${MAX_PARAMETER_GROUP_READS} parameter groups per load and ` +
        `${name} is past that. Its values were not read — which is not the same as its setting ` +
        `nothing.`,
    })
  }

  /* ------------------------------------------------------- the cluster rows -- */

  const clusterReadings: CacheClusterReading[] = rawClusters.map((cluster) => {
    const clusterId = String(cluster.CacheClusterId)
    const fromAws = statedString(cluster.ARN)
    const derived = fromAws ? null : deriveClusterArn(clusterId, identity)
    const arn = fromAws ?? derived
    const arnProvenance = fromAws
      ? "ElastiCache's own ARN field"
      : derived
        ? "assembled from the resolved identity's partition, region and account — ElastiCache " +
          "returned no ARN for this cluster"
        : "none — ElastiCache returned no ARN and identity is unresolved, so this engine will not " +
          "assemble one it cannot stand behind"

    const parts = arnParts(arn)
    const identityResolved = identity.state === "ACTUAL" || identity.state === "STALE"
    const engine = statedString(cluster.Engine)
    const engineVersion = statedString(cluster.EngineVersion)
    const nodeType = statedString(cluster.CacheNodeType)
    const nodes = statedNumber(cluster.NumCacheNodes)
    const maintenance = parseMaintenanceWindow(cluster.PreferredMaintenanceWindow)
    const groupName = statedString(cluster.CacheParameterGroup?.CacheParameterGroupName)
    const endpointShape =
      cluster.ConfigurationEndpoint?.Address
        ? cluster.ConfigurationEndpoint
        : (cluster.CacheNodes ?? []).find((n) => n?.Endpoint?.Address)?.Endpoint

    const parameters: AwsRead<CacheParameters> = groupName
      ? (parameterReads.get(groupName) ?? {
          state: "UNCONFIGURED",
          capability: "elasticache:DescribeCacheParameters",
          why: `${groupName} was named by this cluster but never read`,
        })
      : {
          state: "UNCONFIGURED",
          capability: "elasticache:DescribeCacheParameters",
          why:
            `ElastiCache answered for ${clusterId} without a CacheParameterGroup name, so there ` +
            `is nothing to ask DescribeCacheParameters about. Its eviction policy is unknown.`,
        }

    return {
      clusterId,
      arn,
      arnProvenance,
      partition: parts.length >= 6 ? parts[1] : identityResolved ? identity.value.partition : null,
      region: parts.length >= 6 ? parts[3] : identityResolved ? identity.value.region : null,
      accountId: parts.length >= 6 ? parts[4] : identityResolved ? identity.value.accountId : null,
      engine,
      engineVersion,
      nodeType,
      status: statedString(cluster.CacheClusterStatus),
      nodes,
      replicationGroupId: statedString(cluster.ReplicationGroupId),
      endpoint: endpointShape?.Address
        ? { address: endpointShape.Address, port: statedNumber(endpointShape.Port) }
        : null,
      atRest: encryptionStateOf(cluster.AtRestEncryptionEnabled, "AtRestEncryptionEnabled", clusterId),
      inTransit: encryptionStateOf(
        cluster.TransitEncryptionEnabled,
        "TransitEncryptionEnabled",
        clusterId,
      ),
      auth: authStateOf(cluster.AuthTokenEnabled, cluster.AuthTokenLastModifiedDate, clusterId),
      failover: clusterFailover(cluster, clusterId),
      maintenance,
      automaticUpgrade: automaticUpgradeOf(cluster.AutoMinorVersionUpgrade, maintenance, clusterId),
      versionCurrency: versionCurrencyFor(engine, engineVersion),
      pending: pendingChangesOf(cluster.PendingModifiedValues, {
        engineVersion,
        nodeType,
        nodes,
      }),
      parameters,
      attribution: attributionFor(arn, tagged, index),
      snapshotRetentionDays: statedNumber(cluster.SnapshotRetentionLimit),
      refreshMs: refreshMs.clusters,
      asOf,
    }
  })

  /* ---------------------------------------------------------- the group rows -- */

  const groupReadings: ReplicationGroupReading[] = rawGroups.map((group) => {
    const groupId = String(group.ReplicationGroupId)
    const fromAws = statedString(group.ARN)
    const derived = fromAws ? null : deriveReplicationGroupArn(groupId, identity)
    const arn = fromAws ?? derived
    const arnProvenance = fromAws
      ? "ElastiCache's own ARN field"
      : derived
        ? "assembled from the resolved identity's partition, region and account — ElastiCache " +
          "returned no ARN for this replication group"
        : "none — ElastiCache returned no ARN and identity is unresolved, so this engine will not " +
          "assemble one it cannot stand behind"
    const parts = arnParts(arn)
    const identityResolved = identity.state === "ACTUAL" || identity.state === "STALE"
    const members = (group.MemberClusters ?? []).filter(
      (m): m is string => typeof m === "string" && m !== "",
    )

    return {
      replicationGroupId: groupId,
      arn,
      arnProvenance,
      partition: parts.length >= 6 ? parts[1] : identityResolved ? identity.value.partition : null,
      region: parts.length >= 6 ? parts[3] : identityResolved ? identity.value.region : null,
      accountId: parts.length >= 6 ? parts[4] : identityResolved ? identity.value.accountId : null,
      description: statedString(group.Description),
      status: statedString(group.Status),
      engine: statedString(group.Engine),
      nodeType: statedString(group.CacheNodeType),
      clusterEnabled: typeof group.ClusterEnabled === "boolean" ? group.ClusterEnabled : null,
      memberClusterIds: [...members].sort(),
      atRest: encryptionStateOf(group.AtRestEncryptionEnabled, "AtRestEncryptionEnabled", groupId),
      inTransit: encryptionStateOf(
        group.TransitEncryptionEnabled,
        "TransitEncryptionEnabled",
        groupId,
      ),
      auth: authStateOf(group.AuthTokenEnabled, group.AuthTokenLastModifiedDate, groupId),
      failover: groupFailover(group, groupId),
      maintenance: windowFromMembers(members, clusterReadings, groupId),
      pending: pendingChangesOf(group.PendingModifiedValues, {
        nodeType: statedString(group.CacheNodeType),
        automaticFailover: statedString(group.AutomaticFailover),
      }),
      attribution: attributionFor(arn, tagged, index),
      snapshotRetentionDays: statedNumber(group.SnapshotRetentionLimit),
      refreshMs: refreshMs.replicationGroups,
      asOf,
    }
  })

  /* ------------------------------------------------- assembling the readings -- */

  // No cast on the non-value arms: after this narrowing the arms left are
  // precisely the ones with no `value` field, so they already ARE an
  // `AwsRead<readonly …[]>`. A cast here would be where an empty array could
  // one day be smuggled in.
  const clusters: AwsRead<readonly CacheClusterReading[]> =
    clusterRead.state === "ACTUAL" || clusterRead.state === "STALE"
      ? { ...clusterRead, value: clusterReadings }
      : clusterRead
  const replicationGroups: AwsRead<readonly ReplicationGroupReading[]> =
    groupRead.state === "ACTUAL" || groupRead.state === "STALE"
      ? { ...groupRead, value: groupReadings }
      : groupRead

  return {
    identity,
    tagged,
    clusters,
    replicationGroups,
    encryption: encryptionPosture(clusters, replicationGroups),
    interruption: scheduledInterruption(clusters, replicationGroups),
    truncation: {
      clusters: truncationOf(clusterRead, "the cluster listing"),
      replicationGroups: truncationOf(groupRead, "the replication-group listing"),
    },
    asOf,
    refreshMs,
  }
}

/** A replication group's maintenance window, from the members that were read. */
function windowFromMembers(
  members: readonly string[],
  clusters: readonly CacheClusterReading[],
  groupId: string,
): MaintenanceWindow {
  const windows = clusters
    .filter((c) => members.includes(c.clusterId))
    .map((c) => c.maintenance)
    .filter((w): w is Extract<MaintenanceWindow, { kind: "window" }> => w.kind === "window")
  const distinct = [...new Set(windows.map((w) => w.raw))].sort()
  if (distinct.length === 1) return windows[0]
  if (distinct.length > 1) {
    return {
      kind: "unreadable",
      raw: distinct.join(" / "),
      why:
        `the member clusters of ${groupId} report different maintenance windows, so this group has ` +
        `no single window — each member is taken down in its own`,
    }
  }
  return {
    kind: "absent",
    why:
      `elasticache:DescribeReplicationGroups does not return a maintenance window — it is a ` +
      `per-cluster field — and no member cluster of ${groupId} was read, so when AWS would take ` +
      `this group down is unknown.`,
  }
}

function truncationOf(read: AwsRead<Page<unknown>>, what: string): Truncation {
  if (read.state === "ACTUAL" || read.state === "STALE") return read.value.truncation
  if (read.state === "EMPTY") return { kind: "complete" }
  return { kind: "not-read", why: describeRead(read, what) }
}

/* ------------------------------------------------------- estate questions -- */

/**
 * Whether the estate's caches are encrypted.
 *
 * Exported and pure so the derivation can be reasoned about on its own —
 * `elastiCacheReadings` is the only production caller and the tests drive it
 * through there.
 */
export function encryptionPosture(
  clusters: AwsRead<readonly CacheClusterReading[]>,
  groups: AwsRead<readonly ReplicationGroupReading[]>,
): EncryptionPosture {
  const clustersRead = clusters.state === "ACTUAL" || clusters.state === "STALE"
  const clustersEmpty = clusters.state === "EMPTY"
  const groupsRead = groups.state === "ACTUAL" || groups.state === "STALE"
  const groupsEmpty = groups.state === "EMPTY"

  if (!clustersRead && !clustersEmpty) {
    return { kind: "unknown", why: describeRead(clusters, "the cluster listing") }
  }

  const unreadable: string[] = []
  if (!groupsRead && !groupsEmpty) {
    unreadable.push(describeRead(groups, "the replication-group listing"))
  }

  const caches: PlaintextCache[] = []
  if (clustersRead) {
    for (const c of clusters.value) {
      caches.push({
        id: c.clusterId,
        kind: "cluster",
        atRest: c.atRest,
        inTransit: c.inTransit,
        auth: c.auth,
      })
    }
  }
  if (groupsRead) {
    for (const g of groups.value) {
      caches.push({
        id: g.replicationGroupId,
        kind: "replication group",
        atRest: g.atRest,
        inTransit: g.inTransit,
        auth: g.auth,
      })
    }
  }

  if (caches.length === 0) {
    if (unreadable.length > 0) {
      return {
        kind: "unknown",
        why:
          `no cache cluster exists in this account and the replication groups could not be read — ` +
          `${unreadable.join("; ")}`,
      }
    }
    return {
      kind: "nothing-to-report",
      why: "this account has no ElastiCache cluster and no replication group, so nothing is encrypted or not",
    }
  }

  const plaintext = caches.filter(
    (c) => c.atRest.kind === "disabled" || c.inTransit.kind === "disabled",
  )
  const unstated = caches.filter(
    (c) =>
      !plaintext.includes(c) && (c.atRest.kind === "unstated" || c.inTransit.kind === "unstated"),
  )
  const encrypted = caches
    .filter((c) => c.atRest.kind === "enabled" && c.inTransit.kind === "enabled")
    .map((c) => c.id)
    .sort()

  if (plaintext.length > 0) return { kind: "plaintext", plaintext, encrypted, unreadable }
  if (unstated.length > 0) return { kind: "unstated", unstated, encrypted, unreadable }
  return { kind: "encrypted", encrypted, unreadable }
}

/**
 * Whether anything AWS has queued will interrupt the cache, and when.
 *
 * Pure and exported for the same reason as `encryptionPosture`. The `restarting`
 * subset is the point of it: an auth-token rotation and an engine-version
 * upgrade are both "pending", and only one of them is an outage to schedule
 * around.
 */
export function scheduledInterruption(
  clusters: AwsRead<readonly CacheClusterReading[]>,
  groups: AwsRead<readonly ReplicationGroupReading[]>,
): ScheduledInterruption {
  const clustersRead = clusters.state === "ACTUAL" || clusters.state === "STALE"
  const clustersEmpty = clusters.state === "EMPTY"
  if (!clustersRead && !clustersEmpty) {
    return { kind: "unknown", why: describeRead(clusters, "the cluster listing") }
  }

  const groupsRead = groups.state === "ACTUAL" || groups.state === "STALE"
  const groupsEmpty = groups.state === "EMPTY"
  const unreadable: string[] = []
  if (!groupsRead && !groupsEmpty) {
    unreadable.push(describeRead(groups, "the replication-group listing"))
  }

  const changes: ScheduledChange[] = []
  if (clustersRead) {
    for (const c of clusters.value) {
      for (const change of c.pending) {
        changes.push({
          resourceKind: "cluster",
          resourceId: c.clusterId,
          change,
          window: c.maintenance,
        })
      }
    }
  }
  if (groupsRead) {
    for (const g of groups.value) {
      for (const change of g.pending) {
        changes.push({
          resourceKind: "replication group",
          resourceId: g.replicationGroupId,
          change,
          window: g.maintenance,
        })
      }
    }
  }

  if (changes.length === 0) {
    return {
      kind: "none",
      clustersRead: clustersRead ? clusters.value.length : 0,
      groupsRead: groupsRead ? groups.value.length : 0,
      unreadable,
    }
  }
  return {
    kind: "pending",
    changes,
    restarting: changes.filter((c) => c.change.restarts),
    unreadable,
  }
}

/* ------------------------------------------------------------- rendering -- */

/** The sentence a surface prints for a maintenance window. */
export function describeMaintenanceWindow(window: MaintenanceWindow): string {
  switch (window.kind) {
    case "window":
      return (
        `${window.startDay} ${window.startTimeUtc} to ${window.endDay} ${window.endTimeUtc} UTC ` +
        `(${window.raw})`
      )
    case "absent":
      return `maintenance window unknown — ${window.why}`
    case "unreadable":
      return `maintenance window unreadable — ${window.why}`
  }
}

/**
 * The sentence a surface prints for one encryption field.
 *
 * One renderer, for the same reason `describeRead` is one renderer: `unstated`
 * must not read as "encrypted" on one surface and correctly on another. Neither
 * the `disabled` nor the `unstated` string contains the word "encrypted" on its
 * own, and only `enabled` says "encrypted".
 */
export function describeEncryptionState(state: EncryptionState, what: string): string {
  switch (state.kind) {
    case "enabled":
      return `${what}: encrypted`
    case "disabled":
      return `${what}: NOT encrypted — ${state.why}`
    case "unstated":
      return `${what}: unknown — ${state.why}`
  }
}

/** The sentence a surface prints for whether a credential is needed. */
export function describeAuthState(auth: AuthState): string {
  switch (auth.kind) {
    case "required":
      return `auth token required${auth.lastModifiedAt ? ` (last changed ${auth.lastModifiedAt})` : ""}`
    case "not-required":
      return `NO auth token — ${auth.why}`
    case "unstated":
      return `auth unknown — ${auth.why}`
  }
}

/** The sentence a surface prints for whether the cache survives a node loss. */
export function describeFailover(failover: FailoverPosture): string {
  switch (failover.kind) {
    case "single-node":
      return `SINGLE NODE, NO FAILOVER — ${failover.why}`
    case "multi-node-no-failover":
      return `no failover — ${failover.why}`
    case "automatic-failover":
      return (
        `automatic failover across ${failover.members} member(s)` +
        `${failover.multiAz ? `, MultiAZ ${failover.multiAz}` : ""}`
      )
    case "failover-disabled":
      return `FAILOVER DISABLED — ${failover.why}`
    case "in-transition":
      return `failover ${failover.status} — ${failover.why}`
    case "member-of-group":
      return `member of ${failover.replicationGroupId} — ${failover.why}`
    case "unknown":
      return `failover unknown — ${failover.why}`
  }
}

/** The sentence a surface prints for one cache's attribution. */
export function describeCacheAttribution(attribution: CacheAttribution): string {
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

/** The sentence a surface prints for one cluster's parameter group. */
export function describeParameters(parameters: AwsRead<CacheParameters>): string {
  if (parameters.state === "ACTUAL" || parameters.state === "STALE") {
    const p = parameters.value
    const policy = p.maxmemoryPolicy
      ? `${MAXMEMORY_POLICY}=${p.maxmemoryPolicy}` +
        `${p.maxmemoryPolicySource ? ` (source ${p.maxmemoryPolicySource})` : ""}`
      : `${MAXMEMORY_POLICY} not returned by the group`
    return (
      `parameter group ${p.groupName} — ${policy}` +
      `${p.applyStatus ? `, apply status ${p.applyStatus}` : ""}` +
      `${p.truncation.kind === "truncated" ? ` · ${describeTruncation(p.truncation)}` : ""}`
    )
  }
  return describeRead(parameters, "the parameter group")
}

/** The sentence a surface prints for the estate's encryption. */
export function describeEncryptionPosture(posture: EncryptionPosture): string {
  switch (posture.kind) {
    case "unknown":
      return `unknown — ${posture.why}`
    case "nothing-to-report":
      return `nothing to report — ${posture.why}`
    case "encrypted": {
      const qualifier =
        posture.unreadable.length === 0
          ? ""
          : `, though ${posture.unreadable.length} listing(s) could not be read (${posture.unreadable.join("; ")})`
      return `every cache states encryption at rest and in transit — ${posture.encrypted.join(", ")}${qualifier}`
    }
    case "unstated": {
      const named = posture.unstated.map((c) => `${c.id} (${c.kind})`).join(", ")
      return (
        `encryption UNSTATED for ${posture.unstated.length} cache(s): ${named}. AWS did not return ` +
        `the field, and this engine will not report a cache it cannot see as encrypted.`
      )
    }
    case "plaintext": {
      const named = posture.plaintext
        .map(
          (c) =>
            `${c.id} (${c.kind}) — ${describeEncryptionState(c.atRest, "at rest")}; ` +
            `${describeEncryptionState(c.inTransit, "in transit")}; ${describeAuthState(c.auth)}`,
        )
        .join(" | ")
      return `CACHE NOT ENCRYPTED — ${posture.plaintext.length} cache(s): ${named}`
    }
  }
}

/** The sentence a surface prints for what AWS has queued. */
export function describeScheduledInterruption(state: ScheduledInterruption): string {
  switch (state.kind) {
    case "unknown":
      return `unknown — ${state.why}`
    case "none": {
      const qualifier =
        state.unreadable.length === 0
          ? ""
          : ` ${state.unreadable.length} listing(s) could not be read (${state.unreadable.join("; ")}), so this is qualified.`
      return (
        `nothing queued — ${state.clustersRead} cluster(s) and ${state.groupsRead} replication ` +
        `group(s) answered with no PendingModifiedValues.${qualifier}`
      )
    }
    case "pending": {
      const named = state.changes
        .map(
          (c) =>
            `${c.resourceId} (${c.resourceKind}) ${c.change.field}` +
            `${c.change.from ? ` ${c.change.from} →` : " →"} ${c.change.to}` +
            `${c.change.restarts ? ` — RESTARTS at ${describeMaintenanceWindow(c.window)}` : " — applied without a restart"}`,
        )
        .join("; ")
      const head =
        state.restarting.length > 0
          ? `SCHEDULED INTERRUPTION — ${state.restarting.length} of ${state.changes.length} queued change(s) restart the cache`
          : `queued, none restarting — ${state.changes.length} change(s)`
      return `${head}: ${named}`
    }
  }
}

/** The sentence a surface prints for one cluster. One funnel, so states cannot drift. */
export function describeCacheCluster(cluster: CacheClusterReading): string {
  const where =
    cluster.region && cluster.partition
      ? `${cluster.region} (partition ${cluster.partition})`
      : "region unknown — identity is unresolved and ElastiCache returned no ARN"
  const engine =
    cluster.engine && cluster.engineVersion
      ? `${cluster.engine} ${cluster.engineVersion}`
      : (cluster.engine ?? "engine not returned")
  return (
    `${cluster.clusterId} — ${engine} on ${cluster.nodeType ?? "an unstated node type"} × ` +
    `${cluster.nodes === null ? "an unstated number of" : cluster.nodes} node(s) — ${where} — ` +
    `${describeCacheAttribution(cluster.attribution)} · ` +
    `${describeEncryptionState(cluster.atRest, "at rest")} · ` +
    `${describeEncryptionState(cluster.inTransit, "in transit")} · ` +
    `${describeAuthState(cluster.auth)} · ${describeFailover(cluster.failover)} · ` +
    `maintenance ${describeMaintenanceWindow(cluster.maintenance)} · ` +
    `${cluster.automaticUpgrade.why} · version currency: ${cluster.versionCurrency.why} · ` +
    `${describeParameters(cluster.parameters)} · as of ${cluster.asOf}, refreshed every ` +
    `${Math.round(cluster.refreshMs / 1000)}s`
  )
}

/** The sentence a surface prints for one replication group. */
export function describeReplicationGroup(group: ReplicationGroupReading): string {
  const where =
    group.region && group.partition
      ? `${group.region} (partition ${group.partition})`
      : "region unknown — identity is unresolved and ElastiCache returned no ARN"
  return (
    `${group.replicationGroupId} — ${group.status ?? "status not returned"} on ` +
    `${group.nodeType ?? "an unstated node type"} — ${where} — ` +
    `${describeCacheAttribution(group.attribution)} · members ` +
    `${group.memberClusterIds.length > 0 ? group.memberClusterIds.join(", ") : "none returned"} · ` +
    `${describeEncryptionState(group.atRest, "at rest")} · ` +
    `${describeEncryptionState(group.inTransit, "in transit")} · ` +
    `${describeAuthState(group.auth)} · ${describeFailover(group.failover)} · ` +
    `maintenance ${describeMaintenanceWindow(group.maintenance)} · as of ${group.asOf}, ` +
    `refreshed every ${Math.round(group.refreshMs / 1000)}s`
  )
}

export interface ElastiCacheLine {
  label: string
  text: string
}

/**
 * What an ElastiCache surface prints.
 *
 * A surface agent renders exactly these strings. The tests assert on them, which
 * is what makes the mutation proofs land on the production path rather than on a
 * helper nothing calls.
 */
export function elastiCacheLines(readings: ElastiCacheReadings): readonly ElastiCacheLine[] {
  const lines: ElastiCacheLine[] = [
    {
      label: "Cache clusters",
      // The truncation sentence is appended rather than folded into
      // `describeRead`'s subject, because the DENIED and THROTTLED arms
      // deliberately drop that subject — and "was this list complete" is a
      // question whose answer must survive the state that makes it matter most.
      text:
        `${describeRead(
          readings.clusters,
          `cache clusters read from AWS, refreshed every ${Math.round(readings.refreshMs.clusters / 1000)}s`,
        )} · listing ${describeTruncation(readings.truncation.clusters)}`,
    },
    {
      label: "Replication groups",
      text:
        `${describeRead(
          readings.replicationGroups,
          `replication groups read from AWS, refreshed every ` +
            `${Math.round(readings.refreshMs.replicationGroups / 1000)}s`,
        )} · listing ${describeTruncation(readings.truncation.replicationGroups)}`,
    },
    { label: "Encryption", text: describeEncryptionPosture(readings.encryption) },
    { label: "Scheduled interruption", text: describeScheduledInterruption(readings.interruption) },
  ]
  if (readings.clusters.state === "ACTUAL" || readings.clusters.state === "STALE") {
    for (const cluster of readings.clusters.value) {
      lines.push({ label: cluster.clusterId, text: describeCacheCluster(cluster) })
    }
  }
  if (readings.replicationGroups.state === "ACTUAL" || readings.replicationGroups.state === "STALE") {
    for (const group of readings.replicationGroups.value) {
      lines.push({ label: group.replicationGroupId, text: describeReplicationGroup(group) })
    }
  }
  return lines
}
