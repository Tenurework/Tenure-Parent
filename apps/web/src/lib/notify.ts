import { db } from "@/lib/db"

/** Fan out an in-app notification to a set of users (deduped, no self). */
export async function notifyUsers(
  userIds: string[],
  opts: { title: string; body?: string; href?: string; excludeUserId?: string }
) {
  const ids = [...new Set(userIds)].filter((id) => id && id !== opts.excludeUserId)
  if (ids.length === 0) return
  await db.notification.createMany({
    data: ids.map((userId) => ({
      userId,
      title: opts.title,
      body: opts.body ?? null,
      href: opts.href ?? null,
    })),
  })
}

/** Users holding an ACTIVE president seat in the org. */
export async function orgPresidentIds(organizationId: string): Promise<string[]> {
  const seats = await db.roleAssignment.findMany({
    where: { status: "ACTIVE", role: { organizationId, scope: "PRESIDENT" } },
    select: { userId: true },
  })
  return seats.map((s) => s.userId)
}

/** OSE staff of an institution. */
export async function oseMemberIds(institutionId: string): Promise<string[]> {
  const staff = await db.institutionMembership.findMany({
    where: { institutionId },
    select: { userId: true },
  })
  return staff.map((s) => s.userId)
}

/** ACTIVE + SHADOW members of an org. */
export async function orgCurrentMemberIds(organizationId: string): Promise<string[]> {
  const seats = await db.roleAssignment.findMany({
    where: { status: { in: ["ACTIVE", "SHADOW"] }, role: { organizationId } },
    select: { userId: true },
  })
  return seats.map((s) => s.userId)
}
