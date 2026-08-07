"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { withTenantScope } from "@/lib/tenant-scope"
import { configSnapshotForInstitution, institutionSlugFor } from "@/lib/config/server"
import { localizationFor } from "@tenure/platform-config"
import { detectConflicts } from "@/lib/calendar"
import { institutionTimeZone } from "@/lib/institution-time"
import { formatInZone, parseDateTimeLocal } from "@/lib/time"
import { approvalDigest, nextStatus } from "@/lib/approvals"
import { notifyUsers, orgPresidentIds, oseMemberIds } from "@/lib/notify"

/**
 * Create an event proposal: the Event goes in as PENDING_APPROVAL with a
 * linked EVENT-type ApprovalRequest already submitted into the chain, and
 * conflicts against every non-cancelled event at the institution are
 * recorded so approvers see them before deciding.
 */
export async function createEvent(formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Not signed in")
  const userId = session.user.id

  // The scope returns the new event's id and closes before anything navigates.
  // This body opens a `db.$transaction` that writes the ApprovalRequest, the
  // ApprovalStep, the Event, its ConflictRecords and the audit row; a
  // `redirect()` reached from inside it is a throw that aborts all six while the
  // browser follows a 307 to an event that no longer exists.
  const eventId = await withTenantScope(userId, async () => {
    const organizationId = String(formData.get("organizationId") ?? "")
    const title = String(formData.get("title") ?? "").trim()
    const description = String(formData.get("description") ?? "").trim()
    const venue = String(formData.get("venue") ?? "").trim()
    const startRaw = String(formData.get("startAt") ?? "")
    const endRaw = String(formData.get("endAt") ?? "")

    if (!title) throw new Error("Title is required")

    // Requester needs an ACTIVE seat in the club
    const membership = await db.roleAssignment.findFirst({
      where: { userId, status: "ACTIVE", role: { organizationId } },
      include: { role: { include: { organization: true } } },
    })
    if (!membership) throw new Error("You need an active role in this club")
    const org = membership.role.organization

    // A `datetime-local` field carries no zone. `new Date("2026-09-05T18:00")`
    // resolves it against the SERVER's zone — UTC in production — so an officer
    // who typed 6:00 PM had 6:00 PM UTC stored, and the calendar showed their
    // event four hours out from the ICS feed Tenure publishes for it. Parse the
    // field as institution-local wall-clock time instead. See src/lib/time.ts.
    const timeZone = await institutionTimeZone(org.institutionId)
    const startAt = parseDateTimeLocal(startRaw, timeZone)
    const endAt = parseDateTimeLocal(endRaw, timeZone)
    if (!startAt || !endAt) throw new Error("Valid start and end times are required")
    if (endAt <= startAt) throw new Error("End must be after start")

    // Conflict detection against all live events at the institution
    const existing = await db.event.findMany({
      where: {
        institutionId: org.institutionId,
        status: { not: "CANCELLED" },
        // Only scan a window around the proposal to keep the query bounded
        startAt: { gte: new Date(startAt.getTime() - 7 * 864e5) },
        endAt: { lte: new Date(endAt.getTime() + 7 * 864e5) },
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
    const conflicts = detectConflicts(
      { organizationId, title, startAt, endAt, venue: venue || null },
      existing
    )

    const requesterIsPresident = membership.role.scope === "PRESIDENT"
    // PAY-150-002. An event proposal moves no money, so it can never exceed the
    // ladder — stated rather than defaulted, because `exceedsThreshold` is a
    // required option precisely so a caller with an amount cannot forget it.
    const submitTarget = nextStatus("submit", "DRAFT", {
      requesterIsPresident,
      exceedsThreshold: false,
    })!

    // PAY-030-005. The configuration this submission is raised against.
    const configSnapshot = await configSnapshotForInstitution(org.institutionId)
    // PAY-150-002 / PAY-150-004. The currency the request is denominated in,
    // even with no amount on it: the digest below covers it, so an institution
    // that changes currency cannot silently revalue a request in flight.
    const currency = localizationFor(
      await institutionSlugFor(org.institutionId),
    ).currency.toUpperCase()
    const metadata = {
      venue,
      currency,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
    }

    const event = await db.$transaction(async (tx) => {
      const approval = await tx.approvalRequest.create({
        data: {
          institutionId: org.institutionId,
          organizationId,
          type: "EVENT",
          title,
          description:
            `Proposed for ${formatInZone(startAt, timeZone, { dateStyle: "medium", timeStyle: "short" })}` +
            (venue ? ` at ${venue}` : "") +
            (description ? `\n\n${description}` : ""),
          submittedById: userId,
          status: submitTarget,
          metadata,
        },
      })
      await tx.approvalStep.create({
        data: {
          approvalId: approval.id,
          fromStatus: "DRAFT",
          toStatus: submitTarget,
          actorId: userId,
          actorRoleContext: membership.role.name,
          // PAY-150-004. The schedule and venue this gate is being asked about.
          // `syncApprovalSnapshot` (calendar-write.ts) rewrites exactly these
          // fields when the grid moves an event, so this is the digest that
          // makes a reschedule between the two gates a refusal instead of a
          // silently different approval.
          policySnapshot: {
            requesterIsPresident,
            conflictCount: conflicts.length,
            payloadDigest: approvalDigest(metadata, {
              organizationId,
              type: "EVENT",
              amountMinorUnits: null,
              currency,
            }),
          },
          configRevision: configSnapshot.revision,
          configChecksum: configSnapshot.checksum,
          authority: "approvals.requester",
        },
      })
      const e = await tx.event.create({
        data: {
          institutionId: org.institutionId,
          organizationId,
          approvalId: approval.id,
          ownerRoleId: membership.roleId,
          title,
          description: description || null,
          startAt,
          endAt,
          venue: venue || null,
          status: "PENDING_APPROVAL",
          conflictSummary: {
            hard: conflicts.filter((c) => c.severity === "HARD").length,
            soft: conflicts.filter((c) => c.severity === "SOFT").length,
            informational: conflicts.filter((c) => c.severity === "INFORMATIONAL").length,
          },
        },
      })
      if (conflicts.length) {
        await tx.conflictRecord.createMany({
          data: conflicts.map((c) => ({
            eventId: e.id,
            conflictWithEventId: c.conflictWithEventId,
            severity: c.severity,
            reason: c.reason,
          })),
        })
      }
      await tx.auditEvent.create({
        data: {
          institutionId: org.institutionId,
          organizationId,
          actorId: userId,
          actorRole: membership.role.name,
          action: "Event.Proposed",
          resourceType: "Event",
          resourceId: e.id,
          outcome: "ALLOW",
          metadata: { conflicts: conflicts.length },
        },
      })
      return e
    })

    // Alert the gate that owns this event proposal
    const gateUsers =
      submitTarget === "PENDING_PRESIDENT"
        ? await orgPresidentIds(organizationId)
        : await oseMemberIds(org.institutionId)
    await notifyUsers(gateUsers, {
      title: `New event “${title}” needs your approval`,
      body:
        conflicts.length > 0
          ? `Heads up — it overlaps with ${conflicts.length} other event${conflicts.length === 1 ? "" : "s"}. Please review before deciding.`
          : "No scheduling conflicts — you're clear to decide.",
      href: `/calendar/${event.id}`,
      excludeUserId: userId,
    })

    return event.id
  })

  revalidatePath("/calendar")
  revalidatePath("/approvals")
  redirect(`/calendar/${eventId}`)
}
