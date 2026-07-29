import "server-only"
import type { Prisma } from "@prisma/client"
import { db } from "@/lib/db"
import { detectConflicts } from "@/lib/calendar"
import { getUserContext, isOse, type UserContext } from "@/lib/rbac"
import { institutionTimeZone } from "@/lib/institution-time"
import { formatInZone, parseDateKey, zonedTimeToUtc } from "@/lib/time"
import { notifyUsers, orgPresidentIds } from "@/lib/notify"

/**
 * Writes that the calendar grid performs directly — rescheduling and editing an
 * event in place, rather than sending the officer to a form.
 *
 * Every path here re-runs conflict detection. A calendar you can drag on is
 * only safe if moving an event re-checks the venue and double-booking rules
 * that gated it at proposal time; otherwise drag-and-drop becomes a way to
 * quietly bypass approval controls.
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

/** Re-run conflict detection for an event's new time and persist the result. */
async function recheckConflicts(event: {
  id: string
  institutionId: string
  organizationId: string
  title: string
  startAt: Date
  endAt: Date
  venue: string | null
}) {
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
  const conflicts = detectConflicts(event, existing)

  await db.$transaction([
    db.conflictRecord.deleteMany({ where: { eventId: event.id } }),
    ...(conflicts.length
      ? [
          db.conflictRecord.createMany({
            data: conflicts.map((c) => ({
              eventId: event.id,
              conflictWithEventId: c.conflictWithEventId,
              severity: c.severity,
              reason: c.reason,
            })),
          }),
        ]
      : []),
    db.event.update({
      where: { id: event.id },
      data: {
        conflictSummary: {
          hard: conflicts.filter((c) => c.severity === "HARD").length,
          soft: conflicts.filter((c) => c.severity === "SOFT").length,
          informational: conflicts.filter((c) => c.severity === "INFORMATIONAL").length,
        },
      },
    }),
  ])

  return conflicts
}

export interface RescheduleInput {
  /** "YYYY-MM-DD" in the institution's timezone. */
  date: string
  /** Minutes from local midnight. */
  startMinute: number
  endMinute: number
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
  const found = await requireEditable(userId, eventId)
  if ("error" in found) return found
  const { event } = found

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
  await db.event.update({ where: { id: eventId }, data: { startAt, endAt } })

  const conflicts = await recheckConflicts({
    id: event.id,
    institutionId: event.institutionId,
    organizationId: event.organizationId,
    title: event.title,
    startAt,
    endAt,
    venue: event.venue,
  })

  const hard = conflicts.filter((c) => c.severity === "HARD")
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
      },
    },
  })

  // A move that creates a hard conflict is exactly what an approver needs to
  // hear about — silence here would let drag-and-drop route around the gate.
  if (hard.length > 0) {
    await notifyUsers(await orgPresidentIds(event.organizationId), {
      title: `“${event.title}” was moved into a conflict`,
      body: `Now ${when}. ${hard[0].reason}`,
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
}

export interface EventDetailsInput {
  title: string
  venue: string | null
  description: string | null
}

/** Edit an event's text fields in place from the inspector. */
export async function updateEventDetails(
  userId: string,
  eventId: string,
  input: EventDetailsInput
): Promise<{ ok: true } | { error: string }> {
  const found = await requireEditable(userId, eventId)
  if ("error" in found) return found
  const { event } = found

  const title = input.title.trim()
  if (!title) return { error: "A title is required." }
  if (title.length > 200) return { error: "Keep the title under 200 characters." }

  const venue = input.venue?.trim() || null
  const description = input.description?.trim() || null

  await db.event.update({
    where: { id: eventId },
    data: { title, venue, description },
  })

  // The venue is half of the hard-conflict rule, so a venue edit must re-check.
  if (venue !== event.venue) {
    await recheckConflicts({
      id: event.id,
      institutionId: event.institutionId,
      organizationId: event.organizationId,
      title,
      startAt: event.startAt,
      endAt: event.endAt,
      venue,
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
      metadata: { title, venue: input.venue ?? null },
    },
  })

  return { ok: true }
}

/** Load one event for the inspector, with the viewer's edit rights resolved. */
export async function loadEditableEvent(
  userId: string,
  eventId: string
): Promise<EditableEvent | null> {
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
}
