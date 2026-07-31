import { db } from "@/lib/db"
import { forEachInstitution } from "@/lib/tenant-scope"
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
 *
 * There is no user behind this, so the tenant cannot be derived from a
 * session: it runs once per institution, inside that institution's scope.
 * Reading every institution's deliverables in a single pass was never one
 * operation spanning tenants, it was N per-tenant operations that had not been
 * separated — and the separation is what lets the query layer filter them.
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

  const perInstitution = await forEachInstitution("deliverable-reminders", async () => {
    const due = await db.deliverable.findMany({
      where: { dueAt: { gt: now, lte: horizon } },
      include: { reminders: { select: { userId: true } } },
    })

    if (due.length === 0) {
      return { checked: 0, notified: 0, deliverables: [] as { key: string; notified: number }[] }
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

    return { checked: due.length, notified: notifiedTotal, deliverables: results }
  })

  // The response shape is unchanged: one institution's pass produces exactly
  // what the single-pass version returned, and the totals sum across passes.
  return Response.json({
    checked: perInstitution.reduce((n, r) => n + r.checked, 0),
    notified: perInstitution.reduce((n, r) => n + r.notified, 0),
    deliverables: perInstitution.flatMap((r) => r.deliverables),
  })
}
