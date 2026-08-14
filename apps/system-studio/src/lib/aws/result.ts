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

import { CAPABILITIES, type Capability } from "./capabilities"

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

/* ------------------------------------------------- the polling allowance -- */

/**
 * STUDIO-140-007 — how a surface's poll budget is DERIVED rather than picked.
 *
 * Every capability in `./capabilities` already carries `refreshMs`: the
 * interval its own author argued for, resource by resource, with the reasoning
 * written beside the constant. `SQS_DEPTH_TTL_MS` is ten seconds because a
 * dead-letter queue that became non-empty thirty seconds ago is a delivery that
 * already failed; `ACM_TTL_MS` is an hour because certificates renew on a
 * sixty-day horizon. Re-typing a rate limit at the HTTP layer would be a second
 * opinion about the same resource, and the one somebody forgets to update is the
 * one that either throttles the console or runs up the account.
 *
 * So the HTTP window is a FUNCTION of that cadence, and the only judgement this
 * file adds is the three numbers below — stated once, applied uniformly.
 */

/**
 * How many reads an operator may make inside one window.
 *
 * Four, because a well-behaved client makes one per window: the other three are
 * a page load, a second tab, and a manual refresh after something looked wrong.
 * It is a ceiling on abuse, not a substitute for the cadence — the cadence
 * travels to the client on every response (`x-aws-refresh-ms`), which is what a
 * poller is expected to obey.
 */
export const POLL_BURST = 4

/**
 * The floor. A capability faster than this does not get a sub-30-second window:
 * a fixed-window counter that resets every ten seconds is barely a limit, and
 * `Retry-After: 3` invites the hot loop it exists to stop. Instead the window
 * stays at thirty seconds and the BUDGET rises to match the cadence — see
 * `pollBudgetFor`.
 */
export const MIN_POLL_WINDOW_MS = 30_000

/**
 * The ceiling, and the humane end of the trade.
 *
 * Nine of the surfaces below read capabilities that refresh hourly or slower —
 * a price list is a day, an applied quota is six hours. Windowing those at their
 * own cadence would answer an operator's fifth page load in an hour with
 * `Retry-After: 3400`, which is a console that appears broken. Fifteen minutes
 * is the longest window that still lets a person work.
 */
export const MAX_POLL_WINDOW_MS = 15 * 60_000

export interface PollBudget {
  /** The fixed window the counter resets on. */
  windowMs: number
  /** Requests admitted per operator per window. */
  budget: number
}

/**
 * The window and budget a cadence earns.
 *
 * Two things follow from one number, and both directions matter:
 *
 *   * Slower than the ceiling — the window is the ceiling and the budget is the
 *     burst. Certificates, compliance rules, hosted zones, detectors, accounts,
 *     quotas and price lists all land here, and they land on the SAME window
 *     because they genuinely share a horizon. Identical inputs producing
 *     identical windows is the point; what is forbidden is one number spanning a
 *     ten-second queue depth and a twenty-four-hour price list, which is how a
 *     console both throttles the account and shows stale numbers.
 *   * Faster than the floor — the window is the floor, and the budget is the
 *     burst multiplied by the number of the capability's own refreshes that fit
 *     inside it. A ten-second cadence in a thirty-second window earns twelve,
 *     not four, because four would refuse a client polling at exactly the rate
 *     the registry told it to poll at.
 */
export function pollBudgetFor(refreshMs: number): PollBudget {
  const windowMs = Math.min(MAX_POLL_WINDOW_MS, Math.max(MIN_POLL_WINDOW_MS, refreshMs))
  const refreshesPerWindow = Math.max(1, Math.floor(windowMs / refreshMs))
  return { windowMs, budget: POLL_BURST * refreshesPerWindow }
}

/** What `/api/aws/<surface>` needs to know about one surface. */
export interface SurfaceBudget {
  /** Requests per operator per window. */
  readonly budget: number
  readonly windowMs: number
  /** What it actually calls, for the 429 message and the audit row. */
  readonly awsAction: string
  /**
   * The capability whose reading this surface serves, or null for the three
   * registry-era surfaces that are not backed by one.
   *
   * Non-null is what makes a surface LIVE: the route reads it through the
   * capability's own module and reports the read's state rather than its rows.
   */
  readonly capability: Capability | null
  /** The capability's declared cadence, published to the client. Null when there is none. */
  readonly refreshMs: number | null
}

/**
 * A live surface's entry, derived end to end from the capability it serves.
 *
 * Nothing here is typed twice: the action comes from the capability's own
 * `iamActions[0]` — the same string a denial renders and the same string
 * `studio-task-role-is-narrow` compares the Terraform against — and the budget
 * comes from its own `refreshMs`.
 */
function live(capability: Capability): SurfaceBudget {
  const { refreshMs, iamActions } = CAPABILITIES[capability]
  const { windowMs, budget } = pollBudgetFor(refreshMs)
  return { budget, windowMs, awsAction: iamActions[0], capability, refreshMs }
}

/**
 * The surfaces `/api/aws/<surface>` exposes. An unknown id is a 404 problem
 * document rather than a 500, because "there is no such surface" is a fact the
 * caller can act on.
 *
 * This is a CLOSED table, and that is the whole security property. Bible §20
 * forbids a generic "AWS action runner" endpoint, and the way this route stays
 * on the right side of that line is that a caller names a surface from this
 * list, the route switches on it, and the module behind it calls one named
 * capability with input the module itself narrowed. There is no path from a
 * query string to an SDK command, and adding one would mean editing this table,
 * the switch in `route.ts`, and the IAM grant — three files a reviewer reads.
 */
export const SURFACES = {
  /** The tenant registry, read out of DynamoDB. */
  fleet: {
    /** Requests per operator per window. */
    budget: 60,
    windowMs: 60_000,
    /** What it actually calls, for the 429 message and the audit row. */
    awsAction: "dynamodb:Scan",
    capability: null,
    refreshMs: null,
  },
  /** One tenant's long-running operations (STUDIO-130-005). */
  operations: {
    budget: 120,
    windowMs: 60_000,
    awsAction: "dynamodb:Query",
    capability: null,
    refreshMs: null,
  },
  /**
   * Cost. An order of magnitude lower than the others, on purpose: Cost
   * Explorer charges per request, and a dashboard left open on a five-second
   * refresh is a bill nobody decided to incur.
   *
   * Not derived, and `capability` is null on purpose: this surface is served by
   * `costSource()`, which reads a Cost and Usage Report out of S3. The action
   * named below is the API the budget was reasoned about, not one this route
   * calls — so there is no `refreshMs` in the capability registry that would be
   * telling the truth about it.
   */
  cost: {
    budget: 6,
    windowMs: 60_000,
    awsAction: "ce:GetCostAndUsageWithResources",
    capability: null,
    refreshMs: null,
  },

  /* ── live surfaces, each derived from its capability's own cadence ──────── */

  /** Edge distributions and the origins they front. `src/lib/aws/cdn.ts`. */
  cdn: {
    ...live("cloudfront:ListDistributions"),
  },
  /** Certificates, their validation state and their expiry. `src/lib/aws/certificates.ts`. */
  certificates: {
    ...live("acm:ListCertificates"),
  },
  /** Config rules and their verdicts. `src/lib/aws/compliance.ts`. */
  compliance: {
    ...live("config:DescribeConfigRules"),
  },
  /** The dashboards this account has, and what they watch. `src/lib/aws/dashboards.ts`. */
  dashboards: {
    ...live("cloudwatch:ListDashboards"),
  },
  /** Hosted zones, their records and the takeover risk in them. `src/lib/aws/dns.ts`. */
  dns: {
    ...live("route53:ListHostedZones"),
  },
  /** Whether anything is watching, and what it found. `src/lib/aws/guardduty.ts`. */
  guardduty: {
    ...live("guardduty:ListDetectors"),
  },
  /** Log groups, their retention and their encryption. `src/lib/aws/logs.ts`. */
  logs: {
    ...live("logs:DescribeLogGroups"),
  },
  /** The accounts in the Organization. `src/lib/aws/organization.ts`. */
  organization: {
    ...live("organizations:ListAccounts"),
  },
  /** List prices for the shapes a tenant can be given. `src/lib/aws/pricing.ts`. */
  pricing: {
    ...live("pricing:GetProducts"),
  },
  /** Applied quotas and the headroom left in them. `src/lib/aws/quotas.ts`. */
  quotas: {
    ...live("servicequotas:ListServiceQuotas"),
  },
  /** Web ACLs and what they are actually attached to. `src/lib/aws/waf.ts`. */
  waf: {
    ...live("wafv2:ListWebACLs"),
  },
} as const

export type SurfaceId = keyof typeof SURFACES

/**
 * A surface whose rows come from a capability read rather than from the
 * registry or the cost source.
 *
 * Narrowed by the `capability` field rather than by a second list, so a surface
 * cannot be live in one place and not in another.
 */
export type LiveSurfaceId = {
  [K in SurfaceId]: (typeof SURFACES)[K]["capability"] extends null ? never : K
}[SurfaceId]

export function isLiveSurface(surface: SurfaceId): surface is LiveSurfaceId {
  return SURFACES[surface].capability !== null
}

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
