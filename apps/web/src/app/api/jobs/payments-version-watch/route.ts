import { randomUUID } from "node:crypto"

import { ContractViolation, parseJobRequest, type JobRequest } from "@tenure/contracts"
import {
  PROVIDER,
  PROVIDER_API_VERSION,
  watchProviderApiVersion,
  watchProviderFeatures,
} from "@tenure/payments"

/**
 * PAY-010-007 — the provider feature and version watch, invoked.
 *
 * Bible §3 wants provider changes to create REVIEW TASKS and Bible §16 wants
 * API upgrades to be intentional. This is the scheduled half of that: something
 * has to notice the provider moved, and the thing that notices must not be the
 * thing that adopts.
 *
 * So this route is deliberately the narrowest kind of job in the tree. It takes
 * no database connection, opens no tenant scope, and calls two pure functions in
 * `@tenure/payments`. There is no writer in its import graph. The response says
 * `mutatesProduction: false` as a value rather than as a promise in a comment,
 * because that claim is the one whoever reads a scheduler log most needs, and a
 * comment does not travel into a log.
 *
 * ## The candidate version is an input, and its absence is an error
 *
 * `announcedApiVersion` is required. Defaulting it to `PROVIDER_API_VERSION`
 * would be the cheapest possible bug in this file: every leaf is reviewed under
 * the pin, so the report would come back with zero tasks and a scheduler that
 * had been fed nothing would look exactly like a provider that had changed
 * nothing. "We could not look" and "we looked and found nothing" are different
 * answers; this returns 400 for the first.
 *
 * ## Why it does not persist the tasks
 *
 * There is no review-task table in this schema, and inventing one under a job
 * route is not a schema decision a scheduled endpoint should make. The tasks are
 * returned, addressed to the `payments-operations` queue by the package that
 * raises them, and the withdrawal they describe happens WITHOUT them:
 * `capabilityState` resolves a leaf outside its reviewed API window to
 * `UNSUPPORTED`, so an unadopted provider version fails closed whether or not
 * anybody reads this response.
 */

export const dynamic = "force-dynamic"

const JOB_NAME = "payments-provider-version-watch"

function jobRequestFrom(supplied: Record<string, unknown>, now: Date): JobRequest {
  const dayWindow = now.toISOString().slice(0, 10)
  return parseJobRequest({
    jobId: supplied.jobId ?? randomUUID(),
    name: JOB_NAME,
    // A provider's API version is a platform fact, not a tenant's. This run
    // belongs to no institution and does not enter one's scope.
    tenantId: null,
    // The day. A provider announcement does not change hourly, and an
    // hour-wide key would give twenty-four identical runs distinct identities.
    idempotencyKey: supplied.idempotencyKey ?? `${JOB_NAME}:${dayWindow}`,
    scheduledFor: supplied.scheduledFor ?? now.toISOString(),
    attempt: supplied.attempt ?? 1,
    maxAttempts: supplied.maxAttempts ?? 3,
    payload: {},
  })
}

/** Every entry of `value` that is a non-empty string, or null if it is not a list. */
function stringList(value: unknown): string[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value)) return null
  const out: string[] = []
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim() === "") return null
    out.push(entry.trim())
  }
  return out
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

  const body = await request.json().catch(() => ({}))
  const supplied = body && typeof body === "object" ? (body as Record<string, unknown>) : {}

  const announced = supplied.announcedApiVersion
  if (typeof announced !== "string" || announced.trim() === "") {
    return Response.json(
      {
        error: "announced_api_version_required",
        detail:
          `This watch compares what the provider announces against what Tenure has reviewed, so ` +
          `the announced version is an input. Defaulting it to the pinned ${PROVIDER_API_VERSION} ` +
          `would report zero review tasks, which is what a run over an unchanged provider looks ` +
          `like — an unfed watcher must not be indistinguishable from a quiet one.`,
        pinnedVersion: PROVIDER_API_VERSION,
      },
      { status: 400 },
    )
  }

  const announcedEventTypes = stringList(supplied.announcedEventTypes)
  const announcedCapabilityIds = stringList(supplied.announcedCapabilityIds)
  if (announcedEventTypes === null || announcedCapabilityIds === null) {
    return Response.json(
      {
        error: "announced_features_unreadable",
        detail:
          `announcedEventTypes and announcedCapabilityIds must each be a list of non-empty ` +
          `strings when present. A malformed list read as an empty one would report nothing new.`,
      },
      { status: 400 },
    )
  }

  let job: JobRequest
  try {
    job = jobRequestFrom(supplied, new Date())
  } catch (err) {
    if (err instanceof ContractViolation) {
      return Response.json({ error: "invalid_job_request", detail: err.message }, { status: 400 })
    }
    throw err
  }

  let report: ReturnType<typeof watchProviderApiVersion>
  try {
    report = watchProviderApiVersion(announced.trim())
  } catch (err) {
    // An unparseable candidate. Refused rather than compared, because a version
    // that is not a provider date version sorts as older than everything and
    // would produce an empty task list.
    return Response.json(
      {
        error: "announced_api_version_unreadable",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 400 },
    )
  }

  const featureTasks = watchProviderFeatures(announcedEventTypes, announcedCapabilityIds)

  return Response.json({
    jobId: job.jobId,
    attempt: job.attempt,
    idempotencyKey: job.idempotencyKey,
    provider: PROVIDER,
    pinnedVersion: report.pinnedVersion,
    candidateVersion: report.candidateVersion,
    mutatesProduction: report.mutatesProduction,
    alreadyReviewed: report.alreadyReviewed.length,
    notApplicable: report.notApplicable.length,
    versionReviewTasks: report.tasks,
    featureReviewTasks: featureTasks,
    // Something has to decide that there is work; deciding it in the scheduler
    // would put the threshold somewhere nobody reviews beside the tasks.
    reviewRequired: report.tasks.length > 0 || featureTasks.length > 0,
    withdrawsMoneyFacingCapability: report.tasks.some((t) => t.withdrawsMoneyFacingCapability),
  })
}
