/**
 * The fleet-health verdict, driven through every ranking rule it encodes.
 *
 * Runs through apps/web's jest — `apps/system-studio` has no jest of its own and
 * its `src` is one of that config's `roots`. Nothing here reaches AWS: the
 * composition under test is pure, and the one async case injects a
 * `FleetHealthReaders` whose six methods are functions in this file.
 *
 * Every identifier is constructed. `123456789012` is AWS's documentation
 * account, the hosts are RFC 2606 reserved names, and no load balancer, cluster,
 * target group or database named here corresponds to a real resource.
 *
 * The cases are the RULES, one per rule, plus the ones that stop each rule being
 * satisfiable by accident:
 *
 *   · AWS outranks our alarms — and an event against a service we were NOT
 *     shown to use does not, which is what stops rule 1 from being "any AWS
 *     event at all wins".
 *   · A muted alarm outranks OK — and the case is built with every other source
 *     healthy, so `UNTRUSTED` can only have come from the mute.
 *   · Zero healthy targets outranks a firing alarm — asserted as an ORDER over
 *     two findings, not as the presence of one.
 *   · A metric with no data is a finding whose sentence forbids rendering it as
 *     zero — asserted on the text, because the text is the defect.
 *   · A denied or throttled read degrades to `CANNOT_SAY` and never to
 *     `HEALTHY`, and carries the pasteable minimum statement with it.
 */

import {
  FINDING_KINDS,
  FINDING_LEVEL,
  VERDICT_LEVELS,
  fleetHealthVerdict,
  metricQueriesFor,
  observeFleetHealth,
  servicesInUse,
  touchesServiceInUse,
  type FleetHealthReaders,
  type FleetHealthSources,
} from "./health"
import type { AlarmRow, AlarmSurface } from "./alarms"
import type { AwsHealthSurface, HealthEventRow } from "./aws-health"
import type {
  ClusterReading,
  ContainerReadings,
  ServiceReading,
  StopCause,
  TaskReading,
} from "./containers"
import type { DatabaseReadings, ScheduledMaintenance } from "./database"
import type {
  LoadBalancerReading,
  LoadBalancerReadings,
  ServingState,
  TargetGroupReading,
} from "./loadbalancer"
import type { MetricReadings, MetricSeries, MetricSummary } from "./metrics"
import type { Identity } from "./identity"
import type { TaggedResource } from "./tags"
import type { AwsRead } from "./read"

/* ------------------------------------------------------------ the props -- */

const AT = new Date("2026-08-13T09:00:00.000Z")
const ACCOUNT = "123456789012"
const REGION = "us-east-1"

const NO_IDENTITY: AwsRead<Identity> = {
  state: "UNCONFIGURED",
  capability: "sts:GetCallerIdentity",
  why: "this case does not resolve an identity; nothing under test reads one.",
}

const NO_TAGS: AwsRead<readonly TaggedResource[]> = {
  state: "UNCONFIGURED",
  capability: "tag:GetResources",
  why: "this case does not read the tag index.",
}

function actual<T>(value: T, capability: AwsRead<T>["capability"]): AwsRead<T> {
  return { state: "ACTUAL", capability, value, asOf: AT.toISOString(), fresh: true }
}

function empty<T>(capability: AwsRead<T>["capability"]): AwsRead<T> {
  return { state: "EMPTY", capability, asOf: AT.toISOString() }
}

/** A refusal shaped exactly as `readAws` builds one, minimum statement included. */
function denied<T>(capability: AwsRead<T>["capability"], action: string): AwsRead<T> {
  return {
    state: "DENIED",
    capability,
    action,
    principal: `arn:aws:sts::${ACCOUNT}:assumed-role/tenure-studio/console`,
    accountId: ACCOUNT,
    region: REGION,
    partition: "aws",
    errorCode: "AccessDeniedException",
    minimumStatement: `{"Effect":"Allow","Action":"${action}","Resource":"*"}`,
  }
}

function throttled<T>(capability: AwsRead<T>["capability"]): AwsRead<T> {
  return { state: "THROTTLED", capability, retryAfterMs: 400, asOf: AT.toISOString() }
}

/* --------------------------------------------------------------- alarms -- */

function alarmRow(over: Partial<AlarmRow> & Pick<AlarmRow, "name" | "verdict">): AlarmRow {
  return { detail: `${over.name} is ${over.verdict}.`, type: "MetricAlarm", ...over }
}

function alarms(
  rows: readonly AlarmRow[],
  read?: AwsRead<readonly AlarmRow[]>,
): AlarmSurface {
  return {
    identity: NO_IDENTITY,
    read: read ?? (rows.length === 0 ? empty("cloudwatch:DescribeAlarms") : actual(rows, "cloudwatch:DescribeAlarms")),
    rows,
    headline: `${rows.length} alarm(s), as of ${AT.toISOString()}`,
    asOf: AT.toISOString(),
    refreshMs: 60_000,
  }
}

/** One healthy alarm, so a case can be "everything else is fine". */
const ONE_OK_ALARM = alarms([alarmRow({ name: "tenure-prod-5xx", verdict: "OK" })])

/* ----------------------------------------------------------- aws health -- */

function healthEvent(over: Partial<HealthEventRow> & Pick<HealthEventRow, "arn" | "verdict">): HealthEventRow {
  return {
    service: "ECS",
    eventTypeCode: "AWS_ECS_OPERATIONAL_ISSUE",
    category: "issue",
    region: REGION,
    availabilityZone: null,
    statusCode: "open",
    scope: "ACCOUNT_SPECIFIC",
    startTime: "2026-08-13T08:00:00.000Z",
    endTime: null,
    lastUpdatedTime: "2026-08-13T08:30:00.000Z",
    detail: "AWS reports this event as account-specific and open.",
    entities: [],
    entitiesKnown: true,
    entitiesDetail: "",
    tenants: [],
    ...over,
  }
}

function awsHealth(
  rows: readonly HealthEventRow[],
  events?: AwsRead<readonly HealthEventRow[]>,
): AwsHealthSurface {
  return {
    identity: NO_IDENTITY,
    events: events ?? (rows.length === 0 ? empty("health:DescribeEvents") : actual(rows, "health:DescribeEvents")),
    entities: empty("health:DescribeAffectedEntities"),
    tagged: NO_TAGS,
    rows,
    headline: `${rows.length} AWS Health event(s)`,
    entityHeadline: "no entity was read in this case.",
    accountId: ACCOUNT,
    region: REGION,
    partition: "aws",
    asOf: AT.toISOString(),
    refreshMs: 300_000,
  }
}

const NO_AWS_EVENTS = awsHealth([])

/* --------------------------------------------------------- loadbalancer -- */

const LB_ARN = `arn:aws:elasticloadbalancing:${REGION}:${ACCOUNT}:loadbalancer/app/tenure-prod/1a2b3c4d5e6f7890`
const TG_ARN = `arn:aws:elasticloadbalancing:${REGION}:${ACCOUNT}:targetgroup/tenure-prod-app/0f9e8d7c6b5a4321`

function targetGroup(
  serving: ServingState,
  arn = TG_ARN,
  over: Partial<TargetGroupReading> = {},
): TargetGroupReading {
  return {
    arn,
    name: "tenure-prod-app",
    protocol: "HTTP",
    port: 3000,
    vpcId: "vpc-0abc",
    targetType: "ip",
    protocolVersion: "HTTP1",
    loadBalancerArns: [LB_ARN],
    healthCheck: {
      enabled: true,
      protocol: "HTTP",
      port: "traffic-port",
      path: "/api/health",
      intervalSeconds: 30,
      timeoutSeconds: 5,
      healthyThreshold: 2,
      unhealthyThreshold: 2,
      matcher: "200",
    },
    attribution: { kind: "shared" },
    health: empty("elasticloadbalancing:DescribeTargetHealth"),
    serving,
    refreshMs: 60_000,
    asOf: AT.toISOString(),
    ...over,
  }
}

function loadBalancer(groups: AwsRead<readonly TargetGroupReading[]>): LoadBalancerReading {
  return {
    arn: LB_ARN,
    name: "tenure-prod",
    type: "application",
    scheme: { kind: "internet-facing" },
    dnsName: "tenure-prod-1234.us-east-1.elb.amazonaws.com",
    vpcId: "vpc-0abc",
    stateCode: "active",
    stateReason: null,
    availabilityZones: ["us-east-1a", "us-east-1b"],
    subnetIds: ["subnet-0a", "subnet-0b"],
    securityGroupIds: ["sg-0a"],
    ipAddressType: "ipv4",
    createdAt: "2026-01-04T00:00:00.000Z",
    region: REGION,
    partition: "aws",
    accountId: ACCOUNT,
    attribution: { kind: "shared" },
    listeners: empty("elasticloadbalancing:DescribeListeners"),
    targetGroups: groups,
    refreshMs: 300_000,
    asOf: AT.toISOString(),
  }
}

function loadBalancers(
  read: AwsRead<readonly LoadBalancerReading[]>,
): LoadBalancerReadings {
  return {
    identity: NO_IDENTITY,
    tagged: NO_TAGS,
    loadBalancers: read,
    findings: [],
    truncation: { kind: "complete" },
    asOf: AT.toISOString(),
    refreshMs: {
      loadBalancers: 300_000,
      listeners: 300_000,
      targetGroups: 300_000,
      targetHealth: 60_000,
      rules: 300_000,
    },
  }
}

const SERVING_FINE = loadBalancers(
  actual([loadBalancer(actual([targetGroup({ kind: "all-serving", healthy: 2 })], "elasticloadbalancing:DescribeTargetGroups"))], "elasticloadbalancing:DescribeLoadBalancers"),
)

/* ----------------------------------------------------------- containers -- */

function task(arn: string, stopCause: StopCause): TaskReading {
  return {
    arn,
    taskDefinitionArn: `arn:aws:ecs:${REGION}:${ACCOUNT}:task-definition/tenure-prod-app:41`,
    group: "service:tenure-prod-app",
    lastStatus: "STOPPED",
    desiredStatus: "STOPPED",
    healthStatus: "UNKNOWN",
    cpu: "1024",
    memory: "2048",
    launchType: "FARGATE",
    capacityProviderName: null,
    availabilityZone: "us-east-1a",
    connectivity: "CONNECTED",
    startedBy: "ecs-svc/1234567890123456789",
    stopCode: null,
    createdAt: "2026-08-13T07:00:00.000Z",
    startedAt: "2026-08-13T07:01:00.000Z",
    stoppedAt: "2026-08-13T08:00:00.000Z",
    stopCause,
    containers: [],
  }
}

function service(name: string): ServiceReading {
  return {
    name,
    arn: `arn:aws:ecs:${REGION}:${ACCOUNT}:service/tenure-prod/${name}`,
    clusterArn: `arn:aws:ecs:${REGION}:${ACCOUNT}:cluster/tenure-prod`,
    status: "ACTIVE",
    desiredCount: 2,
    runningCount: 2,
    pendingCount: 0,
    launchType: "FARGATE",
    taskDefinitionArn: `arn:aws:ecs:${REGION}:${ACCOUNT}:task-definition/${name}:41`,
    healthCheckGracePeriodSeconds: 60,
    targetGroupArns: [TG_ARN],
    deployments: [],
    attribution: { kind: "shared" },
    taskDefinition: {
      state: "UNCONFIGURED",
      capability: "ecs:DescribeTaskDefinition",
      why: "not read in this case.",
    },
    gap: { kind: "none", desired: 2, running: 2 },
  }
}

function cluster(over: Partial<ClusterReading> = {}): ClusterReading {
  return {
    arn: `arn:aws:ecs:${REGION}:${ACCOUNT}:cluster/tenure-prod`,
    name: "tenure-prod",
    region: REGION,
    partition: "aws",
    attribution: { kind: "shared" },
    detail: { state: "UNCONFIGURED", capability: "ecs:DescribeClusters", why: "not read in this case." },
    services: empty("ecs:DescribeServices"),
    serviceTruncation: { kind: "complete" },
    runningTasks: empty("ecs:DescribeTasks"),
    runningTaskTruncation: { kind: "complete" },
    stoppedTasks: empty("ecs:DescribeTasks"),
    stoppedTaskTruncation: { kind: "complete" },
    stoppedWindow: { why: "ECS retains a stopped task for approximately one hour." },
    failures: [],
    asOf: AT.toISOString(),
    ...over,
  }
}

function containers(
  read: AwsRead<readonly ClusterReading[]>,
  fleet: ContainerReadings["fleet"] = { kind: "steady", clusters: 1, services: 1, runningTasks: 2 },
): ContainerReadings {
  return {
    identity: NO_IDENTITY,
    tagged: NO_TAGS,
    clusters: read,
    truncation: { kind: "complete" },
    fleet,
    credentialFindings: [],
    asOf: AT.toISOString(),
    refreshMs: {
      clusters: 300_000,
      clusterDetail: 300_000,
      services: 300_000,
      tasks: 60_000,
      taskDefinition: 600_000,
    },
  }
}

const CONTAINERS_STEADY = containers(actual([cluster()], "ecs:ListClusters"))

/* ------------------------------------------------------------- database -- */

function maintenance(interrupts: boolean): ScheduledMaintenance {
  return {
    instanceId: "tenure-prod-db",
    action: {
      action: interrupts ? "db-upgrade" : "system-update",
      description: interrupts ? "Minor engine upgrade to 16.4" : "Operating system patch",
      optInStatus: "next-maintenance",
      schedule: {
        kind: "scheduled",
        currentApplyDate: "2026-08-16T06:00:00.000Z",
        why: "AWS applies this in the next maintenance window.",
      },
      interrupts,
      why: interrupts
        ? "AWS applies this by restarting the instance."
        : "AWS applies this without an interruption.",
    },
    window: {
      kind: "window",
      raw: "sun:06:00-sun:06:30",
      startDay: "Sunday",
      startTimeUtc: "06:00",
      endDay: "Sunday",
      endTimeUtc: "06:30",
    },
  }
}

function database(
  outage: DatabaseReadings["outage"],
  instances: AwsRead<DatabaseReadings["instances"] extends AwsRead<infer T> ? T : never> = empty(
    "rds:DescribeDBInstances",
  ),
): DatabaseReadings {
  return {
    identity: NO_IDENTITY,
    tagged: NO_TAGS,
    instances,
    pendingMaintenance: empty("rds:DescribePendingMaintenanceActions"),
    parameterGroups: empty("rds:DescribeDBParameterGroups"),
    snapshots: empty("rds:DescribeDBSnapshots"),
    outage,
    truncation: {
      instances: { kind: "complete" },
      pendingMaintenance: { kind: "complete" },
      parameterGroups: { kind: "complete" },
      snapshots: { kind: "complete" },
    },
    asOf: AT.toISOString(),
    refreshMs: {
      instances: 300_000,
      pendingMaintenance: 300_000,
      events: 300_000,
      parameterGroups: 600_000,
      snapshots: 600_000,
    },
  }
}

const DB_QUIET = database({ kind: "none", instancesRead: 1, unreadable: [] })

/* -------------------------------------------------------------- metrics -- */

function series(key: string, summary: MetricSummary, over: Partial<MetricSeries> = {}): MetricSeries {
  return {
    key,
    namespace: "AWS/ApplicationELB",
    metricName: "HealthyHostCount",
    dimensions: [{ name: "TargetGroup", value: "targetgroup/tenure-prod-app/0f9e8d7c6b5a4321" }],
    stat: "Minimum",
    periodSeconds: 300,
    label: "healthy targets",
    datapoints: [],
    status: { kind: "complete" },
    summary,
    coverage: {
      expectedDatapoints: 12,
      presentDatapoints: summary.kind === "datapoints" ? summary.count : 0,
      missingDatapoints: summary.kind === "datapoints" ? 12 - summary.count : 12,
      malformedDatapoints: 0,
    },
    attribution: { kind: "shared" },
    region: REGION,
    partition: "aws",
    accountId: ACCOUNT,
    refreshMs: 60_000,
    asOf: AT.toISOString(),
    ...over,
  }
}

function metrics(read: AwsRead<readonly MetricSeries[]>): MetricReadings {
  return {
    identity: NO_IDENTITY,
    tagged: NO_TAGS,
    window: { startIso: "2026-08-13T08:00:00.000Z", endIso: "2026-08-13T09:00:00.000Z" },
    series: read,
    truncation: { kind: "complete" },
    unreadableBatches: [],
    cost: { batches: 1, requests: 1, metricsRequested: 1 },
    asOf: AT.toISOString(),
    refreshMs: 60_000,
  }
}

const METRICS_FINE = metrics(
  actual(
    [
      series("elb:healthy", {
        kind: "datapoints",
        count: 12,
        latest: { at: "2026-08-13T08:55:00.000Z", value: 2 },
        earliest: { at: "2026-08-13T08:00:00.000Z", value: 2 },
        min: 2,
        max: 2,
        mean: 2,
      }),
    ],
    "cloudwatch:GetMetricData",
  ),
)

/** Every source answering, and every one of them fine. The only HEALTHY base. */
function allWell(): FleetHealthSources {
  return {
    alarms: ONE_OK_ALARM,
    awsHealth: NO_AWS_EVENTS,
    loadBalancers: SERVING_FINE,
    containers: CONTAINERS_STEADY,
    database: DB_QUIET,
    metrics: METRICS_FINE,
  }
}

/* ================================================================ cases == */

describe("the ranking vocabulary", () => {
  it("ranks and levels every finding kind it declares", () => {
    for (const kind of FINDING_KINDS) {
      expect(VERDICT_LEVELS).toContain(FINDING_LEVEL[kind])
    }
    expect(new Set(FINDING_KINDS).size).toBe(FINDING_KINDS.length)
  })
})

describe("the green light is falsifiable", () => {
  it("is HEALTHY only when all six answered, and says what it is based on", () => {
    const verdict = fleetHealthVerdict(allWell(), { now: AT })
    expect(verdict.level).toBe("HEALTHY")
    expect(verdict.findings).toEqual([])
    expect(verdict.couldNotSee).toEqual([])
    expect(verdict.basedOn.map((b) => b.source).sort()).toEqual([
      "alarms",
      "aws-health",
      "containers",
      "database",
      "loadbalancer",
      "metrics",
    ])
    expect(verdict.headline).toContain("Nothing in this pass went unread")
    expect(verdict.headline).toContain("if any of it is wrong, so is this sentence")
  })

  it("cannot say anything when not one reader answered", () => {
    const verdict = fleetHealthVerdict(
      {
        alarms: null,
        awsHealth: null,
        loadBalancers: null,
        containers: null,
        database: null,
        metrics: null,
      },
      { now: AT },
    )
    expect(verdict.level).toBe("CANNOT_SAY")
    expect(verdict.basedOn).toEqual([])
    expect(verdict.couldNotSee).toHaveLength(6)
    expect(verdict.headline).toContain("not one of the six readers answered")
  })

  it("a source passed as null is named, and never scores as OK", () => {
    const verdict = fleetHealthVerdict({ ...allWell(), database: null }, { now: AT })
    expect(verdict.level).toBe("CANNOT_SAY")
    expect(verdict.couldNotSee.map((b) => b.source)).toEqual(["database"])
    expect(verdict.couldNotSee[0].why).toContain("did not run the database reader")
  })
})

describe("rule 1 — AWS outranks our own alarms", () => {
  it("puts an account-specific AWS event above a firing alarm", () => {
    const verdict = fleetHealthVerdict(
      {
        ...allWell(),
        alarms: alarms([alarmRow({ name: "tenure-prod-5xx", verdict: "ALARM" })]),
        awsHealth: awsHealth([
          healthEvent({ arn: "arn:aws:health:us-east-1::event/ECS/AWS_ECS_OPERATIONAL_ISSUE/1", verdict: "AFFECTING_US" }),
        ]),
      },
      { now: AT },
    )
    expect(verdict.level).toBe("AWS_INCIDENT")
    expect(verdict.findings.map((f) => f.kind)).toEqual([
      "aws-health-affecting-us",
      "alarm-firing",
    ])
  })

  it("counts an open public event against a service this estate was shown to use", () => {
    const verdict = fleetHealthVerdict(
      {
        ...allWell(),
        awsHealth: awsHealth([
          healthEvent({
            arn: "arn:aws:health:us-east-1::event/ECS/AWS_ECS_OPERATIONAL_ISSUE/2",
            verdict: "OPEN_IN_OUR_REGION",
            scope: "PUBLIC",
            service: "ECS",
          }),
        ]),
      },
      { now: AT },
    )
    expect(verdict.level).toBe("AWS_INCIDENT")
    expect(verdict.findings[0].kind).toBe("aws-health-open-service-in-use")
  })

  it("does NOT count an open event against a service nothing showed us using", () => {
    const verdict = fleetHealthVerdict(
      {
        ...allWell(),
        awsHealth: awsHealth([
          healthEvent({
            arn: "arn:aws:health:us-east-1::event/SAGEMAKER/AWS_SAGEMAKER_ISSUE/3",
            verdict: "OPEN_IN_OUR_REGION",
            scope: "PUBLIC",
            service: "SAGEMAKER",
          }),
        ]),
      },
      { now: AT },
    )
    expect(verdict.level).toBe("HEALTHY")
    expect(verdict.findings).toEqual([])
  })

  it("neither rules in nor rules out an open event when nothing established what we run on", () => {
    const verdict = fleetHealthVerdict(
      {
        alarms: null,
        awsHealth: awsHealth([
          healthEvent({
            arn: "arn:aws:health:us-east-1::event/EC2/AWS_EC2_ISSUE/4",
            verdict: "OPEN_IN_OUR_REGION",
            scope: "PUBLIC",
            service: "EC2",
          }),
        ]),
        loadBalancers: null,
        containers: null,
        database: null,
        metrics: null,
      },
      { now: AT },
    )
    expect(verdict.findings).toEqual([])
    expect(verdict.couldNotSee.some((b) => b.what.includes("whether the open EC2 event"))).toBe(true)
    expect(verdict.level).toBe("CANNOT_SAY")
  })

  it("names the blast radius as unknown when the affected entities were not read", () => {
    const verdict = fleetHealthVerdict(
      {
        ...allWell(),
        awsHealth: awsHealth([
          healthEvent({
            arn: "arn:aws:health:us-east-1::event/RDS/AWS_RDS_ISSUE/5",
            verdict: "AFFECTING_US",
            entitiesKnown: false,
            entitiesDetail: "health:DescribeAffectedEntities was refused, so which of our resources this touches is unknown.",
          }),
        ]),
      },
      { now: AT },
    )
    expect(verdict.level).toBe("AWS_INCIDENT")
    expect(
      verdict.couldNotSee.some((b) => b.what.startsWith("which of our resources")),
    ).toBe(true)
  })

  it("carries an unreadable AWS Health row as a gap on an answered surface", () => {
    const verdict = fleetHealthVerdict(
      {
        ...allWell(),
        awsHealth: awsHealth([
          healthEvent({
            arn: "arn:aws:health:us-east-1::event/UNKNOWN/UNREADABLE/6",
            verdict: "UNAUTHORIZED",
            detail: "health:DescribeEvents was refused, so AWS's account of itself was not read.",
          }),
        ]),
      },
      { now: AT },
    )
    expect(verdict.findings).toEqual([])
    expect(verdict.level).toBe("CANNOT_SAY")
    expect(verdict.couldNotSee.map((b) => b.source)).toEqual(["aws-health"])
    expect(verdict.couldNotSee[0].why).toContain("was refused")
  })

  it("matches MULTIPLE_SERVICES against anything this estate runs on, and nothing against none", () => {
    expect(touchesServiceInUse({ service: "MULTIPLE_SERVICES" }, ["ECS"])).toBe(true)
    expect(touchesServiceInUse({ service: "MULTIPLE_SERVICES" }, [])).toBe(false)
    expect(touchesServiceInUse({ service: "ecs" }, ["ECS"])).toBe(true)
    expect(touchesServiceInUse({ service: "SAGEMAKER" }, ["ECS"])).toBe(false)
  })
})

describe("rule 2 — a muted alarm outranks OK", () => {
  it("refuses HEALTHY when an alarm's actions are disabled and all else is fine", () => {
    const verdict = fleetHealthVerdict(
      {
        ...allWell(),
        alarms: alarms([
          alarmRow({ name: "tenure-prod-5xx", verdict: "OK" }),
          alarmRow({
            name: "tenure-prod-cpu",
            verdict: "DISABLED",
            detail: "actions are disabled — this alarm cannot notify anybody.",
          }),
        ]),
      },
      { now: AT },
    )
    expect(verdict.level).toBe("UNTRUSTED")
    expect(verdict.findings.map((f) => f.kind)).toEqual(["alarm-actions-disabled"])
    expect(verdict.headline).toContain("cannot notify anybody")
  })

  it("treats a successful read of zero alarms as nothing watching, not as calm", () => {
    const verdict = fleetHealthVerdict({ ...allWell(), alarms: alarms([]) }, { now: AT })
    expect(verdict.level).toBe("UNTRUSTED")
    expect(verdict.findings.map((f) => f.kind)).toEqual(["nothing-watching"])
    expect(verdict.findings[0].why).toContain("not one alarm in this account")
  })

  it("treats an unreadable row on an answered surface as a gap, never as a healthy alarm", () => {
    // `alarmSurface()` pairs these rows with a read this arm returns early on,
    // so this drives the branch the way any other producer of `AlarmSurface`
    // would: an answered read carrying a row that says it could not be read.
    // Falling through would give it no finding and no gap — a row that scores
    // as a healthy alarm.
    const verdict = fleetHealthVerdict(
      {
        ...allWell(),
        alarms: alarms([
          alarmRow({ name: "tenure-prod-5xx", verdict: "OK" }),
          alarmRow({
            name: "every alarm in this account",
            verdict: "UNAUTHORIZED",
            type: "surface",
            detail:
              "this engine's role was refused cloudwatch:DescribeAlarms (AccessDeniedException). " +
              "Minimum statement: {\"Effect\":\"Allow\",\"Action\":\"cloudwatch:DescribeAlarms\"}",
          }),
        ]),
      },
      { now: AT },
    )
    expect(verdict.findings).toEqual([])
    expect(verdict.level).toBe("CANNOT_SAY")
    expect(verdict.couldNotSee.map((b) => b.source)).toEqual(["alarms"])
    expect(verdict.couldNotSee[0].what).toBe("the state of every alarm in this account")
    expect(verdict.couldNotSee[0].why).toContain("Minimum statement:")
  })

  it("carries missing, no-data and stale alarms as findings of their own", () => {
    const verdict = fleetHealthVerdict(
      {
        ...allWell(),
        alarms: alarms([
          alarmRow({ name: "a-stale", verdict: "STALE" }),
          alarmRow({ name: "b-missing", verdict: "MISSING" }),
          alarmRow({ name: "c-nodata", verdict: "INSUFFICIENT_DATA" }),
        ]),
      },
      { now: AT },
    )
    expect(verdict.findings.map((f) => f.kind)).toEqual([
      "alarm-missing",
      "alarm-no-data",
      "alarm-stale",
    ])
  })
})

describe("rule 3 — zero healthy targets outranks an alarm that has not fired", () => {
  it("ranks a target group with nothing serving above a firing alarm", () => {
    const verdict = fleetHealthVerdict(
      {
        ...allWell(),
        alarms: alarms([alarmRow({ name: "tenure-prod-5xx", verdict: "ALARM" })]),
        loadBalancers: loadBalancers(
          actual(
            [
              loadBalancer(
                actual(
                  [
                    targetGroup({
                      kind: "none-serving",
                      notServing: [
                        {
                          targetId: "10.0.1.17",
                          port: 3000,
                          state: "unhealthy",
                          reasonCode: "Target.ResponseCodeMismatch",
                          description: "Health checks failed with these codes: [502]",
                        },
                      ],
                    }),
                  ],
                  "elasticloadbalancing:DescribeTargetGroups",
                ),
              ),
            ],
            "elasticloadbalancing:DescribeLoadBalancers",
          ),
        ),
      },
      { now: AT },
    )
    expect(verdict.level).toBe("OUR_INCIDENT")
    expect(verdict.findings.map((f) => f.kind)).toEqual(["no-healthy-targets", "alarm-firing"])
    expect(verdict.findings[0].why).toContain("has NO healthy target")
    expect(verdict.findings[0].why).toContain("Target.ResponseCodeMismatch")
  })

  it("treats a group with no registered target as zero healthy targets too", () => {
    const verdict = fleetHealthVerdict(
      {
        ...allWell(),
        loadBalancers: loadBalancers(
          actual(
            [
              loadBalancer(
                actual(
                  [targetGroup({ kind: "no-targets", why: "DescribeTargetHealth returned nothing." })],
                  "elasticloadbalancing:DescribeTargetGroups",
                ),
              ),
            ],
            "elasticloadbalancing:DescribeLoadBalancers",
          ),
        ),
      },
      { now: AT },
    )
    expect(verdict.findings.map((f) => f.kind)).toEqual(["no-healthy-targets"])
  })

  it("keeps a partially degraded group below a firing alarm", () => {
    const verdict = fleetHealthVerdict(
      {
        ...allWell(),
        alarms: alarms([alarmRow({ name: "tenure-prod-5xx", verdict: "ALARM" })]),
        loadBalancers: loadBalancers(
          actual(
            [
              loadBalancer(
                actual(
                  [
                    targetGroup({
                      kind: "degraded",
                      healthy: 1,
                      notServing: [
                        {
                          targetId: "10.0.1.18",
                          port: 3000,
                          state: "draining",
                          reasonCode: null,
                          description: "",
                        },
                      ],
                    }),
                  ],
                  "elasticloadbalancing:DescribeTargetGroups",
                ),
              ),
            ],
            "elasticloadbalancing:DescribeLoadBalancers",
          ),
        ),
      },
      { now: AT },
    )
    expect(verdict.findings.map((f) => f.kind)).toEqual(["alarm-firing", "targets-not-serving"])
  })

  it("reports an unreadable target health as a gap, never as serving", () => {
    const verdict = fleetHealthVerdict(
      {
        ...allWell(),
        loadBalancers: loadBalancers(
          actual(
            [
              loadBalancer(
                actual(
                  [targetGroup({ kind: "unknown", why: "DescribeTargetHealth was refused." })],
                  "elasticloadbalancing:DescribeTargetGroups",
                ),
              ),
            ],
            "elasticloadbalancing:DescribeLoadBalancers",
          ),
        ),
      },
      { now: AT },
    )
    expect(verdict.findings).toEqual([])
    expect(verdict.level).toBe("CANNOT_SAY")
    expect(verdict.couldNotSee[0].what).toContain("is serving anything")
  })
})

describe("rule 4 — a metric with no data is not a zero", () => {
  it("raises a finding whose sentence forbids rendering it as zero", () => {
    const verdict = fleetHealthVerdict(
      {
        ...allWell(),
        metrics: metrics(
          actual(
            [
              series("elb:healthy", {
                kind: "no-datapoints",
                why: "CloudWatch returned no datapoint in this window.",
              }),
            ],
            "cloudwatch:GetMetricData",
          ),
        ),
      },
      { now: AT },
    )
    expect(verdict.level).toBe("UNTRUSTED")
    expect(verdict.findings.map((f) => f.kind)).toEqual(["metric-no-data"])
    expect(verdict.findings[0].why).toContain("published NO datapoint")
    expect(verdict.findings[0].why).toContain("not a value of zero")
  })

  it("keeps a series that was NOT READ out of the findings and in the gaps", () => {
    const verdict = fleetHealthVerdict(
      {
        ...allWell(),
        metrics: metrics(
          actual(
            [series("elb:healthy", { kind: "not-read", why: "this batch was refused." })],
            "cloudwatch:GetMetricData",
          ),
        ),
      },
      { now: AT },
    )
    expect(verdict.findings).toEqual([])
    expect(verdict.level).toBe("CANNOT_SAY")
    expect(verdict.couldNotSee[0].why).toContain("this batch was refused")
  })

  it("says so when a series' statistics are over a prefix of the window", () => {
    const verdict = fleetHealthVerdict(
      {
        ...allWell(),
        metrics: metrics(
          actual(
            [
              series(
                "elb:healthy",
                {
                  kind: "datapoints",
                  count: 3,
                  latest: { at: "2026-08-13T08:55:00.000Z", value: 2 },
                  earliest: { at: "2026-08-13T08:45:00.000Z", value: 2 },
                  min: 2,
                  max: 2,
                  mean: 2,
                },
                { status: { kind: "partial", why: "CloudWatch reported PartialData." } },
              ),
            ],
            "cloudwatch:GetMetricData",
          ),
        ),
      },
      { now: AT },
    )
    expect(verdict.couldNotSee[0].why).toContain("over a prefix of the window")
  })
})

describe("rule 5 — a refused or throttled read degrades to cannot-say, never to OK", () => {
  it("carries a denied alarm read with its pasteable minimum statement", () => {
    const verdict = fleetHealthVerdict(
      {
        ...allWell(),
        alarms: alarms([], denied("cloudwatch:DescribeAlarms", "cloudwatch:DescribeAlarms")),
      },
      { now: AT },
    )
    expect(verdict.level).toBe("CANNOT_SAY")
    expect(verdict.findings).toEqual([])
    expect(verdict.couldNotSee[0].why).toContain("Minimum statement:")
    expect(verdict.couldNotSee[0].why).toContain("assumed-role/tenure-studio/console")
  })

  it("degrades on a throttled metric read", () => {
    const verdict = fleetHealthVerdict(
      { ...allWell(), metrics: metrics(throttled("cloudwatch:GetMetricData")) },
      { now: AT },
    )
    expect(verdict.level).toBe("CANNOT_SAY")
    expect(verdict.couldNotSee[0].why).toContain("throttled")
  })

  it("never lets a gap improve a verdict that already found an incident", () => {
    const verdict = fleetHealthVerdict(
      {
        ...allWell(),
        alarms: alarms([alarmRow({ name: "tenure-prod-5xx", verdict: "ALARM" })]),
        database: database({ kind: "unknown", why: "rds:DescribeDBInstances was refused." }),
      },
      { now: AT },
    )
    expect(verdict.level).toBe("OUR_INCIDENT")
    expect(verdict.couldNotSee.some((b) => b.source === "database")).toBe(true)
  })

  it("degrades an otherwise-healthy estate on a gap the CALLER supplies", () => {
    const verdict = fleetHealthVerdict(allWell(), {
      now: AT,
      alsoCouldNotSee: [
        {
          source: "metrics",
          kind: "unreadable",
          what: "everything metrics would have said",
          why: "the metrics reader threw before it could answer.",
        },
      ],
    })
    expect(verdict.level).toBe("CANNOT_SAY")
    expect(verdict.couldNotSee).toHaveLength(1)
    expect(verdict.couldNotSee[0].why).toContain("threw before it could answer")
    expect(verdict.headline).toContain("metrics —")
  })

  it("lets a caller's specific reason replace this module's generic one", () => {
    const verdict = fleetHealthVerdict(
      { ...allWell(), containers: null },
      {
        now: AT,
        alsoCouldNotSee: [
          {
            source: "containers",
            kind: "unreadable",
            what: "everything containers would have said",
            why: "the containers reader threw: RangeError: Maximum call stack size exceeded.",
          },
        ],
      },
    )
    const gaps = verdict.couldNotSee.filter((b) => b.source === "containers")
    expect(gaps).toHaveLength(1)
    expect(gaps[0].kind).toBe("unreadable")
    expect(gaps[0].why).toContain("RangeError")
  })

  it("says AWS Health could not answer the 'is it us' half at all", () => {
    const verdict = fleetHealthVerdict(
      { ...allWell(), awsHealth: awsHealth([], denied("health:DescribeEvents", "health:DescribeEvents")) },
      { now: AT },
    )
    expect(verdict.level).toBe("CANNOT_SAY")
    expect(verdict.couldNotSee[0].what).toContain("is it us")
  })
})

describe("containers", () => {
  it("counts a stop cause ECS calls an incident, and ignores one it does not", () => {
    const verdict = fleetHealthVerdict(
      {
        ...allWell(),
        containers: containers(
          actual(
            [
              cluster({
                stoppedTasks: actual(
                  [
                    task("arn:aws:ecs:us-east-1:123456789012:task/tenure-prod/aaa", {
                      kind: "out-of-memory",
                      raw: "OutOfMemoryError: Container killed due to memory usage",
                    }),
                    task("arn:aws:ecs:us-east-1:123456789012:task/tenure-prod/bbb", {
                      kind: "out-of-memory",
                      raw: "OutOfMemoryError: Container killed due to memory usage",
                    }),
                    task("arn:aws:ecs:us-east-1:123456789012:task/tenure-prod/ccc", {
                      kind: "scaling",
                      raw: "Scaling activity initiated by deployment ecs-svc/1",
                    }),
                  ],
                  "ecs:DescribeTasks",
                ),
              }),
            ],
            "ecs:ListClusters",
          ),
        ),
      },
      { now: AT },
    )
    expect(verdict.findings.map((f) => f.kind)).toEqual(["tasks-stopped-for-incident"])
    expect(verdict.findings[0].why).toContain("2 task(s)")
    expect(verdict.findings[0].why).toContain("ECS retains a stopped task")
  })

  it("raises a service short of tasks, naming the unexplained case", () => {
    const verdict = fleetHealthVerdict(
      {
        ...allWell(),
        containers: containers(actual([cluster({ services: actual([service("tenure-prod-app")], "ecs:DescribeServices") })], "ecs:ListClusters"), {
          kind: "degraded",
          services: [
            {
              cluster: "tenure-prod",
              service: "tenure-prod-app",
              gap: {
                kind: "unexplained",
                desired: 2,
                running: 0,
                missing: 2,
                why: "nothing stopped in the window; the scheduler is not placing them.",
              },
            },
          ],
          unexplained: 1,
          unreadable: [],
        }),
      },
      { now: AT },
    )
    expect(verdict.level).toBe("OUR_INCIDENT")
    expect(verdict.findings.map((f) => f.kind)).toEqual(["service-short-of-tasks"])
    expect(verdict.findings[0].why).toContain("running 0 of 2 task(s)")
    expect(verdict.findings[0].why).toContain("scheduler is not placing them")
  })

  it("treats an unverified fleet as a gap rather than as steady", () => {
    const verdict = fleetHealthVerdict(
      {
        ...allWell(),
        containers: containers(actual([cluster()], "ecs:ListClusters"), {
          kind: "unverified",
          why: "one task read did not answer.",
          unreadable: ["ecs:DescribeTasks on tenure-prod"],
          servicesConsidered: 1,
        }),
      },
      { now: AT },
    )
    expect(verdict.level).toBe("CANNOT_SAY")
    expect(verdict.couldNotSee[0].why).toContain("one task read did not answer")
  })
})

describe("database", () => {
  it("ranks maintenance that restarts the database above maintenance that does not", () => {
    const interrupting = maintenance(true)
    const quiet = maintenance(false)
    const verdict = fleetHealthVerdict(
      {
        ...allWell(),
        database: database({
          kind: "pending",
          actions: [quiet, interrupting],
          forced: [],
          interrupting: [interrupting],
          unreadable: [],
        }),
      },
      { now: AT },
    )
    expect(verdict.level).toBe("SCHEDULED")
    expect(verdict.findings.map((f) => f.kind)).toEqual([
      "database-interrupting-maintenance",
      "database-pending-maintenance",
    ])
    expect(verdict.findings[0].why).toContain("RESTARTS THE DATABASE")
    expect(verdict.findings[0].why).toContain("db-upgrade")
  })

  it("does not let an instance that did not answer be covered by another's 'none'", () => {
    const verdict = fleetHealthVerdict(
      {
        ...allWell(),
        database: database({ kind: "none", instancesRead: 1, unreadable: ["tenure-prod-db-2"] }),
      },
      { now: AT },
    )
    expect(verdict.level).toBe("CANNOT_SAY")
    expect(verdict.couldNotSee[0].what).toContain("tenure-prod-db-2")
  })
})

describe("what this estate was shown to run on", () => {
  it("counts only services a reader actually returned a resource for", () => {
    // CLOUDWATCH from an alarm row, ELASTICLOADBALANCING from a load balancer,
    // ECS from a cluster. RDS is absent because `DB_QUIET`'s instance read is
    // EMPTY — a successful read of no database is not a database.
    expect(servicesInUse(allWell())).toEqual(["CLOUDWATCH", "ECS", "ELASTICLOADBALANCING"])
  })

  it("counts nothing from a denied reader", () => {
    const refused: FleetHealthSources = {
      alarms: alarms([], denied("cloudwatch:DescribeAlarms", "cloudwatch:DescribeAlarms")),
      awsHealth: NO_AWS_EVENTS,
      loadBalancers: loadBalancers(
        denied("elasticloadbalancing:DescribeLoadBalancers", "elasticloadbalancing:DescribeLoadBalancers"),
      ),
      containers: containers(denied("ecs:ListClusters", "ecs:ListClusters")),
      database: database(
        { kind: "unknown", why: "refused." },
        denied("rds:DescribeDBInstances", "rds:DescribeDBInstances"),
      ),
      metrics: metrics(denied("cloudwatch:GetMetricData", "cloudwatch:GetMetricData")),
    }
    expect(servicesInUse(refused)).toEqual([])
  })

  it("counts RDS only once an instance was actually returned", () => {
    const withInstance = database(DB_QUIET.outage, empty("rds:DescribeDBInstances"))
    expect(servicesInUse({ ...allWell(), database: withInstance })).not.toContain("RDS")
  })
})

describe("the metric queries behind the verdict", () => {
  it("derives a HealthyHostCount query from the ARNs a reader returned", () => {
    const specs = metricQueriesFor(allWell())
    const elb = specs.find((s) => s.metricName === "HealthyHostCount")
    expect(elb).toBeDefined()
    expect(elb?.namespace).toBe("AWS/ApplicationELB")
    expect(elb?.stat).toBe("Minimum")
    expect(elb?.periodSeconds).toBe(300)
    expect(elb?.dimensions).toEqual([
      { name: "TargetGroup", value: "targetgroup/tenure-prod-app/0f9e8d7c6b5a4321" },
      { name: "LoadBalancer", value: "app/tenure-prod/1a2b3c4d5e6f7890" },
    ])
    expect(elb?.resourceArn).toBe(TG_ARN)
  })

  it("skips a target group whose ARN does not carry the dimension", () => {
    const specs = metricQueriesFor({
      ...allWell(),
      loadBalancers: loadBalancers(
        actual(
          [
            loadBalancer(
              actual(
                [targetGroup({ kind: "all-serving", healthy: 1 }, "not-an-arn")],
                "elasticloadbalancing:DescribeTargetGroups",
              ),
            ),
          ],
          "elasticloadbalancing:DescribeLoadBalancers",
        ),
      ),
    })
    expect(specs.filter((s) => s.metricName === "HealthyHostCount")).toEqual([])
  })

  it("skips a group AWS does not list this load balancer for", () => {
    // The pair `TargetGroup` + `LoadBalancer` is only ever published for a group
    // AWS actually attaches to that load balancer. Asking for one it does not
    // returns an EMPTY series, and an empty HealthyHostCount is
    // indistinguishable from zero healthy hosts — a fabricated outage.
    const specs = metricQueriesFor({
      ...allWell(),
      loadBalancers: loadBalancers(
        actual(
          [
            loadBalancer(
              actual(
                [
                  targetGroup({ kind: "all-serving", healthy: 1 }, TG_ARN, {
                    loadBalancerArns: [
                      `arn:aws:elasticloadbalancing:${REGION}:${ACCOUNT}:loadbalancer/app/tenure-other/9f8e7d6c5b4a3210`,
                    ],
                  }),
                ],
                "elasticloadbalancing:DescribeTargetGroups",
              ),
            ),
          ],
          "elasticloadbalancing:DescribeLoadBalancers",
        ),
      ),
    })
    expect(specs.filter((s) => s.metricName === "HealthyHostCount")).toEqual([])
  })

  it("keeps a group whose attachment AWS did not report at all", () => {
    // An empty `LoadBalancerArns` is AWS not saying, not AWS denying. The
    // nesting came from a per-load-balancer DescribeTargetGroups call, so it
    // stands on its own and the series is still asked for.
    const specs = metricQueriesFor({
      ...allWell(),
      loadBalancers: loadBalancers(
        actual(
          [
            loadBalancer(
              actual(
                [targetGroup({ kind: "all-serving", healthy: 1 }, TG_ARN, { loadBalancerArns: [] })],
                "elasticloadbalancing:DescribeTargetGroups",
              ),
            ),
          ],
          "elasticloadbalancing:DescribeLoadBalancers",
        ),
      ),
    })
    expect(specs.filter((s) => s.metricName === "HealthyHostCount")).toHaveLength(1)
  })

  it("derives one CPU query per ECS service that was read", () => {
    const specs = metricQueriesFor({
      ...allWell(),
      containers: containers(
        actual(
          [cluster({ services: actual([service("tenure-prod-app")], "ecs:DescribeServices") })],
          "ecs:ListClusters",
        ),
      ),
    })
    const cpu = specs.find((s) => s.metricName === "CPUUtilization")
    expect(cpu?.dimensions).toEqual([
      { name: "ClusterName", value: "tenure-prod" },
      { name: "ServiceName", value: "tenure-prod-app" },
    ])
    expect(cpu?.key).toBe("ecs:cpu:tenure-prod/tenure-prod-app")
  })

  it("asks for nothing when no reader returned a resource", () => {
    expect(
      metricQueriesFor({
        alarms: null,
        awsHealth: null,
        loadBalancers: null,
        containers: null,
        database: null,
        metrics: null,
      }),
    ).toEqual([])
  })
})

describe("reading the six", () => {
  function readersFor(over: Partial<FleetHealthReaders> = {}): FleetHealthReaders {
    return {
      alarms: async () => ONE_OK_ALARM,
      awsHealth: async () => NO_AWS_EVENTS,
      loadBalancers: async () => SERVING_FINE,
      containers: async () => CONTAINERS_STEADY,
      database: async () => DB_QUIET,
      metrics: async () => METRICS_FINE,
      ...over,
    }
  }

  it("composes a verdict from the six reads", async () => {
    const verdict = await observeFleetHealth({
      readers: readersFor(),
      metricWindow: METRICS_FINE.window,
      metricQueries: [
        {
          key: "elb:healthy",
          namespace: "AWS/ApplicationELB",
          metricName: "HealthyHostCount",
          stat: "Minimum",
          periodSeconds: 300,
        },
      ],
      now: AT,
    })
    expect(verdict.level).toBe("HEALTHY")
    expect(verdict.asOf).toBe(AT.toISOString())
  })

  it("makes metrics a gap when no window was chosen, and never an OK", async () => {
    const verdict = await observeFleetHealth({
      readers: readersFor(),
      metricWindow: null,
      now: AT,
    })
    expect(verdict.level).toBe("CANNOT_SAY")
    expect(verdict.couldNotSee.map((b) => b.source)).toEqual(["metrics"])
  })

  it("turns a reader that threw into a named gap, keeping the others' findings", async () => {
    const verdict = await observeFleetHealth({
      readers: readersFor({
        alarms: async () => {
          throw new TypeError("Cannot read properties of undefined (reading 'MetricAlarms')")
        },
        loadBalancers: async () =>
          loadBalancers(
            actual(
              [
                loadBalancer(
                  actual(
                    [targetGroup({ kind: "no-targets", why: "nothing is registered." })],
                    "elasticloadbalancing:DescribeTargetGroups",
                  ),
                ),
              ],
              "elasticloadbalancing:DescribeLoadBalancers",
            ),
          ),
      }),
      metricWindow: METRICS_FINE.window,
      metricQueries: [
        {
          key: "elb:healthy",
          namespace: "AWS/ApplicationELB",
          metricName: "HealthyHostCount",
          stat: "Minimum",
          periodSeconds: 300,
        },
      ],
      now: AT,
    })
    // The load balancer finding survives; the thrown reader is a gap, not a pass.
    expect(verdict.findings.map((f) => f.kind)).toEqual(["no-healthy-targets"])
    expect(verdict.level).toBe("OUR_INCIDENT")
    // Exactly ONE alarm gap, and it is the thrown one. The composition's generic
    // "this pass did not run it" entry is replaced, because it is not true.
    const alarmGaps = verdict.couldNotSee.filter((b) => b.source === "alarms")
    expect(alarmGaps).toHaveLength(1)
    expect(alarmGaps[0].kind).toBe("unreadable")
    expect(alarmGaps[0].why).toContain("TypeError")
    expect(alarmGaps[0].why).not.toContain("did not run the alarms reader")
    expect(verdict.headline).toContain("alarms —")
  })

  it("a thrown reader can never make the verdict better than CANNOT_SAY", async () => {
    const verdict = await observeFleetHealth({
      readers: readersFor({
        database: async () => {
          throw new Error("boom")
        },
      }),
      metricWindow: METRICS_FINE.window,
      metricQueries: [
        {
          key: "elb:healthy",
          namespace: "AWS/ApplicationELB",
          metricName: "HealthyHostCount",
          stat: "Minimum",
          periodSeconds: 300,
        },
      ],
      now: AT,
    })
    expect(verdict.level).toBe("CANNOT_SAY")
    expect(verdict.couldNotSee.some((b) => b.source === "database")).toBe(true)
  })
})
