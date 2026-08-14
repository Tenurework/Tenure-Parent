import type { AwsRead } from "../../../lib/aws/read"
import type {
  DatabaseInstanceReading,
  ScheduledOutage,
} from "../../../lib/aws/database"
import type {
  DynamoDbReadings,
  RegistryProtection,
  TableDetail,
  TableReading,
} from "../../../lib/aws/dynamodb-tables"
import type { BucketReading, S3Readings } from "../../../lib/aws/buckets"
import type {
  CacheClusterReading,
  ElastiCacheReadings,
  ReplicationGroupReading,
  ScheduledInterruption,
} from "../../../lib/aws/elasticache"

import {
  RISK_RANK,
  bucketRows,
  cacheChangeRows,
  cacheRows,
  databaseEventRows,
  maintenanceRows,
  mayClaimEmpty,
  provenanceOf,
  recoveryRows,
  tableRows,
  unknownSentences,
  verdictOf,
  worstRisk,
  type BucketRow,
  type CacheChangeRow,
  type CacheRow,
  type MaintenanceRow,
  type RecoveryRow,
  type TableRow,
  type VerdictInput,
} from "./answer"

/**
 * `/platform/data`'s decisions, driven without a browser, a server or an AWS
 * account.
 *
 * Every case here is one an operator meets on a bad morning and that no browser
 * suite can reach: a tenant registry with point-in-time recovery switched off,
 * a bucket S3 itself calls public, an RDS upgrade AWS applies on a fixed date
 * whether anybody agrees or not, and — the one that matters most — an estate
 * where every read was refused and the page must still refuse to say "all
 * clear".
 *
 * Two rules are proved rather than described:
 *
 *   1. The registry outranks everything. `REGISTRY_UNRECOVERABLE` is rank 0 and
 *      the registry row is at index 0 of the table list whatever its risk.
 *   2. PROTECTED is unreachable while anything went unread. `verdictOf` returns
 *      UNKNOWN from an estate with no findings and one unanswered read, and the
 *      chip counts never include an unread listing as a zero.
 */

/* ──────────────────────────────────────────────────────────── fixtures ──── */

const NOW = "2026-08-13T09:00:00.000Z"
const NOW_MS = Date.parse(NOW)

/** AWS's own documentation account. Corresponds to no real resource. */
const ACCOUNT = "123456789012"
const REGION = "eu-west-2"

const identity: AwsRead<{
  accountId: string
  arn: string
  partition: string
  region: string
}> = {
  state: "ACTUAL",
  capability: "sts:GetCallerIdentity",
  value: {
    accountId: ACCOUNT,
    arn: `arn:aws:sts::${ACCOUNT}:assumed-role/studio/reader`,
    partition: "aws",
    region: REGION,
  },
  asOf: NOW,
  fresh: true,
}

const emptyTags: AwsRead<readonly never[]> = {
  state: "EMPTY",
  capability: "tag:GetResources",
  asOf: NOW,
}

const denied = <T,>(capability: AwsRead<T>["capability"], action: string): AwsRead<T> => ({
  state: "DENIED",
  capability,
  action,
  principal: `arn:aws:sts::${ACCOUNT}:assumed-role/studio/reader`,
  accountId: ACCOUNT,
  region: REGION,
  partition: "aws",
  errorCode: "AccessDeniedException",
  minimumStatement: `{"Effect":"Allow","Action":"${action}","Resource":"*"}`,
})

const actual = <T,>(capability: AwsRead<T>["capability"], value: T): AwsRead<T> => ({
  state: "ACTUAL",
  capability,
  value,
  asOf: NOW,
  fresh: true,
})

/* ── DynamoDB ───────────────────────────────────────────────────────────── */

const tableDetail = (over: Partial<TableDetail> = {}): TableDetail => ({
  arn: `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/registry`,
  status: "ACTIVE",
  createdAt: "2026-01-01T00:00:00.000Z",
  billing: { kind: "on-demand" },
  size: { itemCount: 4, sizeBytes: 1024, freshness: "AWS refreshes this roughly every six hours" },
  encryption: { kind: "aws-owned-default", why: "AWS returned no SSEDescription" },
  deletionProtection: { kind: "enabled" },
  keySchema: ["pk (HASH)"],
  indexes: [],
  ...over,
})

const table = (over: Partial<TableReading> = {}): TableReading => ({
  name: "tenure-registry",
  arn: `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/tenure-registry`,
  arnProvenance: "AWS's own TableArn",
  region: REGION,
  partition: "aws",
  accountId: ACCOUNT,
  isTenantRegistry: false,
  attribution: { kind: "shared" },
  detail: actual("dynamodb:DescribeTable", tableDetail()),
  backups: actual("dynamodb:DescribeContinuousBackups", {
    kind: "enabled",
    earliestRestorableAt: "2026-08-08T09:00:00.000Z",
    latestRestorableAt: "2026-08-13T08:55:00.000Z",
    recoveryPeriodInDays: 35,
  }),
  ttl: actual("dynamodb:DescribeTimeToLive", { kind: "disabled", status: "DISABLED" }),
  keyManagement: {
    state: "UNCONFIGURED",
    capability: "kms:DescribeKey",
    why: "the table uses the AWS-owned default key, so there is no key in this account to describe",
  },
  refreshMs: 300_000,
  asOf: NOW,
  ...over,
})

const dynamo = (over: Partial<DynamoDbReadings> = {}): DynamoDbReadings =>
  ({
    identity,
    tagged: emptyTags,
    tables: actual("dynamodb:ListTables", [table()]),
    more: { kind: "complete" },
    registry: { kind: "unnamed", why: "TENANT_TABLE is unset" },
    registryTableName: null,
    asOf: NOW,
    refreshMs: { tables: 300_000, detail: 300_000, backups: 300_000, ttl: 300_000, keyManagement: 300_000 },
    ...over,
  }) as DynamoDbReadings

/* ── S3 ─────────────────────────────────────────────────────────────────── */

const bucket = (over: Partial<BucketReading> = {}): BucketReading => ({
  name: "tenure-documents",
  arn: "arn:aws:s3:::tenure-documents",
  partition: "aws",
  region: { kind: "stated", region: REGION },
  createdAt: "2026-01-01T00:00:00.000Z",
  attribution: { kind: "shared" },
  attributionSource: "the bucket's own tag set",
  publicAccessBlock: actual("s3:GetBucketPublicAccessBlock", {
    kind: "configured",
    flags: {
      blockPublicAcls: true,
      ignorePublicAcls: true,
      blockPublicPolicy: true,
      restrictPublicBuckets: true,
    },
    allFourSet: true,
  }),
  policyStatus: actual("s3:GetBucketPolicyStatus", { kind: "not-public" }),
  encryption: actual("s3:GetBucketEncryption", { kind: "sse-s3" }),
  versioning: actual("s3:GetBucketVersioning", { status: "Enabled", mfaDelete: "not-stated" }),
  lifecycle: actual("s3:GetBucketLifecycleConfiguration", { kind: "none", why: "no lifecycle rules" }),
  tags: actual("s3:GetBucketTagging", { kind: "none", why: "NoSuchTagSet" }),
  cors: actual("s3:GetBucketCors", { kind: "none", why: "NoSuchCORSConfiguration" }),
  refreshMs: 300_000,
  asOf: NOW,
  ...over,
})

const s3 = (over: Partial<S3Readings> = {}): S3Readings =>
  ({
    identity,
    tagged: emptyTags,
    buckets: actual("s3:ListBuckets", [bucket()]),
    publicExposure: { kind: "none-observed", bucketsRead: 1, partiallyUnread: [] },
    listing: { kind: "complete", bucketsListed: 1, pagesRead: 1 },
    asOf: NOW,
    refreshMs: { buckets: 300_000, posture: 300_000 },
    ...over,
  }) as S3Readings

/* ── ElastiCache ────────────────────────────────────────────────────────── */

const cluster = (over: Partial<CacheClusterReading> = {}): CacheClusterReading => ({
  clusterId: "tenure-sessions",
  arn: `arn:aws:elasticache:${REGION}:${ACCOUNT}:cluster:tenure-sessions`,
  arnProvenance: "assembled from the resolved identity",
  region: REGION,
  partition: "aws",
  accountId: ACCOUNT,
  engine: "redis",
  engineVersion: "7.1",
  nodeType: "cache.t4g.micro",
  status: "available",
  nodes: 1,
  replicationGroupId: null,
  endpoint: null,
  atRest: { kind: "enabled" },
  inTransit: { kind: "enabled" },
  auth: { kind: "required", lastModifiedAt: null },
  failover: { kind: "automatic-failover", members: 2, multiAz: "enabled", why: "AWS said so" },
  maintenance: { kind: "absent", why: "AWS returned no window" },
  automaticUpgrade: {
    kind: "manual",
    window: { kind: "absent", why: "AWS returned no window" },
    why: "AutoMinorVersionUpgrade is false",
  },
  versionCurrency: {
    state: "NOT_READABLE",
    needs: "elasticache:DescribeCacheEngineVersions",
    iamAction: "elasticache:DescribeCacheEngineVersions",
    why: "no capability for it in the registry",
  },
  pending: [],
  parameters: {
    state: "UNCONFIGURED",
    capability: "elasticache:DescribeCacheParameters",
    why: "no parameter group was attached",
  },
  attribution: { kind: "shared" },
  snapshotRetentionDays: 1,
  refreshMs: 300_000,
  asOf: NOW,
  ...over,
})

const elasticache = (over: Partial<ElastiCacheReadings> = {}): ElastiCacheReadings =>
  ({
    identity,
    tagged: emptyTags,
    clusters: actual("elasticache:DescribeCacheClusters", [cluster()]),
    replicationGroups: { state: "EMPTY", capability: "elasticache:DescribeReplicationGroups", asOf: NOW },
    encryption: { kind: "encrypted", encrypted: ["tenure-sessions"], unreadable: [] },
    interruption: { kind: "none", clustersRead: 1, groupsRead: 0, unreadable: [] },
    truncation: { clusters: { kind: "complete" }, replicationGroups: { kind: "complete" } },
    asOf: NOW,
    refreshMs: { clusters: 300_000, replicationGroups: 300_000, parameters: 300_000 },
    ...over,
  }) as ElastiCacheReadings

/* ── RDS ────────────────────────────────────────────────────────────────── */

const instance = (over: Partial<DatabaseInstanceReading> = {}): DatabaseInstanceReading =>
  ({
    instanceId: "tenure-prod",
    arn: `arn:aws:rds:${REGION}:${ACCOUNT}:db:tenure-prod`,
    arnProvenance: "AWS's own DBInstanceArn",
    region: REGION,
    partition: "aws",
    accountId: ACCOUNT,
    engine: "postgres",
    engineVersion: "16.3",
    instanceClass: "db.t4g.medium",
    status: "available",
    multiAz: { kind: "yes" },
    storageEncrypted: { kind: "yes" },
    publiclyAccessible: { kind: "no", why: "AWS returned PubliclyAccessible false" },
    deletionProtection: { kind: "yes" },
    storage: { kind: "fixed", allocatedGib: 100, why: "no MaxAllocatedStorage" },
    backup: {
      kind: "retained",
      days: 7,
      window: { kind: "window", raw: "02:00-02:30", startTimeUtc: "02:00", endTimeUtc: "02:30" },
      why: "BackupRetentionPeriod is 7",
    },
    recoveryPoint: {
      kind: "restorable",
      at: "2026-08-13T08:55:00.000Z",
      ageMs: 300_000,
      stale: false,
      why: "LatestRestorableTime",
    },
    maintenanceWindow: { kind: "absent", why: "AWS returned no window" },
    autoMinorVersionUpgrade: { kind: "yes" },
    pendingMaintenance: { kind: "none", why: "no action for this instance" },
    pendingChanges: [],
    parameterGroups: { kind: "not-read", why: "the listing did not answer" },
    sslEnforcement: {
      state: "UNVERIFIED",
      why: "the parameter value was not read",
      parameter: null,
      iamAction: "rds:DescribeDBParameters",
    },
    events: actual("rds:DescribeEvents", {
      instanceId: "tenure-prod",
      windowMinutes: 1440,
      events: [],
      restarts: [],
      failovers: [],
      lowStorage: [],
      replication: [],
      truncation: { kind: "complete" },
    }),
    snapshots: { kind: "none", why: "no snapshot for this instance" },
    attribution: { kind: "shared" },
    refreshMs: 300_000,
    asOf: NOW,
    ...over,
  }) as DatabaseInstanceReading

/* ── verdict input ──────────────────────────────────────────────────────── */

const CLEAN_REGISTRY: RegistryProtection = {
  kind: "protected",
  tableName: "tenure-registry",
  earliestRestorableAt: "2026-08-08T09:00:00.000Z",
  latestRestorableAt: "2026-08-13T08:55:00.000Z",
  recoveryPeriodInDays: 35,
  weaknesses: [],
}

const verdictInput = (over: Partial<VerdictInput> = {}): VerdictInput => ({
  registry: CLEAN_REGISTRY,
  tables: [],
  buckets: [],
  caches: [],
  maintenance: [],
  cacheChanges: [],
  recovery: [],
  unknowns: [],
  ...over,
})

const tableRow = (over: Partial<TableRow> = {}): TableRow => ({
  key: "t",
  name: "t",
  isRegistry: false,
  pitr: "on",
  deletionProtection: "on",
  encryption: "kms",
  concerns: [],
  risk: "PROTECTED",
  ...over,
})

const bucketRow = (over: Partial<BucketRow> = {}): BucketRow => ({
  key: "b",
  name: "b",
  publicAccess: "all four set",
  policyStatus: "not public",
  encryption: "SSE-S3",
  versioning: "Enabled",
  concerns: [],
  risk: "PROTECTED",
  ...over,
})

const cacheRow = (over: Partial<CacheRow> = {}): CacheRow => ({
  key: "cluster:c",
  id: "c",
  kind: "cluster",
  atRest: "encrypted",
  inTransit: "encrypted",
  failover: "automatic",
  concerns: [],
  risk: "PROTECTED",
  ...over,
})

const maintenanceRow = (over: Partial<MaintenanceRow> = {}): MaintenanceRow => ({
  key: "db:system-update",
  instanceId: "db",
  action: "system-update",
  when: "queued with no date",
  forcedOn: null,
  interrupts: false,
  optInStatus: null,
  description: null,
  risk: "ROUTINE",
  ...over,
})

const cacheChangeRow = (over: Partial<CacheChangeRow> = {}): CacheChangeRow => ({
  key: "cluster:c:node count",
  resourceId: "c",
  resourceKind: "cluster",
  field: "node count",
  from: "1",
  to: "2",
  restarts: false,
  why: "nodes are added without restarting the survivors",
  risk: "ROUTINE",
  ...over,
})

const recoveryRow = (over: Partial<RecoveryRow> = {}): RecoveryRow => ({
  key: "rds:db",
  resource: "db",
  source: "RDS automated backups",
  newestAt: "2026-08-13T08:55:00.000Z",
  ageMs: 300_000,
  detail: "restorable",
  risk: "PROTECTED",
  ...over,
})

/* ══════════════════════════════════════ the registry outranks everything ══ */

describe("the tenant registry ranks first", () => {
  it("ranks REGISTRY_UNRECOVERABLE above every other risk", () => {
    for (const risk of [
      "PUBLIC",
      "UNRECOVERABLE",
      "PLAINTEXT",
      "FORCED_INTERRUPTION",
      "NO_FAILOVER",
      "DELETABLE",
      "UNKNOWN",
      "ROUTINE",
      "PROTECTED",
    ] as const) {
      expect(RISK_RANK.REGISTRY_UNRECOVERABLE).toBeLessThan(RISK_RANK[risk])
    }
  })

  it("puts the registry row first even when every other table is worse", () => {
    const rows = tableRows(
      dynamo({
        tables: actual("dynamodb:ListTables", [
          table({
            name: "z-open",
            detail: actual(
              "dynamodb:DescribeTable",
              tableDetail({
                encryption: {
                  kind: "inaccessible",
                  keyArn: null,
                  since: null,
                  why: "the key is gone",
                },
              }),
            ),
          }),
          table({ name: "a-registry", isTenantRegistry: true }),
        ]),
      }),
    )
    expect(rows[0].name).toBe("a-registry")
    expect(rows[0].isRegistry).toBe(true)
    // And the clean registry is still PROTECTED — being pinned first is an
    // ordering decision, not a verdict.
    expect(rows[0].risk).toBe("PROTECTED")
    expect(rows[1].risk).toBe("PLAINTEXT")
  })

  it("calls PITR off on the registry total loss, and on any other table merely unrecoverable", () => {
    const off = actual<{ kind: "disabled"; continuousBackupsStatus: string | null; why: string }>(
      "dynamodb:DescribeContinuousBackups",
      { kind: "disabled", continuousBackupsStatus: "DISABLED", why: "AWS said DISABLED" },
    )
    const rows = tableRows(
      dynamo({
        tables: actual("dynamodb:ListTables", [
          table({ name: "registry", isTenantRegistry: true, backups: off }),
          table({ name: "other", backups: off }),
        ]),
      }),
    )
    expect(rows[0].risk).toBe("REGISTRY_UNRECOVERABLE")
    expect(rows[1].risk).toBe("UNRECOVERABLE")
  })

  it("does not soften an unread PITR into enabled", () => {
    const rows = tableRows(
      dynamo({
        tables: actual("dynamodb:ListTables", [
          table({
            name: "registry",
            isTenantRegistry: true,
            backups: denied("dynamodb:DescribeContinuousBackups", "dynamodb:DescribeContinuousBackups"),
          }),
        ]),
      }),
    )
    expect(rows[0].risk).toBe("UNKNOWN")
    expect(rows[0].pitr).toContain("did not answer")
  })

  it("leads with the registry when its point-in-time recovery is off", () => {
    const verdict = verdictOf(
      verdictInput({
        registry: {
          kind: "no-point-in-time-recovery",
          tableName: "tenure-registry",
          why: "AWS said DISABLED",
          alsoNoted: [],
        },
        // A public bucket at the same time: the registry still leads.
        buckets: [bucketRow({ name: "open", risk: "PUBLIC" })],
      }),
    )
    expect(verdict.risk).toBe("REGISTRY_UNRECOVERABLE")
    expect(verdict.headline).toContain("tenure-registry")
    expect(verdict.headline).toContain("no restore")
    expect(verdict.findings[0]).toContain("tenure-registry")
    expect(verdict.findings[1]).toContain("open")
  })
})

/* ══════════════════════════════ PROTECTED is unreachable while unknown ══ */

describe("an unanswered read is never a clean bill of health", () => {
  it("returns UNKNOWN, not PROTECTED, when nothing was found and something went unread", () => {
    const verdict = verdictOf(
      verdictInput({ unknowns: ["S3 buckets — unknown: refused s3:ListBuckets"] }),
    )
    expect(verdict.risk).toBe("UNKNOWN")
    expect(verdict.complete).toBe(false)
    expect(verdict.headline).toContain("cannot say")
    expect(verdict.findings).toHaveLength(0)
  })

  it("returns PROTECTED only when every read answered and nothing was found", () => {
    const verdict = verdictOf(verdictInput({ tables: [tableRow()], buckets: [bucketRow()] }))
    expect(verdict.risk).toBe("PROTECTED")
    expect(verdict.complete).toBe(true)
  })

  it("still leads with a finding when one exists, and says the finding is a floor", () => {
    const verdict = verdictOf(
      verdictInput({
        buckets: [bucketRow({ name: "open", risk: "PUBLIC" })],
        unknowns: ["ElastiCache clusters — unknown: refused elasticache:DescribeCacheClusters"],
      }),
    )
    expect(verdict.risk).toBe("PUBLIC")
    expect(verdict.headline).toContain("floor of what is wrong")
  })

  it("names every unanswered read rather than counting them", () => {
    const sentences = unknownSentences([
      {
        label: "S3 buckets",
        what: "every bucket",
        read: denied("s3:ListBuckets", "s3:ListBuckets"),
      },
      {
        label: "DynamoDB tables",
        what: "every table",
        read: { state: "EMPTY", capability: "dynamodb:ListTables", asOf: NOW },
      },
    ])
    expect(sentences).toHaveLength(1)
    expect(sentences[0]).toContain("S3 buckets")
    expect(sentences[0]).toContain("s3:ListBuckets")
    // The pasteable statement travels with the refusal.
    expect(sentences[0]).toContain("Minimum statement")
  })

  it("marks an EMPTY read as answered and a DENIED read as not", () => {
    const rows = provenanceOf([
      {
        label: "buckets",
        what: "every bucket",
        read: { state: "EMPTY", capability: "s3:ListBuckets", asOf: NOW },
      },
      {
        label: "tables",
        what: "every table",
        read: denied("dynamodb:ListTables", "dynamodb:ListTables"),
      },
    ])
    expect(rows[0].unknown).toBe(false)
    expect(rows[1].unknown).toBe(true)
  })
})

/* ══════════════════════════════════════════════════ public ranks hardest ══ */

describe("buckets, with public access ranked hardest", () => {
  it("calls a bucket S3 reports as public PUBLIC", () => {
    const rows = bucketRows(
      s3({
        buckets: actual("s3:ListBuckets", [
          bucket({ name: "open", policyStatus: actual("s3:GetBucketPolicyStatus", { kind: "public" }) }),
        ]),
      }),
    )
    expect(rows[0].risk).toBe("PUBLIC")
    expect(rows[0].concerns[0]).toContain("S3 itself reports")
  })

  it("calls one missing block flag PUBLIC, and names which flag", () => {
    const rows = bucketRows(
      s3({
        buckets: actual("s3:ListBuckets", [
          bucket({
            name: "half-open",
            publicAccessBlock: actual("s3:GetBucketPublicAccessBlock", {
              kind: "configured",
              flags: {
                blockPublicAcls: true,
                ignorePublicAcls: true,
                blockPublicPolicy: true,
                restrictPublicBuckets: false,
              },
              allFourSet: false,
            }),
          }),
        ]),
      }),
    )
    expect(rows[0].risk).toBe("PUBLIC")
    expect(rows[0].concerns.join(" ")).toContain("RestrictPublicBuckets")
  })

  it("sorts a public bucket above an unversioned one and an unencrypted one", () => {
    const rows = bucketRows(
      s3({
        buckets: actual("s3:ListBuckets", [
          bucket({
            name: "a-no-versioning",
            versioning: actual("s3:GetBucketVersioning", {
              status: "never-enabled",
              mfaDelete: "not-stated",
            }),
          }),
          bucket({
            name: "b-no-encryption",
            encryption: actual("s3:GetBucketEncryption", { kind: "none", why: "no rule" }),
          }),
          bucket({
            name: "c-public",
            policyStatus: actual("s3:GetBucketPolicyStatus", { kind: "public" }),
          }),
        ]),
      }),
    )
    expect(rows.map((row) => row.name)).toEqual(["c-public", "a-no-versioning", "b-no-encryption"])
  })

  it("does not read a refused posture call as a closed bucket", () => {
    const rows = bucketRows(
      s3({
        buckets: actual("s3:ListBuckets", [
          bucket({
            name: "unread",
            publicAccessBlock: denied("s3:GetBucketPublicAccessBlock", "s3:GetBucketPublicAccessBlock"),
            policyStatus: denied("s3:GetBucketPolicyStatus", "s3:GetBucketPolicyStatus"),
          }),
        ]),
      }),
    )
    expect(rows[0].risk).toBe("UNKNOWN")
    expect(rows[0].concerns.join(" ")).toContain("could not be read")
  })
})

/* ═══════════════════════════════════════════════ caches and their failover ══ */

describe("caches", () => {
  it("calls a cache AWS said is not encrypted PLAINTEXT, and one it said nothing about UNKNOWN", () => {
    const plaintext = cacheRows(
      elasticache({
        clusters: actual("elasticache:DescribeCacheClusters", [
          cluster({ atRest: { kind: "disabled", why: "AtRestEncryptionEnabled false" } }),
        ]),
      }),
    )
    expect(plaintext[0].risk).toBe("PLAINTEXT")

    const silent = cacheRows(
      elasticache({
        clusters: actual("elasticache:DescribeCacheClusters", [
          cluster({ atRest: { kind: "unstated", why: "AWS returned no field" } }),
        ]),
      }),
    )
    expect(silent[0].risk).toBe("UNKNOWN")
  })

  it("calls a single-node cluster NO_FAILOVER and a group member neither", () => {
    const single = cacheRows(
      elasticache({
        clusters: actual("elasticache:DescribeCacheClusters", [
          cluster({ failover: { kind: "single-node", nodes: 1, why: "one node" } }),
        ]),
      }),
    )
    expect(single[0].risk).toBe("NO_FAILOVER")

    const member = cacheRows(
      elasticache({
        clusters: actual("elasticache:DescribeCacheClusters", [
          cluster({
            failover: {
              kind: "member-of-group",
              replicationGroupId: "g",
              why: "the group answers this",
            },
          }),
        ]),
      }),
    )
    expect(member[0].risk).toBe("PROTECTED")
  })

  it("reads replication groups with the same rules as clusters", () => {
    const group: ReplicationGroupReading = {
      replicationGroupId: "g",
      arn: null,
      arnProvenance: "identity unresolved",
      region: REGION,
      partition: "aws",
      accountId: ACCOUNT,
      description: null,
      status: "available",
      engine: "redis",
      nodeType: "cache.t4g.micro",
      clusterEnabled: false,
      memberClusterIds: ["g-001"],
      atRest: { kind: "enabled" },
      inTransit: { kind: "disabled", why: "TransitEncryptionEnabled false" },
      auth: { kind: "unstated", why: "AWS returned no field" },
      failover: { kind: "failover-disabled", members: 2, why: "AutomaticFailover disabled" },
      maintenance: { kind: "absent", why: "not returned for a group" },
      pending: [],
      attribution: { kind: "shared" },
      snapshotRetentionDays: null,
      refreshMs: 300_000,
      asOf: NOW,
    }
    const rows = cacheRows(
      elasticache({
        clusters: { state: "EMPTY", capability: "elasticache:DescribeCacheClusters", asOf: NOW },
        replicationGroups: actual("elasticache:DescribeReplicationGroups", [group]),
      }),
    )
    expect(rows[0].kind).toBe("replication group")
    expect(rows[0].risk).toBe("PLAINTEXT")
    expect(rows[0].concerns.join(" ")).toContain("in transit")
  })
})

/* ══════════════════════════════════════════════ what is about to interrupt ══ */

describe("pending maintenance, forced first", () => {
  const queued = (
    instanceId: string,
    action: string,
    schedule: { kind: "forced"; forcedApplyDate: string } | { kind: "unscheduled" },
    interrupts: boolean,
  ) => ({
    instanceId,
    action: {
      action,
      description: null,
      optInStatus: null,
      schedule:
        schedule.kind === "forced"
          ? {
              kind: "forced" as const,
              forcedApplyDate: schedule.forcedApplyDate,
              currentApplyDate: null,
              why: "AWS returned a ForcedApplyDate",
            }
          : { kind: "unscheduled" as const, why: "nobody has opted in" },
      interrupts,
      why: "AWS queued it",
    },
    window: { kind: "absent" as const, why: "AWS returned no window" },
  })

  it("sorts forced actions first, by the date AWS applies them", () => {
    const outage: ScheduledOutage = {
      kind: "pending",
      actions: [
        queued("late", "db-upgrade", { kind: "forced", forcedApplyDate: "2026-09-01" }, true),
        queued("routine", "system-update", { kind: "unscheduled" }, false),
        queued("early", "os-upgrade", { kind: "forced", forcedApplyDate: "2026-08-20" }, true),
        queued("interrupting", "ca-certificate-rotation", { kind: "unscheduled" }, true),
      ],
      forced: [],
      interrupting: [],
      unreadable: [],
    }
    const rows = maintenanceRows(outage)
    expect(rows.map((row) => row.instanceId)).toEqual([
      "early",
      "late",
      "interrupting",
      "routine",
    ])
    expect(rows[0].forcedOn).toBe("2026-08-20")
    expect(rows[0].risk).toBe("FORCED_INTERRUPTION")
    expect(rows[3].risk).toBe("ROUTINE")
  })

  it("returns nothing at all when the maintenance read did not answer", () => {
    expect(maintenanceRows({ kind: "unknown", why: "refused" })).toHaveLength(0)
    expect(maintenanceRows({ kind: "none", instancesRead: 2, unreadable: [] })).toHaveLength(0)
  })

  it("leads with the soonest forced date and names the instance", () => {
    const verdict = verdictOf(
      verdictInput({
        maintenance: [
          maintenanceRow({
            key: "a",
            instanceId: "tenure-prod",
            action: "db-upgrade",
            forcedOn: "2026-08-20",
            interrupts: true,
            risk: "FORCED_INTERRUPTION",
          }),
        ],
      }),
    )
    expect(verdict.risk).toBe("FORCED_INTERRUPTION")
    expect(verdict.headline).toContain("2026-08-20")
    expect(verdict.headline).toContain("tenure-prod")
  })

  it("sorts restarting cache changes above the ones applied online", () => {
    const interruption: ScheduledInterruption = {
      kind: "pending",
      changes: [
        {
          resourceKind: "cluster",
          resourceId: "a",
          change: {
            field: "node count",
            from: "1",
            to: "2",
            restarts: false,
            why: "nodes are added online",
          },
          window: { kind: "absent", why: "none" },
        },
        {
          resourceKind: "cluster",
          resourceId: "b",
          change: {
            field: "engine version",
            from: "7.0",
            to: "7.1",
            restarts: true,
            why: "AWS replaces the nodes",
          },
          window: { kind: "absent", why: "none" },
        },
      ],
      restarting: [],
      unreadable: [],
    }
    const rows = cacheChangeRows(interruption)
    expect(rows.map((row) => row.resourceId)).toEqual(["b", "a"])
    expect(rows[0].risk).toBe("FORCED_INTERRUPTION")
  })

  it("reports failovers, restarts and low storage, newest first, and names instances it could not read", () => {
    const event = (at: string, significance: "failover" | "restart" | "low-storage" | "backup") => ({
      at,
      categories: [significance],
      significance,
      message: `${significance} at ${at}`,
    })
    const read = databaseEventRows(
      actual("rds:DescribeDBInstances", [
        instance({
          instanceId: "one",
          events: actual("rds:DescribeEvents", {
            instanceId: "one",
            windowMinutes: 1440,
            events: [
              event("2026-08-13T01:00:00.000Z", "failover"),
              event("2026-08-13T05:00:00.000Z", "restart"),
              // Deliberately not one of the three this card reports.
              event("2026-08-13T06:00:00.000Z", "backup"),
            ],
            restarts: [],
            failovers: [],
            lowStorage: [],
            replication: [],
            truncation: { kind: "complete" },
          }),
        }),
        instance({
          instanceId: "two",
          events: denied("rds:DescribeEvents", "rds:DescribeEvents"),
        }),
      ]),
    )
    expect(read.rows.map((row) => row.at)).toEqual([
      "2026-08-13T05:00:00.000Z",
      "2026-08-13T01:00:00.000Z",
    ])
    expect(read.unread).toEqual(["two"])
  })
})

/* ═══════════════════════════════════════════════════ restore points ══════ */

describe("the newest restore point per store", () => {
  it("puts stores with no restore point first, then the oldest restore point", () => {
    const rows = recoveryRows(
      actual("rds:DescribeDBInstances", [
        instance({
          instanceId: "fresh",
          recoveryPoint: {
            kind: "restorable",
            at: "2026-08-13T08:55:00.000Z",
            ageMs: 300_000,
            stale: false,
            why: "LatestRestorableTime",
          },
        }),
        instance({
          instanceId: "none",
          recoveryPoint: { kind: "none", why: "AWS returned no LatestRestorableTime" },
        }),
        instance({
          instanceId: "old",
          recoveryPoint: {
            kind: "restorable",
            at: "2026-08-13T06:00:00.000Z",
            ageMs: 10_800_000,
            stale: true,
            why: "past the freshness window",
          },
        }),
      ]),
      { state: "EMPTY", capability: "dynamodb:ListTables", asOf: NOW },
      NOW_MS,
    )
    expect(rows.map((row) => row.resource)).toEqual(["none", "old", "fresh"])
    expect(rows[0].risk).toBe("UNRECOVERABLE")
    expect(rows[1].risk).toBe("UNRECOVERABLE")
    expect(rows[2].risk).toBe("PROTECTED")
  })

  /*
   * The age tiebreak, reached only when two rows carry the SAME risk.
   *
   * The case above never got here: its "old" row is stale, so it is
   * UNRECOVERABLE and the risk comparison answered first. A mutation reversing
   * `b.ageMs - a.ageMs` therefore survived the whole suite — recorded in the
   * ledger rather than quietly fixed, because a mutation harness whose misses
   * are not reported is the same lie as a guard that cannot fail.
   */
  it("puts the older restore point first when two stores are equally protected", () => {
    const rows = recoveryRows(
      actual("rds:DescribeDBInstances", [
        instance({
          instanceId: "recent",
          recoveryPoint: {
            kind: "restorable",
            at: "2026-08-13T08:55:00.000Z",
            ageMs: 300_000,
            stale: false,
            why: "LatestRestorableTime",
          },
        }),
        instance({
          instanceId: "older",
          recoveryPoint: {
            kind: "restorable",
            at: "2026-08-13T08:00:00.000Z",
            ageMs: 3_600_000,
            stale: false,
            why: "LatestRestorableTime",
          },
        }),
      ]),
      { state: "EMPTY", capability: "dynamodb:ListTables", asOf: NOW },
      NOW_MS,
    )
    expect(rows.map((row) => row.risk)).toEqual(["PROTECTED", "PROTECTED"])
    expect(rows.map((row) => row.resource)).toEqual(["older", "recent"])
  })

  it("ages a DynamoDB restore point against the page's clock, not AWS's", () => {
    const rows = recoveryRows(
      { state: "EMPTY", capability: "rds:DescribeDBInstances", asOf: NOW },
      actual("dynamodb:ListTables", [
        table({
          name: "registry",
          backups: actual("dynamodb:DescribeContinuousBackups", {
            kind: "enabled",
            earliestRestorableAt: "2026-08-08T09:00:00.000Z",
            latestRestorableAt: "2026-08-13T08:00:00.000Z",
            recoveryPeriodInDays: 35,
          }),
        }),
      ]),
      NOW_MS,
    )
    expect(rows[0].ageMs).toBe(3_600_000)
    expect(rows[0].source).toBe("DynamoDB point-in-time recovery")
  })

  it("does not turn an unread continuous-backup call into a missing restore point", () => {
    const rows = recoveryRows(
      { state: "EMPTY", capability: "rds:DescribeDBInstances", asOf: NOW },
      actual("dynamodb:ListTables", [
        table({
          name: "t",
          backups: denied("dynamodb:DescribeContinuousBackups", "dynamodb:DescribeContinuousBackups"),
        }),
      ]),
      NOW_MS,
    )
    expect(rows[0].risk).toBe("UNKNOWN")
    expect(rows[0].risk).not.toBe("UNRECOVERABLE")
  })
})

/* ═══════════════════════════════════════════════════ the ordering itself ══ */

describe("worstRisk", () => {
  it("is PROTECTED for an empty set, and the lowest rank otherwise", () => {
    expect(worstRisk([])).toBe("PROTECTED")
    expect(worstRisk(["UNKNOWN", "PUBLIC", "ROUTINE"])).toBe("PUBLIC")
    expect(worstRisk(["ROUTINE", "UNKNOWN"])).toBe("UNKNOWN")
  })
})

describe("the verdict orders its findings worst first", () => {
  it("puts a public bucket above an unencrypted cache above a queued restart", () => {
    const verdict = verdictOf(
      verdictInput({
        buckets: [bucketRow({ name: "open", risk: "PUBLIC" })],
        caches: [cacheRow({ id: "plain", risk: "PLAINTEXT" })],
        cacheChanges: [cacheChangeRow({ restarts: true, risk: "FORCED_INTERRUPTION" })],
        recovery: [recoveryRow({ resource: "no-backup", risk: "UNRECOVERABLE" })],
      }),
    )
    expect(verdict.risk).toBe("PUBLIC")
    expect(verdict.findings).toHaveLength(4)
    expect(verdict.findings[0]).toContain("open")
    expect(verdict.findings[1]).toContain("no-backup")
    expect(verdict.findings[2]).toContain("plain")
    expect(verdict.findings[3]).toContain("restart")
  })
})

/* ═══════════════════════ an empty table is a claim, and only sometimes true ══ */

describe("whether an empty table is allowed to say there is nothing", () => {
  /*
   * The regression this locks down. Two tables on this page fed a `DataTable`
   * an `empty` node that read "Nothing is queued against a cache" and "No store
   * on this page has a continuous restore point", with NO test of whether the
   * reads behind those rows had answered. On the estate this console must boot
   * in — no credentials, every read refused — both printed a calm, reassuring,
   * entirely unfounded claim, and every other assertion on the page still held.
   */

  it("lets a table claim emptiness only when every read behind it answered", () => {
    // EMPTY is the arm that IS the claim: AWS said there is nothing.
    expect(mayClaimEmpty([emptyTags])).toBe(true)
    expect(mayClaimEmpty([actual("dynamodb:ListTables", [])])).toBe(true)
    expect(mayClaimEmpty([])).toBe(true)
  })

  it("refuses the claim when any single read did not answer", () => {
    const refused = denied("dynamodb:ListTables", "dynamodb:ListTables")
    expect(mayClaimEmpty([refused])).toBe(false)

    // One refusal among answers is still a refusal. A table fed two listings
    // where only one answered cannot describe the estate.
    expect(mayClaimEmpty([emptyTags, refused])).toBe(false)
    expect(mayClaimEmpty([refused, actual("dynamodb:ListTables", [])])).toBe(false)
  })

  it("refuses the claim for every valueless arm, not only for a denial", () => {
    const arms: AwsRead<readonly string[]>[] = [
      { state: "THROTTLED", capability: "dynamodb:ListTables", retryAfterMs: 400, asOf: NOW },
      { state: "UNCONFIGURED", capability: "dynamodb:ListTables", why: "no table name is set" },
      {
        state: "ERROR",
        capability: "dynamodb:ListTables",
        code: "TimeoutError",
        safeDetail: "the endpoint did not respond",
      },
      denied("dynamodb:ListTables", "dynamodb:ListTables"),
    ]
    // The arm name is folded into the compared value so a failure names which
    // one regressed — jest's `expect` takes no message argument.
    for (const arm of arms) {
      expect({ arm: arm.state, mayClaim: mayClaimEmpty([arm]) }).toEqual({
        arm: arm.state,
        mayClaim: false,
      })
    }
  })

  it("allows the claim for a STALE read, which carries a value that was really read", () => {
    const stale: AwsRead<readonly string[]> = {
      state: "STALE",
      capability: "dynamodb:ListTables",
      value: [],
      asOf: NOW,
      ageMs: 90_000,
    }
    expect(mayClaimEmpty([stale])).toBe(true)
  })
})
