/**
 * STUDIO-120-003 — observations of a system that is actually running.
 *
 * Before this, `lib/fleet-health.ts` derived every signal it had from two
 * fields: `state` and `updatedAt`. That is a report on the lifecycle *row*, not
 * on the tenant. A certificate can expire, an alarm can sit in ALARM for a day
 * and a backup can go unverified for a month while the row says `ACTIVE` and the
 * fleet page says nothing needs attention — and the estate this platform runs on
 * has exactly that problem today: `docs/architecture/aws-current-state.md`
 * records four certificates of which three are FAILED, a fact no per-tenant
 * surface has ever shown.
 *
 * ## Every source resolves to one of four statuses, and `unknown` is real
 *
 * Built on `readAws` (STUDIO-000-007), so a refused call arrives as `DENIED`
 * carrying the principal, the action, the account, the region and the minimum
 * IAM statement — and this module turns that into `unknown`, never into `ok` and
 * never into silence. The predecessor of that discipline is why it matters:
 * `tools/aws-inventory.mjs` returned `null` on failure and `/platform` rendered
 * the resulting empty alarm list as four green chips.
 *
 * An **absent** alarm is `unknown` for the same reason. "No alarm mentions this
 * tenant" is not "this tenant is healthy"; it is "nothing is watching it", and a
 * health view that scores it green is worse than one that says nothing.
 *
 * ## Where the tenant's own database is deliberately not
 *
 * `tests/security/operator-plane-content.test.mjs` forbids this console reaching
 * a cell's Postgres, so error rates and database health have to arrive as
 * CloudWatch metrics or not arrive. Two of the six sources are read from AWS,
 * one from the cell record the fleet already holds, and three report `unknown`
 * with the exact thing that would make them readable. That is the honest shape:
 * the gaps are rendered per tenant instead of being invisible.
 *
 * ## No `@aws-sdk` import
 *
 * Every call goes through the `AwsGateway` seam declared in `read.ts`, so this
 * module can be loaded — and proven — outside a server component, and
 * `tests/architecture/forbidden-clients.test.mjs` keeps the one client where it
 * is. Response shapes are declared here rather than imported for the same
 * reason `identity.ts` declares its own.
 */

import { ALARM_REFRESH_MS } from "./capabilities"
import {
  describeRead,
  isUnknown,
  itemsOf,
  liveGateway,
  readAws,
  type AwsGateway,
  type AwsRead,
  type DenialContext,
} from "./read"
import type { HealthObservation, ObservationSource } from "../fleet-health"

/*
 * The six readers the verdict below is composed from.
 *
 * `isIncident` and the `describe*` renderers are RUNTIME imports on purpose:
 * each of those modules already decided how its own facts are worded, and a
 * second wording composed here would be a second vocabulary for the same state
 * — the exact drift `read.ts`'s one-renderer rule exists against. Everything
 * else is `import type`, so the compiler erases it.
 *
 * None of the six imports `server-only` or an `@aws-sdk` package (each reaches
 * AWS through `liveGateway()`, which resolves `client.ts` lazily on first call),
 * so this module stays loadable — and provable — outside a server component.
 * `e2e/fleet-health-logic.spec.ts` already imports it at the node level and
 * `tests/architecture/forbidden-clients.test.mjs` keeps the one client where it
 * is.
 */
import type { AlarmSurface, AlarmVerdict } from "./alarms"
import type { AwsHealthSurface, HealthEventRow } from "./aws-health"
import { isIncident } from "./containers"
import type {
  ClusterReading,
  ContainerReadings,
  StopCause,
  TaskReading,
} from "./containers"
import type { DatabaseReadings, ScheduledMaintenance } from "./database"
import { describeServingState } from "./loadbalancer"
import type {
  LoadBalancerReading,
  LoadBalancerReadings,
  TargetGroupReading,
} from "./loadbalancer"
import { describeSummary } from "./metrics"
import type {
  MetricQuerySpec,
  MetricReadings,
  MetricSeries,
  MetricWindow,
} from "./metrics"

/* --------------------------------------------------------------- cadence -- */

/**
 * How long the fleet page may reuse one set of observations.
 *
 * Equal to the fastest source rather than a number of its own: alarm state is
 * what moves, and a page refreshed more often than the alarm read is a page
 * making AWS calls that cannot tell it anything new. Certificates renew on a
 * 60-day horizon and are re-read at this cadence only because they ride along in
 * the same pass.
 */
export const HEALTH_REFRESH_MS = ALARM_REFRESH_MS

/**
 * The longest a single observation call may hold the fleet page open.
 *
 * A console that hangs because AWS is slow is a console an operator cannot use
 * to find out that AWS is slow. Exceeding it produces `unknown` with the reason,
 * which is the correct answer to "is this tenant healthy" when nobody replied.
 */
export const OBSERVATION_TIMEOUT_MS = 4_000

/** Days inside which an unrenewed certificate stops being routine. */
export const TLS_WARN_DAYS = 14

/** Hours after which "the backup was verified" stops being reassuring. */
export const BACKUP_STALE_HOURS = 26

/* ------------------------------------------------------- response shapes -- */

/** The fields of an ACM certificate summary this module reads. */
export interface CertificateSummary {
  CertificateArn?: string
  DomainName?: string
  SubjectAlternativeNameSummaries?: string[]
  Status?: string
  NotAfter?: Date | string
  InUse?: boolean
}

/** The fields of a CloudWatch alarm this module reads. Metric and composite alike. */
export interface AlarmSummary {
  AlarmName?: string
  StateValue?: string
  StateUpdatedTimestamp?: Date | string
  ActionsEnabled?: boolean
  Dimensions?: Array<{ Name?: string; Value?: string }>
}

interface ListCertificatesResponse {
  CertificateSummaryList?: CertificateSummary[]
}

interface DescribeAlarmsResponse {
  MetricAlarms?: AlarmSummary[]
  CompositeAlarms?: AlarmSummary[]
}

/* --------------------------------------------------------- what to watch -- */

export interface ObservationTarget {
  slug: string
  /**
   * The host this tenant is served from, or null when the fleet cannot say.
   *
   * Null is not an error: it is what an operator needs to know before believing
   * a green TLS badge. A certificate observation for a host nobody can name is
   * an observation of the wrong thing.
   */
  host: string | null
  /** The cell this tenant runs on, used to match cell-wide alarms. */
  cellId: string | null
  /** What the cell record says about its own backups. */
  backup: { lastVerifiedAt: string | null; retentionDays: number } | null
}

export interface ObserveOptions {
  now?: Date
  /**
   * The door to AWS. Omit for the live one; pass `null` to state that no door is
   * open, which produces `unknown` rather than an attempted call.
   */
  gateway?: AwsGateway | null
  denial?: DenialContext
  timeoutMs?: number
}

/** Both readings one pass of the fleet needs, and when they were taken. */
export interface FleetReadings {
  at: number
  certificates: AwsRead<readonly CertificateSummary[]>
  alarms: AwsRead<readonly AlarmSummary[]>
}

/* --------------------------------------------------------------- the read -- */

class ObservationTimedOut extends Error {
  constructor(capability: string, ms: number) {
    super(`${capability} did not answer within ${ms}ms`)
    // Deliberately not one of read.ts's denial or throttle names: a timeout is
    // neither a permission problem nor a rate limit, and reporting it as either
    // sends an operator to the wrong place.
    this.name = "ObservationTimedOut"
  }
}

function withDeadline<T>(capability: string, run: () => Promise<T>, ms: number): () => Promise<T> {
  return async () => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        run(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new ObservationTimedOut(capability, ms)), ms)
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }
}

/**
 * Held between requests for `HEALTH_REFRESH_MS`.
 *
 * The fleet page renders one row per tenant and every row wants the same two
 * answers, so the calls are made once for the fleet rather than once per tenant
 * — twenty tenants must not be forty AWS calls. In memory and per container,
 * which is the same scope `result.ts` states for its rate counters and the same
 * honesty: one process is the whole fleet of this console.
 */
let held: FleetReadings | null = null

/** For tests, and for a page that has just been told the estate changed. */
export function __resetObservations(): void {
  held = null
}

/**
 * The two AWS reads the fleet needs, fresh or reused.
 *
 * Exported so a caller can hold them across a render tree — and so a test can
 * assert that the second call inside the window made no further AWS request.
 */
export async function fleetReadings(options: ObserveOptions = {}): Promise<FleetReadings> {
  const now = options.now ?? new Date()
  const stamp = now.getTime()
  if (held && stamp - held.at >= 0 && stamp - held.at < HEALTH_REFRESH_MS) return held

  const timeoutMs = options.timeoutMs ?? OBSERVATION_TIMEOUT_MS
  const gateway = options.gateway === undefined ? liveGateway() : options.gateway
  const readOptions = { now: () => now, denial: options.denial }

  if (gateway === null) {
    held = {
      at: stamp,
      certificates: {
        state: "UNCONFIGURED",
        capability: "acm:ListCertificates",
        why:
          "no AWS gateway is open in this process, so no certificate was read. This is the " +
          "state a caller asks for explicitly; it is never what a failed call returns.",
      },
      alarms: {
        state: "UNCONFIGURED",
        capability: "cloudwatch:DescribeAlarms",
        why: "no AWS gateway is open in this process, so no alarm state was read.",
      },
    }
    return held
  }

  const [certificates, alarms] = await Promise.all([
    readAws<readonly CertificateSummary[]>(
      "acm:ListCertificates",
      withDeadline(
        "acm:ListCertificates",
        async () => {
          const response = (await gateway.call("acm:ListCertificates")) as ListCertificatesResponse
          return response?.CertificateSummaryList ?? []
        },
        timeoutMs,
      ),
      readOptions,
    ),
    readAws<readonly AlarmSummary[]>(
      "cloudwatch:DescribeAlarms",
      withDeadline(
        "cloudwatch:DescribeAlarms",
        async () => {
          const response = (await gateway.call("cloudwatch:DescribeAlarms")) as DescribeAlarmsResponse
          // Both kinds in one list. A composite alarm is usually the one wired
          // to the on-call rota, and a metric-only read reports the estate as
          // healthier than it is.
          return [...(response?.MetricAlarms ?? []), ...(response?.CompositeAlarms ?? [])]
        },
        timeoutMs,
      ),
      readOptions,
    ),
  ])

  held = { at: stamp, certificates, alarms }
  return held
}

/* ------------------------------------------------------------- the mapping -- */

function observation(
  source: ObservationSource,
  status: HealthObservation["status"],
  now: Date,
  detail: string,
): HealthObservation {
  return { source, status, asOf: now.toISOString(), detail }
}

/** Whether a certificate's domain or a SAN covers a host, wildcards included. */
export function certificateCovers(pattern: string | undefined, host: string): boolean {
  if (!pattern) return false
  const name = pattern.toLowerCase()
  const target = host.toLowerCase()
  if (name === target) return true
  if (!name.startsWith("*.")) return false
  // `*.example.com` covers `a.example.com` and NOT `a.b.example.com`, which is
  // what TLS actually does. A suffix test would report a wildcard as covering a
  // host no browser would accept it for.
  const suffix = name.slice(1)
  if (!target.endsWith(suffix)) return false
  return !target.slice(0, target.length - suffix.length).includes(".")
}

/** ACM's vocabulary for a certificate that will never serve traffic. */
const DEAD_CERTIFICATE = new Set(["FAILED", "EXPIRED", "REVOKED", "VALIDATION_TIMED_OUT", "INACTIVE"])

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * What the certificates say about one host.
 *
 * Pure, and separated from the call so the arithmetic is provable without a
 * network: the interesting cases are an expiry that has passed, one inside the
 * warning window, and a host every certificate has FAILED validation for —
 * which is the live estate's actual state for `app.tenurework.com`.
 */
export function certificateObservation(
  host: string | null,
  read: AwsRead<readonly CertificateSummary[]>,
  now: Date,
): HealthObservation {
  if (host === null) {
    return observation(
      "tls",
      "unknown",
      now,
      "the fleet cannot say which host serves this tenant, so no certificate was checked. " +
        "Set CELL_BASE_URL on the cell, or place the tenant on a cell that declares one.",
    )
  }

  if (read.state !== "ACTUAL" && read.state !== "STALE" && read.state !== "EMPTY") {
    return observation("tls", "unknown", now, describeRead(read, `certificates covering ${host}`))
  }

  const covering = itemsOf(read).filter(
    (c) =>
      certificateCovers(c.DomainName, host) ||
      (c.SubjectAlternativeNameSummaries ?? []).some((n) => certificateCovers(n, host)),
  )

  if (covering.length === 0) {
    return observation(
      "tls",
      "degraded",
      now,
      `no certificate in this account covers ${host}. It may be terminated somewhere this role ` +
        `cannot see, which is itself worth knowing — a host nobody can produce a certificate for ` +
        `is one nobody can prove is served over TLS.`,
    )
  }

  const issued = covering.filter((c) => c.Status === "ISSUED")

  if (issued.length === 0) {
    const dead = covering.filter((c) => DEAD_CERTIFICATE.has(String(c.Status)))
    const statuses = [...new Set(covering.map((c) => c.Status ?? "unstated"))].join(", ")
    if (dead.length === covering.length) {
      return observation(
        "tls",
        "failing",
        now,
        `every certificate covering ${host} is unusable (${statuses}). Nothing here can terminate ` +
          `TLS for this tenant.`,
      )
    }
    return observation(
      "tls",
      "degraded",
      now,
      `no issued certificate covers ${host} yet (${statuses}).`,
    )
  }

  const expiries = issued
    .map((c) => (c.NotAfter instanceof Date ? c.NotAfter.getTime() : Date.parse(String(c.NotAfter))))
    .filter((t) => !Number.isNaN(t))

  if (expiries.length === 0) {
    return observation(
      "tls",
      "degraded",
      now,
      `${issued.length} issued certificate(s) cover ${host}, and none of them reported an expiry. ` +
        `An expiry that cannot be read cannot be watched.`,
    )
  }

  // The one that runs out first. Taking the latest would report a host as safe
  // for a year because a second certificate exists that nothing is serving.
  const soonest = Math.min(...expiries)
  const days = (soonest - now.getTime()) / DAY_MS

  if (days <= 0) {
    return observation(
      "tls",
      "failing",
      now,
      `the certificate for ${host} expired ${Math.abs(Math.round(days))} day(s) ago.`,
    )
  }
  if (days <= TLS_WARN_DAYS) {
    return observation(
      "tls",
      "degraded",
      now,
      `the certificate for ${host} expires in ${Math.round(days)} day(s) and has not renewed. ` +
        `ACM renews at 60 days, so this one is not renewing on its own.`,
    )
  }
  return observation("tls", "ok", now, `${host} is covered to ${new Date(soonest).toISOString().slice(0, 10)}.`)
}

/** Whether an alarm is about this tenant, or about the cell it runs on. */
export function alarmMentions(alarm: AlarmSummary, scope: { slug: string; cellId: string | null }): boolean {
  const needles = [scope.slug, scope.cellId].filter((n): n is string => !!n).map((n) => n.toLowerCase())
  const name = (alarm.AlarmName ?? "").toLowerCase()
  if (needles.some((n) => name.includes(n))) return true
  return (alarm.Dimensions ?? []).some((d) =>
    needles.some((n) => (d.Value ?? "").toLowerCase().includes(n)),
  )
}

/**
 * What CloudWatch says about one tenant.
 *
 * The two mappings that carry the whole point of this function:
 *
 *   * `INSUFFICIENT_DATA` is `unknown`, not `ok`. An alarm that has never
 *     received a data point is an alarm that has never been able to fire, and
 *     scoring it green means the console is greenest exactly where the metric
 *     pipeline is broken.
 *   * No matching alarm at all is `unknown`, not `ok`. "Nothing is watching this
 *     tenant" and "everything watching this tenant is happy" are opposite facts.
 */
export function alarmObservation(
  scope: { slug: string; cellId: string | null },
  read: AwsRead<readonly AlarmSummary[]>,
  now: Date,
): HealthObservation {
  if (read.state !== "ACTUAL" && read.state !== "STALE" && read.state !== "EMPTY") {
    return observation("alarm", "unknown", now, describeRead(read, `alarms for ${scope.slug}`))
  }

  const mine = itemsOf(read).filter((a) => alarmMentions(a, scope))

  if (mine.length === 0) {
    return observation(
      "alarm",
      "unknown",
      now,
      `no alarm names ${scope.slug}${scope.cellId ? ` or ${scope.cellId}` : ""}, so nothing is ` +
        `watching it. An absent alarm is not a healthy one.`,
    )
  }

  const firing = mine.filter((a) => a.StateValue === "ALARM")
  if (firing.length > 0) {
    return observation(
      "alarm",
      "failing",
      now,
      `${firing.length} of ${mine.length} alarm(s) firing: ${firing
        .map((a) => a.AlarmName ?? "unnamed")
        .join(", ")}.`,
    )
  }

  const blind = mine.filter((a) => a.StateValue === "INSUFFICIENT_DATA")
  if (blind.length > 0) {
    return observation(
      "alarm",
      "unknown",
      now,
      `${blind.length} of ${mine.length} alarm(s) have no data (${blind
        .map((a) => a.AlarmName ?? "unnamed")
        .join(", ")}). An alarm with no data has never been able to fire.`,
    )
  }

  const silent = mine.filter((a) => a.ActionsEnabled === false)
  if (silent.length > 0) {
    return observation(
      "alarm",
      "degraded",
      now,
      `${silent.length} of ${mine.length} alarm(s) are OK but have their actions disabled, so ` +
        `nobody is paged when they move.`,
    )
  }

  return observation("alarm", "ok", now, `${mine.length} alarm(s) watching, all OK.`)
}

/**
 * What the cell record says about its last verified backup.
 *
 * No AWS call: `lib/cells.ts` already holds `backup.lastVerifiedAt`, and it is
 * already null by default with the comment explaining why — "we have never
 * verified a backup" and "we verified one at some unknown time" are different,
 * and only one of them should be reassuring. This is what turns that null into
 * something a tenant row shows.
 */
export function backupObservation(
  cell: { cellId: string | null; lastVerifiedAt: string | null; retentionDays: number } | null,
  now: Date,
): HealthObservation {
  if (cell === null) {
    return observation(
      "backup",
      "unknown",
      now,
      "the fleet cannot say which cell holds this tenant, so no backup record was read.",
    )
  }
  if (!cell.lastVerifiedAt) {
    return observation(
      "backup",
      "unknown",
      now,
      `no backup has ever been recorded as verified for ${cell.cellId ?? "this cell"}. ` +
        `Set CELL_LAST_BACKUP_AT from a restore test — a snapshot that exists is not a backup ` +
        `that restores (STUDIO-120-006).`,
    )
  }

  const at = Date.parse(cell.lastVerifiedAt)
  if (Number.isNaN(at)) {
    return observation(
      "backup",
      "unknown",
      now,
      `CELL_LAST_BACKUP_AT is set to "${cell.lastVerifiedAt}", which is not a timestamp.`,
    )
  }

  const hours = (now.getTime() - at) / (60 * 60 * 1000)
  if (hours > cell.retentionDays * 24) {
    return observation(
      "backup",
      "failing",
      now,
      `the last verified backup is ${Math.round(hours / 24)} day(s) old, past the ${cell.retentionDays}-day ` +
        `retention window — every point that was verified has aged out, so there may be nothing to restore.`,
    )
  }
  if (hours > BACKUP_STALE_HOURS) {
    return observation(
      "backup",
      "degraded",
      now,
      `the last verified backup is ${Math.round(hours)} hours old.`,
    )
  }
  return observation("backup", "ok", now, `verified ${Math.round(hours)} hours ago.`)
}

/**
 * The three sources this control plane cannot read yet, reported rather than
 * omitted.
 *
 * Each says what is missing and what would fix it. That is the difference this
 * requirement is about: a gap an operator can see on the tenant's own row is a
 * gap somebody closes, and a gap that renders as nothing is one nobody knows
 * about. None of these is a placeholder for a value — there is no value, and
 * saying so is the observation.
 */
export function unreadableSources(now: Date): readonly HealthObservation[] {
  const curConfigured = !!process.env.FINOPS_CUR_BUCKET && !!process.env.FINOPS_CUR_PREFIX
  return [
    observation(
      "queue-age",
      "unknown",
      now,
      "the age of the oldest queued work is not read: no sqs:GetQueueAttributes capability is " +
        "declared in lib/aws/capabilities.ts and the task role is not granted it. The estate's " +
        "queues are tenure-pilot-default, tenure-pilot-email and their dead-letter pairs.",
    ),
    observation(
      "cost-anomaly",
      "unknown",
      now,
      curConfigured
        ? "a Cost and Usage Report is configured but no reader is implemented yet " +
            "(STUDIO-120-008), so per-tenant spend cannot be compared against its own trend."
        : "no Cost and Usage Report is connected — FINOPS_CUR_BUCKET and FINOPS_CUR_PREFIX are " +
            "unset — so per-tenant spend cannot be compared against its own trend.",
    ),
    observation(
      "drift",
      "unknown",
      now,
      "drift is not read: it needs the resource graph of STUDIO-080-001 and either " +
        "CloudFormation drift detection or an AWS Config aggregator, and neither exists.",
    ),
  ]
}

/**
 * Everything observed about one tenant, from readings already taken.
 *
 * Pure: the calls happen once per fleet in `fleetReadings`, and this derives
 * each tenant's view from them. Six observations, always — a source that could
 * not be read is present and `unknown`, never absent, because an absent source
 * is indistinguishable from a healthy one on a page.
 */
export function observationsFor(
  target: ObservationTarget,
  readings: FleetReadings,
  now: Date,
): readonly HealthObservation[] {
  return [
    certificateObservation(target.host, readings.certificates, now),
    alarmObservation({ slug: target.slug, cellId: target.cellId }, readings.alarms, now),
    backupObservation(
      target.backup === null
        ? null
        : {
            cellId: target.cellId,
            lastVerifiedAt: target.backup.lastVerifiedAt,
            retentionDays: target.backup.retentionDays,
          },
      now,
    ),
    ...unreadableSources(now),
  ]
}

/**
 * One pass of the fleet: two AWS reads, then a view per tenant.
 *
 * This is what `app/tenants/page.tsx` calls before `healthOf`, and it is the
 * reason the number of AWS calls is a property of the console rather than of how
 * many tenants exist.
 */
export async function observeFleet(
  targets: readonly ObservationTarget[],
  options: ObserveOptions = {},
): Promise<ReadonlyMap<string, readonly HealthObservation[]>> {
  const now = options.now ?? new Date()
  const readings = await fleetReadings({ ...options, now })
  const out = new Map<string, readonly HealthObservation[]>()
  for (const target of targets) out.set(target.slug, observationsFor(target, readings, now))
  return out
}

/* ==========================================================================
 *  The fleet-health verdict — STUDIO-080-008 / STUDIO-000-007 at estate scale
 * ========================================================================== */

/**
 * One verdict over six readers, and the reason it is one function.
 *
 * `alarms.ts` decided that a DISABLED alarm outranks an OK one. `answer.ts`
 * decided the same thing for the alarm TABLE on `/platform/health`. Neither of
 * them can decide it across the estate, because neither of them can see the
 * other five sources — and each of the rules below was bought by a defect that
 * only shows up when they are read together:
 *
 *  1. **AWS first.** An open, account-specific AWS Health event against a
 *     service this estate uses OUTRANKS our own alarms. Our alarms are symptoms
 *     and are structurally incapable of telling a bad deploy from an AWS-side
 *     impairment; an operator who reads them first spends an hour proving it is
 *     not us. The question "is it us" is answered before the question "what is
 *     firing", not after it.
 *  2. **A muted alarm outranks OK.** An alarm with `ActionsEnabled === false`
 *     will never tell anybody anything. A verdict that renders an estate of
 *     muted alarms as healthy is the most reassuring lie this console can tell,
 *     and it is the same lie one row up that `alarms.ts` already forbids.
 *  3. **Zero healthy targets outranks an alarm that has not fired.** The target
 *     group IS the outage; the alarm is a threshold somebody chose, on a delay
 *     somebody chose, and "no alarm has fired yet" is a statement about the
 *     alarm rather than about the service. `no-targets` and `none-serving` are
 *     both zero healthy targets and both rank here.
 *  4. **A metric with NO DATA is not a healthy metric.** `metrics.ts` keeps
 *     `no-datapoints` and `not-read` apart precisely so nothing downstream can
 *     average them into a number. A series that published nothing is a finding,
 *     and it is NEVER rendered as `0`.
 *  5. **A denied or throttled read degrades the verdict to "cannot say".** It
 *     never degrades it to OK, and it never disappears. Every unreadable source
 *     lands in `couldNotSee` carrying `describeRead`'s sentence — the principal,
 *     the action, the error code and the pasteable minimum statement — so the
 *     remedy is on the page with the gap.
 *
 * ── Falsifiability ──────────────────────────────────────────────────────────
 *
 * `basedOn` names every source that answered and what it contributed;
 * `couldNotSee` names every one that did not and why. `HEALTHY` is reachable
 * ONLY when `findings` and `couldNotSee` are both empty and at least one source
 * produced something, so a green light always carries the list of things that
 * would have to be wrong for it to be wrong. A verdict that cannot be checked
 * is a verdict nobody should act on.
 *
 * ── Purity, and why the shape is additive ──────────────────────────────────
 *
 * `fleetHealthVerdict` takes readings and returns a verdict. It makes no call,
 * holds no state and reads no clock it was not handed. Nothing above it in this
 * file changed: `FleetReadings`, `ObservationTarget`, `ObserveOptions`,
 * `observationsFor` and `observeFleet` have the fields and signatures they had,
 * because `app/tenants/page.tsx`, `app/tenants/[slug]/page.tsx`,
 * `app/tenants/fleet-view.ts` and `app/tenants/fleet-view.test.ts` construct and
 * consume them, and a field quietly added to a shared type is invisible at every
 * call site that omits it.
 */

/** The six readers this verdict is composed from. */
export type VerdictSource =
  | "aws-health"
  | "alarms"
  | "metrics"
  | "loadbalancer"
  | "containers"
  | "database"

/**
 * The verdict, worst first.
 *
 * Six arms rather than a traffic light, because "AWS is having an incident",
 * "we are having one", "one is scheduled", "nothing would tell us if we were"
 * and "we were not allowed to look" are five different mornings and exactly one
 * of them is the one a colour would collapse them all into.
 */
export const VERDICT_LEVELS = [
  "AWS_INCIDENT",
  "OUR_INCIDENT",
  "SCHEDULED",
  "UNTRUSTED",
  "CANNOT_SAY",
  "HEALTHY",
] as const

export type VerdictLevel = (typeof VERDICT_LEVELS)[number]

/** A word per level. Bible §26.3.2: never colour alone. */
export const LEVEL_WORDS: Readonly<Record<VerdictLevel, string>> = {
  AWS_INCIDENT: "AWS, not us",
  OUR_INCIDENT: "Broken now",
  SCHEDULED: "Breaks on a date",
  UNTRUSTED: "Nothing would tell us",
  CANNOT_SAY: "Cannot say",
  HEALTHY: "Healthy",
}

/**
 * How bad each level is. Lower is worse; `HEALTHY` is last.
 *
 * `UNTRUSTED` sits ABOVE `CANNOT_SAY` deliberately. A muted alarm is a fact this
 * console established; a denied read is a question it could not ask. Ranking the
 * question above the fact would bury a known defect under an unknown one — and
 * `CANNOT_SAY` is never lost either way, because every unreadable source is in
 * `couldNotSee` regardless of which level wins.
 */
function levelIndex(level: VerdictLevel): number {
  return VERDICT_LEVELS.indexOf(level)
}

function worseOf(a: VerdictLevel, b: VerdictLevel): VerdictLevel {
  return levelIndex(a) <= levelIndex(b) ? a : b
}

/**
 * Every kind of thing this verdict can find, in the order an operator meets it.
 *
 * The array IS the ranking — the ordering rules above are this list, so a
 * reviewer checks the rules by reading it rather than by tracing a comparator.
 */
export const FINDING_KINDS = [
  /* 1. AWS first. */
  "aws-health-affecting-us",
  "aws-health-open-service-in-use",
  /* 3. The outage itself, before the threshold somebody chose. */
  "no-healthy-targets",
  /* Then our own symptoms. */
  "alarm-firing",
  "service-short-of-tasks",
  "tasks-stopped-for-incident",
  "targets-not-serving",
  /* Then what breaks on a date. */
  "database-interrupting-maintenance",
  "aws-health-upcoming",
  "database-pending-maintenance",
  /* 2. Then everything that would fail to tell anybody. */
  "alarm-actions-disabled",
  "alarm-missing",
  /* 4. A metric that published nothing, which is not a zero. */
  "metric-no-data",
  "alarm-no-data",
  "alarm-stale",
  "nothing-watching",
] as const

export type FindingKind = (typeof FINDING_KINDS)[number]

/**
 * The level each finding carries.
 *
 * A total `Record`, so a kind added to `FINDING_KINDS` and forgotten here stops
 * this file compiling rather than silently scoring as the best available level.
 */
export const FINDING_LEVEL: Readonly<Record<FindingKind, VerdictLevel>> = {
  "aws-health-affecting-us": "AWS_INCIDENT",
  "aws-health-open-service-in-use": "AWS_INCIDENT",
  "no-healthy-targets": "OUR_INCIDENT",
  "alarm-firing": "OUR_INCIDENT",
  "service-short-of-tasks": "OUR_INCIDENT",
  "tasks-stopped-for-incident": "OUR_INCIDENT",
  "targets-not-serving": "OUR_INCIDENT",
  "database-interrupting-maintenance": "SCHEDULED",
  "aws-health-upcoming": "SCHEDULED",
  "database-pending-maintenance": "SCHEDULED",
  "alarm-actions-disabled": "UNTRUSTED",
  "alarm-missing": "UNTRUSTED",
  "metric-no-data": "UNTRUSTED",
  "alarm-no-data": "UNTRUSTED",
  "alarm-stale": "UNTRUSTED",
  "nothing-watching": "UNTRUSTED",
}

function findingRank(kind: FindingKind): number {
  const at = FINDING_KINDS.indexOf(kind)
  // A kind not in the list sorts LAST rather than first. Sorting an
  // unclassified finding to the top would put a row nobody has ranked above an
  // AWS incident.
  return at === -1 ? FINDING_KINDS.length : at
}

export interface VerdictFinding {
  kind: FindingKind
  source: VerdictSource
  /** What it is about: an alarm name, a target-group ARN, a metric key. */
  subject: string
  /** The sentence a surface prints. Composed once, so two surfaces cannot differ. */
  why: string
}

/** A source that answered, and what it contributed to the verdict. */
export interface VerdictBasis {
  source: VerdictSource
  what: string
}

/**
 * A source that did not answer, and why.
 *
 * `why` carries `describeRead`'s sentence verbatim for a real read, which means
 * a denial arrives with the principal, the action, the error code and a
 * pasteable minimum IAM statement. It is never shortened to "unavailable".
 */
export interface VerdictBlindSpot {
  source: VerdictSource
  /**
   * Whether the reader was never run, or ran and did not answer.
   *
   * Two different sentences for an operator: "nobody asked" is a hole in this
   * pass, and "we asked and were refused" is a hole in the IAM policy. Carried
   * as a field rather than inferred from `why`, so `observeFleetHealth` can
   * REPLACE a "not-consulted" entry when the reader turns out to have been run
   * and thrown — leaving both would have this verdict claiming a reader was
   * never called on the same line as the stack that proves it was.
   */
  kind: "not-consulted" | "unreadable"
  /** What could not be seen, in the operator's language. */
  what: string
  why: string
}

export interface FleetHealthVerdict {
  level: VerdictLevel
  /** The sentence the page leads with. One funnel, so a gap cannot read as calm. */
  headline: string
  /** Worst first, by `FINDING_KINDS`. */
  findings: readonly VerdictFinding[]
  /** What the verdict IS based on. Empty means nothing answered. */
  basedOn: readonly VerdictBasis[]
  /** What it could NOT see. Non-empty forbids `HEALTHY`. */
  couldNotSee: readonly VerdictBlindSpot[]
  /**
   * The AWS Health service codes this estate was SHOWN to use, from resources
   * the other readers actually returned. Empty is "we could not establish what
   * this estate runs on", which is why an open public event then lands in
   * `couldNotSee` instead of being scored either way.
   */
  servicesInUse: readonly string[]
  asOf: string
}

/**
 * The six readings, each explicitly present or explicitly absent.
 *
 * Every field is REQUIRED and nullable rather than optional. A caller that has
 * not run a reader must say so by writing `null`, because an optional field a
 * caller omits is invisible to `tsc` — and a source silently missing from this
 * object is a source silently missing from the verdict, which is the failure the
 * whole thing exists against. `null` is treated as a blind spot, never as OK.
 */
export interface FleetHealthSources {
  alarms: AlarmSurface | null
  awsHealth: AwsHealthSurface | null
  loadBalancers: LoadBalancerReadings | null
  containers: ContainerReadings | null
  database: DatabaseReadings | null
  metrics: MetricReadings | null
}

/** The sentence a `null` source produces. Named once so every arm words it alike. */
function notConsulted(source: VerdictSource): VerdictBlindSpot {
  return {
    source,
    kind: "not-consulted",
    what: `everything ${source} would have said`,
    why:
      `this pass did not run the ${source} reader, so nothing it reports was taken into account. ` +
      `That is a gap in the verdict, not a clean result from it.`,
  }
}

/* ------------------------------------------------------ what we run on -- */

/**
 * CloudWatch namespaces to the service codes AWS Health uses.
 *
 * Only the namespaces whose mapping is unambiguous. A namespace absent from
 * this table contributes nothing rather than a guess: attributing an AWS
 * incident to the wrong service is worse than not attributing it.
 */
export const METRIC_NAMESPACE_SERVICE: Readonly<Record<string, string>> = {
  "AWS/ApplicationELB": "ELASTICLOADBALANCING",
  "AWS/NetworkELB": "ELASTICLOADBALANCING",
  "AWS/ELB": "ELASTICLOADBALANCING",
  "AWS/ECS": "ECS",
  "AWS/RDS": "RDS",
  "AWS/EC2": "EC2",
}

/**
 * AWS's word for an event that is not scoped to one service.
 *
 * It matches whatever this estate runs on, because that is what it means. A
 * verdict that required an exact service-code match would drop the broadest
 * events AWS publishes.
 */
export const MULTIPLE_SERVICES = "MULTIPLE_SERVICES"

/**
 * Which AWS services this estate was SHOWN to use — from resources that were
 * actually returned, never from a list somebody typed.
 *
 * A denied reader contributes nothing here, which is the point: the empty set
 * means "we could not establish what this estate runs on", and the AWS Health
 * arm below then refuses to rule an open public event in OR out.
 */
export function servicesInUse(sources: FleetHealthSources): readonly string[] {
  const out = new Set<string>()

  if (sources.loadBalancers && itemsOf(sources.loadBalancers.loadBalancers).length > 0) {
    out.add("ELASTICLOADBALANCING")
  }
  if (sources.containers && itemsOf(sources.containers.clusters).length > 0) {
    out.add("ECS")
  }
  if (sources.database && itemsOf(sources.database.instances).length > 0) {
    out.add("RDS")
  }
  if (sources.alarms && !isUnknown(sources.alarms.read) && sources.alarms.rows.length > 0) {
    out.add("CLOUDWATCH")
  }
  for (const series of sources.metrics ? itemsOf(sources.metrics.series) : []) {
    const mapped = METRIC_NAMESPACE_SERVICE[series.namespace]
    if (mapped) out.add(mapped)
  }
  return [...out].sort()
}

/* ------------------------------------------------------- the six arms -- */

/** What one arm produced. Assembled by `fleetHealthVerdict`, never rendered raw. */
interface ArmResult {
  findings: readonly VerdictFinding[]
  basedOn: readonly VerdictBasis[]
  couldNotSee: readonly VerdictBlindSpot[]
}

const NOTHING: ArmResult = { findings: [], basedOn: [], couldNotSee: [] }

/** Alarm verdicts this arm turns into findings, and the finding each becomes. */
const ALARM_FINDING: Readonly<Partial<Record<AlarmVerdict, FindingKind>>> = {
  ALARM: "alarm-firing",
  // Rule 2. Checked as its own kind rather than folded into "not OK", because a
  // muted alarm is the one state that reads as healthy on every other surface.
  DISABLED: "alarm-actions-disabled",
  MISSING: "alarm-missing",
  INSUFFICIENT_DATA: "alarm-no-data",
  STALE: "alarm-stale",
}

function alarmArm(surface: AlarmSurface | null): ArmResult {
  if (surface === null) return { ...NOTHING, couldNotSee: [notConsulted("alarms")] }

  if (isUnknown(surface.read)) {
    return {
      findings: [],
      basedOn: [],
      couldNotSee: [
        {
          source: "alarms",
          kind: "unreadable",
          what: "the alarm state of this whole estate",
          why: describeRead(surface.read, "every alarm in this account"),
        },
      ],
    }
  }

  const findings: VerdictFinding[] = []
  const couldNotSee: VerdictBlindSpot[] = []

  for (const row of surface.rows) {
    // The two synthetic rows `alarms.ts` produces for a surface it could not
    // read. `alarmSurface()` only ever emits them alongside a read the branch
    // above has already returned on, so today they cannot arrive here from that
    // producer — but this arm takes an `AlarmSurface`, not a call, and any other
    // producer of that type can pair an answered read with an unreadable row.
    // Falling through to the map below would give such a row no finding and no
    // gap, which is a row that reads as a healthy alarm. `health.test.ts` drives
    // this branch directly for that reason.
    if (row.verdict === "UNAUTHORIZED" || row.verdict === "UNREADABLE") {
      couldNotSee.push({
        source: "alarms",
        kind: "unreadable",
        what: `the state of ${row.name}`,
        why: row.detail,
      })
      continue
    }
    const kind = ALARM_FINDING[row.verdict]
    if (!kind) continue
    findings.push({ kind, source: "alarms", subject: row.name, why: row.detail })
  }

  if (surface.rows.length === 0) {
    // A SUCCESSFUL read of zero alarms. Not an absence of problems — an absence
    // of anything that would report one.
    findings.push({
      kind: "nothing-watching",
      source: "alarms",
      subject: "this account",
      why:
        "cloudwatch:DescribeAlarms answered, and there is not one alarm in this account. " +
        "Nothing here can report that anything is wrong, so nothing below is evidence that " +
        "nothing is.",
    })
  }

  return {
    findings,
    basedOn: [
      {
        source: "alarms",
        what: `${surface.rows.length} alarm(s) read — ${surface.headline}`,
      },
    ],
    couldNotSee,
  }
}

/** Whether an AWS Health event names a service this estate was shown to use. */
export function touchesServiceInUse(
  event: Pick<HealthEventRow, "service">,
  inUse: readonly string[],
): boolean {
  const service = (event.service ?? "").toUpperCase()
  if (service === MULTIPLE_SERVICES) return inUse.length > 0
  return inUse.includes(service)
}

function awsHealthArm(surface: AwsHealthSurface | null, inUse: readonly string[]): ArmResult {
  if (surface === null) return { ...NOTHING, couldNotSee: [notConsulted("aws-health")] }

  if (isUnknown(surface.events)) {
    return {
      findings: [],
      basedOn: [],
      couldNotSee: [
        {
          source: "aws-health",
          kind: "unreadable",
          what: "whether AWS is having an incident — the whole 'is it us' half of the question",
          why: describeRead(surface.events, "open and upcoming AWS Health events"),
        },
      ],
    }
  }

  const findings: VerdictFinding[] = []
  const couldNotSee: VerdictBlindSpot[] = []

  for (const row of surface.rows) {
    switch (row.verdict) {
      case "AFFECTING_US":
        // Rule 1, in its strongest form: AWS has already told us this event
        // names resources in THIS account. No comparison improves on that.
        findings.push({
          kind: "aws-health-affecting-us",
          source: "aws-health",
          subject: row.arn,
          why:
            `${row.eventTypeCode} (${row.service}, ${row.region}) — ${row.detail} ` +
            `${row.entitiesKnown ? `AWS names ${row.entities.length} of our resource(s)${row.tenants.length > 0 ? `, across tenant(s) ${row.tenants.join(", ")}` : ""}.` : row.entitiesDetail}`,
        })
        break
      case "UPCOMING":
        findings.push({
          kind: "aws-health-upcoming",
          source: "aws-health",
          subject: row.arn,
          why: `${row.eventTypeCode} (${row.service}, ${row.region}) — ${row.detail}`,
        })
        break
      case "OPEN_IN_OUR_REGION":
        if (touchesServiceInUse(row, inUse)) {
          findings.push({
            kind: "aws-health-open-service-in-use",
            source: "aws-health",
            subject: row.arn,
            why:
              `${row.eventTypeCode} is open against ${row.service} in ${row.region}, and this estate ` +
              `was shown to use ${row.service === MULTIPLE_SERVICES ? inUse.join(", ") : row.service}. ` +
              `${row.detail} AWS has NOT raised it against this account, so it is not proof our ` +
              `symptoms are theirs — it is the first thing to rule in or out.`,
          })
        } else if (inUse.length === 0) {
          // We cannot rule it in or out, so we say so rather than dropping it.
          couldNotSee.push({
            source: "aws-health",
            kind: "unreadable",
            what: `whether the open ${row.service} event ${row.eventTypeCode} touches this estate`,
            why:
              `it is open in ${row.region}, and no reader in this pass returned a resource, so this ` +
              `engine could not establish which AWS services this estate runs on. Neither ruled in ` +
              `nor ruled out.`,
          })
        }
        break
      case "OPEN_REGION_UNKNOWN":
        couldNotSee.push({
          source: "aws-health",
          kind: "unreadable",
          what: `whether the open ${row.service} event ${row.eventTypeCode} is in this estate's region`,
          why: row.detail,
        })
        break
      case "OPEN_ELSEWHERE":
      case "NOTIFICATION":
        break
      case "UNAUTHORIZED":
        couldNotSee.push({ source: "aws-health", kind: "unreadable", what: "AWS Health", why: row.detail })
        break
    }
    // An account-specific event whose affected entities could not be read: the
    // blast radius is unknown, and `entities.length` would print 0.
    if (row.verdict === "AFFECTING_US" && !row.entitiesKnown) {
      couldNotSee.push({
        source: "aws-health",
        kind: "unreadable",
        what: `which of our resources ${row.eventTypeCode} affects`,
        why: row.entitiesDetail,
      })
    }
  }

  return {
    findings,
    basedOn: [{ source: "aws-health", what: `${surface.rows.length} AWS Health event(s) — ${surface.headline}` }],
    couldNotSee,
  }
}

/** Every target group across every load balancer, with the load balancer it is under. */
function targetGroupsOf(
  readings: LoadBalancerReadings,
): { lb: LoadBalancerReading; group: TargetGroupReading }[] {
  const out: { lb: LoadBalancerReading; group: TargetGroupReading }[] = []
  for (const lb of itemsOf(readings.loadBalancers)) {
    for (const group of itemsOf(lb.targetGroups)) out.push({ lb, group })
  }
  return out
}

function loadBalancerArm(readings: LoadBalancerReadings | null): ArmResult {
  if (readings === null) return { ...NOTHING, couldNotSee: [notConsulted("loadbalancer")] }

  if (isUnknown(readings.loadBalancers)) {
    return {
      findings: [],
      basedOn: [],
      couldNotSee: [
        {
          source: "loadbalancer",
          kind: "unreadable",
          what: "whether anything at all is being served",
          why: describeRead(readings.loadBalancers, "every load balancer in this account"),
        },
      ],
    }
  }

  const findings: VerdictFinding[] = []
  const couldNotSee: VerdictBlindSpot[] = []

  for (const lb of itemsOf(readings.loadBalancers)) {
    if (isUnknown(lb.targetGroups)) {
      couldNotSee.push({
        source: "loadbalancer",
        kind: "unreadable",
        what: `the target groups behind ${lb.name ?? lb.arn}`,
        why: describeRead(lb.targetGroups, `target groups of ${lb.name ?? lb.arn}`),
      })
    }
  }

  for (const { lb, group } of targetGroupsOf(readings)) {
    const under = `${group.name ?? group.arn} behind ${lb.name ?? lb.arn}`
    switch (group.serving.kind) {
      case "no-targets":
      case "none-serving":
        // Rule 3. Both arms are zero healthy targets; `describeServingState`
        // keeps "nothing registered" and "everything refused" apart in words.
        findings.push({
          kind: "no-healthy-targets",
          source: "loadbalancer",
          subject: group.arn,
          why:
            `${under} has NO healthy target — ${describeServingState(group.serving)}. ` +
            `A request routed here has nowhere to go. This is the outage itself, not a ` +
            `threshold somebody chose, so it does not wait for an alarm to agree.`,
        })
        break
      case "degraded":
        findings.push({
          kind: "targets-not-serving",
          source: "loadbalancer",
          subject: group.arn,
          why: `${under} — ${describeServingState(group.serving)}`,
        })
        break
      case "unknown":
        couldNotSee.push({
          source: "loadbalancer",
          kind: "unreadable",
          what: `whether ${under} is serving anything`,
          why: describeServingState(group.serving),
        })
        break
      case "all-serving":
        break
    }
  }

  if (readings.truncation.kind === "truncated") {
    couldNotSee.push({
      source: "loadbalancer",
      kind: "unreadable",
      what: "the load balancers past this engine's page budget",
      why: `${readings.truncation.why} (${readings.truncation.pagesRead} page(s) read; there were more).`,
    })
  }

  const groups = targetGroupsOf(readings)
  return {
    findings,
    basedOn: [
      {
        source: "loadbalancer",
        what:
          `${itemsOf(readings.loadBalancers).length} load balancer(s) and ${groups.length} target group(s) ` +
          `read as of ${readings.asOf}`,
      },
    ],
    couldNotSee,
  }
}

/** Stopped tasks grouped by the cause ECS gave, incidents only. */
function incidentStops(
  tasks: readonly TaskReading[],
): { cause: StopCause; count: number; taskArns: readonly string[] }[] {
  const byKind = new Map<string, { cause: StopCause; taskArns: string[] }>()
  for (const task of tasks) {
    // `isIncident` is containers.ts's own decision: a deployment replacing tasks
    // and an operator stopping one are the system working. Re-deciding it here
    // would be two answers to one question.
    if (!isIncident(task.stopCause)) continue
    const existing = byKind.get(task.stopCause.kind)
    if (existing) existing.taskArns.push(task.arn)
    else byKind.set(task.stopCause.kind, { cause: task.stopCause, taskArns: [task.arn] })
  }
  return [...byKind.values()]
    .map((group) => ({
      cause: group.cause,
      count: group.taskArns.length,
      taskArns: [...group.taskArns].sort(),
    }))
    .sort((a, b) => b.count - a.count || a.cause.kind.localeCompare(b.cause.kind))
}

function containerArm(readings: ContainerReadings | null): ArmResult {
  if (readings === null) return { ...NOTHING, couldNotSee: [notConsulted("containers")] }

  if (isUnknown(readings.clusters)) {
    return {
      findings: [],
      basedOn: [],
      couldNotSee: [
        {
          source: "containers",
          kind: "unreadable",
          what: "whether the container fleet is running what it was asked to run",
          why: describeRead(readings.clusters, "every ECS cluster in this account"),
        },
      ],
    }
  }

  const findings: VerdictFinding[] = []
  const couldNotSee: VerdictBlindSpot[] = []
  const clusters: readonly ClusterReading[] = itemsOf(readings.clusters)

  switch (readings.fleet.kind) {
    case "degraded":
      for (const short of readings.fleet.services) {
        findings.push({
          kind: "service-short-of-tasks",
          source: "containers",
          subject: `${short.cluster}/${short.service}`,
          why:
            `${short.service} on ${short.cluster} is running ${short.gap.running} of ${short.gap.desired} ` +
            `task(s)${short.gap.kind === "unexplained" ? ` and NOTHING stopped in the window — ${short.gap.why}` : ""}.`,
        })
      }
      for (const name of readings.fleet.unreadable) {
        couldNotSee.push({
          source: "containers",
          kind: "unreadable",
          what: `the task counts behind ${name}`,
          why: "the read that would have explained this service's gap did not answer.",
        })
      }
      break
    case "unverified":
      couldNotSee.push({
        source: "containers",
        kind: "unreadable",
        what: `whether the ${readings.fleet.servicesConsidered} service(s) read are actually at their desired count`,
        why: `${readings.fleet.why} Unread: ${readings.fleet.unreadable.join(", ") || "none named"}.`,
      })
      break
    case "unknown":
      couldNotSee.push({
        source: "containers",
        kind: "unreadable",
        what: "the container fleet",
        why: readings.fleet.why,
      })
      break
    case "no-clusters":
    case "steady":
      break
  }

  for (const cluster of clusters) {
    if (isUnknown(cluster.stoppedTasks)) {
      couldNotSee.push({
        source: "containers",
        kind: "unreadable",
        what: `why anything stopped on ${cluster.name}`,
        why: describeRead(cluster.stoppedTasks, `stopped tasks on ${cluster.name}`),
      })
      continue
    }
    for (const stop of incidentStops(itemsOf(cluster.stoppedTasks))) {
      findings.push({
        kind: "tasks-stopped-for-incident",
        source: "containers",
        subject: `${cluster.name}:${stop.cause.kind}`,
        why:
          `${stop.count} task(s) on ${cluster.name} stopped with cause ${stop.cause.kind} — ` +
          `${stop.cause.kind === "unreported" ? stop.cause.why : stop.cause.raw}. ` +
          `First: ${stop.taskArns[0]}. ${cluster.stoppedWindow.why}`,
      })
    }
    if (cluster.stoppedTaskTruncation.kind === "truncated") {
      couldNotSee.push({
        source: "containers",
        kind: "unreadable",
        what: `the stopped tasks on ${cluster.name} past this engine's page budget`,
        why: cluster.stoppedTaskTruncation.why,
      })
    }
  }

  if (readings.truncation.kind === "truncated") {
    couldNotSee.push({
      source: "containers",
      kind: "unreadable",
      what: "the clusters past this engine's page budget",
      why: readings.truncation.why,
    })
  }

  return {
    findings,
    basedOn: [
      {
        source: "containers",
        what: `${clusters.length} ECS cluster(s) read as of ${readings.asOf}; fleet state ${readings.fleet.kind}`,
      },
    ],
    couldNotSee,
  }
}

/** One line per scheduled maintenance action, worded from RDS's own fields. */
function maintenanceWhy(item: ScheduledMaintenance): string {
  return (
    `${item.action.action} on ${item.instanceId}` +
    `${item.action.description ? ` — ${item.action.description}` : ""}. ` +
    `${item.action.why} Opt-in status: ${item.action.optInStatus ?? "nobody has opted in"}.`
  )
}

function databaseArm(readings: DatabaseReadings | null): ArmResult {
  if (readings === null) return { ...NOTHING, couldNotSee: [notConsulted("database")] }

  if (isUnknown(readings.instances)) {
    return {
      findings: [],
      basedOn: [],
      couldNotSee: [
        {
          source: "database",
          kind: "unreadable",
          what: "whether anything is scheduled to take a database offline",
          why: describeRead(readings.instances, "every RDS instance in this account"),
        },
      ],
    }
  }

  const findings: VerdictFinding[] = []
  const couldNotSee: VerdictBlindSpot[] = []

  switch (readings.outage.kind) {
    case "pending": {
      for (const item of readings.outage.interrupting) {
        findings.push({
          kind: "database-interrupting-maintenance",
          source: "database",
          subject: item.instanceId,
          why: `RESTARTS THE DATABASE: ${maintenanceWhy(item)}`,
        })
      }
      const interrupting = new Set(readings.outage.interrupting)
      for (const item of readings.outage.actions) {
        if (interrupting.has(item)) continue
        findings.push({
          kind: "database-pending-maintenance",
          source: "database",
          subject: item.instanceId,
          why: maintenanceWhy(item),
        })
      }
      for (const name of readings.outage.unreadable) {
        couldNotSee.push({
          source: "database",
          kind: "unreadable",
          what: `pending maintenance on ${name}`,
          why: "this instance's maintenance read did not answer, so nothing is claimed about it.",
        })
      }
      break
    }
    case "none":
      for (const name of readings.outage.unreadable) {
        couldNotSee.push({
          source: "database",
          kind: "unreadable",
          what: `pending maintenance on ${name}`,
          why:
            "no maintenance was reported for the instances that answered, and this one did not. " +
            "It is not covered by that 'none'.",
        })
      }
      break
    case "unknown":
      couldNotSee.push({
        source: "database",
        kind: "unreadable",
        what: "whether anything is scheduled to take a database offline",
        why: readings.outage.why,
      })
      break
  }

  if (isUnknown(readings.pendingMaintenance)) {
    couldNotSee.push({
      source: "database",
      kind: "unreadable",
      what: "the account-wide pending-maintenance list",
      why: describeRead(readings.pendingMaintenance, "pending maintenance actions"),
    })
  }

  return {
    findings,
    basedOn: [
      {
        source: "database",
        what:
          `${itemsOf(readings.instances).length} RDS instance(s) read as of ${readings.asOf}; ` +
          `scheduled outage ${readings.outage.kind}`,
      },
    ],
    couldNotSee,
  }
}

function metricArm(readings: MetricReadings | null): ArmResult {
  if (readings === null) return { ...NOTHING, couldNotSee: [notConsulted("metrics")] }

  if (isUnknown(readings.series)) {
    return {
      findings: [],
      basedOn: [],
      couldNotSee: [
        {
          source: "metrics",
          kind: "unreadable",
          what: "the numbers behind every alarm on this estate",
          why: describeRead(readings.series, "the metric series this pass asked for"),
        },
      ],
    }
  }

  const findings: VerdictFinding[] = []
  const couldNotSee: VerdictBlindSpot[] = []
  const series: readonly MetricSeries[] = itemsOf(readings.series)

  for (const one of series) {
    switch (one.summary.kind) {
      case "no-datapoints":
        // Rule 4. This is NOT a zero, and the sentence says so, because the one
        // thing a surface must never do with it is render it as one.
        findings.push({
          kind: "metric-no-data",
          source: "metrics",
          subject: one.key,
          why:
            `${one.namespace}/${one.metricName} published NO datapoint in the window ` +
            `${readings.window.startIso} to ${readings.window.endIso} — ${describeSummary(one.summary)}. ` +
            `This is not a value of zero: the metric reported nothing, and a chart drawing a zero ` +
            `here would invent the one number nobody measured.`,
        })
        break
      case "not-read":
        couldNotSee.push({
          source: "metrics",
          kind: "unreadable",
          what: `${one.namespace}/${one.metricName} (${one.key})`,
          why: describeSummary(one.summary),
        })
        break
      case "datapoints":
        if (one.status.kind === "partial") {
          couldNotSee.push({
            source: "metrics",
            kind: "unreadable",
            what: `the whole of ${one.namespace}/${one.metricName} (${one.key})`,
            why: `${one.status.why} Every statistic on this series is over a prefix of the window.`,
          })
        }
        break
    }
  }

  for (const batch of readings.unreadableBatches) {
    couldNotSee.push({
      source: "metrics",
      kind: "unreadable",
      what: `metric batch ${batch.batch}, carrying ${batch.keys.join(", ")}`,
      why: batch.why,
    })
  }

  if (readings.truncation.kind === "more-available") {
    couldNotSee.push({
      source: "metrics",
      kind: "unreadable",
      what: `the rest of ${readings.truncation.keys.join(", ")}`,
      why: readings.truncation.why,
    })
  }

  return {
    findings,
    basedOn: [
      {
        source: "metrics",
        what:
          `${series.length} metric series read over ${readings.window.startIso}..${readings.window.endIso} ` +
          `in ${readings.cost.requests} request(s)`,
      },
    ],
    couldNotSee,
  }
}

/* ------------------------------------------------------- the composition -- */

export interface VerdictOptions {
  now?: Date
  /**
   * Gaps the CALLER knows about that no reading can express.
   *
   * `observeFleetHealth` puts a reader that threw here: it hands the composition
   * `null` for that source, and `null` alone would be reported as "this pass did
   * not run it", which is false — it was run and it threw. A `kind:
   * "unreadable"` entry for a source REPLACES the `kind: "not-consulted"` entry
   * the composition wrote for it.
   *
   * These travel through the SAME level computation as every other gap rather
   * than being merged into a finished verdict afterwards. The version of this
   * that patched the result had a second `worseOf` in it that no state could
   * reach, so a mutation switching it off survived — a guard that cannot fail is
   * a guard that is not there.
   */
  alsoCouldNotSee?: readonly VerdictBlindSpot[]
}

/**
 * One ranked verdict over six readers.
 *
 * Pure. Every number, name and sentence in the result comes from a reading that
 * was passed in; nothing here invents a resource, a count or a date.
 */
export function fleetHealthVerdict(
  sources: FleetHealthSources,
  options: VerdictOptions = {},
): FleetHealthVerdict {
  const now = options.now ?? new Date()
  const inUse = servicesInUse(sources)

  const arms: readonly ArmResult[] = [
    // Order here is only the order the lists are assembled in; the RANKING is
    // `FINDING_KINDS`, applied by the sort below. Two orderings would be two
    // answers to "what is worst".
    awsHealthArm(sources.awsHealth, inUse),
    loadBalancerArm(sources.loadBalancers),
    alarmArm(sources.alarms),
    containerArm(sources.containers),
    databaseArm(sources.database),
    metricArm(sources.metrics),
  ]

  const findings = arms
    .flatMap((arm) => arm.findings)
    // Stable within a rank, so two identical estates produce identical output.
    .sort((a, b) => findingRank(a.kind) - findingRank(b.kind))
  const basedOn = arms.flatMap((arm) => arm.basedOn)

  const supplied = options.alsoCouldNotSee ?? []
  const superseded = new Set(supplied.map((gap) => gap.source))
  const couldNotSee = [
    ...arms
      .flatMap((arm) => arm.couldNotSee)
      // See `VerdictOptions.alsoCouldNotSee`: the caller's specific reason for a
      // source replaces this module's generic "nobody asked" for the same one.
      .filter((gap) => !(gap.kind === "not-consulted" && superseded.has(gap.source))),
    ...supplied,
  ]

  const worstFinding = findings.reduce<VerdictLevel>(
    (worst, finding) => worseOf(worst, FINDING_LEVEL[finding.kind]),
    "HEALTHY",
  )

  // Rule 5. A gap NEVER resolves to OK. `HEALTHY` needs three things at once:
  // no finding, no gap, and at least one source that actually answered.
  const level: VerdictLevel =
    basedOn.length === 0
      ? "CANNOT_SAY"
      : couldNotSee.length > 0
        ? worseOf(worstFinding, "CANNOT_SAY")
        : worstFinding

  return {
    level,
    headline: verdictHeadline(level, findings, basedOn, couldNotSee),
    findings,
    basedOn,
    couldNotSee,
    servicesInUse: inUse,
    asOf: now.toISOString(),
  }
}

/**
 * The sentence the page leads with.
 *
 * It always names what the verdict is based on and how much it could not see —
 * including, and especially, when it is `HEALTHY`. A green light that does not
 * carry its own evidence is one nobody can falsify.
 */
export function verdictHeadline(
  level: VerdictLevel,
  findings: readonly VerdictFinding[],
  basedOn: readonly VerdictBasis[],
  couldNotSee: readonly VerdictBlindSpot[],
): string {
  const sources = basedOn.map((b) => b.source).join(", ")
  const gaps =
    couldNotSee.length === 0
      ? "Nothing in this pass went unread."
      : `${couldNotSee.length} thing(s) could not be read: ${couldNotSee
          .map((b) => `${b.source} — ${b.what}`)
          .join("; ")}.`

  if (basedOn.length === 0) {
    return (
      `${LEVEL_WORDS.CANNOT_SAY} — not one of the six readers answered, so this console knows ` +
      `nothing about the estate right now. ${gaps} Nothing here is a claim that anything is healthy.`
    )
  }

  if (findings.length === 0) {
    return level === "HEALTHY"
      ? `${LEVEL_WORDS.HEALTHY} — ${sources} all answered and none of them reported anything. ${gaps} ` +
          `That is what this is based on; if any of it is wrong, so is this sentence.`
      : `${LEVEL_WORDS[level]} — nothing was reported broken by ${sources}, and that is not the same ` +
          `as healthy. ${gaps}`
  }

  const worst = findings[0]
  return (
    `${LEVEL_WORDS[level]} — ${worst.why} ` +
    `${findings.length} finding(s) in total, worst first, from ${sources}. ${gaps}`
  )
}

/* -------------------------------------------------- reading the six live -- */

/**
 * The six reads, behind an interface, so the composition above can be driven
 * without an estate.
 *
 * Every method is REQUIRED. A seventh reader added to `FleetHealthSources`
 * breaks every construction site of this interface at compile time, which is the
 * point: a source that quietly stops being read is a source that quietly stops
 * being in the verdict.
 */
export interface FleetHealthReaders {
  alarms(): Promise<AlarmSurface>
  awsHealth(): Promise<AwsHealthSurface>
  loadBalancers(): Promise<LoadBalancerReadings>
  containers(): Promise<ContainerReadings>
  database(): Promise<DatabaseReadings>
  metrics(specs: readonly MetricQuerySpec[], window: MetricWindow): Promise<MetricReadings>
}

/**
 * The production readers, resolved lazily.
 *
 * `await import` for the same reason `read.ts`'s `liveGateway` uses it: these
 * six modules are large and only two of this file's callers want any of them, so
 * the graph is paid for in the request that asks rather than at module load.
 */
export function liveReaders(
  gateway?: AwsGateway,
  options: { now?: () => Date } = {},
): FleetHealthReaders {
  const now = options.now
  return {
    async alarms() {
      const { alarmSurface } = await import("./alarms")
      return alarmSurface(gateway, { now })
    },
    async awsHealth() {
      const { awsHealthSurface } = await import("./aws-health")
      return awsHealthSurface(gateway, { now })
    },
    async loadBalancers() {
      const { loadBalancerReadings } = await import("./loadbalancer")
      return loadBalancerReadings(gateway, { now })
    },
    async containers() {
      const { containerReadings } = await import("./containers")
      return containerReadings(gateway, { now })
    },
    async database() {
      const { databaseReadings } = await import("./database")
      return databaseReadings(gateway, { now })
    },
    async metrics(specs, window) {
      const { metricReadings } = await import("./metrics")
      return metricReadings(specs, window, gateway, { now })
    },
  }
}

/**
 * A reader that threw, turned into a source that is explicitly absent.
 *
 * The readers are written not to throw — every AWS failure arrives through
 * `readAws` as a state — but a reader that has not landed, or one that breaks on
 * a shape AWS has not returned before, must not take the whole verdict down and
 * must not silently vanish from it. `null` here becomes a `couldNotSee` entry
 * carrying the error, which is the honest answer.
 */
async function attempt<T>(
  source: VerdictSource,
  run: () => Promise<T>,
  failures: VerdictBlindSpot[],
): Promise<T | null> {
  try {
    return await run()
  } catch (error) {
    failures.push({
      source,
      kind: "unreadable",
      what: `everything ${source} would have said`,
      why:
        `the ${source} reader threw before it could answer: ` +
        `${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}. ` +
        `Nothing it would have reported is in this verdict.`,
    })
    return null
  }
}

export interface FleetHealthOptions {
  /** Injected in tests. Production passes nothing and gets `liveReaders`. */
  readers?: FleetHealthReaders
  /** The door to AWS, when `readers` is not supplied. */
  gateway?: AwsGateway
  /**
   * The window the metric reads cover, or `null` to state that none was chosen.
   *
   * Required and nullable, never optional: `metrics.ts` refuses to invent a
   * window because "an unbounded window is how one page becomes a line on the
   * bill", and a caller that has not chosen one must say so rather than have a
   * default chosen for it. `null` makes metrics a blind spot, not an OK.
   */
  metricWindow: MetricWindow | null
  /**
   * The metrics to read. Named by the caller for the same reason as the window.
   * Empty with a window is treated as "no metric was asked for".
   */
  metricQueries?: readonly MetricQuerySpec[]
  now?: Date
}

/**
 * Read the six, then compose them.
 *
 * Every read runs concurrently and independently: one refusal degrades one arm
 * of the verdict and none of the others, which is the same discipline each
 * reader already applies inside itself.
 */
export async function observeFleetHealth(
  options: FleetHealthOptions,
): Promise<FleetHealthVerdict> {
  const now = options.now ?? new Date()
  const readers = options.readers ?? liveReaders(options.gateway, { now: () => now })
  const failures: VerdictBlindSpot[] = []

  const [alarms, awsHealth, loadBalancers, containers, database] = await Promise.all([
    attempt("alarms", () => readers.alarms(), failures),
    attempt("aws-health", () => readers.awsHealth(), failures),
    attempt("loadbalancer", () => readers.loadBalancers(), failures),
    attempt("containers", () => readers.containers(), failures),
    attempt("database", () => readers.database(), failures),
  ])

  const queries = options.metricQueries ?? []
  const metrics =
    options.metricWindow === null || queries.length === 0
      ? null
      : await attempt("metrics", () => readers.metrics(queries, options.metricWindow!), failures)

  // The thrown readers go IN, not on afterwards. One level computation, in one
  // place, over every gap this pass has — see `VerdictOptions.alsoCouldNotSee`.
  return fleetHealthVerdict(
    { alarms, awsHealth, loadBalancers, containers, database, metrics },
    { now, alsoCouldNotSee: failures },
  )
}

/* ------------------------------------------------ the numbers to ask for -- */

/**
 * The period every derived metric query uses, in seconds.
 *
 * Five minutes: the resolution AWS publishes `HealthyHostCount`,
 * `CPUUtilization` and `FreeStorageSpace` at without detailed monitoring, so a
 * shorter period buys gaps in the series rather than detail. `isValidPeriod`
 * accepts it (a multiple of 60).
 */
export const DERIVED_METRIC_PERIOD_SECONDS = 300

/**
 * The metrics behind the verdict's own findings, derived from resources the
 * other readers actually returned.
 *
 * Not a dashboard and not a guess. Three metrics, each the NUMBER behind a
 * judgement made above — how many targets are healthy, how hard a service is
 * working, how much room a database has left — and each keyed on an identifier
 * that came out of an ARN a reader returned. A caller passes the result to
 * `observeFleetHealth`; an estate with none of these resources produces an empty
 * list, and `metrics.ts` is never asked for a window over nothing.
 *
 * ## The two ELB dimensions do NOT have the same shape, and that is the bug
 *
 * `TargetGroup` is published as `targetgroup/<name>/<id>` and `LoadBalancer` as
 * `app/<name>/<id>`. The ARNs are `…:targetgroup/<name>/<id>` and
 * `…:loadbalancer/app/<name>/<id>` — so one dimension keeps its resource-type
 * word and the other drops it. One helper applied to both produced
 * `loadbalancer/app/tenure-prod/…`, which CloudWatch has never published: the
 * request succeeds, the series comes back empty, and an empty
 * `HealthyHostCount` series is exactly the "zero healthy hosts" reading rule 3
 * treats as an outage. It was caught by this module's test asserting the
 * dimension values verbatim rather than asserting the query was built.
 */
export function metricQueriesFor(sources: FleetHealthSources): readonly MetricQuerySpec[] {
  const specs: MetricQuerySpec[] = []

  if (sources.loadBalancers) {
    for (const { lb, group } of targetGroupsOf(sources.loadBalancers)) {
      // See the header: the target-group dimension KEEPS `targetgroup/` and the
      // load-balancer dimension DROPS `loadbalancer/`.
      const groupTail = afterMarker(group.arn, ":targetgroup/")
      const groupDimension = groupTail === null ? null : `targetgroup/${groupTail}`
      const lbDimension = afterMarker(lb.arn, ":loadbalancer/")
      // Both dimensions or neither: `HealthyHostCount` published against a
      // TargetGroup alone is a different dimension set, and asking for one that
      // was never published returns an empty series that reads as zero hosts.
      if (groupDimension === null || lbDimension === null) continue
      // AWS's own attachment list, and NOT this engine's nesting.
      //
      // The check that stood here asked whether the load balancer this group
      // was nested under was in the list of load balancers this same pass had
      // just read. `targetGroupsOf` walks that very list, so the answer was
      // always yes: a guard that cannot fail, under a comment claiming it
      // proved something. This one can fail, because it is AWS's own
      // `LoadBalancerArns` for the group rather than a restatement of where
      // this reader put it. A group AWS does not list this load balancer for
      // has never had `HealthyHostCount` published against the pair below —
      // CloudWatch answers a query for a dimension pair it has never published
      // with an EMPTY series, and an empty `HealthyHostCount` is
      // indistinguishable from zero healthy hosts, which is exactly the reading
      // rule 3 treats as an outage. An empty list is AWS not saying, not AWS
      // denying: the nesting came from a per-load-balancer
      // `DescribeTargetGroups` call, so it stands on its own.
      if (group.loadBalancerArns.length > 0 && !group.loadBalancerArns.includes(lb.arn)) continue
      specs.push({
        key: `elb:healthy:${groupDimension}@${lbDimension}`,
        namespace: "AWS/ApplicationELB",
        metricName: "HealthyHostCount",
        dimensions: [
          { name: "TargetGroup", value: groupDimension },
          { name: "LoadBalancer", value: lbDimension },
        ],
        // Minimum, not Average: the question is whether it ever reached zero,
        // and an average over five minutes hides the minute it did.
        stat: "Minimum",
        periodSeconds: DERIVED_METRIC_PERIOD_SECONDS,
        label: `healthy targets — ${group.name ?? group.arn}`,
        resourceArn: group.arn,
      })
    }
  }

  if (sources.containers) {
    for (const cluster of itemsOf(sources.containers.clusters)) {
      for (const service of itemsOf(cluster.services)) {
        specs.push({
          key: `ecs:cpu:${cluster.name}/${service.name}`,
          namespace: "AWS/ECS",
          metricName: "CPUUtilization",
          dimensions: [
            { name: "ClusterName", value: cluster.name },
            { name: "ServiceName", value: service.name },
          ],
          stat: "Maximum",
          periodSeconds: DERIVED_METRIC_PERIOD_SECONDS,
          label: `CPU — ${cluster.name}/${service.name}`,
          resourceArn: service.arn,
        })
      }
    }
  }

  if (sources.database) {
    for (const instance of itemsOf(sources.database.instances)) {
      specs.push({
        key: `rds:free-storage:${instance.instanceId}`,
        namespace: "AWS/RDS",
        metricName: "FreeStorageSpace",
        dimensions: [{ name: "DBInstanceIdentifier", value: instance.instanceId }],
        // Minimum for the same reason as the target count: the trough is the
        // fact, and an average hides it.
        stat: "Minimum",
        periodSeconds: DERIVED_METRIC_PERIOD_SECONDS,
        label: `free storage — ${instance.instanceId}`,
        resourceArn: instance.arn ?? undefined,
      })
    }
  }

  return specs
}

/** The part of an ARN after a marker, or null when the ARN does not carry it. */
function afterMarker(arn: string, marker: string): string | null {
  const at = arn.indexOf(marker)
  if (at === -1) return null
  const suffix = arn.slice(at + marker.length)
  return suffix === "" ? null : suffix
}
