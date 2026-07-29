import "server-only"
import { db } from "@/lib/db"
import { getUserContext } from "@/lib/rbac"

export interface ScopedEvent {
  id: string
  title: string
  description: string | null
  startAt: Date
  endAt: Date
  venue: string | null
  status: string
  organizationId: string
  organizationName: string
  /** The seat that proposed it — drives edit rights (see canEditEvent). */
  ownerRoleId: string | null
  hardConflicts: number
}

/**
 * Every calendar event a user is allowed to see in a time range: their clubs'
 * events plus institution-published events. Shared by the calendar page and
 * the ICS subscription feed so both are scoped identically.
 */
export async function loadScopedEvents(
  userId: string,
  from: Date,
  to: Date,
  opts?: { organizationId?: string; mineOnly?: boolean }
): Promise<ScopedEvent[]> {
  const ctx = await getUserContext(userId)
  const oseInstitutionIds = ctx.institutionRoles.map((x) => x.institutionId)
  const memberOrgIds = ctx.orgRoles
    .filter((r) => r.status === "SHADOW" || r.status === "ACTIVE")
    .map((r) => r.organizationId)
  const memberInstitutions = memberOrgIds.length
    ? (
        await db.organization.findMany({
          where: { id: { in: memberOrgIds } },
          select: { institutionId: true },
        })
      ).map((o) => o.institutionId)
    : []

  const events = await db.event.findMany({
    where: {
      status: { not: "CANCELLED" },
      startAt: { gte: from, lt: to },
      OR: [
        { institutionId: { in: oseInstitutionIds } },
        { organizationId: { in: memberOrgIds } },
        { institutionId: { in: memberInstitutions }, status: "PUBLISHED" },
      ],
      // Optional viewer filters: one specific club, and/or only events this user
      // proposed (the linked approval was submitted by them).
      ...(opts?.organizationId ? { organizationId: opts.organizationId } : {}),
      ...(opts?.mineOnly ? { approval: { submittedById: userId } } : {}),
    },
    orderBy: { startAt: "asc" },
    include: {
      organization: { select: { name: true } },
      conflicts: { where: { severity: "HARD", resolved: false }, select: { id: true } },
    },
  })

  return events.map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    startAt: e.startAt,
    endAt: e.endAt,
    venue: e.venue,
    status: e.status,
    organizationId: e.organizationId,
    organizationName: e.organization.name,
    ownerRoleId: e.ownerRoleId,
    hardConflicts: e.conflicts.length,
  }))
}
