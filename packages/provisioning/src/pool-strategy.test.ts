import {
  DEFAULT_POOL_STRATEGY,
  ISOLATION_CLASSES,
  POOL_STRATEGIES,
  poolInvariantBreaches,
  resolvePool,
  shardFor,
  type CellRecord,
  type PoolTenant,
} from "./index"

/**
 * GE-041-002 — which identity pool a tenant signs in against.
 *
 * Two properties carry this item, and both are about things that must not
 * change. A tenant's pool must never move, because moving it invalidates every
 * credential in the old one and the people affected experience that as their
 * accounts vanishing. And an isolated tenant must never quietly share, because
 * the isolation is what they contracted for and its absence is invisible.
 */

const cell = (over: Partial<CellRecord> = {}): CellRecord => ({
  cellId: "cell-use1-a",
  awsAccountId: "111122223333",
  region: "us-east-1",
  environment: "production",
  partition: "aws",
  health: "HEALTHY",
  capacity: { tenants: 120, maxTenants: 5_000 },
  release: "2026.8.0",
  schemaVersion: "20260802",
  residencyZones: ["us-east-1"],
  routing: { baseUrl: "https://use1.tenurework.com" },
  backup: { lastVerifiedAt: "2026-08-01T00:00:00Z", retentionDays: 35 },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z",
  ...over,
})

const tenant = (over: Partial<PoolTenant> = {}): PoolTenant => ({
  tenantId: "tnt-rochester",
  isolation: "pooled",
  residency: ["us-east-1"],
  ...over,
})

describe("each isolation class resolves to its own strategy", () => {
  it("puts a pooled tenant in the shared regional pool", () => {
    const result = resolvePool(tenant(), cell())
    expect(result.reason).toBe("resolved")
    expect(result.strategy).toBe("shared-regional")
    expect(result.poolId).toBe("tenure-us-east-1-shared")
  })

  it("puts a bridge tenant in the same shared pool as a pooled one", () => {
    // Bridge separates DATA — a dedicated database, dedicated queues — and
    // Bible §5 does not promise it a separate identity boundary. Giving it one
    // would be a quiet upgrade nobody contracted for, and taking it back later
    // would break every credential.
    expect(resolvePool(tenant({ isolation: "bridge" }), cell()).poolId).toBe(
      resolvePool(tenant({ isolation: "pooled" }), cell()).poolId,
    )
  })

  it("gives a silo tenant a pool of its own inside the shared account", () => {
    const result = resolvePool(tenant({ isolation: "silo" }), cell())
    expect(result.strategy).toBe("tenant")
    expect(result.poolId).toBe("tenure-us-east-1-tnt-rochester")
  })

  it("puts a dedicated-account tenant's pool in its own account", () => {
    const result = resolvePool(
      tenant({ isolation: "dedicated-account", dedicatedAwsAccountId: "444455556666" }),
      cell(),
    )
    expect(result.strategy).toBe("dedicated-account")
    expect(result.poolId).toBe("tenure-444455556666-tnt-rochester")
  })

  it("refuses an isolation class that is not one of the four", () => {
    const result = resolvePool(tenant({ isolation: "extra-special" }), cell())
    expect(result.reason).toBe("unknown-isolation-class")
    expect(result.poolId).toBeNull()
  })

  it("covers every declared isolation class", () => {
    for (const isolation of ISOLATION_CLASSES) {
      const result = resolvePool(
        tenant({ isolation, dedicatedAwsAccountId: "444455556666" }),
        cell(),
      )
      expect(result.reason).toBe("resolved")
      expect(POOL_STRATEGIES).toContain(result.strategy)
    }
  })
})

describe("a dedicated tenant never falls back to sharing", () => {
  it("refuses rather than resolving to a shared pool when the account is missing", () => {
    // The fallback would be invisible: sign-in would work, and the isolation
    // they are paying for would silently not exist.
    const result = resolvePool(tenant({ isolation: "dedicated-account" }), cell())
    expect(result.reason).toBe("dedicated-account-missing")
    expect(result.poolId).toBeNull()
    expect(result.detail).toMatch(/must not fall back/)
  })
})

describe("residency is checked before anything else", () => {
  it("refuses a pool outside the tenant's permitted regions", () => {
    // Credentials are personal data. A pool in the wrong region is a residency
    // breach, not a detail.
    const result = resolvePool(tenant({ residency: ["eu-west-1"] }), cell({ region: "us-east-1" }))
    expect(result.reason).toBe("residency-violation")
    expect(result.poolId).toBeNull()
    expect(result.detail).toContain("eu-west-1")
  })

  it("allows a tenant with no residency constraint anywhere", () => {
    expect(resolvePool(tenant({ residency: [] }), cell({ region: "ap-south-1" })).reason).toBe("resolved")
  })

  it("refuses on residency even for a silo tenant", () => {
    // A stronger isolation class does not buy an exemption from a contract.
    const result = resolvePool(tenant({ isolation: "silo", residency: ["eu-west-1"] }), cell())
    expect(result.reason).toBe("residency-violation")
  })

  it("reports no cell separately from a residency breach", () => {
    // They send an operator to different places: one is a placement that has
    // not happened, the other is a placement that must not.
    expect(resolvePool(tenant(), null).reason).toBe("no-cell")
  })
})

describe("sharding is stable, or it is not sharding", () => {
  const busy = cell({ capacity: { tenants: DEFAULT_POOL_STRATEGY.shardAboveTenants + 1, maxTenants: 200_000 } })

  it("shards a shared pool once the region is large enough", () => {
    const result = resolvePool(tenant(), busy)
    expect(result.strategy).toBe("sharded")
    expect(result.shard).toBeGreaterThanOrEqual(0)
    expect(result.shard).toBeLessThan(DEFAULT_POOL_STRATEGY.shardCount)
    expect(result.poolId).toBe(`tenure-us-east-1-shard-${result.shard}`)
  })

  it("does not shard below the threshold", () => {
    expect(resolvePool(tenant(), cell()).strategy).toBe("shared-regional")
  })

  it("puts the same tenant in the same shard every time", () => {
    // A tenant that moves shard has lost every credential in the old one, and
    // the people affected experience it as their accounts vanishing.
    const once = resolvePool(tenant(), busy).shard
    for (let i = 0; i < 50; i++) expect(resolvePool(tenant(), busy).shard).toBe(once)
  })

  it("does not move a tenant when the fleet grows", () => {
    // The shard comes from the immutable tenant id, not from how many tenants
    // or pools currently exist.
    //
    // The fleet sizes are chosen to be INCONGRUENT mod shardCount. The first
    // version used 60,000 and 190,000, which are both 0 mod 8 — so a mutation
    // deriving the shard from `cell.capacity.tenants` survived, and the test
    // that was supposed to prove stability passed by coincidence. Several
    // sizes, each landing on a different residue, so any capacity-derived
    // shard disagrees with at least one of them.
    const sizes = [60_001, 190_003, 123_457, 77_778]
    const shards = sizes.map(
      (tenants) => resolvePool(tenant(), cell({ capacity: { tenants, maxTenants: 500_000 } })).shard,
    )
    expect(new Set(shards).size).toBe(1)
    expect(new Set(sizes.map((n) => n % DEFAULT_POOL_STRATEGY.shardCount)).size).toBeGreaterThan(1)
  })

  it("spreads a realistic fleet across every shard", () => {
    // A hash that puts everyone in shard 0 is stable and useless. Not a
    // distribution-quality claim — just that every shard is reachable.
    const shards = new Set(
      Array.from({ length: 2_000 }, (_, i) => shardFor(`tnt-${i}`, DEFAULT_POOL_STRATEGY.shardCount)),
    )
    expect(shards.size).toBe(DEFAULT_POOL_STRATEGY.shardCount)
  })

  it("derives the shard from the tenant id alone", () => {
    // Deriving it from a slug would move the tenant when somebody renamed it,
    // and renaming is a routine, reversible operation.
    expect(shardFor("tnt-rochester", 8)).toBe(shardFor("tnt-rochester", 8))
    expect(shardFor("tnt-rochester", 8)).not.toBe(shardFor("tnt-simon", 8))
  })

  it("refuses a non-positive shard count rather than dividing by zero", () => {
    expect(() => shardFor("tnt-a", 0)).toThrow(RangeError)
  })

  it("never shards when the threshold is disabled", () => {
    const result = resolvePool(tenant(), busy, { shardAboveTenants: 0, shardCount: 8 })
    expect(result.strategy).toBe("shared-regional")
  })
})

describe("fleet invariants a single decision cannot see", () => {
  it("reports an isolated tenant that shares a pool", () => {
    // The failure a per-tenant function structurally cannot catch.
    const shared = { poolId: "tenure-us-east-1-tnt-x", strategy: "tenant" as const, reason: "resolved" as const, detail: "", shard: null }
    const breaches = poolInvariantBreaches([
      { tenant: tenant({ tenantId: "tnt-a", isolation: "silo" }), resolution: shared },
      { tenant: tenant({ tenantId: "tnt-b", isolation: "silo" }), resolution: shared },
    ])
    expect(breaches).toHaveLength(2)
    expect(breaches[0].detail).toMatch(/isolation they contracted for, missing/)
  })

  it("accepts pooled tenants sharing, because that is what pooled means", () => {
    const shared = { poolId: "tenure-us-east-1-shared", strategy: "shared-regional" as const, reason: "resolved" as const, detail: "", shard: null }
    expect(
      poolInvariantBreaches([
        { tenant: tenant({ tenantId: "tnt-a" }), resolution: shared },
        { tenant: tenant({ tenantId: "tnt-b" }), resolution: shared },
      ]),
    ).toEqual([])
  })

  it("ignores refused resolutions", () => {
    const refused = { poolId: null, strategy: null, reason: "no-cell" as const, detail: "", shard: null }
    expect(poolInvariantBreaches([{ tenant: tenant(), resolution: refused }])).toEqual([])
  })

  it("reports nothing for a correctly isolated fleet", () => {
    const fleet = [tenant({ tenantId: "tnt-a", isolation: "silo" }), tenant({ tenantId: "tnt-b", isolation: "silo" })].map(
      (t) => ({ tenant: t, resolution: resolvePool(t, cell()) }),
    )
    expect(poolInvariantBreaches(fleet)).toEqual([])
  })
})
