import { __resetIdentity } from "./identity"
import type { AwsGateway } from "./read"
import {
  DESCRIBE_SERVICES_BATCH,
  DESCRIBE_TASKS_BATCH,
  ECS_STOPPED_WINDOW,
  MAX_SERVICE_PAGES,
  MAX_TASK_DEFINITION_READS,
  classifyStopReason,
  containerLines,
  containerReadings,
  describeCountGap,
  describeStopCause,
  isIncident,
  looksLikeCredentialName,
  nameFromArn,
  serviceOfTaskGroup,
  significantExitCode,
  type ContainerReadings,
} from "./containers"

/**
 * STUDIO-070-004 (CONTAINERS) — ECS at task granularity, and the four truths it
 * has to keep apart.
 *
 * The assertions are on `containerReadings` and `containerLines`, the two
 * functions a route renders, rather than on `readAws` or on any parser. A test
 * that drove a private helper would stay green on the day this module stopped
 * calling it, which is precisely the failure this programme has already paid for
 * twice.
 *
 * ## The stand-in is a client, not a stub
 *
 * `fakeAws` answers eight capabilities with the shapes the real SDK returns —
 * `{clusterArns, nextToken}` from ListClusters, `{clusters, failures}` from
 * DescribeClusters, `{serviceArns, nextToken}` from ListServices,
 * `{services, failures}` from DescribeServices, `{taskArns, nextToken}` from
 * ListTasks, `{tasks, failures}` from DescribeTasks, `{taskDefinition}` from
 * DescribeTaskDefinition, `{ResourceTagMappingList}` from the Tagging API and
 * `{Account, Arn}` from STS — and it can fail each of them independently with an
 * `AccessDeniedException`, a `ThrottlingException`, an empty-but-successful list
 * or a populated one. A stand-in that returned `[]` regardless of what was asked
 * would prove nothing about code whose whole job is telling those four apart, and
 * it is the fake this repository has already been burnt by.
 *
 * Every account id here is the obviously-constructed `123456789012`. No AWS
 * account, ARN, cluster, service or resource name in this file is real, and no
 * approval, review or verification date is recorded anywhere in it.
 */

/* --------------------------------------------------------------- fixtures -- */

/** Obviously constructed. Not an account this or any organisation holds. */
const ACCOUNT = "123456789012"
const REGION = "eu-west-2"
const PARTITION = "aws"

const PROD = "tenure-prod"
const STUDIO = "tenure-studio"
const APP_SERVICE = "tenure-prod-app"
const WORKER_SERVICE = "tenure-prod-worker"

function clusterArn(name: string, partition = PARTITION, region = REGION): string {
  return `arn:${partition}:ecs:${region}:${ACCOUNT}:cluster/${name}`
}

function serviceArn(cluster: string, name: string): string {
  return `arn:${PARTITION}:ecs:${REGION}:${ACCOUNT}:service/${cluster}/${name}`
}

function taskArn(cluster: string, id: string): string {
  return `arn:${PARTITION}:ecs:${REGION}:${ACCOUNT}:task/${cluster}/${id}`
}

function definitionArn(family: string, revision: number): string {
  return `arn:${PARTITION}:ecs:${REGION}:${ACCOUNT}:task-definition/${family}:${revision}`
}

/**
 * An image reference, assembled from its parts rather than written out.
 *
 * `tests/architecture/forbidden-clients.test.mjs` refuses a literal
 * `…amazonaws.com` outside the owning adapter. Nothing in this suite opens a
 * socket; this is a registry handle in a fixture.
 */
function imageRef(repository: string, digestByte: string): string {
  return `${ACCOUNT}.${["dkr", "ecr", REGION, "amazonaws", "com"].join(".")}/${repository}@sha256:${digestByte.repeat(32)}`
}

/**
 * A value that must never appear in anything this module produces.
 *
 * Obviously constructed, and not a credential of any kind. It exists so a test
 * can assert on its ABSENCE from the whole reading and from every rendered line.
 */
const PLAINTEXT_VALUE = "OBVIOUSLY-CONSTRUCTED-NOT-A-REAL-CREDENTIAL-0000"

/** The `splunk-token` case the log-option allowlist exists for. Also constructed. */
const SPLUNK_TOKEN_VALUE = "OBVIOUSLY-CONSTRUCTED-NOT-A-REAL-SPLUNK-TOKEN"

type Outcome = "populated" | "empty" | "denied" | "throttled"

interface ContainerFixture {
  name: string
  image?: string
  essential?: boolean
  environment?: Array<{ name: string; value: string }>
  secrets?: Array<{ name: string; valueFrom: string }>
  logDriver?: string
  logOptions?: Record<string, string>
  secretOptions?: Array<{ name: string; valueFrom: string }>
  /** Omitted entirely — the "no logConfiguration at all" case. */
  noLogConfiguration?: boolean
}

interface DefinitionFixture {
  family: string
  revision: number
  cpu?: string
  memory?: string
  networkMode?: string
  containers: ContainerFixture[]
  /** Raised instead of answering DescribeTaskDefinition for this revision. */
  failWith?: string
}

interface ServiceFixture {
  name: string
  desired: number
  running: number
  pending?: number
  taskDefinition?: string | null
  targetGroupArn?: string
  rolloutState?: string
  rolloutStateReason?: string
}

interface TaskFixture {
  id: string
  service: string | null
  lastStatus?: string
  stoppedReason?: string
  stopCode?: string
  stoppedAt?: string
  taskDefinition?: string
  containers?: Array<{ name: string; exitCode?: number; reason?: string; digest?: string }>
}

interface ClusterFixture {
  name: string
  registeredInstances?: number
  capacityProviders?: string[]
  services?: ServiceFixture[]
  running?: TaskFixture[]
  stopped?: TaskFixture[]
  /** Independently failable sub-reads, by AWS error name. */
  listServicesFailWith?: string
  describeServicesFailWith?: string
  listTasksFailWith?: string
  describeTasksFailWith?: string
  /** Pages `ListServices` answers with, to drive the pagination bound. */
  servicePages?: number
  /** `DescribeClusters` failure entries against this cluster's ARN. */
  describeClusterFailure?: { reason: string; detail?: string }
}

interface FakeOptions {
  listClusters?: Outcome
  clusters?: ClusterFixture[]
  /** ListClusters answers with a nextToken this engine cannot send back. */
  clustersHaveNextPage?: boolean
  describeClusters?: Outcome
  definitions?: DefinitionFixture[]
  tags?: Record<string, Array<{ Key: string; Value: string }>>
  tagsOutcome?: Outcome
  identity?: { arn: string; account: string; region: string } | "denied"
  /** Set by the fake, so a test can assert what was and was not called. */
  calls?: Array<{ capability: string; input: Record<string, unknown> }>
}

function throwing(name: string): never {
  const error = new Error(`${name} raised by the stand-in AWS client`)
  error.name = name
  throw error
}

/** The revision `tenure-prod-app` runs in the healthy estate. */
function appDefinition(): DefinitionFixture {
  return {
    family: APP_SERVICE,
    revision: 41,
    cpu: "1024",
    memory: "2048",
    networkMode: "awsvpc",
    containers: [
      {
        name: "app",
        image: imageRef(APP_SERVICE, "a1"),
        essential: true,
        logDriver: "awslogs",
        logOptions: {
          "awslogs-group": `/ecs/${APP_SERVICE}`,
          "awslogs-region": REGION,
          "awslogs-stream-prefix": "ecs",
        },
        secrets: [
          { name: "DATABASE_URL", valueFrom: `arn:${PARTITION}:secretsmanager:${REGION}:${ACCOUNT}:secret:tenure/prod/database-abc` },
        ],
        environment: [
          { name: "NODE_ENV", value: "production" },
          { name: "PORT", value: "3000" },
        ],
      },
    ],
  }
}

/** The revision `tenure-prod-worker` runs. Carries the plain-text finding. */
function workerDefinition(): DefinitionFixture {
  return {
    family: WORKER_SERVICE,
    revision: 7,
    cpu: "512",
    memory: "1024",
    networkMode: "awsvpc",
    containers: [
      {
        name: "worker",
        image: imageRef(WORKER_SERVICE, "b2"),
        essential: true,
        logDriver: "splunk",
        logOptions: {
          "splunk-token": SPLUNK_TOKEN_VALUE,
          "splunk-url": "https://splunk.invalid",
        },
        secretOptions: [
          { name: "splunk-token-ref", valueFrom: `arn:${PARTITION}:ssm:${REGION}:${ACCOUNT}:parameter/tenure/splunk` },
        ],
        environment: [
          { name: "QUEUE_NAME", value: "tenure-prod-deliverables" },
          { name: "STRIPE_SECRET_KEY", value: PLAINTEXT_VALUE },
          { name: "SESSION_TOKEN", value: PLAINTEXT_VALUE },
        ],
      },
    ],
  }
}

/** Two clusters, three services, everything at its desired count. */
function healthyEstate(): ClusterFixture[] {
  return [
    {
      name: PROD,
      registeredInstances: 0,
      capacityProviders: ["FARGATE", "FARGATE_SPOT"],
      services: [
        {
          name: APP_SERVICE,
          desired: 2,
          running: 2,
          taskDefinition: definitionArn(APP_SERVICE, 41),
          targetGroupArn: `arn:${PARTITION}:elasticloadbalancing:${REGION}:${ACCOUNT}:targetgroup/tenure-app/abc`,
          rolloutState: "COMPLETED",
        },
        {
          name: WORKER_SERVICE,
          desired: 1,
          running: 1,
          taskDefinition: definitionArn(WORKER_SERVICE, 7),
          rolloutState: "COMPLETED",
        },
      ],
      running: [
        { id: "aaaa1111", service: APP_SERVICE, containers: [{ name: "app", digest: `sha256:${"a1".repeat(32)}` }] },
        { id: "aaaa2222", service: APP_SERVICE, containers: [{ name: "app" }] },
        { id: "bbbb1111", service: WORKER_SERVICE, containers: [{ name: "worker" }] },
      ],
      stopped: [],
    },
    {
      name: STUDIO,
      registeredInstances: 0,
      capacityProviders: ["FARGATE"],
      services: [],
      running: [],
      stopped: [],
    },
  ]
}

/* ------------------------------------------------------------- the client -- */

/**
 * A stand-in that behaves like the SDK: same response shapes, same error names,
 * paginating the way ECS paginates, batching-sensitive, and independently
 * failable per capability and per cluster.
 */
function fakeAws(options: FakeOptions = {}): AwsGateway {
  const listOutcome = options.listClusters ?? "populated"
  const clusters = options.clusters ?? healthyEstate()
  const definitions = options.definitions ?? [appDefinition(), workerDefinition()]
  const identity = options.identity ?? {
    arn: `arn:${PARTITION}:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
    account: ACCOUNT,
    region: REGION,
  }
  const calls = options.calls ?? []

  const clusterOf = (arnOrName: string): ClusterFixture | undefined =>
    clusters.find((c) => c.name === arnOrName || clusterArn(c.name) === arnOrName)

  const taskFixtures = (cluster: ClusterFixture, desiredStatus: string): TaskFixture[] =>
    desiredStatus === "STOPPED" ? (cluster.stopped ?? []) : (cluster.running ?? [])

  return {
    async call(capability, input) {
      const arg = (input ?? {}) as Record<string, unknown>
      calls.push({ capability: String(capability), input: arg })

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

        case "ecs:ListClusters": {
          if (listOutcome === "denied") throwing("AccessDeniedException")
          if (listOutcome === "throttled") throwing("ThrottlingException")
          // The real API returns an EMPTY ARRAY here rather than omitting the
          // field, which is a different shape from ECR's and is why the fake
          // models it rather than assuming.
          if (listOutcome === "empty") return { clusterArns: [] }
          return {
            clusterArns: clusters.map((c) => clusterArn(c.name)),
            nextToken: options.clustersHaveNextPage ? "there-is-more" : undefined,
          }
        }

        case "ecs:DescribeClusters": {
          const outcome = options.describeClusters ?? "populated"
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          const requested = (arg.clusters as string[] | undefined) ?? []
          const described = requested
            .map(clusterOf)
            .filter((c): c is ClusterFixture => c !== undefined && !c.describeClusterFailure)
          return {
            clusters:
              outcome === "empty"
                ? []
                : described.map((c) => ({
                    clusterArn: clusterArn(c.name),
                    clusterName: c.name,
                    status: "ACTIVE",
                    registeredContainerInstancesCount: c.registeredInstances ?? 0,
                    runningTasksCount: (c.running ?? []).length,
                    pendingTasksCount: 0,
                    activeServicesCount: (c.services ?? []).length,
                    capacityProviders: c.capacityProviders ?? [],
                    defaultCapacityProviderStrategy: (c.capacityProviders ?? []).map((p) => ({
                      capacityProvider: p,
                      weight: 1,
                      base: 0,
                    })),
                    statistics: [{ name: "runningFargateTasksCount", value: String((c.running ?? []).length) }],
                    settings: [{ name: "containerInsights", value: "enabled" }],
                  })),
            failures: requested
              .map(clusterOf)
              .filter((c): c is ClusterFixture => c !== undefined && c.describeClusterFailure !== undefined)
              .map((c) => ({
                arn: clusterArn(c.name),
                reason: (c.describeClusterFailure as { reason: string }).reason,
                detail: (c.describeClusterFailure as { detail?: string }).detail,
              })),
          }
        }

        case "ecs:ListServices": {
          const cluster = clusterOf(String(arg.cluster ?? ""))
          if (!cluster) throwing("ClusterNotFoundException")
          if (cluster.listServicesFailWith) throwing(cluster.listServicesFailWith)
          const totalPages = cluster.servicePages ?? 1
          const page = Number(arg.nextToken ?? 0)
          const names = (cluster.services ?? []).map((s) =>
            totalPages > 1 ? `${s.name}-p${page}` : s.name,
          )
          return {
            serviceArns: names.map((n) => serviceArn(cluster.name, n)),
            nextToken: page + 1 < totalPages ? String(page + 1) : undefined,
          }
        }

        case "ecs:DescribeServices": {
          const cluster = clusterOf(String(arg.cluster ?? ""))
          if (!cluster) throwing("ClusterNotFoundException")
          if (cluster.describeServicesFailWith) throwing(cluster.describeServicesFailWith)
          const requested = (arg.services as string[] | undefined) ?? []
          if (requested.length > DESCRIBE_SERVICES_BATCH) {
            // The real API rejects eleven. A fake that accepted them would let a
            // module ship a call that fails on a healthy estate.
            throwing("InvalidParameterException")
          }
          return {
            services: requested
              .map((arn) => {
                const name = arn.slice(arn.lastIndexOf("/") + 1)
                const fixture = (cluster.services ?? []).find(
                  (s) => s.name === name || name.startsWith(`${s.name}-p`),
                )
                if (!fixture) return null
                return {
                  serviceArn: arn,
                  serviceName: name,
                  clusterArn: clusterArn(cluster.name),
                  status: "ACTIVE",
                  desiredCount: fixture.desired,
                  runningCount: fixture.running,
                  pendingCount: fixture.pending ?? 0,
                  launchType: "FARGATE",
                  taskDefinition:
                    fixture.taskDefinition === null ? undefined : fixture.taskDefinition,
                  healthCheckGracePeriodSeconds: 60,
                  loadBalancers: fixture.targetGroupArn
                    ? [{ targetGroupArn: fixture.targetGroupArn, containerName: "app", containerPort: 3000 }]
                    : [],
                  deployments: [
                    {
                      id: `ecs-svc/${name}`,
                      status: "PRIMARY",
                      taskDefinition: fixture.taskDefinition ?? undefined,
                      desiredCount: fixture.desired,
                      runningCount: fixture.running,
                      pendingCount: fixture.pending ?? 0,
                      failedTasks: 0,
                      rolloutState: fixture.rolloutState,
                      rolloutStateReason: fixture.rolloutStateReason,
                      createdAt: new Date("2026-08-13T08:00:00.000Z"),
                      updatedAt: new Date("2026-08-13T08:05:00.000Z"),
                    },
                  ],
                }
              })
              .filter((s) => s !== null),
            failures: [],
          }
        }

        case "ecs:ListTasks": {
          const cluster = clusterOf(String(arg.cluster ?? ""))
          if (!cluster) throwing("ClusterNotFoundException")
          if (cluster.listTasksFailWith) throwing(cluster.listTasksFailWith)
          const fixtures = taskFixtures(cluster, String(arg.desiredStatus ?? "RUNNING"))
          return { taskArns: fixtures.map((t) => taskArn(cluster.name, t.id)) }
        }

        case "ecs:DescribeTasks": {
          const cluster = clusterOf(String(arg.cluster ?? ""))
          if (!cluster) throwing("ClusterNotFoundException")
          if (cluster.describeTasksFailWith) throwing(cluster.describeTasksFailWith)
          const requested = (arg.tasks as string[] | undefined) ?? []
          if (requested.length > DESCRIBE_TASKS_BATCH) throwing("InvalidParameterException")
          const all = [...(cluster.running ?? []), ...(cluster.stopped ?? [])]
          return {
            tasks: requested
              .map((arn) => {
                const id = arn.slice(arn.lastIndexOf("/") + 1)
                const fixture = all.find((t) => t.id === id)
                if (!fixture) return null
                const stopped = (cluster.stopped ?? []).some((t) => t.id === id)
                return {
                  taskArn: arn,
                  clusterArn: clusterArn(cluster.name),
                  taskDefinitionArn: fixture.taskDefinition ?? definitionArn(APP_SERVICE, 41),
                  lastStatus: fixture.lastStatus ?? (stopped ? "STOPPED" : "RUNNING"),
                  desiredStatus: stopped ? "STOPPED" : "RUNNING",
                  healthStatus: stopped ? "UNKNOWN" : "HEALTHY",
                  cpu: "1024",
                  memory: "2048",
                  group: fixture.service === null ? undefined : `service:${fixture.service}`,
                  launchType: "FARGATE",
                  capacityProviderName: "FARGATE",
                  availabilityZone: `${REGION}a`,
                  connectivity: "CONNECTED",
                  stopCode: fixture.stopCode,
                  stoppedReason: fixture.stoppedReason,
                  createdAt: new Date("2026-08-13T08:00:00.000Z"),
                  startedAt: new Date("2026-08-13T08:01:00.000Z"),
                  stoppedAt: fixture.stoppedAt ? new Date(fixture.stoppedAt) : undefined,
                  containers: (fixture.containers ?? [{ name: "app" }]).map((c) => ({
                    name: c.name,
                    image: imageRef(APP_SERVICE, "a1"),
                    imageDigest: c.digest,
                    lastStatus: stopped ? "STOPPED" : "RUNNING",
                    exitCode: c.exitCode,
                    reason: c.reason,
                    healthStatus: stopped ? "UNKNOWN" : "HEALTHY",
                  })),
                }
              })
              .filter((t) => t !== null),
            failures: [],
          }
        }

        case "ecs:DescribeTaskDefinition": {
          const requested = String(arg.taskDefinition ?? "")
          const fixture = definitions.find((d) => definitionArn(d.family, d.revision) === requested)
          if (!fixture) throwing("ClientException")
          if (fixture.failWith) throwing(fixture.failWith)
          return {
            taskDefinition: {
              taskDefinitionArn: requested,
              family: fixture.family,
              revision: fixture.revision,
              status: "ACTIVE",
              cpu: fixture.cpu,
              memory: fixture.memory,
              networkMode: fixture.networkMode,
              taskRoleArn: `arn:${PARTITION}:iam::${ACCOUNT}:role/${fixture.family}-task`,
              executionRoleArn: `arn:${PARTITION}:iam::${ACCOUNT}:role/${fixture.family}-execution`,
              requiresCompatibilities: ["FARGATE"],
              registeredAt: new Date("2026-08-01T00:00:00.000Z"),
              containerDefinitions: fixture.containers.map((c) => ({
                name: c.name,
                image: c.image,
                cpu: 1024,
                memory: 2048,
                essential: c.essential,
                environment: c.environment,
                secrets: c.secrets,
                logConfiguration: c.noLogConfiguration
                  ? undefined
                  : {
                      logDriver: c.logDriver ?? "awslogs",
                      options: c.logOptions ?? {},
                      secretOptions: c.secretOptions,
                    },
              })),
            },
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

const AT = () => new Date("2026-08-13T09:15:00.000Z")

async function load(options: FakeOptions = {}): Promise<ContainerReadings> {
  return containerReadings(fakeAws(options), { now: AT })
}

/** The whole surface as one string, which is what an operator actually reads. */
function surfaceText(readings: ContainerReadings): string {
  return containerLines(readings)
    .map((line) => `${line.label}: ${line.text}`)
    .join("\n")
}

function clusterNamed(readings: ContainerReadings, name: string) {
  if (readings.clusters.state !== "ACTUAL" && readings.clusters.state !== "STALE") {
    throw new Error(`clusters did not answer: ${readings.clusters.state}`)
  }
  const found = readings.clusters.value.find((c) => c.name === name)
  if (!found) throw new Error(`no cluster ${name} in the reading`)
  return found
}

function serviceNamed(readings: ContainerReadings, cluster: string, service: string) {
  const found = clusterNamed(readings, cluster)
  if (found.services.state !== "ACTUAL" && found.services.state !== "STALE") {
    throw new Error(`services did not answer: ${found.services.state}`)
  }
  const match = found.services.value.find((s) => s.name === service)
  if (!match) throw new Error(`no service ${service} in ${cluster}`)
  return match
}

beforeEach(() => {
  // resolveIdentity caches per process. Every case here supplies its own
  // gateway, which bypasses the cache, but a stale cache from another suite
  // would silently make these assertions test the wrong identity.
  __resetIdentity()
})

/* -------------------------------------------- the four outcomes, compared -- */

describe("the container surface says something different for each of the four outcomes", () => {
  test("a populated estate is ACTUAL and names every cluster, service and revision", async () => {
    const readings = await load()
    expect(readings.clusters.state).toBe("ACTUAL")
    if (readings.clusters.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.clusters.value).toHaveLength(2)

    const text = surfaceText(readings)
    expect(text).toContain(PROD)
    expect(text).toContain(STUDIO)
    expect(text).toContain(`${APP_SERVICE}:41`)
    expect(text).toContain(`${WORKER_SERVICE}:7`)
    // The capacity facts DescribeServices could never give.
    expect(text).toContain("capacity providers: FARGATE, FARGATE_SPOT")
    expect(readings.fleet.kind).toBe("steady")
  })

  test("an empty-but-successful cluster list is EMPTY and says none, not refused", async () => {
    const readings = await load({ listClusters: "empty" })
    expect(readings.clusters.state).toBe("EMPTY")
    const text = surfaceText(readings)
    expect(text).toContain("none —")
    expect(text).not.toContain("refused")
    expect(text).not.toContain("Minimum statement")
    expect(readings.fleet.kind).toBe("no-clusters")
  })

  test("AccessDenied is DENIED, carries the principal, the action and a pasteable statement", async () => {
    const readings = await load({ listClusters: "denied" })
    expect(readings.clusters.state).toBe("DENIED")
    if (readings.clusters.state !== "DENIED") throw new Error("narrowing")

    expect(readings.clusters.action).toBe("ecs:ListClusters")
    expect(readings.clusters.principal).toContain("assumed-role/tenure-studio-task")
    expect(readings.clusters.accountId).toBe(ACCOUNT)
    expect(readings.clusters.region).toBe(REGION)
    expect(readings.clusters.partition).toBe(PARTITION)
    expect(JSON.parse(readings.clusters.minimumStatement)).toEqual({
      Effect: "Allow",
      Action: ["ecs:ListClusters"],
      Resource: "*",
    })

    // And the thing it must NOT be. There is no `value` on this arm at all, so a
    // caller cannot reach an empty array; the render says "unknown".
    expect("value" in readings.clusters).toBe(false)
    expect(readings.fleet.kind).toBe("unknown")
    const text = surfaceText(readings)
    expect(text).toContain("unknown")
    expect(text).not.toContain("no ECS cluster exists")
  })

  test("a throttle is THROTTLED — its own state, not a failure and not an empty list", async () => {
    const readings = await load({ listClusters: "throttled" })
    expect(readings.clusters.state).toBe("THROTTLED")
    if (readings.clusters.state !== "THROTTLED") throw new Error("narrowing")
    // The schedule is throttle.ts's — 200ms after the first failure, doubling —
    // not a number retyped in this module.
    expect(readings.clusters.retryAfterMs).toBe(800)
    expect(readings.fleet.kind).toBe("unknown")
    const text = surfaceText(readings)
    expect(text).toContain("throttled")
    expect(text).not.toContain("Minimum statement")
  })

  test("the four outcomes produce four DIFFERENT rendered strings", async () => {
    const [populated, empty, denied, throttled] = await Promise.all([
      load().then(surfaceText),
      load({ listClusters: "empty" }).then(surfaceText),
      load({ listClusters: "denied" }).then(surfaceText),
      load({ listClusters: "throttled" }).then(surfaceText),
    ])
    const all = [populated, empty, denied, throttled]
    expect(new Set(all).size).toBe(4)
    // And specifically: the empty one and the denied one do not share a sentence.
    expect(empty).not.toContain("refused")
    expect(denied).toContain("refused")
  })
})

/* ------------------------------------------------- the reason it stopped -- */

describe("stoppedReason is read, classified, and told apart from every other reason", () => {
  function shortByOne(stopped: TaskFixture[]): ClusterFixture[] {
    return [
      {
        name: PROD,
        capacityProviders: ["FARGATE"],
        services: [
          {
            name: APP_SERVICE,
            desired: 2,
            running: 1,
            taskDefinition: definitionArn(APP_SERVICE, 41),
          },
        ],
        running: [{ id: "aaaa1111", service: APP_SERVICE }],
        stopped,
      },
    ]
  }

  const OOM = "OutOfMemoryError: Container killed due to memory usage"
  const ELB = "Task failed ELB health checks in (target-group arn:aws:elasticloadbalancing:eu-west-2:123456789012:targetgroup/tenure-app/abc)"

  test("an out-of-memory kill and a failed health check are DIFFERENT incidents", async () => {
    const oom = await load({
      clusters: shortByOne([
        {
          id: "dead1111",
          service: APP_SERVICE,
          stoppedReason: OOM,
          stopCode: "EssentialContainerExited",
          stoppedAt: "2026-08-13T09:10:00.000Z",
          containers: [{ name: "app", exitCode: 137, reason: OOM }],
        },
      ]),
    })
    const elb = await load({
      clusters: shortByOne([
        {
          id: "dead2222",
          service: APP_SERVICE,
          stoppedReason: ELB,
          stopCode: "ServiceSchedulerInitiated",
          stoppedAt: "2026-08-13T09:11:00.000Z",
          containers: [{ name: "app", exitCode: 0 }],
        },
      ]),
    })

    const oomGap = serviceNamed(oom, PROD, APP_SERVICE).gap
    const elbGap = serviceNamed(elb, PROD, APP_SERVICE).gap
    expect(oomGap.kind).toBe("explained")
    expect(elbGap.kind).toBe("explained")
    if (oomGap.kind !== "explained" || elbGap.kind !== "explained") throw new Error("narrowing")

    expect(oomGap.incidents[0].cause.kind).toBe("out-of-memory")
    expect(elbGap.incidents[0].cause.kind).toBe("health-check-failed")

    // The whole point: `1/2` is the same string for both, and these are not.
    expect(describeCountGap(oomGap)).not.toEqual(describeCountGap(elbGap))
    expect(describeCountGap(oomGap)).toContain("OUT OF MEMORY")
    expect(describeCountGap(elbGap)).toContain("HEALTH CHECK FAILED")
    expect(describeCountGap(oomGap)).toContain("1/2")
    expect(describeCountGap(elbGap)).toContain("1/2")

    // And the exit code travels, because 137 is the fact that confirms the OOM.
    expect(surfaceText(oom)).toContain("app=137")
  })

  test("a scale-in is NOT an incident and an out-of-memory kill is", () => {
    const scaling = classifyStopReason(
      "Scaling activity initiated by (deployment ecs-svc/9223370498012345678)",
      "ServiceSchedulerInitiated",
      null,
    )
    const oom = classifyStopReason("OutOfMemoryError: Container killed due to memory usage", "EssentialContainerExited", 137)
    expect(scaling.kind).toBe("scaling")
    expect(oom.kind).toBe("out-of-memory")
    expect(isIncident(scaling)).toBe(false)
    expect(isIncident(oom)).toBe(true)
    expect(describeStopCause(scaling)).not.toEqual(describeStopCause(oom))
  })

  test("an out-of-memory kill outranks the essential-container-exited it also reports", () => {
    // ECS reports BOTH for the same task. The memory sentence is the one that
    // names the remedy, so the ordered rules put it first.
    const cause = classifyStopReason(
      "OutOfMemoryError: Container killed due to memory usage",
      "EssentialContainerExited",
      137,
    )
    expect(cause.kind).toBe("out-of-memory")
  })

  test("an image that cannot be pulled is its own cause, not a health-check failure", () => {
    const cause = classifyStopReason(
      "CannotPullContainerError: pull image manifest has been retried 5 time(s)",
      "TaskFailedToStart",
      null,
    )
    expect(cause.kind).toBe("cannot-start")
    expect(describeStopCause(cause)).toContain("COULD NOT START")
  })

  test("a spot interruption with no stoppedReason is classified from the stopCode", () => {
    const cause = classifyStopReason(null, "SpotInterruption", null)
    expect(cause.kind).toBe("host-terminated")
  })

  test("no stoppedReason and no stopCode is UNREPORTED, which is not the same as other", () => {
    const unreported = classifyStopReason(null, null, null)
    const other = classifyStopReason("something ECS invented last Tuesday", null, null)
    expect(unreported.kind).toBe("unreported")
    expect(other.kind).toBe("other")
    expect(describeStopCause(unreported)).toContain("UNREPORTED")
    expect(describeStopCause(unreported)).not.toEqual(describeStopCause(other))
    // An unexplained stop is not filed under "probably fine".
    expect(isIncident(unreported)).toBe(true)
  })

  test("two tasks stopped for the same reason are ONE incident with a count of two", async () => {
    const readings = await load({
      clusters: [
        {
          name: PROD,
          services: [
            { name: APP_SERVICE, desired: 3, running: 1, taskDefinition: definitionArn(APP_SERVICE, 41) },
          ],
          running: [{ id: "aaaa1111", service: APP_SERVICE }],
          stopped: [
            { id: "dead1111", service: APP_SERVICE, stoppedReason: OOM, stopCode: "EssentialContainerExited", stoppedAt: "2026-08-13T09:10:00.000Z", containers: [{ name: "app", exitCode: 137 }] },
            { id: "dead2222", service: APP_SERVICE, stoppedReason: OOM, stopCode: "EssentialContainerExited", stoppedAt: "2026-08-13T09:12:00.000Z", containers: [{ name: "app", exitCode: 137 }] },
          ],
        },
      ],
    })
    const gap = serviceNamed(readings, PROD, APP_SERVICE).gap
    if (gap.kind !== "explained") throw new Error(`expected explained, got ${gap.kind}`)
    expect(gap.missing).toBe(2)
    expect(gap.incidents).toHaveLength(1)
    expect(gap.incidents[0].count).toBe(2)
    expect(gap.incidents[0].taskArns).toEqual([
      taskArn(PROD, "dead1111"),
      taskArn(PROD, "dead2222"),
    ])
  })

  test("a stopped task belonging to ANOTHER service does not explain this one's gap", async () => {
    const readings = await load({
      clusters: [
        {
          name: PROD,
          services: [
            { name: APP_SERVICE, desired: 2, running: 1, taskDefinition: definitionArn(APP_SERVICE, 41) },
            { name: WORKER_SERVICE, desired: 1, running: 1, taskDefinition: definitionArn(WORKER_SERVICE, 7) },
          ],
          running: [{ id: "aaaa1111", service: APP_SERVICE }, { id: "bbbb1111", service: WORKER_SERVICE }],
          stopped: [
            { id: "dead9999", service: WORKER_SERVICE, stoppedReason: OOM, stoppedAt: "2026-08-13T09:10:00.000Z" },
          ],
        },
      ],
    })
    const gap = serviceNamed(readings, PROD, APP_SERVICE).gap
    // A task of tenure-prod-worker stopped. That says nothing about the app's
    // missing task, and attributing it would be an invented explanation.
    expect(gap.kind).toBe("unexplained")
  })
})

/* ------------------------------------------- the gap, and what it is not -- */

describe("a gap with nothing to explain it is a different answer from a gap nobody could look at", () => {
  const shortService: ServiceFixture = {
    name: APP_SERVICE,
    desired: 2,
    running: 1,
    taskDefinition: definitionArn(APP_SERVICE, 41),
  }

  test("nothing stopped in the window is UNEXPLAINED — the scheduler is not placing them", async () => {
    const readings = await load({
      clusters: [{ name: PROD, services: [shortService], running: [{ id: "aaaa1111", service: APP_SERVICE }], stopped: [] }],
    })
    const gap = serviceNamed(readings, PROD, APP_SERVICE).gap
    expect(gap.kind).toBe("unexplained")
    if (gap.kind !== "unexplained") throw new Error("narrowing")
    expect(gap.missing).toBe(1)
    expect(gap.why).toContain("scheduler is not placing them")
    // And the window is stated, so "nothing stopped" is not read as "ever".
    expect(gap.why).toContain("retention window")
  })

  test("a refused ecs:ListTasks makes the gap UNKNOWN, never unexplained", async () => {
    const readings = await load({
      clusters: [
        {
          name: PROD,
          services: [shortService],
          running: [{ id: "aaaa1111", service: APP_SERVICE }],
          stopped: [],
          listTasksFailWith: "AccessDeniedException",
        },
      ],
    })
    const gap = serviceNamed(readings, PROD, APP_SERVICE).gap
    expect(gap.kind).toBe("unknown")
    if (gap.kind !== "unknown") throw new Error("narrowing")
    // The remedy is an IAM grant, not a subnet investigation. The two sentences
    // must not be interchangeable.
    expect(gap.why).toContain("ecs:ListTasks")
    expect(gap.why).not.toContain("scheduler is not placing them")
  })

  test("the unexplained sentence and the unknown sentence are provably different text", async () => {
    const unexplained = await load({
      clusters: [{ name: PROD, services: [shortService], running: [], stopped: [] }],
    })
    const unknown = await load({
      clusters: [
        { name: PROD, services: [shortService], running: [], stopped: [], listTasksFailWith: "AccessDeniedException" },
      ],
    })
    expect(describeCountGap(serviceNamed(unexplained, PROD, APP_SERVICE).gap)).not.toEqual(
      describeCountGap(serviceNamed(unknown, PROD, APP_SERVICE).gap),
    )
  })

  test("a service at its desired count reports no gap and the fleet is steady", async () => {
    const readings = await load()
    expect(serviceNamed(readings, PROD, APP_SERVICE).gap.kind).toBe("none")
    expect(readings.fleet.kind).toBe("steady")
    expect(surfaceText(readings)).toContain("at its desired count")
  })

  test("one refused sub-read anywhere makes the fleet UNVERIFIED rather than steady", async () => {
    const readings = await load({
      clusters: [
        {
          name: PROD,
          services: [{ name: APP_SERVICE, desired: 1, running: 1, taskDefinition: definitionArn(APP_SERVICE, 41) }],
          running: [{ id: "aaaa1111", service: APP_SERVICE }],
          stopped: [],
          describeTasksFailWith: "AccessDeniedException",
        },
      ],
    })
    expect(readings.fleet.kind).toBe("unverified")
    expect(describeFleet(readings)).toContain("not a gap it did not find")
  })

  function describeFleet(readings: ContainerReadings): string {
    return containerLines(readings).find((line) => line.label === "Fleet")?.text ?? ""
  }
})

/* -------------------------------------------------- independent failures -- */

describe("a denied sub-call degrades on its own and never collapses the row", () => {
  test("a refused ecs:DescribeClusters leaves the services and tasks readable", async () => {
    const readings = await load({ describeClusters: "denied" })
    const cluster = clusterNamed(readings, PROD)

    expect(cluster.detail.state).toBe("DENIED")
    if (cluster.detail.state !== "DENIED") throw new Error("narrowing")
    // The action named is the one that was refused, NOT ecs:ListClusters, which
    // worked. An operator pasting this statement gets the grant they need.
    expect(cluster.detail.action).toBe("ecs:DescribeClusters")

    // And the row survives: the services are still there, with their counts.
    expect(cluster.services.state).toBe("ACTUAL")
    expect(serviceNamed(readings, PROD, APP_SERVICE).desiredCount).toBe(2)
    // The capacity numbers are not defaulted to zero, which would read as a
    // cluster with no registered instances.
    const text = surfaceText(readings)
    expect(text).toContain("ecs:DescribeClusters")
    expect(text).not.toContain("0 registered instance(s)")
  })

  test("a refused ecs:ListServices names ecs:ListServices, not ecs:DescribeServices", async () => {
    const readings = await load({
      clusters: [{ name: PROD, services: [], listServicesFailWith: "AccessDeniedException" }],
    })
    const cluster = clusterNamed(readings, PROD)
    expect(cluster.services.state).toBe("DENIED")
    if (cluster.services.state !== "DENIED") throw new Error("narrowing")
    expect(cluster.services.action).toBe("ecs:ListServices")
  })

  test("a refused ecs:DescribeServices names ecs:DescribeServices", async () => {
    const readings = await load({
      clusters: [
        {
          name: PROD,
          services: [{ name: APP_SERVICE, desired: 1, running: 1 }],
          describeServicesFailWith: "AccessDeniedException",
        },
      ],
    })
    const cluster = clusterNamed(readings, PROD)
    expect(cluster.services.state).toBe("DENIED")
    if (cluster.services.state !== "DENIED") throw new Error("narrowing")
    expect(cluster.services.action).toBe("ecs:DescribeServices")
  })

  test("a refused ecs:DescribeTaskDefinition leaves the service's counts and gap intact", async () => {
    const readings = await load({
      clusters: [
        {
          name: PROD,
          services: [{ name: APP_SERVICE, desired: 2, running: 1, taskDefinition: definitionArn(APP_SERVICE, 41) }],
          running: [{ id: "aaaa1111", service: APP_SERVICE }],
          stopped: [
            {
              id: "dead1111",
              service: APP_SERVICE,
              stoppedReason: "OutOfMemoryError: Container killed due to memory usage",
              stoppedAt: "2026-08-13T09:10:00.000Z",
              containers: [{ name: "app", exitCode: 137 }],
            },
          ],
        },
      ],
      definitions: [{ ...appDefinition(), failWith: "AccessDeniedException" }],
    })
    const service = serviceNamed(readings, PROD, APP_SERVICE)
    expect(service.taskDefinition.state).toBe("DENIED")
    if (service.taskDefinition.state !== "DENIED") throw new Error("narrowing")
    expect(service.taskDefinition.action).toBe("ecs:DescribeTaskDefinition")
    // The half that survives: the counts, and the reason a task is missing.
    expect(service.gap.kind).toBe("explained")
    expect(surfaceText(readings)).toContain("OUT OF MEMORY")
  })

  test("a throttled ecs:DescribeTasks is THROTTLED on that row and does not touch the others", async () => {
    const readings = await load({
      clusters: [
        {
          name: PROD,
          services: [{ name: APP_SERVICE, desired: 1, running: 1, taskDefinition: definitionArn(APP_SERVICE, 41) }],
          running: [{ id: "aaaa1111", service: APP_SERVICE }],
          stopped: [],
          describeTasksFailWith: "ThrottlingException",
        },
        { name: STUDIO, services: [], running: [], stopped: [] },
      ],
    })
    expect(clusterNamed(readings, PROD).runningTasks.state).toBe("THROTTLED")
    expect(clusterNamed(readings, PROD).services.state).toBe("ACTUAL")
    expect(clusterNamed(readings, STUDIO).services.state).toBe("EMPTY")
  })

  test("ECS's own failures array is carried rather than silently shortening the answer", async () => {
    const readings = await load({
      clusters: [
        { name: PROD, services: [], running: [], stopped: [] },
        {
          name: STUDIO,
          services: [],
          running: [],
          stopped: [],
          describeClusterFailure: { reason: "MISSING", detail: "the cluster was deleted between the list and the describe" },
        },
      ],
    })
    const studio = clusterNamed(readings, STUDIO)
    expect(studio.failures).toHaveLength(1)
    expect(studio.failures[0].reason).toBe("MISSING")
    // The row still exists, and it says its capacity is unknown rather than zero.
    expect(studio.detail.state).toBe("ERROR")
    expect(surfaceText(readings)).toContain("MISSING")
  })
})

/* -------------------------------------------------- credentials by name -- */

describe("a credential-shaped environment name is a finding, and its value never leaves AWS", () => {
  test("plain-text names matching KEY/SECRET/TOKEN/PASSWORD are reported by NAME", async () => {
    const readings = await load()
    const names = readings.credentialFindings.map((f) => f.name)
    expect(names).toEqual(["SESSION_TOKEN", "STRIPE_SECRET_KEY"])
    expect(readings.credentialFindings[0].containerName).toBe("worker")
    expect(readings.credentialFindings[0].family).toBe(WORKER_SERVICE)
    expect(readings.credentialFindings[0].revision).toBe(7)
  })

  test("the VALUE appears nowhere in the reading and nowhere in the rendered lines", async () => {
    const readings = await load()
    // The whole object graph, serialised. If any field held the value, this fails.
    expect(JSON.stringify(readings)).not.toContain(PLAINTEXT_VALUE)
    expect(surfaceText(readings)).not.toContain(PLAINTEXT_VALUE)
    // And the name IS there, because the finding is worthless without it.
    expect(surfaceText(readings)).toContain("STRIPE_SECRET_KEY")
  })

  test("a splunk-token log option contributes its NAME and never its value", async () => {
    const readings = await load()
    expect(JSON.stringify(readings)).not.toContain(SPLUNK_TOKEN_VALUE)
    const worker = serviceNamed(readings, PROD, WORKER_SERVICE)
    if (worker.taskDefinition.state !== "ACTUAL") throw new Error("narrowing")
    const container = worker.taskDefinition.value.containers[0]
    if (container.logConfiguration.kind !== "configured") throw new Error("narrowing")
    expect(container.logConfiguration.driver).toBe("splunk")
    expect(container.logConfiguration.otherOptionNames).toEqual(["splunk-token", "splunk-url"])
    expect(container.logConfiguration.secretOptionNames).toEqual(["splunk-token-ref"])
  })

  test("an awslogs group IS carried, because it is the join key to the log reader", async () => {
    const readings = await load()
    const app = serviceNamed(readings, PROD, APP_SERVICE)
    if (app.taskDefinition.state !== "ACTUAL") throw new Error("narrowing")
    const container = app.taskDefinition.value.containers[0]
    if (container.logConfiguration.kind !== "configured") throw new Error("narrowing")
    expect(container.logConfiguration.logGroup).toBe(`/ecs/${APP_SERVICE}`)
    expect(container.logConfiguration.logRegion).toBe(REGION)
    expect(container.logConfiguration.otherOptionNames).toEqual([])
  })

  test("a container with NO logConfiguration says so rather than rendering blank", async () => {
    const readings = await load({
      definitions: [
        {
          ...appDefinition(),
          containers: [{ name: "app", image: imageRef(APP_SERVICE, "a1"), noLogConfiguration: true }],
        },
        workerDefinition(),
      ],
    })
    const app = serviceNamed(readings, PROD, APP_SERVICE)
    if (app.taskDefinition.state !== "ACTUAL") throw new Error("narrowing")
    expect(app.taskDefinition.value.containers[0].logConfiguration.kind).toBe("absent")
    expect(surfaceText(readings)).toContain("NO LOG CONFIGURATION")
  })

  test("a revision declaring secrets rather than plain text produces no finding", async () => {
    const readings = await load({
      definitions: [
        appDefinition(),
        {
          ...workerDefinition(),
          containers: [
            {
              name: "worker",
              image: imageRef(WORKER_SERVICE, "b2"),
              secrets: [{ name: "STRIPE_SECRET_KEY", valueFrom: `arn:${PARTITION}:secretsmanager:${REGION}:${ACCOUNT}:secret:tenure/prod/stripe-xyz` }],
              environment: [{ name: "QUEUE_NAME", value: "tenure-prod-deliverables" }],
            },
          ],
        },
      ],
    })
    expect(readings.credentialFindings).toEqual([])
    const worker = serviceNamed(readings, PROD, WORKER_SERVICE)
    if (worker.taskDefinition.state !== "ACTUAL") throw new Error("narrowing")
    expect(worker.taskDefinition.value.declaresSecrets).toBe(true)
    expect(worker.taskDefinition.value.containers[0].secretNames).toEqual(["STRIPE_SECRET_KEY"])
  })

  test("the name test is a substring match and over-reports on purpose", () => {
    expect(looksLikeCredentialName("STRIPE_SECRET_KEY")).toBe(true)
    expect(looksLikeCredentialName("session_token")).toBe(true)
    expect(looksLikeCredentialName("DB_PASSWD")).toBe(true)
    expect(looksLikeCredentialName("AWS_CREDENTIAL_PROFILE")).toBe(true)
    // Documented over-reporting: "MONKEY" contains "KEY". A name wrongly listed
    // discloses nothing; a credential wrongly missed is the defect.
    expect(looksLikeCredentialName("MONKEY_MODE")).toBe(true)
    expect(looksLikeCredentialName("NODE_ENV")).toBe(false)
    expect(looksLikeCredentialName("PORT")).toBe(false)
  })
})

/* ------------------------------------------------------- the task detail -- */

describe("the revision each service is actually running", () => {
  test("the image, cpu, memory, network mode and log group are read", async () => {
    const readings = await load()
    const app = serviceNamed(readings, PROD, APP_SERVICE)
    expect(app.taskDefinitionArn).toBe(definitionArn(APP_SERVICE, 41))
    if (app.taskDefinition.state !== "ACTUAL") throw new Error("narrowing")
    const definition = app.taskDefinition.value
    expect(definition.family).toBe(APP_SERVICE)
    expect(definition.revision).toBe(41)
    expect(definition.cpu).toBe("1024")
    expect(definition.memory).toBe("2048")
    expect(definition.networkMode).toBe("awsvpc")
    expect(definition.containers[0].image).toContain("@sha256:")
    expect(definition.declaresSecrets).toBe(true)
    expect(definition.declaresPlainTextEnvironment).toBe(true)
  })

  test("the running task carries the image DIGEST, which is what a mutable tag cannot", async () => {
    const readings = await load()
    const cluster = clusterNamed(readings, PROD)
    if (cluster.runningTasks.state !== "ACTUAL") throw new Error("narrowing")
    const withDigest = cluster.runningTasks.value.find((t) => t.containers[0].imageDigest !== null)
    expect(withDigest?.containers[0].imageDigest).toBe(`sha256:${"a1".repeat(32)}`)
  })

  test("one revision shared by two services is described ONCE", async () => {
    const calls: FakeOptions["calls"] = []
    await containerReadings(
      fakeAws({
        calls,
        clusters: [
          {
            name: PROD,
            services: [
              { name: APP_SERVICE, desired: 1, running: 1, taskDefinition: definitionArn(APP_SERVICE, 41) },
              { name: WORKER_SERVICE, desired: 1, running: 1, taskDefinition: definitionArn(APP_SERVICE, 41) },
            ],
            running: [],
            stopped: [],
          },
        ],
      }),
      { now: AT },
    )
    const described = calls.filter((c) => c.capability === "ecs:DescribeTaskDefinition")
    expect(described).toHaveLength(1)
  })

  test("a service whose taskDefinition ECS did not report says so rather than going blank", async () => {
    const readings = await load({
      clusters: [
        { name: PROD, services: [{ name: APP_SERVICE, desired: 1, running: 1, taskDefinition: null }], running: [], stopped: [] },
      ],
    })
    const app = serviceNamed(readings, PROD, APP_SERVICE)
    expect(app.taskDefinition.state).toBe("UNCONFIGURED")
    if (app.taskDefinition.state !== "UNCONFIGURED") throw new Error("narrowing")
    expect(app.taskDefinition.why).toContain("no revision ARN to describe")
  })
})

/* ---------------------------------------------------------- the bounding -- */

describe("pagination is bounded, and hitting the bound is reported rather than hidden", () => {
  test("a ListClusters nextToken this engine cannot send is a stated truncation", async () => {
    const readings = await load({ clustersHaveNextPage: true })
    expect(readings.truncation.kind).toBe("truncated")
    if (readings.truncation.kind !== "truncated") throw new Error("narrowing")
    expect(readings.truncation.why).toContain("cannot send one")
    expect(surfaceText(readings)).toContain("TRUNCATED")
  })

  test("a complete cluster listing is NOT marked truncated", async () => {
    const readings = await load()
    expect(readings.truncation.kind).toBe("complete")
    expect(surfaceText(readings)).not.toContain("TRUNCATED")
  })

  test("a ListServices page count past the bound stops and says there were more", async () => {
    const readings = await load({
      clusters: [
        {
          name: PROD,
          services: [{ name: APP_SERVICE, desired: 1, running: 1, taskDefinition: definitionArn(APP_SERVICE, 41) }],
          servicePages: MAX_SERVICE_PAGES + 3,
          running: [],
          stopped: [],
        },
      ],
    })
    const cluster = clusterNamed(readings, PROD)
    expect(cluster.serviceTruncation.kind).toBe("truncated")
    if (cluster.serviceTruncation.kind !== "truncated") throw new Error("narrowing")
    expect(cluster.serviceTruncation.pagesRead).toBe(MAX_SERVICE_PAGES)
    // Bounded, not unbounded: exactly MAX_SERVICE_PAGES calls, never all 13.
    expect(cluster.serviceTruncation.itemsRead).toBe(MAX_SERVICE_PAGES)
  })

  test("DescribeServices is batched at the API's ceiling of ten, never above it", async () => {
    const calls: FakeOptions["calls"] = []
    const many: ServiceFixture[] = Array.from({ length: 23 }, (_unused, i) => ({
      name: `svc-${String(i).padStart(2, "0")}`,
      desired: 1,
      running: 1,
      taskDefinition: definitionArn(APP_SERVICE, 41),
    }))
    await containerReadings(
      fakeAws({ calls, clusters: [{ name: PROD, services: many, running: [], stopped: [] }] }),
      { now: AT },
    )
    const describes = calls.filter((c) => c.capability === "ecs:DescribeServices")
    expect(describes).toHaveLength(3)
    for (const call of describes) {
      expect((call.input.services as string[]).length).toBeLessThanOrEqual(DESCRIBE_SERVICES_BATCH)
    }
  })

  test("DescribeTasks is batched at the API's ceiling of one hundred", async () => {
    const calls: FakeOptions["calls"] = []
    const many: TaskFixture[] = Array.from({ length: 150 }, (_unused, i) => ({
      id: `task-${String(i).padStart(3, "0")}`,
      service: APP_SERVICE,
    }))
    await containerReadings(
      fakeAws({
        calls,
        clusters: [
          {
            name: PROD,
            services: [{ name: APP_SERVICE, desired: 150, running: 150, taskDefinition: definitionArn(APP_SERVICE, 41) }],
            running: many,
            stopped: [],
          },
        ],
      }),
      { now: AT },
    )
    const describes = calls.filter((c) => c.capability === "ecs:DescribeTasks")
    expect(describes.length).toBeGreaterThanOrEqual(2)
    for (const call of describes) {
      expect((call.input.tasks as string[]).length).toBeLessThanOrEqual(DESCRIBE_TASKS_BATCH)
    }
  })

  test("the task-definition budget is a number this suite can read, not a hidden literal", () => {
    expect(MAX_TASK_DEFINITION_READS).toBeGreaterThan(0)
  })
})

/* ------------------------------------------------------------ attribution -- */

describe("every resource is attributed where a tag says so, and marked shared where none does", () => {
  test("a tenure:tenant tag attributes the cluster and the service to that tenant", async () => {
    const readings = await load({
      tags: {
        [clusterArn(PROD)]: [{ Key: "tenure:tenant", Value: "northgate-academy" }],
        [serviceArn(PROD, APP_SERVICE)]: [{ Key: "tenure:tenant", Value: "northgate-academy" }],
      },
    })
    expect(clusterNamed(readings, PROD).attribution).toEqual({
      kind: "tenant",
      tenantSlug: "northgate-academy",
    })
    expect(serviceNamed(readings, PROD, APP_SERVICE).attribution).toEqual({
      kind: "tenant",
      tenantSlug: "northgate-academy",
    })
  })

  test("the shared value marks platform overhead, and is not a tenant called shared", async () => {
    const readings = await load({
      tags: { [clusterArn(PROD)]: [{ Key: "tenure:tenant", Value: "tenure:shared" }] },
    })
    expect(clusterNamed(readings, PROD).attribution).toEqual({ kind: "shared" })
  })

  test("an untagged cluster is unattributed, which is a finding and not a tenant", async () => {
    const readings = await load({ tags: {} })
    expect(clusterNamed(readings, PROD).attribution).toEqual({ kind: "unattributed" })
  })

  test("a REFUSED tag index is unknown — not unattributed, which would blame the tag", async () => {
    const readings = await load({ tagsOutcome: "denied" })
    const attribution = clusterNamed(readings, PROD).attribution
    expect(attribution.kind).toBe("unknown")
    if (attribution.kind !== "unknown") throw new Error("narrowing")
    expect(attribution.why).toContain("tag:GetResources")
  })
})

/* ------------------------------------------------- region, and never a literal -- */

describe("region and partition come from the resolved identity or the ARN, never a literal", () => {
  test("both are read off the cluster's own ARN", async () => {
    const readings = await load()
    const cluster = clusterNamed(readings, PROD)
    expect(cluster.region).toBe(REGION)
    expect(cluster.partition).toBe(PARTITION)
  })

  test("a GovCloud ARN keeps its own partition and region", async () => {
    // Constructed, not observed: this estate has no GovCloud presence. The point
    // is that nothing here rewrites what the ARN says.
    const govArn = `arn:aws-us-gov:ecs:us-gov-west-1:${ACCOUNT}:cluster/${PROD}`
    const gateway: AwsGateway = {
      async call(capability, input) {
        if (capability === "ecs:ListClusters") return { clusterArns: [govArn] }
        return fakeAws({ clusters: [] }).call(capability, input)
      },
      async resolvedRegion() {
        return "us-gov-west-1"
      },
    }
    const readings = await containerReadings(gateway, { now: AT })
    const cluster = clusterNamed(readings, PROD)
    expect(cluster.partition).toBe("aws-us-gov")
    expect(cluster.region).toBe("us-gov-west-1")
  })

  test("an unparseable cluster identifier falls back to the identity, not to us-east-1", async () => {
    const gateway: AwsGateway = {
      async call(capability, input) {
        // ECS accepts a bare cluster NAME as well as an ARN, and ListClusters
        // has been observed returning one in older API versions.
        if (capability === "ecs:ListClusters") return { clusterArns: [PROD] }
        return fakeAws({ clusters: [{ name: PROD, services: [], running: [], stopped: [] }] }).call(
          capability,
          input,
        )
      },
      async resolvedRegion() {
        return REGION
      },
    }
    const readings = await containerReadings(gateway, { now: AT })
    const cluster = clusterNamed(readings, PROD)
    expect(cluster.region).toBe(REGION)
    expect(cluster.partition).toBe(PARTITION)
  })

  test("when identity itself is refused, nothing invents a region", async () => {
    const gateway: AwsGateway = {
      async call(capability, input) {
        if (capability === "sts:GetCallerIdentity") throwing("AccessDenied")
        if (capability === "ecs:ListClusters") return { clusterArns: [PROD] }
        return fakeAws({ clusters: [{ name: PROD, services: [], running: [], stopped: [] }] }).call(
          capability,
          input,
        )
      },
      async resolvedRegion() {
        return REGION
      },
    }
    const readings = await containerReadings(gateway, { now: AT })
    const cluster = clusterNamed(readings, PROD)
    expect(cluster.region).toBeNull()
    expect(cluster.partition).toBeNull()
    expect(readings.identity.state).toBe("DENIED")
  })
})

/* ---------------------------------------------------- as-of and cadence -- */

describe("every reading carries when it was read and how often it is re-read", () => {
  test("as-of is the injected clock's, on the load and on every cluster", async () => {
    const readings = await load()
    expect(readings.asOf).toBe("2026-08-13T09:15:00.000Z")
    expect(clusterNamed(readings, PROD).asOf).toBe("2026-08-13T09:15:00.000Z")
  })

  test("each cadence is its own capability's, from the registry rather than retyped", async () => {
    const readings = await load()
    const { CAPABILITIES } = await import("./capabilities")
    expect(readings.refreshMs.clusters).toBe(CAPABILITIES["ecs:ListClusters"].refreshMs)
    expect(readings.refreshMs.clusterDetail).toBe(CAPABILITIES["ecs:DescribeClusters"].refreshMs)
    expect(readings.refreshMs.services).toBe(CAPABILITIES["ecs:DescribeServices"].refreshMs)
    expect(readings.refreshMs.tasks).toBe(CAPABILITIES["ecs:DescribeTasks"].refreshMs)
    expect(readings.refreshMs.taskDefinition).toBe(
      CAPABILITIES["ecs:DescribeTaskDefinition"].refreshMs,
    )
    // And the task-definition cadence is deliberately the SLOW one: a revision
    // is immutable, so re-reading it every fifteen seconds buys nothing.
    expect(readings.refreshMs.taskDefinition).toBeGreaterThan(readings.refreshMs.clusters)
  })

  test("the stopped-task window travels with every cluster, so silence is qualified", async () => {
    const readings = await load()
    expect(clusterNamed(readings, PROD).stoppedWindow).toBe(ECS_STOPPED_WINDOW)
    expect(ECS_STOPPED_WINDOW.why).toContain("approximately one hour")
  })

  test("the five ECS capabilities this module reads are all in the registry", async () => {
    const { CAPABILITIES } = await import("./capabilities")
    for (const capability of [
      "ecs:ListClusters",
      "ecs:DescribeClusters",
      "ecs:ListServices",
      "ecs:DescribeServices",
      "ecs:ListTasks",
      "ecs:DescribeTasks",
      "ecs:DescribeTaskDefinition",
    ] as const) {
      expect(CAPABILITIES[capability]).toBeDefined()
      expect(CAPABILITIES[capability].iamActions).toContain(capability)
    }
  })
})

/* --------------------------------------------------------------- helpers -- */

describe("the small decisions, stated", () => {
  test("a task group names its service, and a non-service group names nothing", () => {
    expect(serviceOfTaskGroup(`service:${APP_SERVICE}`)).toBe(APP_SERVICE)
    expect(serviceOfTaskGroup("family:tenure-migrate")).toBeNull()
    expect(serviceOfTaskGroup(null)).toBeNull()
  })

  test("the significant exit code is the first NON-ZERO one, because zero explains nothing", () => {
    expect(
      significantExitCode([
        { name: "sidecar", image: null, imageDigest: null, lastStatus: null, exitCode: 0, reason: null, healthStatus: null },
        { name: "app", image: null, imageDigest: null, lastStatus: null, exitCode: 137, reason: null, healthStatus: null },
      ]),
    ).toBe(137)
    expect(
      significantExitCode([
        { name: "app", image: null, imageDigest: null, lastStatus: null, exitCode: 0, reason: null, healthStatus: null },
      ]),
    ).toBe(0)
    expect(
      significantExitCode([
        { name: "app", image: null, imageDigest: null, lastStatus: null, exitCode: null, reason: null, healthStatus: null },
      ]),
    ).toBeNull()
  })

  test("a cluster name is the last ARN segment, and a bare name is itself", () => {
    expect(nameFromArn(clusterArn(PROD))).toBe(PROD)
    expect(nameFromArn(PROD)).toBe(PROD)
  })

  test("an unmodelled failure is ERROR with a lead, not EMPTY", async () => {
    const readings = await load({
      clusters: [
        { name: PROD, services: [], running: [], stopped: [], listServicesFailWith: "ClusterNotFoundException" },
      ],
    })
    const cluster = clusterNamed(readings, PROD)
    expect(cluster.services.state).toBe("ERROR")
    if (cluster.services.state !== "ERROR") throw new Error("narrowing")
    expect(cluster.services.code).toBe("ClusterNotFoundException")
    expect(cluster.services.safeDetail).toContain("ClusterNotFoundException")
  })

  test("credential material in an error message never reaches the surface", async () => {
    const gateway: AwsGateway = {
      async call(capability) {
        if (capability === "sts:GetCallerIdentity") {
          return { Account: ACCOUNT, Arn: `arn:${PARTITION}:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc` }
        }
        if (capability === "tag:GetResources") return { ResourceTagMappingList: [] }
        // An obviously-constructed access-key-shaped string, not a credential.
        throw new Error("ECS refused: AKIAIOSFODNN7EXAMPLE could not be used")
      },
      async resolvedRegion() {
        return REGION
      },
    }
    const readings = await containerReadings(gateway, { now: AT })
    expect(JSON.stringify(readings)).not.toContain("AKIAIOSFODNN7EXAMPLE")
    expect(JSON.stringify(readings)).toContain("[access-key-id]")
  })

  test("two loads of the same estate produce byte-identical readings", async () => {
    const first = await load()
    const second = await load()
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })
})
