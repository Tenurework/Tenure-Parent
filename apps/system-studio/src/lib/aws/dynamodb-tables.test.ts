import { SHARED } from "@tenure/provisioning"

import { __resetIdentity } from "./identity"
import type { AwsGateway } from "./read"
import {
  MAX_KEY_DESCRIBE_READS,
  MAX_LIST_PAGES,
  MAX_TABLE_DETAIL_READS,
  deriveTableArn,
  dynamodbLines,
  isoOf,
  parseBillingMode,
  parseDeletionProtection,
  parseEncryption,
  parsePointInTimeRecovery,
  parseTimeToLive,
  registryTableNameFromEnv,
  tableReadings,
  type DynamoDbReadings,
} from "./dynamodb-tables"

/**
 * STUDIO-070-004 (DynamoDB) — the table surface tells four different truths
 * apart, and ranks the one that matters first.
 *
 * The assertions are on `tableReadings` and `dynamodbLines`, the functions a
 * route renders, rather than on `readAws` or on any parser. A test that drove
 * `readAws` directly would stay green on the day this module stopped calling it,
 * which is precisely the failure this programme has already paid for twice.
 *
 * ## The stand-in is a client, not a stub
 *
 * `fakeAws` answers seven capabilities with the shapes the real SDK returns —
 * `{TableNames, LastEvaluatedTableName}` from ListTables, `{Table: {…}}` from
 * DescribeTable, `{ContinuousBackupsDescription: {…}}` from
 * DescribeContinuousBackups, `{TimeToLiveDescription: {…}}` from
 * DescribeTimeToLive, `{KeyMetadata: {…}}` from DescribeKey,
 * `{ResourceTagMappingList: […]}` from the Tagging API and `{Account, Arn}` from
 * STS — and it can fail EACH of them independently with `AccessDeniedException`,
 * `ThrottlingException`, an empty-but-successful list, or a populated one. A
 * stand-in that returned `[]` regardless of what was asked would prove nothing
 * about code whose entire job is to tell those apart, and it is the fake this
 * repository has already been burnt by.
 *
 * ## The account id is obviously fake
 *
 * `123456789012` is AWS's own documentation placeholder. Nothing here is a real
 * account, a real ARN or a real key id, and nothing in this suite opens a
 * socket.
 */

/* ------------------------------------------------------------- the estate -- */

/** AWS's documentation placeholder. Deliberately not a real account id. */
const ACCOUNT = "123456789012"
const REGION = "eu-west-2"
const REGISTRY = "tenure-studio-prod-tenants"

/** A KMS key id that is obviously constructed, not one observed in an account. */
const CMK_ARN = `arn:aws:kms:${REGION}:${ACCOUNT}:key/11111111-2222-3333-4444-555555555555`
const AWS_MANAGED_KEY_ARN = `arn:aws:kms:${REGION}:${ACCOUNT}:key/99999999-8888-7777-6666-555555555555`

function tableArn(name: string, partition = "aws", region = REGION): string {
  return `arn:${partition}:dynamodb:${region}:${ACCOUNT}:table/${name}`
}

/** A tag set that attributes to a tenant. Only `tenure:tenant` is load-bearing here. */
function tenantTags(slug: string): Array<{ Key: string; Value: string }> {
  return [
    { Key: "tenure:tenant", Value: slug },
    { Key: "tenure:environment", Value: "production" },
    { Key: "tenure:module", Value: "registry" },
  ]
}

type TableShape = Record<string, unknown>

interface TableFixture {
  name: string
  /** The `Table` object DescribeTable returns. Omit for the healthy default. */
  table?: TableShape
  describeFailWith?: string
  /** `enabled` | `disabled` | `absent` — `absent` returns no description at all. */
  pitr?: "enabled" | "disabled" | "absent"
  pitrFailWith?: string
  ttl?: { TimeToLiveStatus?: string; AttributeName?: string } | "absent"
  ttlFailWith?: string
}

/**
 * The registry table as `infrastructure/studio/dynamodb.tf` declares it:
 * on-demand, PITR on, SSE on, deletion protection on, no TTL.
 */
function registryTable(overrides: TableShape = {}): TableShape {
  return {
    TableName: REGISTRY,
    TableArn: tableArn(REGISTRY),
    TableStatus: "ACTIVE",
    // Epoch SECONDS, which is what DynamoDB puts on the wire.
    CreationDateTime: 1_753_920_000,
    ItemCount: 41,
    TableSizeBytes: 184_320,
    DeletionProtectionEnabled: true,
    BillingModeSummary: { BillingMode: "PAY_PER_REQUEST" },
    SSEDescription: { Status: "ENABLED", SSEType: "KMS", KMSMasterKeyArn: AWS_MANAGED_KEY_ARN },
    KeySchema: [
      { AttributeName: "pk", KeyType: "HASH" },
      { AttributeName: "sk", KeyType: "RANGE" },
    ],
    ...overrides,
  }
}

/** An ordinary provisioned table with one GSI, so the index path is exercised. */
function sessionsTable(overrides: TableShape = {}): TableShape {
  return {
    TableName: "tenure-studio-prod-sessions",
    TableArn: tableArn("tenure-studio-prod-sessions"),
    TableStatus: "ACTIVE",
    CreationDateTime: 1_753_920_000,
    ItemCount: 12_004,
    TableSizeBytes: 9_000_000,
    DeletionProtectionEnabled: false,
    BillingModeSummary: { BillingMode: "PROVISIONED" },
    ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
    KeySchema: [{ AttributeName: "sessionId", KeyType: "HASH" }],
    GlobalSecondaryIndexes: [
      {
        IndexName: "by-user",
        IndexStatus: "ACTIVE",
        Backfilling: false,
        ItemCount: 12_004,
        IndexSizeBytes: 400_000,
        KeySchema: [{ AttributeName: "userId", KeyType: "HASH" }],
        Projection: { ProjectionType: "KEYS_ONLY" },
        ProvisionedThroughput: { ReadCapacityUnits: 2, WriteCapacityUnits: 2 },
      },
    ],
    ...overrides,
  }
}

/** The healthy estate: the registry as Terraform declares it, plus one data table. */
function healthyEstate(): TableFixture[] {
  return [
    { name: REGISTRY, table: registryTable(), pitr: "enabled", ttl: { TimeToLiveStatus: "DISABLED" } },
    {
      name: "tenure-studio-prod-sessions",
      table: sessionsTable(),
      pitr: "disabled",
      ttl: { TimeToLiveStatus: "ENABLED", AttributeName: "expiresAt" },
    },
  ]
}

/* ------------------------------------------------------------- the client -- */

type Outcome = "populated" | "empty" | "denied" | "throttled"

interface FakeOptions {
  /** How `dynamodb:ListTables` behaves. The four cases this suite exists to separate. */
  listTables?: Outcome
  tables?: TableFixture[]
  /** Every page carries a LastEvaluatedTableName, so the page bound is reached. */
  listNeverEnds?: boolean
  tags?: Record<string, Array<{ Key: string; Value: string }>>
  tagsOutcome?: Outcome
  identity?: { arn: string; account: string; region: string } | "denied"
  /** How `kms:DescribeKey` behaves, per key ARN. */
  keys?: Record<string, { KeyManager?: string; KeyState?: string; DeletionDate?: number }>
  keysFailWith?: string
  /** Set by the fake so a test can assert what was and was not called. */
  calls?: string[]
}

function throwing(name: string): never {
  const error = new Error(`${name} raised by the stand-in AWS client`)
  error.name = name
  throw error
}

function backupsFor(fixture: TableFixture): unknown {
  const mode = fixture.pitr ?? "enabled"
  if (mode === "absent") return {}
  if (mode === "disabled") {
    return {
      ContinuousBackupsDescription: {
        ContinuousBackupsStatus: "DISABLED",
        PointInTimeRecoveryDescription: { PointInTimeRecoveryStatus: "DISABLED" },
      },
    }
  }
  return {
    ContinuousBackupsDescription: {
      ContinuousBackupsStatus: "ENABLED",
      PointInTimeRecoveryDescription: {
        PointInTimeRecoveryStatus: "ENABLED",
        // Dates as `Date`, which is what the v3 SDK deserialises to.
        EarliestRestorableDateTime: new Date("2026-07-09T09:15:00.000Z"),
        LatestRestorableDateTime: new Date("2026-08-13T09:14:00.000Z"),
        RecoveryPeriodInDays: 35,
      },
    },
  }
}

/**
 * A stand-in that behaves like the SDK: same response shapes, same error names,
 * and independently failable per capability and per table.
 */
function fakeAws(options: FakeOptions = {}): AwsGateway {
  const listOutcome = options.listTables ?? "populated"
  const tables = options.tables ?? healthyEstate()
  const identity = options.identity ?? {
    arn: `arn:aws:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
    account: ACCOUNT,
    region: REGION,
  }
  const calls = options.calls ?? []

  return {
    async call(capability, input) {
      calls.push(String(capability))
      const named = (key: string) => String((input as Record<string, unknown> | undefined)?.[key] ?? "")

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

        case "dynamodb:ListTables": {
          if (listOutcome === "denied") throwing("AccessDeniedException")
          if (listOutcome === "throttled") throwing("ThrottlingException")
          // The real API OMITS TableNames entirely when there are none. It does
          // not return an empty array, and a fake that did would be testing a
          // response AWS never sends.
          if (listOutcome === "empty") return {}
          if (options.listNeverEnds) {
            const after = named("ExclusiveStartTableName")
            const next = `page-${after ? Number(after.split("-")[1]) + 1 : 1}`
            return { TableNames: [next], LastEvaluatedTableName: next }
          }
          return { TableNames: tables.map((t) => t.name) }
        }

        case "dynamodb:DescribeTable": {
          const fixture = tables.find((t) => t.name === named("TableName"))
          if (!fixture) throwing("ResourceNotFoundException")
          if (fixture.describeFailWith) throwing(fixture.describeFailWith)
          return { Table: fixture.table ?? { TableName: fixture.name, TableArn: tableArn(fixture.name), ItemCount: 0, TableSizeBytes: 0 } }
        }

        case "dynamodb:DescribeContinuousBackups": {
          const fixture = tables.find((t) => t.name === named("TableName"))
          if (!fixture) throwing("ResourceNotFoundException")
          if (fixture.pitrFailWith) throwing(fixture.pitrFailWith)
          return backupsFor(fixture)
        }

        case "dynamodb:DescribeTimeToLive": {
          const fixture = tables.find((t) => t.name === named("TableName"))
          if (!fixture) throwing("ResourceNotFoundException")
          if (fixture.ttlFailWith) throwing(fixture.ttlFailWith)
          if (fixture.ttl === "absent") return {}
          return { TimeToLiveDescription: fixture.ttl ?? { TimeToLiveStatus: "DISABLED" } }
        }

        case "kms:DescribeKey": {
          if (options.keysFailWith) throwing(options.keysFailWith)
          const keyId = named("KeyId")
          const metadata = options.keys?.[keyId] ?? { KeyManager: "AWS", KeyState: "Enabled" }
          return { KeyMetadata: { Arn: keyId, KeyId: keyId, ...metadata } }
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

async function load(
  options: FakeOptions = {},
  registryTableName: string | null = REGISTRY,
): Promise<DynamoDbReadings> {
  return tableReadings(fakeAws(options), { now: AT, registryTableName })
}

/** The whole surface as one string, which is what an operator actually reads. */
function surfaceText(readings: DynamoDbReadings): string {
  return dynamodbLines(readings)
    .map((line) => `${line.label}: ${line.text}`)
    .join("\n")
}

beforeEach(() => {
  // resolveIdentity caches per process. Every case here supplies its own
  // gateway, which bypasses the cache, but a stale cache from another suite
  // would silently make these assertions test the wrong identity.
  __resetIdentity()
})

/* -------------------------------------------- the four outcomes, compared -- */

describe("the DynamoDB surface says something different for each of the four outcomes", () => {
  test("a populated list is ACTUAL and describes every table", async () => {
    const readings = await load()
    expect(readings.tables.state).toBe("ACTUAL")
    if (readings.tables.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.tables.value).toHaveLength(2)
    const text = surfaceText(readings)
    expect(text).toContain(REGISTRY)
    expect(text).toContain("tenure-studio-prod-sessions")
    expect(text).toContain("41 item(s)")
    expect(text).toContain("on-demand (PAY_PER_REQUEST)")
    expect(text).toContain("provisioned — 5 RCU / 5 WCU")
  })

  test("an empty-but-successful list is EMPTY and says none, not refused", async () => {
    const readings = await load({ listTables: "empty" })
    expect(readings.tables.state).toBe("EMPTY")
    const text = surfaceText(readings)
    expect(text).toContain("none —")
    expect(text).not.toContain("refused")
    expect(text).not.toContain("Minimum statement")
    // An empty region is a listing that walked to completion, not one that stopped.
    expect(readings.more).toEqual({ kind: "complete" })
  })

  test("AccessDenied is DENIED, carries the principal, the action and a pasteable statement", async () => {
    const readings = await load({ listTables: "denied" })
    expect(readings.tables.state).toBe("DENIED")
    if (readings.tables.state !== "DENIED") throw new Error("narrowing")

    // The three things a denial has to carry so it can be fixed without leaving
    // the page: who we were, what we were refused, and the JSON to paste.
    expect(readings.tables.action).toBe("dynamodb:ListTables")
    expect(readings.tables.principal).toContain("assumed-role/tenure-studio-task")
    expect(readings.tables.accountId).toBe(ACCOUNT)
    expect(readings.tables.region).toBe(REGION)
    expect(readings.tables.partition).toBe("aws")
    expect(JSON.parse(readings.tables.minimumStatement)).toEqual({
      Effect: "Allow",
      Action: ["dynamodb:ListTables"],
      Resource: "*",
    })

    // And the thing it must NOT be. There is no `value` on this arm at all, so
    // a caller cannot reach an empty array; the render says "unknown".
    expect("value" in readings.tables).toBe(false)
    const text = surfaceText(readings)
    expect(text).toContain("unknown")
    expect(text).not.toMatch(/\bnone\b/)
    // Whether there are more tables is unknown — never "complete".
    expect(readings.more.kind).toBe("unknown")
  })

  test("a throttle is THROTTLED — its own state, not a failure and not an empty list", async () => {
    const readings = await load({ listTables: "throttled" })
    expect(readings.tables.state).toBe("THROTTLED")
    if (readings.tables.state !== "THROTTLED") throw new Error("narrowing")
    // The schedule is throttle.ts's — 200ms after the first failure, doubling —
    // not a number retyped in this module.
    expect(readings.tables.retryAfterMs).toBe(800)
    const text = surfaceText(readings)
    expect(text).toContain("throttled")
    expect(text).toContain("retrying in")
    expect(text).not.toContain("Minimum statement")
  })

  test("the four render as four visibly different surfaces", async () => {
    const texts: string[] = []
    for (const outcome of ["populated", "empty", "denied", "throttled"] as const) {
      __resetIdentity()
      texts.push(surfaceText(await load({ listTables: outcome })))
    }
    // Pairwise distinct. A fake that returned [] regardless would collapse at
    // least two of these into one string, and this is the assertion that
    // notices.
    expect(new Set(texts).size).toBe(4)
    for (const text of texts) expect(text.length).toBeGreaterThan(0)
  })
})

/* ------------------------------------------- the registry, ranked first -- */

describe("the tenant registry's protection is the first thing the surface says", () => {
  test("the registry line is line zero, before the listing and before any table", async () => {
    const lines = dynamodbLines(await load())
    expect(lines[0].label).toBe("Tenant registry")
    expect(lines[0].text).toContain(REGISTRY)
    // And the registry's own row sorts ahead of a table whose name sorts first.
    const rowLabels = lines.slice(3).map((l) => l.label)
    expect(rowLabels[0]).toBe(REGISTRY)
  })

  test("PITR off on the registry is REGISTRY UNRECOVERABLE, not a cell in a table", async () => {
    const tables = healthyEstate()
    tables[0] = { ...tables[0], pitr: "disabled" }
    const readings = await load({ tables })

    expect(readings.registry.kind).toBe("no-point-in-time-recovery")
    if (readings.registry.kind !== "no-point-in-time-recovery") throw new Error("narrowing")
    expect(readings.registry.tableName).toBe(REGISTRY)
    expect(readings.registry.why).toContain("fleet's own record of itself")

    const line = dynamodbLines(readings)[0]
    expect(line.text).toContain("REGISTRY UNRECOVERABLE")
    expect(line.text).not.toContain("is recoverable")
  })

  test("PITR on the registry being REFUSED is unknown — not off and not on", async () => {
    // The distinction the whole read plane exists for. "Off" would send an
    // operator to turn on something already on; "on" would be a fabricated
    // reassurance about a fact nobody read.
    const tables = healthyEstate()
    tables[0] = { ...tables[0], pitrFailWith: "AccessDeniedException" }
    const readings = await load({ tables })

    expect(readings.registry.kind).toBe("unknown")
    if (readings.registry.kind !== "unknown") throw new Error("narrowing")
    expect(readings.registry.why).toContain("dynamodb:DescribeContinuousBackups")
    expect(readings.registry.why).toContain("unknown, not off, and not on")

    const line = dynamodbLines(readings)[0]
    expect(line.text).toContain("unknown")
    expect(line.text).not.toContain("REGISTRY UNRECOVERABLE")
    expect(line.text).not.toContain("is recoverable")
  })

  test("PITR on, deletion protection off, is recoverable AND not clean", async () => {
    const tables = healthyEstate()
    tables[0] = {
      ...tables[0],
      table: registryTable({ DeletionProtectionEnabled: false }),
    }
    const readings = await load({ tables })
    expect(readings.registry.kind).toBe("protected")
    if (readings.registry.kind !== "protected") throw new Error("narrowing")
    expect(readings.registry.recoveryPeriodInDays).toBe(35)
    expect(readings.registry.earliestRestorableAt).toBe("2026-07-09T09:15:00.000Z")
    expect(readings.registry.weaknesses.join(" ")).toContain("deletion protection is OFF")
    const line = dynamodbLines(readings)[0]
    expect(line.text).toContain("is recoverable")
    expect(line.text).toContain("Not otherwise clean")
  })

  test("deletion protection AWS did not state is 'unknown' on the registry, never 'OFF'", async () => {
    // A field AWS omitted rendered as a finding is a fabricated finding, and on
    // this table it would send somebody to fix protection that may be on.
    const tables = healthyEstate()
    const table = registryTable()
    delete table.DeletionProtectionEnabled
    tables[0] = { ...tables[0], table }
    const readings = await load({ tables })
    if (readings.registry.kind !== "protected") throw new Error("narrowing")
    expect(readings.registry.weaknesses.join(" ")).toContain("was not stated by AWS")
    expect(readings.registry.weaknesses.join(" ")).not.toContain("deletion protection is OFF")
    expect(dynamodbLines(readings)[0].text).not.toContain("deletion protection is OFF")
    expect(dynamodbLines(readings).find((l) => l.label === REGISTRY)?.text).not.toContain(
      "deletion protection OFF",
    )
  })

  test("a TTL on the registry is named — the fleet's record deleting itself on a timer", async () => {
    const tables = healthyEstate()
    tables[0] = {
      ...tables[0],
      ttl: { TimeToLiveStatus: "ENABLED", AttributeName: "expiresAt" },
    }
    const readings = await load({ tables })
    if (readings.registry.kind !== "protected") throw new Error("narrowing")
    expect(readings.registry.weaknesses.join(" ")).toContain("TTL on expiresAt is deleting rows")
  })

  test("TENANT_TABLE unset is 'unnamed' — never a registry reported as fine", async () => {
    const readings = await load({}, null)
    expect(readings.registry.kind).toBe("unnamed")
    expect(readings.registryTableName).toBeNull()
    const line = dynamodbLines(readings)[0]
    expect(line.text).toContain("TENANT_TABLE is not set")
    expect(line.text).not.toContain("is recoverable")
    // And no table claims to be the registry.
    if (readings.tables.state !== "ACTUAL") throw new Error("narrowing")
    for (const table of readings.tables.value) expect(table.isTenantRegistry).toBe(false)
  })

  test("a registry that is not in this region is 'missing', naming the region", async () => {
    const readings = await load({ tables: [healthyEstate()[1]] })
    expect(readings.registry.kind).toBe("missing")
    if (readings.registry.kind !== "missing") throw new Error("narrowing")
    expect(readings.registry.region).toBe(REGION)
    expect(readings.registry.why).toContain("per-region")
    expect(dynamodbLines(readings)[0].text).toContain("NOT FOUND")
  })

  test("a denied listing makes the registry unknown, never missing and never protected", async () => {
    const readings = await load({ listTables: "denied" })
    expect(readings.registry.kind).toBe("unknown")
    const line = dynamodbLines(readings)[0]
    expect(line.text).toContain("dynamodb:ListTables")
    expect(line.text).not.toContain("NOT FOUND")
  })

  test("registryTableNameFromEnv reads TENANT_TABLE, the variable registry.ts reads", () => {
    // Scoped teardown: this restores exactly the value it found, set or unset,
    // and touches nothing else in process.env.
    const had = Object.prototype.hasOwnProperty.call(process.env, "TENANT_TABLE")
    const before = process.env.TENANT_TABLE
    try {
      process.env.TENANT_TABLE = "  some-registry  "
      expect(registryTableNameFromEnv()).toBe("some-registry")
      process.env.TENANT_TABLE = "   "
      expect(registryTableNameFromEnv()).toBeNull()
      delete process.env.TENANT_TABLE
      expect(registryTableNameFromEnv()).toBeNull()
    } finally {
      if (had) process.env.TENANT_TABLE = before
      else delete process.env.TENANT_TABLE
    }
  })
})

/* ------------------------------------------- independent degradation -- */

describe("one denied sub-call degrades one field, not the whole row", () => {
  test("a refused DescribeContinuousBackups leaves billing, size and TTL intact", async () => {
    const tables = healthyEstate()
    tables[1] = { ...tables[1], pitrFailWith: "AccessDeniedException" }
    const readings = await load({ tables })
    if (readings.tables.state !== "ACTUAL") throw new Error("narrowing")
    const sessions = readings.tables.value.find((t) => t.name === "tenure-studio-prod-sessions")

    expect(sessions?.detail.state).toBe("ACTUAL")
    expect(sessions?.ttl.state).toBe("ACTUAL")
    expect(sessions?.backups.state).toBe("DENIED")
    if (sessions?.backups.state !== "DENIED") throw new Error("narrowing")

    // The whole reason the capabilities are read separately: granting
    // dynamodb:ListTables would not have fixed this, and a denial naming it
    // would have sent an operator to grant an action they already hold.
    expect(sessions.backups.action).toBe("dynamodb:DescribeContinuousBackups")
    expect(sessions.backups.minimumStatement).toContain("dynamodb:DescribeContinuousBackups")
    expect(sessions.backups.minimumStatement).not.toContain("dynamodb:ListTables")

    const line = dynamodbLines(readings).find((l) => l.label === "tenure-studio-prod-sessions")
    expect(line?.text).toContain("12004 item(s)")
    expect(line?.text).toContain("TTL ENABLED on expiresAt")
    expect(line?.text).toContain("refused dynamodb:DescribeContinuousBackups")
    // And it must NOT read as a reassuring default.
    expect(line?.text).not.toContain("point-in-time recovery ON")
    expect(line?.text).not.toContain("point-in-time recovery OFF")
  })

  test("a refused DescribeTable leaves PITR and TTL readable and names its own action", async () => {
    const tables = healthyEstate()
    tables[1] = { ...tables[1], describeFailWith: "AccessDeniedException" }
    const readings = await load({ tables })
    if (readings.tables.state !== "ACTUAL") throw new Error("narrowing")
    const sessions = readings.tables.value.find((t) => t.name === "tenure-studio-prod-sessions")
    expect(sessions?.detail.state).toBe("DENIED")
    expect(sessions?.backups.state).toBe("ACTUAL")
    expect(sessions?.ttl.state).toBe("ACTUAL")
    if (sessions?.detail.state !== "DENIED") throw new Error("narrowing")
    expect(sessions.detail.action).toBe("dynamodb:DescribeTable")

    const line = dynamodbLines(readings).find((l) => l.label === "tenure-studio-prod-sessions")
    expect(line?.text).toContain("refused dynamodb:DescribeTable")
    expect(line?.text).toContain("point-in-time recovery OFF")
    // No configuration is invented for a table whose configuration was refused.
    expect(line?.text).not.toContain("item(s),")
    expect(line?.text).not.toContain("deletion protection")
  })

  test("a throttled DescribeTimeToLive is throttled — not 'nothing expires here'", async () => {
    const tables = healthyEstate()
    tables[1] = { ...tables[1], ttlFailWith: "ThrottlingException" }
    const readings = await load({ tables })
    if (readings.tables.state !== "ACTUAL") throw new Error("narrowing")
    const sessions = readings.tables.value.find((t) => t.name === "tenure-studio-prod-sessions")
    expect(sessions?.ttl.state).toBe("THROTTLED")
    expect(sessions?.detail.state).toBe("ACTUAL")
    const line = dynamodbLines(readings).find((l) => l.label === "tenure-studio-prod-sessions")
    expect(line?.text).toContain("throttled")
    expect(line?.text).not.toContain("nothing here expires on a timer")
  })

  test("a missing ItemCount is an ERROR, never a zero", async () => {
    const tables: TableFixture[] = [
      {
        name: "broken",
        table: {
          TableName: "broken",
          TableArn: tableArn("broken"),
          // ItemCount deliberately absent.
          TableSizeBytes: 10,
        },
      },
    ]
    const readings = await load({ tables }, null)
    if (readings.tables.state !== "ACTUAL") throw new Error("narrowing")
    const table = readings.tables.value[0]
    expect(table.detail.state).toBe("ERROR")
    if (table.detail.state !== "ERROR") throw new Error("narrowing")
    expect(table.detail.safeDetail).toContain("ItemCount")
    expect(dynamodbLines(readings).find((l) => l.label === "broken")?.text).not.toContain("0 item(s)")
  })

  test("tables past the describe cap say they were not read — and the registry is never one of them", async () => {
    // The registry is named so it sorts LAST. If the budget were taken in
    // alphabetical order it would fall outside it, and the one panel whose job
    // is to report on the registry would report that it did not look.
    const tables: TableFixture[] = []
    for (let i = 0; i < MAX_TABLE_DETAIL_READS + 5; i += 1) {
      const name = `aaa-bulk-${String(i).padStart(4, "0")}`
      tables.push({
        name,
        table: { TableName: name, TableArn: tableArn(name), ItemCount: 0, TableSizeBytes: 0 },
      })
    }
    tables.push({ name: "zzz-registry", table: registryTable({ TableName: "zzz-registry", TableArn: tableArn("zzz-registry") }), pitr: "enabled" })

    const readings = await load({ tables }, "zzz-registry")
    if (readings.tables.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.tables.value).toHaveLength(MAX_TABLE_DETAIL_READS + 6)

    const registry = readings.tables.value.find((t) => t.name === "zzz-registry")
    expect(registry?.detail.state).toBe("ACTUAL")
    expect(registry?.backups.state).toBe("ACTUAL")
    expect(readings.registry.kind).toBe("protected")

    const last = readings.tables.value.find(
      (t) => t.name === `aaa-bulk-${String(MAX_TABLE_DETAIL_READS + 4).padStart(4, "0")}`,
    )
    expect(last?.detail.state).toBe("UNCONFIGURED")
    expect(last?.backups.state).toBe("UNCONFIGURED")
    if (last?.backups.state !== "UNCONFIGURED") throw new Error("narrowing")
    expect(last.backups.why).toContain("not the same as its being unprotected")
  })
})

/* ------------------------------------------------------------ pagination -- */

describe("the listing is walked to completion, with a bound and an explicit 'there were more'", () => {
  test("a listing that never ends is TRUNCATED, and says so as its own line", async () => {
    const readings = await load({ listNeverEnds: true }, null)
    expect(readings.more.kind).toBe("truncated")
    if (readings.more.kind !== "truncated") throw new Error("narrowing")
    expect(readings.more.pagesRead).toBe(MAX_LIST_PAGES)
    expect(readings.more.namesRead).toBe(MAX_LIST_PAGES)
    expect(readings.more.resumeAfter).toBe(`page-${MAX_LIST_PAGES}`)

    const line = dynamodbLines(readings).find((l) => l.label === "Completeness")
    expect(line?.text).toContain("TRUNCATED")
    expect(line?.text).toContain("NOT the estate")
    expect(line?.text).not.toContain("every table in this region")
  })

  test("a listing that ends says so, and that is a different sentence", async () => {
    const readings = await load()
    expect(readings.more).toEqual({ kind: "complete" })
    const line = dynamodbLines(readings).find((l) => l.label === "Completeness")
    expect(line?.text).toContain("every table in this region")
    expect(line?.text).not.toContain("TRUNCATED")
  })

  test("names are walked across pages, deduplicated and sorted", async () => {
    const calls: string[] = []
    const readings = await load({ calls })
    expect(calls.filter((c) => c === "dynamodb:ListTables")).toHaveLength(1)
    if (readings.tables.state !== "ACTUAL") throw new Error("narrowing")
    const names = readings.tables.value.map((t) => t.name)
    expect(names).toEqual([...names].sort())
  })
})

/* -------------------------------------------------------------- encryption -- */

describe("encryption tells the AWS-owned default from a key in this account", () => {
  test("no SSEDescription is the AWS-owned default — a fact, not a gap", async () => {
    const tables: TableFixture[] = [
      {
        name: "plain",
        table: {
          TableName: "plain",
          TableArn: tableArn("plain"),
          ItemCount: 3,
          TableSizeBytes: 100,
          // SSEDescription deliberately absent, which is how DynamoDB reports it.
        },
      },
    ]
    const readings = await load({ tables }, null)
    if (readings.tables.state !== "ACTUAL") throw new Error("narrowing")
    const table = readings.tables.value[0]
    if (table.detail.state !== "ACTUAL") throw new Error("narrowing")
    expect(table.detail.value.encryption.kind).toBe("aws-owned-default")
    // No key exists to describe, so no DescribeKey was made and the field says why.
    expect(table.keyManagement.state).toBe("UNCONFIGURED")
    const text = surfaceText(readings)
    expect(text).toContain("AWS-owned default key")
    expect(text).toContain("nothing to revoke")
    expect(text).not.toContain("encryption unknown")
  })

  test("a customer-managed key is named as one, from KeyManager and not from the ARN", async () => {
    const tables = healthyEstate()
    tables[0] = {
      ...tables[0],
      table: registryTable({
        SSEDescription: { Status: "ENABLED", SSEType: "KMS", KMSMasterKeyArn: CMK_ARN },
      }),
    }
    const readings = await load({
      tables,
      keys: { [CMK_ARN]: { KeyManager: "CUSTOMER", KeyState: "Enabled" } },
    })
    if (readings.tables.state !== "ACTUAL") throw new Error("narrowing")
    const registry = readings.tables.value.find((t) => t.name === REGISTRY)
    expect(registry?.keyManagement.state).toBe("ACTUAL")
    if (registry?.keyManagement.state !== "ACTUAL") throw new Error("narrowing")
    expect(registry.keyManagement.value.manager).toBe("CUSTOMER")
    expect(surfaceText(readings)).toContain("a CUSTOMER-MANAGED key")
  })

  test("the AWS-managed alias/aws/dynamodb key is NOT reported as customer-managed", async () => {
    const readings = await load({
      keys: { [AWS_MANAGED_KEY_ARN]: { KeyManager: "AWS", KeyState: "Enabled" } },
    })
    // Scoped to the registry's own row: the other table in this estate really
    // does use the AWS-owned default, and asserting over the whole surface
    // would be asserting about the wrong table.
    const line = dynamodbLines(readings).find((l) => l.label === REGISTRY)
    expect(line?.text).toContain("an AWS-managed key (alias/aws/dynamodb)")
    expect(line?.text).not.toContain("a CUSTOMER-MANAGED key")
    // And it is not the AWS-OWNED default either — those are different keys and
    // different facts, and only one of them is in this account.
    expect(line?.text).not.toContain("AWS-owned default key —")
  })

  test("a refused kms:DescribeKey leaves the key named and its management unknown", async () => {
    const readings = await load({ keysFailWith: "AccessDeniedException" })
    if (readings.tables.state !== "ACTUAL") throw new Error("narrowing")
    const registry = readings.tables.value.find((t) => t.name === REGISTRY)
    expect(registry?.keyManagement.state).toBe("DENIED")
    if (registry?.keyManagement.state !== "DENIED") throw new Error("narrowing")
    expect(registry.keyManagement.action).toBe("kms:DescribeKey")
    const text = surfaceText(readings)
    expect(text).toContain(AWS_MANAGED_KEY_ARN)
    expect(text).toContain("whether it is customer-managed is unknown")
    expect(text).not.toContain("a CUSTOMER-MANAGED key")
    // The table's other facts survive a denied fifth call.
    expect(text).toContain("41 item(s)")
  })

  test("a key scheduled for deletion is called out on the registry itself", async () => {
    const tables = healthyEstate()
    tables[0] = {
      ...tables[0],
      table: registryTable({
        SSEDescription: { Status: "ENABLED", SSEType: "KMS", KMSMasterKeyArn: CMK_ARN },
      }),
    }
    const readings = await load({
      tables,
      keys: {
        [CMK_ARN]: {
          KeyManager: "CUSTOMER",
          KeyState: "PendingDeletion",
          DeletionDate: 1_760_000_000,
        },
      },
    })
    if (readings.registry.kind !== "protected") throw new Error("narrowing")
    expect(readings.registry.weaknesses.join(" ")).toContain("scheduled for deletion")
    expect(surfaceText(readings)).toContain("SCHEDULED FOR DELETION")
  })

  test("an inaccessible key is an incident, not a posture note", async () => {
    const tables = healthyEstate()
    tables[0] = {
      ...tables[0],
      table: registryTable({
        SSEDescription: {
          Status: "INACCESSIBLE_ENCRYPTION_CREDENTIALS",
          KMSMasterKeyArn: CMK_ARN,
          InaccessibleEncryptionDateTime: new Date("2026-08-12T00:00:00.000Z"),
        },
      }),
    }
    const readings = await load({ tables, keys: { [CMK_ARN]: { KeyManager: "CUSTOMER", KeyState: "Disabled" } } })
    const text = surfaceText(readings)
    expect(text).toContain("ENCRYPTION KEY UNREACHABLE")
    expect(text).toContain("cannot be read at all")
    if (readings.registry.kind !== "protected") throw new Error("narrowing")
    expect(readings.registry.weaknesses.join(" ")).toContain("encryption key is unreachable")
  })

  test("one DescribeKey per distinct key, not one per table", async () => {
    const calls: string[] = []
    const tables = healthyEstate()
    // Both tables on the same key, which is what alias/aws/dynamodb looks like.
    tables[1] = {
      ...tables[1],
      table: sessionsTable({
        SSEDescription: { Status: "ENABLED", SSEType: "KMS", KMSMasterKeyArn: AWS_MANAGED_KEY_ARN },
      }),
    }
    await load({ tables, calls })
    expect(calls.filter((c) => c === "kms:DescribeKey")).toHaveLength(1)
    expect(MAX_KEY_DESCRIBE_READS).toBeGreaterThan(0)
  })
})

/* ------------------------------------------------ residency and attribution -- */

describe("region and partition come from the resolved identity, never a literal", () => {
  test("a GovCloud identity produces GovCloud ARNs and no us-east-1 anywhere", async () => {
    // The GE-010-007 shape: a hardcoded us-east-1 or a partition guessed as
    // "aws" would place these tables in the wrong partition on a page an
    // operator uses to decide where data lives.
    const readings = await tableReadings(
      fakeAws({
        identity: {
          arn: `arn:aws-us-gov:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
          account: ACCOUNT,
          region: "us-gov-west-1",
        },
        tables: [{ name: "tenure-gov-tenants", describeFailWith: "AccessDeniedException", pitr: "enabled" }],
      }),
      { now: AT, registryTableName: "tenure-gov-tenants" },
    )
    if (readings.tables.state !== "ACTUAL") throw new Error("narrowing")
    const table = readings.tables.value[0]
    // The describe was refused, so the ARN had to be assembled — from identity.
    expect(table.arn).toBe(`arn:aws-us-gov:dynamodb:us-gov-west-1:${ACCOUNT}:table/tenure-gov-tenants`)
    expect(table.partition).toBe("aws-us-gov")
    expect(table.region).toBe("us-gov-west-1")
    expect(table.arnProvenance).toContain("resolved identity")
    expect(surfaceText(readings)).not.toContain("us-east-1")
  })

  test("with identity unresolved no ARN is invented and the surface says so", async () => {
    const readings = await load({
      identity: "denied",
      tables: [{ name: REGISTRY, describeFailWith: "AccessDeniedException", pitr: "enabled" }],
    })
    if (readings.tables.state !== "ACTUAL") throw new Error("narrowing")
    const table = readings.tables.value[0]
    expect(table.arn).toBeNull()
    expect(table.region).toBeNull()
    expect(table.partition).toBeNull()
    expect(table.attribution.kind).toBe("unknown")
    expect(surfaceText(readings)).toContain("region unknown")
  })

  test("AWS's own TableArn wins over anything this engine would assemble", async () => {
    const readings = await load()
    if (readings.tables.state !== "ACTUAL") throw new Error("narrowing")
    const registry = readings.tables.value.find((t) => t.name === REGISTRY)
    expect(registry?.arnProvenance).toContain("TableArn")
    expect(registry?.arn).toBe(tableArn(REGISTRY))
  })

  test("deriveTableArn refuses to guess when identity is not resolved", () => {
    expect(
      deriveTableArn(REGISTRY, {
        state: "UNCONFIGURED",
        capability: "sts:GetCallerIdentity",
        why: "no credentials",
      }),
    ).toBeNull()
  })
})

describe("attribution comes from the tag index, and 'we could not look' is its own answer", () => {
  test("a tenure:tenant tag attributes the table to that tenant", async () => {
    const readings = await load({ tags: { [tableArn(REGISTRY)]: tenantTags("simon-ose") } })
    if (readings.tables.state !== "ACTUAL") throw new Error("narrowing")
    const registry = readings.tables.value.find((t) => t.name === REGISTRY)
    expect(registry?.attribution).toEqual({ kind: "tenant", tenantSlug: "simon-ose" })
    expect(surfaceText(readings)).toContain("simon-ose")
  })

  test("the shared sentinel is shared, and an untagged table is unattributable — not the same", async () => {
    const readings = await load({
      tags: { [tableArn(REGISTRY)]: [{ Key: "tenure:tenant", Value: SHARED }] },
    })
    if (readings.tables.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.tables.value.find((t) => t.name === REGISTRY)?.attribution.kind).toBe("shared")
    expect(
      readings.tables.value.find((t) => t.name === "tenure-studio-prod-sessions")?.attribution.kind,
    ).toBe("unattributed")
    const text = surfaceText(readings)
    expect(text).toContain("shared — platform overhead")
    expect(text).toContain("unattributable — missing tenure:tenant")
  })

  test("a denied tag index makes attribution unknown, not unattributable", async () => {
    // "missing tenure:tenant" sends an operator to add a tag that is already there.
    const readings = await load({ tagsOutcome: "denied" })
    if (readings.tables.state !== "ACTUAL") throw new Error("narrowing")
    for (const table of readings.tables.value) expect(table.attribution.kind).toBe("unknown")
    const text = surfaceText(readings)
    expect(text).toContain("attribution unknown")
    expect(text).toContain("tag:GetResources")
    expect(text).not.toContain("missing tenure:tenant")
  })

  test("a throttled tag index is also unknown, and says throttled", async () => {
    const readings = await load({ tagsOutcome: "throttled" })
    if (readings.tables.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.tables.value[0].attribution.kind).toBe("unknown")
    expect(surfaceText(readings)).toContain("throttled")
  })
})

/* -------------------------------------------------- as-of, cadence, indexes -- */

describe("every reading carries when it was taken and how often it refreshes", () => {
  test("the load stamps an explicit asOf and every capability's own cadence", async () => {
    const readings = await load()
    expect(readings.asOf).toBe("2026-08-13T09:15:00.000Z")
    // Not numbers retyped here: these are the registry's declarations, so a
    // cadence changed in capabilities.ts changes what the surface promises.
    expect(readings.refreshMs.tables).toBe(300_000)
    expect(readings.refreshMs.detail).toBe(300_000)
    expect(readings.refreshMs.backups).toBe(300_000)
    expect(readings.refreshMs.ttl).toBe(300_000)
    expect(readings.refreshMs.keyManagement).toBeGreaterThan(0)
    if (readings.tables.state !== "ACTUAL") throw new Error("narrowing")
    for (const table of readings.tables.value) {
      expect(table.asOf).toBe("2026-08-13T09:15:00.000Z")
      expect(table.refreshMs).toBe(300_000)
    }
    const text = surfaceText(readings)
    expect(text).toContain("refreshed every 300s")
    expect(text).toContain("as of 2026-08-13T09:15:00.000Z")
  })

  test("item count and size carry their own six-hour staleness, beside a live as-of", async () => {
    const readings = await load()
    const text = surfaceText(readings)
    expect(text).toContain("approximately every six hours")
  })

  test("a global secondary index is rendered with its projection and backfill state", async () => {
    const readings = await load()
    const line = dynamodbLines(readings).find((l) => l.label === "tenure-studio-prod-sessions")
    expect(line?.text).toContain("by-user [userId (HASH)] ACTIVE, projection KEYS_ONLY")
    expect(line?.text).toContain("2 RCU / 2 WCU")
    expect(dynamodbLines(readings).find((l) => l.label === REGISTRY)?.text).toContain(
      "no global secondary index",
    )
  })

  test("a backfilling index says so — it does not yet answer for every item", async () => {
    const tables = healthyEstate()
    tables[1] = {
      ...tables[1],
      table: sessionsTable({
        GlobalSecondaryIndexes: [
          {
            IndexName: "by-user",
            IndexStatus: "CREATING",
            Backfilling: true,
            KeySchema: [{ AttributeName: "userId", KeyType: "HASH" }],
            Projection: { ProjectionType: "INCLUDE", NonKeyAttributes: ["email", "createdAt"] },
          },
        ],
      }),
    }
    const readings = await load({ tables })
    const line = dynamodbLines(readings).find((l) => l.label === "tenure-studio-prod-sessions")
    expect(line?.text).toContain("BACKFILLING")
    expect(line?.text).toContain("projection INCLUDE(createdAt, email)")
    expect(line?.text).toContain("item count not stated by AWS")
  })
})

/* ------------------------------------------------------------- the parsers -- */

describe("an absent field is never a finding, and a stated one is never softened", () => {
  test("deletion protection: true, false and absent are three answers", () => {
    expect(parseDeletionProtection(true)).toEqual({ kind: "enabled" })
    expect(parseDeletionProtection(false)).toEqual({ kind: "disabled" })
    expect(parseDeletionProtection(undefined).kind).toBe("unstated")
  })

  test("billing mode distinguishes on-demand, stated provisioned and inferred provisioned", () => {
    expect(parseBillingMode({ BillingModeSummary: { BillingMode: "PAY_PER_REQUEST" } })).toEqual({
      kind: "on-demand",
    })
    expect(
      parseBillingMode({
        BillingModeSummary: { BillingMode: "PROVISIONED" },
        ProvisionedThroughput: { ReadCapacityUnits: 10, WriteCapacityUnits: 4 },
      }),
    ).toEqual({ kind: "provisioned", readCapacityUnits: 10, writeCapacityUnits: 4, stated: true })
    // No BillingModeSummary at all: a legacy provisioned table. Inferred, and
    // marked as inferred rather than reported as a choice somebody made.
    expect(
      parseBillingMode({ ProvisionedThroughput: { ReadCapacityUnits: 1, WriteCapacityUnits: 1 } }),
    ).toEqual({ kind: "provisioned", readCapacityUnits: 1, writeCapacityUnits: 1, stated: false })
    expect(parseBillingMode({}).kind).toBe("unstated")
  })

  test("PITR: enabled, disabled and 'AWS said nothing' are three answers", () => {
    expect(
      parsePointInTimeRecovery({
        ContinuousBackupsStatus: "ENABLED",
        PointInTimeRecoveryDescription: { PointInTimeRecoveryStatus: "ENABLED", RecoveryPeriodInDays: 35 },
      }).kind,
    ).toBe("enabled")
    expect(
      parsePointInTimeRecovery({
        PointInTimeRecoveryDescription: { PointInTimeRecoveryStatus: "DISABLED" },
      }).kind,
    ).toBe("disabled")
    expect(parsePointInTimeRecovery(undefined).kind).toBe("unstated")
    expect(parsePointInTimeRecovery({ ContinuousBackupsStatus: "ENABLED" }).kind).toBe("unstated")
  })

  test("TTL: enabled names the attribute, and an unnamed attribute is unstated not enabled", () => {
    expect(parseTimeToLive({ TimeToLiveStatus: "ENABLED", AttributeName: "expiresAt" })).toEqual({
      kind: "enabled",
      attributeName: "expiresAt",
      status: "ENABLED",
    })
    expect(parseTimeToLive({ TimeToLiveStatus: "DISABLED" }).kind).toBe("disabled")
    expect(parseTimeToLive({ TimeToLiveStatus: "ENABLED" }).kind).toBe("unstated")
    expect(parseTimeToLive(undefined).kind).toBe("unstated")
  })

  test("encryption: absent is the AWS-owned default, and an unreadable SSEDescription is not", () => {
    expect(parseEncryption(undefined).kind).toBe("aws-owned-default")
    expect(parseEncryption({ Status: "ENABLED", KMSMasterKeyArn: CMK_ARN })).toEqual({
      kind: "kms",
      keyArn: CMK_ARN,
      status: "ENABLED",
    })
    // Present, and says nothing this engine can read. NOT folded into the default.
    expect(parseEncryption({ Status: "ENABLED" }).kind).toBe("unstated")
  })

  test("epoch seconds are seconds — a 2025 table is not created in 1970", () => {
    expect(isoOf(1_753_920_000)).toBe("2025-07-31T00:00:00.000Z")
    expect(isoOf(new Date("2026-08-13T09:15:00.000Z"))).toBe("2026-08-13T09:15:00.000Z")
    expect(isoOf("2026-08-13T09:15:00.000Z")).toBe("2026-08-13T09:15:00.000Z")
    expect(isoOf(undefined)).toBeNull()
    expect(isoOf("not a date")).toBeNull()
  })
})
