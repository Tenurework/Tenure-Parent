import { __resetIdentity } from "./identity"
import {
  MAX_PAGES_PER_BATCH,
  MAX_QUERIES_PER_BATCH,
  MAX_TOTAL_DATAPOINTS,
  metricLines,
  metricReadings,
  validateRequest,
  type MetricQuerySpec,
  type MetricReadings,
  type MetricWindow,
} from "./metrics"
import type { AwsGateway } from "./read"

/**
 * STUDIO-070-004 (CloudWatch metric data) — the metric surface tells four
 * different truths apart, and a gap is never a zero.
 *
 * The assertions are on `metricReadings` and `metricLines`, the functions a
 * route renders, rather than on `readAws`, on `summarise` or on any parser. A
 * test that drove a private helper would stay green on the day this module
 * stopped calling it, which is precisely the failure this programme has already
 * paid for twice.
 *
 * ## The stand-in is a client, not a stub
 *
 * `fakeAws` answers three capabilities with the shapes the real SDK returns —
 * `{MetricDataResults: [{Id, Label, Timestamps, Values, StatusCode, Messages}],
 * NextToken}` from GetMetricData, `{ResourceTagMappingList: [{ResourceARN,
 * Tags}]}` from the Tagging API, `{Account, Arn}` from STS — and it can fail
 * each of them independently with `AccessDeniedException`, `ThrottlingException`,
 * an empty-but-successful answer, or a populated one. It READS the
 * `MetricDataQueries` it was sent and answers per query, so a test can assert
 * what was asked for as well as what came back. A stand-in that returned `[]`
 * regardless of what was asked would prove nothing about code whose whole job is
 * to tell those apart, and it is the fake this repository has already been burnt
 * by.
 *
 * Timestamps come back from the fake NEWEST FIRST, because `client.ts` sends
 * `ScanBy: "TimestampDescending"` and that is the order AWS then uses. A fixture
 * in ascending order would have hidden whether this module sorts at all.
 *
 * ## The account id is invented, and obviously so
 *
 * `123456789012` is AWS's own documentation placeholder. Nothing in this suite
 * is a real account, a real ARN or a real principal.
 */

/* -------------------------------------------------------------- the estate -- */

const ACCOUNT = "123456789012"
const REGION = "eu-west-2"
const PRINCIPAL = `arn:aws:sts::${ACCOUNT}:assumed-role/tenure-studio-task/session`

/** One hour, so a 60-second period implies exactly 60 datapoints. */
const WINDOW: MetricWindow = {
  startIso: "2026-08-13T08:00:00.000Z",
  endIso: "2026-08-13T09:00:00.000Z",
}

const QUEUE_ARN = `arn:aws:sqs:${REGION}:${ACCOUNT}:tenure-prod-email`

function backlogSpec(overrides: Partial<MetricQuerySpec> = {}): MetricQuerySpec {
  return {
    key: "email-backlog",
    namespace: "AWS/SQS",
    metricName: "ApproximateNumberOfMessagesVisible",
    dimensions: [{ name: "QueueName", value: "tenure-prod-email" }],
    stat: "Maximum",
    periodSeconds: 60,
    label: "Email backlog",
    ...overrides,
  }
}

function ageSpec(overrides: Partial<MetricQuerySpec> = {}): MetricQuerySpec {
  return {
    key: "email-oldest",
    namespace: "AWS/SQS",
    metricName: "ApproximateAgeOfOldestMessage",
    dimensions: [{ name: "QueueName", value: "tenure-prod-email" }],
    stat: "Maximum",
    periodSeconds: 60,
    ...overrides,
  }
}

/* -------------------------------------------------------------- the client -- */

type Outcome = "populated" | "empty" | "denied" | "throttled"

interface FixturePage {
  timestamps: Array<string | Date>
  values: number[]
  statusCode?: string
  messages?: Array<{ Code: string; Value: string }>
}

interface MetricFixture {
  pages: FixturePage[]
  /** Always hands back a NextToken, however many pages have been read. */
  endless?: boolean
}

interface FakeOptions {
  getMetricData?: Outcome
  /** Keyed `${Namespace}|${MetricName}`. A query with no fixture gets no result. */
  metrics?: Record<string, MetricFixture>
  /** A batch containing this namespace is refused — used to fail ONE batch of many. */
  failNamespace?: string
  tags?: Record<string, Array<{ Key: string; Value: string }>>
  tagsOutcome?: Outcome
  identity?: { arn: string; account: string; region: string } | "denied"
  /** Set by the fake so a test can assert what was and was not called. */
  calls?: string[]
  /** Every `MetricDataQueries` array the fake was sent, in order. */
  sentQueries?: unknown[][]
}

function throwing(name: string): never {
  const error = new Error(`${name} raised by the stand-in AWS client`)
  error.name = name
  throw error
}

function fixtureKey(query: Record<string, unknown>): string {
  const stat = query.MetricStat as Record<string, unknown>
  const metric = stat.Metric as Record<string, unknown>
  return `${String(metric.Namespace)}|${String(metric.MetricName)}`
}

function fakeAws(options: FakeOptions = {}): AwsGateway {
  const outcome = options.getMetricData ?? "populated"
  const metrics = options.metrics ?? {}
  const identity = options.identity ?? { arn: PRINCIPAL, account: ACCOUNT, region: REGION }
  const calls = options.calls ?? []
  const sentQueries = options.sentQueries ?? []

  return {
    async call(capability, input) {
      calls.push(String(capability))
      switch (capability) {
        case "sts:GetCallerIdentity":
          if (identity === "denied") throwing("AccessDenied")
          return { Account: identity.account, Arn: identity.arn, UserId: "AROA:studio" }

        case "tag:GetResources": {
          const tagsOutcome = options.tagsOutcome ?? "populated"
          if (tagsOutcome === "denied") throwing("AccessDeniedException")
          if (tagsOutcome === "throttled") throwing("ThrottlingException")
          if (tagsOutcome === "empty") return { ResourceTagMappingList: [] }
          return {
            ResourceTagMappingList: Object.entries(options.tags ?? {}).map(([arn, Tags]) => ({
              ResourceARN: arn,
              Tags,
            })),
          }
        }

        case "cloudwatch:GetMetricData": {
          const queries = ((input as { MetricDataQueries?: unknown })?.MetricDataQueries ??
            []) as Array<Record<string, unknown>>
          sentQueries.push(queries)
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          if (
            options.failNamespace &&
            queries.some((q) => fixtureKey(q).startsWith(`${options.failNamespace}|`))
          ) {
            throwing("AccessDeniedException")
          }
          // The API returns the key present and empty when it has nothing at
          // all to say. That is a different answer from a result per query with
          // no values in it, and this suite exercises both.
          if (outcome === "empty") return { MetricDataResults: [] }

          const token = (input as { NextToken?: unknown })?.NextToken
          const page = typeof token === "string" ? Number(token.replace("p", "")) : 0
          const results: unknown[] = []
          let more = false
          for (const query of queries) {
            const fixture = metrics[fixtureKey(query)]
            if (!fixture) continue
            if (fixture.endless) more = true
            if (fixture.pages.length > page + 1) more = true
            const fixturePage = fixture.pages[page]
            if (!fixturePage) continue
            results.push({
              Id: query.Id,
              Label: query.Label,
              Timestamps: fixturePage.timestamps,
              Values: fixturePage.values,
              StatusCode: fixturePage.statusCode ?? "Complete",
              Messages: fixturePage.messages,
            })
          }
          return {
            MetricDataResults: results,
            NextToken: more ? `p${page + 1}` : undefined,
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

const AT = () => new Date("2026-08-13T09:00:30.000Z")

async function load(
  specs: readonly MetricQuerySpec[] = [backlogSpec()],
  options: FakeOptions = {},
  window: MetricWindow = WINDOW,
): Promise<MetricReadings> {
  return metricReadings(specs, window, fakeAws(options), { now: AT })
}

/** The whole surface as one string, which is what an operator actually reads. */
function surfaceText(readings: MetricReadings): string {
  return metricLines(readings)
    .map((line) => `${line.label}: ${line.text}`)
    .join("\n")
}

/** A climbing backlog, newest first — the trend an alarm in OK cannot show. */
function climbingBacklog(): MetricFixture {
  return {
    pages: [
      {
        timestamps: [
          "2026-08-13T08:57:00.000Z",
          "2026-08-13T08:56:00.000Z",
          "2026-08-13T08:55:00.000Z",
        ],
        values: [412, 190, 12],
      },
    ],
  }
}

beforeEach(() => {
  // resolveIdentity caches per process. Every case here supplies its own
  // gateway, which bypasses the cache, but a stale cache from another suite
  // would silently make these assertions test the wrong identity.
  __resetIdentity()
})

/* --------------------------------------------- the four outcomes, compared -- */

describe("the metric surface says something different for each of the four outcomes", () => {
  test("a populated read is ACTUAL and carries the numbers behind the alarm", async () => {
    const readings = await load([backlogSpec()], {
      metrics: { "AWS/SQS|ApproximateNumberOfMessagesVisible": climbingBacklog() },
    })

    expect(readings.series.state).toBe("ACTUAL")
    if (readings.series.state !== "ACTUAL") throw new Error("narrowing")
    const series = readings.series.value[0]

    // Ascending, from a fixture that arrived descending: the newest datapoint is
    // last, which is what `latest` means.
    expect(series.datapoints.map((d) => d.at)).toEqual([
      "2026-08-13T08:55:00.000Z",
      "2026-08-13T08:56:00.000Z",
      "2026-08-13T08:57:00.000Z",
    ])
    expect(series.summary.kind).toBe("datapoints")
    if (series.summary.kind !== "datapoints") throw new Error("narrowing")
    expect(series.summary.latest).toEqual({ at: "2026-08-13T08:57:00.000Z", value: 412 })
    expect(series.summary.earliest).toEqual({ at: "2026-08-13T08:55:00.000Z", value: 12 })
    expect(series.summary.min).toBe(12)
    expect(series.summary.max).toBe(412)
    expect(series.summary.mean).toBeCloseTo((412 + 190 + 12) / 3, 10)
    expect(series.summary.count).toBe(3)

    const text = surfaceText(readings)
    expect(text).toContain("latest 412 at 2026-08-13T08:57:00.000Z")
    expect(text).toContain("mean 204.667")
  })

  test("an empty-but-successful answer is EMPTY and says none, not refused", async () => {
    const readings = await load([backlogSpec()], { getMetricData: "empty" })
    expect(readings.series.state).toBe("EMPTY")
    const text = surfaceText(readings)
    expect(text).toContain("none —")
    expect(text).not.toContain("refused")
    expect(text).not.toContain("Minimum statement")
  })

  test("AccessDenied is DENIED, carries the principal, the action and a pasteable statement", async () => {
    const readings = await load([backlogSpec()], { getMetricData: "denied" })
    expect(readings.series.state).toBe("DENIED")
    if (readings.series.state !== "DENIED") throw new Error("narrowing")

    expect(readings.series.action).toBe("cloudwatch:GetMetricData")
    expect(readings.series.principal).toContain("assumed-role/tenure-studio-task")
    expect(readings.series.accountId).toBe(ACCOUNT)
    expect(readings.series.region).toBe(REGION)
    expect(readings.series.partition).toBe("aws")
    expect(JSON.parse(readings.series.minimumStatement)).toEqual({
      Effect: "Allow",
      Action: ["cloudwatch:GetMetricData"],
      Resource: "*",
    })

    // And the thing it must NOT be. There is no `value` on this arm at all, so
    // a caller cannot reach an empty array; the render says "unknown".
    expect("value" in readings.series).toBe(false)
    const text = surfaceText(readings)
    expect(text).toContain("unknown")
    expect(text).not.toMatch(/\bnone\b/)
  })

  test("a throttle is THROTTLED — its own state, not a failure and not an empty series", async () => {
    const readings = await load([backlogSpec()], { getMetricData: "throttled" })
    expect(readings.series.state).toBe("THROTTLED")
    if (readings.series.state !== "THROTTLED") throw new Error("narrowing")
    // The schedule is throttle.ts's — 200ms after the first failure, doubling —
    // not a number retyped in this module.
    expect(readings.series.retryAfterMs).toBe(800)
    const text = surfaceText(readings)
    expect(text).toContain("throttled")
    expect(text).toContain("retrying in")
    expect(text).not.toContain("Minimum statement")
  })

  test("the four render as four visibly different surfaces", async () => {
    const texts: string[] = []
    for (const outcome of ["populated", "empty", "denied", "throttled"] as const) {
      __resetIdentity()
      texts.push(
        surfaceText(
          await load([backlogSpec()], {
            getMetricData: outcome,
            metrics: { "AWS/SQS|ApproximateNumberOfMessagesVisible": climbingBacklog() },
          }),
        ),
      )
    }
    // Pairwise distinct. A fake that returned [] regardless would collapse at
    // least two of these into one string, and this is the assertion that
    // notices.
    expect(new Set(texts).size).toBe(4)
    for (const text of texts) expect(text.length).toBeGreaterThan(0)
  })
})

/* ------------------------------------------------------- a gap is not a zero -- */

describe("a missing datapoint is a gap, never a zero", () => {
  test("a metric that published nothing summarises as no-datapoints, not as 0", async () => {
    const readings = await load([backlogSpec()], {
      // The result IS returned — the query was answered — and it carries no
      // values. This is a metric that stopped being published.
      metrics: {
        "AWS/SQS|ApproximateNumberOfMessagesVisible": { pages: [{ timestamps: [], values: [] }] },
      },
    })

    expect(readings.series.state).toBe("ACTUAL")
    if (readings.series.state !== "ACTUAL") throw new Error("narrowing")
    const series = readings.series.value[0]
    expect(series.summary.kind).toBe("no-datapoints")
    expect(series.datapoints).toEqual([])
    expect(series.coverage.presentDatapoints).toBe(0)
    expect(series.coverage.expectedDatapoints).toBe(60)
    expect(series.coverage.missingDatapoints).toBe(60)

    const text = surfaceText(readings)
    expect(text).toContain("no datapoint")
    expect(text).toContain("it is not zero")
    // The one string that must never appear for a metric with no data.
    expect(text).not.toContain("latest 0")
    expect(text).not.toContain("mean 0")
  })

  test("a sparse series keeps its gaps and averages only what was published", async () => {
    const readings = await load([backlogSpec()], {
      metrics: {
        "AWS/SQS|ApproximateNumberOfMessagesVisible": {
          pages: [
            {
              // Three datapoints in a sixty-period window: 57 gaps.
              timestamps: [
                "2026-08-13T08:50:00.000Z",
                "2026-08-13T08:20:00.000Z",
                "2026-08-13T08:10:00.000Z",
              ],
              values: [30, 20, 10],
            },
          ],
        },
      },
    })

    if (readings.series.state !== "ACTUAL") throw new Error("narrowing")
    const series = readings.series.value[0]
    expect(series.datapoints).toHaveLength(3)
    expect(series.coverage.missingDatapoints).toBe(57)
    if (series.summary.kind !== "datapoints") throw new Error("narrowing")
    // 20, not 1 — the mean is over the three datapoints that exist, and a
    // gap-filling reader would have divided by sixty.
    expect(series.summary.mean).toBe(20)
    expect(surfaceText(readings)).toContain("57 of 60 period(s) published nothing — a gap, not a zero")
  })

  test("a datapoint CloudWatch returned unusably is counted, not paired with a zero", async () => {
    const readings = await load([backlogSpec()], {
      metrics: {
        "AWS/SQS|ApproximateNumberOfMessagesVisible": {
          pages: [
            {
              // Four timestamps, three values, and one of those is NaN. A reader
              // that zipped these blindly would invent two datapoints.
              timestamps: [
                "2026-08-13T08:50:00.000Z",
                "2026-08-13T08:40:00.000Z",
                "2026-08-13T08:30:00.000Z",
                "2026-08-13T08:20:00.000Z",
              ],
              values: [50, Number.NaN, 30],
            },
          ],
        },
      },
    })

    if (readings.series.state !== "ACTUAL") throw new Error("narrowing")
    const series = readings.series.value[0]
    expect(series.datapoints.map((d) => d.value)).toEqual([30, 50])
    expect(series.coverage.malformedDatapoints).toBe(2)
    if (series.summary.kind !== "datapoints") throw new Error("narrowing")
    expect(series.summary.mean).toBe(40)
    expect(surfaceText(readings)).toContain("2 datapoint(s) CloudWatch returned were not usable")
  })
})

/* --------------------------------------------- refused per metric, not per call -- */

describe("a metric refused inside a successful call is unknown, not empty", () => {
  test("StatusCode Forbidden reads as not-read and never as no data", async () => {
    const readings = await load([backlogSpec(), ageSpec()], {
      metrics: {
        "AWS/SQS|ApproximateNumberOfMessagesVisible": climbingBacklog(),
        "AWS/SQS|ApproximateAgeOfOldestMessage": {
          pages: [
            {
              timestamps: [],
              values: [],
              statusCode: "Forbidden",
              messages: [{ Code: "Forbidden", Value: "no permission to access AWS/SQS" }],
            },
          ],
        },
      },
    })

    if (readings.series.state !== "ACTUAL") throw new Error("narrowing")
    const [backlog, age] = readings.series.value

    // The sibling metric in the SAME call is unaffected: one refused detail does
    // not collapse the row.
    expect(backlog.summary.kind).toBe("datapoints")
    expect(backlog.status.kind).toBe("complete")

    expect(age.status.kind).toBe("not-read")
    if (age.status.kind !== "not-read") throw new Error("narrowing")
    expect(age.status.statusCode).toBe("Forbidden")
    expect(age.summary.kind).toBe("not-read")

    const text = surfaceText(readings)
    expect(text).toContain("refused this metric (Forbidden)")
    expect(text).toContain("Unknown, not zero")
    // A refused metric and an unpublished one must not read alike.
    const lines = metricLines(readings)
    const ageLine = lines.find((l) => l.label === "email-oldest")?.text ?? ""
    expect(ageLine).not.toContain("no datapoint —")
  })

  test("a query CloudWatch returned no result for at all is not-read, not no-data", async () => {
    const readings = await load([backlogSpec(), ageSpec()], {
      // Only the backlog has a fixture; the age query is answered with silence.
      metrics: { "AWS/SQS|ApproximateNumberOfMessagesVisible": climbingBacklog() },
    })
    if (readings.series.state !== "ACTUAL") throw new Error("narrowing")
    const age = readings.series.value[1]
    expect(age.status.kind).toBe("not-read")
    expect(age.summary.kind).toBe("not-read")
    expect(surfaceText(readings)).toContain("returned no result for \"email-oldest\"")
  })

  test("PartialData is its own state — a mean over a prefix says so", async () => {
    const readings = await load([backlogSpec()], {
      metrics: {
        "AWS/SQS|ApproximateNumberOfMessagesVisible": {
          pages: [
            {
              timestamps: ["2026-08-13T08:57:00.000Z"],
              values: [412],
              statusCode: "PartialData",
            },
          ],
        },
      },
    })
    if (readings.series.state !== "ACTUAL") throw new Error("narrowing")
    const series = readings.series.value[0]
    expect(series.status.kind).toBe("partial")
    // Still summarised — a prefix of a series is worth showing — but the text
    // carries the qualification.
    expect(series.summary.kind).toBe("datapoints")
    expect(surfaceText(readings)).toContain("PartialData")
  })
})

/* ------------------------------------------------------------- pagination -- */

describe("pagination completes, merges and admits when it stopped", () => {
  test("datapoints from every page belong to one series, and a boundary repeat is not counted twice", async () => {
    const readings = await load([backlogSpec()], {
      metrics: {
        "AWS/SQS|ApproximateNumberOfMessagesVisible": {
          pages: [
            {
              timestamps: ["2026-08-13T08:57:00.000Z", "2026-08-13T08:56:00.000Z"],
              values: [412, 190],
            },
            {
              // Page two repeats the boundary datapoint, which real pagination
              // does. Counting it twice would weight it double in the mean.
              timestamps: ["2026-08-13T08:56:00.000Z", "2026-08-13T08:55:00.000Z"],
              values: [190, 12],
            },
          ],
        },
      },
    })

    if (readings.series.state !== "ACTUAL") throw new Error("narrowing")
    const series = readings.series.value[0]
    expect(series.datapoints.map((d) => d.value)).toEqual([12, 190, 412])
    expect(readings.cost.requests).toBe(2)
    expect(readings.truncation.kind).toBe("complete")
  })

  test("hitting the page cap returns an explicit there-were-more signal", async () => {
    const readings = await load([backlogSpec()], {
      metrics: {
        "AWS/SQS|ApproximateNumberOfMessagesVisible": {
          endless: true,
          pages: [{ timestamps: ["2026-08-13T08:57:00.000Z"], values: [412] }],
        },
      },
    })

    expect(readings.truncation.kind).toBe("more-available")
    if (readings.truncation.kind !== "more-available") throw new Error("narrowing")
    expect(readings.truncation.pagesRead).toBe(MAX_PAGES_PER_BATCH)
    expect(readings.truncation.keys).toEqual(["email-backlog"])
    const text = surfaceText(readings)
    expect(text).toContain("TRUNCATED")
    expect(text).toContain("RECENT end of the window")
  })
})

/* --------------------------------------------------------------- batching -- */

describe("batching is bounded, and one refused batch does not collapse the rest", () => {
  test("more than one batch is sent as more than one request, at the API's limit", async () => {
    const specs: MetricQuerySpec[] = []
    for (let i = 0; i < MAX_QUERIES_PER_BATCH + 2; i += 1) {
      specs.push(backlogSpec({ key: `q${i}`, periodSeconds: 300 }))
    }
    const sentQueries: unknown[][] = []
    const readings = await load(specs, {
      sentQueries,
      metrics: { "AWS/SQS|ApproximateNumberOfMessagesVisible": climbingBacklog() },
    })

    expect(readings.cost.batches).toBe(2)
    expect(sentQueries).toHaveLength(2)
    expect(sentQueries[0]).toHaveLength(MAX_QUERIES_PER_BATCH)
    expect(sentQueries[1]).toHaveLength(2)
    if (readings.series.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.series.value).toHaveLength(MAX_QUERIES_PER_BATCH + 2)
  })

  test("a denied second batch names its keys and leaves the first batch readable", async () => {
    const specs: MetricQuerySpec[] = []
    for (let i = 0; i < MAX_QUERIES_PER_BATCH; i += 1) {
      specs.push(backlogSpec({ key: `q${i}`, periodSeconds: 300 }))
    }
    specs.push(ageSpec({ key: "denied-one", namespace: "AWS/Refused", periodSeconds: 300 }))

    const readings = await load(specs, {
      failNamespace: "AWS/Refused",
      metrics: { "AWS/SQS|ApproximateNumberOfMessagesVisible": climbingBacklog() },
    })

    // The 500 that answered are still ACTUAL. A single refused batch must not
    // turn the whole load UNKNOWN.
    expect(readings.series.state).toBe("ACTUAL")
    if (readings.series.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.series.value).toHaveLength(MAX_QUERIES_PER_BATCH)
    expect(readings.unreadableBatches).toHaveLength(1)
    expect(readings.unreadableBatches[0].keys).toEqual(["denied-one"])
    expect(readings.unreadableBatches[0].why).toContain("cloudwatch:GetMetricData")
    expect(readings.unreadableBatches[0].why).toContain("Minimum statement")

    const text = surfaceText(readings)
    expect(text).toContain("not read: denied-one")
    // And the refused batch is NOT counted as a metric this account was charged
    // for.
    expect(readings.cost.metricsRequested).toBe(MAX_QUERIES_PER_BATCH)
  })
})

/* ------------------------------------------------------- the window is demanded -- */

describe("an unbounded or nonsensical request is refused before any call is made", () => {
  async function refused(
    specs: readonly MetricQuerySpec[],
    window: MetricWindow,
  ): Promise<{ why: string; calls: string[] }> {
    const calls: string[] = []
    const readings = await metricReadings(specs, window, fakeAws({ calls }), { now: AT })
    expect(readings.series.state).toBe("UNCONFIGURED")
    if (readings.series.state !== "UNCONFIGURED") throw new Error("narrowing")
    return { why: readings.series.why, calls }
  }

  test("an unparseable window is refused and costs nothing", async () => {
    const { why, calls } = await refused([backlogSpec()], { startIso: "", endIso: "" })
    expect(why).toContain("two parseable ISO-8601 instants")
    // The point of refusing: GetMetricData is billed per metric per request.
    expect(calls).not.toContain("cloudwatch:GetMetricData")
    expect(calls).not.toContain("tag:GetResources")
  })

  test("a window wider than the cap is refused", async () => {
    const { why } = await refused([backlogSpec({ periodSeconds: 3600 })], {
      startIso: "2025-08-13T00:00:00.000Z",
      endIso: "2026-08-13T00:00:00.000Z",
    })
    expect(why).toContain("day(s) wide")
  })

  test("a backwards window is refused", async () => {
    const { why } = await refused([backlogSpec()], {
      startIso: WINDOW.endIso,
      endIso: WINDOW.startIso,
    })
    expect(why).toContain("ends at or before it starts")
  })

  test("a request implying more datapoints than the budget is refused, naming the number", async () => {
    const specs: MetricQuerySpec[] = []
    // 400 metrics at one datapoint per second over an hour is 1.44m datapoints.
    for (let i = 0; i < 400; i += 1) specs.push(backlogSpec({ key: `q${i}`, periodSeconds: 1 }))
    const { why, calls } = await refused(specs, WINDOW)
    expect(why).toContain(String(MAX_TOTAL_DATAPOINTS))
    expect(calls).not.toContain("cloudwatch:GetMetricData")
  })

  test("a period CloudWatch does not accept is refused rather than failing the whole batch", async () => {
    const { why } = await refused([backlogSpec({ periodSeconds: 45 })], WINDOW)
    expect(why).toContain("1, 5, 10, 20, 30 or any multiple of 60")
  })

  test("a statistic outside the closed set is refused", async () => {
    const { why } = await refused(
      [backlogSpec({ stat: "TM(10%:90%)" as unknown as MetricQuerySpec["stat"] })],
      WINDOW,
    )
    expect(why).toContain("which is not one of")
  })

  test("two queries under one key are refused", async () => {
    const { why } = await refused([backlogSpec(), backlogSpec()], WINDOW)
    expect(why).toContain("share the key")
  })

  test("no queries at all is refused — there is no default metric set", async () => {
    const { why } = await refused([], WINDOW)
    expect(why).toContain("no metric query was named")
  })

  test("validateRequest answers null for a request this engine will send", () => {
    expect(validateRequest([backlogSpec()], WINDOW)).toBeNull()
  })
})

/* ------------------------------------------------------------ attribution -- */

describe("attribution comes from a tag, and an unread tag index is not an untagged metric", () => {
  test("a resource ARN with a tenant tag attributes to that tenant", async () => {
    const readings = await load([backlogSpec({ resourceArn: QUEUE_ARN })], {
      metrics: { "AWS/SQS|ApproximateNumberOfMessagesVisible": climbingBacklog() },
      tags: {
        [QUEUE_ARN]: [
          { Key: "tenure:tenant", Value: "northgate" },
          { Key: "tenure:environment", Value: "production" },
        ],
      },
    })
    if (readings.series.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.series.value[0].attribution).toEqual({ kind: "tenant", tenantSlug: "northgate" })
    expect(surfaceText(readings)).toContain("northgate")
  })

  test("a denied tag index makes attribution unknown, never unattributable", async () => {
    const readings = await load([backlogSpec({ resourceArn: QUEUE_ARN })], {
      tagsOutcome: "denied",
      metrics: { "AWS/SQS|ApproximateNumberOfMessagesVisible": climbingBacklog() },
    })
    if (readings.series.state !== "ACTUAL") throw new Error("narrowing")
    const attribution = readings.series.value[0].attribution
    expect(attribution.kind).toBe("unknown")
    const text = surfaceText(readings)
    expect(text).toContain("attribution unknown")
    // The sentence that would send an operator to add a tag that is already
    // there.
    expect(text).not.toContain("unattributable — missing tenure:tenant")
    // And the metric itself still read.
    expect(readings.series.value[0].summary.kind).toBe("datapoints")
  })

  test("a resource the tag index answered about but does not list is unattributable", async () => {
    const readings = await load([backlogSpec({ resourceArn: QUEUE_ARN })], {
      tags: {},
      metrics: { "AWS/SQS|ApproximateNumberOfMessagesVisible": climbingBacklog() },
    })
    if (readings.series.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.series.value[0].attribution).toEqual({ kind: "unattributed" })
  })

  test("no resource ARN means the tag index is not called at all", async () => {
    const calls: string[] = []
    const readings = await metricReadings(
      [backlogSpec()],
      WINDOW,
      fakeAws({ calls, metrics: { "AWS/SQS|ApproximateNumberOfMessagesVisible": climbingBacklog() } }),
      { now: AT },
    )
    expect(calls).not.toContain("tag:GetResources")
    expect(readings.tagged.state).toBe("UNCONFIGURED")
    if (readings.series.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.series.value[0].attribution.kind).toBe("unknown")
  })
})

/* -------------------------------------------------- identity, cadence, as-of -- */

describe("region, partition and cadence come from what was resolved, never a literal", () => {
  test("a series carries the resolved region and partition", async () => {
    const readings = await load([backlogSpec()], {
      metrics: { "AWS/SQS|ApproximateNumberOfMessagesVisible": climbingBacklog() },
    })
    if (readings.series.state !== "ACTUAL") throw new Error("narrowing")
    const series = readings.series.value[0]
    expect(series.region).toBe(REGION)
    expect(series.partition).toBe("aws")
    expect(series.accountId).toBe(ACCOUNT)
    expect(surfaceText(readings)).toContain(`${REGION} (partition aws)`)
    expect(surfaceText(readings)).not.toContain("us-east-1")
  })

  test("an unresolved identity leaves region unknown rather than guessing one", async () => {
    const readings = await load([backlogSpec()], {
      identity: "denied",
      metrics: { "AWS/SQS|ApproximateNumberOfMessagesVisible": climbingBacklog() },
    })
    if (readings.series.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.series.value[0].region).toBeNull()
    expect(readings.series.value[0].partition).toBeNull()
    expect(surfaceText(readings)).toContain("region unknown — identity is unresolved")
  })

  test("the as-of and the cadence are the capability's own, and both render", async () => {
    const readings = await load([backlogSpec()], {
      metrics: { "AWS/SQS|ApproximateNumberOfMessagesVisible": climbingBacklog() },
    })
    expect(readings.asOf).toBe("2026-08-13T09:00:30.000Z")
    expect(readings.refreshMs).toBe(60_000)
    expect(surfaceText(readings)).toContain("refreshed every 60s")
  })

  test("timestamps are normalised to UTC whatever shape the SDK returned", async () => {
    const readings = await load([backlogSpec()], {
      metrics: {
        "AWS/SQS|ApproximateNumberOfMessagesVisible": {
          pages: [
            {
              // A Date, as the SDK actually hands back, and an offset string.
              timestamps: [new Date("2026-08-13T08:40:00.000Z"), "2026-08-13T10:30:00+02:00"],
              values: [8, 4],
            },
          ],
        },
      },
    })
    if (readings.series.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.series.value[0].datapoints.map((d) => d.at)).toEqual([
      "2026-08-13T08:30:00.000Z",
      "2026-08-13T08:40:00.000Z",
    ])
  })
})
