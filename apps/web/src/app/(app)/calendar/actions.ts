"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { withTenantScope } from "@/lib/tenant-scope"
import { detectConflicts } from "@/lib/calendar"
import { institutionTimeZone } from "@/lib/institution-time"
import { formatInZone, parseDateTimeLocal } from "@/lib/time"
import { nextStatus } from "@/lib/approvals"
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

  await withTenantScope(userId, async () => {
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
    const submitTarget = nextStatus("submit", "DRAFT", { requesterIsPresident })!

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
          metadata: { venue, startAt: startAt.toISOString(), endAt: endAt.toISOString() },
        },
      })
      await tx.approvalStep.create({
        data: {
          approvalId: approval.id,
          fromStatus: "DRAFT",
          toStatus: submitTarget,
          actorId: userId,
          actorRoleContext: membership.role.name,
          policySnapshot: { requesterIsPresident, conflictCount: conflicts.length },
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

    revalidatePath("/calendar")
    revalidatePath("/approvals")
    redirect(`/calendar/${event.id}`)
  })
}
