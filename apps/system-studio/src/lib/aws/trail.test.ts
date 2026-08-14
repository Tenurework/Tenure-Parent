import { __resetIdentity } from "./identity"
import type { AwsGateway } from "./read"
import {
  ABSOLUTE_MAX_EVENTS,
  DELIVERY_OVERDUE_AFTER_MS,
  MAX_LOOKUP_PAGES,
  eventLines,
  lookupManagementEvents,
  trailLines,
  trailReadings,
  type EventLookup,
  type TrailReadings,
} from "./trail"

/**
 * STUDIO-070-004 (CloudTrail) — the audit surface tells four different truths
 * apart, and tells "configured" apart from "logging".
 *
 * The assertions are on `trailReadings`, `lookupManagementEvents`, `trailLines`
 * and `eventLines` — the functions a surface renders — rather than on `readAws`
 * or on a parser. A test that drove `readAws` directly would stay green on the
 * day this module stopped calling it, which is the failure this programme has
 * already paid for twice.
 *
 * ## The stand-in is a client, not a stub
 *
 * `fakeAws` answers five capabilities with the shapes the real SDK returns —
 * `{trailList: [...]}` from DescribeTrails, `{IsLogging, LatestDeliveryTime,
 * LatestDeliveryError, ...}` from GetTrailStatus, `{Events, NextToken}` from
 * LookupEvents, `{ResourceTagMappingList}` from the Tagging API and
 * `{Account, Arn}` from STS — and it can fail each of them independently with
 * `AccessDeniedException`, `ThrottlingException`, an empty-but-successful
 * answer, or a populated one. A stand-in that returned `[]` regardless of what
 * was asked would prove nothing about code whose entire job is telling those
 * four apart, and it is the fake this repository has already been burnt by.
 *
 * Timestamps come back as `Date` objects and `ReadOnly` comes back as the
 * STRING "true", because that is what the SDK hands over. A fake that returned
 * ISO strings and booleans would have hidden two conversions the parser has to
 * perform.
 *
 * ## Every identifier here is obviously constructed
 *
 * The account is `123456789012` — the documentation placeholder — and no ARN,
 * bucket or key id in this file names a real resource. Nothing in this suite
 * opens a socket.
 */

/* ------------------------------------------------------------- the estate -- */

const ACCOUNT = "123456789012"
const HOME_REGION = "eu-west-2"
const OTHER_REGION = "us-east-1"

function trailArn(region: string, name: string): string {
  return `arn:aws:cloudtrail:${region}:${ACCOUNT}:trail/${name}`
}

const ORG_TRAIL = "tenure-org-trail"
const LEGACY_TRAIL = "tenure-legacy-trail"
const ORG_ARN = trailArn(HOME_REGION, ORG_TRAIL)
const LEGACY_ARN = trailArn(OTHER_REGION, LEGACY_TRAIL)

const KMS_KEY = `arn:aws:kms:${HOME_REGION}:${ACCOUNT}:key/00000000-0000-4000-8000-000000000000`

/** The DescribeTrails shape AWS returns, for the well-configured trail. */
function orgTrail(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Name: ORG_TRAIL,
    TrailARN: ORG_ARN,
    HomeRegion: HOME_REGION,
    S3BucketName: "tenure-audit-logs",
    S3KeyPrefix: "prod",
    KmsKeyId: KMS_KEY,
    IncludeGlobalServiceEvents: true,
    IsMultiRegionTrail: true,
    IsOrganizationTrail: true,
    LogFileValidationEnabled: true,
    ...overrides,
  }
}

/** A single-region trail homed elsewhere: a shadow, with validation off. */
function legacyTrail(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Name: LEGACY_TRAIL,
    TrailARN: LEGACY_ARN,
    HomeRegion: OTHER_REGION,
    S3BucketName: "tenure-legacy-logs",
    IncludeGlobalServiceEvents: false,
    IsMultiRegionTrail: false,
    IsOrganizationTrail: false,
    LogFileValidationEnabled: false,
    ...overrides,
  }
}

const AT = () => new Date("2026-08-13T09:15:00.000Z")
const NOW_MS = AT().getTime()

/** A GetTrailStatus answer for a trail that is logging and delivering. */
function healthyStatus(): Record<string, unknown> {
  return {
    IsLogging: true,
    LatestDeliveryTime: new Date(NOW_MS - 4 * 60_000),
    LatestDigestDeliveryTime: new Date(NOW_MS - 6 * 60_000),
    StartLoggingTime: new Date(NOW_MS - 90 * 24 * 3_600_000),
  }
}

/** The trail somebody stopped. It describes IDENTICALLY to the healthy one. */
function stoppedStatus(): Record<string, unknown> {
  return {
    IsLogging: false,
    LatestDeliveryTime: new Date(NOW_MS - 21 * 24 * 3_600_000),
    StartLoggingTime: new Date(NOW_MS - 400 * 24 * 3_600_000),
    StopLoggingTime: new Date(NOW_MS - 21 * 24 * 3_600_000),
  }
}

/** Logging, and every write to the bucket is being refused. */
function failingStatus(): Record<string, unknown> {
  return {
    IsLogging: true,
    LatestDeliveryTime: new Date(NOW_MS - 21 * 24 * 3_600_000),
    LatestDeliveryError:
      "AccessDenied. The bucket policy on tenure-audit-logs denies s3:PutObject to CloudTrail.",
    StartLoggingTime: new Date(NOW_MS - 400 * 24 * 3_600_000),
  }
}

/** Logging, no error stated, and nothing delivered for well past the threshold. */
function overdueStatus(): Record<string, unknown> {
  return {
    IsLogging: true,
    LatestDeliveryTime: new Date(NOW_MS - (DELIVERY_OVERDUE_AFTER_MS + 3_600_000)),
    StartLoggingTime: new Date(NOW_MS - 400 * 24 * 3_600_000),
  }
}

/* ------------------------------------------------------------- the client -- */

type Outcome = "populated" | "empty" | "denied" | "throttled"

interface EventPage {
  Events: Record<string, unknown>[]
  NextToken?: string
}

interface FakeOptions {
  /** How `cloudtrail:DescribeTrails` behaves. The four cases this suite separates. */
  describeTrails?: Outcome
  trails?: Record<string, unknown>[]
  /** Keyed by the handle the module passes as `Name` — the ARN, or the name. */
  statuses?: Record<string, Record<string, unknown> | { failWith: string }>
  lookupEvents?: Outcome
  /** Pages returned in order; the fake follows its own NextToken between them. */
  eventPages?: EventPage[]
  tags?: Record<string, Array<{ Key: string; Value: string }>>
  tagsOutcome?: Outcome
  identity?: { arn: string; account: string; region: string } | "denied"
  /** Set by the fake so a test can assert what was and was not called. */
  calls?: string[]
  /** Every input the fake was handed, so a test can assert what was SENT. */
  inputs?: Record<string, unknown>[]
}

function throwing(name: string): never {
  const error = new Error(`${name} raised by the stand-in AWS client`)
  error.name = name
  throw error
}

function fakeAws(options: FakeOptions = {}): AwsGateway {
  const describeOutcome = options.describeTrails ?? "populated"
  const trails = options.trails ?? [orgTrail(), legacyTrail()]
  const statuses = options.statuses ?? {
    [ORG_ARN]: healthyStatus(),
    [LEGACY_ARN]: healthyStatus(),
  }
  const identity = options.identity ?? {
    arn: `arn:aws:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
    account: ACCOUNT,
    region: HOME_REGION,
  }
  const calls = options.calls ?? []
  const inputs = options.inputs ?? []

  return {
    async call(capability, input) {
      calls.push(String(capability))
      if (input) inputs.push({ capability: String(capability), ...input })

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

        case "cloudtrail:DescribeTrails":
          if (describeOutcome === "denied") throwing("AccessDeniedException")
          if (describeOutcome === "throttled") throwing("ThrottlingException")
          // The real API returns `trailList: []` when there are none.
          if (describeOutcome === "empty") return { trailList: [] }
          return { trailList: trails }

        case "cloudtrail:GetTrailStatus": {
          const name = String((input as { Name?: unknown } | undefined)?.Name ?? "")
          const fixture = statuses[name]
          if (!fixture) throwing("TrailNotFoundException")
          if ("failWith" in fixture) throwing(String(fixture.failWith))
          return fixture
        }

        case "cloudtrail:LookupEvents": {
          const outcome = options.lookupEvents ?? "populated"
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          // The real API returns `Events: []` for a window with nothing in it.
          if (outcome === "empty") return { Events: [] }
          const pages = options.eventPages ?? [{ Events: [managementEvent()] }]
          const token = (input as { NextToken?: unknown } | undefined)?.NextToken
          const index =
            typeof token === "string" ? pages.findIndex((p, i) => i > 0 && pageToken(i) === token) : 0
          const page = pages[index === -1 ? 0 : index]
          return { Events: page.Events, NextToken: page.NextToken }
        }

        default:
          throw new Error(
            `the stand-in was asked for ${String(capability)}, which this suite does not exercise`,
          )
      }
    },
    async resolvedRegion() {
      return identity === "denied" ? HOME_REGION : identity.region
    },
  }
}

function pageToken(index: number): string {
  return `page-${index}`
}

/**
 * One LookupEvents result, in the shape the API returns it: top-level fields
 * plus `CloudTrailEvent`, which is a JSON STRING and not an object.
 *
 * The blob deliberately carries `requestParameters` and `responseElements`,
 * because the assertion that matters is that they do NOT come out the other end.
 */
function managementEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const eventName = String(overrides.EventName ?? "ModifyDBInstance")
  return {
    EventId: String(overrides.EventId ?? "11111111-2222-4333-8444-555555555555"),
    EventName: eventName,
    EventTime: new Date(NOW_MS - 3_600_000),
    EventSource: "rds.amazonaws.com",
    Username: "deploy-pipeline",
    ReadOnly: "false",
    Resources: [{ ResourceType: "AWS::RDS::DBInstance", ResourceName: "tenure-prod" }],
    CloudTrailEvent: JSON.stringify({
      eventVersion: "1.09",
      userIdentity: {
        type: "AssumedRole",
        arn: `arn:aws:sts::${ACCOUNT}:assumed-role/tenure-deploy/ci`,
      },
      awsRegion: HOME_REGION,
      sourceIPAddress: "203.0.113.7",
      requestParameters: {
        masterUserPassword: "a-secret-that-must-not-be-rendered",
        studentEmail: "learner@example.edu",
      },
      responseElements: { dBInstanceArn: "arn:aws:rds:::db:tenure-prod" },
    }),
    ...overrides,
  }
}

async function load(options: FakeOptions = {}): Promise<TrailReadings> {
  return trailReadings(fakeAws(options), { now: AT })
}

async function lookup(
  query: Parameters<typeof lookupManagementEvents>[0],
  options: FakeOptions = {},
): Promise<EventLookup> {
  return lookupManagementEvents(query, fakeAws(options), { now: AT })
}

/** The whole surface as one string, which is what an operator actually reads. */
function surfaceText(readings: TrailReadings): string {
  return trailLines(readings)
    .map((line) => `${line.label}: ${line.text}`)
    .join("\n")
}

function lookupText(result: EventLookup): string {
  return eventLines(result)
    .map((line) => `${line.label}: ${line.text}`)
    .join("\n")
}

const DAY = 24 * 3_600_000
const WINDOW = {
  startTime: new Date(NOW_MS - 7 * DAY),
  endTime: new Date(NOW_MS),
}

beforeEach(() => {
  // resolveIdentity caches per process. Every case here supplies its own
  // gateway, which bypasses the cache, but a stale cache from another suite
  // would silently make these assertions test the wrong identity.
  __resetIdentity()
})

/* ------------------------------ the four outcomes of the trail listing --- */

describe("the trail listing says something different for each of the four outcomes", () => {
  test("a populated list is ACTUAL and names every trail", async () => {
    const readings = await load()
    expect(readings.trails.state).toBe("ACTUAL")
    if (readings.trails.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.trails.value).toHaveLength(2)
    const text = surfaceText(readings)
    expect(text).toContain(ORG_TRAIL)
    expect(text).toContain(LEGACY_TRAIL)
    expect(text).toContain("LOGGING")
  })

  test("an empty-but-successful list is EMPTY and says none, not refused", async () => {
    const readings = await load({ describeTrails: "empty" })
    expect(readings.trails.state).toBe("EMPTY")
    expect(readings.delivery.kind).toBe("no-trails")
    const text = surfaceText(readings)
    expect(text).toContain("none —")
    expect(text).toContain("NO TRAIL")
    expect(text).not.toContain("Minimum statement")
  })

  test("AccessDenied is DENIED, carries the principal, the action and a pasteable statement", async () => {
    const readings = await load({ describeTrails: "denied" })
    expect(readings.trails.state).toBe("DENIED")
    if (readings.trails.state !== "DENIED") throw new Error("narrowing")

    expect(readings.trails.action).toBe("cloudtrail:DescribeTrails")
    expect(readings.trails.principal).toContain("assumed-role/tenure-studio-task")
    expect(readings.trails.accountId).toBe(ACCOUNT)
    expect(readings.trails.region).toBe(HOME_REGION)
    expect(readings.trails.partition).toBe("aws")
    expect(JSON.parse(readings.trails.minimumStatement)).toEqual({
      Effect: "Allow",
      Action: ["cloudtrail:DescribeTrails"],
      Resource: "*",
    })

    // And the thing it must NOT be. There is no `value` on this arm at all, so a
    // caller cannot reach an empty array; the render says "unknown".
    expect("value" in readings.trails).toBe(false)
    expect(readings.delivery.kind).toBe("unknown")
    const text = surfaceText(readings)
    expect(text).toContain("unknown")
    expect(text).not.toContain("NO TRAIL")
    expect(text).not.toMatch(/\bnone\b/)
  })

  test("a throttle is THROTTLED — its own state, not a failure and not an empty list", async () => {
    const readings = await load({ describeTrails: "throttled" })
    expect(readings.trails.state).toBe("THROTTLED")
    if (readings.trails.state !== "THROTTLED") throw new Error("narrowing")
    // The schedule is throttle.ts's — 200ms after the first failure, doubling —
    // not a number retyped in this module.
    expect(readings.trails.retryAfterMs).toBe(800)
    expect(readings.delivery.kind).toBe("unknown")
    const text = surfaceText(readings)
    expect(text).toContain("throttled")
    expect(text).toContain("retrying in")
    expect(text).not.toContain("Minimum statement")
    expect(text).not.toContain("NO TRAIL")
  })

  test("the four render as four visibly different surfaces", async () => {
    const texts: string[] = []
    for (const outcome of ["populated", "empty", "denied", "throttled"] as const) {
      __resetIdentity()
      texts.push(surfaceText(await load({ describeTrails: outcome })))
    }
    expect(new Set(texts).size).toBe(4)
    for (const text of texts) expect(text.length).toBeGreaterThan(0)
  })
})

/* -------------------- configured is not logging, the whole point of this -- */

describe("a stopped trail does not describe like a healthy one", () => {
  test("IsLogging false is NOT LOGGING and the estate reads not-logging", async () => {
    const readings = await load({
      trails: [orgTrail()],
      statuses: { [ORG_ARN]: stoppedStatus() },
    })
    expect(readings.delivery.kind).toBe("not-logging")
    if (readings.delivery.kind !== "not-logging") throw new Error("narrowing")
    expect(readings.delivery.stopped).toEqual([ORG_TRAIL])

    const text = surfaceText(readings)
    expect(text).toContain("NOT LOGGING")
    expect(text).toContain("2026-07-23T09:15:00.000Z") // when it stopped, from AWS
    // The configuration is identical to the healthy case, and it must not be the
    // thing the surface leads with.
    expect(text).not.toContain("logging and delivering")
  })

  test("the SAME configuration reads healthy or stopped purely from GetTrailStatus", async () => {
    const healthy = surfaceText(
      await load({ trails: [orgTrail()], statuses: { [ORG_ARN]: healthyStatus() } }),
    )
    __resetIdentity()
    const stopped = surfaceText(
      await load({ trails: [orgTrail()], statuses: { [ORG_ARN]: stoppedStatus() } }),
    )
    expect(healthy).not.toEqual(stopped)
    expect(healthy).toContain("LOGGING —")
    expect(stopped).toContain("NOT LOGGING")
    // Both carry the identical DescribeTrails facts. That is the defect this
    // module closes: DescribeTrails alone cannot tell these two apart.
    for (const text of [healthy, stopped]) {
      expect(text).toContain("multi-region")
      expect(text).toContain("log-file validation ON")
      expect(text).toContain("tenure-audit-logs")
    }
  })

  test("logging with a delivery error is its own state, not healthy and not stopped", async () => {
    const readings = await load({
      trails: [orgTrail()],
      statuses: { [ORG_ARN]: failingStatus() },
    })
    expect(readings.delivery.kind).toBe("delivery-failing")
    if (readings.delivery.kind !== "delivery-failing") throw new Error("narrowing")
    expect(readings.delivery.failures[0].name).toBe(ORG_TRAIL)
    expect(readings.delivery.failures[0].error).toContain("bucket policy")

    const text = surfaceText(readings)
    expect(text).toContain("LOGGING BUT NOT DELIVERING")
    expect(text).toContain("captured and lost")
    expect(text).not.toContain("NOT LOGGING —")
  })

  test("logging with nothing delivered inside the threshold is overdue, and says it is a prompt", async () => {
    const readings = await load({
      trails: [orgTrail()],
      statuses: { [ORG_ARN]: overdueStatus() },
    })
    expect(readings.delivery.kind).toBe("delivery-overdue")
    const text = surfaceText(readings)
    expect(text).toContain("DELIVERY OVERDUE")
    // Named as a suspicion, not a verdict. A threshold is a judgement and the
    // surface says so rather than accusing an idle account of being broken.
    expect(text).toContain("idle account")
  })

  test("the four logging states render as four visibly different sentences", async () => {
    const texts: string[] = []
    for (const status of [healthyStatus(), stoppedStatus(), failingStatus(), overdueStatus()]) {
      __resetIdentity()
      texts.push(
        surfaceText(await load({ trails: [orgTrail()], statuses: { [ORG_ARN]: status } })),
      )
    }
    expect(new Set(texts).size).toBe(4)
  })
})

/* ------------------------------------- sub-calls degrade independently --- */

describe("one refused status does not collapse the row, and does not read as healthy", () => {
  test("a denied GetTrailStatus names GetTrailStatus, not DescribeTrails", async () => {
    const readings = await load({
      statuses: {
        [ORG_ARN]: healthyStatus(),
        [LEGACY_ARN]: { failWith: "AccessDeniedException" },
      },
    })
    expect(readings.trails.state).toBe("ACTUAL")
    if (readings.trails.state !== "ACTUAL") throw new Error("narrowing")

    const [org, legacy] = readings.trails.value
    expect(org.status.state).toBe("ACTUAL")
    expect(legacy.status.state).toBe("DENIED")
    if (legacy.status.state !== "DENIED") throw new Error("narrowing")

    // The action in the pasteable statement is the one that is actually missing.
    // If this said DescribeTrails an operator would grant it, redeploy, and be
    // refused identically.
    expect(legacy.status.action).toBe("cloudtrail:GetTrailStatus")
    expect(JSON.parse(legacy.status.minimumStatement)).toEqual({
      Effect: "Allow",
      Action: ["cloudtrail:GetTrailStatus"],
      Resource: "arn:*:cloudtrail:*:*:trail/*",
    })

    // The row still exists, with its configuration intact, and reads as refused.
    const text = surfaceText(readings)
    expect(text).toContain(LEGACY_TRAIL)
    expect(text).toContain("log-file validation OFF")
    expect(text).toContain("cloudtrail:GetTrailStatus")
  })

  test("a healthy estate with one unreadable trail is qualified, never plain logging", async () => {
    const readings = await load({
      statuses: {
        [ORG_ARN]: healthyStatus(),
        [LEGACY_ARN]: { failWith: "AccessDeniedException" },
      },
    })
    expect(readings.delivery.kind).toBe("logging")
    if (readings.delivery.kind !== "logging") throw new Error("narrowing")
    expect(readings.delivery.trails).toEqual([ORG_TRAIL])
    expect(readings.delivery.unreadable).toEqual([LEGACY_TRAIL])
    expect(surfaceText(readings)).toContain("could not be read")
  })

  test("trails exist and no status answered is no-status, never logging", async () => {
    const readings = await load({
      statuses: {
        [ORG_ARN]: { failWith: "ThrottlingException" },
        [LEGACY_ARN]: { failWith: "AccessDeniedException" },
      },
    })
    expect(readings.delivery.kind).toBe("no-status")
    const text = surfaceText(readings)
    expect(text).toContain("unknown")
    expect(text).toContain("throttled")
    expect(text).toContain("Minimum statement")
    expect(text).not.toContain("NO TRAIL")
  })

  test("a status answer without IsLogging is ERROR, not a default", async () => {
    const readings = await load({
      trails: [orgTrail()],
      // A real fault: the field AWS always returns is missing. Defaulting it
      // either way would invent a trail state.
      statuses: { [ORG_ARN]: { LatestDeliveryTime: new Date(NOW_MS) } },
    })
    if (readings.trails.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.trails.value[0].status.state).toBe("ERROR")
    const text = surfaceText(readings)
    expect(text).toContain("IsLogging")
    expect(text).not.toContain("NOT LOGGING")
    expect(text).not.toContain("LOGGING —")
  })
})

/* ------------------------------------------- region, partition, shadows --- */

describe("region and partition come from the resolved identity and the ARN, never a literal", () => {
  test("a trail homed elsewhere reports ITS region, not the caller's", async () => {
    const readings = await load()
    if (readings.trails.state !== "ACTUAL") throw new Error("narrowing")
    const [org, legacy] = readings.trails.value

    expect(org.configuration.region).toBe(HOME_REGION)
    expect(org.configuration.partition).toBe("aws")
    expect(org.configuration.accountId).toBe(ACCOUNT)
    expect(org.configuration.isShadow).toBe(false)

    // The legacy trail's ARN says us-east-1 while this engine is calling from
    // eu-west-2. Reporting it under the caller's region would be a false claim
    // about where an audit log lives — the GE-010-007 shape of defect.
    expect(legacy.configuration.region).toBe(OTHER_REGION)
    expect(legacy.configuration.isShadow).toBe(true)
    expect(surfaceText(readings)).toContain("shadow replica")
  })

  test("a GovCloud partition is carried through, never flattened to aws", async () => {
    const govArn = `arn:aws-us-gov:cloudtrail:us-gov-west-1:${ACCOUNT}:trail/${ORG_TRAIL}`
    const readings = await load({
      identity: {
        arn: `arn:aws-us-gov:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
        account: ACCOUNT,
        region: "us-gov-west-1",
      },
      trails: [orgTrail({ TrailARN: govArn, HomeRegion: "us-gov-west-1" })],
      statuses: { [govArn]: healthyStatus() },
    })
    if (readings.trails.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.trails.value[0].configuration.partition).toBe("aws-us-gov")
    expect(surfaceText(readings)).toContain("partition aws-us-gov")
    expect(surfaceText(readings)).not.toContain("partition aws)")
  })

  test("identity denied leaves region unknown rather than guessed", async () => {
    const readings = await load({
      identity: "denied",
      trails: [orgTrail({ TrailARN: undefined })],
      statuses: { [ORG_TRAIL]: healthyStatus() },
    })
    if (readings.trails.state !== "ACTUAL") throw new Error("narrowing")
    const configuration = readings.trails.value[0].configuration
    expect(configuration.arn).toBeNull()
    expect(configuration.region).toBeNull()
    expect(configuration.partition).toBeNull()
    expect(configuration.isShadow).toBeNull()
    expect(surfaceText(readings)).toContain("region unknown")
  })

  test("the status read is addressed by ARN, because a shadow trail cannot be fetched by name", async () => {
    const inputs: Record<string, unknown>[] = []
    await trailReadings(fakeAws({ inputs }), { now: AT })
    const statusCalls = inputs.filter((i) => i.capability === "cloudtrail:GetTrailStatus")
    expect(statusCalls.map((i) => i.Name)).toEqual([ORG_ARN, LEGACY_ARN])
  })
})

/* ------------------------------------------------------------ attribution -- */

describe("attribution comes from a tag, and 'we could not look' is its own answer", () => {
  test("a tenant tag attributes the trail", async () => {
    const readings = await load({
      tags: { [ORG_ARN]: [{ Key: "tenure:tenant", Value: "northgate" }] },
    })
    if (readings.trails.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.trails.value[0].attribution).toEqual({ kind: "tenant", tenantSlug: "northgate" })
    expect(readings.trails.value[1].attribution).toEqual({ kind: "unattributed" })
    expect(surfaceText(readings)).toContain("northgate")
  })

  test("a denied tag index is 'unknown', not 'unattributable'", async () => {
    const readings = await load({ tagsOutcome: "denied" })
    if (readings.trails.state !== "ACTUAL") throw new Error("narrowing")
    const attribution = readings.trails.value[0].attribution
    expect(attribution.kind).toBe("unknown")
    const text = surfaceText(readings)
    expect(text).toContain("attribution unknown")
    // "unattributable — missing tenure:tenant" would send an operator to add a
    // tag that is probably already there.
    expect(text).not.toContain("missing tenure:tenant")
  })
})

/* --------------------------------------------- the as-of and the cadence -- */

test("every reading carries an explicit as-of and its capability's own refresh cadence", async () => {
  const readings = await load()
  expect(readings.asOf).toBe("2026-08-13T09:15:00.000Z")
  // Read from the registry, not retyped: DescribeTrails is posture cadence and
  // GetTrailStatus is its own, and a surface must not invent either.
  expect(readings.refreshMs.trails).toBe(3_600_000)
  expect(readings.refreshMs.status).toBe(300_000)
  expect(readings.refreshMs.events).toBe(60_000)
  if (readings.trails.state !== "ACTUAL") throw new Error("narrowing")
  expect(readings.trails.value[0].asOf).toBe(readings.asOf)
  expect(readings.trails.value[0].refreshMs).toBe(300_000)
  expect(surfaceText(readings)).toContain("refreshed every 300s")
})

/* --------------------------------------------------------- who changed it -- */

describe("LookupEvents says something different for each of the four outcomes", () => {
  test("a populated window returns management events with who, what and from where", async () => {
    const result = await lookup(WINDOW)
    expect(result.events.state).toBe("ACTUAL")
    if (result.events.state !== "ACTUAL") throw new Error("narrowing")
    const [event] = result.events.value
    expect(event.eventName).toBe("ModifyDBInstance")
    expect(event.principalArn).toContain("assumed-role/tenure-deploy")
    expect(event.principalType).toBe("AssumedRole")
    expect(event.sourceIpAddress).toBe("203.0.113.7")
    expect(event.awsRegion).toBe(HOME_REGION)
    // `ReadOnly` arrives as the STRING "false" and must not be truthy.
    expect(event.readOnly).toBe(false)
    expect(event.resources).toEqual([
      { type: "AWS::RDS::DBInstance", name: "tenure-prod" },
    ])
    expect(lookupText(result)).toContain("called ModifyDBInstance")
  })

  test("an empty-but-successful window is EMPTY and says none, not refused", async () => {
    const result = await lookup(WINDOW, { lookupEvents: "empty" })
    expect(result.events.state).toBe("EMPTY")
    const text = lookupText(result)
    expect(text).toContain("none —")
    expect(text).not.toContain("Minimum statement")
  })

  test("AccessDenied is DENIED with the LookupEvents statement, never an empty history", async () => {
    const result = await lookup(WINDOW, { lookupEvents: "denied" })
    expect(result.events.state).toBe("DENIED")
    if (result.events.state !== "DENIED") throw new Error("narrowing")
    expect(result.events.action).toBe("cloudtrail:LookupEvents")
    expect(result.events.principal).toContain("assumed-role/tenure-studio-task")
    expect("value" in result.events).toBe(false)
    const text = lookupText(result)
    expect(text).toContain("unknown")
    // The answer an investigation must never be given by mistake.
    expect(text).not.toMatch(/\b0 management event/)
    expect(text).not.toMatch(/\bnone\b/)
  })

  test("a throttle is THROTTLED — never an empty result, which would read as 'nobody changed it'", async () => {
    const result = await lookup(WINDOW, { lookupEvents: "throttled" })
    expect(result.events.state).toBe("THROTTLED")
    if (result.events.state !== "THROTTLED") throw new Error("narrowing")
    expect(result.events.retryAfterMs).toBe(800)
    const text = lookupText(result)
    expect(text).toContain("throttled")
    expect(text).not.toMatch(/\b0 management event/)
    expect(text).not.toMatch(/\bnone\b/)
  })

  test("the four render as four visibly different lookups", async () => {
    const texts: string[] = []
    for (const outcome of ["populated", "empty", "denied", "throttled"] as const) {
      __resetIdentity()
      texts.push(lookupText(await lookup(WINDOW, { lookupEvents: outcome })))
    }
    expect(new Set(texts).size).toBe(4)
  })
})

/* ---------------------------------------------------- bounded, and honest -- */

describe("the lookup is bounded and says when it stopped", () => {
  function pages(count: number, perPage: number): EventPage[] {
    return Array.from({ length: count }, (_, page) => ({
      Events: Array.from({ length: perPage }, (_, i) =>
        managementEvent({
          EventId: `event-${page}-${i}`,
          EventName: `Event${page}_${i}`,
        }),
      ),
      NextToken: page < count - 1 ? pageToken(page + 1) : undefined,
    }))
  }

  test("it pages to completion when the window fits inside the bounds", async () => {
    const calls: string[] = []
    const result = await lookup(WINDOW, { eventPages: pages(3, 10), calls })
    expect(result.events.state).toBe("ACTUAL")
    if (result.events.state !== "ACTUAL") throw new Error("narrowing")
    expect(result.events.value).toHaveLength(30)
    expect(result.truncation).toEqual({ kind: "complete" })
    expect(calls.filter((c) => c === "cloudtrail:LookupEvents")).toHaveLength(3)
    expect(lookupText(result)).toContain("complete for this window")
  })

  test("hitting the event cap returns an explicit 'there were more', with the token", async () => {
    const result = await lookup({ ...WINDOW, maxEvents: 15 }, { eventPages: pages(3, 10) })
    if (result.events.state !== "ACTUAL") throw new Error("narrowing")
    expect(result.events.value).toHaveLength(15)
    expect(result.truncation.kind).toBe("more-available")
    if (result.truncation.kind !== "more-available") throw new Error("narrowing")
    expect(result.truncation.returned).toBe(15)
    expect(result.truncation.nextToken).toBe(pageToken(2))
    expect(lookupText(result)).toContain("TRUNCATED")
  })

  test("the cap cutting the LAST page short is still 'more available', token or not", async () => {
    // One page, ten events, cap of four. There is no NextToken and six events
    // AWS sent were dropped: reporting this complete would lose them silently.
    const result = await lookup({ ...WINDOW, maxEvents: 4 }, { eventPages: pages(1, 10) })
    if (result.events.state !== "ACTUAL") throw new Error("narrowing")
    expect(result.events.value).toHaveLength(4)
    expect(result.truncation.kind).toBe("more-available")
    if (result.truncation.kind !== "more-available") throw new Error("narrowing")
    expect(result.truncation.nextToken).toBeNull()
  })

  test("the page bound stops the walk and says so", async () => {
    // More pages than MAX_LOOKUP_PAGES, small enough per page that the event cap
    // is never the thing that stops it.
    const result = await lookup(
      { ...WINDOW, maxEvents: ABSOLUTE_MAX_EVENTS },
      { eventPages: pages(MAX_LOOKUP_PAGES + 5, 1) },
    )
    if (result.events.state !== "ACTUAL") throw new Error("narrowing")
    expect(result.events.value).toHaveLength(MAX_LOOKUP_PAGES)
    expect(result.truncation.kind).toBe("more-available")
    if (result.truncation.kind !== "more-available") throw new Error("narrowing")
    expect(result.truncation.reason).toContain(`${MAX_LOOKUP_PAGES} pages`)
  })

  test("a refused lookup is never reported as truncated", async () => {
    const result = await lookup({ ...WINDOW, maxEvents: 1 }, { lookupEvents: "denied" })
    expect(result.events.state).toBe("DENIED")
    expect(result.truncation).toEqual({ kind: "complete" })
  })
})

/* -------------------------------------------------- the window is honest -- */

describe("the window is validated and its coverage is stated", () => {
  test("a window inside 90 days is covered", async () => {
    const result = await lookup(WINDOW)
    expect(result.coverage).toEqual({ kind: "within-retention" })
    expect(lookupText(result)).toContain("90-day event history")
  })

  test("a window reaching past retention says so rather than returning less in silence", async () => {
    const result = await lookup({
      startTime: new Date(NOW_MS - 200 * DAY),
      endTime: new Date(NOW_MS),
    })
    expect(result.coverage.kind).toBe("partly-before-retention")
    if (result.coverage.kind !== "partly-before-retention") throw new Error("narrowing")
    expect(result.coverage.retentionStartsAt).toBe(
      new Date(NOW_MS - 90 * DAY).toISOString(),
    )
    const text = lookupText(result)
    expect(text).toContain("PARTIAL WINDOW")
    expect(text).toContain("not absent")
  })

  test("an inverted window is UNCONFIGURED and no call is made", async () => {
    const calls: string[] = []
    const result = await lookup({ startTime: WINDOW.endTime, endTime: WINDOW.startTime }, { calls })
    expect(result.events.state).toBe("UNCONFIGURED")
    expect(calls).not.toContain("cloudtrail:LookupEvents")
    const text = lookupText(result)
    expect(text).toContain("not configured")
    expect(text).not.toMatch(/\b0 management event/)
  })

  test("an unreadable timestamp is UNCONFIGURED, not a window silently starting at 1970", async () => {
    const calls: string[] = []
    const result = await lookup({ startTime: "not a date", endTime: WINDOW.endTime }, { calls })
    expect(result.events.state).toBe("UNCONFIGURED")
    expect(result.window).toBeNull()
    expect(calls).not.toContain("cloudtrail:LookupEvents")
  })

  test("CloudTrail takes ONE lookup attribute, so a multi-filter query is narrowed, not sent", async () => {
    const inputs: Record<string, unknown>[] = []
    const result = await lookup(
      { ...WINDOW, resourceName: "tenure-prod", eventName: "ModifyDBInstance" },
      { inputs },
    )
    expect(result.filters).toEqual([{ key: "ResourceName", value: "tenure-prod" }])
    const sent = inputs.find((i) => i.capability === "cloudtrail:LookupEvents")
    expect(sent?.LookupAttributes).toEqual([
      { AttributeKey: "ResourceName", AttributeValue: "tenure-prod" },
    ])
    expect(lookupText(result)).toContain("ResourceName=tenure-prod")
  })
})

/* ------------------------------------------------------- what is NOT kept -- */

test("the request payload never leaves the raw event", async () => {
  const result = await lookup(WINDOW)
  if (result.events.state !== "ACTUAL") throw new Error("narrowing")
  const serialised = JSON.stringify(result.events.value)
  // The blob the fake returned carries both of these. Neither may survive: this
  // console renders into an operator plane that must not become a second copy of
  // request arguments.
  expect(serialised).not.toContain("a-secret-that-must-not-be-rendered")
  expect(serialised).not.toContain("learner@example.edu")
  expect(serialised).not.toContain("requestParameters")
  expect(serialised).not.toContain("responseElements")
  // …while the fields that answer "who changed this" are all there.
  expect(serialised).toContain("203.0.113.7")
  expect(serialised).toContain("assumed-role/tenure-deploy")
  expect(lookupText(result)).not.toContain("learner@example.edu")
})

/* ------------------------------------------------------- the retry schedule -- */

test("a throttled read waits on throttle.ts's curve and reports its own next attempt", async () => {
  // Two independent facts: the pause between attempts, and the number the
  // surface prints. Both come from throttle.ts, so a literal retyped in this
  // module would show up here as a different number.
  const readings = await load({ describeTrails: "throttled" })
  if (readings.trails.state !== "THROTTLED") throw new Error("narrowing")
  // backoffMs(2) = 200, doubled twice across three attempts = 800.
  expect(readings.trails.retryAfterMs).toBe(800)
  expect(readings.trails.asOf).toBe("2026-08-13T09:15:00.000Z")
})
