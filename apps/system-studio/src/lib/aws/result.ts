/**
 * STUDIO-130-002 — the HTTP face of the AWS-backed surfaces: which surfaces
 * exist, what each may cost a caller, and the one union every read returns.
 *
 * ## One union, two import paths
 *
 * `AwsRead<T>` is declared in `./read` and re-exported here, exactly as that
 * module's header says. Two overlapping unions would be two vocabularies to
 * keep in step — the failure the vocabulary exists to prevent — so this file
 * adds no result type of its own. What it adds is the HTTP layer's own
 * concerns: the surface catalog and the per-caller budget.
 *
 * ## Budgets are per surface, and deliberately unequal
 *
 * `./throttle` is about AWS asking US to slow down. This is the opposite
 * direction: a caller polling this control plane. One global limit would either
 * throttle the cheap surfaces pointlessly or leave the expensive one open —
 * Cost Explorer is billed per request and is the cheapest surface to run up a
 * bill on, a DynamoDB Query is not. Each surface names its own budget, and the
 * 429 cites the name.
 */

export {
  UNRESOLVED_PRINCIPAL,
  describeRead,
  errorName,
  httpStatusFor,
  isDenial,
  isThrottle,
  isUnknown,
  itemsOf,
  liveGateway,
  minimumStatement,
  minimumStatementText,
  readAws,
  safeDetail,
  type AwsGateway,
  type AwsRead,
  type DenialContext,
  type ReadOptions,
} from "./read"

/**
 * The surfaces `/api/aws/<surface>` exposes. An unknown id is a 404 problem
 * document rather than a 500, because "there is no such surface" is a fact the
 * caller can act on.
 */
export const SURFACES = {
  /** The tenant registry, read out of DynamoDB. */
  fleet: {
    /** Requests per operator per window. */
    budget: 60,
    windowMs: 60_000,
    /** What it actually calls, for the 429 message and the audit row. */
    awsAction: "dynamodb:Scan",
  },
  /** One tenant's long-running operations (STUDIO-130-005). */
  operations: {
    budget: 120,
    windowMs: 60_000,
    awsAction: "dynamodb:Query",
  },
  /**
   * Cost. An order of magnitude lower than the others, on purpose: Cost
   * Explorer charges per request, and a dashboard left open on a five-second
   * refresh is a bill nobody decided to incur.
   */
  cost: {
    budget: 6,
    windowMs: 60_000,
    awsAction: "ce:GetCostAndUsageWithResources",
  },
} as const

export type SurfaceId = keyof typeof SURFACES

export function isSurfaceId(value: string): value is SurfaceId {
  return Object.prototype.hasOwnProperty.call(SURFACES, value)
}

/**
 * A fixed-window counter, per operator per surface.
 *
 * In memory, and honest about it: this console runs as one container, so one
 * process is the whole fleet of it. A distributed limiter needs a store that
 * does not exist yet, and a limiter that resets per instance while claiming a
 * global budget is worse than one whose scope is written down.
 */
const counters = new Map<string, { count: number; resetAt: number }>()

export interface RateDecision {
  allowed: boolean
  /** Seconds until the window rolls. Sent as `Retry-After`. */
  retryAfterSeconds: number
  limit: number
  remaining: number
}

export function consumeRate(surface: SurfaceId, principal: string, now = Date.now()): RateDecision {
  const { budget, windowMs } = SURFACES[surface]
  const key = `${surface}:${principal}`
  const existing = counters.get(key)

  if (!existing || existing.resetAt <= now) {
    counters.set(key, { count: 1, resetAt: now + windowMs })
    return {
      allowed: true,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
      limit: budget,
      remaining: budget - 1,
    }
  }

  existing.count += 1
  const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
  return {
    allowed: existing.count <= budget,
    retryAfterSeconds,
    limit: budget,
    remaining: Math.max(0, budget - existing.count),
  }
}

/** For tests, which need a clean window rather than whatever the last one left. */
export function __resetRates(): void {
  counters.clear()
}
