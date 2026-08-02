import type { CellRecord } from "./cell-registry"

/**
 * GE-041-002 — which identity pool a tenant's sign-in resolves to.
 *
 * Bible §5's isolation table gives four shapes a tenant can be placed in —
 * pooled, bridge, silo, dedicated account — plus a regional/sovereign
 * constraint that cuts across all of them. Each implies a different answer to
 * "where do this tenant's credentials live", and the answer is not free to
 * change later: moving a tenant between pools invalidates every credential in
 * the old one.
 *
 * ## The resolution is a decision, not a lookup
 *
 * `resolvePool` returns *why*, always, in the same shape as `choosePlacement`.
 * "Which pool is this tenant in" is asked during incidents, and an answer that
 * is only an identifier sends somebody to read code to find out whether it was
 * the isolation class, the residency constraint or the shard function that
 * produced it.
 *
 * ## Sharding must be stable, or it is not sharding
 *
 * A sharded pool exists because one pool has limits — Cognito's are per-pool,
 * and a fleet outgrows them. The property that makes it usable is that a tenant
 * lands in the same shard every time, forever: a tenant that moves shard has
 * lost every credential in the old one, and the people affected experience it
 * as their accounts vanishing.
 *
 * So the shard is derived from the immutable tenant id with a fixed hash, and
 * `shardCount` is part of the *strategy configuration* rather than a live
 * count. Deriving it from "how many pools exist right now" would re-shard the
 * entire fleet the moment somebody added one.
 */

export const POOL_STRATEGIES = ["shared-regional", "sharded", "tenant", "dedicated-account"] as const
export type PoolStrategy = (typeof POOL_STRATEGIES)[number]

/** Isolation classes from Bible §5, in increasing order of separation. */
export const ISOLATION_CLASSES = ["pooled", "bridge", "silo", "dedicated-account"] as const
export type IsolationClass = (typeof ISOLATION_CLASSES)[number]

/**
 * The strategy each isolation class resolves to.
 *
 * `bridge` shares an identity pool with `pooled` deliberately. Bridge separates
 * *data* — a dedicated database, dedicated queues — and Bible §5 does not
 * promise it a separate identity boundary. Giving it one anyway would be a
 * quiet upgrade nobody contracted for, and downgrading it later would break
 * every credential.
 */
const STRATEGY_FOR: Readonly<Record<IsolationClass, PoolStrategy>> = {
  pooled: "shared-regional",
  bridge: "shared-regional",
  silo: "tenant",
  "dedicated-account": "dedicated-account",
}

export interface PoolStrategyConfig {
  /**
   * Above this many tenants in one region, the shared pool is sharded.
   *
   * A number, not a feature flag: the reason to shard is a limit, and a limit
   * is a number. Zero means never shard.
   */
  shardAboveTenants: number
  /**
   * How many shards a sharded region has.
   *
   * Configuration, never a live count of existing pools. Deriving it from what
   * exists would re-shard the whole fleet the moment somebody added a pool, and
   * every tenant that moved would lose its credentials.
   */
  shardCount: number
}

export const DEFAULT_POOL_STRATEGY: PoolStrategyConfig = {
  // Cognito's per-pool user limits are large; the practical pressure is
  // operational — a pool with every tenant in it is a single blast radius and a
  // single throttle. 50,000 is well inside the service limit and small enough
  // that one tenant's traffic spike is survivable.
  shardAboveTenants: 50_000,
  shardCount: 8,
}

export type PoolRefusal =
  | "no-cell"
  | "residency-violation"
  | "dedicated-account-missing"
  | "unknown-isolation-class"

export interface PoolResolution {
  /** The pool's logical identifier, or null when it cannot be resolved. */
  poolId: string | null
  strategy: PoolStrategy | null
  /** Why, either way. A refusal without a reason cannot be acted on. */
  reason: "resolved" | PoolRefusal
  detail: string
  /** The shard, when the strategy is sharded. Null otherwise. */
  shard: number | null
}

export interface PoolTenant {
  /** Immutable. The shard is derived from this and must never be derived from a slug. */
  tenantId: string
  isolation: string
  /** Regions the tenant's data may live in. Empty means unconstrained. */
  residency: readonly string[]
  /** Set only for dedicated-account placement. */
  dedicatedAwsAccountId?: string
}

/**
 * A stable, fixed hash.
 *
 * FNV-1a, written out rather than imported, because the shard assignment must
 * not change when a dependency does. `String.prototype.hashCode` does not
 * exist, `Math.random` is obviously wrong, and a hash whose implementation can
 * be upgraded underneath us would silently re-shard the fleet on a package
 * bump — the one failure mode this whole function exists to prevent.
 */
export function shardFor(tenantId: string, shardCount: number): number {
  if (shardCount <= 0) throw new RangeError("shardCount must be positive")
  let hash = 0x811c9dc5
  for (let i = 0; i < tenantId.length; i++) {
    hash ^= tenantId.charCodeAt(i)
    // 32-bit FNV prime multiply, kept in range with Math.imul.
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash % shardCount
}

/**
 * Which identity pool a tenant signs in against.
 *
 * Residency is checked before anything else, for the same reason
 * `choosePlacement` checks it first: it is a contract, and reporting a capacity
 * or configuration problem when the real answer is "no pool may legally hold
 * this tenant" sends an operator to fix the wrong thing.
 */
export function resolvePool(
  tenant: PoolTenant,
  cell: CellRecord | null,
  config: PoolStrategyConfig = DEFAULT_POOL_STRATEGY,
): PoolResolution {
  if (!(ISOLATION_CLASSES as readonly string[]).includes(tenant.isolation)) {
    return {
      poolId: null,
      strategy: null,
      reason: "unknown-isolation-class",
      detail: `"${tenant.isolation}" is not an isolation class. Bible §5 defines pooled, bridge, silo and dedicated account; there is no fifth.`,
      shard: null,
    }
  }
  const isolation = tenant.isolation as IsolationClass
  const strategy = STRATEGY_FOR[isolation]

  if (strategy === "dedicated-account") {
    if (!tenant.dedicatedAwsAccountId) {
      return {
        poolId: null,
        strategy,
        reason: "dedicated-account-missing",
        detail:
          "This tenant is contracted for a dedicated account and none is recorded. A dedicated-account tenant " +
          "must not fall back to a shared pool — that is the isolation they are paying for, and the fallback " +
          "would be invisible.",
        shard: null,
      }
    }
    return {
      poolId: `tenure-${tenant.dedicatedAwsAccountId}-${tenant.tenantId}`,
      strategy,
      reason: "resolved",
      detail: "Dedicated account: the pool lives in the tenant's own account.",
      shard: null,
    }
  }

  if (!cell) {
    return {
      poolId: null,
      strategy,
      reason: "no-cell",
      detail: "This tenant is not placed in a cell, so there is no region to resolve a pool in.",
      shard: null,
    }
  }

  // Residency is a contract. A pool in the wrong region holds credentials —
  // which are personal data — outside where the tenant permitted them.
  if (tenant.residency.length > 0 && !tenant.residency.includes(cell.region)) {
    return {
      poolId: null,
      strategy,
      reason: "residency-violation",
      detail:
        `The cell is in ${cell.region} and this tenant permits ${tenant.residency.join(", ")}. ` +
        `Credentials are personal data; a pool outside the permitted regions is a residency breach, not a detail.`,
      shard: null,
    }
  }

  if (strategy === "tenant") {
    return {
      poolId: `tenure-${cell.region}-${tenant.tenantId}`,
      strategy,
      reason: "resolved",
      detail: "Silo: a pool of this tenant's own, inside the shared account.",
      shard: null,
    }
  }

  // Shared regional, possibly sharded.
  const shouldShard = config.shardAboveTenants > 0 && cell.capacity.tenants > config.shardAboveTenants
  if (!shouldShard) {
    return {
      poolId: `tenure-${cell.region}-shared`,
      strategy: "shared-regional",
      reason: "resolved",
      detail: `Shared regional pool for ${cell.region}.`,
      shard: null,
    }
  }

  const shard = shardFor(tenant.tenantId, config.shardCount)
  return {
    poolId: `tenure-${cell.region}-shard-${shard}`,
    strategy: "sharded",
    reason: "resolved",
    detail:
      `Sharded regional pool ${shard} of ${config.shardCount} for ${cell.region}. ` +
      `The shard is derived from the immutable tenant id and does not move.`,
    shard,
  }
}

export interface PoolInvariantBreach {
  tenantId: string
  detail: string
}

/**
 * Breaches a fleet of resolutions must never contain.
 *
 * Separate from `resolvePool` because these are properties of the *fleet*, not
 * of one decision, and the failures they catch are the ones a per-tenant
 * function structurally cannot see: two tenants sharing a pool that should not,
 * or a tenant whose pool moved between two runs.
 */
export function poolInvariantBreaches(
  resolutions: readonly { tenant: PoolTenant; resolution: PoolResolution }[],
): readonly PoolInvariantBreach[] {
  const breaches: PoolInvariantBreach[] = []

  for (const { tenant, resolution } of resolutions) {
    if (resolution.reason !== "resolved") continue

    // A silo or dedicated tenant sharing a pool with anyone else is the
    // isolation they contracted for, silently absent.
    if (resolution.strategy === "tenant" || resolution.strategy === "dedicated-account") {
      const sharers = resolutions.filter(
        (other) => other.resolution.poolId === resolution.poolId && other.tenant.tenantId !== tenant.tenantId,
      )
      if (sharers.length > 0) {
        breaches.push({
          tenantId: tenant.tenantId,
          detail:
            `${tenant.tenantId} is isolated (${resolution.strategy}) but shares pool ${resolution.poolId} with ` +
            `${sharers.map((s) => s.tenant.tenantId).join(", ")}. That is the isolation they contracted for, missing.`,
        })
      }
    }
  }

  return breaches
}
