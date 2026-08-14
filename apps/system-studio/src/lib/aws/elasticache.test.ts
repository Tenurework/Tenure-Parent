import { SHARED } from "@tenure/provisioning"

import { __resetIdentity } from "./identity"
import {
  MAX_PAGES,
  MAX_PARAMETER_GROUP_READS,
  MAXMEMORY_POLICY,
  deriveClusterArn,
  deriveReplicationGroupArn,
  elastiCacheLines,
  elastiCacheReadings,
  encryptionStateOf,
  parseMaintenanceWindow,
  pendingChangesOf,
  versionCurrencyFor,
  type ElastiCacheReadings,
} from "./elasticache"
import type { AwsGateway } from "./read"

/**
 * STUDIO-070-004 (ElastiCache) — the cache surface tells four different truths
 * apart, and says which of them it is looking at.
 *
 * The assertions are on `elastiCacheReadings` and `elastiCacheLines`, the two
 * functions a surface renders, rather than on `readAws` or on any parser. A test
 * that drove `readAws` directly would stay green on the day this module stopped
 * calling it, which is the failure this programme has already paid for twice.
 *
 * ## The stand-in is a client, not a stub
 *
 * `fakeAws` answers five capabilities with the shapes the real SDK returns —
 * `{CacheClusters, Marker}` from DescribeCacheClusters, `{ReplicationGroups,
 * Marker}` from DescribeReplicationGroups, `{Parameters, Marker}` from
 * DescribeCacheParameters, `{ResourceTagMappingList}` from the Tagging API and
 * `{Account, Arn}` from STS — and it can fail EACH of them independently with
 * `AccessDeniedException`, `ThrottlingException`, an empty-but-successful list,
 * or a populated one. A stand-in that returned `[]` regardless of what was asked
 * would prove nothing about the code that has to tell those four apart, and it
 * is the fake this repository has already been burnt by. The `pairwise distinct`
 * assertion below is what would catch one.
 *
 * `AtRestEncryptionEnabled` is `false` on the redis fixture and ABSENT on the
 * memcached one, because that is what AWS does, and because "AWS said false" and
 * "AWS said nothing" are the two answers this module refuses to fold together.
 *
 * ## The account id is an obvious placeholder
 *
 * `123456789012` is AWS's own documentation account. Nothing here names a real
 * account, a real ARN or a real endpoint; the ARNs are assembled from that
 * placeholder so that a reader cannot mistake a fixture for an estate fact.
 */

/* --------------------------------------------------------------- fixtures -- */

/** AWS's documentation account. Not a real one — see the header. */
const ACCOUNT = "123456789012"
const REGION = "eu-west-2"

function arnFor(resourceType: string, id: string, partition = "aws", region = REGION): string {
  return `arn:${partition}:elasticache:${region}:${ACCOUNT}:${resourceType}:${id}`
}

/**
 * A cache endpoint host, assembled from its parts rather than written out.
 *
 * `tests/architecture/forbidden-clients.test.mjs` refuses provider endpoints in
 * source, and while it keys on a `https://` scheme this fixture stays assembled
 * anyway: nothing in this suite opens a socket, and a host that reads like a
 * literal endpoint is the thing a future reader has to stop and check.
 */
function cacheHost(id: string): string {
  return [id, "abc123", "ng", "0001", "euw2", "cache", "amazonaws", "com"].join(".")
}

type Json = Record<string, unknown>

/** The cluster `infrastructure/terraform/elasticache.tf` actually creates. */
function redisCluster(overrides: Json = {}): Json {
  return {
    CacheClusterId: "tenure-prod-redis",
    ARN: arnFor("cluster", "tenure-prod-redis"),
    Engine: "redis",
    EngineVersion: "7.1.0",
    CacheNodeType: "cache.t4g.micro",
    CacheClusterStatus: "available",
    NumCacheNodes: 1,
    PreferredMaintenanceWindow: "sun:05:00-sun:06:00",
    AutoMinorVersionUpgrade: true,
    // What AWS returns for a redis cluster created with neither flag set —
    // which is exactly what elasticache.tf does.
    AtRestEncryptionEnabled: false,
    TransitEncryptionEnabled: false,
    AuthTokenEnabled: false,
    SnapshotRetentionLimit: 1,
    SnapshotWindow: "05:00-06:00",
    CacheParameterGroup: {
      CacheParameterGroupName: "tenure-prod-redis7",
      ParameterApplyStatus: "in-sync",
    },
    CacheNodes: [
      {
        CacheNodeId: "0001",
        CacheNodeStatus: "available",
        Endpoint: { Address: cacheHost("tenure-prod-redis"), Port: 6379 },
      },
    ],
    ...overrides,
  }
}

/** A memcached cluster: AWS omits the encryption fields entirely for this engine. */
function memcachedCluster(overrides: Json = {}): Json {
  return {
    CacheClusterId: "tenure-prod-memcached",
    ARN: arnFor("cluster", "tenure-prod-memcached"),
    Engine: "memcached",
    EngineVersion: "1.6.17",
    CacheNodeType: "cache.t4g.small",
    CacheClusterStatus: "available",
    NumCacheNodes: 3,
    PreferredMaintenanceWindow: "tue:03:30-tue:04:30",
    AutoMinorVersionUpgrade: false,
    CacheParameterGroup: {
      CacheParameterGroupName: "default.memcached1.6",
      ParameterApplyStatus: "in-sync",
    },
    ...overrides,
  }
}

/** A fully encrypted redis cluster that is a member of a replication group. */
function encryptedMember(overrides: Json = {}): Json {
  return {
    CacheClusterId: "tenure-prod-ha-001",
    ARN: arnFor("cluster", "tenure-prod-ha-001"),
    Engine: "redis",
    EngineVersion: "7.1.0",
    CacheNodeType: "cache.m7g.large",
    CacheClusterStatus: "available",
    NumCacheNodes: 1,
    ReplicationGroupId: "tenure-prod-ha",
    PreferredMaintenanceWindow: "mon:01:00-mon:02:00",
    AutoMinorVersionUpgrade: true,
    AtRestEncryptionEnabled: true,
    TransitEncryptionEnabled: true,
    AuthTokenEnabled: true,
    AuthTokenLastModifiedDate: new Date("2026-04-01T00:00:00.000Z"),
    CacheParameterGroup: {
      CacheParameterGroupName: "tenure-prod-redis7",
      ParameterApplyStatus: "in-sync",
    },
    ...overrides,
  }
}

function haGroup(overrides: Json = {}): Json {
  return {
    ReplicationGroupId: "tenure-prod-ha",
    ARN: arnFor("replicationgroup", "tenure-prod-ha"),
    Description: "tenure production cache with a replica",
    Status: "available",
    MemberClusters: ["tenure-prod-ha-001", "tenure-prod-ha-002"],
    AutomaticFailover: "enabled",
    MultiAZ: "enabled",
    ClusterEnabled: false,
    CacheNodeType: "cache.m7g.large",
    Engine: "redis",
    AtRestEncryptionEnabled: true,
    TransitEncryptionEnabled: true,
    AuthTokenEnabled: true,
    SnapshotRetentionLimit: 7,
    ...overrides,
  }
}

/** The parameter group `elasticache.tf` declares, as DescribeCacheParameters returns it. */
const REDIS7_PARAMETERS = [
  { ParameterName: "maxmemory-policy", ParameterValue: "allkeys-lru", Source: "user" },
  { ParameterName: "timeout", ParameterValue: "0", Source: "system" },
  { ParameterName: "tcp-keepalive", ParameterValue: "300", Source: "system" },
]

/* --------------------------------------------------------------- the fake -- */

type Outcome = "populated" | "empty" | "denied" | "throttled"

interface FakeOptions {
  clusters?: Outcome
  /** Each entry is one page. The fake hands back a Marker until the last. */
  clusterPages?: Json[][]
  groups?: Outcome
  groupPages?: Json[][]
  parameters?: Outcome
  /** Per parameter-group-name failure, so ONE group can be refused. */
  parameterFailures?: Record<string, string>
  parametersByGroup?: Record<string, Array<Json>>
  tags?: Record<string, Array<{ Key: string; Value: string }>>
  tagsOutcome?: Outcome
  identity?: { arn: string; account: string; region: string } | "denied"
  calls?: string[]
}

function throwing(name: string): never {
  const error = new Error(`${name} raised by the stand-in AWS client`)
  error.name = name
  throw error
}

/** Marker-paged the way ElastiCache is: `Marker` in, `Marker` out until the last page. */
function page(pages: Json[][], marker: string | undefined, key: string): Json {
  const index = marker ? Number(marker) : 0
  const items = pages[index] ?? []
  const more = index + 1 < pages.length
  return more ? { [key]: items, Marker: String(index + 1) } : { [key]: items }
}

function fakeAws(options: FakeOptions = {}): AwsGateway {
  const identity = options.identity ?? {
    arn: `arn:aws:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
    account: ACCOUNT,
    region: REGION,
  }
  const calls = options.calls ?? []

  return {
    async call(capability, input) {
      calls.push(String(capability))
      const marker = (input as { Marker?: unknown } | undefined)?.Marker
      switch (capability) {
        case "sts:GetCallerIdentity":
          if (identity === "denied") throwing("AccessDenied")
          return { Account: identity.account, Arn: identity.arn, UserId: "AROA:studio" }

        case "tag:GetResources": {
          const outcome = options.tagsOutcome ?? "populated"
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          if (outcome === "empty") return { ResourceTagMappingList: [] }
          return {
            ResourceTagMappingList: Object.entries(options.tags ?? {}).map(([arn, Tags]) => ({
              ResourceARN: arn,
              Tags,
            })),
          }
        }

        case "elasticache:DescribeCacheClusters": {
          const outcome = options.clusters ?? "populated"
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          // The real API returns the key with an empty array when the account
          // has no cluster; it does not omit it.
          if (outcome === "empty") return { CacheClusters: [] }
          const pages = options.clusterPages ?? [[redisCluster()]]
          return page(pages, marker as string | undefined, "CacheClusters")
        }

        case "elasticache:DescribeReplicationGroups": {
          const outcome = options.groups ?? "empty"
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          if (outcome === "empty") return { ReplicationGroups: [] }
          const pages = options.groupPages ?? [[haGroup()]]
          return page(pages, marker as string | undefined, "ReplicationGroups")
        }

        case "elasticache:DescribeCacheParameters": {
          const name = String((input as { CacheParameterGroupName?: unknown }).CacheParameterGroupName)
          const failure = options.parameterFailures?.[name]
          if (failure) throwing(failure)
          const outcome = options.parameters ?? "populated"
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          if (outcome === "empty") return { Parameters: [] }
          const byGroup = options.parametersByGroup?.[name]
          return { Parameters: byGroup ?? REDIS7_PARAMETERS }
        }

        default:
          throw new Error(
            `the stand-in was asked for ${String(capability)}, which this suite does not exercise`,
          )
      }
    },
    async resolvedRegion() {
      return identity === "denied" ? REGION : identity.region
    },
  }
}

const AT = () => new Date("2026-08-13T09:15:00.000Z")

async function load(options: FakeOptions = {}): Promise<ElastiCacheReadings> {
  return elastiCacheReadings(fakeAws(options), { now: AT })
}

/** The whole surface as one string, which is what an operator actually reads. */
function surfaceText(readings: ElastiCacheReadings): string {
  return elastiCacheLines(readings)
    .map((line) => `${line.label}: ${line.text}`)
    .join("\n")
}

function lineFor(readings: ElastiCacheReadings, label: string): string {
  return elastiCacheLines(readings).find((l) => l.label === label)?.text ?? ""
}

beforeEach(() => {
  // resolveIdentity caches per process. Every case here supplies its own
  // gateway, which bypasses the cache, but a stale cache from another suite
  // would silently make these assertions test the wrong identity.
  __resetIdentity()
})

/* -------------------------------------------- the four outcomes, compared -- */

describe("the ElastiCache surface says something different for each of the four outcomes", () => {
  test("a populated list is ACTUAL and names the cluster with its engine and node type", async () => {
    const readings = await load()
    expect(readings.clusters.state).toBe("ACTUAL")
    if (readings.clusters.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.clusters.value).toHaveLength(1)
    const cluster = readings.clusters.value[0]
    expect(cluster.clusterId).toBe("tenure-prod-redis")
    expect(cluster.engine).toBe("redis")
    expect(cluster.engineVersion).toBe("7.1.0")
    expect(cluster.nodeType).toBe("cache.t4g.micro")
    expect(cluster.nodes).toBe(1)

    const text = lineFor(readings, "tenure-prod-redis")
    expect(text).toContain("redis 7.1.0 on cache.t4g.micro × 1 node(s)")
    expect(lineFor(readings, "Cache clusters")).toContain("as of 2026-08-13T09:15:00.000Z")
    expect(lineFor(readings, "Cache clusters")).toContain("listing read to the end")
  })

  test("an empty-but-successful list is EMPTY and says none, not refused", async () => {
    const readings = await load({ clusters: "empty" })
    expect(readings.clusters.state).toBe("EMPTY")
    const line = lineFor(readings, "Cache clusters")
    expect(line).toContain("none —")
    expect(line).not.toContain("refused")
    expect(line).not.toContain("Minimum statement")
    // And with no cache at all, the encryption question has an answer that is
    // neither "encrypted" nor "not encrypted".
    expect(readings.encryption.kind).toBe("nothing-to-report")
    expect(lineFor(readings, "Encryption")).not.toContain("encrypted —")
  })

  test("AccessDenied is DENIED, carries the principal, the action and a pasteable statement", async () => {
    const readings = await load({ clusters: "denied" })
    expect(readings.clusters.state).toBe("DENIED")
    if (readings.clusters.state !== "DENIED") throw new Error("narrowing")

    expect(readings.clusters.action).toBe("elasticache:DescribeCacheClusters")
    expect(readings.clusters.principal).toContain("assumed-role/tenure-studio-task")
    expect(readings.clusters.accountId).toBe(ACCOUNT)
    expect(readings.clusters.region).toBe(REGION)
    expect(readings.clusters.partition).toBe("aws")
    expect(JSON.parse(readings.clusters.minimumStatement)).toEqual({
      Effect: "Allow",
      Action: ["elasticache:DescribeCacheClusters"],
      Resource: "*",
    })

    // And the thing it must NOT be. There is no `value` on this arm at all, so
    // a caller cannot reach an empty array.
    expect("value" in readings.clusters).toBe(false)
    const line = lineFor(readings, "Cache clusters")
    expect(line).toContain("unknown")
    expect(line).toContain("refused elasticache:DescribeCacheClusters")
    expect(line).not.toMatch(/\bnone\b/)

    // A refused listing is not an unencrypted estate and is not a quiet one.
    expect(readings.encryption.kind).toBe("unknown")
    expect(readings.interruption.kind).toBe("unknown")
    expect(lineFor(readings, "Encryption")).toContain("unknown")
    expect(lineFor(readings, "Scheduled interruption")).toContain("unknown")
    expect(lineFor(readings, "Scheduled interruption")).not.toContain("nothing queued")
  })

  test("a throttle is THROTTLED — its own state, not a failure and not an empty list", async () => {
    const readings = await load({ clusters: "throttled" })
    expect(readings.clusters.state).toBe("THROTTLED")
    if (readings.clusters.state !== "THROTTLED") throw new Error("narrowing")
    // The schedule is throttle.ts's — 200ms after the first failure, doubling —
    // not a number retyped in this module.
    expect(readings.clusters.retryAfterMs).toBe(800)
    const line = lineFor(readings, "Cache clusters")
    expect(line).toContain("throttled")
    expect(line).toContain("retrying in")
    expect(line).not.toContain("Minimum statement")
    expect(line).not.toMatch(/\bnone\b/)
  })

  test("the four render as four visibly different surfaces", async () => {
    const texts: string[] = []
    for (const outcome of ["populated", "empty", "denied", "throttled"] as const) {
      __resetIdentity()
      texts.push(surfaceText(await load({ clusters: outcome })))
    }
    // Pairwise distinct. A fake that returned [] regardless would collapse at
    // least two of these into one string, and this is the assertion that notices.
    expect(new Set(texts).size).toBe(4)
    for (const text of texts) expect(text.length).toBeGreaterThan(0)
  })
})

/* ------------------------------------------------------- is it encrypted -- */

describe("'is the cache encrypted' has four answers and only one of them is yes", () => {
  test("a cluster AWS says false about is reported NOT encrypted, with no auth either", async () => {
    const readings = await load()
    if (readings.clusters.state !== "ACTUAL") throw new Error("narrowing")
    const cluster = readings.clusters.value[0]
    expect(cluster.atRest).toEqual({
      kind: "disabled",
      why: "ElastiCache returned AtRestEncryptionEnabled=false for tenure-prod-redis",
    })
    expect(cluster.inTransit.kind).toBe("disabled")
    expect(cluster.auth.kind).toBe("not-required")

    expect(readings.encryption.kind).toBe("plaintext")
    const line = lineFor(readings, "Encryption")
    expect(line).toContain("CACHE NOT ENCRYPTED")
    expect(line).toContain("tenure-prod-redis")
    expect(line).toContain("NO auth token")
  })

  test("a field AWS never returned is unknown — never 'encrypted', never silently false", async () => {
    const readings = await load({ clusterPages: [[memcachedCluster()]] })
    if (readings.clusters.state !== "ACTUAL") throw new Error("narrowing")
    const cluster = readings.clusters.value[0]
    expect(cluster.atRest.kind).toBe("unstated")
    expect(cluster.inTransit.kind).toBe("unstated")
    expect(cluster.auth.kind).toBe("unstated")

    expect(readings.encryption.kind).toBe("unstated")
    const line = lineFor(readings, "Encryption")
    expect(line).toContain("encryption UNSTATED")
    expect(line).toContain("will not report a cache it cannot see as encrypted")
    // The row itself must not read as reassuring either.
    const row = lineFor(readings, "tenure-prod-memcached")
    expect(row).toContain("at rest: unknown")
    expect(row).not.toContain("at rest: encrypted")
  })

  test("an estate that states encryption everywhere is the one arm that says encrypted", async () => {
    const readings = await load({
      clusterPages: [[encryptedMember()]],
      groups: "populated",
    })
    expect(readings.encryption.kind).toBe("encrypted")
    if (readings.encryption.kind !== "encrypted") throw new Error("narrowing")
    expect([...readings.encryption.encrypted].sort()).toEqual(["tenure-prod-ha", "tenure-prod-ha-001"])
    expect(readings.encryption.unreadable).toHaveLength(0)
    const line = lineFor(readings, "Encryption")
    expect(line).toContain("every cache states encryption at rest and in transit")
    expect(line).not.toContain("UNSTATED")
    expect(line).not.toContain("NOT ENCRYPTED")
  })

  test("the plaintext, unstated, encrypted and unknown answers are four different sentences", async () => {
    const cases: Array<FakeOptions> = [
      {},
      { clusterPages: [[memcachedCluster()]] },
      { clusterPages: [[encryptedMember()]], groups: "populated" },
      { clusters: "denied" },
    ]
    const sentences: string[] = []
    for (const options of cases) {
      __resetIdentity()
      sentences.push(lineFor(await load(options), "Encryption"))
    }
    expect(new Set(sentences).size).toBe(4)
  })
})

/* ----------------------------------------- is it a single node with no failover -- */

describe("'is it a single node with no failover' is a state, not a 1 in a column", () => {
  test("the pilot's single-node cluster says so in words", async () => {
    const readings = await load()
    if (readings.clusters.state !== "ACTUAL") throw new Error("narrowing")
    const failover = readings.clusters.value[0].failover
    expect(failover.kind).toBe("single-node")
    if (failover.kind !== "single-node") throw new Error("narrowing")
    expect(failover.nodes).toBe(1)
    const row = lineFor(readings, "tenure-prod-redis")
    expect(row).toContain("SINGLE NODE, NO FAILOVER")
    expect(row).toContain("when the node goes, the cache goes")
  })

  test("a multi-node standalone cluster is not the same finding", async () => {
    const readings = await load({ clusterPages: [[memcachedCluster()]] })
    if (readings.clusters.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.clusters.value[0].failover.kind).toBe("multi-node-no-failover")
    const row = lineFor(readings, "tenure-prod-memcached")
    expect(row).toContain("no failover")
    expect(row).not.toContain("SINGLE NODE")
  })

  test("a cluster inside a replication group points at the group instead of answering for it", async () => {
    const readings = await load({ clusterPages: [[encryptedMember()]], groups: "populated" })
    if (readings.clusters.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.clusters.value[0].failover.kind).toBe("member-of-group")
    // A member claiming "no failover" while its group has automatic failover is
    // a false alarm an operator would act on.
    expect(lineFor(readings, "tenure-prod-ha-001")).not.toContain("NO FAILOVER")

    if (readings.replicationGroups.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.replicationGroups.value[0].failover.kind).toBe("automatic-failover")
    expect(lineFor(readings, "tenure-prod-ha")).toContain("automatic failover across 2 member(s)")
    // The group's window is assembled from the member cluster that was read.
    expect(lineFor(readings, "tenure-prod-ha")).toContain("Monday 01:00 to Monday 02:00 UTC")
  })

  test("a replication group with failover off is its own alarm", async () => {
    const readings = await load({
      groups: "populated",
      groupPages: [[haGroup({ AutomaticFailover: "disabled", MultiAZ: "disabled" })]],
    })
    if (readings.replicationGroups.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.replicationGroups.value[0].failover.kind).toBe("failover-disabled")
    expect(lineFor(readings, "tenure-prod-ha")).toContain("FAILOVER DISABLED")
  })

  test("an empty replication-group list is the honest answer to 'is there a replica'", async () => {
    const readings = await load({ groups: "empty" })
    expect(readings.replicationGroups.state).toBe("EMPTY")
    const line = lineFor(readings, "Replication groups")
    expect(line).toContain("none —")
    expect(line).not.toContain("refused")
  })
})

/* ------------------------------------- is an upgrade pending that restarts it -- */

describe("'is there a version upgrade pending that will restart it' names the window", () => {
  test("with nothing queued the answer is 'nothing queued', not silence", async () => {
    const readings = await load()
    expect(readings.interruption.kind).toBe("none")
    const line = lineFor(readings, "Scheduled interruption")
    expect(line).toContain("nothing queued")
    expect(line).toContain("1 cluster(s)")
    expect(line).not.toContain("SCHEDULED INTERRUPTION")
  })

  test("a pending engine version is a SCHEDULED INTERRUPTION with the window on it", async () => {
    const readings = await load({
      clusterPages: [
        [redisCluster({ PendingModifiedValues: { EngineVersion: "7.2.4" } })],
      ],
    })
    expect(readings.interruption.kind).toBe("pending")
    if (readings.interruption.kind !== "pending") throw new Error("narrowing")
    expect(readings.interruption.restarting).toHaveLength(1)
    const change = readings.interruption.restarting[0]
    expect(change.resourceId).toBe("tenure-prod-redis")
    expect(change.change.field).toBe("engine version")
    expect(change.change.from).toBe("7.1.0")
    expect(change.change.to).toBe("7.2.4")
    expect(change.change.restarts).toBe(true)

    const line = lineFor(readings, "Scheduled interruption")
    expect(line).toContain("SCHEDULED INTERRUPTION")
    expect(line).toContain("engine version 7.1.0 → 7.2.4")
    expect(line).toContain("RESTARTS at Sunday 05:00 to Sunday 06:00 UTC")
  })

  test("a queued change that does not restart the cache is not reported as one", async () => {
    const readings = await load({
      clusterPages: [[redisCluster({ PendingModifiedValues: { AuthTokenStatus: "ROTATING" } })]],
    })
    expect(readings.interruption.kind).toBe("pending")
    if (readings.interruption.kind !== "pending") throw new Error("narrowing")
    expect(readings.interruption.changes).toHaveLength(1)
    expect(readings.interruption.restarting).toHaveLength(0)
    const line = lineFor(readings, "Scheduled interruption")
    expect(line).toContain("queued, none restarting")
    expect(line).toContain("applied without a restart")
    expect(line).not.toContain("SCHEDULED INTERRUPTION")
  })

  test("the automatic upgrade window is stated whether or not anything is queued", async () => {
    const readings = await load()
    if (readings.clusters.state !== "ACTUAL") throw new Error("narrowing")
    const upgrade = readings.clusters.value[0].automaticUpgrade
    expect(upgrade.kind).toBe("automatic")
    expect(upgrade.window).toEqual({
      kind: "window",
      raw: "sun:05:00-sun:06:00",
      startDay: "Sunday",
      startTimeUtc: "05:00",
      endDay: "Sunday",
      endTimeUtc: "06:00",
    })
    const row = lineFor(readings, "tenure-prod-redis")
    expect(row).toContain("AutoMinorVersionUpgrade=true")
    expect(row).toContain("maintenance Sunday 05:00 to Sunday 06:00 UTC")
  })

  test("whether the version is behind the current default is NOT_READABLE, and names what would read it", async () => {
    // There is no elasticache:DescribeCacheEngineVersions capability in the
    // registry. Silence here would let a surface print "redis 7.1.0" with
    // nothing beside it and let an operator read that as up to date.
    const readings = await load()
    if (readings.clusters.state !== "ACTUAL") throw new Error("narrowing")
    const currency = readings.clusters.value[0].versionCurrency
    expect(currency.state).toBe("NOT_READABLE")
    expect(currency.needs).toBe("elasticache:DescribeCacheEngineVersions")
    expect(currency.iamAction).toBe("elasticache:DescribeCacheEngineVersions")
    const row = lineFor(readings, "tenure-prod-redis")
    expect(row).toContain("version currency:")
    expect(row).toContain("elasticache:DescribeCacheEngineVersions")
    expect(row).toContain("Unknown, not up to date")
  })
})

/* ------------------------------------------------- independent degradation -- */

describe("a sub-call that fails degrades on its own", () => {
  test("a denied replication-group read leaves the cluster rows intact and qualifies the answers", async () => {
    const readings = await load({ groups: "denied" })
    // The clusters still read. One denied detail does not collapse the row.
    expect(readings.clusters.state).toBe("ACTUAL")
    if (readings.clusters.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.clusters.value[0].clusterId).toBe("tenure-prod-redis")
    expect(readings.replicationGroups.state).toBe("DENIED")

    // And the two estate answers are qualified rather than quietly complete.
    expect(readings.encryption.kind).toBe("plaintext")
    if (readings.encryption.kind !== "plaintext") throw new Error("narrowing")
    expect(readings.encryption.unreadable).toHaveLength(1)
    expect(readings.encryption.unreadable[0]).toContain("elasticache:DescribeReplicationGroups")

    expect(readings.interruption.kind).toBe("none")
    if (readings.interruption.kind !== "none") throw new Error("narrowing")
    expect(readings.interruption.unreadable).toHaveLength(1)
    expect(lineFor(readings, "Scheduled interruption")).toContain("so this is qualified")
    expect(lineFor(readings, "Replication groups")).toContain(
      "refused elasticache:DescribeReplicationGroups",
    )
  })

  test("a denied parameter read names DescribeCacheParameters, not the listing's action", async () => {
    const readings = await load({
      parameterFailures: { "tenure-prod-redis7": "AccessDeniedException" },
    })
    if (readings.clusters.state !== "ACTUAL") throw new Error("narrowing")
    const cluster = readings.clusters.value[0]
    expect(cluster.parameters.state).toBe("DENIED")
    if (cluster.parameters.state !== "DENIED") throw new Error("narrowing")
    // Granting DescribeCacheClusters would not have fixed this, and a denial
    // naming it would send an operator to grant an action they already hold.
    expect(cluster.parameters.action).toBe("elasticache:DescribeCacheParameters")
    expect(cluster.parameters.minimumStatement).toContain("elasticache:DescribeCacheParameters")
    expect(cluster.parameters.minimumStatement).not.toContain("DescribeCacheClusters")

    // Everything else about the cluster still stands.
    const row = lineFor(readings, "tenure-prod-redis")
    expect(row).toContain("SINGLE NODE, NO FAILOVER")
    expect(row).toContain("refused elasticache:DescribeCacheParameters")
    expect(row).not.toContain(MAXMEMORY_POLICY + "=")
  })

  test("a parameter group that answered carries the eviction policy and where it came from", async () => {
    const readings = await load()
    if (readings.clusters.state !== "ACTUAL") throw new Error("narrowing")
    const parameters = readings.clusters.value[0].parameters
    expect(parameters.state).toBe("ACTUAL")
    if (parameters.state !== "ACTUAL") throw new Error("narrowing")
    expect(parameters.value.maxmemoryPolicy).toBe("allkeys-lru")
    expect(parameters.value.maxmemoryPolicySource).toBe("user")
    expect(parameters.value.applyStatus).toBe("in-sync")
    expect(parameters.value.parametersRead).toBe(3)
    expect(lineFor(readings, "tenure-prod-redis")).toContain(
      "parameter group tenure-prod-redis7 — maxmemory-policy=allkeys-lru (source user)",
    )
  })

  test("one parameter group is read once even when several clusters share it", async () => {
    const calls: string[] = []
    await elastiCacheReadings(
      fakeAws({
        calls,
        clusterPages: [[redisCluster(), encryptedMember()]],
      }),
      { now: AT },
    )
    const parameterCalls = calls.filter((c) => c === "elasticache:DescribeCacheParameters")
    // Both fixtures name `tenure-prod-redis7`. Two calls would be one API call
    // per cluster for an answer that cannot differ.
    expect(parameterCalls).toHaveLength(1)
  })

  test("clusters past the parameter-group cap say they were not read, not that they set nothing", async () => {
    const many: Json[] = []
    for (let i = 0; i <= MAX_PARAMETER_GROUP_READS; i += 1) {
      const id = `bulk-${String(i).padStart(3, "0")}`
      many.push(
        redisCluster({
          CacheClusterId: id,
          ARN: arnFor("cluster", id),
          CacheParameterGroup: { CacheParameterGroupName: `group-${String(i).padStart(3, "0")}` },
        }),
      )
    }
    const readings = await load({ clusterPages: [many] })
    if (readings.clusters.state !== "ACTUAL") throw new Error("narrowing")
    const last = readings.clusters.value[readings.clusters.value.length - 1]
    expect(last.parameters.state).toBe("UNCONFIGURED")
    if (last.parameters.state !== "UNCONFIGURED") throw new Error("narrowing")
    expect(last.parameters.why).toContain("not the same as its setting nothing")
  })

  test("a throttled tag index leaves every reading intact and attribution unknown", async () => {
    const readings = await load({ tagsOutcome: "throttled" })
    if (readings.clusters.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.clusters.value[0].attribution.kind).toBe("unknown")
    expect(readings.clusters.value[0].failover.kind).toBe("single-node")
    expect(surfaceText(readings)).toContain("throttled")
  })
})

/* -------------------------------------------------------------- pagination -- */

describe("pagination runs to completion, with a bound that reports itself", () => {
  test("every page is walked and every cluster appears", async () => {
    const pages: Json[][] = []
    for (let i = 0; i < 3; i += 1) {
      const id = `paged-${i}`
      pages.push([redisCluster({ CacheClusterId: id, ARN: arnFor("cluster", id) })])
    }
    const readings = await load({ clusterPages: pages })
    if (readings.clusters.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.clusters.value.map((c) => c.clusterId)).toEqual([
      "paged-0",
      "paged-1",
      "paged-2",
    ])
    expect(readings.truncation.clusters).toEqual({ kind: "complete" })
    expect(lineFor(readings, "Cache clusters")).toContain("read to the end")
  })

  test("hitting the page cap is an explicit 'there was more', not a short list rendered as whole", async () => {
    const pages: Json[][] = []
    for (let i = 0; i < MAX_PAGES + 5; i += 1) {
      const id = `paged-${String(i).padStart(3, "0")}`
      pages.push([redisCluster({ CacheClusterId: id, ARN: arnFor("cluster", id) })])
    }
    const readings = await load({ clusterPages: pages })
    expect(readings.clusters.state).toBe("ACTUAL")
    if (readings.clusters.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.clusters.value).toHaveLength(MAX_PAGES)

    expect(readings.truncation.clusters.kind).toBe("truncated")
    if (readings.truncation.clusters.kind !== "truncated") throw new Error("narrowing")
    expect(readings.truncation.clusters.pagesRead).toBe(MAX_PAGES)
    expect(readings.truncation.clusters.nextMarker).toBe(String(MAX_PAGES))

    const line = lineFor(readings, "Cache clusters")
    expect(line).toContain("TRUNCATED")
    expect(line).toContain("is NOT the whole estate")
    expect(line).not.toContain("read to the end")
  })

  test("a listing that was never read is 'not read', which is neither complete nor truncated", async () => {
    const readings = await load({ clusters: "denied" })
    expect(readings.truncation.clusters.kind).toBe("not-read")
    expect(lineFor(readings, "Cache clusters")).toContain("not read —")
  })
})

/* ------------------------------------------------------ residency and tags -- */

describe("region and partition come from the resolved identity, never a literal", () => {
  test("a GovCloud identity produces GovCloud ARNs and no us-east-1 anywhere", async () => {
    // The GE-010-007 shape: a hardcoded us-east-1 or a partition guessed as
    // "aws" would place this cache in the wrong partition on a page an operator
    // uses to decide where data lives. AWS returns no ARN here, so the module
    // has to assemble one — from identity.
    const readings = await load({
      identity: {
        arn: `arn:aws-us-gov:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
        account: ACCOUNT,
        region: "us-gov-west-1",
      },
      clusterPages: [[redisCluster({ ARN: undefined })]],
    })
    if (readings.clusters.state !== "ACTUAL") throw new Error("narrowing")
    const cluster = readings.clusters.value[0]
    expect(cluster.arn).toBe(
      `arn:aws-us-gov:elasticache:us-gov-west-1:${ACCOUNT}:cluster:tenure-prod-redis`,
    )
    expect(cluster.partition).toBe("aws-us-gov")
    expect(cluster.region).toBe("us-gov-west-1")
    expect(cluster.arnProvenance).toContain("resolved identity")
    expect(surfaceText(readings)).not.toContain("us-east-1")
  })

  test("with identity unresolved no ARN is invented and the surface says so", async () => {
    const readings = await load({
      identity: "denied",
      clusterPages: [[redisCluster({ ARN: undefined })]],
    })
    if (readings.clusters.state !== "ACTUAL") throw new Error("narrowing")
    const cluster = readings.clusters.value[0]
    expect(cluster.arn).toBeNull()
    expect(cluster.region).toBeNull()
    expect(cluster.partition).toBeNull()
    expect(cluster.attribution.kind).toBe("unknown")
    expect(lineFor(readings, "tenure-prod-redis")).toContain("region unknown")
  })

  test("AWS's own ARN wins over anything this engine would assemble", async () => {
    const readings = await load()
    if (readings.clusters.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.clusters.value[0].arnProvenance).toContain("ElastiCache's own ARN")
    expect(readings.clusters.value[0].arn).toBe(arnFor("cluster", "tenure-prod-redis"))
  })

  test("deriveClusterArn and deriveReplicationGroupArn refuse to guess", () => {
    const unresolved = {
      state: "UNCONFIGURED",
      capability: "sts:GetCallerIdentity",
      why: "no credentials",
    } as const
    expect(deriveClusterArn("x", unresolved)).toBeNull()
    expect(deriveReplicationGroupArn("x", unresolved)).toBeNull()

    const resolved = {
      state: "ACTUAL",
      capability: "sts:GetCallerIdentity",
      value: {
        accountId: ACCOUNT,
        arn: `arn:aws-cn:sts::${ACCOUNT}:assumed-role/x/y`,
        partition: "aws-cn",
        region: "cn-north-1",
      },
      asOf: "2026-08-13T09:15:00.000Z",
      fresh: true,
    } as const
    expect(deriveReplicationGroupArn("g", resolved)).toBe(
      `arn:aws-cn:elasticache:cn-north-1:${ACCOUNT}:replicationgroup:g`,
    )
  })
})

describe("attribution comes from the tag index, and 'we could not look' is its own answer", () => {
  test("a tenure:tenant tag attributes the cache to that tenant", async () => {
    const readings = await load({
      tags: {
        [arnFor("cluster", "tenure-prod-redis")]: [
          { Key: "tenure:tenant", Value: "simon-ose" },
          { Key: "tenure:environment", Value: "production" },
        ],
      },
    })
    if (readings.clusters.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.clusters.value[0].attribution).toEqual({
      kind: "tenant",
      tenantSlug: "simon-ose",
    })
    expect(lineFor(readings, "tenure-prod-redis")).toContain("simon-ose")
  })

  test("the shared sentinel is shared, and an untagged cache is unattributable — not the same", async () => {
    const readings = await load({
      clusterPages: [[redisCluster(), memcachedCluster()]],
      tags: {
        [arnFor("cluster", "tenure-prod-redis")]: [{ Key: "tenure:tenant", Value: SHARED }],
      },
    })
    if (readings.clusters.state !== "ACTUAL") throw new Error("narrowing")
    const shared = readings.clusters.value.find((c) => c.clusterId === "tenure-prod-redis")
    const untagged = readings.clusters.value.find((c) => c.clusterId === "tenure-prod-memcached")
    expect(shared?.attribution.kind).toBe("shared")
    expect(untagged?.attribution.kind).toBe("unattributed")
    const text = surfaceText(readings)
    expect(text).toContain("shared — platform overhead")
    expect(text).toContain("unattributable — missing tenure:tenant")
  })

  test("a denied tag index makes attribution unknown, not unattributable", async () => {
    // The distinction that matters: "missing tenure:tenant" sends an operator to
    // add a tag that is probably already there.
    const readings = await load({ tagsOutcome: "denied" })
    if (readings.clusters.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.clusters.value[0].attribution.kind).toBe("unknown")
    const text = surfaceText(readings)
    expect(text).toContain("attribution unknown")
    expect(text).toContain("tag:GetResources")
    expect(text).not.toContain("missing tenure:tenant")
  })
})

/* --------------------------------------------------------- as-of and cadence -- */

describe("every reading carries when it was taken and how often it refreshes", () => {
  test("the load stamps an explicit asOf and all three capabilities' own cadences", async () => {
    const readings = await load()
    expect(readings.asOf).toBe("2026-08-13T09:15:00.000Z")
    // Not numbers retyped here: these are the registry's declarations, so a
    // cadence changed in capabilities.ts changes what the surface promises.
    expect(readings.refreshMs.clusters).toBe(120_000)
    expect(readings.refreshMs.replicationGroups).toBe(120_000)
    expect(readings.refreshMs.parameters).toBe(3_600_000)
    if (readings.clusters.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.clusters.value[0].asOf).toBe("2026-08-13T09:15:00.000Z")
    expect(readings.clusters.value[0].refreshMs).toBe(120_000)
    const text = surfaceText(readings)
    expect(text).toContain("refreshed every 120s")
    expect(text).toContain("as of 2026-08-13T09:15:00.000Z")
  })
})

/* ------------------------------------------------------------- the parsers -- */

describe("a maintenance window that does not parse is unreadable, never absent", () => {
  test("AWS's ddd:hh24:mi-ddd:hh24:mi becomes days and UTC times", () => {
    expect(parseMaintenanceWindow("wed:23:00-thu:00:30")).toEqual({
      kind: "window",
      raw: "wed:23:00-thu:00:30",
      startDay: "Wednesday",
      startTimeUtc: "23:00",
      endDay: "Thursday",
      endTimeUtc: "00:30",
    })
  })

  test("absent is absent and says every cluster has one; malformed is unreadable", () => {
    expect(parseMaintenanceWindow(undefined).kind).toBe("absent")
    expect(parseMaintenanceWindow("").kind).toBe("absent")
    expect(parseMaintenanceWindow("sunday 5am").kind).toBe("unreadable")
    expect(parseMaintenanceWindow("xxx:05:00-sun:06:00").kind).toBe("unreadable")
    // "no window" would tell an operator there is no scheduled interruption.
    expect(parseMaintenanceWindow("sunday 5am")).not.toMatchObject({ kind: "absent" })
  })

  test("a malformed window on a real cluster renders as unreadable, not as no maintenance", async () => {
    const readings = await load({
      clusterPages: [[redisCluster({ PreferredMaintenanceWindow: "whenever" })]],
    })
    const row = lineFor(readings, "tenure-prod-redis")
    expect(row).toContain("maintenance window unreadable")
    expect(row).not.toContain("maintenance window unknown")
  })
})

describe("encryptionStateOf keeps false and absent apart", () => {
  test("true is enabled, false is disabled, undefined is unstated", () => {
    expect(encryptionStateOf(true, "AtRestEncryptionEnabled", "c")).toEqual({ kind: "enabled" })
    expect(encryptionStateOf(false, "AtRestEncryptionEnabled", "c").kind).toBe("disabled")
    const unstated = encryptionStateOf(undefined, "AtRestEncryptionEnabled", "c")
    expect(unstated.kind).toBe("unstated")
    if (unstated.kind !== "unstated") throw new Error("narrowing")
    expect(unstated.why).toContain("Unknown, not safe")
  })
})

describe("pendingChangesOf tells a restart apart from a change that is not one", () => {
  test("engine version and node type restart; node count and auth rotation do not", () => {
    const changes = pendingChangesOf(
      {
        EngineVersion: "7.2.4",
        CacheNodeType: "cache.m7g.large",
        NumCacheNodes: 2,
        AuthTokenStatus: "ROTATING",
      },
      { engineVersion: "7.1.0", nodeType: "cache.t4g.micro", nodes: 1 },
    )
    expect(changes.map((c) => [c.field, c.restarts])).toEqual([
      ["engine version", true],
      ["node type", true],
      ["node count", false],
      ["auth token", false],
    ])
    expect(changes[0].from).toBe("7.1.0")
  })

  test("no PendingModifiedValues is no changes, not an invented one", () => {
    expect(pendingChangesOf(undefined, {})).toEqual([])
    expect(pendingChangesOf({}, {})).toEqual([])
  })
})

describe("versionCurrencyFor names the capability that is not held", () => {
  test("it says unknown, and it says what would answer it", () => {
    const currency = versionCurrencyFor("redis", "7.1.0")
    expect(currency.state).toBe("NOT_READABLE")
    expect(currency.why).toContain("redis 7.1.0")
    expect(currency.why).toContain("elasticache:DescribeCacheEngineVersions")
    expect(currency.why).toContain("not a capability this console holds")
  })
})
