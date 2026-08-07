import { randomUUID } from "node:crypto"
import { ContractViolation, parseJobRequest, type JobRequest } from "@tenure/contracts"

import { forEachInstitution } from "@/lib/tenant-scope"
import { dispatchOnce, gaps, type DispatchReport, type GapReport } from "@/lib/outbox/outbox"
import { prismaOutboxPorts } from "@/lib/outbox/prisma-ports"

/**
 * PAY-020-005 / PAY-140-007 — the dispatcher, invoked.
 *
 * The outbox has had a producer since GE-021-006: `approvals/actions.ts` writes
 * an `OutboxEvent` inside the transaction that moves an approval, so "the row
 * changed" and "the event exists" cannot disagree. What it has never had is
 * anything that drains it. `dispatchOnce` and `replay` were real
 * implementations whose only importer was their own unit test, so every event
 * ever emitted sat at `state = 'pending'` forever — an event gap per approval,
 * accumulating silently because nothing counted them either.
 *
 * This route is the production caller. Modelled on the reminders job next door,
 * for the same reasons it is built that way: no user is behind it, so the
 * tenant cannot come from a session and the sweep runs once per institution
 * inside that institution's own scope; the bearer token authenticates the
 * caller and not the numbers in its body, so the envelope is parsed rather than
 * trusted; and the derived `idempotencyKey` names the window this run covers so
 * two invocations of one schedule can be joined on.
 *
 * The response carries counts and never an event payload. A dispatcher's log is
 * one of the sinks PAY-020-006 names, and the fastest way to leak a provider's
 * body is to echo what was delivered into a JSON response somebody pipes into a
 * logging stack.
 */

export const dynamic = "force-dynamic"

const JOB_NAME = "outbox-dispatch"

/** Records per institution per pass. Bounded so one busy tenant cannot starve the rest. */
const BATCH = 50

function jobRequestFrom(body: unknown, now: Date): JobRequest {
  const supplied = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  const minuteWindow = now.toISOString().slice(0, 16)

  return parseJobRequest({
    jobId: supplied.jobId ?? randomUUID(),
    name: JOB_NAME,
    // Null for the same reason the reminder sweep's is: this runs once per
    // institution inside each institution's own scope, so no single tenant owns
    // the invocation.
    tenantId: null,
    // The minute rather than the hour. Dispatch runs far more often than a
    // daily reminder sweep, and an hour-wide key would give sixty unrelated
    // runs the same identity.
    idempotencyKey: supplied.idempotencyKey ?? `${JOB_NAME}:${minuteWindow}`,
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
    if (err instanceof ContractViolation) {
      return Response.json({ error: "invalid_job_request", detail: err.message }, { status: 400 })
    }
    throw err
  }

  const at = now.toISOString()

  const perInstitution = await forEachInstitution(JOB_NAME, async (scope) => {
    const ports = prismaOutboxPorts({ institutionId: scope.institutionId })

    const report = await dispatchOnce(ports, { now: at, limit: BATCH })

    // Measured AFTER the pass, from the table rather than from the run.
    // `dispatchOnce` reports what it did, and what it did is indistinguishable
    // from what a broken schedule does: both report zeros. What is still due
    // once a pass has finished is the number that says whether delivery is
    // keeping up.
    const gap = await gaps(ports, { now: at })

    return { institutionId: scope.institutionId, report, gap }
  })

  const sum = (pick: (r: DispatchReport) => number) =>
    perInstitution.reduce((n, r) => n + pick(r.report), 0)
  const sumGap = (pick: (g: GapReport) => number) =>
    perInstitution.reduce((n, r) => n + pick(r.gap), 0)

  return Response.json({
    jobId: job.jobId,
    attempt: job.attempt,
    idempotencyKey: job.idempotencyKey,
    claimed: sum((r) => r.claimed),
    dispatched: sum((r) => r.dispatched),
    retried: sum((r) => r.retried),
    deadLettered: sum((r) => r.deadLettered),
    // The reconciliation half, in the same response: an operator watching this
    // job sees both "what moved" and "what is still stuck", and an alert can be
    // written against the second without a second endpoint.
    overdue: sumGap((g) => g.overdue),
    dead: sumGap((g) => g.dead),
    oldestOverdueByMs: perInstitution.reduce((max, r) => Math.max(max, r.gap.oldestOverdueByMs), 0),
  })
}
