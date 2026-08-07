import {
  ANOMALY_RATIO,
  CurrencyMismatchError,
  MIN_COMPLETENESS_TO_FORECAST,
  STALE_AFTER_HOURS,
  TENANT_TAG,
  allocate,
  allocateByWeight,
  approvalFor,
  assessBudget,
  detectAnomalies,
  figure,
  forecastPeriod,
  freshness,
  fromDecimal,
  money,
  previewPlanCost,
  reconcile,
  summarize,
  sum,
  toDecimal,
  unitCost,
  zero,
  type AllocationDriver,
  type CostLine,
} from "./index"

/**
 * STUDIO-120-008/009/010 — the FinOps Center.
 *
 * Most of these are about the two ways a cost page lies. It can spread shared
 * spend across tenants so that every number looks attributed, or it can drop
 * what it cannot attribute so the columns quietly add up to less than the bill.
 * Both produce a page that looks authoritative; only one of them has a total
 * that reconciles, and neither is true.
 */

const NOW = new Date("2026-08-02T12:00:00Z")
const USD = "USD"
const usd = (decimal: string) => fromDecimal(decimal, USD)

const line = (over: Partial<CostLine> & { id: string }): CostLine => ({
  service: "AmazonEC2",
  accountId: "111122223333",
  region: "us-east-1",
  resourceId: "i-abc",
  tags: {},
  unblendedCost: usd("10.00"),
  amortizedCost: usd("10.00"),
  periodStart: "2026-08-01T00:00:00Z",
  periodEnd: "2026-08-31T23:59:59Z",
  ...over,
})

const forTenant = (id: string, cost: string, over: Partial<CostLine> = {}) =>
  line({ id, tags: { [TENANT_TAG]: over.tags?.[TENANT_TAG] ?? id }, unblendedCost: usd(cost), amortizedCost: usd(cost), ...over })

describe("money is integer minor units, because cost pages have to reconcile", () => {
  it("parses the sub-cent amounts AWS actually reports", () => {
    // A Lambda invocation line really is $0.0000004. Truncating at the cent
    // would silently zero millions of line items.
    //
    // 2 minor digits + SCALE(6) = 8 places, so a dollar is 10^8 units and
    // $0.0000004 is 40 of them. The smallest representable amount is 10^-8 of a
    // dollar, two orders below the smallest line AWS has ever billed us.
    expect(fromDecimal("0.0000004", USD).units).toBe(40)
    expect(fromDecimal("0.00000004", USD).units).toBe(4)
    expect(fromDecimal("10.00", USD).units).toBe(10 * 100 * 10 ** 6)
  })

  it("does not lose a cent to floating point", () => {
    // The whole reason for integer units: 0.1 + 0.2 !== 0.3 in float.
    const total = sum([usd("0.10"), usd("0.20")], USD)
    expect(total.units).toBe(usd("0.30").units)
    expect(toDecimal(total)).toBe("0.30")
  })

  it("refuses to add currencies rather than coercing them", () => {
    // A fleet spanning a euro-billed account and a dollar-billed one has two
    // totals. One number covering both is wrong in a way that looks right.
    expect(() => sum([usd("1.00"), fromDecimal("1.00", "EUR")], USD)).toThrow(CurrencyMismatchError)
  })

  it("rejects a non-integer amount at the constructor", () => {
    expect(() => money(1.5, USD)).toThrow(TypeError)
  })
})

describe("splitting a shared cost adds back to exactly the whole", () => {
  it("loses nothing to rounding across an awkward split", () => {
    // $10 across three tenants is the classic case: 333.33 each leaves a cent
    // unaccounted for, and at fleet scale that cent becomes the reason the
    // tenant column does not match the total.
    const parts = allocateByWeight(usd("10.00"), [1, 1, 1])
    expect(sum(parts, USD).units).toBe(usd("10.00").units)
  })

  it("splits the same way every time", () => {
    // A report that reshuffles cents between tenants on refresh cannot be
    // reconciled against a bill.
    const once = allocateByWeight(usd("100.00"), [7, 11, 13, 17]).map((p) => p.units)
    const twice = allocateByWeight(usd("100.00"), [7, 11, 13, 17]).map((p) => p.units)
    expect(once).toEqual(twice)
  })

  it("gives the leftover units to the largest fractions", () => {
    const parts = allocateByWeight(money(10, USD), [1, 1, 1])
    expect(parts.map((p) => p.units).sort((a, b) => b - a)).toEqual([4, 3, 3])
    expect(sum(parts, USD).units).toBe(10)
  })

  it("refuses a negative weight", () => {
    expect(() => allocateByWeight(usd("1.00"), [1, -1])).toThrow(RangeError)
  })
})

describe("cost that belongs to a tenant reaches that tenant", () => {
  it("attributes tagged lines directly", () => {
    const result = allocate({
      lines: [forTenant("acme", "30.00"), forTenant("beta", "20.00")],
      drivers: {},
      tenantIds: ["acme", "beta"],
    })
    expect(result.tenants.find((t) => t.tenantId === "acme")!.direct.units).toBe(usd("30.00").units)
    expect(result.tenants.find((t) => t.tenantId === "beta")!.direct.units).toBe(usd("20.00").units)
    expect(result.unallocated).toEqual([])
  })

  it("keeps amortized separate from actual", () => {
    // They answer different questions. Presenting one as the other is how a
    // team celebrates a saving in the month it prepaid.
    const result = allocate({
      lines: [line({ id: "l1", tags: { [TENANT_TAG]: "acme" }, unblendedCost: usd("120.00"), amortizedCost: usd("10.00") })],
      drivers: {},
      tenantIds: ["acme"],
    })
    expect(result.ingested.units).toBe(usd("120.00").units)
    expect(result.ingestedAmortized.units).toBe(usd("10.00").units)
    expect(result.tenants[0].total.units).toBe(usd("120.00").units)
    expect(result.tenants[0].amortizedTotal.units).toBe(usd("10.00").units)
  })
})

describe("shared cost is split only by a documented driver", () => {
  const natDriver: AllocationDriver = {
    id: "nat-bytes",
    measure: "share of NAT gateway bytes processed, from VPC flow logs",
    weights: { acme: 75, beta: 25 },
  }

  it("splits by the driver and records what justified each share", () => {
    // An operator asked "why is this tenant paying $75 of the NAT gateway"
    // gets the driver and the measurement, not a number.
    const result = allocate({
      lines: [line({ id: "nat", service: "AmazonVPC", unblendedCost: usd("100.00"), amortizedCost: usd("100.00") })],
      drivers: { AmazonVPC: natDriver },
      tenantIds: ["acme", "beta"],
    })

    const acme = result.tenants.find((t) => t.tenantId === "acme")!
    expect(acme.allocated.units).toBe(usd("75.00").units)
    expect(acme.attributions).toEqual([
      { driverId: "nat-bytes", measure: natDriver.measure, weight: 75, totalWeight: 100 },
    ])
  })

  it("reports untagged spend as unallocated when no driver covers it", () => {
    // The clause that decides whether any of this is worth reading. Spreading
    // it evenly would be a driver nobody chose.
    const result = allocate({
      lines: [line({ id: "shared", service: "AWSSupportBusiness", unblendedCost: usd("400.00"), amortizedCost: usd("400.00") })],
      drivers: {},
      tenantIds: ["acme", "beta"],
    })

    expect(result.unallocatedTotal.units).toBe(usd("400.00").units)
    expect(result.tenants.every((t) => t.total.units === 0)).toBe(true)
    expect(result.unallocated[0].reason).toMatch(/No allocation driver is defined for AWSSupportBusiness/)
    expect(result.unallocated[0].lineIds).toEqual(["shared"])
  })

  it("does not spread a cost whose driver measured zero for everyone", () => {
    const result = allocate({
      lines: [line({ id: "idle", service: "AmazonVPC", unblendedCost: usd("50.00"), amortizedCost: usd("50.00") })],
      drivers: { AmazonVPC: { id: "nat-bytes", measure: natDriver.measure, weights: { acme: 0, beta: 0 } } },
      tenantIds: ["acme", "beta"],
    })
    expect(result.unallocatedTotal.units).toBe(usd("50.00").units)
    expect(result.unallocated[0].reason).toMatch(/measured zero for every tenant/)
  })

  it("does not redistribute a line tagged for a tenant the fleet does not know", () => {
    // Misattributed, not shared. Either the tenant was removed while its
    // resources were not, or the tag is wrong — and both need a human, not an
    // averaging function.
    const result = allocate({
      lines: [forTenant("ghost", "60.00")],
      drivers: {},
      tenantIds: ["acme", "beta"],
    })
    expect(result.unallocatedTotal.units).toBe(usd("60.00").units)
    expect(result.unallocated[0].reason).toMatch(/not a tenant this fleet knows/)
    expect(result.tenants.every((t) => t.total.units === 0)).toBe(true)
  })
})

describe("the parts add back to the bill", () => {
  it("reconciles across direct, allocated and unallocated together", () => {
    // The property that makes the page worth reading, so it is computed rather
    // than trusted.
    const result = allocate({
      lines: [
        forTenant("acme", "33.33"),
        forTenant("beta", "16.67"),
        line({ id: "nat", service: "AmazonVPC", unblendedCost: usd("10.00"), amortizedCost: usd("10.00") }),
        line({ id: "support", service: "AWSSupportBusiness", unblendedCost: usd("40.00"), amortizedCost: usd("40.00") }),
      ],
      drivers: { AmazonVPC: { id: "nat-bytes", measure: "bytes", weights: { acme: 1, beta: 2 } } },
      tenantIds: ["acme", "beta"],
    })

    const check = reconcile(result)
    expect(check.reconciles).toBe(true)
    expect(check.discrepancy.units).toBe(0)
    expect(check.ingested.units).toBe(usd("100.00").units)
    expect(check.unallocated.units).toBe(usd("40.00").units)
  })

  it("reconciles when a shared cost splits unevenly", () => {
    const result = allocate({
      lines: [line({ id: "nat", service: "AmazonVPC", unblendedCost: usd("10.00"), amortizedCost: usd("10.00") })],
      drivers: { AmazonVPC: { id: "d", measure: "m", weights: { a: 1, b: 1, c: 1 } } },
      tenantIds: ["a", "b", "c"],
    })
    expect(reconcile(result).reconciles).toBe(true)
  })

  it("refuses a mixed-currency ingest instead of producing a wrong total", () => {
    expect(() =>
      allocate({
        lines: [forTenant("acme", "10.00"), line({ id: "eu", unblendedCost: fromDecimal("10.00", "EUR"), amortizedCost: fromDecimal("10.00", "EUR") })],
        drivers: {},
        tenantIds: ["acme"],
      }),
    ).toThrow(CurrencyMismatchError)
  })
})

describe("every figure carries its currency and its as-of", () => {
  it("refuses a figure with no valid as-of", () => {
    // AWS billing settles over days. A number with no age is one an operator
    // cannot act on.
    expect(() => figure(usd("1.00"), "ACTUAL", "")).toThrow(TypeError)
    expect(() => figure(usd("1.00"), "ACTUAL", "not a date")).toThrow(TypeError)
  })

  it("says when data is too old to present without a caveat", () => {
    const fresh = freshness(new Date(NOW.getTime() - 3_600_000).toISOString(), NOW)
    expect(fresh.stale).toBe(false)
    const old = freshness(new Date(NOW.getTime() - (STALE_AFTER_HOURS + 1) * 3_600_000).toISOString(), NOW)
    expect(old.stale).toBe(true)
  })

  it("refuses a completeness outside 0–1", () => {
    expect(() => figure(usd("1.00"), "ACTUAL", NOW.toISOString(), 1.4)).toThrow(RangeError)
  })
})

describe("a forecast is labelled a forecast, and withheld when it would be absurd", () => {
  it("projects straight-line to the end of the period", () => {
    const actual = figure(usd("50.00"), "ACTUAL", NOW.toISOString(), 0.5)
    const projected = forecastPeriod(actual, NOW)
    expect(projected!.kind).toBe("FORECAST")
    expect(projected!.amount.units).toBe(usd("100.00").units)
  })

  it("gives no forecast three days into a month", () => {
    // One backfill job makes the projection absurd, and an absurd number shown
    // confidently is worse than no number.
    const early = figure(usd("5.00"), "ACTUAL", NOW.toISOString(), MIN_COMPLETENESS_TO_FORECAST / 2)
    expect(forecastPeriod(early, NOW)).toBeNull()
  })

  it("produces the same forecast from the same input", () => {
    const actual = figure(usd("50.00"), "ACTUAL", NOW.toISOString(), 0.5)
    expect(forecastPeriod(actual, NOW)!.amount.units).toBe(forecastPeriod(actual, NOW)!.amount.units)
  })
})

describe("budget is assessed against the forecast, not against the month to date", () => {
  const budget = figure(usd("100.00"), "BUDGET", NOW.toISOString())

  it("flags a tenant on track to exceed before it has", () => {
    // The only state at which anyone can still do something about it. Comparing
    // actual-to-date against a whole-month budget says "under budget" on every
    // first of the month.
    const actual = figure(usd("60.00"), "ACTUAL", NOW.toISOString(), 0.5)
    const assessment = assessBudget(actual, budget, NOW)
    expect(assessment.state).toBe("AT_RISK")
    expect(assessment.forecast!.amount.units).toBe(usd("120.00").units)
  })

  it("reports over when it is already over", () => {
    const actual = figure(usd("110.00"), "ACTUAL", NOW.toISOString(), 0.6)
    expect(assessBudget(actual, budget, NOW).state).toBe("OVER")
  })

  it("does not call a tenant on track when it has no budget", () => {
    // "No budget set" is not the same as "on track", and conflating them is how
    // an unbudgeted tenant stays invisible.
    const actual = figure(usd("900.00"), "ACTUAL", NOW.toISOString(), 0.5)
    const assessment = assessBudget(actual, null, NOW)
    expect(assessment.state).toBe("NO_BUDGET")
    expect(assessment.detail).toMatch(/not the same as being on track/)
  })

  it("is under when the trajectory is comfortable", () => {
    const actual = figure(usd("10.00"), "ACTUAL", NOW.toISOString(), 0.5)
    expect(assessBudget(actual, budget, NOW).state).toBe("UNDER")
  })
})

describe("anomalies are deterministic and not drowned in noise", () => {
  it("finds a service that multiplied", () => {
    const found = detectAnomalies(
      "service",
      { AmazonVPC: usd("300.00"), AmazonS3: usd("10.00") },
      { AmazonVPC: usd("50.00"), AmazonS3: usd("9.00") },
    )
    expect(found.map((a) => a.key)).toEqual(["AmazonVPC"])
    expect(found[0].ratio).toBeCloseTo(6)
  })

  it("ignores a trivial amount that tripled", () => {
    // Without the floor, every service that went from four cents to twelve is
    // an anomaly and the NAT gateway is somewhere in the middle of the list.
    expect(detectAnomalies("service", { Tiny: usd("0.30") }, { Tiny: usd("0.10") })).toEqual([])
  })

  it("reports a service that is new this period", () => {
    const found = detectAnomalies("service", { Bedrock: usd("500.00") }, {})
    expect(found[0].ratio).toBe(Infinity)
    expect(found[0].detail).toMatch(/new this period/)
  })

  it("does not flag growth below the ratio", () => {
    const justUnder = money(usd("100.00").units * (ANOMALY_RATIO - 0.5), USD)
    expect(detectAnomalies("service", { S: justUnder }, { S: usd("100.00") })).toEqual([])
  })

  it("returns the same anomalies in the same order every time", () => {
    const current = { B: usd("300.00"), A: usd("300.00") }
    const baseline = { B: usd("10.00"), A: usd("10.00") }
    expect(detectAnomalies("s", current, baseline).map((a) => a.key)).toEqual(["A", "B"])
  })
})

describe("unit cost", () => {
  it("divides by what the tenant actually gets", () => {
    expect(unitCost("organization", 4, usd("100.00")).perUnit!.units).toBe(usd("25.00").units)
  })

  it("gives null rather than zero when there is nothing to divide by", () => {
    // $0.00 per organization would read as extremely efficient for a tenant
    // costing money and serving no one.
    expect(unitCost("organization", 0, usd("100.00")).perUnit).toBeNull()
  })
})

describe("cost thresholds decide how much approval a commitment needs", () => {
  it("escalates with the recurring monthly amount", () => {
    expect(approvalFor({ change: "tag", estimated: usd("5.00") }).level).toBe("NONE")
    expect(approvalFor({ change: "NAT gateway", estimated: usd("60.00") }).level).toBe("PEER")
    expect(approvalFor({ change: "Aurora cluster", estimated: usd("900.00") }).level).toBe("TWO_PERSON")
    expect(approvalFor({ change: "new account", estimated: usd("9000.00") }).level).toBe("EXECUTIVE")
  })

  it("says a two-person approval may not come from the requester", () => {
    expect(approvalFor({ change: "Aurora cluster", estimated: usd("900.00") }).detail).toMatch(
      /neither may be the requester/,
    )
  })

  it("assesses the plan's total, not only each change", () => {
    // Ten changes at $60 each is $600 a month. Approving them one at a time as
    // "peer" is how a fleet's bill grows without any decision to grow it.
    const changes = Array.from({ length: 10 }, (_, i) => ({ change: `thing ${i}`, estimated: usd("60.00") }))
    const preview = previewPlanCost(changes, USD)
    expect(preview.total.units).toBe(usd("600.00").units)
    expect(preview.decisions.every((d) => d.level === "PEER")).toBe(true)
    expect(preview.level).toBe("TWO_PERSON")
  })

  it("records an estimate even when nothing needs approving", () => {
    expect(approvalFor({ change: "a tag", estimated: usd("1.00") }).detail).toMatch(/estimate is still recorded/)
  })
})

describe("the summary the Center opens with", () => {
  it("carries unallocated spend as a share of the whole", () => {
    const result = allocate({
      lines: [forTenant("acme", "60.00"), line({ id: "s", service: "Support", unblendedCost: usd("40.00"), amortizedCost: usd("40.00") })],
      drivers: {},
      tenantIds: ["acme"],
    })
    const summary = summarize(result, NOW.toISOString(), 0.5, NOW)
    expect(summary.unallocatedShare).toBeCloseTo(0.4)
    expect(summary.actual.kind).toBe("ACTUAL")
    expect(summary.forecast!.kind).toBe("FORECAST")
    expect(summary.lineCount).toBe(2)
  })

  it("reports zero honestly for an empty period", () => {
    const summary = summarize(allocate({ lines: [], drivers: {}, tenantIds: ["acme"] }), NOW.toISOString(), 1, NOW)
    expect(summary.actual.amount).toEqual(zero(USD))
    expect(summary.unallocatedShare).toBe(0)
    expect(summary.lineCount).toBe(0)
  })
})
