/**
 * GE-030-004 — plans, entitlements, quotas, usage meters and billing metadata.
 *
 * Entitlements already existed as bare strings that `module-runtime` checks. What
 * did not exist is where a tenant's strings come from: a contracted plan, with
 * an activation window, quota limits, and a commercial relationship that can
 * lapse. "Which modules may this tenant run" was answerable; "why, and until
 * when" was not.
 *
 * ## Two rules that shape everything here
 *
 * **A quota check fails closed.** An unknown dimension, or a meter with no
 * reading, is not "under the limit" — it is "we do not know", and treating the
 * two the same is how an unmetered dimension becomes unlimited in production
 * while looking enforced in code.
 *
 * **A downgrade refuses new work; it never destroys existing work.** A tenant
 * that drops to a plan allowing 10 organizations while holding 25 is over
 * quota. The correct behaviour is to refuse the 26th, not to delete 15 — and
 * the enum says so, because `OVER_LIMIT` and `AT_LIMIT` are different answers
 * and only one of them is a reason to stop a create.
 *
 * From the bible §14: "Frontend entitlements improve UX but never provide
 * security." So `entitlementsFor` is the server's answer and
 * `commercialProjection` is what a UI may see; they are separate functions
 * because a single one gets used in both places and then leaks.
 */

/** A dimension a plan can put a number on. */
export type QuotaDimension =
  | "organizations"
  | "seats"
  | "storageGb"
  | "aiCallsPerMonth"
  | "connectors"

export const QUOTA_DIMENSIONS: readonly QuotaDimension[] = [
  "organizations",
  "seats",
  "storageGb",
  "aiCallsPerMonth",
  "connectors",
]

/**
 * How a limit behaves when it is reached.
 *
 * `hard` refuses. `soft` warns and lets the work through — which is right for a
 * dimension where refusing costs the customer more than the overage costs us,
 * and wrong everywhere else. Recorded per limit rather than per dimension,
 * because the same dimension is hard on one plan and soft on another.
 */
export type QuotaEnforcement = "hard" | "soft"

export interface QuotaLimit {
  dimension: QuotaDimension
  /** The number. `null` means explicitly unlimited — distinct from unset. */
  limit: number | null
  enforcement: QuotaEnforcement
}

export interface Plan {
  planId: string
  displayName: string
  /** Entitlement keys this plan grants. Consumed by `module-runtime`. */
  entitlements: readonly string[]
  quotas: readonly QuotaLimit[]
  /**
   * Minor units per month, in the tenant's contracted currency.
   *
   * `null` means no price has been agreed, which is not the same as free. The
   * distinction matters because 0 is a commercial statement — it says Tenure
   * gives this away — and a catalog that says that about a plan nobody has
   * priced is a catalog that is wrong in the direction of a refund claim.
   */
  monthlyPriceCents: number | null
  supportTier: "community" | "standard" | "priority"
}

/**
 * A tenant's commercial relationship.
 *
 * Separate from the plan because two tenants on the same plan can have
 * different contract windows, currencies and overrides, and folding them
 * together means editing a plan edits every tenant on it.
 */
export interface Contract {
  tenantId: string
  planId: string
  /** ISO date. Before this, the tenant is provisioned but not entitled. */
  activeFrom: string
  /** ISO date, or null for an open-ended contract. */
  activeUntil: string | null
  /** ISO 4217. May differ from the tenant's display currency. */
  billingCurrency: string
  /**
   * Entitlements granted beyond the plan, each with a reason.
   *
   * Unlike a feature flag — which may only restrict — a commercial override may
   * GRANT, because that is what a signed amendment is. The reason is required
   * for exactly that asymmetry: a grant nobody can explain is a grant nobody
   * can bill for or withdraw.
   */
  overrides: readonly { entitlement: string; reason: string; approvedBy: string }[]
}

/** A counted dimension, as last measured. */
export interface UsageMeter {
  tenantId: string
  dimension: QuotaDimension
  value: number
  /** When the count was taken. A stale meter is not a current one. */
  measuredAt: string
  /** The window it covers, for rate dimensions. Null for point-in-time counts. */
  periodStart: string | null
}

export interface CommercialProblem {
  field: string
  reason: string
  detail: string
}

export function validatePlan(plan: Plan): readonly CommercialProblem[] {
  const problems: CommercialProblem[] = []

  if (!plan.planId.trim()) {
    problems.push({ field: "planId", reason: "required", detail: "a plan needs an identifier" })
  }
  if (plan.monthlyPriceCents !== null && plan.monthlyPriceCents < 0) {
    problems.push({
      field: "monthlyPriceCents",
      reason: "invalid",
      detail: "a negative price is a credit, which is not a plan",
    })
  }

  const seen = new Set<QuotaDimension>()
  for (const quota of plan.quotas) {
    if (seen.has(quota.dimension)) {
      problems.push({
        field: "quotas",
        reason: "duplicate",
        // Two limits on one dimension means the answer depends on which is
        // read first, and both look correct in isolation.
        detail: `${quota.dimension} is limited twice`,
      })
    }
    seen.add(quota.dimension)

    if (quota.limit !== null && (!Number.isInteger(quota.limit) || quota.limit < 0)) {
      problems.push({
        field: "quotas",
        reason: "invalid",
        detail: `${quota.dimension}: a limit is a non-negative integer, or null for unlimited`,
      })
    }
  }

  return problems
}

export function validateContract(contract: Contract): readonly CommercialProblem[] {
  const problems: CommercialProblem[] = []

  const from = Date.parse(contract.activeFrom)
  if (Number.isNaN(from)) {
    problems.push({ field: "activeFrom", reason: "invalid", detail: "not a date" })
  }

  if (contract.activeUntil !== null) {
    const until = Date.parse(contract.activeUntil)
    if (Number.isNaN(until)) {
      problems.push({ field: "activeUntil", reason: "invalid", detail: "not a date" })
    } else if (!Number.isNaN(from) && until <= from) {
      problems.push({
        field: "activeUntil",
        reason: "invalid",
        // A window that closes before it opens entitles nothing, ever, and
        // presents as "the customer's features stopped working" with no
        // obvious cause.
        detail: "the contract ends before it begins",
      })
    }
  }

  if (!/^[A-Z]{3}$/.test(contract.billingCurrency)) {
    problems.push({
      field: "billingCurrency",
      reason: "invalid",
      detail: "an ISO 4217 code, uppercase",
    })
  }

  for (const override of contract.overrides) {
    if (!override.reason.trim() || !override.approvedBy.trim()) {
      problems.push({
        field: "overrides",
        reason: "required",
        // A grant nobody can explain is a grant nobody can bill for or
        // withdraw, and it outlives whoever added it.
        detail: `${override.entitlement}: an override needs a reason and an approver`,
      })
    }
  }

  return problems
}

/** Whether the contract is in force at an instant. */
export function contractIsActive(contract: Contract, at: Date): boolean {
  const from = Date.parse(contract.activeFrom)
  // An unparseable window is not an active one. Failing open here would entitle
  // a tenant whose contract nobody can read.
  if (Number.isNaN(from) || at.getTime() < from) return false
  if (contract.activeUntil === null) return true
  const until = Date.parse(contract.activeUntil)
  if (Number.isNaN(until)) return false
  return at.getTime() < until
}

/**
 * The entitlements a tenant actually holds, right now.
 *
 * The server's answer. Empty outside the contract window — a lapsed contract
 * entitles nothing, and returning the plan's list regardless would keep every
 * paid feature working for a customer who has stopped paying, silently.
 *
 * Sorted and de-duplicated so two callers comparing sets get the same answer.
 */
export function entitlementsFor(
  contract: Contract,
  plan: Plan | undefined,
  at: Date,
): readonly string[] {
  if (!plan) return []
  if (!contractIsActive(contract, at)) return []
  return [...new Set([...plan.entitlements, ...contract.overrides.map((o) => o.entitlement)])].sort()
}

export type QuotaVerdict =
  /** Below the limit. Work may proceed. */
  | "UNDER_LIMIT"
  /** Exactly at it. What exists is fine; the next one is not. */
  | "AT_LIMIT"
  /** Above it — usually a downgrade. Refuse new work, never destroy old. */
  | "OVER_LIMIT"
  /** No limit set for this dimension on this plan. */
  | "UNLIMITED"
  /** No meter, no plan, or an unknown dimension. Not the same as under. */
  | "UNKNOWN"

export interface QuotaCheck {
  dimension: QuotaDimension
  verdict: QuotaVerdict
  enforcement: QuotaEnforcement | null
  /** Whether a caller may create one more. */
  mayCreate: boolean
  limit: number | null
  used: number | null
  detail: string
}

/**
 * Whether one more of something may be created.
 *
 * `mayCreate` is the answer callers want, and it is deliberately computed here
 * rather than left to each call site to derive from the verdict — three call
 * sites deriving it is three chances to treat `UNKNOWN` as permission.
 *
 * A `soft` limit never refuses. That is what makes it soft, and a soft limit
 * that occasionally blocks is worse than a hard one because nobody expects it.
 */
export function checkQuota(
  dimension: QuotaDimension,
  plan: Plan | undefined,
  meters: readonly UsageMeter[],
): QuotaCheck {
  const base = { dimension, limit: null, used: null }

  if (!plan) {
    return {
      ...base,
      verdict: "UNKNOWN",
      enforcement: null,
      // Fails closed. A tenant with no resolvable plan is a tenant whose
      // commercial state is broken, and letting it create unbounded resources
      // while that is true is how an unbilled tenant becomes an expensive one.
      mayCreate: false,
      detail: "no plan resolved for this tenant",
    }
  }

  const quota = plan.quotas.find((q) => q.dimension === dimension)
  if (!quota) {
    return {
      ...base,
      verdict: "UNKNOWN",
      enforcement: null,
      mayCreate: false,
      // "Unset" is not "unlimited". A dimension nobody wrote a limit for is a
      // dimension nobody decided about, and `limit: null` on a declared quota
      // is how "unlimited" is said out loud.
      detail: `${dimension} has no limit on plan ${plan.planId} — unset is not unlimited`,
    }
  }

  if (quota.limit === null) {
    return {
      ...base,
      verdict: "UNLIMITED",
      enforcement: quota.enforcement,
      mayCreate: true,
      detail: `${dimension} is explicitly unlimited on plan ${plan.planId}`,
    }
  }

  const meter = meters.find((m) => m.dimension === dimension)
  if (!meter) {
    return {
      ...base,
      limit: quota.limit,
      verdict: "UNKNOWN",
      enforcement: quota.enforcement,
      // A limit with no meter cannot be enforced, and pretending usage is zero
      // makes every limit infinite for exactly the dimensions nobody wired up.
      mayCreate: false,
      detail: `${dimension} is limited to ${quota.limit} but nothing is measuring it`,
    }
  }

  const used = meter.value
  const verdict: QuotaVerdict =
    used > quota.limit ? "OVER_LIMIT" : used === quota.limit ? "AT_LIMIT" : "UNDER_LIMIT"

  // Soft limits warn; they never refuse. Hard limits refuse at the limit, not
  // past it — the limit is the count you may hold, so holding it means the next
  // one is the one too many.
  const mayCreate = quota.enforcement === "soft" || verdict === "UNDER_LIMIT"

  return {
    dimension,
    verdict,
    enforcement: quota.enforcement,
    mayCreate,
    limit: quota.limit,
    used,
    detail:
      verdict === "OVER_LIMIT"
        ? `${used} of ${quota.limit} — over the limit, usually after a downgrade. Existing records stay; new ones are refused.`
        : verdict === "AT_LIMIT"
          ? `${used} of ${quota.limit} — at the limit`
          : `${used} of ${quota.limit}`,
  }
}

/**
 * Every dimension, for a fleet or billing view.
 *
 * Iterates the DIMENSION list rather than the plan's quotas, so a dimension the
 * plan forgot appears as `UNKNOWN` instead of not appearing at all — a missing
 * row reads as "fine" to anyone scanning the page.
 */
export function quotaReport(
  plan: Plan | undefined,
  meters: readonly UsageMeter[],
): readonly QuotaCheck[] {
  return QUOTA_DIMENSIONS.map((d) => checkQuota(d, plan, meters))
}

/**
 * What a tenant's own administrators may see about their commercial state.
 *
 * Deliberately narrower than the server's view: the plan's display name, what
 * they hold, and how close they are to their limits. No price, no contract
 * dates, no override reasons and no approver — those are the commercial
 * relationship, they are negotiated by different people than the ones
 * administering the system, and an override reason is often a note about a
 * customer written for internal readers.
 */
export interface CommercialProjection {
  planName: string
  supportTier: Plan["supportTier"]
  entitlements: readonly string[]
  quotas: readonly { dimension: QuotaDimension; used: number | null; limit: number | null }[]
}

export function commercialProjection(
  contract: Contract,
  plan: Plan | undefined,
  meters: readonly UsageMeter[],
  at: Date,
): CommercialProjection {
  return {
    planName: plan?.displayName ?? "Unknown",
    supportTier: plan?.supportTier ?? "community",
    entitlements: entitlementsFor(contract, plan, at),
    quotas: quotaReport(plan, meters).map((q) => ({
      dimension: q.dimension,
      used: q.used,
      limit: q.limit,
    })),
  }
}
