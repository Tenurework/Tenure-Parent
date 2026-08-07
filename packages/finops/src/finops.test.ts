import {
  ANOMALY_RATIO,
  CurrencyMismatchError,
  MIN_COMPLETENESS_TO_FORECAST,
  ROUNDING_MODES,
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
  minorDigits,
  money,
  negate,
  netAfterReversal,
  previewPlanCost,
  reconcile,
  reverseSplit,
  splitAmount,
  summarize,
  sum,
  toDecimal,
  unitCost,
  zero,
  type AllocationDriver,
  type CostLine,
  type FigureSource,
  type RoundingMode,
} from "./index"
import { SplitReversalError } from "./split"

/**
 * STUDIO-120-008/009/010 — the FinOps Center.
 * PAY-030-002 — exact money across currencies and rounding modes.
 * PAY-180-003 — every figure says which system it came from.
 * PAY-070-004 — a multi-recipient split that reverses exactly.
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

/** A citation for the tests, so every `figure` call states one the way production does. */
const SOURCE: FigureSource = {
  system: "aws-cur",
  reference: "s3://tenure-billing/fleet/",
  retrievedAt: NOW.toISOString(),
}

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

/** The mode the CUR path states. Every allocation test uses it unless it is testing modes. */
const INGEST: RoundingMode = "down"

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
    expect(toDecimal(total, "half-even")).toBe("0.30")
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

/* ────────────────────────────────────────────────────────── PAY-030-002 ─── */

describe("the minor unit is the currency's own, not a hundredth", () => {
  it("knows the exponent of the currencies that are not hundredths", () => {
    expect(minorDigits("JPY")).toBe(0)
    expect(minorDigits("KRW")).toBe(0)
    expect(minorDigits("USD")).toBe(2)
    expect(minorDigits("EUR")).toBe(2)
    expect(minorDigits("KWD")).toBe(3)
    expect(minorDigits("BHD")).toBe(3)
    expect(minorDigits("TND")).toBe(3)
    // Unknown codes get two. Refusing them would make the package unusable for
    // a currency AWS started billing in yesterday.
    expect(minorDigits("ZZZ")).toBe(2)
  })

  it("counts ¥1,200 as 1,200 minor units, not 120,000", () => {
    // The bug this replaced: `2 + SCALE` was hardcoded, so a JPY amount counted
    // a hundred times too many minor units. It reconciled with itself and
    // disagreed with the bill by two orders of magnitude.
    expect(fromDecimal("1200", "JPY").units).toBe(1200 * 10 ** 6)
    expect(toDecimal(fromDecimal("1200", "JPY"), "half-even")).toBe("1200")
  })

  it("keeps all three digits of a KWD amount", () => {
    // 1.234 KWD is 1,234 fils. Rendering it as "1.23" drops a legal digit of
    // the currency, which is a real amount of money in a currency worth $3.25.
    expect(toDecimal(fromDecimal("1.234", "KWD"), "half-even")).toBe("1.234")
  })

  // (a) — fromDecimal -> toDecimal round-trips the input string exactly, for
  // every supported currency and every rounding mode. The mode must not matter
  // here: a value that already lands on a minor unit has nothing to round.
  it.each([
    ["USD", ["0.00", "12.34", "-12.34", "1000000.01", "0.01", "-0.01"]],
    ["JPY", ["0", "1200", "-1200", "999999", "1", "-1"]],
    ["KWD", ["0.000", "1.234", "-1.234", "9999.999", "0.001", "-0.001"]],
  ] as const)("round-trips every %s amount through every rounding mode", (currency, samples) => {
    for (const mode of ROUNDING_MODES) {
      for (const decimal of samples) {
        expect(toDecimal(fromDecimal(decimal, currency), mode)).toBe(decimal)
      }
    }
  })

  // (b) — a split always adds back to exactly the whole, whatever the currency
  // and whatever the mode. This is the property the tenant column depends on.
  it.each(["USD", "JPY", "KWD"] as const)("splits %s so the parts add back exactly", (currency) => {
    const amounts = ["10.00", "0.01", "99.99", "1234.56"].map((d) =>
      fromDecimal(currency === "JPY" ? d.replace(".", "") : d, currency),
    )
    const weightVectors = [[1, 1, 1], [7, 11, 13, 17], [1, 2, 1], [1, 1], [5]]
    for (const mode of ROUNDING_MODES) {
      for (const amount of amounts) {
        for (const weights of weightVectors) {
          const parts = allocateByWeight(amount, weights, mode)
          expect(sum(parts, currency).units).toBe(amount.units)
        }
      }
    }
  })

  // (c) — a debit and the credit that exactly reverses it render with the same
  // magnitude. This is what `Math.round` broke: it is half-toward-+Infinity, so
  // +0.005 became "0.01" and -0.005 became "0.00".
  it.each(["USD", "JPY", "KWD"] as const)(
    "renders %s and its negation with equal magnitude, away from a tie",
    (currency) => {
      // None of these is an exact half of a minor unit (units % 10^6 === 500000),
      // so every mode should agree on the magnitude and differ only in sign.
      const values = [1_500_001, 7_000_003, 250_000_000, 999_999_999, 12_345_678_901].map((u) =>
        money(u, currency),
      )
      const magnitude = (rendered: string) => rendered.replace(/^-/, "")
      for (const mode of ROUNDING_MODES) {
        for (const value of values) {
          const positive = toDecimal(value, mode)
          const negative = toDecimal(negate(value), mode)
          expect(magnitude(negative)).toBe(magnitude(positive))
          // And the sign is actually rendered — a magnitude test alone would
          // pass on an implementation that dropped the minus entirely.
          expect(negative.startsWith("-")).toBe(true)
        }
      }
    },
  )

  it("rounds an exact half the way the caller said to, in both directions", () => {
    // Half a cent, exactly, positive and negative. This is the case the four
    // modes exist to disagree about, and the case a bare `Math.round` gets
    // asymmetrically wrong.
    const halfCent = money(500_000, USD) // 0.005 USD
    const negHalfCent = negate(halfCent)

    // half-away-from-zero and half-even are symmetric under negation.
    expect(toDecimal(halfCent, "half-away-from-zero")).toBe("0.01")
    expect(toDecimal(negHalfCent, "half-away-from-zero")).toBe("-0.01")
    expect(toDecimal(halfCent, "half-even")).toBe("0.00")
    expect(toDecimal(negHalfCent, "half-even")).toBe("0.00")
    expect(toDecimal(money(1_500_000, USD), "half-even")).toBe("0.02")
    expect(toDecimal(money(-1_500_000, USD), "half-even")).toBe("-0.02")

    // down truncates toward zero, symmetrically.
    expect(toDecimal(halfCent, "down")).toBe("0.00")
    expect(toDecimal(negHalfCent, "down")).toBe("0.00")

    // half-up goes toward +Infinity and is therefore ASYMMETRIC by definition.
    // It is offered so a caller who wants `Math.round`'s behaviour has to ask
    // for it by name, rather than getting it because nobody chose.
    expect(toDecimal(halfCent, "half-up")).toBe("0.01")
    expect(toDecimal(negHalfCent, "half-up")).toBe("0.00")
  })
})

describe("splitting a shared cost adds back to exactly the whole", () => {
  it("loses nothing to rounding across an awkward split", () => {
    // $10 across three tenants is the classic case: 333.33 each leaves a cent
    // unaccounted for, and at fleet scale that cent becomes the reason the
    // tenant column does not match the total.
    const parts = allocateByWeight(usd("10.00"), [1, 1, 1], INGEST)
    expect(sum(parts, USD).units).toBe(usd("10.00").units)
  })

  it("splits the same way every time", () => {
    // A report that reshuffles cents between tenants on refresh cannot be
    // reconciled against a bill.
    const once = allocateByWeight(usd("100.00"), [7, 11, 13, 17], INGEST).map((p) => p.units)
    const twice = allocateByWeight(usd("100.00"), [7, 11, 13, 17], INGEST).map((p) => p.units)
    expect(once).toEqual(twice)
  })

  it("gives the leftover units to the largest fractions", () => {
    const parts = allocateByWeight(money(10, USD), [1, 1, 1], INGEST)
    expect(parts.map((p) => p.units).sort((a, b) => b - a)).toEqual([4, 3, 3])
    expect(sum(parts, USD).units).toBe(10)
  })

  it("refuses a negative weight", () => {
    expect(() => allocateByWeight(usd("1.00"), [1, -1], INGEST)).toThrow(RangeError)
  })
})

/* ────────────────────────────────────────────────────────── PAY-070-004 ─── */

describe("a split names its recipients and reverses to exactly what it assigned", () => {
  const rules = [
    { recipientId: "acme", weight: 1 },
    { recipientId: "beta", weight: 1 },
    { recipientId: "gamma", weight: 1 },
  ]

  it("names who received what", () => {
    const split = splitAmount(usd("10.00"), rules, INGEST, "nat-aug")
    expect(split.parts.map((p) => p.recipientId)).toEqual(["acme", "beta", "gamma"])
    expect(sum(split.parts.map((p) => p.amount), USD).units).toBe(usd("10.00").units)
  })

  it("refuses a split with no recipients, and one naming the same recipient twice", () => {
    expect(() => splitAmount(usd("1.00"), [], INGEST, "x")).toThrow(RangeError)
    expect(() =>
      splitAmount(usd("1.00"), [{ recipientId: "a", weight: 1 }, { recipientId: "a", weight: 2 }], INGEST, "x"),
    ).toThrow(RangeError)
  })

  it("nets to zero FOR EVERY RECIPIENT, not merely in total", () => {
    // The assertion a total-only test misses. Re-deriving a largest-remainder
    // split on the reversal moves the leftover units between recipients: the
    // total still nets to zero while two recipients are permanently one unit
    // out, in opposite directions.
    //
    // The vector below is chosen to be exactly that case. Five units across two
    // equal weights is an exact half each; `half-up` rounds both toward
    // +Infinity on the way out and both toward +Infinity again on the way back,
    // which lands the leftover unit on the other recipient.
    const tieBreaking = [
      { recipientId: "acme", weight: 1 },
      { recipientId: "beta", weight: 1 },
    ]
    const split = splitAmount(money(5, USD), tieBreaking, "half-up", "tie")
    const reversal = reverseSplit(split, split.amount)

    // Total nets to zero — necessary, and not sufficient.
    expect(sum([...split.parts, ...reversal].map((p) => p.amount), USD).units).toBe(0)

    // Per recipient, which is the property that actually matters.
    for (const net of netAfterReversal(split, reversal)) {
      expect(net.amount.units).toBe(0)
    }
    // And explicitly: each reversal is the negation of what that recipient got.
    expect(reversal.map((p) => p.amount.units)).toEqual(split.parts.map((p) => -p.amount.units))
  })

  it("refuses to reverse an amount that is not what was split", () => {
    // A partial reversal is a different operation with a different answer, and
    // it cannot be a replay. Refused rather than re-derived.
    const split = splitAmount(usd("10.00"), rules, INGEST, "nat-aug")
    expect(() => reverseSplit(split, usd("4.00"))).toThrow(SplitReversalError)
    expect(() => reverseSplit(split, fromDecimal("10.00", "EUR"))).toThrow(CurrencyMismatchError)
  })

  it("keeps Σ parts === whole across 1000 deterministic weight vectors, in USD, JPY and KWD", () => {
    // Deterministic, index-driven: a property test with a random seed produces
    // failures nobody can reproduce, and the first irreproducible failure is the
    // one that teaches everyone to rerun the suite.
    const currencies = ["USD", "JPY", "KWD"] as const
    let checked = 0
    for (let i = 0; i < 1000; i++) {
      const currency = currencies[i % currencies.length]
      const mode = ROUNDING_MODES[i % ROUNDING_MODES.length]
      const recipients = 2 + (i % 7)
      const rules = Array.from({ length: recipients }, (_, k) => ({
        recipientId: `r${k}`,
        // Coprime-ish, index-driven weights, so the fractional parts land all
        // over the place rather than always dividing evenly.
        weight: 1 + ((i * 7 + k * 13) % 29),
      }))
      const amount = money(((i * 977) % 100_000) + 1, currency)
      const split = splitAmount(amount, rules, mode, `s${i}`)
      expect(sum(split.parts.map((p) => p.amount), currency).units).toBe(amount.units)

      const reversal = reverseSplit(split, amount)
      for (const net of netAfterReversal(split, reversal)) expect(net.amount.units).toBe(0)
      checked++
    }
    expect(checked).toBe(1000)
  })
})

describe("cost that belongs to a tenant reaches that tenant", () => {
  it("attributes tagged lines directly", () => {
    const result = allocate({
      lines: [forTenant("acme", "30.00"), forTenant("beta", "20.00")],
      drivers: {},
      tenantIds: ["acme", "beta"],
      rounding: INGEST,
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
      rounding: INGEST,
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
      rounding: INGEST,
    })

    const acme = result.tenants.find((t) => t.tenantId === "acme")!
    expect(acme.allocated.units).toBe(usd("75.00").units)
    expect(acme.attributions).toEqual([
      { driverId: "nat-bytes", measure: natDriver.measure, weight: 75, totalWeight: 100 },
    ])
  })

  it("records the split with its recipients, so it can be reversed exactly", () => {
    // PAY-070-004 reaching the production path: the shared-cost split is a
    // multi-recipient split rule, and the record is what a reversal replays.
    const result = allocate({
      lines: [line({ id: "nat", service: "AmazonVPC", unblendedCost: usd("100.00"), amortizedCost: usd("100.00") })],
      drivers: { AmazonVPC: natDriver },
      tenantIds: ["acme", "beta"],
      rounding: INGEST,
    })
    expect(result.splits).toHaveLength(1)
    expect(result.splits[0].parts.map((p) => p.recipientId)).toEqual(["acme", "beta"])
    expect(result.splits[0].parts.map((p) => p.amount.units)).toEqual([
      usd("75.00").units,
      usd("25.00").units,
    ])
    const reversal = reverseSplit(result.splits[0], result.splits[0].amount)
    for (const net of netAfterReversal(result.splits[0], reversal)) expect(net.amount.units).toBe(0)
  })

  it("reports untagged spend as unallocated when no driver covers it", () => {
    // The clause that decides whether any of this is worth reading. Spreading
    // it evenly would be a driver nobody chose.
    const result = allocate({
      lines: [line({ id: "shared", service: "AWSSupportBusiness", unblendedCost: usd("400.00"), amortizedCost: usd("400.00") })],
      drivers: {},
      tenantIds: ["acme", "beta"],
      rounding: INGEST,
    })

    expect(result.unallocatedTotal.units).toBe(usd("400.00").units)
    expect(result.tenants.every((t) => t.total.units === 0)).toBe(true)
    expect(result.unallocated[0].reason).toMatch(/No allocation driver is defined for AWSSupportBusiness/)
    expect(result.unallocated[0].lineIds).toEqual(["shared"])
    expect(result.splits).toEqual([])
  })

  it("does not spread a cost whose driver measured zero for everyone", () => {
    const result = allocate({
      lines: [line({ id: "idle", service: "AmazonVPC", unblendedCost: usd("50.00"), amortizedCost: usd("50.00") })],
      drivers: { AmazonVPC: { id: "nat-bytes", measure: natDriver.measure, weights: { acme: 0, beta: 0 } } },
      tenantIds: ["acme", "beta"],
      rounding: INGEST,
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
      rounding: INGEST,
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
      rounding: INGEST,
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
      rounding: INGEST,
    })
    expect(reconcile(result).reconciles).toBe(true)
  })

  it("refuses a mixed-currency ingest instead of producing a wrong total", () => {
    expect(() =>
      allocate({
        lines: [forTenant("acme", "10.00"), line({ id: "eu", unblendedCost: fromDecimal("10.00", "EUR"), amortizedCost: fromDecimal("10.00", "EUR") })],
        drivers: {},
        tenantIds: ["acme"],
        rounding: INGEST,
      }),
    ).toThrow(CurrencyMismatchError)
  })
})

describe("every figure carries its currency, its as-of and its source", () => {
  it("refuses a figure with no valid as-of", () => {
    // AWS billing settles over days. A number with no age is one an operator
    // cannot act on.
    expect(() => figure(usd("1.00"), "ACTUAL", "", SOURCE)).toThrow(TypeError)
    expect(() => figure(usd("1.00"), "ACTUAL", "not a date", SOURCE)).toThrow(TypeError)
  })

  it("refuses a figure whose source names no system", () => {
    // PAY-180-003. A blank system renders as an empty badge, which reads as "no
    // claim made" and is indistinguishable from a figure nobody cited.
    expect(() =>
      figure(usd("1.00"), "ACTUAL", NOW.toISOString(), { ...SOURCE, system: "   " }),
    ).toThrow(TypeError)
    expect(() =>
      figure(usd("1.00"), "ACTUAL", NOW.toISOString(), { ...SOURCE, reference: "" }),
    ).toThrow(TypeError)
  })

  it("refuses a source whose retrieval time is not a time", () => {
    expect(() =>
      figure(usd("1.00"), "ACTUAL", NOW.toISOString(), { ...SOURCE, retrievedAt: "recently" }),
    ).toThrow(TypeError)
    expect(() =>
      figure(usd("1.00"), "ACTUAL", NOW.toISOString(), { ...SOURCE, retrievedAt: "" }),
    ).toThrow(TypeError)
  })

  it("says when data is too old to present without a caveat", () => {
    const fresh = freshness(new Date(NOW.getTime() - 3_600_000).toISOString(), NOW)
    expect(fresh.stale).toBe(false)
    const old = freshness(new Date(NOW.getTime() - (STALE_AFTER_HOURS + 1) * 3_600_000).toISOString(), NOW)
    expect(old.stale).toBe(true)
  })

  it("refuses a completeness outside 0–1", () => {
    expect(() => figure(usd("1.00"), "ACTUAL", NOW.toISOString(), SOURCE, 1.4)).toThrow(RangeError)
  })
})

describe("a forecast is labelled a forecast, and withheld when it would be absurd", () => {
  it("projects straight-line to the end of the period", () => {
    const actual = figure(usd("50.00"), "ACTUAL", NOW.toISOString(), SOURCE, 0.5)
    const projected = forecastPeriod(actual, NOW, "half-even")
    expect(projected!.kind).toBe("FORECAST")
    expect(projected!.amount.units).toBe(usd("100.00").units)
  })

  it("carries the actual's citation, marked derived", () => {
    // A projection has no source of its own. Inventing one would say a system
    // produced a number it never saw; dropping it would leave the one figure on
    // the page most likely to be misread as uncited.
    const actual = figure(usd("50.00"), "ACTUAL", NOW.toISOString(), SOURCE, 0.5)
    const projected = forecastPeriod(actual, NOW, "half-even")!
    expect(projected.source.system).toBe(SOURCE.system)
    expect(projected.source.retrievedAt).toBe(SOURCE.retrievedAt)
    expect(projected.source.reference).toContain(SOURCE.reference)
    expect(projected.source.reference).toMatch(/derived/)
  })

  it("gives no forecast three days into a month", () => {
    // One backfill job makes the projection absurd, and an absurd number shown
    // confidently is worse than no number.
    const early = figure(usd("5.00"), "ACTUAL", NOW.toISOString(), SOURCE, MIN_COMPLETENESS_TO_FORECAST / 2)
    expect(forecastPeriod(early, NOW, "half-even")).toBeNull()
  })

  it("produces the same forecast from the same input", () => {
    const actual = figure(usd("50.00"), "ACTUAL", NOW.toISOString(), SOURCE, 0.5)
    expect(forecastPeriod(actual, NOW, "half-even")!.amount.units).toBe(
      forecastPeriod(actual, NOW, "half-even")!.amount.units,
    )
  })
})

describe("budget is assessed against the forecast, not against the month to date", () => {
  const budget = figure(usd("100.00"), "BUDGET", NOW.toISOString(), SOURCE)

  it("flags a tenant on track to exceed before it has", () => {
    // The only state at which anyone can still do something about it. Comparing
    // actual-to-date against a whole-month budget says "under budget" on every
    // first of the month.
    const actual = figure(usd("60.00"), "ACTUAL", NOW.toISOString(), SOURCE, 0.5)
    const assessment = assessBudget(actual, budget, NOW, "half-even")
    expect(assessment.state).toBe("AT_RISK")
    expect(assessment.forecast!.amount.units).toBe(usd("120.00").units)
  })

  it("reports over when it is already over", () => {
    const actual = figure(usd("110.00"), "ACTUAL", NOW.toISOString(), SOURCE, 0.6)
    expect(assessBudget(actual, budget, NOW, "half-even").state).toBe("OVER")
  })

  it("does not call a tenant on track when it has no budget", () => {
    // "No budget set" is not the same as "on track", and conflating them is how
    // an unbudgeted tenant stays invisible.
    const actual = figure(usd("900.00"), "ACTUAL", NOW.toISOString(), SOURCE, 0.5)
    const assessment = assessBudget(actual, null, NOW, "half-even")
    expect(assessment.state).toBe("NO_BUDGET")
    expect(assessment.detail).toMatch(/not the same as being on track/)
  })

  it("is under when the trajectory is comfortable", () => {
    const actual = figure(usd("10.00"), "ACTUAL", NOW.toISOString(), SOURCE, 0.5)
    expect(assessBudget(actual, budget, NOW, "half-even").state).toBe("UNDER")
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
    expect(unitCost("organization", 4, usd("100.00"), "half-even").perUnit!.units).toBe(usd("25.00").units)
  })

  it("gives null rather than zero when there is nothing to divide by", () => {
    // $0.00 per organization would read as extremely efficient for a tenant
    // costing money and serving no one.
    expect(unitCost("organization", 0, usd("100.00"), "half-even").perUnit).toBeNull()
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
  const withSupport = () =>
    allocate({
      lines: [forTenant("acme", "60.00"), line({ id: "s", service: "Support", unblendedCost: usd("40.00"), amortizedCost: usd("40.00") })],
      drivers: {},
      tenantIds: ["acme"],
      rounding: INGEST,
    })

  it("carries unallocated spend as a share of the whole", () => {
    const summary = summarize(withSupport(), NOW.toISOString(), 0.5, NOW, SOURCE, "half-even")
    expect(summary.unallocatedShare).toBeCloseTo(0.4)
    expect(summary.actual.kind).toBe("ACTUAL")
    expect(summary.forecast!.kind).toBe("FORECAST")
    expect(summary.lineCount).toBe(2)
  })

  it("propagates the same source onto actual, amortized and forecast", () => {
    // PAY-180-003. All three are figures on one page; a citation on one of them
    // says nothing about the other two, and a reader will not notice which is
    // which.
    const summary = summarize(withSupport(), NOW.toISOString(), 0.5, NOW, SOURCE, "half-even")
    expect(summary.actual.source).toEqual(SOURCE)
    expect(summary.amortized.source).toEqual(SOURCE)
    expect(summary.forecast!.source.system).toBe(SOURCE.system)
    expect(summary.forecast!.source.retrievedAt).toBe(SOURCE.retrievedAt)
    expect(summary.forecast!.source.reference).toContain(SOURCE.reference)
  })

  it("reports zero honestly for an empty period", () => {
    const summary = summarize(
      allocate({ lines: [], drivers: {}, tenantIds: ["acme"], rounding: INGEST }),
      NOW.toISOString(),
      1,
      NOW,
      SOURCE,
      "half-even",
    )
    expect(summary.actual.amount).toEqual(zero(USD))
    expect(summary.unallocatedShare).toBe(0)
    expect(summary.lineCount).toBe(0)
  })
})
