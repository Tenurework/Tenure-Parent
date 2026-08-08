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
  itemsOf,
  liveGateway,
  readAws,
  type AwsGateway,
  type AwsRead,
  type DenialContext,
} from "./read"
import type { HealthObservation, ObservationSource } from "../fleet-health"

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
