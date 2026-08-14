import {
  MAX_DASHBOARDS_READ,
  MAX_LIST_PAGES,
  classifyExpression,
  coverageOf,
  dashboardLines,
  dashboardReadings,
  parseAlarmArn,
  parseDashboardBody,
  unwatchedNamespaces,
  type DashboardReadings,
} from "./dashboards"
import { __resetIdentity } from "./identity"
import type { AwsGateway } from "./read"

/**
 * STUDIO-070-004 (CloudWatch dashboards) — the dashboard surface tells four
 * different truths apart, and a body it could not open never reads as a
 * dashboard watching nothing.
 *
 * The assertions are on `dashboardReadings` and `dashboardLines`, the functions
 * a route renders, rather than on `readAws` or on a private parser. A test that
 * drove a helper would stay green on the day this module stopped calling it,
 * which is the failure this programme has already paid for twice. The three
 * pure functions that ARE asserted directly — `parseDashboardBody`,
 * `classifyExpression`, `parseAlarmArn` — are also each reached through
 * `dashboardReadings` by at least one case above them, so a mutation inside one
 * reds a top-level test too.
 *
 * ## The stand-in is a client, not a stub
 *
 * `fakeAws` answers four capabilities with the shapes the real SDK returns —
 * `{DashboardEntries:[{DashboardName, DashboardArn, LastModified, Size}],
 * NextToken}` from ListDashboards, `{DashboardName, DashboardArn,
 * DashboardBody}` (a STRING) from GetDashboard, `{ResourceTagMappingList:[…]}`
 * from the Tagging API and `{Account, Arn}` from STS — and each can fail
 * independently with `AccessDeniedException`, `ThrottlingException`, an
 * empty-but-successful list, or a populated one. GetDashboard can fail for ONE
 * named dashboard while answering for another, which is the case a policy that
 * scopes the get actually produces. It READS the `DashboardName` it was sent and
 * answers per dashboard, so a stand-in returning `[]` regardless — the fake this
 * repository has already been burnt by — would collapse cases this suite asserts
 * are distinct.
 *
 * ## Nothing here is a real account
 *
 * `123456789012` is AWS's own documentation placeholder. Every ARN, dashboard
 * name and principal below is constructed for this file.
 */

/* -------------------------------------------------------------- the estate -- */

const ACCOUNT = "123456789012"
const REGION = "eu-west-2"
const PRINCIPAL = `arn:aws:sts::${ACCOUNT}:assumed-role/tenure-studio-task/session`
const OPS = "tenure-pilot-ops"
const OPS_ARN = `arn:aws:cloudwatch::${ACCOUNT}:dashboard/${OPS}`

/**
 * The body `infrastructure/terraform/cloudwatch.tf` actually renders, with the
 * Terraform interpolations resolved to constructed names. Four widgets: an ECS
 * metric, two ALB metrics in one widget, an RDS metric, and a Logs Insights
 * query. This is the fixture that proves the module answers the question the
 * live dashboard exists to answer.
 */
const TERRAFORM_BODY = JSON.stringify({
  widgets: [
    {
      type: "metric",
      properties: {
        title: "ECS Running Tasks",
        region: REGION,
        period: 60,
        metrics: [
          [
            "ECS/ContainerInsights",
            "RunningTaskCount",
            "ClusterName",
            "tenure-pilot-cluster",
            "ServiceName",
            "tenure-pilot-app",
          ],
        ],
      },
    },
    {
      type: "metric",
      properties: {
        title: "ALB Request Count + 5xx",
        region: REGION,
        period: 60,
        metrics: [
          ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", "app/tenure-pilot/0123456789abcdef"],
          [
            "AWS/ApplicationELB",
            "HTTPCode_Target_5XX_Count",
            "LoadBalancer",
            "app/tenure-pilot/0123456789abcdef",
          ],
        ],
      },
    },
    {
      type: "metric",
      properties: {
        title: "RDS CPU",
        region: REGION,
        period: 60,
        metrics: [["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", "tenure-pilot-postgres"]],
      },
    },
    {
      type: "log",
      properties: {
        title: "App Errors (last 1h)",
        query:
          "SOURCE '/ecs/tenure-pilot-app' | filter @message like /ERROR/ | sort @timestamp desc | limit 50",
        region: REGION,
        view: "table",
      },
    },
  ],
})

/* -------------------------------------------------------------- the client -- */

type Outcome = "populated" | "empty" | "denied" | "throttled"

interface FakeDashboard {
  name: string
  arn?: string | null
  lastModified?: string | Date
  size?: number
  /** The body string GetDashboard hands back. Omitted means the key is absent. */
  body?: string
  /** This ONE dashboard's get fails, while the others answer. */
  get?: "denied" | "throttled" | "error"
}

interface FakeOptions {
  list?: Outcome
  dashboards?: FakeDashboard[]
  /** Entries per ListDashboards page. Default: all of them in one page. */
  pageSize?: number
  /** Always hands back a NextToken, however many pages have been read. */
  endlessList?: boolean
  tags?: Record<string, Array<{ Key: string; Value: string }>>
  tagsOutcome?: Outcome
  identity?: { arn: string; account: string; region: string } | "denied"
  /** Set by the fake so a test can assert what was and was not called. */
  calls?: string[]
  /** Every DashboardName the fake was asked to get, in order. */
  gets?: string[]
}

function throwing(name: string): never {
  const error = new Error(`${name} raised by the stand-in AWS client`)
  error.name = name
  throw error
}

function fakeAws(options: FakeOptions = {}): AwsGateway {
  const list = options.list ?? "populated"
  const dashboards = options.dashboards ?? []
  const identity = options.identity ?? { arn: PRINCIPAL, account: ACCOUNT, region: REGION }
  const calls = options.calls ?? []
  const gets = options.gets ?? []

  return {
    async call(capability, input) {
      calls.push(String(capability))
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

        case "cloudwatch:ListDashboards": {
          if (list === "denied") throwing("AccessDeniedException")
          if (list === "throttled") throwing("ThrottlingException")
          // What AWS actually sends when the account has no dashboards: the key
          // is present and empty.
          if (list === "empty") return { DashboardEntries: [] }

          const token = (input as { NextToken?: unknown })?.NextToken
          const page = typeof token === "string" ? Number(token.replace("p", "")) : 0
          const size = options.pageSize ?? Math.max(dashboards.length, 1)
          const slice = dashboards.slice(page * size, page * size + size)
          const more = options.endlessList || (page + 1) * size < dashboards.length
          return {
            DashboardEntries: slice.map((d) => ({
              DashboardName: d.name,
              DashboardArn: d.arn === null ? undefined : (d.arn ?? `arn:aws:cloudwatch::${ACCOUNT}:dashboard/${d.name}`),
              LastModified: d.lastModified,
              Size: d.size,
            })),
            NextToken: more ? `p${page + 1}` : undefined,
          }
        }

        case "cloudwatch:GetDashboard": {
          const name = String((input as { DashboardName?: unknown })?.DashboardName ?? "")
          gets.push(name)
          const found = dashboards.find((d) => d.name === name)
          if (!found) throwing("ResourceNotFound")
          if (found.get === "denied") throwing("AccessDeniedException")
          if (found.get === "throttled") throwing("ThrottlingException")
          if (found.get === "error") throwing("InvalidParameterValueException")
          return {
            DashboardName: name,
            DashboardArn: found.arn ?? `arn:aws:cloudwatch::${ACCOUNT}:dashboard/${name}`,
            DashboardBody: found.body,
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

async function load(options: FakeOptions = {}, namePrefix?: string): Promise<DashboardReadings> {
  return dashboardReadings(fakeAws(options), { now: AT, namePrefix })
}

/** The whole surface as one string, which is what an operator actually reads. */
function surfaceText(readings: DashboardReadings): string {
  return dashboardLines(readings)
    .map((line) => `${line.label}: ${line.text}`)
    .join("\n")
}

function opsDashboard(overrides: Partial<FakeDashboard> = {}): FakeDashboard {
  return {
    name: OPS,
    arn: OPS_ARN,
    lastModified: "2026-07-04T11:22:33.000Z",
    size: TERRAFORM_BODY.length,
    body: TERRAFORM_BODY,
    ...overrides,
  }
}

beforeEach(() => {
  // resolveIdentity caches per process. Every case here supplies its own
  // gateway, which bypasses the cache, but a stale cache from another suite
  // would silently make these assertions test the wrong identity.
  __resetIdentity()
})

/* --------------------------------------------- the four outcomes, compared -- */

describe("the dashboard surface says something different for each of the four outcomes", () => {
  test("a populated read is ACTUAL and says what the dashboard actually watches", async () => {
    const readings = await load({ dashboards: [opsDashboard()] })

    expect(readings.dashboards.state).toBe("ACTUAL")
    if (readings.dashboards.state !== "ACTUAL") throw new Error("narrowing")
    const row = readings.dashboards.value[0]

    expect(row.name).toBe(OPS)
    expect(row.arn).toBe(OPS_ARN)
    expect(row.lastModified).toBe("2026-07-04T11:22:33.000Z")
    expect(row.sizeBytes).toBe(TERRAFORM_BODY.length)

    expect(row.content.kind).toBe("watching")
    if (row.content.kind !== "watching") throw new Error("narrowing")
    expect(row.content.widgets).toHaveLength(4)
    // The whole point: the namespaces are DATA, so a surface can subtract them
    // from the inventory rather than eyeball a JSON blob.
    expect(row.content.namespaces).toEqual([
      "AWS/ApplicationELB",
      "AWS/RDS",
      "ECS/ContainerInsights",
    ])
    expect(row.content.logGroups).toEqual(["/ecs/tenure-pilot-app"])
    expect(row.content.alarmNames).toEqual([])
    expect(row.content.unresolved).toEqual([])

    // Dimensions are parsed down to the resource, which is how "points at a
    // service that no longer exists" becomes answerable.
    expect(row.content.widgets[0].metrics[0]).toEqual({
      namespace: "ECS/ContainerInsights",
      metricName: "RunningTaskCount",
      dimensions: [
        { name: "ClusterName", value: "tenure-pilot-cluster" },
        { name: "ServiceName", value: "tenure-pilot-app" },
      ],
    })

    expect(readings.coverage.kind).toBe("complete")
    const text = surfaceText(readings)
    expect(text).toContain("AWS/ApplicationELB")
    expect(text).toContain("/ecs/tenure-pilot-app")
  })

  test("an empty-but-successful list is EMPTY and says none, not refused", async () => {
    const readings = await load({ list: "empty" })
    expect(readings.dashboards.state).toBe("EMPTY")
    const text = surfaceText(readings)
    expect(text).toContain("none —")
    expect(text).not.toContain("refused")
    expect(text).not.toContain("Minimum statement")
    // "There are no dashboards" IS a claim, and it is the loudest one this
    // surface can make: everything in the estate is on no dashboard.
    expect(readings.coverage.kind).toBe("complete")
    if (readings.coverage.kind !== "complete") throw new Error("narrowing")
    expect(readings.coverage.namespaces).toEqual([])
  })

  test("AccessDenied is DENIED, carries the principal, the action and a pasteable statement", async () => {
    const readings = await load({ list: "denied" })
    expect(readings.dashboards.state).toBe("DENIED")
    if (readings.dashboards.state !== "DENIED") throw new Error("narrowing")

    expect(readings.dashboards.action).toBe("cloudwatch:ListDashboards")
    expect(readings.dashboards.principal).toContain("assumed-role/tenure-studio-task")
    expect(readings.dashboards.accountId).toBe(ACCOUNT)
    expect(readings.dashboards.region).toBe(REGION)
    expect(readings.dashboards.partition).toBe("aws")
    expect(JSON.parse(readings.dashboards.minimumStatement)).toEqual({
      Effect: "Allow",
      Action: ["cloudwatch:ListDashboards"],
      Resource: "*",
    })

    // There is no `value` on this arm at all, so a caller cannot reach an empty
    // array. And coverage refuses to be a set.
    expect("value" in readings.dashboards).toBe(false)
    expect(readings.coverage.kind).toBe("not-read")
    const text = surfaceText(readings)
    expect(text).toContain("unknown")
    expect(text).not.toMatch(/\bnone\b/)
  })

  test("a throttle is THROTTLED — its own state, not a failure and not an empty list", async () => {
    const readings = await load({ list: "throttled" })
    expect(readings.dashboards.state).toBe("THROTTLED")
    if (readings.dashboards.state !== "THROTTLED") throw new Error("narrowing")
    // The schedule is throttle.ts's — 200ms after the first failure, doubling —
    // not a number retyped in this module.
    expect(readings.dashboards.retryAfterMs).toBe(800)
    const text = surfaceText(readings)
    expect(text).toContain("throttled")
    expect(text).toContain("retrying in")
    expect(text).not.toContain("Minimum statement")
    expect(readings.coverage.kind).toBe("not-read")
  })

  test("the four render as four visibly different surfaces", async () => {
    const texts: string[] = []
    for (const outcome of ["populated", "empty", "denied", "throttled"] as const) {
      __resetIdentity()
      texts.push(surfaceText(await load({ list: outcome, dashboards: [opsDashboard()] })))
    }
    // Pairwise distinct. A fake that returned [] regardless would collapse at
    // least two of these into one string, and this is the assertion that
    // notices.
    expect(new Set(texts).size).toBe(4)
    for (const text of texts) expect(text.length).toBeGreaterThan(0)
  })
})

/* ------------------------------------------- a body that would not open -- */

describe("a dashboard whose body could not be read never reads as one watching nothing", () => {
  test("a denied GetDashboard degrades that row alone and leaves the others parsed", async () => {
    const readings = await load({
      dashboards: [
        opsDashboard(),
        { name: "tenure-pilot-secret", arn: `arn:aws:cloudwatch::${ACCOUNT}:dashboard/tenure-pilot-secret`, get: "denied" },
      ],
    })

    // The load as a whole is still ACTUAL: one refused detail does not collapse
    // the surface.
    expect(readings.dashboards.state).toBe("ACTUAL")
    if (readings.dashboards.state !== "ACTUAL") throw new Error("narrowing")
    const [ops, secret] = readings.dashboards.value

    expect(ops.content.kind).toBe("watching")
    expect(secret.content.kind).toBe("not-read")
    if (secret.content.kind !== "not-read") throw new Error("narrowing")
    expect(secret.content.why).toContain("cloudwatch:GetDashboard")
    expect(secret.content.why).toContain("Minimum statement")
    // The row keeps everything the LISTING knew about it.
    expect(secret.name).toBe("tenure-pilot-secret")

    // And the coverage set stops being a claim.
    expect(readings.coverage.kind).toBe("partial")
    if (readings.coverage.kind !== "partial") throw new Error("narrowing")
    expect(readings.coverage.incompleteDashboards).toEqual(["tenure-pilot-secret"])
    expect(readings.coverage.namespaces).toContain("AWS/RDS")

    const text = surfaceText(readings)
    expect(text).toContain("PARTIAL")
    // The two sentences a refused body must never be worded as.
    expect(text).not.toContain("tenure-pilot-secret — watches nothing")
    const line = dashboardLines(readings).find((l) => l.label === "tenure-pilot-secret")?.text ?? ""
    expect(line).toContain("unknown")
    expect(line).not.toContain("watches nothing")
  })

  test("a throttled GetDashboard is its own state on that row, not a denial and not an absence", async () => {
    const readings = await load({
      dashboards: [opsDashboard(), { name: "tenure-pilot-busy", get: "throttled" }],
    })
    if (readings.dashboards.state !== "ACTUAL") throw new Error("narrowing")
    const busy = readings.dashboards.value[1]
    expect(busy.content.kind).toBe("not-read")
    if (busy.content.kind !== "not-read") throw new Error("narrowing")
    expect(busy.content.why).toContain("throttled")
    expect(busy.content.why).toContain("retrying in")
    expect(busy.content.why).not.toContain("Minimum statement")
  })

  test("a malformed body is a state, not a crash, and not a dashboard watching nothing", async () => {
    const readings = await load({
      dashboards: [opsDashboard({ name: "tenure-pilot-broken", body: '{"widgets": [ {"type":' })],
    })
    if (readings.dashboards.state !== "ACTUAL") throw new Error("narrowing")
    const row = readings.dashboards.value[0]
    expect(row.content.kind).toBe("malformed")
    if (row.content.kind !== "malformed") throw new Error("narrowing")
    expect(row.content.why).toContain("not JSON this reader can parse")
    expect(row.content.excerpt).toContain("widgets")
    expect(readings.coverage.kind).toBe("partial")
    expect(surfaceText(readings)).not.toContain("watches nothing")
  })

  test("a body with an empty widget list IS a dashboard watching nothing, and says so", async () => {
    const readings = await load({
      dashboards: [opsDashboard({ name: "tenure-pilot-emptied", body: '{"widgets":[]}' })],
    })
    if (readings.dashboards.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.dashboards.value[0].content.kind).toBe("watching-nothing")
    // This one is a claim, so it does NOT make coverage partial.
    expect(readings.coverage.kind).toBe("complete")
    expect(surfaceText(readings)).toContain("watches nothing")
  })

  test("a body with no widgets key at all is malformed, not an emptied dashboard", async () => {
    const readings = await load({
      dashboards: [opsDashboard({ name: "tenure-pilot-odd", body: '{"periodOverride":"auto"}' })],
    })
    if (readings.dashboards.state !== "ACTUAL") throw new Error("narrowing")
    const content = readings.dashboards.value[0].content
    expect(content.kind).toBe("malformed")
    if (content.kind !== "malformed") throw new Error("narrowing")
    expect(content.why).toContain("declares no `widgets` key")
  })

  test("GetDashboard answering with no body at all is malformed, never watching-nothing", async () => {
    const readings = await load({ dashboards: [opsDashboard({ body: undefined })] })
    if (readings.dashboards.state !== "ACTUAL") throw new Error("narrowing")
    const content = readings.dashboards.value[0].content
    expect(content.kind).toBe("malformed")
    if (content.kind !== "malformed") throw new Error("narrowing")
    expect(content.why).toContain("returned no DashboardBody")
  })
})

/* ------------------------------------------------------------ the parser -- */

describe("the body is parsed down to what each widget references", () => {
  test("the console's \".\" and \"...\" shorthand resolves against the previous entry", async () => {
    const body = JSON.stringify({
      widgets: [
        {
          type: "metric",
          properties: {
            title: "Per-instance CPU",
            metrics: [
              ["AWS/EC2", "CPUUtilization", "InstanceId", "i-0aaaaaaaaaaaaaaa0", { stat: "Average" }],
              [".", ".", ".", "i-0bbbbbbbbbbbbbbb1"],
              ["...", "i-0ccccccccccccccc2"],
            ],
          },
        },
      ],
    })
    const readings = await load({ dashboards: [opsDashboard({ body })] })
    if (readings.dashboards.state !== "ACTUAL") throw new Error("narrowing")
    const content = readings.dashboards.value[0].content
    if (content.kind !== "watching") throw new Error("narrowing")

    // Three real metrics — not a metric in the namespace "." and not a metric
    // in the namespace "...", which is what a literal reader would report.
    expect(content.widgets[0].metrics.map((m) => m.dimensions[0].value)).toEqual([
      "i-0aaaaaaaaaaaaaaa0",
      "i-0bbbbbbbbbbbbbbb1",
      "i-0ccccccccccccccc2",
    ])
    expect(content.namespaces).toEqual(["AWS/EC2"])
    expect(content.unresolved).toEqual([])
  })

  test("shorthand with nothing to stand for is a named problem, not an invented namespace", () => {
    const content = parseDashboardBody(
      JSON.stringify({
        widgets: [{ type: "metric", properties: { metrics: [[".", ".", ".", "i-0aaaa"]] } }],
      }),
    )
    if (content.kind !== "watching") throw new Error("narrowing")
    expect(content.namespaces).toEqual([])
    expect(content.unresolved.join(" ")).toContain('uses the "." shorthand')
  })

  test("alarm ARNs become names a surface can join against alarms.ts", async () => {
    const body = JSON.stringify({
      widgets: [
        {
          type: "alarm",
          properties: {
            title: "Pilot alarms",
            alarms: [
              `arn:aws:cloudwatch:${REGION}:${ACCOUNT}:alarm:tenure-pilot-dlq-not-empty`,
              `arn:aws:cloudwatch:${REGION}:${ACCOUNT}:alarm:tenure-pilot-5xx`,
            ],
          },
        },
        {
          type: "metric",
          properties: {
            metrics: [["AWS/RDS", "CPUUtilization"]],
            annotations: {
              alarms: [`arn:aws:cloudwatch:${REGION}:${ACCOUNT}:alarm:tenure-pilot-rds-cpu`],
            },
          },
        },
      ],
    })
    const readings = await load({ dashboards: [opsDashboard({ body })] })
    if (readings.dashboards.state !== "ACTUAL") throw new Error("narrowing")
    const content = readings.dashboards.value[0].content
    if (content.kind !== "watching") throw new Error("narrowing")
    expect(content.alarmNames).toEqual([
      "tenure-pilot-5xx",
      "tenure-pilot-dlq-not-empty",
      "tenure-pilot-rds-cpu",
    ])
    expect(content.widgets[0].alarms[0].region).toBe(REGION)
    expect(content.widgets[0].alarms[0].accountId).toBe(ACCOUNT)
    expect(content.unresolved).toEqual([])
  })

  test("a string that is not an alarm ARN is reported, never turned into a name", () => {
    expect(parseAlarmArn("tenure-pilot-5xx")).toEqual({
      arn: "tenure-pilot-5xx",
      name: null,
      region: null,
      accountId: null,
    })
    // An alarm name may itself contain a colon; the name is everything after
    // the `alarm:` segment, not the last field.
    expect(parseAlarmArn(`arn:aws:cloudwatch:${REGION}:${ACCOUNT}:alarm:tenure:pilot:5xx`).name).toBe(
      "tenure:pilot:5xx",
    )
    const content = parseDashboardBody(
      JSON.stringify({ widgets: [{ type: "alarm", properties: { alarms: ["tenure-pilot-5xx"] } }] }),
    )
    if (content.kind !== "watching") throw new Error("narrowing")
    expect(content.alarmNames).toEqual([])
    expect(content.unresolved.join(" ")).toContain("not shaped like an alarm ARN")
  })

  test("metric math over widget ids costs coverage nothing; a SEARCH names its namespace", () => {
    expect(classifyExpression("(m1/m2)*100")).toEqual({ kind: "arithmetic" })
    expect(classifyExpression("SEARCH('{AWS/ECS,ClusterName} MetricName=\"CPUUtilization\"', 'Average')")).toEqual(
      { kind: "search", namespaces: ["AWS/ECS"] },
    )
    const dynamic = classifyExpression("SEARCH(namespaceVariable, 'Average')")
    expect(dynamic.kind).toBe("unresolved")
  })

  test("an unresolvable SEARCH makes the coverage answer partial rather than confident", async () => {
    const body = JSON.stringify({
      widgets: [
        {
          type: "metric",
          properties: {
            metrics: [
              ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", "tenure-pilot-postgres"],
              [{ expression: "SEARCH(chosenNamespace, 'Average')", id: "e1", label: "everything else" }],
            ],
          },
        },
      ],
    })
    const readings = await load({ dashboards: [opsDashboard({ body })] })
    if (readings.dashboards.state !== "ACTUAL") throw new Error("narrowing")
    const content = readings.dashboards.value[0].content
    if (content.kind !== "watching") throw new Error("narrowing")
    // What it could read, it read.
    expect(content.namespaces).toEqual(["AWS/RDS"])
    // And what it could not, it says.
    expect(content.unresolved.join(" ")).toContain("assembled rather than written out")
    expect(readings.coverage.kind).toBe("partial")
    expect(surfaceText(readings)).toContain("PARTIAL")
  })

  test("a widget type this reader does not walk reduces what the surface claims", async () => {
    const body = JSON.stringify({
      widgets: [
        { type: "explorer", properties: { metrics: [{ metricName: "CPUUtilization", resourceType: "AWS::EC2::Instance" }] } },
      ],
    })
    const readings = await load({ dashboards: [opsDashboard({ body })] })
    if (readings.dashboards.state !== "ACTUAL") throw new Error("narrowing")
    const content = readings.dashboards.value[0].content
    if (content.kind !== "watching") throw new Error("narrowing")
    expect(content.unresolved.join(" ")).toContain('type "explorer"')
    expect(readings.coverage.kind).toBe("partial")
  })

  test("a metric widget referencing nothing at all is a finding, not a silence", () => {
    const content = parseDashboardBody(
      JSON.stringify({ widgets: [{ type: "metric", properties: { title: "Empty chart" } }] }),
    )
    if (content.kind !== "watching") throw new Error("narrowing")
    expect(content.unresolved.join(" ")).toContain("renders an empty chart")
  })

  test("a widget naming another region carries it, so a cross-region dashboard is visible", async () => {
    const body = JSON.stringify({
      widgets: [
        {
          type: "metric",
          properties: {
            region: "us-east-1",
            metrics: [["AWS/CloudFront", "Requests", "DistributionId", "E123EXAMPLE"]],
          },
        },
      ],
    })
    const readings = await load({ dashboards: [opsDashboard({ body })] })
    if (readings.dashboards.state !== "ACTUAL") throw new Error("narrowing")
    const content = readings.dashboards.value[0].content
    if (content.kind !== "watching") throw new Error("narrowing")
    expect(content.regions).toEqual(["us-east-1"])
    // The ROW's region is still the resolved one; the widget's is the widget's.
    expect(readings.dashboards.value[0].region).toBe(REGION)
    expect(surfaceText(readings)).toContain("widget regions: us-east-1")
  })
})

/* -------------------------------------------------------------- coverage -- */

describe("the coverage set refuses to answer a set difference it cannot answer", () => {
  test("a complete coverage set decides which namespaces are on no dashboard", async () => {
    const readings = await load({ dashboards: [opsDashboard()] })
    const answer = unwatchedNamespaces(readings.coverage, [
      "AWS/RDS",
      "AWS/SQS",
      "AWS/Lambda",
      "ECS/ContainerInsights",
    ])
    expect(answer.kind).toBe("decidable")
    if (answer.kind !== "decidable") throw new Error("narrowing")
    expect(answer.namespaces).toEqual(["AWS/Lambda", "AWS/SQS"])
  })

  test("a partial coverage set refuses to decide, and names the shortlist differently", async () => {
    const readings = await load({
      dashboards: [opsDashboard(), { name: "tenure-pilot-secret", get: "denied" }],
    })
    const answer = unwatchedNamespaces(readings.coverage, ["AWS/RDS", "AWS/SQS"])
    expect(answer.kind).toBe("undecidable")
    if (answer.kind !== "undecidable") throw new Error("narrowing")
    expect(answer.notOnAnyDashboardRead).toEqual(["AWS/SQS"])
    expect(answer.why).toContain("INCOMPLETE")
  })

  test("a denied listing makes every namespace undecidable, not unwatched", async () => {
    const readings = await load({ list: "denied" })
    const answer = unwatchedNamespaces(readings.coverage, ["AWS/RDS", "AWS/SQS"])
    expect(answer.kind).toBe("undecidable")
    if (answer.kind !== "undecidable") throw new Error("narrowing")
    expect(answer.notOnAnyDashboardRead).toEqual(["AWS/RDS", "AWS/SQS"])
    expect(answer.why).toContain("cloudwatch:ListDashboards")
  })

  test("no dashboards at all decides that everything is unwatched", async () => {
    const readings = await load({ list: "empty" })
    const answer = unwatchedNamespaces(readings.coverage, ["AWS/RDS", "AWS/SQS"])
    expect(answer.kind).toBe("decidable")
    if (answer.kind !== "decidable") throw new Error("narrowing")
    expect(answer.namespaces).toEqual(["AWS/RDS", "AWS/SQS"])
  })

  test("coverageOf is the same arithmetic a surface holding rows would get", async () => {
    const readings = await load({ dashboards: [opsDashboard()] })
    expect(coverageOf(readings.dashboards, readings.truncation)).toEqual(readings.coverage)
  })
})

/* ------------------------------------------------------------ pagination -- */

describe("the listing paginates to completion, with a bound that announces itself", () => {
  test("dashboards from every page are read, and every body is opened", async () => {
    const readings = await load({
      pageSize: 2,
      dashboards: [
        opsDashboard({ name: "d1" }),
        opsDashboard({ name: "d2" }),
        opsDashboard({ name: "d3" }),
        opsDashboard({ name: "d4" }),
        opsDashboard({ name: "d5" }),
      ],
    })
    if (readings.dashboards.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.dashboards.value.map((r) => r.name)).toEqual(["d1", "d2", "d3", "d4", "d5"])
    expect(readings.truncation.kind).toBe("complete")
  })

  test("hitting the page cap returns an explicit there-were-more signal", async () => {
    const readings = await load({
      endlessList: true,
      pageSize: 1,
      dashboards: [opsDashboard({ name: "d1" })],
    })
    expect(readings.truncation.kind).toBe("more-available")
    if (readings.truncation.kind !== "more-available") throw new Error("narrowing")
    expect(readings.truncation.pagesRead).toBe(MAX_LIST_PAGES)
    expect(surfaceText(readings)).toContain("TRUNCATED")
    // A truncated listing is not a complete coverage set.
    expect(readings.coverage.kind).toBe("partial")
  })

  test("more dashboards than the body budget leaves the rest visible and unopened", async () => {
    const many: FakeDashboard[] = []
    for (let i = 0; i < MAX_DASHBOARDS_READ + 3; i += 1) {
      many.push(opsDashboard({ name: `d${String(i).padStart(3, "0")}` }))
    }
    const gets: string[] = []
    const readings = await load({ dashboards: many, gets })

    expect(gets).toHaveLength(MAX_DASHBOARDS_READ)
    if (readings.dashboards.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.dashboards.value).toHaveLength(MAX_DASHBOARDS_READ + 3)
    const last = readings.dashboards.value[MAX_DASHBOARDS_READ + 2]
    expect(last.content.kind).toBe("not-read")
    if (last.content.kind !== "not-read") throw new Error("narrowing")
    expect(last.content.why).toContain("was not opened")
    expect(readings.truncation.kind).toBe("more-available")
    if (readings.truncation.kind !== "more-available") throw new Error("narrowing")
    expect(readings.truncation.opened).toBe(MAX_DASHBOARDS_READ)
    expect(readings.truncation.listed).toBe(MAX_DASHBOARDS_READ + 3)
  })

  test("a name prefix narrows what is opened, and nothing outside it is fetched", async () => {
    const gets: string[] = []
    const readings = await load(
      { gets, dashboards: [opsDashboard({ name: "tenure-pilot-ops" }), opsDashboard({ name: "someone-elses" })] },
      "tenure-",
    )
    expect(gets).toEqual(["tenure-pilot-ops"])
    if (readings.dashboards.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.dashboards.value).toHaveLength(1)
  })
})

/* --------------------------------------------------------- attribution -- */

describe("attribution comes from a tag, and an unread tag index is not an untagged dashboard", () => {
  test("a dashboard ARN with a tenant tag attributes to that tenant", async () => {
    const readings = await load({
      dashboards: [opsDashboard()],
      tags: {
        [OPS_ARN]: [
          { Key: "tenure:tenant", Value: "northgate" },
          { Key: "tenure:environment", Value: "production" },
        ],
      },
    })
    if (readings.dashboards.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.dashboards.value[0].attribution).toEqual({ kind: "tenant", tenantSlug: "northgate" })
    expect(surfaceText(readings)).toContain("northgate")
  })

  test("a denied tag index makes attribution unknown, never unattributable", async () => {
    const readings = await load({ dashboards: [opsDashboard()], tagsOutcome: "denied" })
    if (readings.dashboards.state !== "ACTUAL") throw new Error("narrowing")
    const attribution = readings.dashboards.value[0].attribution
    expect(attribution.kind).toBe("unknown")
    const text = surfaceText(readings)
    expect(text).toContain("attribution unknown")
    // The sentence that would send an operator to add a tag that is already there.
    expect(text).not.toContain("unattributable — missing tenure:tenant")
    // And the dashboard itself still parsed.
    expect(readings.dashboards.value[0].content.kind).toBe("watching")
  })

  test("a dashboard the tag index answered about but does not list is unattributable", async () => {
    const readings = await load({ dashboards: [opsDashboard()], tags: {} })
    if (readings.dashboards.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.dashboards.value[0].attribution).toEqual({ kind: "unattributed" })
  })

  test("no listing means the tagging API is not called at all", async () => {
    const calls: string[] = []
    const readings = await dashboardReadings(fakeAws({ calls, list: "empty" }), { now: AT })
    expect(calls).not.toContain("tag:GetResources")
    expect(readings.tagged.state).toBe("UNCONFIGURED")
  })
})

/* -------------------------------------------------- identity, cadence, as-of -- */

describe("region, partition and cadence come from what was resolved, never a literal", () => {
  test("a row carries the resolved region, partition and account", async () => {
    const readings = await load({ dashboards: [opsDashboard()] })
    if (readings.dashboards.state !== "ACTUAL") throw new Error("narrowing")
    const row = readings.dashboards.value[0]
    expect(row.region).toBe(REGION)
    expect(row.partition).toBe("aws")
    expect(row.accountId).toBe(ACCOUNT)
    expect(surfaceText(readings)).toContain(`${REGION} (partition aws)`)
    expect(surfaceText(readings)).not.toContain("us-east-1")
  })

  test("an unresolved identity leaves region unknown rather than guessing one", async () => {
    const readings = await load({ identity: "denied", dashboards: [opsDashboard()] })
    if (readings.dashboards.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.dashboards.value[0].region).toBeNull()
    expect(readings.dashboards.value[0].partition).toBeNull()
    expect(surfaceText(readings)).toContain("region unknown — identity is unresolved")
  })

  test("the as-of and the cadence are the capability's own, and both render", async () => {
    const readings = await load({ dashboards: [opsDashboard()] })
    expect(readings.asOf).toBe("2026-08-13T09:00:30.000Z")
    expect(readings.refreshMs).toBe(900_000)
    expect(surfaceText(readings)).toContain("refreshed every 900s")
  })

  test("a listing timestamp arrives as the SDK sends it and normalises to UTC", async () => {
    const readings = await load({
      dashboards: [
        opsDashboard({ name: "d-date", lastModified: new Date("2026-07-04T11:22:33.000Z") }),
        opsDashboard({ name: "d-offset", lastModified: "2026-07-04T13:22:33+02:00" }),
        opsDashboard({ name: "d-none", lastModified: undefined }),
      ],
    })
    if (readings.dashboards.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.dashboards.value.map((r) => r.lastModified)).toEqual([
      "2026-07-04T11:22:33.000Z",
      "2026-07-04T11:22:33.000Z",
      null,
    ])
    expect(surfaceText(readings)).toContain("last modified unknown")
  })
})
