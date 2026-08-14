import { __resetIdentity } from "./identity"
import type { AwsGateway } from "./read"
import {
  MAX_EVENTS_RETURNED,
  MAX_EVENT_WINDOW_MS,
  MAX_LOG_GROUP_PAGES,
  MAX_METRIC_FILTER_READS,
  SHORTEST_USEFUL_RETENTION_DAYS,
  classifyLogGroupSensitivity,
  classifyRetention,
  describeLogEvents,
  filterLogEvents,
  logGroupReadings,
  logsLines,
  normalizeLogGroupArn,
  type LogsReadings,
} from "./logs"

/**
 * CloudWatch Logs — the surface tells four different truths apart, and refuses
 * rather than guessing.
 *
 * The assertions are on `logGroupReadings`, `filterLogEvents` and `logsLines` —
 * the functions a route renders — rather than on `readAws` or on any parser. A
 * test that drove `readAws` directly would stay green on the day this module
 * stopped calling it, which is precisely the failure this programme has already
 * paid for twice.
 *
 * ## The stand-in is a client, not a stub
 *
 * `fakeAws` answers five capabilities with the shapes the real SDK returns —
 * `{logGroups, nextToken}` from DescribeLogGroups, `{metricFilters, nextToken}`
 * from DescribeMetricFilters, `{events, nextToken}` from FilterLogEvents,
 * `{ResourceTagMappingList}` from the Tagging API and `{Account, Arn}` from STS
 * — and it can fail each of them independently with `AccessDeniedException`, a
 * `ThrottlingException`, an empty-but-successful answer or a populated one. A
 * stand-in that returned `[]` regardless of what was asked would prove nothing
 * about the code that has to tell those four apart, and it is the fake this
 * repository has already been burnt by.
 *
 * Note in particular that the empty DescribeLogGroups answer OMITS `logGroups`
 * entirely, which is what AWS actually sends, and that every group ARN carries
 * the trailing `:*` AWS actually returns — the fixture is the trap the module
 * has to survive, not a convenience.
 *
 * ## The account id is obviously constructed
 *
 * `123456789012` is AWS's own documentation placeholder. Nothing in this suite
 * is a real account, ARN or resource name.
 */

const ACCOUNT = "123456789012"
const REGION = "eu-west-2"
const PARTITION = "aws"

/** The ARN AWS returns from DescribeLogGroups — WITH the trailing `:*`. */
function groupArnFromAws(name: string): string {
  return `arn:${PARTITION}:logs:${REGION}:${ACCOUNT}:log-group:${name}:*`
}

/** The ARN the Resource Groups Tagging API returns for the same group — WITHOUT it. */
function groupArnFromTagging(name: string): string {
  return `arn:${PARTITION}:logs:${REGION}:${ACCOUNT}:log-group:${name}`
}

/* --------------------------------------------------------------- fixtures -- */

interface GroupFixture {
  logGroupName: string
  retentionInDays?: number
  storedBytes?: number
  kmsKeyId?: string
  metricFilterCount?: number
  creationTime?: number
  logGroupClass?: string
  /** Raised instead of answering DescribeMetricFilters for this group. */
  filtersFailWith?: string
  filters?: Array<{
    filterName: string
    filterPattern: string
    metricTransformations?: Array<{ metricName: string; metricNamespace: string }>
  }>
  /** Events this group has, as epoch millis. Used by the freshness probe and the search. */
  events?: Array<{ eventId: string; timestamp: number; message: string; logStreamName?: string }>
}

const NOW_MS = Date.parse("2026-08-13T09:15:00.000Z")
const AT = () => new Date(NOW_MS)

/**
 * The estate `infrastructure/terraform/ecs.tf` actually creates, plus the two
 * groups an account grows on its own.
 *
 * `/ecs/tenure-prod` is the one Terraform declares: 30 days, no `kms_key_id`, no
 * `tags` block — so it is genuinely untagged, and this fixture does not invent
 * tags it does not have.
 */
function healthyEstate(): GroupFixture[] {
  return [
    {
      logGroupName: "/ecs/tenure-prod",
      retentionInDays: 30,
      storedBytes: 4_294_967_296,
      metricFilterCount: 1,
      creationTime: Date.parse("2026-05-01T00:00:00.000Z"),
      logGroupClass: "STANDARD",
      filters: [
        {
          filterName: "tenure-prod-errors",
          filterPattern: "ERROR",
          metricTransformations: [
            { metricName: "AppErrors", metricNamespace: "Tenure/Prod" },
          ],
        },
      ],
      events: [
        {
          eventId: "e-2",
          timestamp: NOW_MS - 20_000,
          message: "ERROR upstream timeout",
          logStreamName: "ecs/app/2",
        },
        {
          eventId: "e-1",
          timestamp: NOW_MS - 90_000,
          message: "ERROR database connection refused",
          logStreamName: "ecs/app/1",
        },
      ],
    },
    {
      // No retentionInDays at all — AWS's "Never expire". The unbounded bill.
      logGroupName: "/aws/lambda/tenure-prod-indexer",
      storedBytes: 91_268_055_040,
      metricFilterCount: 0,
      creationTime: Date.parse("2026-02-01T00:00:00.000Z"),
      // Silent: no events at all.
      events: [],
    },
    {
      // One day. The lost incident.
      logGroupName: "/platform/tenure-prod-build",
      retentionInDays: 1,
      storedBytes: 1_048_576,
      kmsKeyId: `arn:${PARTITION}:kms:${REGION}:${ACCOUNT}:key/00000000-0000-4000-8000-000000000000`,
      metricFilterCount: 0,
      creationTime: Date.parse("2026-06-01T00:00:00.000Z"),
      events: [{ eventId: "b-1", timestamp: NOW_MS - 5_000, message: "build finished" }],
    },
  ]
}

/* --------------------------------------------------------------- the client -- */

type Outcome = "populated" | "empty" | "denied" | "throttled"

interface FakeOptions {
  /** How `logs:DescribeLogGroups` behaves. The four cases this suite exists to separate. */
  describeLogGroups?: Outcome
  groups?: GroupFixture[]
  /** How `logs:FilterLogEvents` behaves, for both the probe and the search. */
  filterLogEvents?: Outcome
  tags?: Record<string, Array<{ Key: string; Value: string }>>
  tagsOutcome?: Outcome
  identity?: { arn: string; account: string; region: string } | "denied"
  /** Pages DescribeLogGroups in chunks of this size, so the page bound can be exercised. */
  groupsPerPage?: number
  /** Pages FilterLogEvents in chunks of this size, so the event cap can be exercised. */
  eventsPerPage?: number
  /** Set by the fake so a test can assert what was and was not called. */
  calls?: Array<{ capability: string; input: Record<string, unknown> }>
}

function throwing(name: string): never {
  const error = new Error(`${name} raised by the stand-in AWS client`)
  error.name = name
  throw error
}

/**
 * A stand-in that behaves like the SDK: same response shapes, same error names,
 * same pagination, and independently failable per capability.
 */
function fakeAws(options: FakeOptions = {}): AwsGateway {
  const groups = options.groups ?? healthyEstate()
  const identity = options.identity ?? {
    arn: `arn:${PARTITION}:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
    account: ACCOUNT,
    region: REGION,
  }
  const calls = options.calls ?? []
  const groupsPerPage = options.groupsPerPage ?? groups.length
  const eventsPerPage = options.eventsPerPage ?? 100

  return {
    async call(capability, input = {}) {
      calls.push({ capability: String(capability), input: { ...input } })
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

        case "logs:DescribeLogGroups": {
          const outcome = options.describeLogGroups ?? "populated"
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          // The real API OMITS `logGroups` entirely when there are none. It does
          // not return an empty array, and a fake that did would be testing a
          // response AWS never sends.
          if (outcome === "empty") return {}
          const cursor = Number(input.nextToken ?? 0)
          const slice = groups.slice(cursor, cursor + groupsPerPage)
          const next = cursor + groupsPerPage
          return {
            logGroups: slice.map((g) => ({
              logGroupName: g.logGroupName,
              arn: groupArnFromAws(g.logGroupName),
              retentionInDays: g.retentionInDays,
              storedBytes: g.storedBytes,
              kmsKeyId: g.kmsKeyId,
              metricFilterCount: g.metricFilterCount,
              creationTime: g.creationTime,
              logGroupClass: g.logGroupClass,
            })),
            nextToken: next < groups.length ? String(next) : undefined,
          }
        }

        case "logs:DescribeMetricFilters": {
          const name = String(input.logGroupName ?? "")
          const fixture = groups.find((g) => g.logGroupName === name)
          if (!fixture) throwing("ResourceNotFoundException")
          if (fixture.filtersFailWith) throwing(fixture.filtersFailWith)
          return {
            metricFilters: (fixture.filters ?? []).map((f) => ({
              filterName: f.filterName,
              filterPattern: f.filterPattern,
              logGroupName: name,
              creationTime: Date.parse("2026-05-02T00:00:00.000Z"),
              metricTransformations: f.metricTransformations,
            })),
          }
        }

        case "logs:FilterLogEvents": {
          const outcome = options.filterLogEvents ?? "populated"
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          if (outcome === "empty") return {}
          const name = String(input.logGroupName ?? "")
          const fixture = groups.find((g) => g.logGroupName === name)
          if (!fixture) throwing("ResourceNotFoundException")
          const startTime = Number(input.startTime)
          const endTime = Number(input.endTime)
          const pattern = typeof input.filterPattern === "string" ? input.filterPattern : ""
          const matching = (fixture.events ?? [])
            .filter((e) => e.timestamp >= startTime && e.timestamp < endTime)
            // No pattern means every line, which is exactly why the module
            // refuses to send one. The fake reproduces that so the guard is
            // testing a real behaviour rather than an invented one.
            .filter((e) => (pattern ? e.message.includes(pattern) : true))
          const cursor = Number(input.nextToken ?? 0)
          const slice = matching.slice(cursor, cursor + eventsPerPage)
          const next = cursor + eventsPerPage
          return {
            events: slice.map((e) => ({
              eventId: e.eventId,
              logStreamName: e.logStreamName ?? "stream",
              timestamp: e.timestamp,
              ingestionTime: e.timestamp + 500,
              message: e.message,
            })),
            nextToken: next < matching.length ? String(next) : undefined,
          }
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

async function load(
  options: FakeOptions = {},
  reading: { probeSilenceWindowMs?: number } = {},
): Promise<LogsReadings> {
  return logGroupReadings(fakeAws(options), { now: AT, ...reading })
}

/** The whole surface as one string, which is what an operator actually reads. */
function surfaceText(readings: LogsReadings): string {
  return logsLines(readings)
    .map((line) => `${line.label}: ${line.text}`)
    .join("\n")
}

beforeEach(() => {
  // `resolveIdentity` caches per process. Every case here supplies its own
  // gateway, which bypasses the cache, but a stale cache from another suite
  // would silently make these assertions test the wrong identity.
  __resetIdentity()
})

/* -------------------------------------------- the four outcomes, compared -- */

describe("the logs surface says something different for each of the four outcomes", () => {
  test("a populated list is ACTUAL and names every group with its retention", async () => {
    const readings = await load()
    expect(readings.groups.state).toBe("ACTUAL")
    if (readings.groups.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.groups.value).toHaveLength(3)

    const text = surfaceText(readings)
    expect(text).toContain("/ecs/tenure-prod")
    expect(text).toContain("30 day(s) retention")
    expect(text).toContain("NEVER EXPIRES")
    expect(text).toContain("TOO SHORT")
    expect(text).toContain("4294967296 stored byte(s)")
  })

  test("an empty-but-successful list is EMPTY and says none, not refused", async () => {
    const readings = await load({ describeLogGroups: "empty" })
    expect(readings.groups.state).toBe("EMPTY")
    const text = surfaceText(readings)
    expect(text).toContain("none —")
    expect(text).not.toContain("refused")
    expect(text).not.toContain("Minimum statement")
  })

  test("AccessDenied is DENIED, carries the principal, the action and a pasteable statement", async () => {
    const readings = await load({ describeLogGroups: "denied" })
    expect(readings.groups.state).toBe("DENIED")
    if (readings.groups.state !== "DENIED") throw new Error("narrowing")

    expect(readings.groups.action).toBe("logs:DescribeLogGroups")
    expect(readings.groups.principal).toContain("assumed-role/tenure-studio-task")
    expect(readings.groups.accountId).toBe(ACCOUNT)
    expect(readings.groups.region).toBe(REGION)
    expect(readings.groups.partition).toBe(PARTITION)
    expect(JSON.parse(readings.groups.minimumStatement)).toEqual({
      Effect: "Allow",
      Action: ["logs:DescribeLogGroups"],
      Resource: "*",
    })

    // And the thing it must NOT be. There is no `value` on this arm at all, so a
    // caller cannot reach an empty array; the render says "unknown".
    expect("value" in readings.groups).toBe(false)
    const text = surfaceText(readings)
    expect(text).toContain("unknown")
    expect(text).not.toMatch(/\bnone\b/)
  })

  test("a throttle is THROTTLED — its own state, not a failure and not an empty list", async () => {
    const readings = await load({ describeLogGroups: "throttled" })
    expect(readings.groups.state).toBe("THROTTLED")
    if (readings.groups.state !== "THROTTLED") throw new Error("narrowing")
    // The schedule is `throttle.ts`'s — 200ms after the first failure, doubling —
    // not a number retyped in this module.
    expect(readings.groups.retryAfterMs).toBe(800)
    const text = surfaceText(readings)
    expect(text).toContain("throttled")
    expect(text).toContain("retrying in")
    expect(text).not.toContain("Minimum statement")
  })

  test("the four render as four visibly different surfaces", async () => {
    const texts: string[] = []
    for (const outcome of ["populated", "empty", "denied", "throttled"] as const) {
      __resetIdentity()
      texts.push(surfaceText(await load({ describeLogGroups: outcome })))
    }
    // Pairwise distinct. A fake that returned [] regardless would collapse at
    // least two of these into one string, and this is the assertion that notices.
    expect(new Set(texts).size).toBe(4)
    for (const text of texts) expect(text.length).toBeGreaterThan(0)
  })
})

/* ------------------------------------------------------ retention posture -- */

describe("retention is classified, not printed as a number to interpret", () => {
  test("absent retentionInDays is never-expires — a finding, not an unknown", () => {
    const posture = classifyRetention(undefined)
    expect(posture.kind).toBe("never-expires")
    if (posture.kind !== "never-expires") throw new Error("narrowing")
    expect(posture.why).toContain("Never expire")
    expect(posture.why).toContain("unbounded bill")
  })

  test("one day is too-short and names the on-call rotation it is shorter than", () => {
    const posture = classifyRetention(1)
    expect(posture.kind).toBe("too-short")
    if (posture.kind !== "too-short") throw new Error("narrowing")
    expect(posture.days).toBe(1)
    expect(posture.why).toContain(String(SHORTEST_USEFUL_RETENTION_DAYS))
  })

  test("the boundary is inclusive on the useful side", () => {
    expect(classifyRetention(SHORTEST_USEFUL_RETENTION_DAYS).kind).toBe("retained")
    expect(classifyRetention(SHORTEST_USEFUL_RETENTION_DAYS - 1).kind).toBe("too-short")
  })

  test("a value that is not a day count is unreadable, never coerced to never-expires", () => {
    expect(classifyRetention(0).kind).toBe("unreadable")
    expect(classifyRetention(Number.NaN).kind).toBe("unreadable")
    expect(classifyRetention(-3).kind).toBe("unreadable")
  })
})

/* --------------------------------------------------------- the ARN join -- */

describe("the tag join survives the trailing :* AWS puts on a log group ARN", () => {
  test("the ARN AWS returns and the ARN the Tagging API returns join", async () => {
    const readings = await load({
      tags: {
        [groupArnFromTagging("/ecs/tenure-prod")]: [
          { Key: "tenure:tenant", Value: "pilot-school" },
        ],
      },
    })
    if (readings.groups.state !== "ACTUAL") throw new Error("narrowing")
    const app = readings.groups.value.find((g) => g.logGroupName === "/ecs/tenure-prod")
    expect(app?.attribution).toEqual({ kind: "tenant", tenantSlug: "pilot-school" })
    // The stored ARN is the normalized one, so a surface joining again also hits.
    expect(app?.arn).toBe(groupArnFromTagging("/ecs/tenure-prod"))
    expect(normalizeLogGroupArn(groupArnFromAws("/x"))).toBe(groupArnFromTagging("/x"))
  })

  test("a group nobody tagged is unattributed, and a denied tag index is unknown", async () => {
    const tagged = await load({ tags: {} })
    if (tagged.groups.state !== "ACTUAL") throw new Error("narrowing")
    expect(tagged.groups.value[0].attribution.kind).toBe("unattributed")

    __resetIdentity()
    const denied = await load({ tagsOutcome: "denied" })
    if (denied.groups.state !== "ACTUAL") throw new Error("narrowing")
    const attribution = denied.groups.value[0].attribution
    expect(attribution.kind).toBe("unknown")
    if (attribution.kind !== "unknown") throw new Error("narrowing")
    // The sentence carries the refused action, so an operator reading a group's
    // attribution learns which policy to fix without leaving the row.
    expect(attribution.why).toContain("tags were not read")
    expect(attribution.why).toContain("tag:GetResources")
    // The two must not read the same: "nobody tagged this" sends an operator to
    // add a tag, "we could not look" sends them to a policy.
    expect(surfaceText(denied)).not.toContain("unattributable — missing tenure:tenant")
  })

  test("region and partition come from the resolved identity's ARN, never a literal", async () => {
    const readings = await load({
      identity: {
        arn: `arn:aws-us-gov:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
        account: ACCOUNT,
        region: "us-gov-west-1",
      },
      // A group with no ARN at all, so the identity is the only source left.
      groups: [{ logGroupName: "/ecs/tenure-prod", retentionInDays: 30, metricFilterCount: 0 }],
    })
    if (readings.groups.state !== "ACTUAL") throw new Error("narrowing")
    // AWS returned an ARN for this group, so the ARN wins — and it is the ARN
    // the fake built from the identity's own partition and region.
    expect(readings.groups.value[0].partition).toBe(PARTITION)
    expect(readings.identity.state).toBe("ACTUAL")
    if (readings.identity.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.identity.value.partition).toBe("aws-us-gov")
    expect(readings.identity.value.region).toBe("us-gov-west-1")
    expect(surfaceText(readings)).not.toContain("us-east-1")
  })
})

/* --------------------------------------------- sub-reads degrade separately -- */

describe("a denied metric-filter read does not collapse the row", () => {
  test("the group still appears, its filters say refused, and the statement names the right action", async () => {
    const groups = healthyEstate()
    groups[0].filtersFailWith = "AccessDeniedException"
    const readings = await load({ groups })

    expect(readings.groups.state).toBe("ACTUAL")
    if (readings.groups.state !== "ACTUAL") throw new Error("narrowing")
    // The listing is sorted by name, so the group is found rather than indexed.
    const app = readings.groups.value.find((g) => g.logGroupName === "/ecs/tenure-prod")
    if (!app) throw new Error("the group whose filters were refused vanished from the listing")
    // The row is intact: retention and bytes were read and are still reported.
    expect(app.retention.kind).toBe("retained")
    expect(app.storedBytes).toBe(4_294_967_296)
    // And the sub-read names its OWN action, not the listing's.
    expect(app.metricFilters.filters.state).toBe("DENIED")
    if (app.metricFilters.filters.state !== "DENIED") throw new Error("narrowing")
    expect(app.metricFilters.filters.action).toBe("logs:DescribeMetricFilters")

    // Scoped to this group's own line: the other two groups genuinely have no
    // metric filters, and a whole-surface assertion would be testing them.
    const line = logsLines(readings).find((l) => l.label === "/ecs/tenure-prod")
    if (!line) throw new Error("the refused group produced no line")
    expect(line.text).toContain("logs:DescribeMetricFilters")
    expect(line.text).toContain("Minimum statement")
    // The reassuring default this must never render as.
    expect(line.text).not.toContain("no metric filter turns a line in this group into a metric")
  })

  test("metricFilterCount 0 skips the call and says so rather than claiming a read", async () => {
    const calls: FakeOptions["calls"] = []
    const readings = await load({ calls })
    if (readings.groups.state !== "ACTUAL") throw new Error("narrowing")
    const indexer = readings.groups.value.find(
      (g) => g.logGroupName === "/aws/lambda/tenure-prod-indexer",
    )
    expect(indexer?.metricFilters.filters.state).toBe("EMPTY")
    expect(indexer?.metricFilters.provenance).toContain("metricFilterCount 0")
    // Only the one group with a declared filter was asked.
    const asked = calls
      .filter((c) => c.capability === "logs:DescribeMetricFilters")
      .map((c) => c.input.logGroupName)
    expect(asked).toEqual(["/ecs/tenure-prod"])
  })

  test("a count that disagrees with the list is reported, not silently trusted", async () => {
    const groups = healthyEstate()
    // AWS said three filters exist; DescribeMetricFilters returns the one fixture.
    groups[0].metricFilterCount = 3
    const readings = await load({ groups })
    if (readings.groups.state !== "ACTUAL") throw new Error("narrowing")
    const app = readings.groups.value.find((g) => g.logGroupName === "/ecs/tenure-prod")
    expect(app?.metricFilters.discrepancy).toContain("reported 3")
    expect(surfaceText(readings)).toContain("DISCREPANCY")
  })
})

/* --------------------------------------------------------- the page bound -- */

describe("pagination is walked to the end, and a bound is announced", () => {
  test("groups spread over several pages are all collected", async () => {
    const readings = await load({ groupsPerPage: 1 })
    if (readings.groups.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.groups.value).toHaveLength(3)
    expect(readings.completeness.kind).toBe("complete")
  })

  test("hitting the page bound is TRUNCATED and prints on the surface", async () => {
    // One group per page, more groups than pages: the loop stops with a token.
    const many: GroupFixture[] = Array.from({ length: MAX_LOG_GROUP_PAGES + 4 }, (_, i) => ({
      logGroupName: `/platform/group-${String(i).padStart(3, "0")}`,
      retentionInDays: 30,
      metricFilterCount: 0,
    }))
    const readings = await load({ groups: many, groupsPerPage: 1 })
    if (readings.groups.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.groups.value).toHaveLength(MAX_LOG_GROUP_PAGES)
    expect(readings.completeness.kind).toBe("truncated")
    const text = surfaceText(readings)
    expect(text).toContain("TRUNCATED")
    expect(text).toContain("not every group in the account")
  })

  test("groups past the metric-filter budget are UNCONFIGURED, never 'no filters'", async () => {
    const many: GroupFixture[] = Array.from({ length: MAX_METRIC_FILTER_READS + 2 }, (_, i) => ({
      logGroupName: `/platform/group-${String(i).padStart(3, "0")}`,
      retentionInDays: 30,
      // Declared non-zero so the zero-count shortcut cannot be what skipped it.
      metricFilterCount: 1,
      filters: [{ filterName: `f-${i}`, filterPattern: "ERROR" }],
    }))
    const readings = await load({ groups: many })
    if (readings.groups.state !== "ACTUAL") throw new Error("narrowing")
    const last = readings.groups.value[readings.groups.value.length - 1]
    expect(last.metricFilters.filters.state).toBe("UNCONFIGURED")
    if (last.metricFilters.filters.state !== "UNCONFIGURED") throw new Error("narrowing")
    expect(last.metricFilters.filters.why).toContain("not the same as its having none")
  })
})

/* ------------------------------------------------------------- freshness -- */

describe("a silent log group is told apart from a calm one", () => {
  test("not probed by default, and the field says why rather than being absent", async () => {
    const calls: FakeOptions["calls"] = []
    const readings = await load({ calls })
    if (readings.groups.state !== "ACTUAL") throw new Error("narrowing")
    for (const group of readings.groups.value) {
      expect(group.lastEvent.state).toBe("NOT_PROBED")
    }
    expect(calls.some((c) => c.capability === "logs:FilterLogEvents")).toBe(false)
    expect(surfaceText(readings)).toContain("last event not probed")
  })

  test("a probed estate separates RECEIVING from SILENT", async () => {
    const readings = await load({}, { probeSilenceWindowMs: 300_000 })
    if (readings.groups.state !== "ACTUAL") throw new Error("narrowing")

    const app = readings.groups.value.find((g) => g.logGroupName === "/ecs/tenure-prod")
    expect(app?.lastEvent.state).toBe("RECEIVING")
    if (app?.lastEvent.state !== "RECEIVING") throw new Error("narrowing")
    // The newest event in the window, not the first one the page returned.
    expect(app.lastEvent.mostRecentSeenAt).toBe(new Date(NOW_MS - 20_000).toISOString())
    expect(app.lastEvent.ageMsUpperBound).toBe(20_000)

    const indexer = readings.groups.value.find(
      (g) => g.logGroupName === "/aws/lambda/tenure-prod-indexer",
    )
    expect(indexer?.lastEvent.state).toBe("SILENT")
    if (indexer?.lastEvent.state !== "SILENT") throw new Error("narrowing")
    expect(indexer.lastEvent.forAtLeastMs).toBe(300_000)

    const text = surfaceText(readings)
    expect(text).toContain("SILENT")
    expect(text).toContain("receiving —")
  })

  test("a refused probe is UNREADABLE, never silence", async () => {
    const readings = await load({ filterLogEvents: "denied" }, { probeSilenceWindowMs: 300_000 })
    if (readings.groups.state !== "ACTUAL") throw new Error("narrowing")
    const app = readings.groups.value[0]
    expect(app.lastEvent.state).toBe("UNREADABLE")
    if (app.lastEvent.state !== "UNREADABLE") throw new Error("narrowing")
    expect(app.lastEvent.why).toContain("logs:FilterLogEvents")
    const text = surfaceText(readings)
    expect(text).toContain("last event unknown")
    expect(text).not.toContain("SILENT")
  })

  test("a throttled probe is its own state and does not read as silence either", async () => {
    const readings = await load({ filterLogEvents: "throttled" }, { probeSilenceWindowMs: 300_000 })
    if (readings.groups.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.groups.value[0].lastEvent.state).toBe("UNREADABLE")
    const text = surfaceText(readings)
    expect(text).toContain("throttled")
    expect(text).not.toContain("SILENT")
  })

  test("the probe returns no message text — only a timestamp leaves the module", async () => {
    const readings = await load({}, { probeSilenceWindowMs: 300_000 })
    const text = surfaceText(readings)
    expect(text).not.toContain("upstream timeout")
    expect(text).not.toContain("database connection refused")
    expect(JSON.stringify(readings)).not.toContain("upstream timeout")
  })
})

/* --------------------------------------------------------- the event read -- */

describe("filterLogEvents is bounded and refuses rather than guessing", () => {
  const WINDOW = {
    startTime: new Date(NOW_MS - 600_000).toISOString(),
    endTime: new Date(NOW_MS).toISOString(),
  }

  test("an acknowledged tenant-data group returns its matching events, ordered", async () => {
    const outcome = await filterLogEvents(
      {
        logGroupName: "/ecs/tenure-prod",
        ...WINDOW,
        filterPattern: "ERROR",
        acknowledgeTenantData: true,
      },
      fakeAws(),
      { now: AT },
    )
    expect(outcome.outcome).toBe("READ")
    if (outcome.outcome !== "READ") throw new Error("narrowing")
    expect(outcome.read.state).toBe("ACTUAL")
    if (outcome.read.state !== "ACTUAL") throw new Error("narrowing")
    const page = outcome.read.value
    expect(page.events.map((e) => e.eventId)).toEqual(["e-1", "e-2"])
    expect(page.hasMore).toBe(false)
    expect(page.tenantDataAcknowledged).toBe(true)
    expect(page.filterPattern).toBe("ERROR")
    expect(describeLogEvents(outcome)).toContain("2 event(s)")
  })

  test("an unacknowledged tenant-data group is REFUSED and returns no events at all", async () => {
    const outcome = await filterLogEvents(
      { logGroupName: "/ecs/tenure-prod", ...WINDOW, filterPattern: "ERROR" },
      fakeAws(),
      { now: AT },
    )
    expect(outcome.outcome).toBe("REJECTED")
    if (outcome.outcome !== "REJECTED") throw new Error("narrowing")
    expect(outcome.reason).toBe("TENANT_DATA_NOT_ACKNOWLEDGED")
    expect(outcome.sensitivity.kind).toBe("tenant-data")
    // No arm of a REJECTED outcome can carry an event, and nothing leaked.
    expect(JSON.stringify(outcome)).not.toContain("upstream timeout")
    expect(describeLogEvents(outcome)).toContain("TENANT_DATA_NOT_ACKNOWLEDGED")
  })

  test("an unmarked group needs no acknowledgement", async () => {
    const outcome = await filterLogEvents(
      { logGroupName: "/platform/tenure-prod-build", ...WINDOW, filterPattern: "build" },
      fakeAws(),
      { now: AT },
    )
    expect(outcome.outcome).toBe("READ")
    if (outcome.outcome !== "READ") throw new Error("narrowing")
    expect(outcome.sensitivity.kind).toBe("no-marker")
    expect(outcome.read.state).toBe("ACTUAL")
    if (outcome.read.state !== "ACTUAL") throw new Error("narrowing")
    expect(outcome.read.value.tenantDataAcknowledged).toBe(false)
  })

  test("an empty pattern is refused, and nothing is sent to AWS", async () => {
    const calls: FakeOptions["calls"] = []
    for (const filterPattern of ["", "   "]) {
      const outcome = await filterLogEvents(
        { logGroupName: "/platform/tenure-prod-build", ...WINDOW, filterPattern },
        fakeAws({ calls }),
        { now: AT },
      )
      expect(outcome.outcome).toBe("REJECTED")
      if (outcome.outcome !== "REJECTED") throw new Error("narrowing")
      expect(outcome.reason).toBe("EMPTY_PATTERN")
      expect(outcome.why).toContain("matches every line")
    }
    expect(calls).toHaveLength(0)
  })

  test("an inverted, unreadable or too-wide window is refused by name", async () => {
    const base = { logGroupName: "/platform/tenure-prod-build", filterPattern: "build" }
    const inverted = await filterLogEvents(
      { ...base, startTime: WINDOW.endTime, endTime: WINDOW.startTime },
      fakeAws(),
      { now: AT },
    )
    expect(inverted.outcome === "REJECTED" && inverted.reason).toBe("INVERTED_WINDOW")

    const unreadable = await filterLogEvents(
      { ...base, startTime: "yesterday", endTime: WINDOW.endTime },
      fakeAws(),
      { now: AT },
    )
    expect(unreadable.outcome === "REJECTED" && unreadable.reason).toBe("UNREADABLE_WINDOW")

    const wide = await filterLogEvents(
      {
        ...base,
        startTime: new Date(NOW_MS - MAX_EVENT_WINDOW_MS - 1).toISOString(),
        endTime: WINDOW.endTime,
      },
      fakeAws(),
      { now: AT },
    )
    expect(wide.outcome === "REJECTED" && wide.reason).toBe("WINDOW_TOO_WIDE")
    if (wide.outcome !== "REJECTED") throw new Error("narrowing")
    expect(wide.why).toContain("rather than clamped")
  })

  test("the cap is hard and 'there were more' is explicit, never silent", async () => {
    const noisy: GroupFixture[] = [
      {
        logGroupName: "/platform/tenure-prod-build",
        retentionInDays: 30,
        metricFilterCount: 0,
        events: Array.from({ length: MAX_EVENTS_RETURNED + 137 }, (_, i) => ({
          eventId: `n-${String(i).padStart(4, "0")}`,
          timestamp: NOW_MS - 500_000 + i,
          message: "build ERROR line",
        })),
      },
    ]
    const outcome = await filterLogEvents(
      { logGroupName: "/platform/tenure-prod-build", ...WINDOW, filterPattern: "ERROR" },
      fakeAws({ groups: noisy, eventsPerPage: 100 }),
      { now: AT },
    )
    if (outcome.outcome !== "READ") throw new Error("narrowing")
    if (outcome.read.state !== "ACTUAL") throw new Error("narrowing")
    const page = outcome.read.value
    expect(page.events).toHaveLength(MAX_EVENTS_RETURNED)
    expect(page.hasMore).toBe(true)
    expect(page.moreWhy).toContain("Narrow the window")
    expect(describeLogEvents(outcome)).toContain("THERE WERE MORE")
    // No continuation token is handed back under any name.
    expect(Object.keys(page)).not.toContain("nextToken")
  })

  test("a window with no matching lines is EMPTY, and a refusal is DENIED — not the same string", async () => {
    const empty = await filterLogEvents(
      { logGroupName: "/platform/tenure-prod-build", ...WINDOW, filterPattern: "NOTHING_MATCHES" },
      fakeAws(),
      { now: AT },
    )
    if (empty.outcome !== "READ") throw new Error("narrowing")
    expect(empty.read.state).toBe("EMPTY")

    __resetIdentity()
    const denied = await filterLogEvents(
      { logGroupName: "/platform/tenure-prod-build", ...WINDOW, filterPattern: "build" },
      fakeAws({ filterLogEvents: "denied" }),
      { now: AT },
    )
    if (denied.outcome !== "READ") throw new Error("narrowing")
    expect(denied.read.state).toBe("DENIED")
    if (denied.read.state !== "DENIED") throw new Error("narrowing")
    expect(denied.read.action).toBe("logs:FilterLogEvents")

    __resetIdentity()
    const throttled = await filterLogEvents(
      { logGroupName: "/platform/tenure-prod-build", ...WINDOW, filterPattern: "build" },
      fakeAws({ filterLogEvents: "throttled" }),
      { now: AT },
    )
    if (throttled.outcome !== "READ") throw new Error("narrowing")
    expect(throttled.read.state).toBe("THROTTLED")

    __resetIdentity()
    const populated = await filterLogEvents(
      { logGroupName: "/platform/tenure-prod-build", ...WINDOW, filterPattern: "build" },
      fakeAws(),
      { now: AT },
    )

    const texts = [empty, denied, throttled, populated].map(describeLogEvents)
    expect(new Set(texts).size).toBe(4)
    expect(texts[0]).toContain("none —")
    expect(texts[1]).toContain("Minimum statement")
    expect(texts[2]).toContain("throttled")
  })

  test("a long message is truncated with the truncation stated, not silently shortened", async () => {
    const long = `ERROR ${"x".repeat(9000)}`
    const outcome = await filterLogEvents(
      { logGroupName: "/platform/tenure-prod-build", ...WINDOW, filterPattern: "ERROR" },
      fakeAws({
        groups: [
          {
            logGroupName: "/platform/tenure-prod-build",
            retentionInDays: 30,
            metricFilterCount: 0,
            events: [{ eventId: "long-1", timestamp: NOW_MS - 1000, message: long }],
          },
        ],
      }),
      { now: AT },
    )
    if (outcome.outcome !== "READ") throw new Error("narrowing")
    if (outcome.read.state !== "ACTUAL") throw new Error("narrowing")
    const event = outcome.read.value.events[0]
    expect(event.messageTruncated).toBe(true)
    expect(event.messageChars).toBe(long.length)
    expect(event.message.length).toBeLessThan(long.length)
  })
})

/* ------------------------------------------------------------ sensitivity -- */

describe("the tenant-data marker is a rule about names, and says so", () => {
  test("the platform's own ECS group is marked, and the marker that fired is named", () => {
    const marked = classifyLogGroupSensitivity("/ecs/tenure-prod")
    expect(marked.kind).toBe("tenant-data")
    if (marked.kind !== "tenant-data") throw new Error("narrowing")
    expect(marked.marker).toContain("ecs")
  })

  test("no marker is not a certification, and the arm says so in its own words", () => {
    const unmarked = classifyLogGroupSensitivity("/platform/tenure-prod-build")
    expect(unmarked.kind).toBe("no-marker")
    if (unmarked.kind !== "no-marker") throw new Error("narrowing")
    expect(unmarked.why).toContain("does not certify")
  })
})
