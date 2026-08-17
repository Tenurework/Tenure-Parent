import type { IsolationTier } from "./manifest"
import type { PlacementGate } from "./placement-policy"

/**
 * GE-101-002 — the five placement shapes, behind one contract.
 *
 * Bible §5's isolation table names four shapes a tenant can be placed in —
 * pooled, bridge, silo, dedicated Tenure account — and a regional/sovereign
 * constraint that is a fifth shape rather than a flag on the fourth, because it
 * changes what may be overridden rather than only what is built.
 *
 * ## Why a table and not five branches
 *
 * The shapes differ in exactly three ways, and every one of them is a fact a
 * caller needs to read rather than a code path a caller needs to enter: which
 * resources are shared, which policy gates the shape makes mandatory, and which
 * of those may never be waived. Expressing them as data behind one interface is
 * what lets the placement policy ask "what does this shape demand" without
 * knowing which shape it got — and what makes adding a sixth a table row plus a
 * compile error, rather than a branch somebody forgets in three places.
 *
 * ## The resource plan is the honest part
 *
 * `pooled` shares the cell's database and cluster. That is real isolation — the
 * application's tenant scope — and it is not separate infrastructure, so the
 * plan says `shared-cell` for every row rather than describing a boundary the
 * customer did not buy. `bridge` shares the identity pool deliberately, the same
 * decision `pool-strategy.ts` records and for the same reason: bridge separates
 * data, and giving it a separate credential boundary would be a quiet upgrade
 * that could never be taken back without invalidating every credential in it.
 *
 * Nothing here reads a clock, a random source or the environment. Given a
 * shape, the plan is the same every time, which is what makes it comparable
 * against what was actually built.
 */

export const PLACEMENT_ADAPTERS = [
  "pooled",
  "bridge",
  "silo",
  "dedicated-account",
  "regional-sovereign",
] as const

export type PlacementAdapterId = (typeof PLACEMENT_ADAPTERS)[number]

/** The resources a tenant's placement decides the shape of. */
export const PLACEMENT_RESOURCES = [
  "cluster",
  "database",
  "schema",
  "identity-pool",
  "queue",
  "bucket",
  "kms-key",
  "search-index",
  "account",
] as const

export type PlacementResource = (typeof PLACEMENT_RESOURCES)[number]

/**
 * How much of a resource this tenant has to itself.
 *
 * Three values, not a boolean, because "dedicated inside a shared account" and
 * "dedicated inside an account nobody else is in" are different blast radii and
 * different bills.
 */
export type ResourceSharing = "shared-cell" | "dedicated-tenant" | "dedicated-account"

export interface PlannedResource {
  resource: PlacementResource
  sharing: ResourceSharing
}

export interface PlacementAdapter {
  id: PlacementAdapterId
  /** The manifest tier this shape implements. */
  isolation: IsolationTier
  /** Whether this shape carries the regional/sovereign constraint. */
  sovereign: boolean
  /**
   * Gates this shape demands whether or not the tenant declared anything on
   * them.
   *
   * A silo tenant paid for a boundary, so the fleet has to be able to say it
   * can provide one; a sovereign tenant's key custody is the product. A shape
   * that demanded nothing would be a shape that could be sold and then not
   * built.
   */
  mandatoryGates: readonly PlacementGate[]
  /**
   * Gates that may never be waived for this shape, on top of the gates no shape
   * may ever waive.
   *
   * Sovereign placement lists every otherwise-waivable gate: the reason to buy
   * it is that nobody can decide, one afternoon, that a degradation is
   * acceptable.
   */
  neverOverridable: readonly PlacementGate[]
  /** What gets built, and how much of it is this tenant's alone. */
  resources: readonly PlannedResource[]
  /** Whether this shape needs an account vended for it before anything else. */
  requiresDedicatedAccount: boolean
}

function plan(
  sharing: ResourceSharing,
  overrides: Partial<Record<PlacementResource, ResourceSharing>> = {},
  include: readonly PlacementResource[] = PLACEMENT_RESOURCES.filter((r) => r !== "account"),
): readonly PlannedResource[] {
  return include.map((resource) => ({ resource, sharing: overrides[resource] ?? sharing }))
}

/**
 * Every gate a sovereign placement refuses to have waived: the full waivable
 * set. Listed rather than computed from `OVERRIDABLE_GATES` so that adding a
 * new waivable gate does not silently become waivable for sovereign tenants —
 * the strictest shape should have to be told about it.
 */
const SOVEREIGN_NEVER_OVERRIDABLE: readonly PlacementGate[] = [
  "latency",
  "capacity",
  "cost",
  "dr",
  "service-availability",
]

export const PLACEMENT_ADAPTER_TABLE: Readonly<Record<PlacementAdapterId, PlacementAdapter>> = {
  pooled: {
    id: "pooled",
    isolation: "pooled",
    sovereign: false,
    // Every cell is a shared deployment, so a cell that exists can serve a
    // pooled tenant. The gate is still demanded — it is what records that the
    // tenant asked for pooled and got pooled.
    mandatoryGates: ["isolation-tier"],
    neverOverridable: [],
    resources: plan("shared-cell"),
    requiresDedicatedAccount: false,
  },
  bridge: {
    id: "bridge",
    isolation: "bridge",
    sovereign: false,
    // A dedicated database encrypted under a dedicated key: the fleet has to be
    // able to say it can provide one before the tenant is told it has one.
    mandatoryGates: ["isolation-tier", "kms"],
    neverOverridable: [],
    resources: plan("dedicated-tenant", {
      cluster: "shared-cell",
      // Shares the pooled identity pool deliberately — see pool-strategy.ts.
      // Bridge separates data; it was never sold a separate credential
      // boundary, and adding one could not be taken back.
      "identity-pool": "shared-cell",
    }),
    requiresDedicatedAccount: false,
  },
  silo: {
    id: "silo",
    isolation: "silo",
    sovereign: false,
    mandatoryGates: ["isolation-tier", "kms"],
    neverOverridable: [],
    resources: plan("dedicated-tenant"),
    requiresDedicatedAccount: false,
  },
  "dedicated-account": {
    id: "dedicated-account",
    isolation: "dedicated-account",
    sovereign: false,
    // The partition is mandatory here where it is not for a pooled tenant: an
    // account is vended into one, and vending into the wrong one is not a
    // configuration change afterwards.
    mandatoryGates: ["isolation-tier", "kms", "partition"],
    neverOverridable: [],
    resources: plan("dedicated-account", {}, PLACEMENT_RESOURCES),
    requiresDedicatedAccount: true,
  },
  "regional-sovereign": {
    id: "regional-sovereign",
    // A sovereign placement is a dedicated account with the region and the key
    // nailed down. The tier is the same; the constraint is what is bought.
    isolation: "dedicated-account",
    sovereign: true,
    mandatoryGates: ["isolation-tier", "kms", "partition", "allowed-regions", "dr"],
    neverOverridable: SOVEREIGN_NEVER_OVERRIDABLE,
    resources: plan("dedicated-account", {}, PLACEMENT_RESOURCES),
    requiresDedicatedAccount: true,
  },
}

export interface AdapterSelection {
  isolation: IsolationTier
  /**
   * Set when the placement is under a sovereignty constraint.
   *
   * Separate from the tier because it is a separate contract. A tenant can have
   * a dedicated account for blast-radius reasons and no sovereignty
   * requirement at all, and conflating the two would sell one as the other.
   */
  sovereign?: boolean
}

/**
 * The one adapter that serves this shape.
 *
 * Sovereign wins over the tier: a sovereign placement is always a dedicated
 * account, so a request that asks for sovereignty on a pooled tier is asking
 * for something that does not exist and gets the shape that does, with the
 * gates that shape demands — which will refuse it unless the fleet can actually
 * provide them.
 */
export function adapterFor(selection: AdapterSelection): PlacementAdapter {
  if (selection.sovereign) return PLACEMENT_ADAPTER_TABLE["regional-sovereign"]
  return PLACEMENT_ADAPTER_TABLE[selection.isolation]
}
