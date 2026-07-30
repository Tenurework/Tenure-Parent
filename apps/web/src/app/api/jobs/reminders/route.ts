import { db } from "@/lib/db"
import { seatKeysForRole } from "@/lib/resources"
import { notifyUsers } from "@/lib/notify"

/**
 * Sends the 24-hour warning for club deliverables.
 *
 * Invoked on a schedule (EventBridge Scheduler → ALB → this route), not by
 * user traffic: these deadlines freeze club budgets when missed, so the
 * reminder cannot depend on somebody happening to open the app.
 *
 * Idempotent. A DeliverableReminder row per (deliverable, user) means a
 * retry, an overlapping invocation, or a second task running the schedule
 * cannot double-notify anyone.
 */

export const dynamic = "force-dynamic"

const WINDOW_HOURS = 24

export async function POST(request: Request) {
  const expected = process.env.JOB_SECRET
  if (!expected) {
    return Response.json({ error: "JOB_SECRET not configured" }, { status: 503 })
  }

  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
  if (provided !== expected) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }

  const now = new Date()
  const horizon = new Date(now.getTime() + WINDOW_HOURS * 60 * 60 * 1000)

  const due = await db.deliverable.findMany({
    where: { dueAt: { gt: now, lte: horizon } },
    include: { reminders: { select: { userId: true } } },
  })

  if (due.length === 0) {
    return Response.json({ checked: 0, notified: 0, deliverables: [] })
  }

  // Everyone currently holding a board seat, with the seat names needed to
  // decide who a given deliverable is actually for.
  const assignments = await db.roleAssignment.findMany({
    where: { status: { in: ["ACTIVE", "SHADOW"] } },
    select: { userId: true, role: { select: { name: true } } },
  })

  const seatsByUser = new Map<string, Set<string>>()
  for (const a of assignments) {
    const set = seatsByUser.get(a.userId) ?? new Set<string>()
    for (const key of seatKeysForRole(a.role.name)) set.add(key)
    seatsByUser.set(a.userId, set)
  }

  const results: { key: string; notified: number }[] = []
  let notifiedTotal = 0

  for (const deliverable of due) {
    const alreadyNotified = new Set(deliverable.reminders.map((r) => r.userId))

    const recipients = [...seatsByUser.entries()]
      .filter(([userId, seats]) => {
        if (alreadyNotified.has(userId)) return false
        // "ALL" deliverables go to every board member; otherwise the seat
        // that owns the deliverable.
        return deliverable.seat === "ALL" || seats.has(deliverable.seat)
      })
      .map(([userId]) => userId)

    if (recipients.length > 0) {
      const dueLabel = deliverable.dueAt.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      })

      await notifyUsers(recipients, {
        title: `Reminder: ${deliverable.title}`,
        body: `Due tomorrow, ${dueLabel}.${deliverable.description ? ` ${deliverable.description}` : ""}`,
        href: "/calendar",
      })

      // Record after notifying: a crash between the two re-notifies on the
      // next run, which is far better than silently skipping a deadline.
      await db.deliverableReminder.createMany({
        data: recipients.map((userId) => ({
          deliverableId: deliverable.id,
          userId,
        })),
        skipDuplicates: true,
      })

      notifiedTotal += recipients.length
    }

    results.push({ key: deliverable.key, notified: recipients.length })
  }

  return Response.json({
    checked: due.length,
    notified: notifiedTotal,
    deliverables: results,
  })
}
