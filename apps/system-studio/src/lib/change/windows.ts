import { MIN_OVERRIDE_REASON, type ChangeClass } from "@tenure/provisioning"

/**
 * STUDIO-060-008 — when a change may run, when it may not, who was told, and
 * what is owed afterwards.
 *
 * > "Implement scheduled change windows, freeze periods, maintenance
 * >  notifications, cancellation, supersession, and emergency change with
 * >  after-action review."
 *
 * ## Not the cutover freeze, and the distinction is load-bearing
 *
 * `packages/provisioning/src/cutover-freeze.mjs` already carries the word
 * "freeze" and answers a different question: during the hours around a data
 * cutover, which SYSTEM may write which object. This answers whether a change
 * to the Tenure estate may run at a given minute. One is about data ownership
 * during a migration; this is about a calendar. They are deliberately separate
 * vocabularies because a change frozen by the release calendar and an object
 * frozen by a cutover have different remedies, and one word for both would send
 * an operator to the wrong one.
 *
 * ## Determinism
 *
 * Nothing here reads a clock. `now` and the change's own timestamp are
 * parameters, because a scheduling rule that consults `Date.now()` cannot be
 * tested at a boundary and cannot be re-evaluated for a change that was
 * assessed yesterday. `tests/architecture` treats a hidden clock the same way
 * it treats a hidden environment read.
 *
 * ## Default deny, in the direction that matters
 *
 * A class that requires a window and has NO window declared for its
 * environment is `OUTSIDE_WINDOW`, not `IN_WINDOW`. An empty calendar means
 * nobody has decided when this may run, and reading that as "any time" is how a
 * production change lands at 3pm on a Tuesday because a config file was never
 * filled in. The opposite default is the one that cannot be recovered from.
 *
 * ## Emergency is a permission, not a bypass
 *
 * An emergency declaration can move a change past a window and past a freeze
 * that permits emergencies. It cannot move one past a freeze that does not, and
 * it always leaves an after-action review owed — `afterActionDebt` is what
 * makes that owing visible rather than a sentence in a runbook.
 */

/** A recurring weekly window, in UTC. */
export interface MaintenanceWindow {
  id: string
  label: string
  /** 0 = Sunday, per `Date#getUTCDay`. */
  weekday: number
  /** Minutes past UTC midnight, inclusive. */
  startMinuteUtc: number
  /** Minutes past UTC midnight, exclusive. May exceed 1440 to run past midnight. */
  endMinuteUtc: number
  /** Environments this window covers. Empty means every environment. */
  environments: readonly string[]
}

/** A dated period in which changes are held. */
export interface FreezePeriod {
  id: string
  label: string
  /** ISO 8601, inclusive. */
  fromUtc: string
  /** ISO 8601, exclusive. */
  toUtc: string
  /** The classes this freeze holds. A freeze on nothing is not a freeze. */
  classes: readonly ChangeClass[]
  /** Environments it covers. Empty means every environment. */
  environments: readonly string[]
  /** Whether a declared emergency may proceed during it. */
  emergencyPermitted: boolean
}

export interface ChangeCalendar {
  windows: readonly MaintenanceWindow[]
  freezes: readonly FreezePeriod[]
}

/**
 * Classes that may run at any time.
 *
 * C1 observes and C2 heals itself; holding either for a window would mean a
 * cache that cannot be invalidated until Saturday. Everything that creates,
 * costs, is visible to a customer, or cannot be undone is window-bound.
 */
export const UNSCHEDULED_CLASSES: readonly ChangeClass[] = ["C1", "C2"]

/**
 * How much notice a maintenance notification needs, by class, in hours.
 *
 * Bands rather than one number, for the reason the cost policy gives at
 * `docs/implementation/system-studio-aws-control-plane-execution-ledger.md`:
 * a single threshold either stops everything or stops nothing. A reversible
 * per-tenant configuration change is not a thing to warn a customer about
 * three days ahead; a purge is.
 */
export const NOTICE_HOURS: Readonly<Record<ChangeClass, number>> = {
  C1: 0,
  C2: 0,
  C3: 0,
  C4: 24,
  C5: 24,
  C6: 72,
  C7: 72,
}

export type ScheduleStatus =
  /** The change may run now: it is inside a window, or its class is not window-bound. */
  | "IN_WINDOW"
  /** No window is open for it. Not a refusal on its own — it is a "not yet". */
  | "OUTSIDE_WINDOW"
  /** A freeze holds it, and no emergency declaration can move it. */
  | "FROZEN"
  /** A freeze or a closed window was overridden by a declared emergency. */
  | "EMERGENCY_OVERRIDE"

export interface ScheduleRequest {
  changeId: string
  changeClass: ChangeClass
  environment: string
  /** When the change would run. ISO 8601. */
  scheduledFor: string
  /** A declared emergency, or null. */
  emergency: { reason: string; declaredBy: string } | null
}

export interface MaintenanceNotice {
  /** The class band that demanded it. */
  changeClass: ChangeClass
  requiredHours: number
  /** The latest moment the notice could still have been sent in time. ISO 8601. */
  dueBy: string
  /** True when `now` is already past `dueBy` — the notice cannot be given in time. */
  late: boolean
}

export interface ScheduleVerdict {
  changeId: string
  status: ScheduleStatus
  detail: string
  /** May the change proceed at `scheduledFor`? */
  permitted: boolean
  /** The freeze that decided it, when one did. */
  freeze: FreezePeriod | null
  /** The window it is inside, when it is inside one. */
  window: MaintenanceWindow | null
  /** The next minute a window opens, when it is outside one. ISO 8601. */
  nextOpensAt: string | null
  /** The notice this class needs, and whether there is still time to give it. */
  notice: MaintenanceNotice | null
  /** True when running this change leaves an after-action review owed. */
  afterActionReviewOwed: boolean
}

const HOUR_MS = 3_600_000
const MINUTE_MS = 60_000
const DAY_MINUTES = 1440

function covers(environments: readonly string[], environment: string): boolean {
  return environments.length === 0 || environments.includes(environment)
}

/** Minutes past UTC midnight for an instant. */
function minuteOfDay(at: Date): number {
  return at.getUTCHours() * 60 + at.getUTCMinutes()
}

/**
 * Is `at` inside `window`?
 *
 * A window whose `endMinuteUtc` exceeds 1440 runs past midnight into the next
 * UTC day, which every real maintenance window does — 23:00 to 03:00 is the
 * shape, and a naive start<end comparison silently never matches it.
 */
export function windowContains(window: MaintenanceWindow, at: Date): boolean {
  const minute = minuteOfDay(at)
  const day = at.getUTCDay()
  if (day === window.weekday && minute >= window.startMinuteUtc && minute < window.endMinuteUtc) {
    return true
  }
  if (window.endMinuteUtc <= DAY_MINUTES) return false
  // The tail that spills into the following day.
  const previousDay = (window.weekday + 1) % 7
  return day === previousDay && minute + DAY_MINUTES < window.endMinuteUtc
}

/**
 * The next instant a window opens at or after `from`, or `null` when no window
 * covers this environment at all.
 *
 * Searched minute-agnostic: windows are weekly, so the answer is always within
 * seven days, and the scan is over the declared windows rather than over time.
 */
export function nextWindowOpening(
  calendar: ChangeCalendar,
  environment: string,
  from: Date,
): string | null {
  const applicable = calendar.windows.filter((w) => covers(w.environments, environment))
  if (applicable.length === 0) return null

  let best: number | null = null
  for (const window of applicable) {
    // Days until this window's weekday, then the window's own start minute.
    for (let ahead = 0; ahead <= 7; ahead += 1) {
      const day = new Date(from.getTime() + ahead * DAY_MINUTES * MINUTE_MS)
      if (day.getUTCDay() !== window.weekday) continue
      const opensAt = Date.UTC(
        day.getUTCFullYear(),
        day.getUTCMonth(),
        day.getUTCDate(),
        0,
        window.startMinuteUtc,
      )
      if (opensAt < from.getTime()) continue
      if (best === null || opensAt < best) best = opensAt
      break
    }
  }
  return best === null ? null : new Date(best).toISOString()
}

/**
 * The freeze holding this change, or null.
 *
 * When several freezes overlap, the STRICTEST wins: a freeze that refuses
 * emergencies outranks one that admits them, and among equals the one that
 * runs longest. Returning the first match instead — which this did until the
 * spec caught it — meant a broad C4–C7 freeze that admits emergencies hid a
 * narrow C7 audit lock that does not, and an operator with an emergency
 * declaration would have been told they could proceed through a lock nothing
 * can lift. First-match order is an array's order; a freeze is a rule.
 */
export function freezeFor(
  calendar: ChangeCalendar,
  request: ScheduleRequest,
  at: Date,
): FreezePeriod | null {
  const holding = calendar.freezes.filter((freeze) => {
    if (!covers(freeze.environments, request.environment)) return false
    if (!freeze.classes.includes(request.changeClass)) return false
    return at.getTime() >= Date.parse(freeze.fromUtc) && at.getTime() < Date.parse(freeze.toUtc)
  })
  if (holding.length === 0) return null
  return [...holding].sort((a, b) => {
    if (a.emergencyPermitted !== b.emergencyPermitted) return a.emergencyPermitted ? 1 : -1
    return Date.parse(b.toUtc) - Date.parse(a.toUtc)
  })[0]
}

/** The notice this class needs, and whether `now` is already too late to give it. */
export function noticeFor(request: ScheduleRequest, now: Date): MaintenanceNotice | null {
  const hours = NOTICE_HOURS[request.changeClass]
  if (hours === 0) return null
  const runsAt = Date.parse(request.scheduledFor)
  const dueBy = runsAt - hours * HOUR_MS
  return {
    changeClass: request.changeClass,
    requiredHours: hours,
    dueBy: new Date(dueBy).toISOString(),
    late: now.getTime() > dueBy,
  }
}

export function scheduleVerdict(
  request: ScheduleRequest,
  calendar: ChangeCalendar,
  now: Date,
): ScheduleVerdict {
  const at = new Date(Date.parse(request.scheduledFor))
  const notice = noticeFor(request, now)
  const base = {
    changeId: request.changeId,
    freeze: null as FreezePeriod | null,
    window: null as MaintenanceWindow | null,
    nextOpensAt: null as string | null,
    notice,
    afterActionReviewOwed: false,
  }

  const freeze = freezeFor(calendar, request, at)
  if (freeze && !freeze.emergencyPermitted) {
    return {
      ...base,
      freeze,
      status: "FROZEN",
      permitted: false,
      detail:
        `"${freeze.label}" freezes ${request.changeClass} in ${request.environment} until ` +
        `${freeze.toUtc}, and does not admit emergencies. Nothing declared at this console lifts it.`,
    }
  }
  if (freeze && !request.emergency) {
    return {
      ...base,
      freeze,
      status: "FROZEN",
      permitted: false,
      detail:
        `"${freeze.label}" freezes ${request.changeClass} in ${request.environment} until ` +
        `${freeze.toUtc}. It admits a declared emergency; this change declares none.`,
    }
  }
  if (freeze && request.emergency) {
    return {
      ...base,
      freeze,
      status: "EMERGENCY_OVERRIDE",
      permitted: true,
      afterActionReviewOwed: true,
      detail:
        `Declared emergency by ${request.emergency.declaredBy} overrides "${freeze.label}". ` +
        `An after-action review is owed once this has run.`,
    }
  }

  if (UNSCHEDULED_CLASSES.includes(request.changeClass)) {
    return {
      ...base,
      status: "IN_WINDOW",
      permitted: true,
      detail: `${request.changeClass} is not window-bound: it observes or heals itself, and holding it for a window would cost more than running it.`,
    }
  }

  const open = calendar.windows.find(
    (w) => covers(w.environments, request.environment) && windowContains(w, at),
  )
  if (open) {
    return {
      ...base,
      window: open,
      status: "IN_WINDOW",
      permitted: true,
      detail: `Inside "${open.label}".`,
    }
  }

  const nextOpensAt = nextWindowOpening(calendar, request.environment, at)
  if (request.emergency) {
    return {
      ...base,
      nextOpensAt,
      status: "EMERGENCY_OVERRIDE",
      permitted: true,
      afterActionReviewOwed: true,
      detail:
        `No window is open in ${request.environment} at ${request.scheduledFor}. Declared emergency by ` +
        `${request.emergency.declaredBy} proceeds anyway; an after-action review is owed once this has run.`,
    }
  }
  return {
    ...base,
    nextOpensAt,
    status: "OUTSIDE_WINDOW",
    permitted: false,
    detail:
      nextOpensAt === null
        ? `No maintenance window is declared for ${request.environment}, so nothing says when a ` +
          `${request.changeClass} may run there. Declare one, or declare an emergency.`
        : `No window is open at ${request.scheduledFor}. The next opens ${nextOpensAt}.`,
  }
}

/* ─────────────────────────────────────────── scheduled changes, and their end ── */

/**
 * A maintenance notification that was actually given.
 *
 * Recorded here rather than merely required, because "a notice was due" and "a
 * notice was given" are different facts and only the second makes a change safe
 * to run. The console does not SEND it — there is no notification transport in
 * this app, and a `sentAt` written by the code that was supposed to send it
 * would be a claim with nothing behind it. What this console does is require
 * one, hold the record of one, and refuse to call a change ready without it.
 */
export interface NotificationRecord {
  /** Who was told. A tenant slug, an audience name, a distribution list. */
  audience: string
  /** How. `email`, `status-page`, `phone` — recorded because a channel nobody reads is not a notice. */
  channel: string
  /** ISO 8601. When it actually went out. */
  sentAt: string
  /** The operator who sent it. */
  by: string
}

export type ScheduledStatus = "SCHEDULED" | "EXECUTING" | "DONE" | "CANCELLED" | "SUPERSEDED"

export interface ScheduledChange {
  changeId: string
  /** What it acts on. Two changes only supersede one another over the same target. */
  resource: string
  changeClass: ChangeClass
  environment: string
  scheduledFor: string
  status: ScheduledStatus
  emergency: { reason: string; declaredBy: string } | null
  /** Maintenance notices actually given for this change. Absent is not the same as none given — see `notificationReadiness`. */
  notifications?: readonly NotificationRecord[]
  /** Who ended it, and why. Present on CANCELLED and SUPERSEDED. */
  closedBy?: { actor: string; reason: string; at: string; supersededBy?: string }
  /** Recorded after an emergency change has run. */
  afterActionReview?: { at: string; author: string; summary: string }
}

export interface Refusal {
  code: "not-open" | "reason-too-short" | "different-target" | "not-later" | "self"
  detail: string
}

export type Outcome<T> = { ok: true; value: T } | { ok: false; refusal: Refusal }

/** Only a change that has not started can be called off. */
const OPEN: ReadonlySet<ScheduledStatus> = new Set<ScheduledStatus>(["SCHEDULED"])

/**
 * Call a change off.
 *
 * Refuses a change already executing or finished — "cancelled" written over a
 * change that ran is a record that contradicts the estate — and refuses a
 * reason too short to be read by somebody who was not here, which is the same
 * bar `MIN_OVERRIDE_REASON` sets for a placement override and is imported from
 * there rather than re-chosen.
 */
export function cancel(
  change: ScheduledChange,
  by: { actor: string; reason: string; at: string },
): Outcome<ScheduledChange> {
  if (!OPEN.has(change.status)) {
    return {
      ok: false,
      refusal: {
        code: "not-open",
        detail: `${change.changeId} is ${change.status}. Only a SCHEDULED change can be cancelled; a started one is compensated or rolled back.`,
      },
    }
  }
  if (by.reason.trim().length < MIN_OVERRIDE_REASON) {
    return {
      ok: false,
      refusal: {
        code: "reason-too-short",
        detail: `At least ${MIN_OVERRIDE_REASON} characters. The audit is read by somebody who was not here.`,
      },
    }
  }
  return {
    ok: true,
    value: { ...change, status: "CANCELLED", closedBy: { ...by, reason: by.reason.trim() } },
  }
}

/**
 * Replace a scheduled change with a later one over the same target.
 *
 * Refuses a different target — superseding across targets would silently drop a
 * change nobody cancelled — refuses a replacement that is not later, and
 * refuses a change superseding itself.
 */
export function supersede(
  older: ScheduledChange,
  newer: ScheduledChange,
  by: { actor: string; reason: string; at: string },
): Outcome<ScheduledChange> {
  if (older.changeId === newer.changeId) {
    return { ok: false, refusal: { code: "self", detail: "A change cannot supersede itself." } }
  }
  if (older.resource !== newer.resource) {
    return {
      ok: false,
      refusal: {
        code: "different-target",
        detail: `${newer.changeId} targets ${newer.resource} and ${older.changeId} targets ${older.resource}. Cancel one; superseding across targets loses a change nobody decided about.`,
      },
    }
  }
  if (!OPEN.has(older.status)) {
    return {
      ok: false,
      refusal: {
        code: "not-open",
        detail: `${older.changeId} is ${older.status} and is not waiting to run.`,
      },
    }
  }
  if (Date.parse(newer.scheduledFor) <= Date.parse(older.scheduledFor)) {
    return {
      ok: false,
      refusal: {
        code: "not-later",
        detail: `${newer.changeId} runs at ${newer.scheduledFor}, at or before ${older.changeId} at ${older.scheduledFor}. A supersession runs after what it replaces.`,
      },
    }
  }
  return {
    ok: true,
    value: {
      ...older,
      status: "SUPERSEDED",
      closedBy: { ...by, reason: by.reason.trim(), supersededBy: newer.changeId },
    },
  }
}

export interface NotificationReadiness {
  /** What this class demands, or null when it demands nothing. */
  required: MaintenanceNotice | null
  /** The earliest notice recorded as given in time, or null. */
  given: NotificationRecord | null
  /** May this change be called notified? */
  ready: boolean
  detail: string
}

/**
 * Whether the notice this change owed was actually given, in time.
 *
 * A notice recorded AFTER `dueBy` does not count. That is the whole point of a
 * lead time: a notification sent an hour before a purge is a log entry, not a
 * warning, and treating it as satisfying a 72-hour requirement would make the
 * requirement decorative.
 *
 * `notifications` being absent and being an empty array are both "none given",
 * and both are reported as such — this is the one place where the two really do
 * mean the same thing, because a change record that has never carried the field
 * has never carried a notice either.
 */
export function notificationReadiness(
  change: ScheduledChange,
  now: Date,
): NotificationReadiness {
  const required = noticeFor(
    {
      changeId: change.changeId,
      changeClass: change.changeClass,
      environment: change.environment,
      scheduledFor: change.scheduledFor,
      emergency: change.emergency,
    },
    now,
  )
  if (required === null) {
    return {
      required: null,
      given: null,
      ready: true,
      detail: `${change.changeClass} requires no maintenance notice.`,
    }
  }
  const inTime = [...(change.notifications ?? [])]
    .filter((n) => Date.parse(n.sentAt) <= Date.parse(required.dueBy))
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt))
  const given = inTime[0] ?? null
  if (given) {
    return {
      required,
      given,
      ready: true,
      detail: `${required.requiredHours}h notice given to ${given.audience} by ${given.by} via ${given.channel} at ${given.sentAt}.`,
    }
  }
  const late = (change.notifications ?? []).length > 0
  return {
    required,
    given: null,
    ready: false,
    detail: late
      ? `${required.requiredHours}h notice was required by ${required.dueBy}; every recorded notice went out after that, which is a log entry and not a warning.`
      : `${required.requiredHours}h notice was required by ${required.dueBy} and none is recorded. This console does not send notices; record the one that was sent.`,
  }
}

/** How long after an emergency change an after-action review is owed. */
export const AFTER_ACTION_DUE_HOURS = 120

export interface AfterActionDebt {
  changeId: string
  ranAt: string
  dueBy: string
  overdue: boolean
}

/**
 * Emergency changes that ran and owe a review.
 *
 * A change that ran under an emergency declaration and has no
 * `afterActionReview` is listed whether or not it is overdue, with `overdue`
 * saying which — "owed" and "late" are different facts and an operator plans
 * differently for each. A non-emergency change owes nothing, and a reviewed one
 * is not listed.
 */
export function afterActionDebt(
  changes: readonly ScheduledChange[],
  now: Date,
  dueHours: number = AFTER_ACTION_DUE_HOURS,
): readonly AfterActionDebt[] {
  return changes
    .filter((c) => c.status === "DONE" && c.emergency !== null && !c.afterActionReview)
    .map((c) => {
      const ranAt = Date.parse(c.scheduledFor)
      const dueBy = ranAt + dueHours * HOUR_MS
      return {
        changeId: c.changeId,
        ranAt: c.scheduledFor,
        dueBy: new Date(dueBy).toISOString(),
        overdue: now.getTime() > dueBy,
      }
    })
    .sort((a, b) => a.dueBy.localeCompare(b.dueBy))
}

/** The lines the panel renders, and the lines a test reads. */
export function scheduleLines(verdict: ScheduleVerdict): readonly string[] {
  const lines = [`${verdict.status} — ${verdict.detail}`]
  if (verdict.notice) {
    lines.push(
      verdict.notice.late
        ? `maintenance notice: ${verdict.notice.requiredHours}h was required and the deadline (${verdict.notice.dueBy}) has passed — this change cannot be announced in time`
        : `maintenance notice: ${verdict.notice.requiredHours}h required, send by ${verdict.notice.dueBy}`,
    )
  }
  if (verdict.afterActionReviewOwed) {
    lines.push(`after-action review owed within ${AFTER_ACTION_DUE_HOURS}h of this running`)
  }
  return lines
}
