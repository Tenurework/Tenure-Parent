import { randomUUID } from "node:crypto"
import { ContractViolation, parseJobRequest, type JobRequest } from "@tenure/contracts"
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

const JOB_NAME = "deliverable-reminders"

/**
 * PACK-010-001 — the run, in the kernel's own shape.
 *
 * `JobRequest` is one of the platform's declared contracts and its doc comment
 * names *this* job as the reason `tenantId` is nullable: "the reminder sweep
 * runs once per institution and something has to schedule it". Nothing produced
 * one, so the shape and the job it was written for had never met.
 *
 * The scheduler may send an envelope; when it does not, one is derived. Both go
 * through `parseJobRequest`, and the check that earns its place is the one on
 * `attempt`: a scheduler that has already burned its retries and asks again is
 * refused rather than re-running a sweep that mails deadline reminders. The
 * body is untrusted — the bearer token authenticates the caller, not the
 * numbers it sends — which is exactly the boundary a runtime contract is for.
 *
 * The derived envelope is not a formality either. `idempotencyKey` names the
 * hour window this run covers, so two invocations of the same schedule carry
 * the same key and a support question about a duplicate notification has
 * something to join on.
 */
function jobRequestFrom(body: unknown, now: Date): JobRequest {
  const supplied = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  const hourWindow = now.toISOString().slice(0, 13)

  return parseJobRequest({
    jobId: supplied.jobId ?? randomUUID(),
    name: JOB_NAME,
    // Null, and this is the one job for which that is right: it runs once per
    // institution inside each institution's own scope, so no single tenant owns
    // the invocation.
    tenantId: null,
    idempotencyKey: supplied.idempotencyKey ?? `${JOB_NAME}:${hourWindow}`,
    scheduledFor: supplied.scheduledFor ?? now.toISOString(),
    attempt: supplied.attempt ?? 1,
    maxAttempts: supplied.maxAttempts ?? 3,
    payload: {},
  })
}

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

  let job: JobRequest
  try {
    job = jobRequestFrom(await request.json().catch(() => ({})), now)
  } catch (err) {
    // The violation names the field and never echoes the value, so this is safe
    // to return: it is what tells whoever wired the schedule what is wrong.
    if (err instanceof ContractViolation) {
      return Response.json({ error: "invalid_job_request", detail: err.message }, { status: 400 })
    }
    throw err
  }

  const horizon = new Date(now.getTime() + WINDOW_HOURS * 60 * 60 * 1000)

  const perInstitution = await forEachInstitution("deliverable-reminders", async (scope) => {
    const due = await db.deliverable.findMany({
      where: { dueAt: { gt: now, lte: horizon } },
      include: { reminders: { select: { userId: true } } },
    })

    if (due.length === 0) {
      return { checked: 0, notified: 0, deliverables: [] as { key: string; notified: number }[] }
    }

    // Everyone at THIS institution currently holding a board seat, with the
    // seat names needed to decide who a given deliverable is actually for.
    //
    // The tenant predicate is written out by hand because RoleAssignment has no
    // institutionId for the query layer to filter on — it reaches its tenant
    // only through Role -> Organization, a join the extension cannot add
    // (registry.ts records exactly this under UNENFORCEABLE.reachableVia).
    // Without it the open scope filters the deliverables and not the people,
    // so one institution's deadlines would be mailed to another's officers.
    const assignments = await db.roleAssignment.findMany({
      where: {
        status: { in: ["ACTIVE", "SHADOW"] },
        role: { organization: { institutionId: scope.institutionId } },
      },
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
  // `jobId` and `attempt` are added rather than substituted — a scheduler that
  // retried needs to be able to tie the second response to the first, and a
  // support question about a duplicate notification has nothing else to join on.
  return Response.json({
    jobId: job.jobId,
    attempt: job.attempt,
    idempotencyKey: job.idempotencyKey,
    checked: perInstitution.reduce((n, r) => n + r.checked, 0),
    notified: perInstitution.reduce((n, r) => n + r.notified, 0),
    deliverables: perInstitution.flatMap((r) => r.deliverables),
  })
}
