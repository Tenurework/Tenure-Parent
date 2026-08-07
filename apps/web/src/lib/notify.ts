import { db } from "@/lib/db"
import { liveMembershipWhere } from "@/lib/identity/live-membership"

/**
 * The channel this module delivers on.
 *
 * `notifyUsers` writes `Notification` rows, which are read by the in-app bell —
 * so IN_APP is the only consent that can govern it. A person who has turned
 * EMAIL off has said nothing about the bell, and must keep receiving it
 * (GE-073-004).
 */
const IN_APP = "IN_APP" as const

/**
 * Drop the users who have turned the in-app channel off.
 *
 * `NotificationPreference.enabled` defaults to true and the row is written only
 * when someone changes the setting, so *absence of a row is consent*: an id with
 * no preference row stays in the list. Only an explicit `enabled: false` on the
 * IN_APP channel removes one. That is what makes this safe to ship without a
 * backfill — an empty table behaves exactly like today.
 *
 * The query asks for the opt-outs rather than reading every preference and
 * filtering in memory: for a fan-out to an entire institution's staff, the
 * opt-out set is the small one.
 */
async function inAppRecipients(userIds: string[]): Promise<string[]> {
  const optedOut = await db.notificationPreference.findMany({
    where: { userId: { in: userIds }, channel: IN_APP, enabled: false },
    select: { userId: true },
  })
  if (optedOut.length === 0) return userIds
  const suppressed = new Set(optedOut.map((p) => p.userId))
  return userIds.filter((id) => !suppressed.has(id))
}

/**
 * Fan out an in-app notification to a set of users (deduped, no self, and no
 * one who has opted out of the in-app channel).
 */
export async function notifyUsers(
  userIds: string[],
  opts: { title: string; body?: string; href?: string; excludeUserId?: string }
) {
  const ids = [...new Set(userIds)].filter((id) => id && id !== opts.excludeUserId)
  if (ids.length === 0) return
  const recipients = await inAppRecipients(ids)
  // Everyone left has opted out — write nothing rather than an empty createMany.
  if (recipients.length === 0) return
  await db.notification.createMany({
    data: recipients.map((userId) => ({
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
    // Live only: a revoked staff member must stop receiving the institution's
    // notifications the moment their membership ends (GE-040-001).
    where: { ...liveMembershipWhere(), institutionId },
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
