import { SHARED } from "@tenure/provisioning"

import {
  EVENT_WINDOW_MINUTES,
  MAX_EVENT_INSTANCE_READS,
  MAX_PAGES,
  PARAMETER_VALUE_CAPABILITY,
  STORAGE_CEILING_WARN_PERCENT,
  databaseLines,
  databaseReadings,
  deriveInstanceArn,
  isEngineDefaultGroup,
  outageScheduleOf,
  recoveryPointOf,
  significanceOf,
  soonestSchedule,
  sslParameterFor,
  storageHeadroomOf,
  type DatabaseReadings,
} from "./database"
import { __resetIdentity } from "./identity"
import type { AwsGateway } from "./read"

/**
 * STUDIO-070-004 (DATABASE) — the RDS surface tells four different truths apart,
 * per sub-call, and says which of them it is looking at.
 *
 * The assertions are on `databaseReadings` and `databaseLines`, the two
 * functions a surface renders, rather than on `readAws` or on any parser. A test
 * that drove a private helper would stay green on the day this module stopped
 * calling it, which is the failure this programme has already paid for twice.
 *
 * ## The stand-in is a client, not a stub
 *
 * `fakeAws` answers seven capabilities with the shapes the real SDK returns —
 * `{DBInstances, Marker}` from DescribeDBInstances, `{PendingMaintenanceActions,
 * Marker}` from DescribePendingMaintenanceActions, `{Events, Marker}` from
 * DescribeEvents, `{DBParameterGroups, Marker}` from DescribeDBParameterGroups,
 * `{DBSnapshots, Marker}` from DescribeDBSnapshots, `{ResourceTagMappingList}`
 * from the Tagging API and `{Account, Arn}` from STS — and each of them can fail
 * INDEPENDENTLY with `AccessDeniedException`, `ThrottlingException`, an
 * empty-but-successful list, or a populated one. A stand-in that returned `[]`
 * regardless of what was asked would prove nothing about code whose whole job is
 * telling those four apart, and it is the fake this repository has already been
 * burnt by. The `pairwise distinct` assertions below are what would catch one.
 *
 * `MaxAllocatedStorage` is present on one instance and ABSENT on the other,
 * because that is how AWS says storage autoscaling is off, and those are the two
 * answers this module refuses to fold together.
 *
 * ## Nothing here names a real account
 *
 * `123456789012` is AWS's own documentation account. Every ARN is assembled from
 * it, so a reader cannot mistake a fixture for an estate fact. The one password
 * field in these fixtures is an obvious placeholder and exists solely to prove
 * the module never carries it.
 */

/* --------------------------------------------------------------- fixtures -- */

/** AWS's documentation account. Not a real one — see the header. */
const ACCOUNT = "123456789012"
const REGION = "eu-west-2"

/**
 * The value RDS would return in `PendingModifiedValues.MasterUserPassword`.
 *
 * Obviously not a credential. It is here so `the surface never carries a queued
 * password` has something to look for; if the module ever started reading that
 * field, this exact string would appear in the rendered surface.
 */
const PLACEHOLDER_PASSWORD = "fixture-placeholder-not-a-password"

function rdsArn(kind: string, id: string, region = REGION, partition = "aws"): string {
  return `arn:${partition}:rds:${region}:${ACCOUNT}:${kind}:${id}`
}

type Json = Record<string, unknown>

/** The database `infrastructure/terraform/rds.tf` provisions: one Single-AZ postgres. */
function primaryInstance(overrides: Json = {}): Json {
  return {
    DBInstanceIdentifier: "tenure-prod-db",
    DBInstanceArn: rdsArn("db", "tenure-prod-db"),
    Engine: "postgres",
    EngineVersion: "16.3",
    DBInstanceClass: "db.t4g.medium",
    DBInstanceStatus: "available",
    AllocatedStorage: 100,
    MaxAllocatedStorage: 1000,
    StorageType: "gp3",
    StorageEncrypted: true,
    MultiAZ: false,
    PubliclyAccessible: false,
    DeletionProtection: true,
    BackupRetentionPeriod: 7,
    PreferredBackupWindow: "03:00-04:00",
    PreferredMaintenanceWindow: "sun:05:00-sun:06:00",
    LatestRestorableTime: new Date("2026-08-13T09:10:00.000Z"),
    AutoMinorVersionUpgrade: true,
    DBParameterGroups: [
      { DBParameterGroupName: "default.postgres16", ParameterApplyStatus: "in-sync" },
    ],
    DBSubnetGroup: { DBSubnetGroupName: "tenure-prod-db-subnets", VpcId: "vpc-0fixture" },
    ...overrides,
  }
}

/**
 * A second instance that is wrong in every way the first is right: autoscaling
 * off, backups off, unencrypted, on a CUSTOM parameter group awaiting a reboot,
 * with an engine upgrade and a password change already queued.
 */
function analyticsInstance(overrides: Json = {}): Json {
  return {
    DBInstanceIdentifier: "tenure-prod-db-analytics",
    DBInstanceArn: rdsArn("db", "tenure-prod-db-analytics"),
    Engine: "postgres",
    EngineVersion: "16.3",
    DBInstanceClass: "db.m7g.large",
    DBInstanceStatus: "available",
    AllocatedStorage: 950,
    // No MaxAllocatedStorage: this is how AWS says autoscaling is OFF.
    StorageType: "gp3",
    StorageEncrypted: false,
    MultiAZ: true,
    PubliclyAccessible: false,
    BackupRetentionPeriod: 0,
    PreferredMaintenanceWindow: "tue:03:30-tue:04:30",
    AutoMinorVersionUpgrade: false,
    DBParameterGroups: [
      { DBParameterGroupName: "tenure-prod-pg16", ParameterApplyStatus: "pending-reboot" },
    ],
    PendingModifiedValues: {
      EngineVersion: "16.4",
      MasterUserPassword: PLACEHOLDER_PASSWORD,
      AllocatedStorage: 1200,
    },
    ...overrides,
  }
}

/** An instance at 95% of its autoscaling ceiling and two hours behind on PITR. */
function crowdedInstance(overrides: Json = {}): Json {
  return primaryInstance({
    DBInstanceIdentifier: "tenure-prod-db-crowded",
    DBInstanceArn: rdsArn("db", "tenure-prod-db-crowded"),
    AllocatedStorage: 950,
    MaxAllocatedStorage: 1000,
    LatestRestorableTime: "2026-08-13T07:00:00.000Z",
    ...overrides,
  })
}

/** The forced engine upgrade nobody has been told about, with all three dates. */
function forcedUpgrade(): Json {
  return {
    ResourceIdentifier: rdsArn("db", "tenure-prod-db"),
    PendingMaintenanceActionDetails: [
      {
        Action: "db-upgrade",
        AutoAppliedAfterDate: new Date("2026-08-20T00:00:00.000Z"),
        ForcedApplyDate: new Date("2026-09-01T00:00:00.000Z"),
        CurrentApplyDate: new Date("2026-08-25T05:00:00.000Z"),
        Description: "New engine minor version available: 16.9",
      },
      {
        Action: "system-update",
        AutoAppliedAfterDate: new Date("2026-08-22T00:00:00.000Z"),
        Description: "Performance improvements and bug fixes",
      },
    ],
  }
}

const PARAMETER_GROUPS: Json[] = [
  {
    DBParameterGroupName: "default.postgres16",
    DBParameterGroupFamily: "postgres16",
    Description: "Default parameter group for postgres16",
    DBParameterGroupArn: rdsArn("pg", "default.postgres16"),
  },
  {
    DBParameterGroupName: "tenure-prod-pg16",
    DBParameterGroupFamily: "postgres16",
    Description: "tenure production parameters",
    DBParameterGroupArn: rdsArn("pg", "tenure-prod-pg16"),
  },
]

const SNAPSHOTS: Json[] = [
  {
    DBSnapshotIdentifier: "rds:tenure-prod-db-2026-08-13-03-05",
    DBSnapshotArn: rdsArn("snapshot", "rds:tenure-prod-db-2026-08-13-03-05"),
    DBInstanceIdentifier: "tenure-prod-db",
    SnapshotCreateTime: new Date("2026-08-13T03:05:00.000Z"),
    Status: "available",
    SnapshotType: "automated",
    AllocatedStorage: 100,
    Encrypted: true,
  },
  {
    DBSnapshotIdentifier: "tenure-prod-db-before-migration-41",
    DBSnapshotArn: rdsArn("snapshot", "tenure-prod-db-before-migration-41"),
    DBInstanceIdentifier: "tenure-prod-db",
    SnapshotCreateTime: new Date("2026-07-02T18:40:00.000Z"),
    Status: "available",
    SnapshotType: "manual",
    AllocatedStorage: 100,
    Encrypted: true,
  },
]

/** A night on which the database restarted itself and warned about storage first. */
const PRIMARY_EVENTS: Json[] = [
  {
    SourceIdentifier: "tenure-prod-db",
    SourceType: "db-instance",
    Date: new Date("2026-08-13T02:14:00.000Z"),
    EventCategories: ["availability"],
    Message: "DB instance restarted",
  },
  {
    SourceIdentifier: "tenure-prod-db",
    SourceType: "db-instance",
    Date: new Date("2026-08-13T02:11:00.000Z"),
    EventCategories: ["low storage"],
    Message: "The free storage capacity for DB instance is low",
  },
  {
    SourceIdentifier: "tenure-prod-db",
    SourceType: "db-instance",
    Date: new Date("2026-08-12T22:03:00.000Z"),
    EventCategories: ["configuration change"],
    Message: "Applied change to parameter group",
  },
]

/* --------------------------------------------------------------- the fake -- */

type Outcome = "populated" | "empty" | "denied" | "throttled"

interface FakeOptions {
  instances?: Outcome
  /** Each entry is one page. The fake hands back a Marker until the last. */
  instancePages?: Json[][]
  maintenance?: Outcome
  maintenancePages?: Json[][]
  parameterGroups?: Outcome
  snapshots?: Outcome
  snapshotRows?: Json[]
  events?: Outcome
  /** Per-instance event failure, so ONE instance can be refused and the rest stand. */
  eventFailures?: Record<string, string>
  eventsByInstance?: Record<string, Json[]>
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

/** Marker-paged the way RDS is: `Marker` in, `Marker` out until the last page. */
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
      const marker = (input as { Marker?: unknown } | undefined)?.Marker as string | undefined
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
            ResourceTagMappingList: Object.entries(options.tags ?? DEFAULT_TAGS).map(
              ([arn, Tags]) => ({ ResourceARN: arn, Tags }),
            ),
          }
        }

        case "rds:DescribeDBInstances": {
          const outcome = options.instances ?? "populated"
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          // The real API returns the key with an empty array when the account
          // has no instance; it does not omit it.
          if (outcome === "empty") return { DBInstances: [] }
          const pages = options.instancePages ?? [[primaryInstance(), analyticsInstance()]]
          return page(pages, marker, "DBInstances")
        }

        case "rds:DescribePendingMaintenanceActions": {
          const outcome = options.maintenance ?? "populated"
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          if (outcome === "empty") return { PendingMaintenanceActions: [] }
          const pages = options.maintenancePages ?? [[forcedUpgrade()]]
          return page(pages, marker, "PendingMaintenanceActions")
        }

        case "rds:DescribeDBParameterGroups": {
          const outcome = options.parameterGroups ?? "populated"
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          if (outcome === "empty") return { DBParameterGroups: [] }
          return { DBParameterGroups: PARAMETER_GROUPS }
        }

        case "rds:DescribeDBSnapshots": {
          const outcome = options.snapshots ?? "populated"
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          if (outcome === "empty") return { DBSnapshots: [] }
          return { DBSnapshots: options.snapshotRows ?? SNAPSHOTS }
        }

        case "rds:DescribeEvents": {
          const id = String((input as { SourceIdentifier?: unknown }).SourceIdentifier)
          const failure = options.eventFailures?.[id]
          if (failure) throwing(failure)
          const outcome = options.events ?? "populated"
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          if (outcome === "empty") return { Events: [] }
          const byInstance = options.eventsByInstance?.[id]
          return { Events: byInstance ?? (id === "tenure-prod-db" ? PRIMARY_EVENTS : []) }
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

const DEFAULT_TAGS: Record<string, Array<{ Key: string; Value: string }>> = {
  [rdsArn("db", "tenure-prod-db")]: [{ Key: "tenure:tenant", Value: "westfield-high" }],
  [rdsArn("db", "tenure-prod-db-analytics")]: [{ Key: "tenure:tenant", Value: SHARED }],
}

const AT = () => new Date("2026-08-13T09:15:00.000Z")

async function load(options: FakeOptions = {}): Promise<DatabaseReadings> {
  return databaseReadings(fakeAws(options), { now: AT })
}

/** The whole surface as one string, which is what an operator actually reads. */
function surfaceText(readings: DatabaseReadings): string {
  return databaseLines(readings)
    .map((line) => `${line.label}: ${line.text}`)
    .join("\n")
}

function lineFor(readings: DatabaseReadings, label: string): string {
  return databaseLines(readings).find((l) => l.label === label)?.text ?? ""
}

function firstInstance(readings: DatabaseReadings) {
  if (readings.instances.state !== "ACTUAL") throw new Error("expected an ACTUAL instance listing")
  const row = readings.instances.value.find((i) => i.instanceId === "tenure-prod-db")
  if (!row) throw new Error("expected tenure-prod-db in the listing")
  return row
}

beforeEach(() => {
  // resolveIdentity caches per process. Every case here supplies its own
  // gateway, which bypasses the cache, but a stale cache from another suite
  // would silently make these assertions test the wrong identity.
  __resetIdentity()
})

/* -------------------------------------------- the four outcomes, compared -- */

describe("the database listing says something different for each of the four outcomes", () => {
  test("a populated list is ACTUAL and names the instance with its engine and class", async () => {
    const readings = await load()
    expect(readings.instances.state).toBe("ACTUAL")
    if (readings.instances.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.instances.value).toHaveLength(2)
    const row = firstInstance(readings)
    expect(row.engine).toBe("postgres")
    expect(row.engineVersion).toBe("16.3")
    expect(row.instanceClass).toBe("db.t4g.medium")
    expect(lineFor(readings, "tenure-prod-db")).toContain("postgres 16.3 on db.t4g.medium")
    expect(lineFor(readings, "Databases")).toContain("as of 2026-08-13T09:15:00.000Z")
    expect(lineFor(readings, "Databases")).toContain("listing read to the end")
  })

  test("an empty-but-successful list is EMPTY and says none, not refused", async () => {
    const readings = await load({ instances: "empty" })
    expect(readings.instances.state).toBe("EMPTY")
    const line = lineFor(readings, "Databases")
    expect(line).toContain("none —")
    expect(line).not.toContain("refused")
    expect(line).not.toContain("Minimum statement")
    // With no database at all there is nothing AWS can have scheduled, and that
    // is a different sentence from "we could not look".
    expect(readings.outage.kind).toBe("none")
  })

  test("AccessDenied is DENIED, carries the principal, the action and a pasteable statement", async () => {
    const readings = await load({ instances: "denied" })
    expect(readings.instances.state).toBe("DENIED")
    if (readings.instances.state !== "DENIED") throw new Error("narrowing")

    expect(readings.instances.action).toBe("rds:DescribeDBInstances")
    expect(readings.instances.principal).toContain("assumed-role/tenure-studio-task")
    expect(readings.instances.accountId).toBe(ACCOUNT)
    expect(readings.instances.region).toBe(REGION)
    expect(readings.instances.partition).toBe("aws")
    expect(JSON.parse(readings.instances.minimumStatement)).toEqual({
      Effect: "Allow",
      Action: ["rds:DescribeDBInstances"],
      Resource: "*",
    })

    // And the thing it must NOT be. There is no `value` on this arm at all, so a
    // caller cannot reach an empty array.
    expect("value" in readings.instances).toBe(false)
    const line = lineFor(readings, "Databases")
    expect(line).toContain("unknown")
    expect(line).toContain("refused rds:DescribeDBInstances")
    expect(line).not.toMatch(/\bnone\b/)

    // A refused listing is not an estate with nothing scheduled.
    expect(readings.outage.kind).toBe("unknown")
    expect(lineFor(readings, "Scheduled outage")).toContain("unknown")
    expect(lineFor(readings, "Scheduled outage")).not.toContain("nothing scheduled")
  })

  test("a throttle is THROTTLED — its own state, not a failure and not an empty list", async () => {
    const readings = await load({ instances: "throttled" })
    expect(readings.instances.state).toBe("THROTTLED")
    if (readings.instances.state !== "THROTTLED") throw new Error("narrowing")
    // The schedule is throttle.ts's — 200ms after the first failure, doubling —
    // not a number retyped in this module.
    expect(readings.instances.retryAfterMs).toBe(800)
    const line = lineFor(readings, "Databases")
    expect(line).toContain("throttled")
    expect(line).toContain("retrying in")
    expect(line).not.toContain("Minimum statement")
    expect(line).not.toMatch(/\bnone\b/)
  })

  test("the four render as four visibly different surfaces", async () => {
    const texts: string[] = []
    for (const outcome of ["populated", "empty", "denied", "throttled"] as const) {
      __resetIdentity()
      texts.push(surfaceText(await load({ instances: outcome })))
    }
    // Pairwise distinct. A fake that returned [] regardless would collapse at
    // least two of these into one string, and this is the assertion that notices.
    expect(new Set(texts).size).toBe(4)
    for (const text of texts) expect(text.length).toBeGreaterThan(0)
  })
})

/* ------------------------------------------- the maintenance sub-call alone -- */

describe("pending maintenance degrades on its own, and 'not read' is never 'nothing scheduled'", () => {
  test("a forced action reports the FORCED date, not the softer current one", async () => {
    const readings = await load()
    const row = firstInstance(readings)
    expect(row.pendingMaintenance.kind).toBe("pending")
    if (row.pendingMaintenance.kind !== "pending") throw new Error("narrowing")

    const upgrade = row.pendingMaintenance.actions.find((a) => a.action === "db-upgrade")
    expect(upgrade).toBeDefined()
    expect(upgrade?.schedule.kind).toBe("forced")
    if (upgrade?.schedule.kind !== "forced") throw new Error("narrowing")
    // All three dates were returned. The forced one is the answer; the other two
    // are carried, not reported as the deadline.
    expect(upgrade.schedule.forcedApplyDate).toBe("2026-09-01T00:00:00.000Z")
    expect(upgrade.schedule.currentApplyDate).toBe("2026-08-25T05:00:00.000Z")
    expect(upgrade.interrupts).toBe(true)

    // The action with only an auto-apply date is a different, softer arm.
    const update = row.pendingMaintenance.actions.find((a) => a.action === "system-update")
    expect(update?.schedule.kind).toBe("auto-applied-after")
    expect(update?.interrupts).toBe(false)

    // The estate sentence leads with the forced one.
    expect(readings.outage.kind).toBe("pending")
    const line = lineFor(readings, "Scheduled outage")
    expect(line).toContain("SCHEDULED OUTAGE")
    expect(line).toContain("2026-09-01T00:00:00.000Z")
    expect(line).toContain("INTERRUPTS")
  })

  test("a refused maintenance read leaves every other database fact standing", async () => {
    const readings = await load({ maintenance: "denied" })

    // The instance listing is untouched: one denied sub-call does not collapse
    // the row.
    expect(readings.instances.state).toBe("ACTUAL")
    const row = firstInstance(readings)
    expect(row.engine).toBe("postgres")
    expect(row.storage.kind).toBe("autoscaling")
    expect(row.backup.kind).toBe("retained")
    expect(row.snapshots.kind).toBe("snapshots")

    // But the maintenance question is UNKNOWN, and says which action was refused.
    expect(readings.pendingMaintenance.state).toBe("DENIED")
    expect(row.pendingMaintenance.kind).toBe("not-read")
    if (row.pendingMaintenance.kind !== "not-read") throw new Error("narrowing")
    expect(row.pendingMaintenance.why).toContain("rds:DescribePendingMaintenanceActions")
    expect(row.pendingMaintenance.why).not.toContain("rds:DescribeDBInstances")

    const rendered = lineFor(readings, "tenure-prod-db")
    expect(rendered).toContain("pending maintenance: unknown")
    expect(rendered).not.toContain("pending maintenance: nothing queued")
    expect(readings.outage.kind).toBe("unknown")
    expect(lineFor(readings, "Scheduled outage")).not.toContain("nothing scheduled")
  })

  test("an empty maintenance list IS an answer: nothing queued, and it says so", async () => {
    const readings = await load({ maintenance: "empty" })
    expect(readings.pendingMaintenance.state).toBe("EMPTY")
    const row = firstInstance(readings)
    expect(row.pendingMaintenance.kind).toBe("none")
    expect(lineFor(readings, "tenure-prod-db")).toContain("pending maintenance: nothing queued")
    expect(readings.outage.kind).toBe("none")
    expect(lineFor(readings, "Scheduled outage")).toContain("nothing scheduled")
  })

  test("a throttled maintenance read is THROTTLED, and is not an empty schedule", async () => {
    const readings = await load({ maintenance: "throttled" })
    expect(readings.pendingMaintenance.state).toBe("THROTTLED")
    const row = firstInstance(readings)
    expect(row.pendingMaintenance.kind).toBe("not-read")
    expect(lineFor(readings, "Pending maintenance")).toContain("throttled")
    expect(readings.outage.kind).toBe("unknown")
  })

  test("the four maintenance outcomes render as four different surfaces", async () => {
    const texts: string[] = []
    for (const outcome of ["populated", "empty", "denied", "throttled"] as const) {
      __resetIdentity()
      texts.push(surfaceText(await load({ maintenance: outcome })))
    }
    expect(new Set(texts).size).toBe(4)
  })
})

/* ------------------------------------------------ the event sub-call alone -- */

describe("'did it restart, and why' has its own read, and its own four answers", () => {
  test("a populated history names the restart and the low-storage warning before it", async () => {
    const readings = await load()
    const row = firstInstance(readings)
    expect(row.events.state).toBe("ACTUAL")
    if (row.events.state !== "ACTUAL") throw new Error("narrowing")

    expect(row.events.value.windowMinutes).toBe(EVENT_WINDOW_MINUTES)
    expect(row.events.value.events).toHaveLength(3)
    // Newest first.
    expect(row.events.value.events[0].at).toBe("2026-08-13T02:14:00.000Z")
    expect(row.events.value.restarts).toHaveLength(1)
    expect(row.events.value.restarts[0].message).toBe("DB instance restarted")
    expect(row.events.value.lowStorage).toHaveLength(1)
    expect(row.events.value.failovers).toHaveLength(0)

    const rendered = lineFor(readings, "tenure-prod-db")
    expect(rendered).toContain("RESTART 2026-08-13T02:14:00.000Z: DB instance restarted")
    expect(rendered).toContain("LOW STORAGE")
  })

  test("a quiet instance answers 'no event', which is not the same string as a denial", async () => {
    const readings = await load()
    if (readings.instances.state !== "ACTUAL") throw new Error("narrowing")
    const quiet = readings.instances.value.find((i) => i.instanceId === "tenure-prod-db-analytics")
    expect(quiet?.events.state).toBe("ACTUAL")
    expect(lineFor(readings, "tenure-prod-db-analytics")).toContain(
      `no event in the last ${EVENT_WINDOW_MINUTES} minute(s)`,
    )
  })

  test("one instance's denied event read does not touch the other instance's", async () => {
    const readings = await load({
      eventFailures: { "tenure-prod-db": "AccessDeniedException" },
    })
    const denied = firstInstance(readings)
    expect(denied.events.state).toBe("DENIED")
    if (denied.events.state !== "DENIED") throw new Error("narrowing")
    // The action named is the EVENT action, not the listing's.
    expect(denied.events.action).toBe("rds:DescribeEvents")
    expect("value" in denied.events).toBe(false)
    // And everything else about that same instance still stands.
    expect(denied.backup.kind).toBe("retained")
    expect(denied.pendingMaintenance.kind).toBe("pending")

    if (readings.instances.state !== "ACTUAL") throw new Error("narrowing")
    const other = readings.instances.value.find((i) => i.instanceId === "tenure-prod-db-analytics")
    expect(other?.events.state).toBe("ACTUAL")

    const rendered = lineFor(readings, "tenure-prod-db")
    expect(rendered).toContain("refused rds:DescribeEvents")
    expect(rendered).not.toContain("no event in the last")
  })

  test("a throttled event read is THROTTLED for that instance only", async () => {
    const readings = await load({ eventFailures: { "tenure-prod-db": "ThrottlingException" } })
    const row = firstInstance(readings)
    expect(row.events.state).toBe("THROTTLED")
    expect(lineFor(readings, "tenure-prod-db")).toContain("throttled")
    expect(lineFor(readings, "tenure-prod-db")).not.toContain("no event in the last")
  })

  test("the four event outcomes render as four different surfaces", async () => {
    const texts: string[] = []
    const cases: FakeOptions[] = [
      {},
      { events: "empty" },
      { eventFailures: { "tenure-prod-db": "AccessDeniedException" } },
      { eventFailures: { "tenure-prod-db": "ThrottlingException" } },
    ]
    for (const options of cases) {
      __resetIdentity()
      texts.push(surfaceText(await load(options)))
    }
    expect(new Set(texts).size).toBe(4)
  })

  test("classification is keyed on AWS's categories, not on the message wording", () => {
    expect(significanceOf(["failover"])).toBe("failover")
    expect(significanceOf(["low storage"])).toBe("low-storage")
    expect(significanceOf(["availability"])).toBe("restart")
    expect(significanceOf(["read replica"])).toBe("replication")
    expect(significanceOf(["configuration change"])).toBe("configuration")
    expect(significanceOf([])).toBe("other")
    // A message that says "restarted" with no category is NOT a restart: the
    // category is the evidence, and inventing one from prose is how a rule
    // degrades silently the next time AWS rewords a sentence.
    expect(significanceOf(["notification"])).toBe("other")
  })
})

/* ------------------------------------------------------------- storage -- */

describe("'is autoscaling on and how close is the ceiling' distinguishes off from full", () => {
  test("an autoscaling instance reports its percentage of the CEILING, not free space", async () => {
    const readings = await load()
    const row = firstInstance(readings)
    expect(row.storage).toEqual({
      kind: "autoscaling",
      allocatedGib: 100,
      ceilingGib: 1000,
      headroomGib: 900,
      percentOfCeiling: 10,
      nearCeiling: false,
      why: expect.stringContaining("headroom to the AUTOSCALING CEILING, not free disk space"),
    })
    expect(lineFor(readings, "tenure-prod-db")).toContain("autoscaling to 1000 GiB")
  })

  test("an absent MaxAllocatedStorage is autoscaling OFF, never a ceiling of zero", async () => {
    const readings = await load()
    if (readings.instances.state !== "ACTUAL") throw new Error("narrowing")
    const row = readings.instances.value.find((i) => i.instanceId === "tenure-prod-db-analytics")
    expect(row?.storage.kind).toBe("fixed")
    const rendered = lineFor(readings, "tenure-prod-db-analytics")
    expect(rendered).toContain("AUTOSCALING OFF")
    // A ceiling of zero would render as 100% of the ceiling. It must not.
    expect(rendered).not.toContain("100% of the ceiling")
  })

  test("an instance at 95% of its ceiling is flagged, and one at 10% is not", () => {
    const near = storageHeadroomOf(950, 1000, "tenure-prod-db-crowded")
    expect(near.kind).toBe("autoscaling")
    if (near.kind !== "autoscaling") throw new Error("narrowing")
    expect(near.percentOfCeiling).toBe(95)
    expect(near.nearCeiling).toBe(true)
    expect(near.why).toContain(`${STORAGE_CEILING_WARN_PERCENT}%`)

    const roomy = storageHeadroomOf(100, 1000, "tenure-prod-db")
    if (roomy.kind !== "autoscaling") throw new Error("narrowing")
    expect(roomy.nearCeiling).toBe(false)
  })

  test("an instance with no AllocatedStorage is unknown, not zero", () => {
    expect(storageHeadroomOf(null, 1000, "x").kind).toBe("unknown")
  })
})

/* ------------------------------------------- backup, recovery, snapshots -- */

describe("backup retention and the latest restorable time travel with the snapshots", () => {
  test("retention, window, recovery point and snapshots all appear on one row", async () => {
    const readings = await load()
    const row = firstInstance(readings)

    expect(row.backup.kind).toBe("retained")
    if (row.backup.kind !== "retained") throw new Error("narrowing")
    expect(row.backup.days).toBe(7)
    expect(row.backup.window.kind).toBe("window")

    expect(row.recoveryPoint.kind).toBe("restorable")
    if (row.recoveryPoint.kind !== "restorable") throw new Error("narrowing")
    expect(row.recoveryPoint.at).toBe("2026-08-13T09:10:00.000Z")
    expect(row.recoveryPoint.ageMs).toBe(5 * 60_000)
    expect(row.recoveryPoint.stale).toBe(false)

    expect(row.snapshots.kind).toBe("snapshots")
    if (row.snapshots.kind !== "snapshots") throw new Error("narrowing")
    expect(row.snapshots.count).toBe(2)
    expect(row.snapshots.automated).toBe(1)
    expect(row.snapshots.manual).toBe(1)
    // Newest first.
    expect(row.snapshots.snapshots[0].createdAt).toBe("2026-08-13T03:05:00.000Z")

    const rendered = lineFor(readings, "tenure-prod-db")
    expect(rendered).toContain("7 day(s) retained")
    expect(rendered).toContain("restorable to 2026-08-13T09:10:00.000Z")
    expect(rendered).toContain("2 snapshot(s), 1 automated / 1 manual")
  })

  test("retention of zero is backups OFF, and says there is no point-in-time recovery", async () => {
    const readings = await load()
    if (readings.instances.state !== "ACTUAL") throw new Error("narrowing")
    const row = readings.instances.value.find((i) => i.instanceId === "tenure-prod-db-analytics")
    expect(row?.backup.kind).toBe("disabled")
    expect(row?.recoveryPoint.kind).toBe("none")
    const rendered = lineFor(readings, "tenure-prod-db-analytics")
    expect(rendered).toContain("NO AUTOMATED BACKUPS")
    expect(rendered).toContain("no recovery point")
  })

  test("a recovery point two hours behind is STALE, and one five minutes behind is not", () => {
    const stale = recoveryPointOf(
      "2026-08-13T07:00:00.000Z",
      "2026-08-13T09:15:00.000Z",
      "tenure-prod-db-crowded",
    )
    expect(stale.kind).toBe("restorable")
    if (stale.kind !== "restorable") throw new Error("narrowing")
    expect(stale.stale).toBe(true)
    expect(stale.why).toContain("135 minute(s) behind")

    const fresh = recoveryPointOf(
      "2026-08-13T09:10:00.000Z",
      "2026-08-13T09:15:00.000Z",
      "tenure-prod-db",
    )
    if (fresh.kind !== "restorable") throw new Error("narrowing")
    expect(fresh.stale).toBe(false)
  })

  test("a crowded instance surfaces both the near-ceiling and the stale recovery point", async () => {
    const readings = await load({ instancePages: [[crowdedInstance()]] })
    const rendered = lineFor(readings, "tenure-prod-db-crowded")
    expect(rendered).toContain("NEAR CEILING")
    expect(rendered).toContain("STALE recovery point")
  })

  test("a refused snapshot read is 'unknown', never 'no snapshot'", async () => {
    const readings = await load({ snapshots: "denied" })
    const row = firstInstance(readings)
    expect(row.snapshots.kind).toBe("not-read")
    const rendered = lineFor(readings, "tenure-prod-db")
    expect(rendered).toContain("snapshots unknown")
    expect(rendered).not.toContain("snapshots: no snapshot")
    // And the rest of the row is unaffected.
    expect(row.backup.kind).toBe("retained")
    expect(lineFor(readings, "Snapshots")).toContain("refused rds:DescribeDBSnapshots")
  })

  test("an empty snapshot read IS 'no snapshot', which is a different sentence", async () => {
    const readings = await load({ snapshots: "empty" })
    const row = firstInstance(readings)
    expect(row.snapshots.kind).toBe("none")
    expect(lineFor(readings, "tenure-prod-db")).toContain("snapshots: no snapshot")
  })
})

/* ----------------------------------------------------- SSL and parameters -- */

describe("rds.force_ssl is not readable from here, and the module says so every time", () => {
  test("an engine-default group is reported as unmodifiable, and STILL not as enforced", async () => {
    const readings = await load()
    const row = firstInstance(readings)

    expect(row.parameterGroups.kind).toBe("attached")
    if (row.parameterGroups.kind !== "attached") throw new Error("narrowing")
    expect(row.parameterGroups.groups[0].name).toBe("default.postgres16")
    expect(row.parameterGroups.groups[0].engineDefault).toBe(true)
    expect(row.parameterGroups.groups[0].applyStatus).toBe("in-sync")

    expect(row.sslEnforcement.state).toBe("NOT_READABLE")
    expect(row.sslEnforcement.parameter).toBe("rds.force_ssl")
    expect(row.sslEnforcement.needs).toBe(PARAMETER_VALUE_CAPABILITY)
    expect(row.sslEnforcement.groupsAreEngineDefault).toBe(true)
    expect(row.sslEnforcement.why).toContain(PARAMETER_VALUE_CAPABILITY)
    expect(row.sslEnforcement.why).toContain("Unknown, not enforced")

    const rendered = lineFor(readings, "tenure-prod-db")
    expect(rendered).toContain("rds.force_ssl: unknown")
    expect(rendered).not.toContain("rds.force_ssl: enforced")
  })

  test("a custom group is reported as possibly-divergent, in different words", async () => {
    const readings = await load()
    if (readings.instances.state !== "ACTUAL") throw new Error("narrowing")
    const row = readings.instances.value.find((i) => i.instanceId === "tenure-prod-db-analytics")
    expect(row?.sslEnforcement.groupsAreEngineDefault).toBe(false)
    expect(row?.sslEnforcement.why).toContain("may differ from the engine default")
    expect(row?.parameterGroups.kind).toBe("attached")
    expect(lineFor(readings, "tenure-prod-db-analytics")).toContain("apply status pending-reboot")
  })

  test("a refused parameter-group listing makes the groups unknown, not engine-default", async () => {
    const readings = await load({ parameterGroups: "denied" })
    const row = firstInstance(readings)
    expect(row.parameterGroups.kind).toBe("not-read")
    if (row.parameterGroups.kind !== "not-read") throw new Error("narrowing")
    expect(row.parameterGroups.why).toContain("rds:DescribeDBParameterGroups")
    expect(row.sslEnforcement.groupsAreEngineDefault).toBeNull()
    expect(row.sslEnforcement.why).toContain("not even the group this instance sits on is known")
    // Everything else about the row stands.
    expect(row.backup.kind).toBe("retained")
    expect(row.pendingMaintenance.kind).toBe("pending")
  })

  test("the engine decides the parameter's name, and an unknown engine gets none invented", () => {
    expect(sslParameterFor("postgres")).toBe("rds.force_ssl")
    expect(sslParameterFor("aurora-postgresql")).toBe("rds.force_ssl")
    expect(sslParameterFor("mysql")).toBe("require_secure_transport")
    expect(sslParameterFor("mariadb")).toBe("require_secure_transport")
    expect(sslParameterFor("oracle-se2")).toBeNull()
    expect(sslParameterFor(null)).toBeNull()
  })

  test("the engine-default test uses the exact default.<family> name when the family is known", () => {
    expect(isEngineDefaultGroup("default.postgres16", "postgres16")).toBe(true)
    // Same prefix, wrong family: not the default group for THIS family.
    expect(isEngineDefaultGroup("default.postgres15", "postgres16")).toBe(false)
    expect(isEngineDefaultGroup("tenure-prod-pg16", "postgres16")).toBe(false)
    // With no family known, the prefix is all there is.
    expect(isEngineDefaultGroup("default.postgres16", null)).toBe(true)
  })
})

/* ------------------------------------------------------ pagination bound -- */

describe("a listing that runs past the cap says so rather than pretending to be complete", () => {
  test("more pages than MAX_PAGES is TRUNCATED, with the marker AWS was still handing back", async () => {
    // One instance per page, one more page than the engine will walk.
    const pages = Array.from({ length: MAX_PAGES + 2 }, (_, i) => [
      primaryInstance({
        DBInstanceIdentifier: `tenure-prod-db-${String(i).padStart(2, "0")}`,
        DBInstanceArn: rdsArn("db", `tenure-prod-db-${String(i).padStart(2, "0")}`),
      }),
    ])
    const readings = await load({ instancePages: pages })

    expect(readings.instances.state).toBe("ACTUAL")
    if (readings.instances.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.instances.value).toHaveLength(MAX_PAGES)
    expect(readings.truncation.instances.kind).toBe("truncated")
    if (readings.truncation.instances.kind !== "truncated") throw new Error("narrowing")
    expect(readings.truncation.instances.pagesRead).toBe(MAX_PAGES)
    expect(readings.truncation.instances.nextMarker).toBe(String(MAX_PAGES))

    const line = lineFor(readings, "Databases")
    expect(line).toContain("TRUNCATED")
    expect(line).toContain("is NOT the whole estate")
  })

  test("a truncated listing is never EMPTY, even when the pages it read were empty", async () => {
    const pages: Json[][] = Array.from({ length: MAX_PAGES + 1 }, () => [])
    const readings = await load({ instancePages: pages })
    // Stopping early is not "there is nothing".
    expect(readings.instances.state).toBe("ACTUAL")
    expect(readings.truncation.instances.kind).toBe("truncated")
    expect(lineFor(readings, "Databases")).not.toContain("none —")
  })

  test("event history is read for at most MAX_EVENT_INSTANCE_READS instances, and says where it stopped", async () => {
    const many = Array.from({ length: MAX_EVENT_INSTANCE_READS + 1 }, (_, i) =>
      primaryInstance({
        DBInstanceIdentifier: `tenure-prod-db-${String(i).padStart(2, "0")}`,
        DBInstanceArn: rdsArn("db", `tenure-prod-db-${String(i).padStart(2, "0")}`),
      }),
    )
    const readings = await load({ instancePages: [many] })
    if (readings.instances.state !== "ACTUAL") throw new Error("narrowing")
    const last = readings.instances.value[readings.instances.value.length - 1]
    expect(last.events.state).toBe("UNCONFIGURED")
    if (last.events.state !== "UNCONFIGURED") throw new Error("narrowing")
    expect(last.events.why).toContain(`at most ${MAX_EVENT_INSTANCE_READS} instances`)
    expect(last.events.why).toContain("not the same as its having had none")
    // And the ones inside the cap were read.
    expect(readings.instances.value[0].events.state).toBe("ACTUAL")
  })
})

/* ------------------------------------------------- region, partition, ARNs -- */

describe("region and partition come from the resolved identity, never from a literal", () => {
  test("a GovCloud principal produces GovCloud region and partition, with no us-east-1 anywhere", async () => {
    const readings = await load({
      identity: {
        arn: `arn:aws-us-gov:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
        account: ACCOUNT,
        region: "us-gov-west-1",
      },
      instancePages: [
        [
          primaryInstance({
            DBInstanceArn: rdsArn("db", "tenure-prod-db", "us-gov-west-1", "aws-us-gov"),
          }),
        ],
      ],
      tags: {},
    })
    const row = firstInstance(readings)
    expect(row.partition).toBe("aws-us-gov")
    expect(row.region).toBe("us-gov-west-1")
    expect(surfaceText(readings)).not.toContain("us-east-1")
    expect(surfaceText(readings)).not.toContain("partition aws)")
  })

  test("with no ARN from RDS the ARN is assembled from identity, and provenance says so", async () => {
    const readings = await load({
      instancePages: [[primaryInstance({ DBInstanceArn: undefined })]],
      tags: {},
    })
    const row = firstInstance(readings)
    expect(row.arn).toBe(rdsArn("db", "tenure-prod-db"))
    expect(row.arnProvenance).toContain("assembled from the resolved identity")
  })

  test("with no ARN and no identity the engine refuses to assemble one", async () => {
    const readings = await load({
      identity: "denied",
      instancePages: [[primaryInstance({ DBInstanceArn: undefined })]],
    })
    const row = firstInstance(readings)
    expect(row.arn).toBeNull()
    expect(row.arnProvenance).toContain("will not assemble one it cannot stand behind")
    // And with no ARN, the maintenance listing cannot be joined — which is
    // `not-read`, not `none`.
    expect(row.pendingMaintenance.kind).toBe("not-read")
    expect(deriveInstanceArn("tenure-prod-db", readings.identity)).toBeNull()
  })
})

/* ----------------------------------------------------------- attribution -- */

describe("attribution comes from the tag index, and 'we could not look' is its own answer", () => {
  test("a tagged instance attributes to its tenant and a sentinel-tagged one to shared", async () => {
    const readings = await load()
    if (readings.instances.state !== "ACTUAL") throw new Error("narrowing")
    const tenant = readings.instances.value.find((i) => i.instanceId === "tenure-prod-db")
    const shared = readings.instances.value.find((i) => i.instanceId === "tenure-prod-db-analytics")
    expect(tenant?.attribution).toEqual({ kind: "tenant", tenantSlug: "westfield-high" })
    expect(shared?.attribution).toEqual({ kind: "shared" })
  })

  test("an untagged instance is unattributable, not shared", async () => {
    const readings = await load({ tags: {} })
    const row = firstInstance(readings)
    expect(row.attribution.kind).toBe("unattributed")
    expect(lineFor(readings, "tenure-prod-db")).toContain("unattributable — missing tenure:tenant")
  })

  test("a refused tag index is 'attribution unknown' — not unattributable and not shared", async () => {
    const readings = await load({ tagsOutcome: "denied" })
    const row = firstInstance(readings)
    expect(row.attribution.kind).toBe("unknown")
    const rendered = lineFor(readings, "tenure-prod-db")
    expect(rendered).toContain("attribution unknown")
    expect(rendered).not.toContain("unattributable — missing tenure:tenant")
    // The database facts themselves are untouched by a tag failure.
    expect(row.backup.kind).toBe("retained")
  })
})

/* --------------------------------------------------- queued changes / safety -- */

describe("queued modifications are reported, and a queued password never is", () => {
  test("an engine upgrade queued on the instance is a restart, a storage grow is not", async () => {
    const readings = await load()
    if (readings.instances.state !== "ACTUAL") throw new Error("narrowing")
    const row = readings.instances.value.find((i) => i.instanceId === "tenure-prod-db-analytics")
    const fields = row?.pendingChanges.map((c) => `${c.field}:${c.restarts}`) ?? []
    expect(fields).toContain("engine version:true")
    expect(fields).toContain("allocated storage:false")
  })

  test("the whole rendered surface never contains the queued MasterUserPassword", async () => {
    const readings = await load()
    const text = surfaceText(readings)
    expect(text).not.toContain(PLACEHOLDER_PASSWORD)
    expect(text).not.toContain("MasterUserPassword")
    expect(JSON.stringify(readings)).not.toContain(PLACEHOLDER_PASSWORD)
  })
})

/* ------------------------------------------------------ schedule ordering -- */

describe("the schedule an operator plans around is the most binding one", () => {
  test("forced beats auto-apply beats current-apply beats no date at all", () => {
    const forced = outageScheduleOf(
      {
        ForcedApplyDate: "2026-09-01T00:00:00.000Z",
        AutoAppliedAfterDate: "2026-08-20T00:00:00.000Z",
        CurrentApplyDate: "2026-08-25T05:00:00.000Z",
      },
      "db-upgrade",
      "tenure-prod-db",
    )
    expect(forced.kind).toBe("forced")

    const auto = outageScheduleOf(
      { AutoAppliedAfterDate: "2026-08-20T00:00:00.000Z", CurrentApplyDate: "2026-08-25T05:00:00.000Z" },
      "system-update",
      "tenure-prod-db",
    )
    expect(auto.kind).toBe("auto-applied-after")

    const current = outageScheduleOf(
      { CurrentApplyDate: "2026-08-25T05:00:00.000Z" },
      "system-update",
      "tenure-prod-db",
    )
    expect(current.kind).toBe("scheduled")

    expect(outageScheduleOf({}, "system-update", "tenure-prod-db").kind).toBe("unscheduled")
  })

  test("the soonest schedule across actions is the most binding, then the earliest", () => {
    const soon = soonestSchedule([
      {
        action: "system-update",
        description: null,
        optInStatus: null,
        schedule: { kind: "unscheduled", why: "no date" },
        interrupts: false,
        why: "",
      },
      {
        action: "db-upgrade",
        description: null,
        optInStatus: null,
        schedule: {
          kind: "forced",
          forcedApplyDate: "2026-09-01T00:00:00.000Z",
          currentApplyDate: null,
          why: "forced",
        },
        interrupts: true,
        why: "",
      },
    ])
    expect(soon.kind).toBe("forced")
  })
})
