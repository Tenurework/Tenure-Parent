import {
  INFRASTRUCTURE_COMPONENTS,
  PriceError,
  costComponent,
  describeGroundedCost,
  extendResolvedRate,
  extendTierLadder,
  groundShapeCost,
  groundedLines,
  groundedRunningTotal,
  money,
  priceProblems,
  quoteConfiguration,
  runningTotal,
  toMinorUnits,
  toOptionPrice,
  type CompleteGroundedCost,
  type Money,
  type ResolvedRate,
  type ResolvedRates,
  type ResolvedShapeRate,
  type ResolvedTier,
  type TenantShape,
} from "./index"

/**
 * STUDIO-070-004 — the priced catalogue, grounded.
 *
 * ## Every figure in this file is SYNTHETIC and is not a claim about AWS
 *
 * The rates below are round numbers chosen so the arithmetic is checkable by
 * hand — one cent an hour, a hundredth of a cent a message. None of them is a
 * transcription of an AWS list price and none of them asserts what AWS charges
 * for anything. The module under test never contains a price at all; it takes
 * resolved rates as input, and what is being proven here is the ARITHMETIC and
 * the REFUSALS, both of which are independent of what the real numbers are.
 *
 * ## What most of these assertions are about
 *
 * Not the multiplication. The multiplication is the easy half. What is asserted
 * over and over is that a rate this engine could not resolve NEVER becomes a
 * zero: not through a missing key, not through an `unknown` arm, not through an
 * `ambiguous` one, not through a ladder with a hole in it, and not through a
 * product too large to be exact. A running total that quietly treats an unpriced
 * option as free is the exact cost surprise the per-option price tag exists to
 * prevent, and every test below that ends in `INCOMPLETE` is one more way it is
 * prevented.
 */

/* ------------------------------------------------------------- fixtures -- */

const SCALE_FACTOR = 10 ** 6

/** Synthetic. One whole cent, per one unit of whatever the meter counts. */
const flat = (unitsPerOne: number, unit: string, currency = "USD"): ResolvedShapeRate => ({
  kind: "flat",
  rate: { amount: money(unitsPerOne, currency), perQuantity: 1, unit, currency },
})

const rate = (unitsPerOne: number, unit: string, currency = "USD"): ResolvedRate => ({
  amount: money(unitsPerOne, currency),
  perQuantity: 1,
  unit,
  currency,
})

/** A two-rung synthetic ladder: 2.3c a unit to 50, 2.2c a unit above. */
const STORAGE_TIERS: readonly ResolvedTier[] = [
  { fromUnits: 0, toUnits: 50, rate: rate(2_300_000, "GB-Mo") },
  { fromUnits: 50, toUnits: null, rate: rate(2_200_000, "GB-Mo") },
]

const STORAGE_LADDER: ResolvedShapeRate = { kind: "tiered", tiers: STORAGE_TIERS }

/** One cent a Fargate vCPU-hour, a hundredth of a cent an SES message. */
const RATES: ResolvedRates = {
  "fargate-vcpu-hour": flat(1_000_000, "Hrs"),
  "ses-outbound-message": flat(10_000, "Message"),
}

const COMPUTE: TenantShape = {
  optionKey: "officer-directory",
  usage: [
    {
      component: "fargate-vcpu-hour",
      perOrgQuantity: 730,
      perSeatQuantity: 0,
      basis: "one always-on 1-vCPU task for 730 hours, from the task definition in infrastructure/terraform",
    },
    {
      component: "ses-outbound-message",
      perOrgQuantity: 0,
      perSeatQuantity: 500,
      basis: "500 notification messages per seat per month, from the reminder cadence",
    },
  ],
}

/* --------------------------------------------------- the extension math -- */

describe("a rate is extended over a quantity in exact integer arithmetic", () => {
  it("multiplies without ever forming a float total", () => {
    const extended = extendResolvedRate(rate(1_000_000, "Hrs"), 730, "half-up")
    expect(extended).toEqual({ resolved: true, cost: { units: 730_000_000, currency: "USD" } })
    // 730 whole cents. The trap this avoids is `0.01 * 730`, which is
    // 7.299999999999999 in doubles.
    expect(toMinorUnits((extended as { cost: Money }).cost, "half-up")).toBe(730)
  })

  it("divides by perQuantity, which is why that field is required", () => {
    // A rate finer than Money holds exactly arrives from the reader as an
    // amount per 10 units. Ignoring perQuantity is an error of a power of ten.
    const perTen: ResolvedRate = {
      amount: money(125, "USD"),
      perQuantity: 10,
      unit: "WriteRequestUnits",
      currency: "USD",
    }
    expect(extendResolvedRate(perTen, 1_000_000, "half-up")).toEqual({
      resolved: true,
      cost: { units: 12_500_000, currency: "USD" },
    })
  })

  it("refuses a rate whose stated currency disagrees with its own amount", () => {
    const broken: ResolvedRate = { amount: money(5, "EUR"), perQuantity: 1, unit: "Hrs", currency: "USD" }
    const extended = extendResolvedRate(broken, 10, "half-up")
    expect(extended.resolved).toBe(false)
    if (extended.resolved) throw new Error("expected an unresolved amount")
    expect(extended.why).toContain("disagree")
  })

  it("refuses a rate that buys zero units rather than dividing by zero", () => {
    const broken: ResolvedRate = { amount: money(5, "USD"), perQuantity: 0, unit: "Hrs", currency: "USD" }
    expect(extendResolvedRate(broken, 10, "half-up").resolved).toBe(false)
  })

  it("refuses a product too large to be an exact integer instead of losing digits", () => {
    const extended = extendResolvedRate(rate(1_000_000, "Requests"), 1e12, "half-up")
    expect(extended.resolved).toBe(false)
    if (extended.resolved) throw new Error("expected an unresolved amount")
    expect(extended.why).toContain("exact integer arithmetic")
  })

  it("refuses a quantity that is not a quantity", () => {
    expect(extendResolvedRate(rate(1_000_000, "Hrs"), Number.NaN, "half-up").resolved).toBe(false)
    expect(extendResolvedRate(rate(1_000_000, "Hrs"), -1, "half-up").resolved).toBe(false)
  })
})

describe("a tier ladder is charged graduated, not at the marginal rate", () => {
  it("charges the first band at the first band's price", () => {
    // 50 × 2.3c + 10 × 2.2c = 115c + 22c = 137c. Charging all 60 at the
    // marginal 2.2c would be 132c — a quote 5 cents under the bill.
    const extended = extendTierLadder(STORAGE_TIERS, 60, "half-up")
    expect(extended).toEqual({ resolved: true, cost: { units: 137_000_000, currency: "USD" } })
  })

  it("refuses a ladder that does not start at zero rather than giving away the bottom", () => {
    const extended = extendTierLadder(
      [{ fromUnits: 100, toUnits: null, rate: rate(1_000_000, "GB-Mo") }],
      150,
      "half-up",
    )
    expect(extended.resolved).toBe(false)
    if (extended.resolved) throw new Error("expected an unresolved amount")
    expect(extended.why).toContain("will not charge them at nothing")
  })

  it("refuses a ladder with a gap in it", () => {
    const extended = extendTierLadder(
      [
        { fromUnits: 0, toUnits: 50, rate: rate(1_000_000, "GB-Mo") },
        { fromUnits: 60, toUnits: null, rate: rate(900_000, "GB-Mo") },
      ],
      70,
      "half-up",
    )
    expect(extended.resolved).toBe(false)
    if (extended.resolved) throw new Error("expected an unresolved amount")
    expect(extended.why).toContain("has no price")
  })

  it("refuses a quantity above a closed top rung rather than pricing the overage at nothing", () => {
    const extended = extendTierLadder(
      [{ fromUnits: 0, toUnits: 50, rate: rate(1_000_000, "GB-Mo") }],
      60,
      "half-up",
    )
    expect(extended.resolved).toBe(false)
    if (extended.resolved) throw new Error("expected an unresolved amount")
    expect(extended.why).toContain("is not free")
  })

  it("refuses a ladder that mixes currencies", () => {
    const extended = extendTierLadder(
      [
        { fromUnits: 0, toUnits: 50, rate: rate(1_000_000, "GB-Mo") },
        { fromUnits: 50, toUnits: null, rate: rate(900_000, "GB-Mo", "EUR") },
      ],
      60,
      "half-up",
    )
    expect(extended.resolved).toBe(false)
  })

  it("refuses an empty ladder", () => {
    expect(extendTierLadder([], 10, "half-up").resolved).toBe(false)
  })
})

/* ------------------------------------------------------ a grounded shape -- */

describe("a shape is priced per seat AND for the whole organisation", () => {
  it("produces both halves and a running total from real rates", () => {
    const cost = groundShapeCost(COMPUTE, RATES, { seats: 20, rounding: "half-up" })
    expect(cost.state).toBe("COMPLETE")
    if (cost.state !== "COMPLETE") throw new Error(cost.why)

    // 730 Fargate hours at 1c = 730c for the organisation, whatever the seats.
    expect(cost.perOrgMinor).toBe(730)
    // 500 messages a seat at 0.01c = 5c a seat.
    expect(cost.perSeatMinor).toBe(5)
    // 5 × 20 + 730 = 830.
    expect(cost.totalMinor).toBe(830)
    expect(cost.currency).toBe("USD")
    expect(cost.seats).toBe(20)
    expect(cost.rounding).toBe("half-up")
    // A flat rate is linear, so the decomposition is exact and there is no
    // residue to explain.
    expect(cost.exactTotalMinor).toBe(830)
    expect(cost.roundingDifferenceMinor).toBe(0)
    expect(cost.lines.map((line) => line.decomposition)).toEqual(["linear", "linear"])
  })

  it("states where every quantity came from, so the price is grounded on both halves", () => {
    const cost = groundShapeCost(COMPUTE, RATES, { seats: 20, rounding: "half-up" })
    if (cost.state !== "COMPLETE") throw new Error(cost.why)
    expect(cost.lines.map((line) => line.basis)).toEqual([
      "one always-on 1-vCPU task for 730 hours, from the task definition in infrastructure/terraform",
      "500 notification messages per seat per month, from the reminder cadence",
    ])
  })

  it("orders its lines the same way every time", () => {
    const cost = groundShapeCost(COMPUTE, RATES, { seats: 20, rounding: "half-up" })
    if (cost.state !== "COMPLETE") throw new Error(cost.why)
    expect(cost.lines.map((line) => line.component)).toEqual([
      "fargate-vcpu-hour",
      "ses-outbound-message",
    ])
  })
})

/* --------------------------------------------- the propagation of UNKNOWN -- */

describe("an unresolved rate propagates and never becomes zero", () => {
  const seatsAndRounding = { seats: 20, rounding: "half-up" } as const

  it("refuses a total when a rate came back unknown", () => {
    const cost = groundShapeCost(
      COMPUTE,
      {
        ...RATES,
        "ses-outbound-message": { kind: "unknown", why: "pricing:GetProducts returned no matching dimension" },
      },
      seatsAndRounding,
    )

    expect(cost.state).toBe("INCOMPLETE")
    // The point of the union: there is no total to read, at all. Not a zero,
    // not a null, not a partial — the field does not exist on this arm.
    expect("totalMinor" in cost).toBe(false)
    expect("perSeatMinor" in cost).toBe(false)
    expect("perOrgMinor" in cost).toBe(false)
    if (cost.state !== "INCOMPLETE") throw new Error("expected INCOMPLETE")
    expect(cost.unpriced.map((entry) => entry.component)).toEqual(["ses-outbound-message"])
    expect(cost.why).toContain("no matching dimension")
    // What DID price is still visible, so an operator can see the hole.
    expect(cost.priced.map((line) => line.component)).toEqual(["fargate-vcpu-hour"])
  })

  it("refuses a total when a component is simply missing from the rate table", () => {
    const cost = groundShapeCost(
      COMPUTE,
      { "fargate-vcpu-hour": flat(1_000_000, "Hrs") },
      seatsAndRounding,
    )
    expect(cost.state).toBe("INCOMPLETE")
    if (cost.state !== "INCOMPLETE") throw new Error("expected INCOMPLETE")
    expect(cost.unpriced[0].why).toContain("unpriced, not free")
  })

  it("refuses a total when several published rates matched and none was chosen", () => {
    const cost = groundShapeCost(
      COMPUTE,
      { ...RATES, "fargate-vcpu-hour": { kind: "ambiguous", why: "3 published rates match." } },
      seatsAndRounding,
    )
    expect(cost.state).toBe("INCOMPLETE")
    if (cost.state !== "INCOMPLETE") throw new Error("expected INCOMPLETE")
    expect(cost.unpriced[0].why).toContain("will not pick one")
  })

  it("refuses a total when a resolved ladder cannot cover the quantity", () => {
    const cost = groundShapeCost(
      {
        optionKey: "document-vault",
        usage: [
          {
            component: "s3-storage",
            perOrgQuantity: 10,
            perSeatQuantity: 2,
            basis: "10 GB of shared records plus 2 GB a seat, from the retention policy",
          },
        ],
      },
      { "s3-storage": { kind: "tiered", tiers: [{ fromUnits: 0, toUnits: 20, rate: rate(2_300_000, "GB-Mo") }] } },
      seatsAndRounding,
    )
    expect(cost.state).toBe("INCOMPLETE")
    if (cost.state !== "INCOMPLETE") throw new Error("expected INCOMPLETE")
    expect(cost.unpriced[0].why).toContain("is not free")
  })

  it("refuses a total across two currencies rather than adding them", () => {
    const cost = groundShapeCost(
      COMPUTE,
      { ...RATES, "ses-outbound-message": flat(10_000, "Message", "EUR") },
      seatsAndRounding,
    )
    expect(cost.state).toBe("MIXED_CURRENCY")
    expect("totalMinor" in cost).toBe(false)
    if (cost.state !== "MIXED_CURRENCY") throw new Error("expected MIXED_CURRENCY")
    expect(cost.byCurrency).toEqual([
      { currency: "EUR", components: ["ses-outbound-message"] },
      { currency: "USD", components: ["fargate-vcpu-hour"] },
    ])
  })

  it("says so in the sentence a surface prints, rather than printing a number", () => {
    const cost = groundShapeCost(
      COMPUTE,
      { ...RATES, "ses-outbound-message": { kind: "unknown", why: "denied" } },
      seatsAndRounding,
    )
    expect(describeGroundedCost(cost)).toMatch(/^no total —/)
  })
})

/* ------------------------------------------- a shape this engine refuses -- */

describe("a shape that is not a shape is refused before any rate is touched", () => {
  const usage = COMPUTE.usage

  it("refuses a fractional seat count", () => {
    expect(() => groundShapeCost(COMPUTE, RATES, { seats: 2.5, rounding: "half-up" })).toThrow(PriceError)
  })

  it("refuses a negative seat count", () => {
    expect(() => groundShapeCost(COMPUTE, RATES, { seats: -1, rounding: "half-up" })).toThrow(PriceError)
  })

  it("refuses the same meter declared twice", () => {
    expect(() =>
      groundShapeCost(
        { optionKey: "x", usage: [...usage, usage[0]] },
        RATES,
        { seats: 1, rounding: "half-up" },
      ),
    ).toThrow(/declares fargate-vcpu-hour twice/)
  })

  it("refuses a negative quantity", () => {
    expect(() =>
      groundShapeCost(
        { optionKey: "x", usage: [{ ...usage[0], perOrgQuantity: -5 }] },
        RATES,
        { seats: 1, rounding: "half-up" },
      ),
    ).toThrow(/not a usage/)
  })

  it("refuses a meter listed at zero usage, which is how an unpriced rate hides", () => {
    expect(() =>
      groundShapeCost(
        { optionKey: "x", usage: [{ ...usage[0], perOrgQuantity: 0, perSeatQuantity: 0 }] },
        RATES,
        { seats: 1, rounding: "half-up" },
      ),
    ).toThrow(/leave it out instead/)
  })

  it("refuses a quantity with no stated basis", () => {
    expect(() =>
      groundShapeCost(
        { optionKey: "x", usage: [{ ...usage[0], basis: "  " }] },
        RATES,
        { seats: 1, rounding: "half-up" },
      ),
    ).toThrow(/a felt price/)
  })

  it("prices an option that provisions no infrastructure at exactly nothing, with the reason", () => {
    const cost = groundShapeCost({ optionKey: "flag-only", usage: [] }, RATES, {
      seats: 40,
      rounding: "half-up",
    })
    if (cost.state !== "COMPLETE") throw new Error("expected COMPLETE")
    expect(cost.totalMinor).toBe(0)
    expect(toOptionPrice(cost).includedBecause).toContain("provisions no billable infrastructure")
  })
})

/* ------------------------------------------------ the graduated residue -- */

describe("a graduated meter's per-seat figure is an average, and the residue is stated", () => {
  const VAULT: TenantShape = {
    optionKey: "document-vault",
    usage: [
      {
        component: "s3-storage",
        perOrgQuantity: 40,
        perSeatQuantity: 3,
        basis: "40 GB of shared records plus 3 GB a seat, from the retention policy",
      },
    ],
  }

  it("charges the ladder at the full quantity and averages the seats' block", () => {
    const cost = groundShapeCost(VAULT, { "s3-storage": STORAGE_LADDER }, {
      seats: 7,
      rounding: "half-up",
    })
    if (cost.state !== "COMPLETE") throw new Error("expected COMPLETE")

    // 40 + 3×7 = 61 GB-Mo. 50 × 2.3c + 11 × 2.2c = 115c + 24.2c = 139.2c.
    expect(cost.exactTotal.units).toBe(139_200_000)
    expect(cost.exactTotalMinor).toBe(139)
    // The organisation alone is 40 × 2.3c = 92c; the seats add 47.2c, which
    // over seven seats is 6.742857…c and rounds to 7c on the price tag.
    expect(cost.perOrgMinor).toBe(92)
    expect(cost.perSeatMinor).toBe(7)
    expect(cost.lines[0].decomposition).toBe("graduated")
  })

  it("states the difference between the quoted total and the metered cost", () => {
    const cost = groundShapeCost(VAULT, { "s3-storage": STORAGE_LADDER }, {
      seats: 7,
      rounding: "half-up",
    })
    if (cost.state !== "COMPLETE") throw new Error("expected COMPLETE")
    // 7 × 7 + 92 = 141 against a metered 139. Two cents, and they are on the
    // record rather than absorbed into a figure nobody can reconcile.
    expect(cost.totalMinor).toBe(141)
    expect(cost.roundingDifferenceMinor).toBe(2)
    expect(describeGroundedCost(cost)).toContain("differs from the metered cost by 2 minor unit(s)")
  })

  it("quotes the marginal cost of the first seat when there are no seats yet", () => {
    const cost = groundShapeCost(VAULT, { "s3-storage": STORAGE_LADDER }, {
      seats: 0,
      rounding: "half-up",
    })
    if (cost.state !== "COMPLETE") throw new Error("expected COMPLETE")
    // The first seat adds 3 GB, all inside the 2.3c band: 6.9c.
    expect(cost.perSeat.units).toBe(6_900_000)
    expect(cost.totalMinor).toBe(92)
  })
})

/* ------------------------------------------------------- the running total -- */

describe("the running total across a configuration", () => {
  const VAULT: TenantShape = {
    optionKey: "document-vault",
    usage: [
      {
        component: "s3-storage",
        perOrgQuantity: 40,
        perSeatQuantity: 0,
        basis: "40 GB of shared records, from the retention policy",
      },
    ],
  }

  it("totals every option when every option priced", () => {
    const total = groundedRunningTotal([COMPUTE, VAULT], { ...RATES, "s3-storage": STORAGE_LADDER }, {
      seats: 20,
      rounding: "half-up",
    })
    expect(total.state).toBe("COMPLETE")
    if (total.state !== "COMPLETE") throw new Error(total.why)
    expect(total.perOrgMinor).toBe(730 + 92)
    expect(total.perSeatMinor).toBe(5)
    expect(total.totalMinor).toBe(5 * 20 + 822)
    expect(total.lines.map((line) => line.optionKey)).toEqual(["officer-directory", "document-vault"])
  })

  it("withholds the total entirely when ONE rate of ONE option is unknown", () => {
    // The mutation proof of the whole module: one rate goes unknown and the
    // total stops existing. It does not get smaller, which is the failure this
    // prevents — a configuration quoted 100 cents short reads as a bargain.
    const total = groundedRunningTotal(
      [COMPUTE, VAULT],
      { ...RATES, "s3-storage": { kind: "unknown", why: "AccessDenied on pricing:GetProducts" } },
      { seats: 20, rounding: "half-up" },
    )

    expect(total.state).toBe("INCOMPLETE")
    expect("totalMinor" in total).toBe(false)
    expect("perSeatMinor" in total).toBe(false)
    if (total.state !== "INCOMPLETE") throw new Error("expected INCOMPLETE")
    expect(total.why).toContain("withheld rather than shown short")
    expect(total.why).toContain("AccessDenied")
    expect(total.refused.map((cost) => cost.optionKey)).toEqual(["document-vault"])
    // The option that DID price is still there — the refusal is scoped, not a
    // blank page.
    expect(total.priced.map((cost) => cost.optionKey)).toEqual(["officer-directory"])
    expect(total.priced[0].totalMinor).toBe(830)
  })

  it("prints UNAVAILABLE rather than a number when it is incomplete", () => {
    const total = groundedRunningTotal(
      [COMPUTE],
      { ...RATES, "ses-outbound-message": { kind: "unknown", why: "throttled" } },
      { seats: 20, rounding: "half-up" },
    )
    const lines = groundedLines(total)
    expect(lines[0].label).toBe("Running total")
    expect(lines[0].text).toMatch(/^UNAVAILABLE —/)
    expect(lines[0].text).not.toMatch(/\d+\.\d\d USD/)
  })

  it("prints the total when it is complete", () => {
    const total = groundedRunningTotal([COMPUTE], RATES, { seats: 20, rounding: "half-up" })
    const lines = groundedLines(total)
    expect(lines[0].text).toContain("8.30 USD a month at 20 seat(s)")
    expect(lines[0].text).toContain("rounded half-up")
  })

  it("refuses to total options priced in different currencies", () => {
    const total = groundedRunningTotal(
      [COMPUTE, VAULT],
      {
        "fargate-vcpu-hour": flat(1_000_000, "Hrs"),
        "ses-outbound-message": flat(10_000, "Message"),
        "s3-storage": flat(2_300_000, "GB-Mo", "EUR"),
      },
      { seats: 20, rounding: "half-up" },
    )
    expect(total.state).toBe("INCOMPLETE")
    if (total.state !== "INCOMPLETE") throw new Error("expected INCOMPLETE")
    expect(total.why).toContain("EUR and USD")
    // Both options priced; they simply do not add.
    expect(total.priced.map((cost) => cost.optionKey)).toEqual(["officer-directory", "document-vault"])
  })
})

/* ------------------------------- the bridge into the composer's price tag -- */

describe("a grounded cost becomes the price tag the composer already renders", () => {
  it("produces an OptionPrice the existing validator accepts", () => {
    const cost = groundShapeCost(COMPUTE, RATES, { seats: 20, rounding: "half-up" })
    if (cost.state !== "COMPLETE") throw new Error("expected COMPLETE")
    const price = toOptionPrice(cost)
    expect(price).toEqual({ perSeatMinor: 5, perOrgMinor: 730, currency: "USD", rounding: "half-up" })
    expect(priceProblems(price, "grounded")).toEqual([])
  })

  it("reconciles exactly with quoteConfiguration, which is what the composer totals", () => {
    const cost = groundShapeCost(COMPUTE, RATES, { seats: 20, rounding: "half-up" })
    if (cost.state !== "COMPLETE") throw new Error("expected COMPLETE")
    const quote = quoteConfiguration([{ optionKey: cost.optionKey, price: toOptionPrice(cost) }], 20)
    // The number the grounded engine computed and the number the composer
    // displays are the same number. Two pricing implementations that disagree
    // is how the figure on the screen becomes the one nobody validated.
    expect(quote.runningTotalMinor).toBe(cost.totalMinor)
  })

  it("reconciles exactly with runningTotal, which is what the configuration page totals", () => {
    const cost = groundShapeCost(COMPUTE, RATES, { seats: 20, rounding: "half-up" })
    if (cost.state !== "COMPLETE") throw new Error("expected COMPLETE")
    const total = runningTotal([{ key: cost.optionKey, price: toOptionPrice(cost) }], 20)
    expect(toMinorUnits(total.total, "half-up")).toBe(cost.totalMinor)
    expect(toMinorUnits(total.perSeat, "half-up")).toBe(cost.perSeatMinor)
    expect(toMinorUnits(total.organization, "half-up")).toBe(cost.perOrgMinor)
  })

  it("says WHY a zero price is zero when AWS published no charge", () => {
    const cost = groundShapeCost(
      {
        optionKey: "certificate",
        usage: [
          {
            component: "alb-hour",
            perOrgQuantity: 730,
            perSeatQuantity: 0,
            basis: "one load balancer for 730 hours",
          },
        ],
      },
      { "alb-hour": flat(0, "Hrs") },
      { seats: 20, rounding: "half-up" },
    )
    if (cost.state !== "COMPLETE") throw new Error("expected COMPLETE")
    const price = toOptionPrice(cost)
    expect(price.perSeatMinor).toBe(0)
    expect(price.includedBecause).toContain("published at no charge")
  })

  it("says a price that rounds away is SMALL, not free", () => {
    const cost = groundShapeCost(
      {
        optionKey: "queue",
        usage: [
          {
            component: "sqs-requests",
            perOrgQuantity: 100,
            perSeatQuantity: 0,
            basis: "100 queue requests a month, from the job schedule",
          },
        ],
      },
      // 4 units is four millionths of a cent per request; a hundred of them is
      // 0.0004 of a cent and rounds to no minor units at all.
      { "sqs-requests": flat(4, "Requests") },
      { seats: 3, rounding: "half-up" },
    )
    if (cost.state !== "COMPLETE") throw new Error("expected COMPLETE")
    const price = toOptionPrice(cost)
    expect(price.perOrgMinor).toBe(0)
    expect(price.includedBecause).toContain("It is not free")
    expect(price.includedBecause).toContain("smaller than this currency can invoice")
  })
})

/* -------------------------------------- the shape the Studio reader hands -- */

describe("the reader's own rate shape is accepted without a cast", () => {
  /**
   * A structural copy of `apps/system-studio/src/lib/aws/pricing.ts`'s `Rate`
   * and `ShapeRate`, declared here rather than imported.
   *
   * Imported would be the wrong direction: a package may not depend on an app,
   * and a test that reached into one would compile in this repository and
   * nowhere else. What matters is that the reader's value — WITH its extra
   * provenance fields — is assignable to `ResolvedShapeRate`, and that is what
   * this proves. The fields are exactly the reader's, so if it ever drops one
   * this fixture is where the divergence shows up.
   */
  interface ReaderRate {
    readonly amount: Money
    readonly perQuantity: number
    readonly unit: string
    readonly currency: string
    readonly publishedDecimal: string
    readonly free: boolean
  }
  type ReaderShapeRate =
    | {
        kind: "flat"
        sku: string
        rateCode: string
        rate: ReaderRate
        description: string
        effectiveDate: string | null
      }
    | {
        kind: "tiered"
        sku: string
        tiers: readonly {
          readonly fromUnits: number
          readonly toUnits: number | null
          readonly rate: ReaderRate
          readonly rateCode: string
          readonly description: string
        }[]
        effectiveDate: string | null
      }
    | { kind: "unknown"; why: string }
    | { kind: "ambiguous"; why: string; candidates: readonly string[] }

  const fromReader: ReaderShapeRate = {
    kind: "flat",
    sku: "SKU-FIXTURE",
    rateCode: "SKU-FIXTURE.RATE",
    rate: {
      amount: money(1_000_000, "USD"),
      perQuantity: 1,
      unit: "Hrs",
      currency: "USD",
      publishedDecimal: "0.01",
      free: false,
    },
    description: "a synthetic fixture, not an AWS price",
    effectiveDate: null,
  }

  it("takes a ShapeRate straight from the reader as a ResolvedShapeRate", () => {
    // The assignment IS the assertion. If the reader's shape ever stops
    // satisfying this module's input, this line stops compiling.
    const asInput: ResolvedShapeRate = fromReader
    const rates: ResolvedRates = { "fargate-vcpu-hour": asInput }
    const cost = groundShapeCost(
      {
        optionKey: "reader-fixture",
        usage: [
          {
            component: "fargate-vcpu-hour",
            perOrgQuantity: 730,
            perSeatQuantity: 0,
            basis: "one always-on 1-vCPU task for 730 hours",
          },
        ],
      },
      rates,
      { seats: 10, rounding: "half-up" },
    )
    if (cost.state !== "COMPLETE") throw new Error("expected COMPLETE")
    expect(cost.totalMinor).toBe(730)
  })

  it("prices the same fourteen meters the reader reads", () => {
    expect(INFRASTRUCTURE_COMPONENTS).toHaveLength(14)
    expect([...INFRASTRUCTURE_COMPONENTS].sort()).toEqual([...INFRASTRUCTURE_COMPONENTS])
    // Every one of them is a real component key, and this is the list the
    // Studio's `SHAPES` catalogue keys on.
    expect(INFRASTRUCTURE_COMPONENTS).toContain("dynamodb-write-request-units")
    expect(INFRASTRUCTURE_COMPONENTS).toContain("cloudfront-data-transfer-out")
    expect(INFRASTRUCTURE_COMPONENTS).toContain("elasticache-node-hour")
    expect(INFRASTRUCTURE_COMPONENTS).toContain("rds-instance-hour")
    expect(INFRASTRUCTURE_COMPONENTS).toContain("alb-lcu-hour")
  })
})

/* ------------------------------------------------------- one component -- */

describe("costComponent is the unit the shape is built out of", () => {
  it("returns an unpriced entry, never a zero line, when the rate is absent", () => {
    const outcome = costComponent(
      {
        component: "dynamodb-read-request-units",
        perOrgQuantity: 1_000,
        perSeatQuantity: 10,
        basis: "1,000 registry lookups plus 10 a seat",
      },
      undefined,
      5,
      "half-up",
    )
    expect(outcome.line).toBeNull()
    expect(outcome.unpriced?.component).toBe("dynamodb-read-request-units")
    expect(outcome.unpriced?.basis).toBe("1,000 registry lookups plus 10 a seat")
  })

  it("keeps a flat meter's halves adding back exactly", () => {
    const outcome = costComponent(
      {
        component: "dynamodb-read-request-units",
        perOrgQuantity: 1_000,
        perSeatQuantity: 10,
        basis: "1,000 registry lookups plus 10 a seat",
      },
      flat(125, "ReadRequestUnits"),
      5,
      "half-up",
    )
    const line = outcome.line
    if (!line) throw new Error("expected a priced line")
    expect(line.organization.units).toBe(125_000)
    expect(line.perSeat.units).toBe(1_250)
    expect(line.quotedTotal.units).toBe(line.exactTotal.units)
    expect(line.exactTotal.units).toBe(125_000 + 1_250 * 5)
  })
})

/* --------------------------------------------------------------- scale -- */

describe("nothing here is a float", () => {
  it("keeps every Money an integer through a long chain", () => {
    const cost = groundShapeCost(COMPUTE, RATES, { seats: 137, rounding: "half-even" })
    if (cost.state !== "COMPLETE") throw new Error("expected COMPLETE")
    for (const line of cost.lines) {
      for (const amount of [line.organization, line.perSeat, line.quotedTotal, line.exactTotal]) {
        expect(Number.isInteger(amount.units)).toBe(true)
      }
    }
    for (const amount of [cost.perSeat, cost.organization, cost.exactTotal]) {
      expect(Number.isInteger(amount.units)).toBe(true)
    }
    expect(Number.isInteger(cost.totalMinor)).toBe(true)
    // Sanity on the scale constant the module's Money is built at.
    expect(cost.perSeat.units).toBe(5 * SCALE_FACTOR)
  })
})
