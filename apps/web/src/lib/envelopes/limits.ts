/**
 * GE-021-007 — conditional operations, rate limits, quotas, and bulk jobs.
 *
 * Four small mechanisms that share one property: each one is a *decision*, kept
 * free of storage and clocks so it can be tested against the cases that go
 * wrong. The counters live behind ports; what to do with them lives here.
 */

// ── Conditional operations ──────────────────────────────────────────────────

export type Precondition =
  | { kind: "if-match"; etag: string }
  | { kind: "if-none-match"; etag: string }
  | { kind: "none" }

export type PreconditionResult =
  | { proceed: true }
  | { proceed: false; status: 412 | 304; reason: string }

/**
 * Evaluate a conditional request.
 *
 * `if-match` is the write guard: proceed only if the resource is still what the
 * caller last saw. `if-none-match` is the read guard: a caller holding the
 * current version gets 304 instead of the body.
 *
 * A missing precondition on a WRITE is deliberately allowed here rather than
 * refused — requiring one universally would break every form post — but
 * `requirePrecondition` exists for the paths that should demand it, and naming
 * those paths is a decision, not a default.
 */
export function evaluatePrecondition(
  condition: Precondition,
  currentEtag: string | null,
): PreconditionResult {
  if (condition.kind === "none") return { proceed: true }

  if (condition.kind === "if-match") {
    // A resource that no longer exists cannot match. Treated as a failed
    // precondition rather than "not found", because the caller's assumption —
    // that it was still there — is exactly what failed.
    if (currentEtag === null) {
      return { proceed: false, status: 412, reason: "That no longer exists." }
    }
    if (currentEtag !== condition.etag) {
      return {
        proceed: false,
        status: 412,
        reason: "This changed since you loaded it. Reload and try again.",
      }
    }
    return { proceed: true }
  }

  // if-none-match
  if (currentEtag !== null && currentEtag === condition.etag) {
    return { proceed: false, status: 304, reason: "Not modified." }
  }
  return { proceed: true }
}

/** For paths where a blind overwrite is not acceptable. */
export function requirePrecondition(condition: Precondition): void {
  if (condition.kind !== "if-match") {
    throw new Error(
      "This operation requires an If-Match precondition. Without one, a write silently overwrites " +
        "whatever changed since the caller last read.",
    )
  }
}

// ── Rate limits ─────────────────────────────────────────────────────────────

export interface RateLimitDecision {
  allowed: boolean
  /** Requests remaining in this window. */
  remaining: number
  /** When the window resets, ISO-8601. */
  resetAt: string
  /** Seconds to wait. Only meaningful when denied. */
  retryAfterSeconds: number
}

/**
 * A fixed-window limiter, and an honest note about what that means.
 *
 * A fixed window allows up to 2× the limit across a window boundary — all of
 * one window's budget at its end and all of the next at its start. A sliding
 * window does not, and costs more state.
 *
 * That is acceptable here and would not be for, say, a login endpoint: this
 * protects capacity, where a brief 2× is survivable, rather than gating an
 * attack, where it is the whole game. Written down because the next person to
 * read this will otherwise assume it is a sliding window.
 */
export function evaluateRateLimit(input: {
  count: number
  limit: number
  windowStart: string
  windowMs: number
  now: string
}): RateLimitDecision {
  const { count, limit, windowMs } = input
  const start = Date.parse(input.windowStart)
  const now = Date.parse(input.now)

  const elapsed = now - start
  const resetMs = start + windowMs
  const resetAt = new Date(resetMs).toISOString()

  // The window has already rolled; the stored count belongs to a window that
  // no longer applies.
  if (elapsed >= windowMs) {
    return {
      allowed: true,
      remaining: limit - 1,
      resetAt: new Date(now + windowMs).toISOString(),
      retryAfterSeconds: 0,
    }
  }

  const allowed = count < limit
  return {
    allowed,
    remaining: Math.max(0, limit - count - (allowed ? 1 : 0)),
    resetAt,
    // Rounded UP: telling a caller to wait 0 seconds when 400ms remain produces
    // an immediate retry that is denied again.
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((resetMs - now) / 1000)),
  }
}

// ── Quotas ──────────────────────────────────────────────────────────────────

export interface QuotaDecision {
  allowed: boolean
  used: number
  limit: number
  /** True when this request takes the tenant over a threshold worth telling them about. */
  crossedWarningThreshold: boolean
  reason: string | null
}

/** Warn here rather than at the wall, so a tenant has time to act. */
export const QUOTA_WARNING_RATIO = 0.8

/**
 * Evaluate a quota consumption.
 *
 * A quota differs from a rate limit in that exceeding it is a *plan* problem,
 * not a *pace* problem — so a denial says what to do about it, and the caller
 * gets no `retryAfter`, because waiting will not help.
 */
export function evaluateQuota(input: {
  used: number
  limit: number
  requesting: number
}): QuotaDecision {
  const { used, limit, requesting } = input

  if (requesting < 1) {
    throw new Error("A quota check must request at least one unit.")
  }

  const after = used + requesting
  const allowed = after <= limit

  return {
    allowed,
    used,
    limit,
    // Only when THIS request crosses it. Reporting it on every subsequent
    // request turns a useful warning into noise that gets filtered out.
    crossedWarningThreshold:
      allowed && used < limit * QUOTA_WARNING_RATIO && after >= limit * QUOTA_WARNING_RATIO,
    reason: allowed
      ? null
      : `This would use ${after} of ${limit}. Waiting will not help — the limit is on the plan, not the pace.`,
  }
}

// ── Async bulk jobs ─────────────────────────────────────────────────────────

export type BulkJobState = "accepted" | "running" | "succeeded" | "failed" | "cancelled"

export interface BulkJobStatus {
  jobId: string
  state: BulkJobState
  total: number
  processed: number
  failed: number
  /** Where to fetch the result. Present only once it exists. */
  resultRef: string | null
  /** Why it failed or was cancelled. Required for those states. */
  reason: string | null
}

const TERMINAL: readonly BulkJobState[] = ["succeeded", "failed", "cancelled"]

/**
 * Validate a bulk-job status before it is reported.
 *
 * The mistakes this catches are all of one kind: a status that claims something
 * the numbers contradict. A caller polls this to decide whether to keep
 * waiting, and a job that reports `succeeded` with half its items unprocessed
 * sends them away with an incomplete result they believe is complete.
 */
export function validateBulkJobStatus(status: BulkJobStatus): BulkJobStatus {
  const fail = (why: string): never => {
    throw new Error(`BulkJobStatus: ${why}`)
  }

  // Negatives first. Every comparison below assumes the counts are counts, and
  // a negative one satisfies "failed exceeds processed" for the wrong reason —
  // reporting a relationship problem where the actual problem is that a number
  // is nonsense. Found by a test asserting the negative message and getting the
  // relational one.
  if (status.processed < 0 || status.failed < 0 || status.total < 0) fail("counts cannot be negative")
  if (status.processed > status.total) fail("processed exceeds total")
  if (status.failed > status.processed) fail("failed exceeds processed")

  if (status.state === "succeeded") {
    if (status.processed !== status.total) {
      fail("succeeded with items unprocessed — a caller would take an incomplete result as complete")
    }
    if (status.failed > 0) {
      fail("succeeded with failures — use failed, or report partial success explicitly")
    }
    if (!status.resultRef) fail("succeeded with nothing to fetch")
  }

  if ((status.state === "failed" || status.state === "cancelled") && !status.reason) {
    fail(`${status.state} with no reason`)
  }

  if (!TERMINAL.includes(status.state) && status.resultRef) {
    fail("a result exists before the job finished")
  }

  return status
}

export function isTerminal(state: BulkJobState): boolean {
  return TERMINAL.includes(state)
}
