import { __resetIdentity } from "../../../lib/aws/identity"
import { containerReadings } from "../../../lib/aws/containers"
import { ecrReadings } from "../../../lib/aws/ecr"
import { lambdaInventory } from "../../../lib/aws/lambda"
import type { AwsGateway } from "../../../lib/aws/read"

import {
  computeAnswer,
  countsFor,
  correlationFor,
  deployedImageRows,
  exitCodeLine,
  imageSummary,
  readFailures,
  registryIndex,
  runningServiceRows,
  runtimeHeadline,
  runtimeRows,
  runtimeTally,
  statedAsOf,
  stoppedSummary,
  stoppedTaskRows,
  unknownArm,
  worstSeverity,
} from "./compute-answer"

/**
 * What `/platform/compute` says, decided without a browser and without an estate.
 *
 * ── Why every reading here comes out of the real readers ────────────────────
 *
 * Every `ClusterReading`, `RepositoryReading` and `LambdaFunctionReading` below
 * is produced by `containerReadings()`, `ecrReadings()` and `lambdaInventory()`
 * — the three functions the page calls — driven through a stand-in gateway that
 * answers with the shapes the AWS SDK actually returns. A test that constructed
 * `AwsRead` literals of its own would agree with whatever this module did on the
 * day it was written and stay green the day a reader changed the shape it
 * produces. That is the failure this repository has already paid for.
 *
 * ── What it is really guarding ──────────────────────────────────────────────
 *
 * Four claims, each of which is a specific wrong sentence this page could print:
 *
 *   1. "Steady" for a fleet at its desired count whose tasks are crash-looping.
 *      ECS replaces a task that dies, so `running === desired` is true at almost
 *      every instant a crash-looping service is observed.
 *   2. An empty stopped-task table for a cluster whose `ecs:DescribeTasks` was
 *      refused.
 *   3. "Not in this registry" for a digest whose repository's image list was
 *      refused.
 *   4. A zero in the findings column for an image in a repository that does not
 *      scan on push.
 *
 * Every account id here is the obviously-constructed `123456789012`. No AWS
 * account, ARN, cluster, service, repository or function name in this file is
 * real, and no approval, review, certification or verification date is recorded
 * anywhere in it.
 */

/* ------------------------------------------------------------- fixtures -- */

/** Obviously constructed. Not an account this or any organisation holds. */
const ACCOUNT = "123456789012"
const REGION = "eu-west-2"
const PARTITION = "aws"

const PROD = "tenure-prod"
const APP = "tenure-prod-app"
const WORKER = "tenure-prod-worker"

const APP_DIGEST = `sha256:${"a1".repeat(32)}`
const WORKER_DIGEST = `sha256:${"b2".repeat(32)}`
/** A digest that is running and is in no repository the stand-in will admit to. */
const ORPHAN_DIGEST = `sha256:${"c3".repeat(32)}`

const clusterArn = (name: string) => `arn:${PARTITION}:ecs:${REGION}:${ACCOUNT}:cluster/${name}`
const serviceArn = (cluster: string, name: string) =>
  `arn:${PARTITION}:ecs:${REGION}:${ACCOUNT}:service/${cluster}/${name}`
const taskArn = (cluster: string, id: string) =>
  `arn:${PARTITION}:ecs:${REGION}:${ACCOUNT}:task/${cluster}/${id}`
const definitionArn = (family: string, revision: number) =>
  `arn:${PARTITION}:ecs:${REGION}:${ACCOUNT}:task-definition/${family}:${revision}`
const functionArn = (name: string) =>
  `arn:${PARTITION}:lambda:${REGION}:${ACCOUNT}:function:${name}`

/**
 * A registry handle, assembled from its parts rather than written out.
 *
 * `tests/architecture/forbidden-clients.test.mjs` refuses a literal
 * `…amazonaws.com` outside the owning adapter. Nothing here opens a socket.
 */
const registryHost = `${ACCOUNT}.${["dkr", "ecr", REGION, "amazonaws", "com"].join(".")}`
const imageRef = (repository: string, digest: string) =>
  `${registryHost}/${repository}@${digest}`

/**
 * A value that must never appear in anything this page produces.
 *
 * Obviously constructed, and not a credential of any kind. It exists so a test
 * can assert on its ABSENCE from every row and every sentence.
 */
const PLAINTEXT_VALUE = "OBVIOUSLY-CONSTRUCTED-NOT-A-REAL-CREDENTIAL-0000"

function throwing(name: string): never {
  const error = new Error(`${name} raised by the stand-in AWS client`)
  error.name = name
  throw error
}

interface TaskFixture {
  id: string
  service: string | null
  stoppedReason?: string
  stopCode?: string
  stoppedAt?: string
  containers?: Array<{ name: string; exitCode?: number; digest?: string }>
}

interface ServiceFixture {
  name: string
  desired: number
  running: number
  taskDefinition: string
}

interface RepositoryFixture {
  name: string
  scanOnPush: boolean
  images: Array<{
    digest: string
    tags: string[]
    severityCounts?: Record<string, number>
    /** No scan status at all — ECR has never looked at this image. */
    noScan?: boolean
  }>
  /** Raised instead of answering `ecr:DescribeImages` for this repository. */
  describeImagesFailWith?: string
}

interface FunctionFixture {
  name: string
  runtime?: string
  packageType?: string
}

interface Estate {
  services?: ServiceFixture[]
  running?: TaskFixture[]
  stopped?: TaskFixture[]
  describeTasksFailWith?: string
  repositories?: RepositoryFixture[]
  describeRepositoriesFailWith?: string
  functions?: FunctionFixture[]
}

/**
 * A stand-in that behaves like the SDK: the same response shapes, the same error
 * names, and independently failable per capability.
 *
 * `now` is fixed so every timestamp in this file is deterministic and no
 * assertion depends on the wall clock.
 */
function fakeAws(estate: Estate = {}): AwsGateway {
  const services = estate.services ?? []
  const running = estate.running ?? []
  const stopped = estate.stopped ?? []
  const repositories = estate.repositories ?? []
  const functions = estate.functions ?? []

  return {
    async call(capability, input) {
      const arg = (input ?? {}) as Record<string, unknown>
      switch (capability) {
        case "sts:GetCallerIdentity":
          return {
            Account: ACCOUNT,
            Arn: `arn:${PARTITION}:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
            UserId: "AROA:studio",
          }

        case "tag:GetResources":
          return { ResourceTagMappingList: [] }

        case "ecs:ListClusters":
          return { clusterArns: [clusterArn(PROD)] }

        case "ecs:DescribeClusters":
          return {
            clusters: [
              {
                clusterArn: clusterArn(PROD),
                clusterName: PROD,
                status: "ACTIVE",
                registeredContainerInstancesCount: 0,
                runningTasksCount: running.length,
                pendingTasksCount: 0,
                activeServicesCount: services.length,
                capacityProviders: ["FARGATE"],
                defaultCapacityProviderStrategy: [
                  { capacityProvider: "FARGATE", weight: 1, base: 0 },
                ],
                statistics: [],
                settings: [],
              },
            ],
            failures: [],
          }

        case "ecs:ListServices":
          return { serviceArns: services.map((s) => serviceArn(PROD, s.name)) }

        case "ecs:DescribeServices":
          return {
            services: ((arg.services as string[] | undefined) ?? [])
              .map((arn) => {
                const name = arn.slice(arn.lastIndexOf("/") + 1)
                const fixture = services.find((s) => s.name === name)
                if (!fixture) return null
                return {
                  serviceArn: arn,
                  serviceName: name,
                  clusterArn: clusterArn(PROD),
                  status: "ACTIVE",
                  desiredCount: fixture.desired,
                  runningCount: fixture.running,
                  pendingCount: 0,
                  launchType: "FARGATE",
                  taskDefinition: fixture.taskDefinition,
                  loadBalancers: [],
                  deployments: [],
                }
              })
              .filter((s) => s !== null),
            failures: [],
          }

        case "ecs:ListTasks": {
          const wanted = String(arg.desiredStatus ?? "RUNNING") === "STOPPED" ? stopped : running
          return { taskArns: wanted.map((t) => taskArn(PROD, t.id)) }
        }

        case "ecs:DescribeTasks": {
          if (estate.describeTasksFailWith) throwing(estate.describeTasksFailWith)
          const all = [...running, ...stopped]
          return {
            tasks: ((arg.tasks as string[] | undefined) ?? [])
              .map((arn) => {
                const id = arn.slice(arn.lastIndexOf("/") + 1)
                const fixture = all.find((t) => t.id === id)
                if (!fixture) return null
                const isStopped = stopped.some((t) => t.id === id)
                return {
                  taskArn: arn,
                  clusterArn: clusterArn(PROD),
                  taskDefinitionArn: definitionArn(APP, 41),
                  lastStatus: isStopped ? "STOPPED" : "RUNNING",
                  desiredStatus: isStopped ? "STOPPED" : "RUNNING",
                  cpu: "1024",
                  memory: "2048",
                  group: fixture.service === null ? undefined : `service:${fixture.service}`,
                  launchType: "FARGATE",
                  stopCode: fixture.stopCode,
                  stoppedReason: fixture.stoppedReason,
                  createdAt: new Date("2026-08-13T08:00:00.000Z"),
                  startedAt: new Date("2026-08-13T08:01:00.000Z"),
                  stoppedAt: fixture.stoppedAt ? new Date(fixture.stoppedAt) : undefined,
                  containers: (fixture.containers ?? [{ name: "app" }]).map((c) => ({
                    name: c.name,
                    image: imageRef(APP, c.digest ?? APP_DIGEST),
                    imageDigest: c.digest,
                    lastStatus: isStopped ? "STOPPED" : "RUNNING",
                    exitCode: c.exitCode,
                  })),
                }
              })
              .filter((t) => t !== null),
            failures: [],
          }
        }

        case "ecs:DescribeTaskDefinition": {
          const requested = String(arg.taskDefinition ?? "")
          const family = requested.includes(WORKER) ? WORKER : APP
          return {
            taskDefinition: {
              taskDefinitionArn: requested,
              family,
              revision: family === WORKER ? 7 : 41,
              status: "ACTIVE",
              cpu: family === WORKER ? "512" : "1024",
              memory: family === WORKER ? "1024" : "2048",
              networkMode: "awsvpc",
              requiresCompatibilities: ["FARGATE"],
              registeredAt: new Date("2026-08-01T00:00:00.000Z"),
              containerDefinitions: [
                {
                  name: family === WORKER ? "worker" : "app",
                  image: imageRef(family, family === WORKER ? WORKER_DIGEST : APP_DIGEST),
                  essential: true,
                  logConfiguration: {
                    logDriver: "awslogs",
                    options: {
                      "awslogs-group": `/ecs/${family}`,
                      "awslogs-region": REGION,
                    },
                  },
                  environment:
                    family === WORKER
                      ? [
                          { name: "QUEUE_NAME", value: "tenure-prod-deliverables" },
                          { name: "STRIPE_SECRET_KEY", value: PLAINTEXT_VALUE },
                        ]
                      : [{ name: "NODE_ENV", value: "production" }],
                  secrets: [],
                },
              ],
            },
          }
        }

        case "ecr:DescribeRepositories":
          if (estate.describeRepositoriesFailWith) throwing(estate.describeRepositoriesFailWith)
          return {
            repositories: repositories.map((repo) => ({
              repositoryArn: `arn:${PARTITION}:ecr:${REGION}:${ACCOUNT}:repository/${repo.name}`,
              repositoryName: repo.name,
              registryId: ACCOUNT,
              repositoryUri: `${registryHost}/${repo.name}`,
              createdAt: new Date("2026-07-01T00:00:00.000Z"),
              imageTagMutability: "MUTABLE",
              imageScanningConfiguration: { scanOnPush: repo.scanOnPush },
              encryptionConfiguration: { encryptionType: "AES256" },
            })),
          }

        case "ecr:DescribeImages": {
          const repo = repositories.find((r) => r.name === String(arg.repositoryName ?? ""))
          if (!repo) throwing("RepositoryNotFoundException")
          if (repo.describeImagesFailWith) throwing(repo.describeImagesFailWith)
          return {
            imageDetails: repo.images.map((image) => ({
              registryId: ACCOUNT,
              repositoryName: repo.name,
              imageDigest: image.digest,
              imageTags: image.tags,
              imageSizeInBytes: 1024,
              imagePushedAt: new Date("2026-08-10T00:00:00.000Z"),
              imageScanStatus: image.noScan
                ? undefined
                : { status: "COMPLETE", description: "The scan was completed successfully." },
              imageScanFindingsSummary: image.noScan
                ? undefined
                : {
                    imageScanCompletedAt: new Date("2026-08-10T00:05:00.000Z"),
                    findingSeverityCounts: image.severityCounts ?? {},
                  },
            })),
          }
        }

        case "ecr:DescribeImageScanFindings": {
          const repo = repositories.find((r) => r.name === String(arg.repositoryName ?? ""))
          const image = repo?.images.find((i) => i.digest === String(arg.imageDigest ?? ""))
          // ECR's own way of saying "nothing has looked at this image". It is an
          // exception on the wire and an answer in meaning, which is exactly why
          // the stand-in raises it rather than returning zero counts.
          if (!image || image.noScan) throwing("ScanNotFoundException")
          return {
            imageScanStatus: { status: "COMPLETE", description: "The scan was completed successfully." },
            imageScanFindings: {
              imageScanCompletedAt: new Date("2026-08-10T00:05:00.000Z"),
              findingSeverityCounts: image.severityCounts ?? {},
              findings: Object.entries(image.severityCounts ?? {}).map(([severity], at) => ({
                name: `CVE-2026-${String(at).padStart(4, "0")}`,
                severity,
                attributes: [
                  { key: "package_name", value: "obviously-constructed-package" },
                  { key: "package_version", value: "0.0.0" },
                ],
              })),
            },
          }
        }

        case "ecr:GetLifecyclePolicy":
          throwing("LifecyclePolicyNotFoundException")

        case "lambda:ListFunctions":
          return {
            Functions: functions.map((fn) => ({
              FunctionArn: functionArn(fn.name),
              FunctionName: fn.name,
              Runtime: fn.runtime,
              PackageType: fn.packageType ?? "Zip",
              MemorySize: 512,
              Timeout: 30,
              CodeSize: 4096,
              Architectures: ["arm64"],
              LastModified: "2026-08-01T00:00:00.000+0000",
            })),
          }

        case "lambda:GetFunctionConcurrency":
          return {}

        default:
          throwing("UnrecognizedClientException")
      }
    },
    async resolvedRegion() {
      return REGION
    },
  }
}

const NOW = () => new Date("2026-08-13T09:00:00.000Z")
const load = (estate: Estate = {}) => containerReadings(fakeAws(estate), { now: NOW })
const registry = (estate: Estate = {}) => ecrReadings(fakeAws(estate), { now: NOW })
const lambdas = (estate: Estate = {}) =>
  lambdaInventory(fakeAws(estate), { now: NOW, sleep: async () => {} })

/** A fleet at its desired count, with tasks that have been dying under it. */
function crashLoopingEstate(): Estate {
  return {
    services: [{ name: APP, desired: 2, running: 2, taskDefinition: definitionArn(APP, 41) }],
    running: [
      { id: "run1", service: APP, containers: [{ name: "app", digest: APP_DIGEST }] },
      { id: "run2", service: APP, containers: [{ name: "app", digest: APP_DIGEST }] },
    ],
    stopped: [
      {
        id: "dead1",
        service: APP,
        stoppedReason: "OutOfMemoryError: Container killed due to memory usage",
        stopCode: "EssentialContainerExited",
        stoppedAt: "2026-08-13T08:40:00.000Z",
        containers: [{ name: "app", exitCode: 137, digest: APP_DIGEST }],
      },
      {
        id: "dead2",
        service: APP,
        stoppedReason: "OutOfMemoryError: Container killed due to memory usage",
        stopCode: "EssentialContainerExited",
        stoppedAt: "2026-08-13T08:50:00.000Z",
        containers: [{ name: "app", exitCode: 137, digest: APP_DIGEST }],
      },
      {
        id: "rolled",
        service: APP,
        stoppedReason: "Scaling activity initiated by deployment ecs-svc/1234",
        stopCode: "ServiceSchedulerInitiated",
        stoppedAt: "2026-08-13T08:30:00.000Z",
        containers: [{ name: "app", exitCode: 0, digest: APP_DIGEST }],
      },
    ],
  }
}

beforeEach(() => {
  __resetIdentity()
})

/* ══════════════════════════════════════════════ 1. the lead answer ═══════ */

describe("the lead answer, and the order it decides in", () => {
  /**
   * THE ONE THIS MODULE EXISTS FOR.
   *
   * Two of two tasks running, exactly as asked, and two tasks OOM-killed inside
   * the window. A headline derived from the counts alone reads "Steady".
   */
  test("a fleet at its desired count with tasks dying under it is not Steady", async () => {
    const readings = await load(crashLoopingEstate())

    // The reader itself is satisfied: nothing is short.
    expect(readings.fleet.kind).toBe("steady")

    const rows = stoppedTaskRows(readings.clusters)
    const stops = stoppedSummary(rows)
    expect(stops.total).toBe(3)
    expect(stops.incidents).toBe(2)
    expect(stops.benign).toBe(1)
    expect(stops.servicesAffected).toEqual([APP])

    const answer = computeAnswer(readings.fleet, stops)
    expect(answer.verdict).toBe("Restarting")
    expect(answer.tone).toBe("bad")
    expect(answer.headline).toContain("2 task(s) still")
    expect(answer.headline).toContain("crash-looping")
    expect(answer.because).toContain(APP)
  })

  test("a steady fleet with only deployments behind it is Steady, and says so", async () => {
    const readings = await load({
      services: [{ name: APP, desired: 1, running: 1, taskDefinition: definitionArn(APP, 41) }],
      running: [{ id: "run1", service: APP, containers: [{ name: "app", digest: APP_DIGEST }] }],
      stopped: [
        {
          id: "rolled",
          service: APP,
          stoppedReason: "Scaling activity initiated by deployment ecs-svc/1234",
          stopCode: "ServiceSchedulerInitiated",
          stoppedAt: "2026-08-13T08:30:00.000Z",
          containers: [{ name: "app", exitCode: 0 }],
        },
      ],
    })
    const stops = stoppedSummary(stoppedTaskRows(readings.clusters))
    const answer = computeAnswer(readings.fleet, stops)
    expect(answer.verdict).toBe("Steady")
    expect(answer.tone).toBe("ok")
    expect(answer.because).toContain("1 task(s) stopped in the window")
  })

  test("a shortfall nothing explains outranks one that stopped tasks account for", async () => {
    const readings = await load({
      services: [{ name: APP, desired: 3, running: 1, taskDefinition: definitionArn(APP, 41) }],
      running: [{ id: "run1", service: APP, containers: [{ name: "app", digest: APP_DIGEST }] }],
      // ECS retained nothing: two tasks are missing and nothing died. The
      // scheduler is not placing them.
      stopped: [],
    })
    expect(readings.fleet.kind).toBe("degraded")
    const stops = stoppedSummary(stoppedTaskRows(readings.clusters))
    const answer = computeAnswer(readings.fleet, stops)
    expect(answer.verdict).toBe("Not being placed")
    expect(answer.headline).toContain("scheduler is not placing them")
  })

  test("a refused cluster listing is Unknown, never Steady and never Nothing deployed", async () => {
    const gateway: AwsGateway = {
      async call(capability) {
        if (capability === "sts:GetCallerIdentity") {
          return {
            Account: ACCOUNT,
            Arn: `arn:${PARTITION}:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
          }
        }
        if (capability === "tag:GetResources") return { ResourceTagMappingList: [] }
        throwing("AccessDeniedException")
      },
      async resolvedRegion() {
        return REGION
      },
    }
    const readings = await containerReadings(gateway, { now: NOW })
    expect(readings.clusters.state).toBe("DENIED")

    const rows = stoppedTaskRows(readings.clusters)
    // Not an empty table presented as an answer: no rows, and the read that
    // produced no rows is renderable through `UnknownState`.
    expect(rows).toEqual([])
    expect(unknownArm(readings.clusters)).not.toBeNull()

    const answer = computeAnswer(readings.fleet, stoppedSummary(rows))
    expect(answer.verdict).toBe("Unknown")
    expect(answer.tone).toBe("warn")
    expect(answer.headline).toContain("Nothing is known")
  })

  test("an account with no cluster is a fact about the estate, not a health verdict", async () => {
    const gateway: AwsGateway = {
      async call(capability) {
        if (capability === "sts:GetCallerIdentity") {
          return {
            Account: ACCOUNT,
            Arn: `arn:${PARTITION}:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
          }
        }
        if (capability === "tag:GetResources") return { ResourceTagMappingList: [] }
        if (capability === "ecs:ListClusters") return { clusterArns: [] }
        throwing("UnrecognizedClientException")
      },
      async resolvedRegion() {
        return REGION
      },
    }
    const readings = await containerReadings(gateway, { now: NOW })
    const answer = computeAnswer(readings.fleet, stoppedSummary(stoppedTaskRows(readings.clusters)))
    expect(answer.verdict).toBe("Nothing deployed")
    expect(answer.tone).toBe("neutral")
    expect(answer.headline).toContain("not a statement about its health")
  })
})

/* ═════════════════════════════════════ 2. why anything stopped ═══════════ */

describe("the stopped tasks, and the string that says why", () => {
  test("ECS's own stoppedReason is carried verbatim, with every container's exit code", async () => {
    const readings = await load(crashLoopingEstate())
    const rows = stoppedTaskRows(readings.clusters)

    const worst = rows[0]
    expect(worst.incident).toBe(true)
    expect(worst.cause.kind).toBe("out-of-memory")
    expect(worst.stoppedReason).toBe(
      "OutOfMemoryError: Container killed due to memory usage",
    )
    expect(worst.exitCodes).toBe("app=137")
    expect(worst.exitCode).toBe(137)
    expect(worst.service).toBe(APP)
    expect(worst.digests).toEqual([APP_DIGEST])

    // Incidents first, then most recent first inside them.
    expect(rows.map((row) => row.incident)).toEqual([true, true, false])
    expect(rows[0].stoppedAt).toBe("2026-08-13T08:50:00.000Z")
    expect(rows[1].stoppedAt).toBe("2026-08-13T08:40:00.000Z")
  })

  test("a stop ECS did not explain counts as something to act on", async () => {
    const readings = await load({
      services: [{ name: APP, desired: 1, running: 1, taskDefinition: definitionArn(APP, 41) }],
      running: [{ id: "run1", service: APP, containers: [{ name: "app", digest: APP_DIGEST }] }],
      stopped: [
        {
          id: "silent",
          service: APP,
          stoppedAt: "2026-08-13T08:45:00.000Z",
          containers: [{ name: "app" }],
        },
      ],
    })
    const rows = stoppedTaskRows(readings.clusters)
    expect(rows).toHaveLength(1)
    expect(rows[0].cause.kind).toBe("unreported")
    // ECS said nothing, so there is no verbatim string. Null rather than "".
    expect(rows[0].stoppedReason).toBeNull()
    expect(rows[0].exitCodes).toBe("app=unreported")
    expect(rows[0].incident).toBe(true)

    const answer = computeAnswer(readings.fleet, stoppedSummary(rows))
    expect(answer.verdict).toBe("Restarting")
  })

  /**
   * The second wrong sentence. A refused `ecs:DescribeTasks` contributes no rows
   * to the table, so without `readFailures` the page prints an estate where
   * nothing has stopped.
   */
  test("a refused DescribeTasks is named, never rendered as nothing stopped", async () => {
    const readings = await load({
      services: [{ name: APP, desired: 2, running: 2, taskDefinition: definitionArn(APP, 41) }],
      running: [{ id: "run1", service: APP }],
      stopped: [{ id: "dead1", service: APP, stoppedReason: "OutOfMemoryError" }],
      describeTasksFailWith: "AccessDeniedException",
    })

    expect(stoppedTaskRows(readings.clusters)).toEqual([])

    const failures = readFailures(readings.clusters)
    const named = failures.filter((f) => f.what.includes("stopped"))
    expect(named).toHaveLength(1)
    expect(named[0].read.state).toBe("DENIED")
    expect(named[0].scope).toBe(PROD)
    if (named[0].read.state === "DENIED") {
      // The pasteable statement travels with the refusal, so it is fixable
      // without leaving the page.
      expect(named[0].read.action).toContain("ecs:")
      expect(named[0].read.minimumStatement).toContain('"Effect":"Allow"')
    }
  })

  test("exit codes name every container, so an unreported one is visibly unreported", () => {
    expect(exitCodeLine([{ name: "app", exitCode: 137 }, { name: "sidecar", exitCode: null }])).toBe(
      "app=137, sidecar=unreported",
    )
    expect(exitCodeLine([])).toBe("no container was reported for this task")
    // Zero is a real exit code and must not be printed as "unreported".
    expect(exitCodeLine([{ name: "app", exitCode: 0 }])).toBe("app=0")
  })
})

/* ══════════════════════════════ 3. what each service runs ════════════════ */

describe("the revision each service actually runs", () => {
  test("the revision, its cpu and memory, and the digest the tasks carry", async () => {
    const readings = await load({
      services: [
        { name: APP, desired: 1, running: 1, taskDefinition: definitionArn(APP, 41) },
        { name: WORKER, desired: 1, running: 1, taskDefinition: definitionArn(WORKER, 7) },
      ],
      running: [
        { id: "run1", service: APP, containers: [{ name: "app", digest: APP_DIGEST }] },
        { id: "run2", service: WORKER, containers: [{ name: "worker", digest: WORKER_DIGEST }] },
      ],
    })
    const rows = runningServiceRows(readings.clusters)
    expect(rows.map((row) => row.service)).toEqual([APP, WORKER])

    const app = rows[0]
    expect(app.revision).toBe(`${APP}:41`)
    expect(app.cpu).toBe("1024")
    expect(app.memory).toBe("2048")
    expect(app.containers).toEqual([
      { containerName: "app", image: imageRef(APP, APP_DIGEST), digest: APP_DIGEST, taskArn: taskArn(PROD, "run1") },
    ])
  })

  test("a plain-text environment NAME that looks like a credential is reported, and no value is", async () => {
    const readings = await load({
      services: [{ name: WORKER, desired: 1, running: 1, taskDefinition: definitionArn(WORKER, 7) }],
      running: [{ id: "run1", service: WORKER, containers: [{ name: "worker", digest: WORKER_DIGEST }] }],
    })
    const rows = runningServiceRows(readings.clusters)
    expect(rows[0].credentialNames).toEqual(["STRIPE_SECRET_KEY"])

    // The value the stand-in fed in appears nowhere in the whole reading. This
    // is the assertion that survives a future refactor reaching for a value.
    expect(JSON.stringify(rows)).not.toContain(PLAINTEXT_VALUE)
    expect(JSON.stringify(readings.clusters)).not.toContain(PLAINTEXT_VALUE)
  })
})

/* ═══════════════════════════════ 4. the registry join ════════════════════ */

describe("the registry, correlated by digest", () => {
  const runningApp = (): Estate => ({
    services: [{ name: APP, desired: 1, running: 1, taskDefinition: definitionArn(APP, 41) }],
    running: [{ id: "run1", service: APP, containers: [{ name: "app", digest: APP_DIGEST }] }],
  })

  test("a digest resolves to its repository, with the counts ECR reported", async () => {
    const containers = await load(runningApp())
    const ecr = await registry({
      repositories: [
        {
          name: APP,
          scanOnPush: true,
          images: [
            {
              digest: APP_DIGEST,
              tags: ["sha-abc123"],
              severityCounts: { CRITICAL: 1, HIGH: 2, MEDIUM: 5 },
            },
          ],
        },
      ],
    })

    const index = registryIndex(ecr)
    expect(index.known).toBe(true)
    expect(index.blind).toEqual([])
    expect(index.unscanned).toEqual([])

    const rows = deployedImageRows(runningServiceRows(containers.clusters), index)
    expect(rows).toHaveLength(1)
    expect(rows[0].correlation).toEqual({ kind: "matched", repositoryName: APP })
    expect(rows[0].counts?.CRITICAL).toBe(1)
    expect(rows[0].counts?.HIGH).toBe(2)
    expect(rows[0].total).toBe(8)
    expect(rows[0].tags).toEqual(["sha-abc123"])
    expect(rows[0].usedBy).toEqual([`${PROD}/${APP} (app)`])
    expect(worstSeverity(rows[0].counts)).toBe("CRITICAL")
    expect(imageSummary(rows)).toEqual({
      digests: 1,
      vulnerable: 1,
      unscanned: 0,
      unknown: 0,
      clean: 0,
    })
  })

  /**
   * The fourth wrong sentence. `scanOnPush` is off, so ECR never looked, so
   * there are no findings — and a zero in that cell is the most reassuring wrong
   * number this page could print.
   */
  test("an unscanned repository yields no counts at all, never a zero", async () => {
    const containers = await load(runningApp())
    const ecr = await registry({
      repositories: [
        { name: APP, scanOnPush: false, images: [{ digest: APP_DIGEST, tags: [], noScan: true }] },
      ],
    })
    const index = registryIndex(ecr)
    expect(index.unscanned).toEqual([APP])

    const rows = deployedImageRows(runningServiceRows(containers.clusters), index)
    expect(rows[0].scanningOff).toBe(true)
    expect(rows[0].counts).toBeNull()
    expect(rows[0].total).toBeNull()
    expect(rows[0].vulnerability?.kind).toBe("not-scanned")
    expect(imageSummary(rows).unknown).toBe(1)
    expect(imageSummary(rows).clean).toBe(0)
  })

  /**
   * The third wrong sentence. The digest is in no repository this engine could
   * READ, which is not the same as being in no repository.
   */
  test("a refused DescribeImages is named rather than reported as not in the registry", async () => {
    const containers = await load(runningApp())
    const ecr = await registry({
      repositories: [
        { name: APP, scanOnPush: true, images: [], describeImagesFailWith: "AccessDeniedException" },
      ],
    })
    const index = registryIndex(ecr)
    expect(index.blind).toEqual([APP])

    const correlation = correlationFor(APP_DIGEST, index)
    expect(correlation.kind).toBe("not-found")
    if (correlation.kind === "not-found") {
      expect(correlation.why).toContain(APP)
      expect(correlation.why).toContain("did not answer")
      expect(correlation.why).toContain("not a statement")
    }

    const rows = deployedImageRows(runningServiceRows(containers.clusters), index)
    expect(rows[0].counts).toBeNull()
    expect(rows[0].scanningOff).toBe(false)
  })

  test("a digest genuinely in no repository says so, and says it differently", async () => {
    const containers = await load({
      services: [{ name: APP, desired: 1, running: 1, taskDefinition: definitionArn(APP, 41) }],
      running: [{ id: "run1", service: APP, containers: [{ name: "app", digest: ORPHAN_DIGEST }] }],
    })
    const ecr = await registry({
      repositories: [
        { name: APP, scanOnPush: true, images: [{ digest: APP_DIGEST, tags: ["v1"] }] },
      ],
    })
    const index = registryIndex(ecr)
    expect(index.blind).toEqual([])

    const correlation = correlationFor(ORPHAN_DIGEST, index)
    expect(correlation.kind).toBe("not-found")
    if (correlation.kind === "not-found") {
      expect(correlation.why).toContain("pushed somewhere else")
      // And it does NOT claim a refusal that did not happen.
      expect(correlation.why).not.toContain("did not answer")
    }

    const rows = deployedImageRows(runningServiceRows(containers.clusters), index)
    expect(rows[0].repositoryName).toBeNull()
  })

  test("a refused DescribeRepositories makes every correlation registry-unreadable", async () => {
    const containers = await load(runningApp())
    const ecr = await registry({ describeRepositoriesFailWith: "AccessDeniedException" })
    const index = registryIndex(ecr)
    expect(index.known).toBe(false)
    expect(index.why).toContain("unknown")

    const correlation = correlationFor(APP_DIGEST, index)
    expect(correlation.kind).toBe("registry-unreadable")
    expect(unknownArm(ecr.repositories)).not.toBeNull()

    const rows = deployedImageRows(runningServiceRows(containers.clusters), index)
    expect(rows[0].correlation.kind).toBe("registry-unreadable")
    expect(rows[0].counts).toBeNull()
  })

  test("only a completed scan produces a zero, and it produces a real one", () => {
    expect(countsFor({ kind: "clean", completedAt: null, source: "summary" })?.CRITICAL).toBe(0)
    expect(countsFor({ kind: "not-scanned", why: "scanning is off" })).toBeNull()
    expect(
      countsFor({ kind: "scan-incomplete", status: "IN_PROGRESS", description: null, why: "running" }),
    ).toBeNull()
    expect(countsFor({ kind: "unknown", why: "refused" })).toBeNull()
    expect(worstSeverity(null)).toBeNull()
  })
})

/* ═══════════════════════════════ 5. lambda runtimes ══════════════════════ */

describe("the Lambda runtimes with a date on them", () => {
  test("a deprecated runtime is listed, a supported one is counted and not listed", async () => {
    const readings = await lambdas({
      functions: [
        { name: "tenure-legacy-webhook", runtime: "nodejs16.x" },
        { name: "tenure-current-api", runtime: "nodejs22.x" },
        { name: "tenure-imager", packageType: "Image" },
      ],
    })
    const rows = runtimeRows(readings.functions)
    const tally = runtimeTally(readings.functions)

    expect(tally.known).toBe(true)
    expect(tally.total).toBe(3)
    expect(tally.containerImages).toBe(1)
    expect(rows.map((row) => row.name)).toContain("tenure-legacy-webhook")
    expect(rows.map((row) => row.name)).not.toContain("tenure-imager")

    const legacy = rows.find((row) => row.name === "tenure-legacy-webhook")
    expect(legacy?.status).toBe("DEPRECATED")
    // The sentence is `lambda.ts`'s own renderer, so this page cannot word a
    // deprecation differently from the read-only API.
    expect(legacy?.sentence).toContain("nodejs16.x")

    expect(runtimeHeadline(tally)).toContain("deprecated")
  })

  test("a runtime the calendar has never heard of is listed, not assumed current", async () => {
    const readings = await lambdas({
      functions: [{ name: "tenure-experiment", runtime: "brandnew99.x" }],
    })
    const rows = runtimeRows(readings.functions)
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe("UNKNOWN_RUNTIME")
    expect(runtimeTally(readings.functions).unknown).toBe(1)
  })

  test("a refused ListFunctions is not zero deprecated functions", async () => {
    const gateway: AwsGateway = {
      async call(capability) {
        if (capability === "sts:GetCallerIdentity") {
          return {
            Account: ACCOUNT,
            Arn: `arn:${PARTITION}:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
          }
        }
        if (capability === "tag:GetResources") return { ResourceTagMappingList: [] }
        throwing("AccessDeniedException")
      },
      async resolvedRegion() {
        return REGION
      },
    }
    const readings = await lambdaInventory(gateway, { now: NOW, sleep: async () => {} })
    const tally = runtimeTally(readings.functions)
    expect(tally.known).toBe(false)
    expect(runtimeRows(readings.functions)).toEqual([])
    expect(runtimeHeadline(tally)).toContain("Nothing is known")
    expect(runtimeHeadline(tally)).not.toContain("All ")
  })
})

/* ══════════════════════════════════ 6. as of ═════════════════════════════ */

describe("every panel states when it was true", () => {
  test("a stated as-of carries the timestamp, and an absent one says so", () => {
    expect(statedAsOf("What is running", "2026-08-13T09:00:00.000Z")).toBe(
      "What is running. As of 2026-08-13T09:00:00.000Z.",
    )
    expect(statedAsOf("What is running", null)).toContain("As of an unknown time")
    expect(statedAsOf("What is running", "")).toContain("As of an unknown time")
  })
})
