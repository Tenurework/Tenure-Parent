import type { Plan } from "./commercial"

/**
 * GE-030-004 — what Tenure actually sells.
 *
 * Two tiers, because two tiers is what the tenant bindings already demonstrate:
 * `rochester` holds the `finance` entitlement and `midtown-arts` deliberately
 * does not, which is the existing proof that entitlement gating is real. This
 * encodes that difference as a *plan* rather than as two lists somebody typed.
 *
 * Inventing a third so the catalog "looks like a product" would put a price on
 * something nobody has agreed to sell.
 *
 * ## Why entitlements stop being free text
 *
 * The compose form asked an operator to type a comma-separated entitlement
 * list. That makes every tenant's commercial state a typing exercise: a typo is
 * a silently missing feature, and there is nothing to reconcile an invoice
 * against. Entitlements are now a consequence of the plan, which is the thing
 * that was actually contracted.
 *
 * ## The quota numbers
 *
 * Every limit here is a decision, and the ones that are `soft` are soft on
 * purpose: seats grow between renewals and refusing a seat mid-term breaks a
 * working institution to enforce a number that gets renegotiated anyway.
 * Storage is `null` — explicitly unlimited — rather than absent, because unset
 * would make `checkQuota` refuse, and refusing every upload is not the intent.
 */
export const PLAN_CATALOG: readonly Plan[] = [
  {
    planId: "institution-core",
    displayName: "Institution Core",
    // The blueprint's own modules and nothing beyond them.
    entitlements: [],
    quotas: [
      { dimension: "organizations", limit: 60, enforcement: "hard" },
      { dimension: "seats", limit: 600, enforcement: "soft" },
      { dimension: "storageGb", limit: null, enforcement: "soft" },
      { dimension: "aiCallsPerMonth", limit: 0, enforcement: "hard" },
      { dimension: "connectors", limit: 1, enforcement: "hard" },
    ],
    // null, not 0. No price has been agreed for either tier, and 0 would say
    // Tenure gives this away — a commercial statement nobody has made.
    monthlyPriceCents: null,
    supportTier: "community",
  },
  {
    planId: "institution",
    displayName: "Institution",
    // `finance` is the entitlement the pilot holds and the nonprofit fixture is
    // refused — see blueprints/index.ts.
    entitlements: ["finance"],
    quotas: [
      { dimension: "organizations", limit: 250, enforcement: "hard" },
      { dimension: "seats", limit: 2_500, enforcement: "soft" },
      { dimension: "storageGb", limit: null, enforcement: "soft" },
      { dimension: "aiCallsPerMonth", limit: 25_000, enforcement: "hard" },
      { dimension: "connectors", limit: 10, enforcement: "hard" },
    ],
    monthlyPriceCents: null,
    supportTier: "standard",
  },
]

const BY_ID = new Map(PLAN_CATALOG.map((p) => [p.planId, p]))

export function getPlan(planId: string): Plan | undefined {
  return BY_ID.get(planId)
}

export function planIds(): readonly string[] {
  return PLAN_CATALOG.map((p) => p.planId)
}
