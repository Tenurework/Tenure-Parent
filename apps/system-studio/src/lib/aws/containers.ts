/**
 * STUDIO-070-004 (CONTAINERS) — why `runningCount` is 1 when `desiredCount` is 2.
 *
 * `inventory.ts` reads `ecs:ListClusters` → `ecs:ListServices` →
 * `ecs:DescribeServices` and stops there. That produces one string per service —
 * `ACTIVE 1/2` — and that string is where every ECS incident in this estate has
 * so far come to die. It states that a task is missing. It cannot state why, and
 * "why" is the entire content of the incident:
 *
 *   * `OutOfMemoryError: Container killed due to memory usage` — the task
 *     definition asks for less memory than the process needs. The remedy is a new
 *     revision, and until somebody ships one the replacement task will die too.
 *   * `Task failed ELB health checks in (target-group …)` — the container came
 *     up and the load balancer would not take it. The remedy is the health-check
 *     path, the grace period, or the application, and NOT more memory.
 *   * `Scaling activity initiated by (deployment ecs-svc/…)` — nothing is wrong.
 *     A deployment is replacing tasks and the gap closes on its own.
 *
 * Those are three different nights, and `1/2` is the same sentence for all
 * three. So this module reads ECS at TASK granularity — the level at which ECS
 * actually records what happened — and `stoppedReason` is the single most
 * valuable string it carries.
 *
 * ## What a "recently stopped" task is, said out loud
 *
 * `ecs:ListTasks` with `desiredStatus=STOPPED` returns the tasks ECS still holds,
 * and ECS holds a stopped task for approximately one hour. This module therefore
 * cannot answer "what stopped yesterday" and does not pretend to: `StoppedWindow`
 * is a value carried on every cluster reading saying exactly that, so a surface
 * printing "no stopped tasks" is printing "none in ECS's retention window", which
 * is a much smaller claim. The long-horizon answer is CloudTrail and the service
 * event stream, neither of which is this module's.
 *
 * ## Five capabilities, five readings, degrading independently
 *
 * `ecs:ListClusters`, `ecs:DescribeClusters`, `ecs:ListServices`,
 * `ecs:DescribeServices`, `ecs:ListTasks`, `ecs:DescribeTasks` and
 * `ecs:DescribeTaskDefinition` are seven separate IAM actions, and a role is
 * routinely granted some without the others. If a refused `ecs:DescribeClusters`
 * collapsed the whole cluster row, the minimum statement an operator pastes into
 * a policy would name `ecs:ListClusters` — the action that WORKED — and they
 * would grant it, redeploy, and be refused identically. `retained.ts` paid for
 * that lesson with `backup:ListBackupVaults`.
 *
 * So a cluster ROW is built from the ARN, which `ListClusters` already gave us,
 * and everything below it is its own `AwsRead`: `detail`, `services`,
 * `runningTasks`, `stoppedTasks`, and per service a `taskDefinition`. A cluster
 * whose capacity providers were refused still shows its services. A service
 * whose task definition was refused still shows its counts and its stopped
 * tasks. None of them renders as a reassuring default.
 *
 * ## An environment variable's NAME is a finding. Its VALUE never leaves AWS.
 *
 * A `containerDefinitions` entry may carry `environment` (plain text, visible to
 * anybody with `ecs:DescribeTaskDefinition`) or `secrets` (a pointer into Secrets
 * Manager or SSM, resolved at task start). A plain-text entry whose NAME looks
 * like a credential is the finding this module reports.
 *
 * The value is not redacted here — it is never read into a field at all. There
 * is no property anywhere in this module's types that can hold an environment
 * value, so no surface, no serialiser and no future edit can print one. That is
 * the same mechanism as `AwsRead`'s missing `value` on DENIED: the discipline is
 * in the type, not in everyone remembering.
 *
 * The name test is a substring match on KEY, SECRET, TOKEN, PASSWORD, PASSWD and
 * CREDENTIAL, case-insensitively, and it over-reports on purpose — `MONKEY_MODE`
 * contains "KEY" and will be listed. A name wrongly listed costs an operator ten
 * seconds; a credential wrongly missed costs the pilot. The finding carries the
 * name and nothing else, so a false positive discloses nothing.
 *
 * ## Log configuration, carried carefully
 *
 * `logConfiguration.options` is a free-form string map. For the `awslogs` driver
 * its keys are group, region and stream-prefix, and the group is the join key to
 * `logs.ts`. For `splunk` one of its keys is `splunk-token`. So option VALUES are
 * carried only for an allowlist of `awslogs-*` keys that are not secrets by
 * definition; every other option contributes its NAME to `otherOptionNames` and
 * nothing else. `secretOptions` contributes names only, always.
 *
 * ## Region and partition
 *
 * From the cluster's own ARN when AWS returned one, and otherwise from the
 * resolved identity. There is no literal region in this file and no `"aws"`
 * partition fallback — GE-010-007 was a data-residency defect caused by exactly
 * that fallback.
 *
 * ## Pagination
 *
 * Bounded, and the bound is REPORTED. `ecs:ListClusters` is the honest
 * exception: `client.ts` builds `ListClustersCommand({})` with no `nextToken`
 * passthrough and `client.ts` is another agent's file, so this module can read
 * exactly one page of clusters. When that page comes back with a `nextToken` the
 * reading is marked truncated naming the reason, rather than passing one page off
 * as the estate.
 */

import { CAPABILITIES } from "./capabilities"
import { denialContextFrom, resolveIdentity, type Identity } from "./identity"
import {
  describeRead,
  liveGateway,
  readAws,
  type AwsGateway,
  type AwsRead,
  type DenialContext,
} from "./read"
import { attributionOf, tagIndex, taggedResources, type TaggedResource } from "./tags"
import { READ_ATTEMPTS, backoffMs } from "./throttle"

/* ---------------------------------------------------------------- limits -- */

/**
 * How many clusters get described in one `DescribeClusters` call.
 *
 * The API's own ceiling is 100 ARNs per request. Batched at it rather than under
 * it, because a smaller batch is more calls against the same throttle for no
 * benefit.
 */
export const DESCRIBE_CLUSTERS_BATCH = 100

/** The API's ceiling on `DescribeServices`. Eleven in one call is a validation error. */
export const DESCRIBE_SERVICES_BATCH = 10

/** The API's ceiling on `DescribeTasks`. */
export const DESCRIBE_TASKS_BATCH = 100

/** How many `ListServices` pages to walk per cluster. 100 per page. */
export const MAX_SERVICE_PAGES = 10

/** How many `ListTasks` pages to walk, per cluster and per desired status. */
export const MAX_TASK_PAGES = 10

/**
 * How many clusters get a depth read — services and tasks — in one load.
 *
 * Clusters past the cap are NOT dropped and do not render as empty: their
 * `services` and task readings are UNCONFIGURED with a `why` saying the engine
 * stopped, which is a different sentence from "this cluster runs nothing".
 */
export const MAX_CLUSTER_DEPTH_READS = 20

/**
 * How many DISTINCT task-definition revisions get described in one load.
 *
 * One call per revision, and a revision is immutable — `ECS_TASK_DEFINITION_TTL_MS`
 * is an hour for that reason. Deduplicated before the budget is applied, so an
 * estate of forty services on four revisions spends four calls.
 */
export const MAX_TASK_DEFINITION_READS = 40

/** How many detail reads are in flight at once, so one load is not a burst. */
const DETAIL_CONCURRENCY = 6

/** The retry schedule is throttle.ts's, not a literal. See its header on jitter. */
const RETRY: { attempts: number; backoffMs: number } = {
  attempts: READ_ATTEMPTS,
  // `backoffMs(2)` is the pause after the first failure; readAws doubles it.
  backoffMs: backoffMs(2),
}

/* ------------------------------------------------------- the API's shapes -- */

/** Declared rather than imported — `client.ts` is the one owner of an SDK type. */
interface ListClustersResponse {
  clusterArns?: string[]
  nextToken?: string
}

interface DescribeClustersResponse {
  clusters?: Array<{
    clusterArn?: string
    clusterName?: string
    status?: string
    registeredContainerInstancesCount?: number
    runningTasksCount?: number
    pendingTasksCount?: number
    activeServicesCount?: number
    capacityProviders?: string[]
    defaultCapacityProviderStrategy?: Array<{
      capacityProvider?: string
      weight?: number
      base?: number
    }>
    statistics?: Array<{ name?: string; value?: string }>
    settings?: Array<{ name?: string; value?: string }>
  }>
  failures?: Array<{ arn?: string; reason?: string; detail?: string }>
}

interface ListServicesResponse {
  serviceArns?: string[]
  nextToken?: string
}

interface DescribeServicesResponse {
  services?: Array<{
    serviceArn?: string
    serviceName?: string
    clusterArn?: string
    status?: string
    desiredCount?: number
    runningCount?: number
    pendingCount?: number
    launchType?: string
    taskDefinition?: string
    healthCheckGracePeriodSeconds?: number
    capacityProviderStrategy?: Array<{ capacityProvider?: string; weight?: number; base?: number }>
    deployments?: Array<{
      id?: string
      status?: string
      taskDefinition?: string
      desiredCount?: number
      pendingCount?: number
      runningCount?: number
      failedTasks?: number
      rolloutState?: string
      rolloutStateReason?: string
      createdAt?: string | Date
      updatedAt?: string | Date
    }>
    loadBalancers?: Array<{ targetGroupArn?: string; containerName?: string; containerPort?: number }>
  }>
  failures?: Array<{ arn?: string; reason?: string; detail?: string }>
}

interface ListTasksResponse {
  taskArns?: string[]
  nextToken?: string
}

interface DescribeTasksResponse {
  tasks?: Array<{
    taskArn?: string
    clusterArn?: string
    taskDefinitionArn?: string
    containerInstanceArn?: string
    lastStatus?: string
    desiredStatus?: string
    healthStatus?: string
    cpu?: string
    memory?: string
    group?: string
    launchType?: string
    capacityProviderName?: string
    availabilityZone?: string
    connectivity?: string
    startedBy?: string
    stopCode?: string
    stoppedReason?: string
    createdAt?: string | Date
    startedAt?: string | Date
    stoppingAt?: string | Date
    stoppedAt?: string | Date
    containers?: Array<{
      name?: string
      image?: string
      imageDigest?: string
      lastStatus?: string
      exitCode?: number
      reason?: string
      healthStatus?: string
    }>
  }>
  failures?: Array<{ arn?: string; reason?: string; detail?: string }>
}

interface DescribeTaskDefinitionResponse {
  taskDefinition?: {
    taskDefinitionArn?: string
    family?: string
    revision?: number
    status?: string
    cpu?: string
    memory?: string
    networkMode?: string
    taskRoleArn?: string
    executionRoleArn?: string
    requiresCompatibilities?: string[]
    registeredAt?: string | Date
    containerDefinitions?: Array<{
      name?: string
      image?: string
      cpu?: number
      memory?: number
      memoryReservation?: number
      essential?: boolean
      /**
       * Read for its `name` ONLY. See the module header: no field in this
       * module's types can hold `value`, so no value is ever carried out.
       */
      environment?: Array<{ name?: string; value?: string }>
      secrets?: Array<{ name?: string; valueFrom?: string }>
      logConfiguration?: {
        logDriver?: string
        options?: Record<string, string>
        secretOptions?: Array<{ name?: string; valueFrom?: string }>
      }
    }>
  }
}

/* ----------------------------------------------------------- truncation -- */

/**
 * Whether a paged read reached the end, or gave up at its bound.
 *
 * A value rather than a boolean so the reason travels with it. "There were more"
 * and "that was all of them" are the two answers, and only the second licenses a
 * surface to say "3 services" without a qualifier.
 */
export type Truncation =
  | { kind: "complete" }
  | { kind: "truncated"; pagesRead: number; itemsRead: number; why: string }

export const COMPLETE: Truncation = { kind: "complete" }

/** The sentence a surface prints for a truncation. Empty when it is complete. */
export function describeTruncation(truncation: Truncation): string {
  return truncation.kind === "complete"
    ? ""
    : ` — TRUNCATED: ${truncation.why} (${truncation.itemsRead} read over ${truncation.pagesRead} page(s); there were more)`
}

/** A paged result and whether it is all of them. */
interface Paged<T> {
  items: readonly T[]
  truncation: Truncation
}

/* ------------------------------------------------------------- failures -- */

/**
 * One entry of an ECS `failures` array.
 *
 * `DescribeClusters`, `DescribeServices` and `DescribeTasks` all answer 200 with
 * a `failures` list beside the things they COULD describe. A module that read
 * only `clusters`/`services`/`tasks` would silently shorten its own answer and
 * call the result complete. Every one of them is carried.
 */
export interface DescribeFailure {
  arn: string
  reason: string
  detail: string | null
}

function failuresOf(raw: Array<{ arn?: string; reason?: string; detail?: string }> | undefined): DescribeFailure[] {
  const out: DescribeFailure[] = []
  for (const failure of raw ?? []) {
    out.push({
      arn: failure?.arn ?? "unnamed resource",
      reason: failure?.reason ?? "unstated",
      detail: failure?.detail ?? null,
    })
  }
  out.sort((a, b) => a.arn.localeCompare(b.arn) || a.reason.localeCompare(b.reason))
  return out
}

/* --------------------------------------------------------- stop reasons -- */

/**
 * Why a task stopped, classified.
 *
 * The whole point of this module. `raw` is always carried — an operator must be
 * able to read ECS's own words — but the classification is what lets a surface
 * put an OOM and a scale-in on different sides of a page instead of counting both
 * as "1 stopped task".
 *
 * `unreported` is its own arm and is NOT folded into `other`: ECS omits
 * `stoppedReason` on some paths, and "ECS did not say" is not "ECS said something
 * this engine does not recognise". Only the second is a gap in this module.
 */
export type StopCause =
  /** The kernel killed a container for memory. A new revision is the remedy. */
  | { kind: "out-of-memory"; raw: string }
  /** The container ran and the load balancer refused it. Not a memory problem. */
  | { kind: "health-check-failed"; raw: string }
  /** An essential container exited. `exitCode` is the application's own. */
  | { kind: "essential-container-exited"; raw: string; exitCode: number | null }
  /** The image could not be pulled or the container could not be created. */
  | { kind: "cannot-start"; raw: string }
  /** Volumes, secrets or the log driver failed before the container ran. */
  | { kind: "initialisation-failed"; raw: string }
  /** A deployment or a scale-in replaced this task. Expected; not an incident. */
  | { kind: "scaling"; raw: string }
  /** Somebody, or something with an API key, stopped it. */
  | { kind: "user-initiated"; raw: string }
  /** The host went away: spot reclaim, instance termination, deregistration. */
  | { kind: "host-terminated"; raw: string }
  /** ECS said something, and this engine will not guess what it means. */
  | { kind: "other"; raw: string }
  /** ECS said nothing. Distinct from `other`, and a different question. */
  | { kind: "unreported"; why: string }

/**
 * Ordered rules, first match wins.
 *
 * Ordered because the strings overlap: a task killed for memory ALSO reports an
 * essential container exiting, and the memory sentence is the one that names the
 * remedy. Written as an ordered list rather than a switch so the precedence is
 * visible and reviewable rather than being a property of statement order inside a
 * function.
 */
const STOP_RULES: ReadonlyArray<{ match: RegExp; kind: StopCause["kind"] }> = [
  { match: /outofmemory|memory usage|oomkill/i, kind: "out-of-memory" },
  { match: /elb health check|health checks|unhealthy/i, kind: "health-check-failed" },
  { match: /cannotpull|cannotcreate|cannotstart|imagepull|image not found/i, kind: "cannot-start" },
  { match: /resourceinitializationerror|unable to pull secrets|unable to retrieve secret/i, kind: "initialisation-failed" },
  { match: /scaling activity|deployment ecs-svc|superseded|being replaced/i, kind: "scaling" },
  { match: /stopped by user|userinitiated|stopping container|task stopped by/i, kind: "user-initiated" },
  { match: /host ec2|spot interruption|termination notice|deregistration|instance terminat/i, kind: "host-terminated" },
  { match: /essential container in task exited|essentialcontainerexited/i, kind: "essential-container-exited" },
]

/**
 * `stopCode` is ECS's own coarse classification, and it answers cases the free
 * text does not — `SpotInterruption` arrives with no `stoppedReason` at all.
 * Consulted only when the text did not decide, because the text is more specific.
 */
const STOP_CODE_RULES: Readonly<Record<string, StopCause["kind"]>> = {
  TaskFailedToStart: "cannot-start",
  EssentialContainerExited: "essential-container-exited",
  UserInitiated: "user-initiated",
  ServiceSchedulerInitiated: "scaling",
  SpotInterruption: "host-terminated",
  TerminationNotice: "host-terminated",
}

/**
 * ECS's own words, and the exit code of the first non-zero container, into one
 * classified cause.
 *
 * Exported because a surface agent renders it and the tests assert on it. The
 * `exitCode` argument is the task's, not invented here.
 */
export function classifyStopReason(
  raw: string | null,
  stopCode: string | null,
  exitCode: number | null,
): StopCause {
  const text = (raw ?? "").trim()
  if (text) {
    for (const rule of STOP_RULES) {
      if (rule.match.test(text)) {
        return rule.kind === "essential-container-exited"
          ? { kind: "essential-container-exited", raw: text, exitCode }
          : ({ kind: rule.kind, raw: text } as StopCause)
      }
    }
  }
  const byCode = stopCode ? STOP_CODE_RULES[stopCode] : undefined
  if (byCode) {
    const asRaw = text || `ECS reported stopCode ${stopCode} and no stoppedReason`
    return byCode === "essential-container-exited"
      ? { kind: "essential-container-exited", raw: asRaw, exitCode }
      : ({ kind: byCode, raw: asRaw } as StopCause)
  }
  if (text) return { kind: "other", raw: text }
  return {
    kind: "unreported",
    why:
      "ECS returned neither stoppedReason nor a stopCode for this task. Why it stopped is not " +
      "readable from the ECS API, which is not the same as its having stopped for no reason.",
  }
}

/**
 * Whether a stop is something an operator has to act on.
 *
 * `scaling` and `user-initiated` are the two that are not: a deployment replacing
 * tasks and an operator stopping one are both the system working. Everything
 * else, INCLUDING `unreported`, counts — an unexplained stop is exactly the thing
 * that must not be filed under "probably fine".
 */
export function isIncident(cause: StopCause): boolean {
  return cause.kind !== "scaling" && cause.kind !== "user-initiated"
}

/** The sentence a surface prints for one stop cause. One renderer, as everywhere. */
export function describeStopCause(cause: StopCause): string {
  switch (cause.kind) {
    case "out-of-memory":
      return `OUT OF MEMORY — the container was killed for memory, not for its health. A revision with more memory is the remedy: "${cause.raw}"`
    case "health-check-failed":
      return `HEALTH CHECK FAILED — the container started and was refused by its health check. Memory is not the remedy: "${cause.raw}"`
    case "essential-container-exited":
      return `ESSENTIAL CONTAINER EXITED${cause.exitCode === null ? "" : ` with code ${cause.exitCode}`} — the application ended: "${cause.raw}"`
    case "cannot-start":
      return `COULD NOT START — the image or the container never ran: "${cause.raw}"`
    case "initialisation-failed":
      return `INITIALISATION FAILED — volumes, secrets or logging failed before the container ran: "${cause.raw}"`
    case "scaling":
      return `scaling — a deployment or scale-in replaced this task. Expected: "${cause.raw}"`
    case "user-initiated":
      return `stopped deliberately: "${cause.raw}"`
    case "host-terminated":
      return `HOST WENT AWAY — the instance was reclaimed or terminated under the task: "${cause.raw}"`
    case "other":
      return `stopped, and this engine does not classify the reason: "${cause.raw}"`
    case "unreported":
      return `stopped, reason UNREPORTED — ${cause.why}`
  }
}

/* -------------------------------------------------- environment findings -- */

/**
 * The names that make a plain-text environment entry a finding.
 *
 * A substring match, deliberately over-broad. See the module header: a name
 * wrongly listed discloses nothing, and a credential wrongly missed is the
 * defect. `PASSWD` is separate from `PASSWORD` because the short spelling is not
 * a substring of the long one.
 */
export const CREDENTIAL_NAME_TERMS = [
  "KEY",
  "SECRET",
  "TOKEN",
  "PASSWORD",
  "PASSWD",
  "CREDENTIAL",
] as const

/** Whether an environment variable's NAME looks like a credential. Name only. */
export function looksLikeCredentialName(name: string): boolean {
  const upper = name.toUpperCase()
  return CREDENTIAL_NAME_TERMS.some((term) => upper.includes(term))
}

/**
 * `logConfiguration.options` keys whose VALUES are safe to carry.
 *
 * An allowlist, not a denylist. The `splunk` driver's `splunk-token` and the
 * `fluentd` driver's arbitrary key-values are why: a denylist would have to
 * enumerate every driver AWS ever adds, and would be wrong the first time one
 * appeared. Everything not on this list contributes its NAME and nothing else.
 */
const SAFE_LOG_OPTION_KEYS = new Set([
  "awslogs-group",
  "awslogs-region",
  "awslogs-stream-prefix",
  "awslogs-datetime-format",
  "awslogs-multiline-pattern",
  "awslogs-create-group",
  "mode",
  "max-buffer-size",
])

/**
 * A plain-text environment entry whose name looks like a credential.
 *
 * There is no `value` field, and there never will be. See the module header.
 */
export interface EnvironmentCredentialFinding {
  taskDefinitionArn: string
  family: string
  revision: number | null
  containerName: string
  /** The variable's NAME. The only thing about it that this engine ever holds. */
  name: string
  why: string
}

/* ------------------------------------------------- the assembled shapes -- */

/**
 * How a container's logs are configured.
 *
 * `absent` is a value rather than a null because it is a finding: a container
 * with no log configuration writes to the host's default driver, which on Fargate
 * means its output is not retrievable at all. A surface that rendered that as a
 * blank cell would be hiding the reason there is nothing in CloudWatch.
 */
export type LogConfigurationReading =
  | {
      kind: "configured"
      driver: string
      /** `awslogs-group`, when the driver is awslogs. The join key to logs.ts. */
      logGroup: string | null
      logRegion: string | null
      streamPrefix: string | null
      /** Every other option's NAME. Values are not carried — see the header. */
      otherOptionNames: readonly string[]
      /** `secretOptions` names. Pointers, and their names only. */
      secretOptionNames: readonly string[]
    }
  | { kind: "absent"; why: string }

/** One container of a task-definition revision. */
export interface ContainerDefinitionReading {
  name: string
  /** The image as the revision names it, tag and all. May be mutable — see ecr.ts. */
  image: string | null
  cpu: number | null
  memory: number | null
  memoryReservation: number | null
  /** Null when the revision did not say. ECS defaults it to true; this does not. */
  essential: boolean | null
  logConfiguration: LogConfigurationReading
  /** `secrets` entries, by NAME. The pointer target is carried; it is not a value. */
  secretNames: readonly string[]
  /** Plain-text `environment` entries, by NAME. No value is read. */
  environmentNames: readonly string[]
  /** The subset of `environmentNames` that looks like a credential. */
  credentialLookingEnvironmentNames: readonly string[]
}

/** One task-definition REVISION. Immutable, which is why its TTL is an hour. */
export interface TaskDefinitionReading {
  arn: string
  family: string
  revision: number | null
  status: string | null
  cpu: string | null
  memory: string | null
  networkMode: string | null
  taskRoleArn: string | null
  executionRoleArn: string | null
  requiresCompatibilities: readonly string[]
  registeredAt: string | null
  containers: readonly ContainerDefinitionReading[]
  /** Declares at least one `secrets` entry. A property of the revision, stated. */
  declaresSecrets: boolean
  /** Declares at least one plain-text `environment` entry. */
  declaresPlainTextEnvironment: boolean
  /** The findings from this revision alone, so a service row can carry its own. */
  credentialFindings: readonly EnvironmentCredentialFinding[]
}

/** One container of one running or stopped task, as ECS saw it. */
export interface TaskContainerReading {
  name: string
  image: string | null
  /** The DIGEST the task actually ran. The only stable answer to "which build". */
  imageDigest: string | null
  lastStatus: string | null
  /** The process's own exit code. Null means ECS did not report one. */
  exitCode: number | null
  reason: string | null
  healthStatus: string | null
}

/** One task. The granularity at which ECS records what actually happened. */
export interface TaskReading {
  arn: string
  taskDefinitionArn: string | null
  /** `service:tenure-prod-app` for a service-managed task. The join key to a service. */
  group: string | null
  lastStatus: string | null
  desiredStatus: string | null
  healthStatus: string | null
  cpu: string | null
  memory: string | null
  launchType: string | null
  capacityProviderName: string | null
  availabilityZone: string | null
  connectivity: string | null
  startedBy: string | null
  stopCode: string | null
  createdAt: string | null
  startedAt: string | null
  stoppedAt: string | null
  /** ECS's own words, classified. The most valuable string in this module. */
  stopCause: StopCause
  containers: readonly TaskContainerReading[]
}

/**
 * How far back the stopped-task reading can see.
 *
 * A value carried on every cluster, not a comment, because "no stopped tasks" is
 * only ever true within this window and a surface must be able to say so.
 */
export interface StoppedWindow {
  why: string
}

export const ECS_STOPPED_WINDOW: StoppedWindow = {
  why:
    "ECS retains a stopped task for approximately one hour. An empty stopped-task list means " +
    "nothing stopped in that window — it is not a statement about yesterday. The long-horizon " +
    "answer is CloudTrail and the service event stream, neither of which this reader holds.",
}

/** A group of stopped tasks that share a cause, counted. */
export interface StoppedIncident {
  cause: StopCause
  count: number
  /** The task ARNs, so an operator can go and look at one. Sorted. */
  taskArns: readonly string[]
}

/**
 * Whether a service's running count matches what it was asked for, and why not.
 *
 * The answer `inventory.ts` could not give. `unexplained` is separate from
 * `explained` and from `unknown` on purpose: "two tasks are missing and nothing
 * stopped in the last hour" is a real and quite alarming answer — it means the
 * scheduler is not placing them, which is capacity or a subnet, not a crash.
 */
export type CountGap =
  /** Running is at or above desired. Nothing to explain. */
  | { kind: "none"; desired: number; running: number }
  /** Missing tasks, and stopped tasks in the window that account for them. */
  | {
      kind: "explained"
      desired: number
      running: number
      missing: number
      incidents: readonly StoppedIncident[]
    }
  /** Missing tasks and NOTHING stopped. The scheduler is not placing them. */
  | { kind: "unexplained"; desired: number; running: number; missing: number; why: string }
  /** The task read did not happen, so no claim is made either way. */
  | { kind: "unknown"; desired: number; running: number; missing: number; why: string }

/** One deployment of a service, which is how a rollout reports itself. */
export interface DeploymentReading {
  id: string
  status: string | null
  taskDefinition: string | null
  desiredCount: number | null
  runningCount: number | null
  pendingCount: number | null
  failedTasks: number | null
  rolloutState: string | null
  rolloutStateReason: string | null
  createdAt: string | null
  updatedAt: string | null
}

/** One ECS service, with the revision it is actually running. */
export interface ServiceReading {
  name: string
  arn: string
  clusterArn: string | null
  status: string | null
  desiredCount: number | null
  runningCount: number | null
  pendingCount: number | null
  launchType: string | null
  /** The revision POINTER. What it points at is `taskDefinition`, read separately. */
  taskDefinitionArn: string | null
  healthCheckGracePeriodSeconds: number | null
  targetGroupArns: readonly string[]
  deployments: readonly DeploymentReading[]
  attribution: ResourceAttribution
  /** Its own reading: a refused DescribeTaskDefinition does not collapse this row. */
  taskDefinition: AwsRead<TaskDefinitionReading>
  /** The answer `desiredCount`/`runningCount` alone could not give. */
  gap: CountGap
}

/** A cluster's capacity and registered fleet. Its own read, denied independently. */
export interface ClusterDetail {
  name: string
  status: string | null
  registeredContainerInstancesCount: number | null
  runningTasksCount: number | null
  pendingTasksCount: number | null
  activeServicesCount: number | null
  capacityProviders: readonly string[]
  defaultCapacityProviderStrategy: readonly {
    capacityProvider: string
    weight: number | null
    base: number | null
  }[]
  statistics: Readonly<Record<string, string>>
  settings: Readonly<Record<string, string>>
}

/** Which tenant a resource belongs to, with the fourth answer tags.ts cannot give. */
export type ResourceAttribution =
  | { kind: "tenant"; tenantSlug: string }
  | { kind: "shared" }
  | { kind: "unattributed" }
  | { kind: "unknown"; why: string }

/** One cluster, and everything under it, each failing on its own. */
export interface ClusterReading {
  arn: string
  /** From the ARN. Present even when `DescribeClusters` was refused. */
  name: string
  region: string | null
  partition: string | null
  attribution: ResourceAttribution
  /** Capacity providers and registered instances. Refused alone, not fatally. */
  detail: AwsRead<ClusterDetail>
  services: AwsRead<readonly ServiceReading[]>
  serviceTruncation: Truncation
  runningTasks: AwsRead<readonly TaskReading[]>
  runningTaskTruncation: Truncation
  stoppedTasks: AwsRead<readonly TaskReading[]>
  stoppedTaskTruncation: Truncation
  /** How far back `stoppedTasks` can see. Carried, never assumed by a surface. */
  stoppedWindow: StoppedWindow
  /** ECS's own `failures` entries against this cluster's describes. */
  failures: readonly DescribeFailure[]
  asOf: string
}

/**
 * Whether the container fleet is running what it was asked to run.
 *
 * Every arm is careful about what it claims. `steady` is reachable ONLY when
 * every service that answered has running >= desired AND every task read
 * answered. Anything less is `unverified`, whose whole job is to say that the
 * absence of a reported gap is not evidence there is none.
 */
export type FleetState =
  /** The cluster listing itself was not readable. Nothing can be said. */
  | { kind: "unknown"; why: string }
  /** No cluster at all. Not a health statement — there is nothing to run on. */
  | { kind: "no-clusters" }
  /** At least one service is short of tasks. This is the alarm. */
  | {
      kind: "degraded"
      services: readonly {
        cluster: string
        service: string
        gap: CountGap
      }[]
      /** Services whose gap could not be explained from stopped tasks. */
      unexplained: number
      /** Reads that did not happen, named. Nothing is implied about them. */
      unreadable: readonly string[]
    }
  /** No gap reported, and at least one reason that means nothing. */
  | { kind: "unverified"; why: string; unreadable: readonly string[]; servicesConsidered: number }
  /** Every service that answered is at its desired count, and everything answered. */
  | { kind: "steady"; clusters: number; services: number; runningTasks: number }

/** Everything a container surface needs, in one load. */
export interface ContainerReadings {
  identity: AwsRead<Identity>
  tagged: AwsRead<readonly TaggedResource[]>
  /**
   * The clusters. DENIED here is a refused `ecs:ListClusters` and is NEVER `[]` —
   * an operator reading "no clusters" when the truth is "we were not allowed to
   * look" is the single most dangerous thing this surface can say.
   */
  clusters: AwsRead<readonly ClusterReading[]>
  truncation: Truncation
  fleet: FleetState
  /**
   * Every plain-text environment entry across every revision read whose NAME
   * looks like a credential. Names only. No value is held anywhere.
   */
  credentialFindings: readonly EnvironmentCredentialFinding[]
  /** When this whole load was assembled, so a surface need not invent one. */
  asOf: string
  /** Each capability's own declared cadence, read from the registry, not retyped. */
  refreshMs: {
    clusters: number
    clusterDetail: number
    services: number
    tasks: number
    taskDefinition: number
  }
}

/* --------------------------------------------------------------- parsing -- */

/**
 * An AWS timestamp as an ISO string.
 *
 * The SDK hands back `Date` and a JSON transport hands back a string. Both are
 * accepted; anything else becomes null rather than `Invalid Date`, because a
 * render showing "Invalid Date" as a stop time is a render an operator stops
 * trusting.
 */
export function isoTime(value: string | Date | undefined | null): string | null {
  if (value === undefined || value === null) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function num(value: number | undefined | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/** The last segment of an ARN, which for a cluster ARN is its name. */
export function nameFromArn(arn: string): string {
  const slash = arn.lastIndexOf("/")
  return slash >= 0 && slash < arn.length - 1 ? arn.slice(slash + 1) : arn
}

/** Region and partition from an ARN, or nulls. Never a literal, never a fallback. */
function locationOf(arn: string): { partition: string | null; region: string | null } {
  const parts = arn.split(":")
  if (parts.length < 6 || parts[0] !== "arn") return { partition: null, region: null }
  return { partition: parts[1] || null, region: parts[3] || null }
}

/** The first non-zero container exit code in a task, which is the one that matters. */
export function significantExitCode(containers: readonly TaskContainerReading[]): number | null {
  for (const container of containers) {
    if (container.exitCode !== null && container.exitCode !== 0) return container.exitCode
  }
  for (const container of containers) {
    if (container.exitCode !== null) return container.exitCode
  }
  return null
}

function readLogConfiguration(
  raw:
    | {
        logDriver?: string
        options?: Record<string, string>
        secretOptions?: Array<{ name?: string; valueFrom?: string }>
      }
    | undefined,
): LogConfigurationReading {
  if (!raw || !raw.logDriver) {
    return {
      kind: "absent",
      why:
        "this container declares no logConfiguration. Its output goes to the host's default " +
        "driver, which on Fargate means it is not retrievable at all — an empty log group is " +
        "not evidence the container is quiet.",
    }
  }
  const options = raw.options ?? {}
  const otherOptionNames: string[] = []
  for (const key of Object.keys(options)) {
    // Values for anything off the allowlist are not read into a variable, let
    // alone into a field. See the module header on `splunk-token`.
    if (!SAFE_LOG_OPTION_KEYS.has(key)) otherOptionNames.push(key)
  }
  otherOptionNames.sort()
  const secretOptionNames = (raw.secretOptions ?? [])
    .map((option) => option?.name)
    .filter((name): name is string => typeof name === "string" && name.length > 0)
    .sort()
  return {
    kind: "configured",
    driver: raw.logDriver,
    logGroup: options["awslogs-group"] ?? null,
    logRegion: options["awslogs-region"] ?? null,
    streamPrefix: options["awslogs-stream-prefix"] ?? null,
    otherOptionNames,
    secretOptionNames,
  }
}

/**
 * A `DescribeTaskDefinition` response as a reading.
 *
 * Exported so the test can drive it directly against a shape the SDK returns, and
 * so a reviewer can see in one place that `environment[].value` is never read.
 */
export function readTaskDefinition(
  response: DescribeTaskDefinitionResponse,
  requestedArn: string,
): TaskDefinitionReading {
  const definition = response?.taskDefinition
  const arn = definition?.taskDefinitionArn ?? requestedArn
  const family = definition?.family ?? nameFromArn(arn).split(":")[0]
  const revision = num(definition?.revision)
  const containers: ContainerDefinitionReading[] = []
  const findings: EnvironmentCredentialFinding[] = []

  for (const container of definition?.containerDefinitions ?? []) {
    const containerName = container?.name ?? "unnamed container"
    const environmentNames = (container?.environment ?? [])
      .map((entry) => entry?.name)
      .filter((name): name is string => typeof name === "string" && name.length > 0)
      .sort()
    const secretNames = (container?.secrets ?? [])
      .map((entry) => entry?.name)
      .filter((name): name is string => typeof name === "string" && name.length > 0)
      .sort()
    const credentialLooking = environmentNames.filter(looksLikeCredentialName)

    for (const name of credentialLooking) {
      findings.push({
        taskDefinitionArn: arn,
        family,
        revision,
        containerName,
        name,
        why:
          `${family}:${revision ?? "?"} container ${containerName} declares ${name} as a PLAIN-TEXT ` +
          `environment entry. Anyone holding ecs:DescribeTaskDefinition can read its value, and it ` +
          `is written into the task definition rather than resolved from Secrets Manager at start. ` +
          `The value is not read by this engine and is not shown here.`,
      })
    }

    containers.push({
      name: containerName,
      image: container?.image ?? null,
      cpu: num(container?.cpu),
      memory: num(container?.memory),
      memoryReservation: num(container?.memoryReservation),
      essential: typeof container?.essential === "boolean" ? container.essential : null,
      logConfiguration: readLogConfiguration(container?.logConfiguration),
      secretNames,
      environmentNames,
      credentialLookingEnvironmentNames: credentialLooking,
    })
  }

  // Deterministic: the order containerDefinitions arrives in is the order the
  // revision declares, but two loads of the same revision must sort identically
  // for a screenshot diff to be readable.
  containers.sort((a, b) => a.name.localeCompare(b.name))
  findings.sort(
    (a, b) => a.containerName.localeCompare(b.containerName) || a.name.localeCompare(b.name),
  )

  return {
    arn,
    family,
    revision,
    status: definition?.status ?? null,
    cpu: definition?.cpu ?? null,
    memory: definition?.memory ?? null,
    networkMode: definition?.networkMode ?? null,
    taskRoleArn: definition?.taskRoleArn ?? null,
    executionRoleArn: definition?.executionRoleArn ?? null,
    requiresCompatibilities: [...(definition?.requiresCompatibilities ?? [])].sort(),
    registeredAt: isoTime(definition?.registeredAt),
    containers,
    declaresSecrets: containers.some((c) => c.secretNames.length > 0),
    declaresPlainTextEnvironment: containers.some((c) => c.environmentNames.length > 0),
    credentialFindings: findings,
  }
}

/* ----------------------------------------------------------- the reading -- */

interface ReadContext {
  now: () => Date
  denial: DenialContext
}

/**
 * Every cluster ARN in the region.
 *
 * ONE page. `client.ts` builds `ListClustersCommand({})` with no `nextToken`
 * passthrough, and `client.ts` is another agent's file. A second page cannot be
 * requested from here, so when the first comes back with a token the reading says
 * so rather than passing one page off as the estate.
 */
async function listClusterArns(gw: AwsGateway, ctx: ReadContext): Promise<AwsRead<Paged<string>>> {
  return readAws<Paged<string>>(
    "ecs:ListClusters",
    async () => {
      const response = (await gw.call("ecs:ListClusters")) as ListClustersResponse
      const items = [...(response?.clusterArns ?? [])].filter((a) => typeof a === "string").sort()
      const truncation: Truncation = response?.nextToken
        ? {
            kind: "truncated",
            pagesRead: 1,
            itemsRead: items.length,
            why:
              "ecs:ListClusters returned a nextToken and this engine cannot send one: the " +
              "ListClusters input built in client.ts carries no pagination token. Clusters beyond " +
              "the first page were not read and are not claimed to be absent",
          }
        : COMPLETE
      return { items, truncation }
    },
    {
      now: ctx.now,
      denial: ctx.denial,
      isEmpty: (value) => (value as Paged<string>).items.length === 0,
      ...RETRY,
    },
  )
}

/** Capacity providers, registered instances and totals, for a batch of clusters. */
async function describeClusters(
  gw: AwsGateway,
  arns: readonly string[],
  ctx: ReadContext,
): Promise<AwsRead<{ byArn: Map<string, ClusterDetail>; failures: readonly DescribeFailure[] }>> {
  return readAws<{ byArn: Map<string, ClusterDetail>; failures: readonly DescribeFailure[] }>(
    "ecs:DescribeClusters",
    async () => {
      const byArn = new Map<string, ClusterDetail>()
      const failures: DescribeFailure[] = []
      for (let start = 0; start < arns.length; start += DESCRIBE_CLUSTERS_BATCH) {
        const response = (await gw.call("ecs:DescribeClusters", {
          clusters: arns.slice(start, start + DESCRIBE_CLUSTERS_BATCH),
        })) as DescribeClustersResponse
        for (const cluster of response?.clusters ?? []) {
          if (!cluster?.clusterArn) continue
          const statistics: Record<string, string> = {}
          for (const entry of cluster.statistics ?? []) {
            if (entry?.name) statistics[entry.name] = entry.value ?? ""
          }
          const settings: Record<string, string> = {}
          for (const entry of cluster.settings ?? []) {
            if (entry?.name) settings[entry.name] = entry.value ?? ""
          }
          byArn.set(cluster.clusterArn, {
            name: cluster.clusterName ?? nameFromArn(cluster.clusterArn),
            status: cluster.status ?? null,
            registeredContainerInstancesCount: num(cluster.registeredContainerInstancesCount),
            runningTasksCount: num(cluster.runningTasksCount),
            pendingTasksCount: num(cluster.pendingTasksCount),
            activeServicesCount: num(cluster.activeServicesCount),
            capacityProviders: [...(cluster.capacityProviders ?? [])].sort(),
            defaultCapacityProviderStrategy: (cluster.defaultCapacityProviderStrategy ?? [])
              .filter((entry) => typeof entry?.capacityProvider === "string")
              .map((entry) => ({
                capacityProvider: entry.capacityProvider as string,
                weight: num(entry.weight),
                base: num(entry.base),
              }))
              .sort((a, b) => a.capacityProvider.localeCompare(b.capacityProvider)),
            statistics,
            settings,
          })
        }
        failures.push(...failuresOf(response?.failures))
      }
      return { byArn, failures }
    },
    {
      now: ctx.now,
      denial: ctx.denial,
      // Never EMPTY: a describe of zero clusters is not reached (the caller only
      // calls with ARNs), and a Map with no entries beside a failures list is an
      // ANSWER — the clusters were refused individually, which the failures say.
      isEmpty: () => false,
      ...RETRY,
    },
  )
}

/**
 * The service ARNs in one cluster.
 *
 * Its OWN reading, separate from the describe, because they are two IAM actions.
 * Folded together, a refused `ecs:ListServices` would render a minimum statement
 * naming `ecs:DescribeServices` — the action that was never reached — and an
 * operator would grant it, redeploy, and be refused identically. `retained.ts`
 * paid for that lesson once already.
 */
async function listServiceArns(
  gw: AwsGateway,
  cluster: string,
  ctx: ReadContext,
): Promise<AwsRead<Paged<string>>> {
  return readAws<Paged<string>>(
    "ecs:ListServices",
    async () => {
      const arns: string[] = []
      let token: string | undefined
      let truncation: Truncation = COMPLETE
      let pages = 0
      for (let page = 0; page < MAX_SERVICE_PAGES; page += 1) {
        pages = page + 1
        const listed = (await gw.call("ecs:ListServices", {
          cluster,
          nextToken: token,
        })) as ListServicesResponse
        for (const arn of listed?.serviceArns ?? []) {
          if (typeof arn === "string" && arn) arns.push(arn)
        }
        token = listed?.nextToken || undefined
        if (!token) break
        if (page === MAX_SERVICE_PAGES - 1) {
          truncation = {
            kind: "truncated",
            pagesRead: pages,
            itemsRead: arns.length,
            why: `ecs:ListServices still had pages after ${MAX_SERVICE_PAGES} for ${nameFromArn(cluster)}; this engine stopped there`,
          }
        }
      }
      arns.sort()
      return { items: arns, truncation }
    },
    {
      now: ctx.now,
      denial: ctx.denial,
      isEmpty: (value) => (value as Paged<string>).items.length === 0,
      ...RETRY,
    },
  )
}

/**
 * Every service in one cluster, described in batches of ten.
 *
 * `sink` collects ECS's `failures` entries. They arrive beside a 200 response and
 * a reader that ignored them would silently shorten its own answer: three ARNs
 * in, two services out, and no statement anywhere that one was refused.
 */
async function describeServices(
  gw: AwsGateway,
  cluster: string,
  arns: readonly string[],
  ctx: ReadContext,
  sink: DescribeFailure[],
): Promise<AwsRead<readonly RawService[]>> {
  return readAws<readonly RawService[]>(
    "ecs:DescribeServices",
    async () => {
      const items: RawService[] = []
      for (let start = 0; start < arns.length; start += DESCRIBE_SERVICES_BATCH) {
        // Ten at a time is the API's ceiling, not a tuning choice: eleven in one
        // call is a validation error, which would surface as ERROR on a healthy
        // estate.
        const described = (await gw.call("ecs:DescribeServices", {
          cluster,
          services: arns.slice(start, start + DESCRIBE_SERVICES_BATCH),
        })) as DescribeServicesResponse
        for (const service of described?.services ?? []) {
          if (!service?.serviceArn) continue
          items.push({
            name: service.serviceName ?? nameFromArn(service.serviceArn),
            arn: service.serviceArn,
            clusterArn: service.clusterArn ?? null,
            status: service.status ?? null,
            desiredCount: num(service.desiredCount),
            runningCount: num(service.runningCount),
            pendingCount: num(service.pendingCount),
            launchType: service.launchType ?? null,
            taskDefinitionArn: service.taskDefinition ?? null,
            healthCheckGracePeriodSeconds: num(service.healthCheckGracePeriodSeconds),
            targetGroupArns: (service.loadBalancers ?? [])
              .map((lb) => lb?.targetGroupArn)
              .filter((arn): arn is string => typeof arn === "string" && arn.length > 0)
              .sort(),
            deployments: (service.deployments ?? [])
              .filter((d) => typeof d?.id === "string")
              .map((d) => ({
                id: d.id as string,
                status: d.status ?? null,
                taskDefinition: d.taskDefinition ?? null,
                desiredCount: num(d.desiredCount),
                runningCount: num(d.runningCount),
                pendingCount: num(d.pendingCount),
                failedTasks: num(d.failedTasks),
                rolloutState: d.rolloutState ?? null,
                rolloutStateReason: d.rolloutStateReason ?? null,
                createdAt: isoTime(d.createdAt),
                updatedAt: isoTime(d.updatedAt),
              }))
              .sort((a, b) => a.id.localeCompare(b.id)),
          })
        }
        sink.push(...failuresOf(described?.failures))
      }
      items.sort((a, b) => a.name.localeCompare(b.name))
      return items
    },
    {
      now: ctx.now,
      denial: ctx.denial,
      // EMPTY here would mean "DescribeServices answered about nothing", which
      // only happens when every ARN failed. The failures say so; an EMPTY that
      // erased them would read as "this cluster has no services".
      isEmpty: () => false,
      ...RETRY,
    },
  )
}

/**
 * The two service reads, combined, each still naming its own action on failure.
 *
 * Returns the LISTING's arm unchanged when the listing failed, and the
 * DESCRIBE's arm unchanged when the describe failed, so the minimum statement an
 * operator pastes always names the call that was actually refused.
 */
async function readServices(
  gw: AwsGateway,
  cluster: string,
  ctx: ReadContext,
): Promise<{
  read: AwsRead<readonly RawService[]>
  truncation: Truncation
  failures: readonly DescribeFailure[]
}> {
  const failures: DescribeFailure[] = []
  const listed = await listServiceArns(gw, cluster, ctx)
  if (listed.state !== "ACTUAL" && listed.state !== "STALE") {
    // Every non-value arm travels unchanged, EMPTY included: a cluster with no
    // services is EMPTY on `ecs:ListServices`, which is a claim this engine can
    // make, and a refusal is DENIED on `ecs:ListServices`, which is not.
    return { read: listed, truncation: COMPLETE, failures }
  }
  const described = await describeServices(gw, cluster, listed.value.items, ctx, failures)
  return { read: described, truncation: listed.value.truncation, failures }
}

/** The raw service record, before its task definition and its gap are attached. */
interface RawService {
  name: string
  arn: string
  clusterArn: string | null
  status: string | null
  desiredCount: number | null
  runningCount: number | null
  pendingCount: number | null
  launchType: string | null
  taskDefinitionArn: string | null
  healthCheckGracePeriodSeconds: number | null
  targetGroupArns: readonly string[]
  deployments: readonly DeploymentReading[]
}

/**
 * Every task in one cluster at one desired status.
 *
 * RUNNING and STOPPED are two separate calls because they are two separate
 * questions and because they fail independently: a role granted `ecs:ListTasks`
 * is granted it for both, but a throttle on one must not erase the other.
 */
async function listTaskArns(
  gw: AwsGateway,
  cluster: string,
  desiredStatus: "RUNNING" | "STOPPED",
  ctx: ReadContext,
): Promise<AwsRead<Paged<string>>> {
  return readAws<Paged<string>>(
    "ecs:ListTasks",
    async () => {
      const arns: string[] = []
      let token: string | undefined
      let truncation: Truncation = COMPLETE
      let pages = 0
      for (let page = 0; page < MAX_TASK_PAGES; page += 1) {
        pages = page + 1
        const listed = (await gw.call("ecs:ListTasks", {
          cluster,
          desiredStatus,
          nextToken: token,
        })) as ListTasksResponse
        for (const arn of listed?.taskArns ?? []) {
          if (typeof arn === "string" && arn) arns.push(arn)
        }
        token = listed?.nextToken || undefined
        if (!token) break
        if (page === MAX_TASK_PAGES - 1) {
          truncation = {
            kind: "truncated",
            pagesRead: pages,
            itemsRead: arns.length,
            why: `ecs:ListTasks still had pages after ${MAX_TASK_PAGES} for ${desiredStatus} tasks in ${nameFromArn(cluster)}; this engine stopped there`,
          }
        }
      }
      arns.sort()
      return { items: arns, truncation }
    },
    {
      now: ctx.now,
      denial: ctx.denial,
      isEmpty: (value) => (value as Paged<string>).items.length === 0,
      ...RETRY,
    },
  )
}

/** Every listed task described, in batches of one hundred, with its stop cause. */
async function describeTasks(
  gw: AwsGateway,
  cluster: string,
  arns: readonly string[],
  ctx: ReadContext,
  sink: DescribeFailure[],
): Promise<AwsRead<readonly TaskReading[]>> {
  return readAws<readonly TaskReading[]>(
    "ecs:DescribeTasks",
    async () => {
      const items: TaskReading[] = []
      for (let start = 0; start < arns.length; start += DESCRIBE_TASKS_BATCH) {
        const described = (await gw.call("ecs:DescribeTasks", {
          cluster,
          tasks: arns.slice(start, start + DESCRIBE_TASKS_BATCH),
        })) as DescribeTasksResponse
        for (const task of described?.tasks ?? []) {
          if (!task?.taskArn) continue
          const containers: TaskContainerReading[] = (task.containers ?? [])
            .map((container) => ({
              name: container?.name ?? "unnamed container",
              image: container?.image ?? null,
              imageDigest: container?.imageDigest ?? null,
              lastStatus: container?.lastStatus ?? null,
              exitCode: num(container?.exitCode),
              reason: container?.reason ?? null,
              healthStatus: container?.healthStatus ?? null,
            }))
            .sort((a, b) => a.name.localeCompare(b.name))
          items.push({
            arn: task.taskArn,
            taskDefinitionArn: task.taskDefinitionArn ?? null,
            group: task.group ?? null,
            lastStatus: task.lastStatus ?? null,
            desiredStatus: task.desiredStatus ?? null,
            healthStatus: task.healthStatus ?? null,
            cpu: task.cpu ?? null,
            memory: task.memory ?? null,
            launchType: task.launchType ?? null,
            capacityProviderName: task.capacityProviderName ?? null,
            availabilityZone: task.availabilityZone ?? null,
            connectivity: task.connectivity ?? null,
            startedBy: task.startedBy ?? null,
            stopCode: task.stopCode ?? null,
            createdAt: isoTime(task.createdAt),
            startedAt: isoTime(task.startedAt),
            stoppedAt: isoTime(task.stoppedAt),
            stopCause: classifyStopReason(
              task.stoppedReason ?? null,
              task.stopCode ?? null,
              significantExitCode(containers),
            ),
            containers,
          })
        }
        sink.push(...failuresOf(described?.failures))
      }
      // Newest stop first — which task died last is the question this list is
      // read for — with the ARN as a deterministic tie-break.
      items.sort(
        (a, b) => (b.stoppedAt ?? "").localeCompare(a.stoppedAt ?? "") || a.arn.localeCompare(b.arn),
      )
      return items
    },
    {
      now: ctx.now,
      denial: ctx.denial,
      // See describeServices: an EMPTY here would erase the failures list that
      // explains why nothing was described.
      isEmpty: () => false,
      ...RETRY,
    },
  )
}

/** The two task reads, combined, each still naming its own action on failure. */
async function readTasks(
  gw: AwsGateway,
  cluster: string,
  desiredStatus: "RUNNING" | "STOPPED",
  ctx: ReadContext,
): Promise<{
  read: AwsRead<readonly TaskReading[]>
  truncation: Truncation
  failures: readonly DescribeFailure[]
}> {
  const failures: DescribeFailure[] = []
  const listed = await listTaskArns(gw, cluster, desiredStatus, ctx)
  if (listed.state !== "ACTUAL" && listed.state !== "STALE") {
    return { read: listed, truncation: COMPLETE, failures }
  }
  const described = await describeTasks(gw, cluster, listed.value.items, ctx, failures)
  return { read: described, truncation: listed.value.truncation, failures }
}

/** One task-definition revision. Immutable, so its cadence is an hour. */
async function readTaskDefinitionRevision(
  gw: AwsGateway,
  arn: string,
  ctx: ReadContext,
): Promise<AwsRead<TaskDefinitionReading>> {
  return readAws<TaskDefinitionReading>(
    "ecs:DescribeTaskDefinition",
    async () => {
      const response = (await gw.call("ecs:DescribeTaskDefinition", {
        taskDefinition: arn,
      })) as DescribeTaskDefinitionResponse
      if (!response?.taskDefinition) {
        throw new Error(
          `ecs:DescribeTaskDefinition answered for ${arn} without a taskDefinition. The revision a ` +
            `service is running cannot be stated from this.`,
        )
      }
      return readTaskDefinition(response, arn)
    },
    // A revision is never meaningfully "empty": a task definition with no
    // containers is a malformed revision, which is a finding, not an absence.
    { now: ctx.now, denial: ctx.denial, isEmpty: () => false, ...RETRY },
  )
}

/* ------------------------------------------------------------- the joins -- */

/** The service a task belongs to. ECS writes `service:<name>` into `group`. */
export function serviceOfTaskGroup(group: string | null): string | null {
  if (!group) return null
  return group.startsWith("service:") ? group.slice("service:".length) : null
}

/**
 * Why a service is short of tasks, from the stopped tasks in the window.
 *
 * The function this whole module exists for. `stopped` is the reading, not an
 * array, so a refused or throttled task read produces `unknown` and NOT
 * `unexplained` — "nothing stopped" and "we could not look at what stopped" are
 * opposite facts and only one of them means the scheduler is stuck.
 */
export function countGap(
  service: { name: string; desiredCount: number | null; runningCount: number | null },
  stopped: AwsRead<readonly TaskReading[]>,
): CountGap {
  const desired = service.desiredCount ?? 0
  const running = service.runningCount ?? 0
  if (service.desiredCount === null || service.runningCount === null) {
    return {
      kind: "unknown",
      desired,
      running,
      missing: 0,
      why:
        `ecs:DescribeServices did not report ${service.desiredCount === null ? "desiredCount" : "runningCount"} ` +
        `for ${service.name}, so whether it is short of tasks cannot be stated.`,
    }
  }
  const missing = desired - running
  if (missing <= 0) return { kind: "none", desired, running }

  if (stopped.state !== "ACTUAL" && stopped.state !== "STALE") {
    if (stopped.state === "EMPTY") {
      return {
        kind: "unexplained",
        desired,
        running,
        missing,
        why:
          `${missing} task(s) short and NOTHING stopped in ECS's retention window. The scheduler is ` +
          `not placing them — capacity, subnet, or the capacity provider — rather than tasks ` +
          `crashing. ${ECS_STOPPED_WINDOW.why}`,
      }
    }
    return {
      kind: "unknown",
      desired,
      running,
      missing,
      why: `${missing} task(s) short, and why cannot be stated — ${describeRead(stopped, "the stopped tasks")}`,
    }
  }

  const mine = stopped.value.filter((task) => serviceOfTaskGroup(task.group) === service.name)
  if (mine.length === 0) {
    return {
      kind: "unexplained",
      desired,
      running,
      missing,
      why:
        `${missing} task(s) short and no task of this service stopped in ECS's retention window. The ` +
        `scheduler is not placing them — capacity, subnet, or the capacity provider — rather than ` +
        `tasks crashing. ${ECS_STOPPED_WINDOW.why}`,
    }
  }

  const grouped = new Map<string, { cause: StopCause; taskArns: string[] }>()
  for (const task of mine) {
    const key = `${task.stopCause.kind}::${"raw" in task.stopCause ? task.stopCause.raw : task.stopCause.why}`
    const existing = grouped.get(key)
    if (existing) existing.taskArns.push(task.arn)
    else grouped.set(key, { cause: task.stopCause, taskArns: [task.arn] })
  }
  const incidents: StoppedIncident[] = [...grouped.values()]
    .map((entry) => ({
      cause: entry.cause,
      count: entry.taskArns.length,
      taskArns: [...entry.taskArns].sort(),
    }))
    // Most frequent first, then by kind, so two loads of the same estate order
    // identically and the biggest incident is the first thing read.
    .sort((a, b) => b.count - a.count || a.cause.kind.localeCompare(b.cause.kind))

  return { kind: "explained", desired, running, missing, incidents }
}

/** The sentence a surface prints for a gap. One renderer, as everywhere here. */
export function describeCountGap(gap: CountGap): string {
  switch (gap.kind) {
    case "none":
      return `${gap.running}/${gap.desired} — at its desired count`
    case "explained":
      return (
        `${gap.running}/${gap.desired} — ${gap.missing} short. ` +
        gap.incidents
          .map((incident) => `${incident.count}× ${describeStopCause(incident.cause)}`)
          .join(" · ")
      )
    case "unexplained":
      return `${gap.running}/${gap.desired} — ${gap.missing} short, UNEXPLAINED. ${gap.why}`
    case "unknown":
      return `${gap.running}/${gap.desired} — ${gap.why}`
  }
}

/** Attribution from the tag index, with `unknown` when the index was not readable. */
function attributionFor(
  arn: string | null,
  tagged: AwsRead<readonly TaggedResource[]>,
  index: Map<string, Readonly<Record<string, string>>>,
): ResourceAttribution {
  if (tagged.state !== "ACTUAL" && tagged.state !== "STALE" && tagged.state !== "EMPTY") {
    return {
      kind: "unknown",
      why: `this resource's tags were not read — ${describeRead(tagged, "the tag index")}`,
    }
  }
  if (!arn) {
    return {
      kind: "unknown",
      why:
        "this resource has no ARN this engine can state, so it cannot be joined against the tag " +
        "index. Unattributed would be a claim about its tags; this is a claim about ours.",
    }
  }
  const tags = index.get(arn)
  // The tag index answered and this ARN is not in it. That IS an observation: the
  // Resource Groups Tagging API returns resources that have tags, so an absence
  // means no tags at all, which is what `unattributed` says.
  if (tags === undefined) return { kind: "unattributed" }
  const decided = attributionOf(tags)
  switch (decided.kind) {
    case "tenant":
      return { kind: "tenant", tenantSlug: decided.tenantSlug }
    case "shared":
      return { kind: "shared" }
    case "unattributed":
      return { kind: "unattributed" }
  }
}

/** The UNCONFIGURED reading a capped cluster carries. Never an empty list. */
function cappedRead<T>(
  capability:
    | "ecs:DescribeClusters"
    | "ecs:DescribeServices"
    | "ecs:DescribeTasks"
    | "ecs:DescribeTaskDefinition",
  why: string,
): AwsRead<T> {
  return { state: "UNCONFIGURED", capability, why }
}

/* ---------------------------------------------------------- the surface -- */

/**
 * Every cluster, its services, the revision each is running, and every task that
 * stopped in ECS's window with the reason it stopped.
 *
 * The production entry point. A route or a page calls it with no arguments and
 * gets the live gateway; a test passes a stand-in gateway to the SAME function,
 * because a test that drove a private helper would stay green on the day the
 * caller stopped calling it.
 */
export async function containerReadings(
  supplied?: AwsGateway,
  options: { now?: () => Date } = {},
): Promise<ContainerReadings> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())

  const identity = await resolveIdentity(supplied, { now })
  const denial = denialContextFrom(identity)
  const ctx: ReadContext = { now, denial }
  const tagged = await taggedResources(supplied, { now, denial })
  const index = tagIndex(tagged.state === "ACTUAL" || tagged.state === "STALE" ? tagged.value : [])
  const identityResolved = identity.state === "ACTUAL" || identity.state === "STALE"

  const refreshMs = {
    clusters: CAPABILITIES["ecs:ListClusters"].refreshMs,
    clusterDetail: CAPABILITIES["ecs:DescribeClusters"].refreshMs,
    services: CAPABILITIES["ecs:DescribeServices"].refreshMs,
    tasks: CAPABILITIES["ecs:DescribeTasks"].refreshMs,
    taskDefinition: CAPABILITIES["ecs:DescribeTaskDefinition"].refreshMs,
  }

  const listed = await listClusterArns(gw, ctx)
  const asOf = now().toISOString()

  // DENIED, THROTTLED, ERROR, UNCONFIGURED and EMPTY all travel unchanged. There
  // is no branch here that turns any of them into an array.
  if (listed.state !== "ACTUAL" && listed.state !== "STALE") {
    // No cast: the arms left after this narrowing are precisely the ones with no
    // `value` field, so this already IS an `AwsRead<readonly ClusterReading[]>`.
    const clusters: AwsRead<readonly ClusterReading[]> = listed
    return {
      identity,
      tagged,
      clusters,
      truncation: COMPLETE,
      fleet: fleetState(clusters),
      credentialFindings: [],
      asOf,
      refreshMs,
    }
  }

  const arns = listed.value.items
  const withinDepth = arns.slice(0, MAX_CLUSTER_DEPTH_READS)

  const detailRead = await describeClusters(gw, withinDepth, ctx)
  const details =
    detailRead.state === "ACTUAL" || detailRead.state === "STALE" ? detailRead.value : null

  // Services and both task readings per cluster. All three are issued regardless
  // of the others' outcome: a refused DescribeTasks must not hide the services,
  // and a refused DescribeServices must not hide why tasks stopped.
  type ClusterReads = {
    services: Awaited<ReturnType<typeof readServices>>
    running: Awaited<ReturnType<typeof readTasks>>
    stopped: Awaited<ReturnType<typeof readTasks>>
  }
  const perCluster = new Map<string, ClusterReads>()
  for (let start = 0; start < withinDepth.length; start += DETAIL_CONCURRENCY) {
    const batch = withinDepth.slice(start, start + DETAIL_CONCURRENCY)
    const read = await Promise.all(
      batch.map(async (cluster) => {
        const [services, running, stopped] = await Promise.all([
          readServices(gw, cluster, ctx),
          readTasks(gw, cluster, "RUNNING", ctx),
          readTasks(gw, cluster, "STOPPED", ctx),
        ])
        return { cluster, services, running, stopped }
      }),
    )
    for (const entry of read) {
      perCluster.set(entry.cluster, {
        services: entry.services,
        running: entry.running,
        stopped: entry.stopped,
      })
    }
  }

  // The task-definition pass, deduplicated across the whole load and budgeted. A
  // revision is immutable, so describing the same ARN twice would be two calls
  // for one answer.
  const revisionArns: string[] = []
  for (const cluster of withinDepth) {
    const read = perCluster.get(cluster)?.services.read
    if (!read || (read.state !== "ACTUAL" && read.state !== "STALE")) continue
    for (const service of read.value) {
      if (service.taskDefinitionArn && !revisionArns.includes(service.taskDefinitionArn)) {
        revisionArns.push(service.taskDefinitionArn)
      }
    }
  }
  revisionArns.sort()
  const budgeted = revisionArns.slice(0, MAX_TASK_DEFINITION_READS)
  const revisions = new Map<string, AwsRead<TaskDefinitionReading>>()
  for (let start = 0; start < budgeted.length; start += DETAIL_CONCURRENCY) {
    const batch = budgeted.slice(start, start + DETAIL_CONCURRENCY)
    const read = await Promise.all(batch.map((arn) => readTaskDefinitionRevision(gw, arn, ctx)))
    batch.forEach((arn, i) => revisions.set(arn, read[i]))
  }

  const clusterReadings: ClusterReading[] = arns.map((arn, position) => {
    const where = locationOf(arn)
    const beyondDepth = position >= MAX_CLUSTER_DEPTH_READS
    const capReason =
      `this engine reads at most ${MAX_CLUSTER_DEPTH_READS} clusters per load and this one is ` +
      `number ${position + 1} of ${arns.length}. It was not read — which is not the same as its ` +
      `being empty.`

    const detail: AwsRead<ClusterDetail> = beyondDepth
      ? cappedRead<ClusterDetail>("ecs:DescribeClusters", capReason)
      : details
        ? details.byArn.has(arn)
          ? { state: "ACTUAL", capability: "ecs:DescribeClusters", value: details.byArn.get(arn) as ClusterDetail, asOf, fresh: true }
          : {
              state: "ERROR",
              capability: "ecs:DescribeClusters",
              code: "ClusterNotDescribed",
              safeDetail:
                `ecs:ListClusters returned ${arn} and ecs:DescribeClusters answered without it. ` +
                `Its capacity providers and registered instances are unknown; the ECS failures ` +
                `list beside this row is the reason, where AWS gave one.`,
            }
        : // The describe was refused, throttled or broke. It travels unchanged so
          // the minimum statement names ecs:DescribeClusters — the action that was
          // actually refused — rather than ecs:ListClusters, which worked.
          (detailRead as AwsRead<ClusterDetail>)

    const reads = perCluster.get(arn)
    const servicesRead = reads?.services.read
    const runningRead = reads?.running.read
    const stoppedRead = reads?.stopped.read

    const stoppedTasks: AwsRead<readonly TaskReading[]> =
      stoppedRead ?? cappedRead<readonly TaskReading[]>("ecs:DescribeTasks", capReason)
    const runningTasks: AwsRead<readonly TaskReading[]> =
      runningRead ?? cappedRead<readonly TaskReading[]>("ecs:DescribeTasks", capReason)

    let services: AwsRead<readonly ServiceReading[]>
    const serviceTruncation: Truncation = reads?.services.truncation ?? COMPLETE
    const failures: DescribeFailure[] = [
      ...(details?.failures ?? []).filter((failure) => failure.arn === arn),
      ...(reads?.services.failures ?? []),
      ...(reads?.running.failures ?? []),
      ...(reads?.stopped.failures ?? []),
    ]

    if (!servicesRead) {
      services = cappedRead<readonly ServiceReading[]>("ecs:DescribeServices", capReason)
    } else if (servicesRead.state === "ACTUAL" || servicesRead.state === "STALE") {
      const built: ServiceReading[] = servicesRead.value.map((service) => {
        const revision = service.taskDefinitionArn
          ? revisions.get(service.taskDefinitionArn)
          : undefined
        const taskDefinition: AwsRead<TaskDefinitionReading> =
          revision ??
          cappedRead<TaskDefinitionReading>(
            "ecs:DescribeTaskDefinition",
            service.taskDefinitionArn
              ? `this engine describes at most ${MAX_TASK_DEFINITION_READS} distinct revisions per ` +
                  `load and ${service.taskDefinitionArn} was past that budget. Which image, cpu, ` +
                  `memory and environment it declares was not read.`
              : `ecs:DescribeServices did not report a taskDefinition for ${service.name}, so there ` +
                  `is no revision ARN to describe. Which build it runs cannot be stated.`,
          )
        return {
          name: service.name,
          arn: service.arn,
          clusterArn: service.clusterArn,
          status: service.status,
          desiredCount: service.desiredCount,
          runningCount: service.runningCount,
          pendingCount: service.pendingCount,
          launchType: service.launchType,
          taskDefinitionArn: service.taskDefinitionArn,
          healthCheckGracePeriodSeconds: service.healthCheckGracePeriodSeconds,
          targetGroupArns: service.targetGroupArns,
          deployments: service.deployments,
          attribution: attributionFor(service.arn, tagged, index),
          taskDefinition,
          gap: countGap(service, stoppedTasks),
        }
      })
      services = { ...servicesRead, value: built }
    } else {
      // Every non-value arm travels unchanged. There is no branch here that turns
      // a refused DescribeServices into an empty service list.
      services = servicesRead
    }

    failures.sort((a, b) => a.arn.localeCompare(b.arn) || a.reason.localeCompare(b.reason))

    return {
      arn,
      name: nameFromArn(arn),
      // From the ARN when it parses — AWS's answer beats anything assembled — and
      // otherwise from the resolved identity. Never a literal.
      partition: where.partition ?? (identityResolved ? identity.value.partition : null),
      region: where.region ?? (identityResolved ? identity.value.region : null),
      attribution: attributionFor(arn, tagged, index),
      detail,
      services,
      serviceTruncation,
      runningTasks,
      runningTaskTruncation: reads?.running.truncation ?? COMPLETE,
      stoppedTasks,
      stoppedTaskTruncation: reads?.stopped.truncation ?? COMPLETE,
      stoppedWindow: ECS_STOPPED_WINDOW,
      failures,
      asOf,
    }
  })

  const clusters: AwsRead<readonly ClusterReading[]> = { ...listed, value: clusterReadings }
  const credentialFindings = [...revisions.values()]
    .flatMap((read) =>
      read.state === "ACTUAL" || read.state === "STALE" ? read.value.credentialFindings : [],
    )
    .sort(
      (a, b) =>
        a.taskDefinitionArn.localeCompare(b.taskDefinitionArn) ||
        a.containerName.localeCompare(b.containerName) ||
        a.name.localeCompare(b.name),
    )

  return {
    identity,
    tagged,
    clusters,
    truncation: listed.value.truncation,
    fleet: fleetState(clusters),
    credentialFindings,
    asOf,
    refreshMs,
  }
}

/* -------------------------------------------------------- the headline -- */

/**
 * Whether the fleet is running what it was asked to run.
 *
 * `steady` is the narrowest arm in this module by design: it requires that every
 * cluster answered, every service answered, and every task read answered. One
 * refused `ecs:DescribeTasks` anywhere makes the whole answer `unverified`,
 * because a gap this engine could not see is exactly the gap that matters.
 */
export function fleetState(clusters: AwsRead<readonly ClusterReading[]>): FleetState {
  if (clusters.state === "EMPTY") return { kind: "no-clusters" }
  if (clusters.state !== "ACTUAL" && clusters.state !== "STALE") {
    return { kind: "unknown", why: describeRead(clusters, "the ECS clusters") }
  }

  const degraded: { cluster: string; service: string; gap: CountGap }[] = []
  const unreadable: string[] = []
  let servicesConsidered = 0
  let runningTasks = 0
  let unexplained = 0

  for (const cluster of clusters.value) {
    if (cluster.detail.state !== "ACTUAL" && cluster.detail.state !== "STALE") {
      unreadable.push(`${cluster.name}: ${describeRead(cluster.detail, "cluster capacity")}`)
    }
    if (cluster.runningTasks.state === "ACTUAL" || cluster.runningTasks.state === "STALE") {
      runningTasks += cluster.runningTasks.value.length
    } else if (cluster.runningTasks.state !== "EMPTY") {
      unreadable.push(`${cluster.name}: ${describeRead(cluster.runningTasks, "running tasks")}`)
    }
    if (
      cluster.stoppedTasks.state !== "ACTUAL" &&
      cluster.stoppedTasks.state !== "STALE" &&
      cluster.stoppedTasks.state !== "EMPTY"
    ) {
      unreadable.push(`${cluster.name}: ${describeRead(cluster.stoppedTasks, "stopped tasks")}`)
    }
    if (cluster.services.state !== "ACTUAL" && cluster.services.state !== "STALE") {
      if (cluster.services.state !== "EMPTY") {
        unreadable.push(`${cluster.name}: ${describeRead(cluster.services, "services")}`)
      }
      continue
    }
    for (const service of cluster.services.value) {
      servicesConsidered += 1
      if (service.gap.kind === "explained" || service.gap.kind === "unexplained") {
        degraded.push({ cluster: cluster.name, service: service.name, gap: service.gap })
        if (service.gap.kind === "unexplained") unexplained += 1
      } else if (service.gap.kind === "unknown") {
        unreadable.push(`${cluster.name}/${service.name}: ${service.gap.why}`)
      }
    }
  }

  unreadable.sort()
  if (degraded.length > 0) {
    degraded.sort(
      (a, b) => a.cluster.localeCompare(b.cluster) || a.service.localeCompare(b.service),
    )
    return { kind: "degraded", services: degraded, unexplained, unreadable }
  }
  if (unreadable.length > 0) {
    return {
      kind: "unverified",
      why:
        `no service reported a gap, and ${unreadable.length} read(s) did not answer. A gap this ` +
        `engine could not look for is not a gap it did not find.`,
      unreadable,
      servicesConsidered,
    }
  }
  return {
    kind: "steady",
    clusters: clusters.value.length,
    services: servicesConsidered,
    runningTasks,
  }
}

/** The sentence a surface prints for the headline. */
export function describeFleetState(fleet: FleetState): string {
  switch (fleet.kind) {
    case "unknown":
      return `unknown — ${fleet.why}`
    case "no-clusters":
      return "no ECS cluster exists in this region. Nothing is deployed here, which is a fact about the estate and not a health statement."
    case "degraded":
      return (
        `DEGRADED — ${fleet.services.length} service(s) short of their desired count` +
        (fleet.unexplained > 0 ? `, ${fleet.unexplained} of them UNEXPLAINED` : "") +
        `: ` +
        fleet.services
          .map((entry) => `${entry.cluster}/${entry.service} ${describeCountGap(entry.gap)}`)
          .join(" · ")
      )
    case "unverified":
      return `unverified — ${fleet.why} Not answered: ${fleet.unreadable.join(" · ")}`
    case "steady":
      return `steady — ${fleet.services} service(s) across ${fleet.clusters} cluster(s) at their desired count, ${fleet.runningTasks} task(s) running`
  }
}

/* ----------------------------------------------------------- the render -- */

export interface ContainerLine {
  label: string
  text: string
}

/** One task-definition revision as the sentence a surface prints. */
export function describeTaskDefinition(read: AwsRead<TaskDefinitionReading>): string {
  if (read.state !== "ACTUAL" && read.state !== "STALE") {
    return describeRead(read, "the running revision")
  }
  const definition = read.value
  const images = definition.containers
    .map((container) => {
      const log =
        container.logConfiguration.kind === "configured"
          ? `logs→${container.logConfiguration.driver}${container.logConfiguration.logGroup ? `:${container.logConfiguration.logGroup}` : ""}`
          : `NO LOG CONFIGURATION — ${container.logConfiguration.why}`
      const secrets =
        container.secretNames.length > 0
          ? `secrets: ${container.secretNames.join(", ")}`
          : "no secrets declared"
      const plain =
        container.environmentNames.length > 0
          ? `plain-text env (names only): ${container.environmentNames.join(", ")}`
          : "no plain-text environment"
      return `${container.name} ${container.image ?? "image unstated"} · ${log} · ${secrets} · ${plain}`
    })
    .join(" | ")
  return (
    `${definition.family}:${definition.revision ?? "?"} · cpu ${definition.cpu ?? "unstated"} · ` +
    `memory ${definition.memory ?? "unstated"} · ${definition.networkMode ?? "network mode unstated"} · ${images}`
  )
}

/** One cluster's capacity as the sentence a surface prints. */
export function describeClusterDetail(read: AwsRead<ClusterDetail>): string {
  if (read.state !== "ACTUAL" && read.state !== "STALE") {
    return describeRead(read, "the cluster's capacity")
  }
  const detail = read.value
  return (
    `${detail.status ?? "status unstated"} · ${detail.registeredContainerInstancesCount ?? "unstated"} registered instance(s) · ` +
    `${detail.runningTasksCount ?? "unstated"} running / ${detail.pendingTasksCount ?? "unstated"} pending task(s) · ` +
    `${detail.activeServicesCount ?? "unstated"} active service(s) · ` +
    `capacity providers: ${detail.capacityProviders.length > 0 ? detail.capacityProviders.join(", ") : "none declared"}`
  )
}

/**
 * What a container surface prints.
 *
 * The route agent renders exactly these strings. The tests assert on them, which
 * is what makes the mutation proofs land on the production path rather than on a
 * helper nothing calls.
 */
export function containerLines(readings: ContainerReadings): readonly ContainerLine[] {
  const lines: ContainerLine[] = [
    {
      label: "Clusters",
      text:
        describeRead(
          readings.clusters,
          `ECS clusters read from AWS, refreshed every ${Math.round(readings.refreshMs.clusters / 1000)}s`,
        ) + describeTruncation(readings.truncation),
    },
    { label: "Fleet", text: describeFleetState(readings.fleet) },
  ]

  for (const finding of readings.credentialFindings) {
    lines.push({
      label: `Plain-text credential-shaped environment: ${finding.name}`,
      text: finding.why,
    })
  }

  if (readings.clusters.state === "ACTUAL" || readings.clusters.state === "STALE") {
    for (const cluster of readings.clusters.value) {
      lines.push({ label: cluster.name, text: describeClusterDetail(cluster.detail) })
      for (const failure of cluster.failures) {
        lines.push({
          label: `${cluster.name} failure`,
          text: `AWS returned a failure for ${failure.arn}: ${failure.reason}${failure.detail ? ` (${failure.detail})` : ""}`,
        })
      }
      if (cluster.services.state === "ACTUAL" || cluster.services.state === "STALE") {
        for (const service of cluster.services.value) {
          lines.push({
            label: `${cluster.name}/${service.name}`,
            text: `${describeCountGap(service.gap)} · ${describeTaskDefinition(service.taskDefinition)}`,
          })
        }
      } else {
        lines.push({
          label: `${cluster.name} services`,
          text: describeRead(cluster.services, `services in ${cluster.name}`) + describeTruncation(cluster.serviceTruncation),
        })
      }
      if (cluster.stoppedTasks.state === "ACTUAL" || cluster.stoppedTasks.state === "STALE") {
        for (const task of cluster.stoppedTasks.value) {
          lines.push({
            label: `${cluster.name} stopped task`,
            text:
              `${nameFromArn(task.arn)} (${task.group ?? "no group"}) ${describeStopCause(task.stopCause)}` +
              (task.containers.length > 0
                ? ` · exit codes: ${task.containers
                    .map((c) => `${c.name}=${c.exitCode === null ? "unreported" : c.exitCode}`)
                    .join(", ")}`
                : ""),
          })
        }
      } else {
        lines.push({
          label: `${cluster.name} stopped tasks`,
          text:
            describeRead(cluster.stoppedTasks, `tasks that stopped in ${cluster.name}`) +
            ` — ${cluster.stoppedWindow.why}` +
            describeTruncation(cluster.stoppedTaskTruncation),
        })
      }
    }
  }
  return lines
}
