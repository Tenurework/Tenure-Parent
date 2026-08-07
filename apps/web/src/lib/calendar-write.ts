import "server-only"
import type { Prisma } from "@prisma/client"
import { buildAuditRecord } from "@tenure/audit"
import { db } from "@/lib/db"
import { detectConflicts, isBlockingConflict, type ConflictRule, type DetectedConflict } from "@/lib/calendar"
import {
  decideConflictOutcome,
  EVENT_OVERRIDE_CAPABILITY,
  type ConflictDecision,
  type ConflictOverrideRequest,
} from "@/lib/calendar-conflict-policy"
import { hasCapability } from "@/lib/admin/capabilities"
import { getUserContext, isOse, type UserContext } from "@/lib/rbac"
import { withTenantScope } from "@/lib/tenant-scope"
import { institutionTimeZone } from "@/lib/institution-time"
import { formatInZone, parseDateKey, zonedTimeToUtc } from "@/lib/time"
import { notifyUsers, orgPresidentIds } from "@/lib/notify"

/**
 * Writes that the calendar grid performs directly — rescheduling and editing an
 * event in place, rather than sending the officer to a form.
 *
 * Every path here re-runs conflict detection BEFORE it writes, and puts the
 * result through `decideConflictOutcome`. A calendar you can drag on is only
 * safe if moving an event re-checks the venue and double-booking rules that
 * gated it at proposal time — and only actually safe if a rule that fires can
 * refuse the write. Detecting afterwards and notifying about it left drag-and-
 * drop as a way around the gate: the row was already updated by the time
 * anybody was told.
 */

export interface EditableEvent {
  id: string
  title: string
  description: string | null
  venue: string | null
  startAt: Date
  endAt: Date
  status: string
  organizationId: string
  institutionId: string
  organizationName: string
  editable: boolean
  timeZone: string
}

/**
 * May this viewer move or edit this event?
 *
 * Three ways in, and no others:
 *   · OSE — institution-wide oversight.
 *   · The owning club's ACTIVE President — accountable for the club's calendar.
 *   · The ACTIVE holder of the seat that proposed it (`ownerRoleId`).
 *
 * Deliberately NARROWER than `canContribute`. Contributing means proposing a
 * new event into the approval chain; rescheduling means moving one that may
 * already have cleared both gates and been published to the institution. An
 * "any ACTIVE member of the club" rule let every rank-and-file member with a
 * generic Member seat drag a published event to a different day — a governance
 * hole that only opened once the grid became editable.
 *
 * SHADOW holders preview but cannot write, matching every other workspace
 * surface, and a cancelled event is frozen.
 *
 * ── Once approved, the proposer steps back ──────────────────────────────────
 * A PUBLISHED event has been through the gates, and the approval record that
 * justified it is a SNAPSHOT — approvers read `approval.description`, not the
 * live Event row. So a proposer who could still rewrite a published event could
 * get "Case Prep, Schlegel 203, Tue 6pm" approved and then turn it into
 * "Bar Crawl, off campus, Fri 10pm" with the approval page still showing the
 * original text. Past that line only OSE or the club President may act, and
 * every such change is written back onto the approval and announced — see
 * `syncApprovalSnapshot`.
 */
export function canEditEvent(
  ctx: UserContext,
  event: {
    organizationId: string
    institutionId: string
    status: string
    ownerRoleId?: string | null
  }
): boolean {
  if (event.status === "CANCELLED") return false
  if (isOse(ctx, event.institutionId)) return true

  const seats = ctx.orgRoles.filter(
    (r) => r.organizationId === event.organizationId && r.status === "ACTIVE"
  )
  if (seats.some((r) => r.scope === "PRESIDENT")) return true
  // The owning seat keeps control only while the request is still in flight.
  if (event.status === "PUBLISHED") return false
  return event.ownerRoleId != null && seats.some((r) => r.roleId === event.ownerRoleId)
}

type LoadedEvent = Prisma.EventGetPayload<{
  include: {
    organization: { select: { name: true; institutionId: true } }
    approval: { select: { id: true; status: true; description: true } }
  }
}>

/**
 * Write an amendment back onto the linked approval request.
 *
 * The approval record is what an approver actually reads: `createEvent` bakes
 * the time and venue into `description` and `metadata` and the review page
 * renders those, never the live Event row. Editing the event without touching
 * the approval therefore left the institution's own record of what was approved
 * saying something the calendar no longer did.
 *
 * The amendment is appended as an ApprovalStep — a same-status transition — so
 * it lands on the timeline approvers already read rather than in a separate log
 * nobody opens. Reusing the existing append-only step history keeps one story
 * per request instead of two.
 */
async function syncApprovalSnapshot(
  event: LoadedEvent,
  next: { title: string; venue: string | null; description: string | null; startAt: Date; endAt: Date },
  actorId: string,
  timeZone: string
): Promise<void> {
  if (!event.approval) return

  const when = formatInZone(next.startAt, timeZone, { dateStyle: "medium", timeStyle: "short" })
  const rebuilt =
    `Proposed for ${when}` +
    (next.venue ? ` at ${next.venue}` : "") +
    (next.description ? `\n\n${next.description}` : "")

  await db.$transaction([
    db.approvalRequest.update({
      where: { id: event.approval.id },
      data: {
        title: next.title,
        description: rebuilt,
        metadata: {
          venue: next.venue,
          startAt: next.startAt.toISOString(),
          endAt: next.endAt.toISOString(),
          amendedAfterDecision: event.status === "PUBLISHED",
        },
      },
    }),
    db.approvalStep.create({
      data: {
        approvalId: event.approval.id,
        fromStatus: event.approval.status,
        toStatus: event.approval.status,
        actorId,
        actorRoleContext: "Calendar",
        reason:
          event.status === "PUBLISHED"
            ? `Amended after approval — now ${when}${next.venue ? ` at ${next.venue}` : ""}`
            : `Updated before decision — now ${when}${next.venue ? ` at ${next.venue}` : ""}`,
      },
    }),
  ])
}

/**
 * A true discriminated union — no optional `error?: undefined` member — so
 * `if ("error" in x)` narrows cleanly at every call site and a permission
 * failure can never fall through into a write.
 */
type Guarded = { error: string } | { event: LoadedEvent; ctx: UserContext }

async function requireEditable(userId: string, eventId: string): Promise<Guarded> {
  const event = await db.event.findUnique({
    where: { id: eventId },
    include: {
      organization: { select: { name: true, institutionId: true } },
      approval: { select: { id: true, status: true, description: true } },
    },
  })
  if (!event) return { error: "That event no longer exists." }
  const ctx = await getUserContext(userId)
  if (!canEditEvent(ctx, event)) {
    return { error: "You do not have permission to change this event." }
  }
  return { event, ctx }
}

interface ProposedEvent {
  id: string
  institutionId: string
  organizationId: string
  title: string
  startAt: Date
  endAt: Date
  venue: string | null
}

/**
 * Run conflict detection for an event's PROPOSED shape, writing nothing.
 *
 * Read-only on purpose: the gate below asks this question about a time or venue
 * that may never be written, and persisting conflicts for a rejected proposal
 * would leave the calendar advertising a clash that does not exist.
 */
async function evaluateConflicts(event: ProposedEvent): Promise<DetectedConflict[]> {
  const existing = await db.event.findMany({
    where: {
      institutionId: event.institutionId,
      status: { not: "CANCELLED" },
      id: { not: event.id },
      startAt: { gte: new Date(event.startAt.getTime() - 7 * 864e5) },
      endAt: { lte: new Date(event.endAt.getTime() + 7 * 864e5) },
    },
    select: {
      id: true,
      organizationId: true,
      title: true,
      startAt: true,
      endAt: true,
      venue: true,
    },
  })
  return detectConflicts(event, existing)
}

/** Replace an event's stored conflicts once the write it belongs to has landed. */
async function persistConflicts(eventId: string, conflicts: DetectedConflict[]) {
  const byRule: Partial<Record<ConflictRule, number>> = {}
  for (const c of conflicts) byRule[c.rule] = (byRule[c.rule] ?? 0) + 1

  await db.$transaction([
    db.conflictRecord.deleteMany({ where: { eventId } }),
    ...(conflicts.length
      ? [
          db.conflictRecord.createMany({
            data: conflicts.map((c) => ({
              eventId,
              conflictWithEventId: c.conflictWithEventId,
              severity: c.severity,
              reason: c.reason,
            })),
          }),
        ]
      : []),
    db.event.update({
      where: { id: eventId },
      data: {
        conflictSummary: {
          hard: conflicts.filter((c) => c.severity === "HARD").length,
          soft: conflicts.filter((c) => c.severity === "SOFT").length,
          informational: conflicts.filter((c) => c.severity === "INFORMATIONAL").length,
          // Which rules fired, not just how many — the ConflictRecord table has
          // no rule column, so this is where the named rule survives the write.
          byRule,
        },
      },
    }),
  ])
}

/**
 * The gate: detect, decide, and record the decision when it refuses.
 *
 * A refusal is itself a governed outcome, so it is audited here (`DENY`, with
 * the rule ids and the code that refused) even though nothing was written —
 * "the system stopped me" has to be answerable from the log, and a block that
 * leaves no trace is indistinguishable from a request that was never made.
 *
 * The ALLOW side is deliberately NOT audited here: it must be recorded by the
 * caller after its write succeeds, or the log would assert an override that a
 * later failure rolled back.
 */
async function gateOnConflicts(args: {
  proposed: ProposedEvent
  ctx: UserContext
  actorId: string
  actorRole: string
  attempted: "Event.Rescheduled" | "Event.Edited"
  override: ConflictOverrideRequest | undefined
}): Promise<{ conflicts: DetectedConflict[]; decision: ConflictDecision }> {
  const conflicts = await evaluateConflicts(args.proposed)
  const decision = decideConflictOutcome({
    conflicts,
    actorHasOverride: hasCapability(
      args.ctx,
      EVENT_OVERRIDE_CAPABILITY,
      args.proposed.institutionId
    ),
    overrideRequested: args.override?.requested === true,
    overrideReason: args.override?.reason ?? null,
  })

  if (!decision.allowed) {
    await recordConflictDecision({
      proposed: args.proposed,
      actorId: args.actorId,
      actorRole: args.actorRole,
      action: "Event.ConflictBlocked",
      outcome: "DENY",
      reason: decision.explanation,
      metadata: {
          attempted: args.attempted,
          code: decision.blocked?.code ?? null,
          requiredCapability: decision.blocked?.requiredCapability ?? null,
          rules: decision.blockedByRules,
        conflicts: conflicts.filter(isBlockingConflict).map((c) => ({
          rule: c.rule,
          conflictWithEventId: c.conflictWithEventId,
          reason: c.reason,
        })),
      },
    })
  }

  return { conflicts, decision }
}

/**
 * Persist a conflict decision through `@tenure/audit` instead of hand-building
 * the row.
 *
 * `tests/security/audit-writes.test.mjs` holds a ratchet that may only shrink,
 * and these two writes are new — so raising the ceiling to fit them would be
 * weakening a guard to make a build pass. The guard is right on the merits too:
 * the builder is what enforces that a DENY carries a reason, that the required
 * fields are present, and that metadata is redacted before it is stored. A
 * hand-built `data: {}` skips all three silently.
 *
 * The record is built unchained (no `sequence`), matching every other writer in
 * this app today. That is a real gap and GE-063-001 owns it: an edit to this row
 * is still caught by its own hash, but nothing proves a neighbour was not
 * deleted.
 */
async function recordConflictDecision(input: {
  proposed: ProposedEvent
  actorId: string
  actorRole: string
  action: string
  outcome: "ALLOW" | "DENY"
  reason: string
  metadata: Record<string, unknown>
}) {
  const record = buildAuditRecord({
    tenantId: input.proposed.institutionId,
    organizationId: input.proposed.organizationId ?? undefined,
    actor: { principalId: input.actorId, role: input.actorRole },
    action: input.action,
    resourceType: "Event",
    resourceId: input.proposed.id,
    outcome: input.outcome,
    reason: input.reason,
    metadata: input.metadata,
    occurredAt: new Date().toISOString(),
  })

  await db.auditEvent.create({
    data: {
      institutionId: record.tenantId,
      organizationId: input.proposed.organizationId,
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: record.action,
      resourceType: record.resourceType,
      resourceId: record.resourceId ?? null,
      outcome: record.outcome,
      reason: record.reason ?? null,
      metadata: (record.metadata ?? {}) as object,
      occurredAt: new Date(record.occurredAt),
    },
  })
}

/** Record that a blocking conflict was consciously overridden by an authorized actor. */
async function auditOverride(args: {
  proposed: ProposedEvent
  actorId: string
  actorRole: string
  attempted: "Event.Rescheduled" | "Event.Edited"
  decision: ConflictDecision
}) {
  const override = args.decision.override
  if (!override) return
  await recordConflictDecision({
    proposed: args.proposed,
    actorId: args.actorId,
    actorRole: args.actorRole,
    action: "Event.ConflictOverridden",
    outcome: "ALLOW",
    reason: override.reason,
    metadata: {
      attempted: args.attempted,
      rules: override.rules,
      conflictWithEventIds: override.conflictWithEventIds,
      capability: EVENT_OVERRIDE_CAPABILITY,
    },
  })
}

export interface RescheduleInput {
  /** "YYYY-MM-DD" in the institution's timezone. */
  date: string
  /** Minutes from local midnight. */
  startMinute: number
  endMinute: number
  /**
   * An explicit override of a blocking conflict. Absent means "not requested",
   * which is what every ordinary move sends — the gate refuses a HARD conflict
   * unless this arrives AND the actor holds `event.override`.
   */
  override?: ConflictOverrideRequest
}

/**
 * Move / resize an event from the grid. Times arrive as institution-local
 * wall-clock values (a date key plus minutes from midnight) and are converted
 * to UTC instants here — the client never computes an instant, so a viewer in
 * another timezone cannot shift the institution's calendar.
 */
export async function rescheduleEvent(
  userId: string,
  eventId: string,
  input: RescheduleInput
): Promise<{ startISO: string; endISO: string } | { error: string }> {
  return withTenantScope(userId, async () => {
    const found = await requireEditable(userId, eventId)
    if ("error" in found) return found
    const { event, ctx } = found

    if (!parseDateKey(input.date)) return { error: "That is not a valid date." }
    if (
      !Number.isFinite(input.startMinute) ||
      !Number.isFinite(input.endMinute) ||
      input.startMinute < 0 ||
      input.startMinute > 24 * 60 ||
      // An end past midnight is expressed as minutes beyond 24×60 against the
      // same start date, so the ceiling is two days, not one. zonedTimeToUtc
      // carries the overflow into the next calendar day for us.
      input.endMinute > 48 * 60 ||
      input.endMinute - input.startMinute < 15
    ) {
      return { error: "An event must be at least 15 minutes long." }
    }
    if (input.endMinute - input.startMinute > 24 * 60) {
      return { error: "An event cannot run longer than 24 hours." }
    }

    const tz = await institutionTimeZone(event.institutionId)
    const p = parseDateKey(input.date)!
    const startAt = zonedTimeToUtc(
      p.year,
      p.month,
      p.day,
      Math.floor(input.startMinute / 60),
      input.startMinute % 60,
      tz
    )
    const endAt = zonedTimeToUtc(
      p.year,
      p.month,
      p.day,
      Math.floor(input.endMinute / 60),
      input.endMinute % 60,
      tz
    )
    if (endAt <= startAt) return { error: "The end time must be after the start time." }

    const before = { startAt: event.startAt, endAt: event.endAt }
    const proposed: ProposedEvent = {
      id: event.id,
      institutionId: event.institutionId,
      organizationId: event.organizationId,
      title: event.title,
      startAt,
      endAt,
      venue: event.venue,
    }

    // Detect and DECIDE before the row moves. The old order wrote first and
    // classified second, which made every hard conflict advisory by
    // construction — there was nothing left to refuse.
    const { conflicts, decision } = await gateOnConflicts({
      proposed,
      ctx,
      actorId: userId,
      actorRole: "Calendar",
      attempted: "Event.Rescheduled",
      override: input.override,
    })
    if (!decision.allowed) return { error: decision.explanation }

    await db.event.update({ where: { id: eventId }, data: { startAt, endAt } })
    await persistConflicts(event.id, conflicts)

    const hard = conflicts.filter(isBlockingConflict)
    const when = formatInZone(startAt, tz, { dateStyle: "medium", timeStyle: "short" })

    await syncApprovalSnapshot(
      event,
      {
        title: event.title,
        venue: event.venue,
        description: event.description,
        startAt,
        endAt,
      },
      userId,
      tz
    )

    await db.auditEvent.create({
      data: {
        institutionId: event.institutionId,
        organizationId: event.organizationId,
        actorId: userId,
        actorRole: "Calendar",
        action: "Event.Rescheduled",
        resourceType: "Event",
        resourceId: event.id,
        outcome: "ALLOW",
        metadata: {
          from: { startAt: before.startAt.toISOString(), endAt: before.endAt.toISOString() },
          to: { startAt: startAt.toISOString(), endAt: endAt.toISOString() },
          timeZone: tz,
          hardConflicts: hard.length,
          overriddenRules: decision.override?.rules ?? [],
        },
      },
    })

    await auditOverride({
      proposed,
      actorId: userId,
      actorRole: "Calendar",
      attempted: "Event.Rescheduled",
      decision,
    })

    // Past the gate, a surviving hard conflict means somebody used their
    // override authority — precisely the thing the club's presidents must hear
    // about, and now with the reason attached rather than a bare warning.
    if (hard.length > 0) {
      await notifyUsers(await orgPresidentIds(event.organizationId), {
        title: `“${event.title}” was moved into a conflict`,
        body:
          `Now ${when}. ${hard[0].reason}` +
          (decision.override ? ` — overridden: ${decision.override.reason}` : ""),
        href: `/calendar/${event.id}`,
        excludeUserId: userId,
      })
    } else if (event.status === "PUBLISHED") {
      // Moving an already-approved event is a governance event in its own right,
      // conflict or not: the institution published one time and now sees another.
      await notifyUsers(await orgPresidentIds(event.organizationId), {
        title: `“${event.title}” moved after it was approved`,
        body: `It now starts ${when}. The approval record has been updated to match.`,
        href: `/calendar/${event.id}`,
        excludeUserId: userId,
      })
    }

    return { startISO: startAt.toISOString(), endISO: endAt.toISOString() }
  })
}

export interface EventDetailsInput {
  title: string
  venue: string | null
  description: string | null
  /** Same explicit-override contract as a reschedule. See `RescheduleInput`. */
  override?: ConflictOverrideRequest
}

/** Edit an event's text fields in place from the inspector. */
export async function updateEventDetails(
  userId: string,
  eventId: string,
  input: EventDetailsInput
): Promise<{ ok: true } | { error: string }> {
  return withTenantScope(userId, async () => {
    const found = await requireEditable(userId, eventId)
    if ("error" in found) return found
    const { event, ctx } = found

    const title = input.title.trim()
    if (!title) return { error: "A title is required." }
    if (title.length > 200) return { error: "Keep the title under 200 characters." }

    const venue = input.venue?.trim() || null
    const description = input.description?.trim() || null

    // The venue is half of the hard-conflict rule, so a venue edit goes through
    // the same gate a reschedule does. Typing a room into the inspector and
    // dragging an event into that room are the same act; gating only one of
    // them leaves the other as the way around it.
    let decision: ConflictDecision | null = null
    let conflicts: DetectedConflict[] = []
    const proposed: ProposedEvent = {
      id: event.id,
      institutionId: event.institutionId,
      organizationId: event.organizationId,
      title,
      startAt: event.startAt,
      endAt: event.endAt,
      venue,
    }
    if (venue !== event.venue) {
      const gated = await gateOnConflicts({
        proposed,
        ctx,
        actorId: userId,
        actorRole: "Calendar",
        attempted: "Event.Edited",
        override: input.override,
      })
      if (!gated.decision.allowed) return { error: gated.decision.explanation }
      decision = gated.decision
      conflicts = gated.conflicts
    }

    await db.event.update({
      where: { id: eventId },
      data: { title, venue, description },
    })

    if (decision) {
      await persistConflicts(event.id, conflicts)
      await auditOverride({
        proposed,
        actorId: userId,
        actorRole: "Calendar",
        attempted: "Event.Edited",
        decision,
      })
    }

    const tz = await institutionTimeZone(event.institutionId)
    await syncApprovalSnapshot(
      event,
      { title, venue, description, startAt: event.startAt, endAt: event.endAt },
      userId,
      tz
    )

    // Retitling or relocating an approved event changes what the institution
    // signed off on, so the gate owners hear about it.
    if (event.status === "PUBLISHED" && (title !== event.title || venue !== event.venue)) {
      await notifyUsers(await orgPresidentIds(event.organizationId), {
        title: `“${event.title}” was edited after approval`,
        body:
          `It is now “${title}”${venue ? ` at ${venue}` : ""}. ` +
          `The approval record has been updated to match.`,
        href: `/calendar/${event.id}`,
        excludeUserId: userId,
      })
    }

    await db.auditEvent.create({
      data: {
        institutionId: event.institutionId,
        organizationId: event.organizationId,
        actorId: userId,
        actorRole: "Calendar",
        action: "Event.Edited",
        resourceType: "Event",
        resourceId: event.id,
        outcome: "ALLOW",
        metadata: {
          title,
          venue: input.venue ?? null,
          overriddenRules: decision?.override?.rules ?? [],
        },
      },
    })

    return { ok: true }
  })
}

/** Load one event for the inspector, with the viewer's edit rights resolved. */
export async function loadEditableEvent(
  userId: string,
  eventId: string
): Promise<EditableEvent | null> {
  return withTenantScope(userId, async () => {
    const event = await db.event.findUnique({
      where: { id: eventId },
      include: {
        organization: { select: { name: true, institutionId: true } },
        approval: { select: { id: true, status: true, description: true } },
      },
    })
    if (!event) return null

    const ctx = await getUserContext(userId)
    const visible =
      isOse(ctx, event.institutionId) ||
      ctx.orgRoles.some(
        (r) =>
          r.organizationId === event.organizationId &&
          (r.status === "ACTIVE" || r.status === "SHADOW")
      ) ||
      event.status === "PUBLISHED"
    if (!visible) return null

    return {
      id: event.id,
      title: event.title,
      description: event.description,
      venue: event.venue,
      startAt: event.startAt,
      endAt: event.endAt,
      status: event.status,
      organizationId: event.organizationId,
      institutionId: event.institutionId,
      organizationName: event.organization.name,
      editable: canEditEvent(ctx, event),
      timeZone: await institutionTimeZone(event.institutionId),
    }
  })
}
