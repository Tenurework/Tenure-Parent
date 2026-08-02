import {
  QUOTA_DIMENSIONS,
  checkQuota,
  commercialProjection,
  contractIsActive,
  entitlementsFor,
  quotaReport,
  validateContract,
  validatePlan,
  type Contract,
  type Plan,
  type UsageMeter,
} from "./commercial"

/**
 * GE-030-004 — plans, entitlements, quotas and meters.
 *
 * Almost every test here is about failing CLOSED, because every way this can be
 * wrong looks like generosity: an unmetered dimension that is effectively
 * unlimited, a lapsed contract that keeps working, a plan that cannot be
 * resolved and so refuses nothing. None of those produce a complaint from
 * anyone until an invoice or an incident.
 */
const PLAN: Plan = {
  planId: "institution",
  displayName: "Institution",
  entitlements: ["finance", "ai-assistant"],
  quotas: [
    { dimension: "organizations", limit: 50, enforcement: "hard" },
    { dimension: "seats", limit: 500, enforcement: "soft" },
    { dimension: "storageGb", limit: null, enforcement: "hard" },
    { dimension: "aiCallsPerMonth", limit: 10_000, enforcement: "hard" },
    { dimension: "connectors", limit: 3, enforcement: "hard" },
  ],
  monthlyPriceCents: 250_000,
  supportTier: "standard",
}

const CONTRACT: Contract = {
  tenantId: "tnt_rochester",
  planId: "institution",
  activeFrom: "2026-01-01T00:00:00.000Z",
  activeUntil: "2027-01-01T00:00:00.000Z",
  billingCurrency: "USD",
  overrides: [],
}

const NOW = new Date("2026-08-02T00:00:00.000Z")
const meter = (dimension: UsageMeter["dimension"], value: number): UsageMeter => ({
  tenantId: "tnt_rochester",
  dimension,
  value,
  measuredAt: NOW.toISOString(),
  periodStart: null,
})

describe("a contract window decides whether anything is entitled at all", () => {
  it("entitles the plan's features inside the window", () => {
    expect(entitlementsFor(CONTRACT, PLAN, NOW)).toEqual(["ai-assistant", "finance"])
  })

  it("entitles nothing before it starts", () => {
    // Provisioned is not entitled. A tenant built ahead of its start date can
    // be configured and cannot use what it has not started paying for.
    expect(entitlementsFor(CONTRACT, PLAN, new Date("2025-12-31T23:59:59.000Z"))).toEqual([])
  })

  it("entitles nothing after it ends", () => {
    // The one that costs money. Returning the plan's list regardless keeps
    // every paid feature working for a customer who has stopped paying, and
    // nothing surfaces it — the software behaves perfectly.
    expect(entitlementsFor(CONTRACT, PLAN, new Date("2027-01-02T00:00:00.000Z"))).toEqual([])
    expect(contractIsActive(CONTRACT, new Date("2027-01-01T00:00:00.000Z"))).toBe(false)
  })

  it("treats an open-ended contract as open-ended", () => {
    const open = { ...CONTRACT, activeUntil: null }
    expect(contractIsActive(open, new Date("2099-01-01T00:00:00.000Z"))).toBe(true)
  })

  it("entitles nothing when the window cannot be read", () => {
    // Failing open here entitles a tenant whose contract nobody can parse.
    expect(contractIsActive({ ...CONTRACT, activeFrom: "whenever" }, NOW)).toBe(false)
    expect(contractIsActive({ ...CONTRACT, activeUntil: "sometime" }, NOW)).toBe(false)
  })

  it("entitles nothing when the plan cannot be resolved", () => {
    expect(entitlementsFor(CONTRACT, undefined, NOW)).toEqual([])
  })
})

describe("a commercial override may grant, and must say why", () => {
  it("adds to the plan's entitlements", () => {
    // Unlike a feature flag, which may only restrict. A signed amendment grants
    // things, and modelling that as a restriction would mean it could not be
    // expressed at all.
    const amended: Contract = {
      ...CONTRACT,
      overrides: [
        { entitlement: "relay", reason: "Pilot amendment 2026-03", approvedBy: "ops@tenure.example" },
      ],
    }
    expect(entitlementsFor(amended, PLAN, NOW)).toEqual(["ai-assistant", "finance", "relay"])
  })

  it("does not duplicate an entitlement the plan already grants", () => {
    const redundant: Contract = {
      ...CONTRACT,
      overrides: [{ entitlement: "finance", reason: "belt and braces", approvedBy: "ops" }],
    }
    expect(entitlementsFor(redundant, PLAN, NOW)).toEqual(["ai-assistant", "finance"])
  })

  it("refuses an override with no reason or no approver", () => {
    // A grant nobody can explain is a grant nobody can bill for or withdraw,
    // and it outlives whoever added it.
    expect(
      validateContract({
        ...CONTRACT,
        overrides: [{ entitlement: "relay", reason: "", approvedBy: "ops" }],
      }).map((p) => p.field),
    ).toContain("overrides")
    expect(
      validateContract({
        ...CONTRACT,
        overrides: [{ entitlement: "relay", reason: "amendment", approvedBy: "" }],
      }).map((p) => p.field),
    ).toContain("overrides")
  })

  it("does not survive the contract lapsing", () => {
    // An override rides on the contract. If it outlived the window it would be
    // a permanent grant issued by a temporary decision.
    const amended: Contract = {
      ...CONTRACT,
      overrides: [{ entitlement: "relay", reason: "amendment", approvedBy: "ops" }],
    }
    expect(entitlementsFor(amended, PLAN, new Date("2027-06-01T00:00:00.000Z"))).toEqual([])
  })
})

describe("quota checks fail closed", () => {
  it("refuses when there is no plan", () => {
    const check = checkQuota("organizations", undefined, [meter("organizations", 1)])
    expect(check.verdict).toBe("UNKNOWN")
    expect(check.mayCreate).toBe(false)
  })

  it("refuses when the plan sets no limit for the dimension", () => {
    // "Unset" is not "unlimited". A dimension nobody wrote a limit for is a
    // dimension nobody decided about.
    const partial: Plan = { ...PLAN, quotas: [{ dimension: "seats", limit: 10, enforcement: "hard" }] }
    const check = checkQuota("organizations", partial, [meter("organizations", 1)])
    expect(check.verdict).toBe("UNKNOWN")
    expect(check.mayCreate).toBe(false)
    expect(check.detail).toMatch(/unset is not unlimited/)
  })

  it("refuses when a limit exists but nothing is measuring it", () => {
    // The failure that makes every limit infinite for exactly the dimensions
    // nobody wired up. Pretending usage is zero is the natural mistake.
    const check = checkQuota("organizations", PLAN, [])
    expect(check.verdict).toBe("UNKNOWN")
    expect(check.mayCreate).toBe(false)
    expect(check.limit).toBe(50)
    expect(check.used).toBeNull()
  })

  it("allows an explicitly unlimited dimension", () => {
    // `limit: null` on a declared quota is how "unlimited" is said out loud,
    // and it is a different statement from leaving the dimension out.
    const check = checkQuota("storageGb", PLAN, [meter("storageGb", 9_000_000)])
    expect(check.verdict).toBe("UNLIMITED")
    expect(check.mayCreate).toBe(true)
  })
})

describe("at the limit, and over it, are different answers", () => {
  it("allows creation below the limit", () => {
    const check = checkQuota("organizations", PLAN, [meter("organizations", 49)])
    expect(check.verdict).toBe("UNDER_LIMIT")
    expect(check.mayCreate).toBe(true)
  })

  it("refuses the next one at exactly the limit", () => {
    // The limit is the count you may hold, so holding it means the next is one
    // too many. Off by one here is either a free extra or a customer who cannot
    // reach the number they bought.
    const check = checkQuota("organizations", PLAN, [meter("organizations", 50)])
    expect(check.verdict).toBe("AT_LIMIT")
    expect(check.mayCreate).toBe(false)
  })

  it("refuses new work when over the limit but does not ask for anything to be destroyed", () => {
    // A downgrade puts a tenant here. Refusing the 26th is correct; deleting 15
    // is data loss caused by a billing change.
    const check = checkQuota("organizations", PLAN, [meter("organizations", 75)])
    expect(check.verdict).toBe("OVER_LIMIT")
    expect(check.mayCreate).toBe(false)
    expect(check.detail).toMatch(/Existing records stay/)
    // Nothing in the answer suggests deletion.
    expect(check.detail).not.toMatch(/delete|remove|purge/i)
  })
})

describe("a soft limit warns and never refuses", () => {
  it("lets work through at and over the limit", () => {
    // That is what makes it soft. A soft limit that occasionally blocks is
    // worse than a hard one, because nobody expects it to.
    const atLimit = checkQuota("seats", PLAN, [meter("seats", 500)])
    expect(atLimit.verdict).toBe("AT_LIMIT")
    expect(atLimit.mayCreate).toBe(true)

    const over = checkQuota("seats", PLAN, [meter("seats", 640)])
    expect(over.verdict).toBe("OVER_LIMIT")
    expect(over.mayCreate).toBe(true)
    expect(over.enforcement).toBe("soft")
  })

  it("still reports the overage, so it can be billed or discussed", () => {
    const over = checkQuota("seats", PLAN, [meter("seats", 640)])
    expect(over.used).toBe(640)
    expect(over.limit).toBe(500)
  })
})

describe("the report covers every dimension, including the ones a plan forgot", () => {
  it("returns a row per known dimension", () => {
    const rows = quotaReport(PLAN, [meter("organizations", 10)])
    expect(rows.map((r) => r.dimension)).toEqual([...QUOTA_DIMENSIONS])
  })

  it("shows a forgotten dimension as UNKNOWN rather than omitting it", () => {
    // A missing row reads as "fine" to anyone scanning the page.
    const partial: Plan = { ...PLAN, quotas: [{ dimension: "seats", limit: 10, enforcement: "hard" }] }
    const rows = quotaReport(partial, [])
    expect(rows).toHaveLength(QUOTA_DIMENSIONS.length)
    expect(rows.filter((r) => r.verdict === "UNKNOWN")).toHaveLength(QUOTA_DIMENSIONS.length)
  })
})

describe("plans and contracts validate", () => {
  it("accepts a well-formed plan and contract", () => {
    expect(validatePlan(PLAN)).toEqual([])
    expect(validateContract(CONTRACT)).toEqual([])
  })

  it("refuses two limits on one dimension", () => {
    // The answer would depend on which is read first, and both look correct in
    // isolation.
    const twice: Plan = {
      ...PLAN,
      quotas: [
        { dimension: "seats", limit: 10, enforcement: "hard" },
        { dimension: "seats", limit: 999, enforcement: "soft" },
      ],
    }
    expect(validatePlan(twice).map((p) => p.reason)).toContain("duplicate")
  })

  it("refuses a negative or fractional limit", () => {
    for (const limit of [-1, 2.5]) {
      const bad: Plan = { ...PLAN, quotas: [{ dimension: "seats", limit, enforcement: "hard" }] }
      expect(validatePlan(bad).map((p) => p.field)).toContain("quotas")
    }
  })

  it("accepts a zero limit, which is a real thing to sell", () => {
    // "This plan includes no connectors" is a statement, not an error.
    const none: Plan = { ...PLAN, quotas: [{ dimension: "connectors", limit: 0, enforcement: "hard" }] }
    expect(validatePlan(none)).toEqual([])
    expect(checkQuota("connectors", none, [meter("connectors", 0)]).mayCreate).toBe(false)
  })

  it("refuses a contract that ends before it begins", () => {
    // Entitles nothing, ever, and presents as "the customer's features stopped
    // working" with no obvious cause.
    const backwards = { ...CONTRACT, activeFrom: "2027-01-01T00:00:00.000Z", activeUntil: "2026-01-01T00:00:00.000Z" }
    expect(validateContract(backwards).map((p) => p.field)).toContain("activeUntil")
  })

  it("refuses a currency that is not ISO 4217", () => {
    expect(validateContract({ ...CONTRACT, billingCurrency: "dollars" }).length).toBeGreaterThan(0)
    expect(validateContract({ ...CONTRACT, billingCurrency: "usd" }).length).toBeGreaterThan(0)
  })

  it("refuses a negative price", () => {
    expect(validatePlan({ ...PLAN, monthlyPriceCents: -100 }).map((p) => p.field)).toContain(
      "monthlyPriceCents",
    )
  })
})

describe("what a tenant's own administrators may see", () => {
  it("shows the plan, entitlements and usage", () => {
    const projection = commercialProjection(CONTRACT, PLAN, [meter("organizations", 12)], NOW)
    expect(projection.planName).toBe("Institution")
    expect(projection.entitlements).toEqual(["ai-assistant", "finance"])
    expect(projection.quotas.find((q) => q.dimension === "organizations")).toEqual({
      dimension: "organizations",
      used: 12,
      limit: 50,
    })
  })

  it("shows no price, no contract dates, and no override reasons", () => {
    // The commercial relationship is negotiated by different people than the
    // ones administering the system, and an override reason is often a note
    // about a customer written for internal readers.
    const amended: Contract = {
      ...CONTRACT,
      overrides: [
        {
          entitlement: "relay",
          reason: "Comped after the March outage; revisit at renewal",
          approvedBy: "ops@tenure.example",
        },
      ],
    }
    const serialized = JSON.stringify(commercialProjection(amended, PLAN, [], NOW))
    for (const hidden of [
      "250000",
      "2027-01-01",
      "Comped after the March outage",
      "ops@tenure.example",
      "tnt_rochester",
    ]) {
      expect(serialized).not.toContain(hidden)
    }
    // The entitlement itself is visible — they hold it, and hiding that would
    // mean the console cannot explain why a feature is available.
    expect(serialized).toContain("relay")
  })

  it("degrades to community support and no entitlements when the plan is missing", () => {
    const projection = commercialProjection(CONTRACT, undefined, [], NOW)
    expect(projection.planName).toBe("Unknown")
    expect(projection.supportTier).toBe("community")
    expect(projection.entitlements).toEqual([])
  })
})
