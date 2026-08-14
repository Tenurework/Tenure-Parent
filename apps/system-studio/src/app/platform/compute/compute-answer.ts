/**
 * What `/platform/compute` says, decided as data rather than in JSX.
 *
 * ── The question, and why it needed a surface of its own ────────────────────
 *
 * "What is running, what is it running, and why did anything stop?"
 *
 * Until this route existed the third clause had no answer anywhere in the
 * console. `ecs:DescribeTasks` returns a `stoppedReason` on every task it has
 * retained — the single most valuable string this whole programme surfaces —
 * and nothing rendered it. A service that had been OOM-killed four times in an
 * hour and a service that was merely slow to start produced identical pixels:
 * a running count, and no explanation. `lib/aws/containers.ts` classifies that
 * string into `StopCause`; this module is what stops the classification being
 * thrown away one layer higher.
 *
 * ── Why this is a module and not a few ternaries in the page ────────────────
 *
 * The lead answer is an ORDER, and an order written as nested ternaries inside
 * a render is an order nothing can test. The order that matters here is the one
 * on line `computeAnswer` step 4: a fleet whose services are all at their
 * desired count is NOT a healthy fleet if tasks have been crash-looping under
 * it for the last hour. ECS replaces a task that dies, so a service that dies
 * every ninety seconds reports `running === desired` at almost every instant
 * somebody looks. A headline derived from the count alone reads "Steady" while
 * the estate is on fire, and that is exactly the composition this file exists
 * to make unreachable.
 *
 * Everything here is pure. No AWS client is constructed, no `server-only`
 * import, no React. It imports the readers' own vocabulary — `classifyStopReason`
 * already ran, `isIncident` already decided which stops are the system working
 * — because a second opinion about what an OOM kill means is two vocabularies
 * to keep in step. `compute-answer.test.ts` and `e2e/compute-page-logic.spec.ts`
 * drive every branch at the node level, with no browser and no estate.
 *
 * ── The three honest absences this file is careful about ────────────────────
 *
 *   1. A refused `ecs:DescribeTasks` is not "nothing stopped". `stoppedTaskRows`
 *      returns rows only from readings that answered, and `readFailures` names
 *      every one that did not so the page can render it through `UnknownState`.
 *   2. A digest that is in no repository this engine READ is not a digest from
 *      no repository. `registryIndex` carries `blind` — repositories whose image
 *      list was refused — and `correlationFor` refuses to say "no match" without
 *      naming them.
 *   3. Zero findings on an image in a repository with `scanOnPush` disabled is
 *      not a clean image. `countsFor` returns null for every arm of
 *      `ImageVulnerability` that is not a completed scan, so a zero cannot be
 *      printed where nothing looked.
 */

import {
  isIncident,
  nameFromArn,
  serviceOfTaskGroup,
  significantExitCode,
  type ClusterReading,
  type CountGap,
  type FleetState,
  type StopCause,
  type TaskDefinitionReading,
} from "../../../lib/aws/containers"
import {
  SEVERITIES,
  totalFindings,
  type EcrReadings,
  type ImageReading,
  type ImageVulnerability,
  type RepositoryReading,
  type ScanOnPush,
  type Severity,
  type SeverityCounts,
} from "../../../lib/aws/ecr"
import {
  describeRuntimeSupport,
  isRuntimeRisk,
  isRuntimeUnknown,
  type LambdaFunctionReading,
  type RuntimeSupport,
} from "../../../lib/aws/lambda"
import { describeRead, type AwsRead } from "../../../lib/aws/read"

/* ─────────────────────────────────────────────────────────────── tone ──── */

/** The tone vocabulary `components/md3/Badge.tsx` accepts. Loudness, not meaning. */
export type Tone = "neutral" | "info" | "ok" | "warn" | "bad"

/**
 * The arms of a reading that carry no value — what `UnknownState` renders.
 *
 * `Extract` over the real union rather than a hand-written list: if `read.ts`
 * gains a fifth valueless arm, every `switch` below stops compiling until this
 * file says what it looks like.
 */
export type UnknownArm = Extract<
  AwsRead<unknown>,
  { state: "DENIED" | "THROTTLED" | "UNCONFIGURED" | "ERROR" }
>

/** The unreadable arm of a reading, or null when it answered. */
export function unknownArm<T>(read: AwsRead<T>): UnknownArm | null {
  switch (read.state) {
    case "DENIED":
    case "THROTTLED":
    case "UNCONFIGURED":
    case "ERROR":
      return read
    default:
      return null
  }
}

/** Whether a reading carries a value this page may count. */
export function answered<T>(read: AwsRead<T>): read is Extract<AwsRead<T>, { state: "ACTUAL" | "STALE" }> {
  return read.state === "ACTUAL" || read.state === "STALE"
}

/* ─────────────────────────────────────────────────────────── as of ────── */

/**
 * The sentence a panel ends with.
 *
 * Every card on this page says when what it shows was true. A panel with no
 * as-of is a set of claims that were correct at some point, and an operator
 * cannot tell it from a tab that stopped refreshing.
 */
export function asOf(at: string | null): string {
  if (at === null || at.trim() === "") {
    return "As of an unknown time — nothing recorded when this was read."
  }
  return `As of ${at}.`
}

/** A panel's supporting line: what it is, then when it was true. */
export function statedAsOf(what: string, at: string | null): string {
  const trimmed = what.trim()
  const sentence = trimmed.endsWith(".") ? trimmed : `${trimmed}.`
  return `${sentence} ${asOf(at)}`
}

/* ──────────────────────────────────────────────── reads that did not ──── */

/** One reading this page needed and did not get, named where it would have gone. */
export interface ReadFailure {
  key: string
  /** The cluster, repository or account-level scope the read belonged to. */
  scope: string
  /** What was being read, in the operator's language. */
  what: string
  read: UnknownArm
}

/**
 * Every per-cluster reading that did not answer.
 *
 * Rendered rather than counted. A cluster whose `ecs:DescribeTasks` was refused
 * contributes NO rows to the stopped table, and without this list the page
 * would show an empty "why did anything stop" panel for an estate whose tasks
 * are stopping constantly.
 */
export function readFailures(clusters: AwsRead<readonly ClusterReading[]>): readonly ReadFailure[] {
  if (!answered(clusters)) return []
  const out: ReadFailure[] = []
  for (const cluster of clusters.value) {
    const add = (what: string, read: AwsRead<unknown>) => {
      const arm = unknownArm(read)
      if (arm) out.push({ key: `${cluster.arn}::${what}`, scope: cluster.name, what, read: arm })
    }
    add("this cluster's capacity and registered instances", cluster.detail)
    add("the services in this cluster", cluster.services)
    add("the tasks running in this cluster", cluster.runningTasks)
    add("the tasks that stopped in this cluster", cluster.stoppedTasks)
  }
  out.sort((a, b) => a.scope.localeCompare(b.scope) || a.what.localeCompare(b.what))
  return out
}

/* ──────────────────────────────────────────────────── why it stopped ──── */

/** One task that stopped, with the string that says why. */
export interface StoppedTaskRow {
  key: string
  cluster: string
  taskArn: string
  /** The task id, from the ARN. Present even when nothing else about it is. */
  taskName: string
  /** The service the task belonged to, from its `group`. Null for a standalone task. */
  service: string | null
  group: string | null
  stoppedAt: string | null
  startedAt: string | null
  cause: StopCause
  /**
   * ECS's own `stoppedReason`, verbatim, or null when ECS did not give one.
   *
   * Null and empty-string are deliberately different: the `unreported` arm of
   * `StopCause` means ECS said nothing, which is its own finding.
   */
  stoppedReason: string | null
  stopCode: string | null
  /** Every container's exit code, named — `app=137, sidecar=unreported`. */
  exitCodes: string
  /** The first non-zero container exit code, which is the one that matters. */
  exitCode: number | null
  /** Whether an operator has to act. `scaling` and `user-initiated` are not. */
  incident: boolean
  /** The digests this task was actually running, for the registry correlation. */
  digests: readonly string[]
}

/** ECS's own words for a stop, or null when it did not give any. */
export function rawStopReason(cause: StopCause): string | null {
  return "raw" in cause ? cause.raw : null
}

/** Every container's exit code, named, so an unreported one is visibly unreported. */
export function exitCodeLine(
  containers: readonly { name: string; exitCode: number | null }[],
): string {
  if (containers.length === 0) return "no container was reported for this task"
  return containers
    .map((container) => `${container.name}=${container.exitCode === null ? "unreported" : container.exitCode}`)
    .join(", ")
}

/**
 * Every stopped task in every cluster that answered, worst first.
 *
 * Incidents before benign stops, then most recently stopped first. A deployment
 * replacing forty tasks would otherwise bury the one that ran out of memory.
 */
export function stoppedTaskRows(
  clusters: AwsRead<readonly ClusterReading[]>,
): readonly StoppedTaskRow[] {
  if (!answered(clusters)) return []
  const rows: StoppedTaskRow[] = []
  for (const cluster of clusters.value) {
    if (!answered(cluster.stoppedTasks)) continue
    for (const task of cluster.stoppedTasks.value) {
      rows.push({
        key: `${cluster.arn}::${task.arn}`,
        cluster: cluster.name,
        taskArn: task.arn,
        taskName: nameFromArn(task.arn),
        service: serviceOfTaskGroup(task.group),
        group: task.group,
        stoppedAt: task.stoppedAt,
        startedAt: task.startedAt,
        cause: task.stopCause,
        stoppedReason: rawStopReason(task.stopCause),
        stopCode: task.stopCode,
        exitCodes: exitCodeLine(task.containers),
        exitCode: significantExitCode(task.containers),
        // The readers already decided which stops are the system working.
        // Deciding it a second time here would be a second vocabulary.
        incident: isIncident(task.stopCause),
        digests: task.containers
          .map((container) => container.imageDigest)
          .filter((digest): digest is string => typeof digest === "string" && digest.length > 0),
      })
    }
  }
  rows.sort((a, b) => {
    if (a.incident !== b.incident) return a.incident ? -1 : 1
    // Most recent first; a task with no stop time sorts last rather than first,
    // because an unstamped row at the top of the table is a row nobody can date.
    if (a.stoppedAt !== b.stoppedAt) {
      if (a.stoppedAt === null) return 1
      if (b.stoppedAt === null) return -1
      return a.stoppedAt < b.stoppedAt ? 1 : -1
    }
    return a.key.localeCompare(b.key)
  })
  return rows
}

/** What the stopped rows add up to. Counted from rows, never from a read state. */
export interface StoppedSummary {
  total: number
  /** Stops an operator has to act on. Includes `unreported` — see `isIncident`. */
  incidents: number
  /** Deployments and deliberate stops. The system working. */
  benign: number
  /** Distinct services with at least one incident stop, sorted. */
  servicesAffected: readonly string[]
}

export function stoppedSummary(rows: readonly StoppedTaskRow[]): StoppedSummary {
  const services = new Set<string>()
  let incidents = 0
  for (const row of rows) {
    if (!row.incident) continue
    incidents += 1
    services.add(row.service ?? `${row.cluster} (no service)`)
  }
  return {
    total: rows.length,
    incidents,
    benign: rows.length - incidents,
    servicesAffected: [...services].sort(),
  }
}

/* ────────────────────────────────────────────────────── the lead answer ── */

export type ComputeVerdict =
  | "Unknown"
  | "Not being placed"
  | "Short of tasks"
  | "Restarting"
  | "Unverified"
  | "Nothing deployed"
  | "Steady"

export interface ComputeAnswer {
  verdict: ComputeVerdict
  tone: Tone
  headline: string
  /** The second sentence, when there is one worth reading. */
  because: string | null
}

/**
 * The gap between desired and running, and whether anything has been dying.
 *
 * The order, and what each step is protecting against:
 *
 *   1. the cluster listing did not answer   — nothing below it is knowable, and
 *                                             an empty page is not a healthy one
 *   2. tasks are missing and NOTHING stopped — the scheduler is not placing them:
 *                                             capacity, subnet, capacity provider
 *   3. tasks are missing and something did   — the ordinary degraded case
 *   4. counts are met and tasks are dying    — THE ONE THIS MODULE EXISTS FOR.
 *                                             ECS replaces a dead task, so a
 *                                             crash-looping service reports
 *                                             running === desired at almost every
 *                                             instant. Without this step a fleet
 *                                             that has OOM-killed forty times in
 *                                             an hour reads "Steady".
 *   5. no gap reported and a read missing    — the absence of a reported gap is
 *                                             not evidence there is none
 *   6. there are no clusters                 — a fact about the estate, not health
 *   7. otherwise                             — steady, and it names the counts
 */
export function computeAnswer(fleet: FleetState, stopped: StoppedSummary): ComputeAnswer {
  if (fleet.kind === "unknown") {
    return {
      verdict: "Unknown",
      tone: "warn",
      headline:
        "Nothing is known about what is running. The cluster listing did not answer, so this page " +
        "cannot say whether anything is deployed, let alone whether it is healthy.",
      because: fleet.why,
    }
  }

  if (fleet.kind === "degraded" && fleet.unexplained > 0) {
    return {
      verdict: "Not being placed",
      tone: "bad",
      headline:
        `${fleet.unexplained} service(s) are short of tasks and nothing stopped to account for it. ` +
        "The scheduler is not placing them — capacity, subnet or capacity provider — rather than " +
        "tasks crashing.",
      because: unexplainedSentence(fleet),
    }
  }

  if (fleet.kind === "degraded") {
    return {
      verdict: "Short of tasks",
      tone: "bad",
      headline:
        `${fleet.services.length} service(s) are running fewer tasks than they were asked to run.`,
      because:
        stopped.incidents > 0
          ? `${stopped.incidents} task(s) stopped for a reason somebody has to act on in ECS's retention window. They are listed below with the reason ECS gave.`
          : "Every stop in the window is a deployment or a deliberate stop; the shortfall is listed per service below.",
    }
  }

  // Step 4. Not folded into the arm above: this is reachable while every service
  // is at its desired count, which is the whole point.
  if (stopped.incidents > 0) {
    return {
      verdict: "Restarting",
      tone: "bad",
      headline:
        `Every service that answered is at its desired count, and ${stopped.incidents} task(s) still ` +
        "stopped for a reason somebody has to act on. ECS replaces a task that dies, so a " +
        "crash-looping service reports its desired count at almost every instant somebody looks.",
      because:
        stopped.servicesAffected.length > 0
          ? `Affected: ${stopped.servicesAffected.join(", ")}.`
          : null,
    }
  }

  if (fleet.kind === "unverified") {
    return {
      verdict: "Unverified",
      tone: "warn",
      headline:
        `No service reported a gap, and ${fleet.unreadable.length} read(s) did not answer. A gap this ` +
        "engine could not look for is not a gap it did not find.",
      because: fleet.why,
    }
  }

  if (fleet.kind === "no-clusters") {
    return {
      verdict: "Nothing deployed",
      tone: "neutral",
      headline:
        "No ECS cluster exists in this region. Nothing is running here, which is a fact about the " +
        "estate and not a statement about its health.",
      because: null,
    }
  }

  return {
    verdict: "Steady",
    tone: "ok",
    headline:
      `${fleet.services} service(s) across ${fleet.clusters} cluster(s) are at their desired count, ` +
      `${fleet.runningTasks} task(s) running, and nothing stopped for a reason anybody has to act on ` +
      "inside ECS's retention window.",
    because:
      stopped.benign > 0
        ? `${stopped.benign} task(s) stopped in the window; every one of them was a deployment or a deliberate stop.`
        : null,
  }
}

/** The services whose shortfall nothing explains, named. */
function unexplainedSentence(fleet: Extract<FleetState, { kind: "degraded" }>): string | null {
  const names = fleet.services
    .filter((entry) => entry.gap.kind === "unexplained")
    .map((entry) => `${entry.cluster}/${entry.service}`)
  return names.length > 0 ? `Not being placed: ${names.join(", ")}.` : null
}

/* ─────────────────────────────────────────────── what each one runs ────── */

/** One container of one running task, and the digest it is actually running. */
export interface RunningContainer {
  containerName: string
  image: string | null
  /** The DIGEST. The only stable answer to "which build is this". */
  digest: string | null
  taskArn: string
}

/** One service, the revision it runs, and what that revision declares. */
export interface RunningServiceRow {
  key: string
  cluster: string
  service: string
  status: string | null
  gap: CountGap
  desired: number
  running: number
  /** The revision POINTER the service names. */
  taskDefinitionArn: string | null
  /** `tenure-app:41`, or null when the revision read did not answer. */
  revision: string | null
  /** Its own reading: a refused DescribeTaskDefinition does not collapse the row. */
  revisionRead: AwsRead<TaskDefinitionReading>
  /** Task-level cpu and memory as the revision declares them. Strings, as AWS returns. */
  cpu: string | null
  memory: string | null
  /** The digests actually running, from the tasks rather than from the revision. */
  containers: readonly RunningContainer[]
  /**
   * Plain-text `environment` entry NAMES that look like credentials.
   *
   * Names only. There is no value field anywhere on this path and there never
   * will be — `containers.ts` does not read `environment[].value` at all.
   */
  credentialNames: readonly string[]
}

/** `family:revision`, or null when the reading did not answer. */
export function revisionLabel(read: AwsRead<TaskDefinitionReading>): string | null {
  if (!answered(read)) return null
  const definition = read.value
  return definition.revision === null ? definition.family : `${definition.family}:${definition.revision}`
}

/**
 * Every service, with the revision it runs and the digests its tasks carry.
 *
 * The digests come from the RUNNING TASKS, not from the revision. A revision
 * names an image by tag, and `ecr.ts` explains at length why a tag is not an
 * identity in a registry whose repositories are `MUTABLE`. Only the task knows
 * which bytes are running.
 */
export function runningServiceRows(
  clusters: AwsRead<readonly ClusterReading[]>,
): readonly RunningServiceRow[] {
  if (!answered(clusters)) return []
  const rows: RunningServiceRow[] = []
  for (const cluster of clusters.value) {
    if (!answered(cluster.services)) continue
    const tasks = answered(cluster.runningTasks) ? cluster.runningTasks.value : []
    for (const service of cluster.services.value) {
      const containers: RunningContainer[] = []
      const seen = new Set<string>()
      for (const task of tasks) {
        if (serviceOfTaskGroup(task.group) !== service.name) continue
        for (const container of task.containers) {
          const key = `${container.name}::${container.imageDigest ?? container.image ?? ""}`
          if (seen.has(key)) continue
          seen.add(key)
          containers.push({
            containerName: container.name,
            image: container.image,
            digest: container.imageDigest,
            taskArn: task.arn,
          })
        }
      }
      containers.sort((a, b) => a.containerName.localeCompare(b.containerName))

      const definition = answered(service.taskDefinition) ? service.taskDefinition.value : null
      rows.push({
        key: `${cluster.arn}::${service.arn}`,
        cluster: cluster.name,
        service: service.name,
        status: service.status,
        gap: service.gap,
        desired: service.desiredCount ?? 0,
        running: service.runningCount ?? 0,
        taskDefinitionArn: service.taskDefinitionArn,
        revision: revisionLabel(service.taskDefinition),
        revisionRead: service.taskDefinition,
        cpu: definition?.cpu ?? null,
        memory: definition?.memory ?? null,
        containers,
        credentialNames: definition
          ? [...new Set(definition.credentialFindings.map((finding) => finding.name))].sort()
          : [],
      })
    }
  }
  rows.sort((a, b) => a.cluster.localeCompare(b.cluster) || a.service.localeCompare(b.service))
  return rows
}

/* ───────────────────────────────────────────────── the registry join ──── */

/** A repository and the image inside it that a digest resolved to. */
export interface RegistryMatch {
  repository: RepositoryReading
  image: ImageReading
}

/** Every digest the registry could be asked about, and what it could not be asked. */
export interface RegistryIndex {
  /** Whether `ecr:DescribeRepositories` itself answered. */
  known: boolean
  /** Why not, when it did not. Null when it did. */
  why: string | null
  byDigest: ReadonlyMap<string, RegistryMatch>
  /**
   * Repositories whose IMAGE list did not answer.
   *
   * A digest absent from `byDigest` may perfectly well live in one of these, so
   * `correlationFor` will not call it unmatched without naming them.
   */
  blind: readonly string[]
  /** Repositories where `scanOnPush` is off. Their silence proves nothing. */
  unscanned: readonly string[]
}

export function registryIndex(ecr: EcrReadings): RegistryIndex {
  if (!answered(ecr.repositories)) {
    return {
      known: false,
      why: describeRead(ecr.repositories, "the container registry"),
      byDigest: new Map(),
      blind: [],
      unscanned: [],
    }
  }
  const byDigest = new Map<string, RegistryMatch>()
  const blind: string[] = []
  const unscanned: string[] = []
  for (const repository of ecr.repositories.value) {
    if (repository.scanOnPush.kind !== "enabled") unscanned.push(repository.name)
    if (!answered(repository.images)) {
      // EMPTY is a real answer — the repository holds no image — and is not
      // blindness. Everything else is.
      if (repository.images.state !== "EMPTY") blind.push(repository.name)
      continue
    }
    for (const image of repository.images.value) {
      if (!byDigest.has(image.digest)) byDigest.set(image.digest, { repository, image })
    }
  }
  blind.sort()
  unscanned.sort()
  return { known: true, why: null, byDigest, blind, unscanned }
}

/** Whether a running digest could be traced back to a repository, and honestly. */
export type DigestCorrelation =
  /** Found, in this repository. */
  | { kind: "matched"; repositoryName: string }
  /** The registry listing did not answer, so no claim is made either way. */
  | { kind: "registry-unreadable"; why: string }
  /** Not in anything this engine could read, and it names what it could not read. */
  | { kind: "not-found"; why: string }

export function correlationFor(digest: string, index: RegistryIndex): DigestCorrelation {
  if (!index.known) {
    return {
      kind: "registry-unreadable",
      why: index.why ?? "the container registry did not answer",
    }
  }
  const match = index.byDigest.get(digest)
  if (match) return { kind: "matched", repositoryName: match.repository.name }
  if (index.blind.length > 0) {
    return {
      kind: "not-found",
      why:
        `this digest is in none of the repositories whose images were readable, and the image list of ` +
        `${index.blind.join(", ")} did not answer. It may be in one of those; this is not a statement ` +
        `that it came from outside this registry.`,
    }
  }
  return {
    kind: "not-found",
    why:
      "this digest is in none of the repositories in this registry. The image running here was " +
      "pushed somewhere else, or has since been expired by a lifecycle policy.",
  }
}

/**
 * The severity counts for an image, and null for every arm that is not a
 * completed scan.
 *
 * Null rather than `NO_FINDINGS`, and that is the whole point: a repository
 * with `scanOnPush` disabled has no findings because nothing looked, and a zero
 * rendered in that cell is the single most reassuring wrong number this page
 * could print.
 */
export function countsFor(vulnerability: ImageVulnerability): SeverityCounts | null {
  switch (vulnerability.kind) {
    case "findings":
      return vulnerability.counts
    case "clean":
      // A completed scan that returned nothing. The only arm that is a claim.
      return {
        CRITICAL: 0,
        HIGH: 0,
        MEDIUM: 0,
        LOW: 0,
        INFORMATIONAL: 0,
        UNDEFINED: 0,
      }
    case "not-scanned":
    case "scan-incomplete":
    case "unknown":
      return null
  }
}

/** One image that is actually running, and what the registry says about it. */
export interface DeployedImageRow {
  key: string
  digest: string
  /** `cluster/service (container)` for every place this digest is running. Sorted. */
  usedBy: readonly string[]
  correlation: DigestCorrelation
  repositoryName: string | null
  repositoryUri: string | null
  /** The tags on this digest. Zero is normal and is itself a fact. */
  tags: readonly string[]
  pushedAt: string | null
  scanOnPush: ScanOnPush | null
  /** True only when the repository answered and said scanning is off. */
  scanningOff: boolean
  vulnerability: ImageVulnerability | null
  counts: SeverityCounts | null
  total: number | null
}

/** Severity order for sorting. Worst first, and `UNDEFINED` is not "none". */
const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFORMATIONAL: 4,
  UNDEFINED: 5,
}

/** The worst severity with a non-zero count, or null when there is none. */
export function worstSeverity(counts: SeverityCounts | null): Severity | null {
  if (!counts) return null
  for (const severity of SEVERITIES) {
    if (counts[severity] > 0) return severity
  }
  return null
}

/**
 * Every digest that is actually running, joined to the repository it came from.
 *
 * Keyed by digest rather than by service, because one image is usually running
 * in several places and a CVE is a property of the bytes, not of the service.
 */
export function deployedImageRows(
  services: readonly RunningServiceRow[],
  index: RegistryIndex,
): readonly DeployedImageRow[] {
  const uses = new Map<string, string[]>()
  for (const service of services) {
    for (const container of service.containers) {
      if (!container.digest) continue
      const where = `${service.cluster}/${service.service} (${container.containerName})`
      const existing = uses.get(container.digest)
      if (existing) existing.push(where)
      else uses.set(container.digest, [where])
    }
  }

  const rows: DeployedImageRow[] = []
  for (const [digest, usedBy] of uses) {
    const correlation = correlationFor(digest, index)
    const match = index.byDigest.get(digest)
    const vulnerability = match ? match.image.vulnerability : null
    const counts = vulnerability ? countsFor(vulnerability) : null
    rows.push({
      key: digest,
      digest,
      usedBy: [...usedBy].sort(),
      correlation,
      repositoryName: match ? match.repository.name : null,
      repositoryUri: match ? match.repository.uri : null,
      tags: match ? match.image.tags : [],
      pushedAt: match ? match.image.pushedAt : null,
      scanOnPush: match ? match.repository.scanOnPush : null,
      scanningOff: match ? match.repository.scanOnPush.kind === "disabled" : false,
      vulnerability,
      counts,
      total: counts ? totalFindings(counts) : null,
    })
  }

  rows.sort((a, b) => {
    const aWorst = worstSeverity(a.counts)
    const bWorst = worstSeverity(b.counts)
    const aRank = aWorst === null ? SEVERITIES.length : SEVERITY_RANK[aWorst]
    const bRank = bWorst === null ? SEVERITIES.length : SEVERITY_RANK[bWorst]
    if (aRank !== bRank) return aRank - bRank
    // Then the ones nothing is known about, above the ones known to be clean:
    // an unscanned image is a question and a scanned one is an answer.
    const aKnown = a.counts === null ? 0 : 1
    const bKnown = b.counts === null ? 0 : 1
    if (aKnown !== bKnown) return aKnown - bKnown
    return a.digest.localeCompare(b.digest)
  })
  return rows
}

/** What the deployed images add up to, counted only from arms that are claims. */
export interface ImageSummary {
  digests: number
  /** Digests with at least one CRITICAL or HIGH finding. */
  vulnerable: number
  /** Digests in a repository that does not scan on push. */
  unscanned: number
  /** Digests whose findings are not knowable, for any reason. */
  unknown: number
  /** Digests that completed a scan with nothing in it. */
  clean: number
}

export function imageSummary(rows: readonly DeployedImageRow[]): ImageSummary {
  let vulnerable = 0
  let unscanned = 0
  let unknown = 0
  let clean = 0
  for (const row of rows) {
    if (row.scanningOff) unscanned += 1
    if (row.counts === null) {
      unknown += 1
      continue
    }
    if (row.counts.CRITICAL > 0 || row.counts.HIGH > 0) vulnerable += 1
    else if (totalFindings(row.counts) === 0) clean += 1
  }
  return { digests: rows.length, vulnerable, unscanned, unknown, clean }
}

/* ────────────────────────────────────────────────── lambda runtimes ───── */

/** One function whose runtime is deprecated, nearly deprecated, or unknowable. */
export interface RuntimeRow {
  key: string
  name: string
  arn: string
  runtime: string | null
  packageType: string
  support: RuntimeSupport
  /** The one renderer in `lambda.ts`, so this page cannot word it differently. */
  sentence: string
  status: RuntimeSupport["status"]
  memoryMb: number | null
  lastModified: string | null
}

/** Worst first: already past its date, then dated, then not knowable. */
const RUNTIME_RANK: Readonly<Record<RuntimeSupport["status"], number>> = {
  DEPRECATED: 0,
  APPROACHING: 1,
  UNKNOWN_RUNTIME: 2,
  UNKNOWN_STALE_CALENDAR: 3,
  SUPPORTED: 4,
  NOT_A_MANAGED_RUNTIME: 5,
}

/**
 * The functions an operator has to do something about, or cannot be sure about.
 *
 * `isRuntimeUnknown` is included beside `isRuntimeRisk`, and that is deliberate:
 * a runtime this engine's calendar has never heard of is not a supported one, and
 * a page that listed only the known-bad would report an estate of unrecognised
 * runtimes as having nothing to do.
 */
export function runtimeRows(
  functions: AwsRead<readonly LambdaFunctionReading[]>,
): readonly RuntimeRow[] {
  if (!answered(functions)) return []
  const rows: RuntimeRow[] = []
  for (const fn of functions.value) {
    if (!isRuntimeRisk(fn.runtimeSupport) && !isRuntimeUnknown(fn.runtimeSupport)) continue
    rows.push({
      key: fn.arn,
      name: fn.name,
      arn: fn.arn,
      runtime: fn.runtime,
      packageType: fn.packageType,
      support: fn.runtimeSupport,
      sentence: describeRuntimeSupport(fn.runtimeSupport),
      status: fn.runtimeSupport.status,
      memoryMb: fn.memoryMb,
      lastModified: fn.lastModified,
    })
  }
  rows.sort(
    (a, b) => RUNTIME_RANK[a.status] - RUNTIME_RANK[b.status] || a.name.localeCompare(b.name),
  )
  return rows
}

/** Every function by runtime verdict, counted only when the read answered. */
export interface RuntimeTally {
  known: boolean
  why: string | null
  total: number
  deprecated: number
  approaching: number
  unknown: number
  supported: number
  containerImages: number
}

export function runtimeTally(
  functions: AwsRead<readonly LambdaFunctionReading[]>,
): RuntimeTally {
  if (!answered(functions)) {
    return {
      known: false,
      why: describeRead(functions, "the Lambda functions in this account"),
      total: 0,
      deprecated: 0,
      approaching: 0,
      unknown: 0,
      supported: 0,
      containerImages: 0,
    }
  }
  let deprecated = 0
  let approaching = 0
  let unknown = 0
  let supported = 0
  let containerImages = 0
  for (const fn of functions.value) {
    switch (fn.runtimeSupport.status) {
      case "DEPRECATED":
        deprecated += 1
        break
      case "APPROACHING":
        approaching += 1
        break
      case "UNKNOWN_RUNTIME":
      case "UNKNOWN_STALE_CALENDAR":
        unknown += 1
        break
      case "SUPPORTED":
        supported += 1
        break
      case "NOT_A_MANAGED_RUNTIME":
        containerImages += 1
        break
    }
  }
  return {
    known: true,
    why: null,
    total: functions.value.length,
    deprecated,
    approaching,
    unknown,
    supported,
    containerImages,
  }
}

/** The sentence the Lambda card leads with. Never "0 deprecated" for a refusal. */
export function runtimeHeadline(tally: RuntimeTally): string {
  if (!tally.known) {
    return `Nothing is known about this account's Lambda runtimes — ${tally.why}`
  }
  if (tally.total === 0) {
    return "There is no Lambda function in this account, so no runtime can be out of support."
  }
  if (tally.deprecated === 0 && tally.approaching === 0 && tally.unknown === 0) {
    return (
      `All ${tally.total} function(s) are on a runtime AWS still supports` +
      (tally.containerImages > 0
        ? `, except ${tally.containerImages} container-image function(s) which have no managed runtime for AWS to deprecate — what is inside their base image is not readable from here.`
        : ".")
    )
  }
  const parts: string[] = []
  if (tally.deprecated > 0) parts.push(`${tally.deprecated} on a runtime AWS has already deprecated`)
  if (tally.approaching > 0) parts.push(`${tally.approaching} inside the deprecation horizon`)
  if (tally.unknown > 0) parts.push(`${tally.unknown} on a runtime this engine's calendar cannot place`)
  return `Of ${tally.total} function(s): ${parts.join(", ")}.`
}

/** The tone for one runtime verdict. Loudness — the WORD carries the meaning. */
export const RUNTIME_TONE: Readonly<Record<RuntimeSupport["status"], Tone>> = {
  DEPRECATED: "bad",
  APPROACHING: "warn",
  UNKNOWN_RUNTIME: "warn",
  UNKNOWN_STALE_CALENDAR: "warn",
  SUPPORTED: "ok",
  NOT_A_MANAGED_RUNTIME: "neutral",
}

/** The word beside the tone, so colour is never the only carrier. */
export const RUNTIME_WORD: Readonly<Record<RuntimeSupport["status"], string>> = {
  DEPRECATED: "Deprecated",
  APPROACHING: "Deprecating",
  UNKNOWN_RUNTIME: "Not in the calendar",
  UNKNOWN_STALE_CALENDAR: "Calendar too old",
  SUPPORTED: "Supported",
  NOT_A_MANAGED_RUNTIME: "Container image",
}

/** The tone for one stop, so a deployment does not print as loudly as an OOM kill. */
export const STOP_TONE: Readonly<Record<StopCause["kind"], Tone>> = {
  "out-of-memory": "bad",
  "health-check-failed": "bad",
  "essential-container-exited": "bad",
  "cannot-start": "bad",
  "initialisation-failed": "bad",
  "host-terminated": "warn",
  other: "warn",
  unreported: "warn",
  scaling: "neutral",
  "user-initiated": "neutral",
}

/** The short word for a stop cause. The sentence is `describeStopCause`. */
export const STOP_WORD: Readonly<Record<StopCause["kind"], string>> = {
  "out-of-memory": "Out of memory",
  "health-check-failed": "Health check",
  "essential-container-exited": "Exited",
  "cannot-start": "Could not start",
  "initialisation-failed": "Init failed",
  "host-terminated": "Host went away",
  other: "Unclassified",
  unreported: "Unreported",
  scaling: "Deployment",
  "user-initiated": "Stopped by hand",
}

/* ────────────────────────────────────────────────── where it came from ── */

export interface Provenance {
  label: string
  value: string
}

/**
 * The reads that produced this page, and the principal that made them.
 *
 * Every value is a string and every unknown is spelled out. Account, region and
 * partition come from the resolved identity and from nowhere else — this page
 * will not print an estate nobody resolved.
 */
export function provenanceOf(input: {
  identityLine: string
  clusters: AwsRead<unknown>
  repositories: AwsRead<unknown>
  functions: AwsRead<unknown>
  containersAsOf: string
  ecrAsOf: string
  lambdaAsOf: string
  refreshMs: { clusters: number; services: number; tasks: number; taskDefinition: number }
  calendarSource: string
  calendarAsOf: string
}): readonly Provenance[] {
  const seconds = (ms: number) => `${Math.round(ms / 1000)}s`
  return [
    { label: "Principal and estate", value: input.identityLine },
    {
      label: "ecs:ListClusters",
      value: `${describeRead(input.clusters, "the ECS clusters")} — re-read every ${seconds(input.refreshMs.clusters)}`,
    },
    {
      label: "ecs:DescribeServices / DescribeTasks / DescribeTaskDefinition",
      value:
        `services every ${seconds(input.refreshMs.services)}, tasks every ${seconds(input.refreshMs.tasks)}, ` +
        `task definitions every ${seconds(input.refreshMs.taskDefinition)} — a revision is immutable, which is why its window is the longest`,
    },
    { label: "Container reads assembled", value: input.containersAsOf },
    {
      label: "ecr:DescribeRepositories",
      value: describeRead(input.repositories, "the container registry"),
    },
    { label: "Registry read assembled", value: input.ecrAsOf },
    {
      label: "lambda:ListFunctions",
      value: describeRead(input.functions, "the Lambda functions in this account"),
    },
    { label: "Lambda read assembled", value: input.lambdaAsOf },
    {
      label: "Runtime deprecation calendar",
      value: `transcribed from ${input.calendarSource}, as of ${input.calendarAsOf}`,
    },
  ]
}
