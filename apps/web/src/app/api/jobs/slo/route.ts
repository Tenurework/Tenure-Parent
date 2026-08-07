import { randomUUID } from "node:crypto"

import type { ApprovalStatus } from "@prisma/client"
import { ContractViolation, parseJobRequest, type JobRequest } from "@tenure/contracts"
import { sloBurn, type ModuleSlo, type SloMeasurement } from "@tenure/module-runtime"
import { MODULE_CATALOG } from "@tenure/modules"
import { localizationFor } from "@tenure/platform-config"

import { approvalSla, PENDING_STATES } from "@/lib/approvals-sla"
import { db } from "@/lib/db"
import { forEachInstitution } from "@/lib/tenant-scope"

/**
 * WRK-120-003 — evaluates the declared service objectives against the fleet.
 *
 * Until this existed, `observability-slo-and-finops` was a gap on all twelve
 * modules and there was nothing anywhere that could have made one true: no
 * objective, no error budget, no evaluator. `apps/web/src/lib/approvals-sla.ts`
 * had computed a per-request SLA since the queue first had a page — so a
 * request could be six working days overdue, be rendered in red, and be seen by
 * precisely nobody who had not opened `/approvals`.
 *
 * This closes the aggregate. It reads the objective off the `approvals` module
 * manifest — not a constant here, because a target somebody can change in a
 * route without changing the module's declared promise is two numbers — and
 * reports the burn per institution.
 *
 * ## Per tenant, not per fleet
 *
 * `forEachInstitution` runs the pass once inside each institution's own scope.
 * Two reasons, and the second is the load-bearing one:
 *
 *   * a cron has no session, so the tenant cannot be derived from a user, and a
 *     single query across every institution's approvals is N per-tenant reads
 *     that were never separated;
 *   * an objective averaged over the fleet is an objective a large tenant
 *     satisfies on behalf of a small one that has stopped entirely. WRK-120-003
 *     asks for provider/tenant/capability SLOs; the tenant split IS that.
 *
 * ## Why the response is 200 when the objective is breached
 *
 * A non-2xx here would make the scheduler retry, and a stalled queue does not
 * become unstalled by asking again. The breach is data: `alert` is true,
 * `runbook` names the document to open, and `breaching` carries the request ids
 * so the first thing whoever is paged does is not a database query.
 */

export const dynamic = "force-dynamic"

const JOB_NAME = "slo-burn"

/** The module whose objectives this job evaluates. */
const MODULE_KEY = "approvals"
const OBJECTIVE = "a pending approval is decided within its SLA"

/**
 * The objective, off the manifest.
 *
 * Read at call time rather than at module load so a catalog change is picked up
 * by a running task, and refused loudly rather than defaulted: an SLO job that
 * silently invents a target when the declaration is missing is a green
 * dashboard for an objective nobody declared.
 */
function declaredObjective(): ModuleSlo | null {
  const manifest = MODULE_CATALOG.get(MODULE_KEY)
  return manifest?.slo?.find((s) => s.objective === OBJECTIVE) ?? null
}

function jobRequestFrom(body: unknown, now: Date): JobRequest {
  const supplied = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  const hourWindow = now.toISOString().slice(0, 13)

  return parseJobRequest({
    jobId: supplied.jobId ?? randomUUID(),
    name: JOB_NAME,
    // Null for the same reason the reminder sweep's is: the run belongs to no
    // single tenant, it visits every one of them inside its own scope.
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

  const objective = declaredObjective()
  if (!objective) {
    // 503, not 200-with-a-zero. "The module declares no such objective" and
    // "the objective was met" must not look the same to whatever reads this.
    return Response.json(
      {
        error: "no_declared_objective",
        detail:
          `The "${MODULE_KEY}" module manifest declares no objective ${JSON.stringify(OBJECTIVE)}. ` +
          `This job evaluates what the catalog promises; with nothing declared there is nothing ` +
          `to evaluate, and reporting "met" would be an invented pass.`,
      },
      { status: 503 },
    )
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

  const perInstitution = await forEachInstitution(JOB_NAME, async (scope) => {
    // The tenant's own calendar. A request is aged in WORKING days
    // (GE-022-004), and an institution whose weekend is Friday–Saturday would
    // otherwise be measured against somebody else's week — the objective would
    // breach on their weekend and clear on their working days.
    const institution = await db.institution.findUnique({
      where: { id: scope.institutionId },
      select: { slug: true },
    })
    const calendar = localizationFor(institution?.slug ?? "").businessCalendar

    const open = await db.approvalRequest.findMany({
      // Derived from the one list `approvals-sla.ts` ages against, never
      // retyped here: a status the page treats as pending and this query does
      // not is a request that is late on screen and invisible to the objective.
      where: { status: { in: [...PENDING_STATES] as ApprovalStatus[] } },
      select: { id: true, status: true, updatedAt: true },
    })

    // One measurement per open request: it either met the objective or did not.
    // `updatedAt` is what the page ages from — time in the CURRENT gate, not
    // since submission — so the aggregate and the row a person opens cannot
    // disagree about which requests are late.
    const measurements: SloMeasurement[] = open.map((request) => ({
      subject: request.id,
      good: approvalSla(request.status, request.updatedAt, now, calendar).level !== "overdue",
    }))

    return { institutionId: scope.institutionId, ...sloBurn(measurements, objective) }
  })

  const breached = perInstitution.filter((t) => !t.met)

  return Response.json({
    jobId: job.jobId,
    attempt: job.attempt,
    idempotencyKey: job.idempotencyKey,
    module: MODULE_KEY,
    objective: objective.objective,
    target: objective.target,
    window: objective.window,
    measure: objective.measure,
    runbook: objective.runbook,
    tenants: perInstitution,
    breachedTenants: breached.length,
    // The alert itself. Something has to decide, and deciding in the scheduler
    // would put the threshold in a place nobody reviews beside the objective.
    alert: breached.length > 0,
  })
}
