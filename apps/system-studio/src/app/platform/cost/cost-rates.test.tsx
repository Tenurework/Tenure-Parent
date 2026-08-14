import { renderToStaticMarkup } from "react-dom/server"

import {
  pricingReadings,
  type PricingReadings,
  type ShapeRequest,
} from "../../../lib/aws/pricing"
import type { AwsGateway } from "../../../lib/aws/read"

import { CostRates } from "./CostRates"
import {
  HOURS_PER_MONTH,
  MONTHLY_ROUNDING,
  isHourly,
  monthlyFor,
  rateRows,
  ratesAnswer,
  standingMonthly,
  unknownGroups,
} from "./cost-rates"

/**
 * STUDIO-070-004 (Pricing adapter) — the published rate reaches the FinOps
 * Center, and an unpriced shape is UNKNOWN rather than free.
 *
 * ## Why this drives the production reader and the production component
 *
 * Every reading below comes out of `pricingReadings` — the same function
 * `/platform/cost/page.tsx` calls with no arguments — handed a stand-in gateway
 * that answers with the shapes the SDK really returns: a `PriceList` of JSON
 * STRINGS whose prices are DECIMAL STRINGS, because that is what the Price List
 * API sends. And most assertions are on the MARKUP `<CostRates>` emits, not on a
 * helper called directly. Both halves matter for the same reason: a test that
 * exercised the arithmetic in isolation would stay green on the day the page
 * stopped rendering it, which is exactly the failure this work exists to close —
 * a reader that was real, tested, granted, and reached no screen at all.
 *
 * ## The rules being held
 *
 *   1. A total is stated only when EVERY shape resolved. One unpriced shape and
 *      the figure is the word Unknown, never a smaller number.
 *   2. A published rate is never rendered at the currency's display precision.
 *      $0.0000001250 per write request unit must not print as `$0.00`.
 *   3. No quantity is invented: a per-request rate gets no monthly figure.
 *   4. Currencies do not add.
 *   5. A refused read renders through `UnknownState` with the pasteable minimum
 *      IAM statement, and never as an empty table or a zero.
 *
 * No account id, ARN or price here is real. `123456789012` is AWS's own
 * documentation placeholder and the rates are round numbers chosen to exercise
 * the arithmetic.
 */

/* -------------------------------------------------------------- fixtures -- */

const ACCOUNT = "123456789012"
const REGION = "eu-west-2"
const PRINCIPAL = `arn:aws:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`
const NOW = () => new Date("2026-08-13T10:00:00Z")

interface DimensionFixture {
  rateCode: string
  unit: string
  description: string
  beginRange?: string
  endRange?: string
  pricePerUnit: Record<string, string>
}

/** One `PriceList` entry: a JSON document the SDK hands back as a string. */
function priceDoc(product: {
  sku: string
  productFamily: string
  usagetype: string
  dimensions: DimensionFixture[]
}): string {
  const priceDimensions: Record<string, unknown> = {}
  for (const dimension of product.dimensions) {
    priceDimensions[dimension.rateCode] = {
      rateCode: dimension.rateCode,
      unit: dimension.unit,
      description: dimension.description,
      beginRange: dimension.beginRange ?? "0",
      endRange: dimension.endRange ?? "Inf",
      appliesTo: [],
      pricePerUnit: dimension.pricePerUnit,
    }
  }
  return JSON.stringify({
    product: {
      sku: product.sku,
      productFamily: product.productFamily,
      attributes: { usagetype: product.usagetype },
    },
    serviceCode: "fixture",
    version: "20260813000000",
    publicationDate: "2026-08-01T00:00:00Z",
    terms: {
      OnDemand: {
        [`${product.sku}.JRTCKXETXF`]: {
          sku: product.sku,
          offerTermCode: "JRTCKXETXF",
          effectiveDate: "2026-08-01T00:00:00Z",
          termAttributes: {},
          priceDimensions,
        },
      },
    },
  })
}

/** Fargate at $0.082 a vCPU-hour and $0.009 a GB-hour. Both hourly. */
const ECS_PRODUCTS = [
  priceDoc({
    sku: "FARGATEVCPU001",
    productFamily: "Compute",
    usagetype: "EUW2-Fargate-vCPU-Hours:perCPU",
    dimensions: [
      {
        rateCode: "FARGATEVCPU001.JRTCKXETXF.6YS6EN2CT7",
        unit: "Hrs",
        description: "AWS Fargate - vCPU - per hour",
        pricePerUnit: { USD: "0.0820000000" },
      },
    ],
  }),
  priceDoc({
    sku: "FARGATEGB0001",
    productFamily: "Compute",
    usagetype: "EUW2-Fargate-GB-Hours",
    dimensions: [
      {
        rateCode: "FARGATEGB0001.JRTCKXETXF.6YS6EN2CT7",
        unit: "Hrs",
        description: "AWS Fargate - Memory - per GB per hour",
        pricePerUnit: { USD: "0.0090000000" },
      },
    ],
  }),
]

/** A write request unit, priced far below a cent. Rule 2's fixture. */
const DYNAMODB_PRODUCTS = [
  priceDoc({
    sku: "DDBWRU0000001",
    productFamily: "Amazon DynamoDB PayPerRequest Throughput",
    usagetype: "EUW2-WriteRequestUnits",
    dimensions: [
      {
        rateCode: "DDBWRU0000001.JRTCKXETXF.6YS6EN2CT7",
        unit: "WriteRequestUnits",
        description: "DynamoDB PayPerRequest Write Request Units",
        pricePerUnit: { USD: "0.0000001250" },
      },
    ],
  }),
]

/** An application load balancer hour, published in yuan. Rule 4's fixture. */
const ELB_PRODUCTS_CNY = [
  priceDoc({
    sku: "ALBHOUR000001",
    productFamily: "Load Balancer-Application",
    usagetype: "CNW1-LoadBalancerUsage",
    dimensions: [
      {
        rateCode: "ALBHOUR000001.JRTCKXETXF.6YS6EN2CT7",
        unit: "Hrs",
        description: "LoadBalancerUsage per hour",
        pricePerUnit: { CNY: "0.1560000000" },
      },
    ],
  }),
]

/** An expensive hourly shape, so the total lands in the top approval band. */
const ELB_PRODUCTS_EXPENSIVE = [
  priceDoc({
    sku: "ALBHOUR000002",
    productFamily: "Load Balancer-Application",
    usagetype: "EUW2-LoadBalancerUsage",
    dimensions: [
      {
        rateCode: "ALBHOUR000002.JRTCKXETXF.6YS6EN2CT7",
        unit: "Hrs",
        description: "LoadBalancerUsage per hour",
        pricePerUnit: { USD: "10.0000000000" },
      },
    ],
  }),
]

type Outcome = "populated" | "denied" | "throttled"

interface FakeOptions {
  /** Products per service code. A missing service code returns nothing at all. */
  products?: Record<string, string[]>
  /** How each service code's GetProducts behaves. */
  outcomes?: Record<string, Outcome>
}

function throwing(name: string): never {
  const error = new Error(`${name} raised by the stand-in AWS client`)
  error.name = name
  throw error
}

/**
 * A stand-in that behaves like the SDK: the same response shapes, the same
 * error names, failable per service code.
 */
function fakeAws(options: FakeOptions = {}): AwsGateway {
  return {
    async call(capability, input = {}) {
      switch (capability) {
        case "sts:GetCallerIdentity":
          return { Account: ACCOUNT, Arn: PRINCIPAL, UserId: "AROA:studio" }
        case "pricing:GetProducts": {
          const serviceCode = String((input as { ServiceCode?: unknown }).ServiceCode ?? "")
          const outcome = options.outcomes?.[serviceCode] ?? "populated"
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          return { PriceList: options.products?.[serviceCode] ?? [] }
        }
        default:
          throw new Error(`${String(capability)} is not a capability this fixture answers`)
      }
    },
    async resolvedRegion() {
      return REGION
    },
  }
}

async function read(
  requests: readonly ShapeRequest[],
  options: FakeOptions = {},
): Promise<PricingReadings> {
  return pricingReadings(fakeAws(options), {
    requests,
    now: NOW,
    // Injected so a throttled fixture's backoff is instant rather than a real
    // wait; the retry SCHEDULE is the reader's own.
    sleep: async () => undefined,
  })
}

const markup = (readings: PricingReadings) =>
  renderToStaticMarkup(<CostRates readings={readings} now={Date.parse("2026-08-13T10:00:00Z")} />)

/**
 * Just the running-total block of the rendered panel.
 *
 * The rule under test is about the TOTAL, not about the rows: a shape whose rate
 * resolved keeps its own monthly figure whatever the shapes beside it did, and
 * that figure is the point of the table. What must never appear is a currency
 * amount under the word total while an input to it is unpriced — so the
 * assertions scope themselves to the block that carries it rather than to the
 * whole document, which would have made them pass for the wrong reason.
 */
function totalBlock(html: string): string {
  const block = /aria-label="The running total[^"]*">([\s\S]*?)<\/dl>/.exec(html)
  if (!block) throw new Error("the panel rendered no running-total block at all")
  return block[1]
}

/* ----------------------------------------------------------------- tests -- */

describe("a published hourly rate becomes a monthly figure with its quantity stated", () => {
  it("extends the rate over a stated month and sums the shapes as integers", async () => {
    const readings = await read(
      [{ shape: "fargate-vcpu-hour" }, { shape: "fargate-gb-hour" }],
      { products: { AmazonECS: ECS_PRODUCTS } },
    )

    const rows = rateRows(readings)
    expect(rows.map((row) => row.status)).toEqual(["priced", "priced"])

    // AWS's own published decimal, with the currency beside it. NOT the
    // currency-precision format — see the sub-cent test below.
    expect(rows[0].unit.text).toBe("0.0820000000 USD per Hrs")

    // $0.082 × 730 = $59.86, and $0.009 × 730 = $6.57.
    expect(rows[0].monthly.text).toBe("$59.86")
    expect(rows[1].monthly.text).toBe("$6.57")

    const standing = standingMonthly(readings)
    expect(standing.known).toBe(true)
    if (!standing.known) throw new Error("unreachable")

    // The exact integer, not a float comparison: cents × 10^6.
    expect(standing.amount).toEqual({ units: (8_200_000 + 900_000) * 730, currency: "USD" })
    expect(standing.currency).toBe("USD")
    expect(standing.included).toEqual(["fargate-vcpu-hour", "fargate-gb-hour"])

    const html = markup(readings)
    expect(html).toContain("$66.43")
    // The quantity is on the page rather than implied. A monthly cost is a rate
    // times a quantity, and a page showing the product while hiding the
    // quantity is showing an opinion.
    expect(html).toContain(`${HOURS_PER_MONTH} hours`)
    // And the exact integer travels with it, so a disputed figure can be
    // checked without trusting the formatter.
    expect(html).toContain(`${(8_200_000 + 900_000) * 730} × 10^-6 minor units of USD`)
  })

  it("states the quantity and the rounding rather than defaulting them", () => {
    // 8,760 / 12, which is AWS's own month. Not the length of the current one:
    // a quote 3% larger in March than in February varies for no reason a reader
    // can act on.
    expect(HOURS_PER_MONTH).toBe(730)
    // Never `down`: truncation is the one mode that can only understate a
    // commitment, which is the direction that gets a change approved under a
    // band it should have been over.
    expect(MONTHLY_ROUNDING).toBe("half-up")
  })
})

describe("an unpriced shape makes the total Unknown, never smaller", () => {
  it("refuses a total while any shape has no resolved rate, and names them", async () => {
    /*
     * `rds-instance-hour` requires an instance class and an engine, and this
     * surface has neither — so the reader never makes the call and the shape
     * comes back UNCONFIGURED. That is the ordinary case on this page, and it
     * is the case a console gets wrong: dropping the unpriced row and totalling
     * the rest prices it at zero.
     */
    const readings = await read(
      [{ shape: "fargate-vcpu-hour" }, { shape: "rds-instance-hour" }],
      { products: { AmazonECS: ECS_PRODUCTS } },
    )

    const standing = standingMonthly(readings)
    expect(standing.known).toBe(false)
    if (standing.known) throw new Error("unreachable")
    expect(standing.missing).toEqual(["rds-instance-hour"])
    expect(standing.why).toMatch(/priced it at zero/)

    const html = markup(readings)
    const total = totalBlock(html)
    // No currency amount under the word total. A figure printed there is read as
    // the total, however carefully the caveat beside it is worded — and the sum
    // of what happened to resolve ($59.86 here) is the most convincing wrong
    // answer available.
    expect(total).toContain("Unknown")
    expect(total).not.toMatch(/\$\d/)
    expect(total).not.toContain("59.86")
    // The row that DID resolve keeps its own figure: that is the table's job.
    expect(html).toContain("$59.86")
    // And the shape that caused the unknown is named, so the gap is closable.
    expect(total).toContain("rds-instance-hour")

    const answer = ratesAnswer(readings, standing)
    expect(answer.badge).toBe("1 unpriced")
    expect(answer.tone).toBe("warn")
  })

  it("does not band an unknown total as though it were small", async () => {
    const readings = await read([{ shape: "rds-instance-hour" }])
    const html = markup(readings)
    expect(html).toContain("cannot be approved on cost")
    expect(html).not.toContain("no approval gate at this figure")
  })
})

describe("a rate finer than a cent is never rendered as zero", () => {
  it("prints the published decimal and carries the exact integer", async () => {
    const readings = await read([{ shape: "dynamodb-write-request-units" }], {
      products: { AmazonDynamoDB: DYNAMODB_PRODUCTS },
    })

    const [row] = rateRows(readings)
    expect(row.status).toBe("priced")
    expect(row.unit.text).toContain("0.0000001250 USD")
    expect(row.unit.title).toMatch(/× 10\^-6 minor units of USD/)

    const html = markup(readings)
    // The defect this holds off: $0.0000001250 formatted at USD display
    // precision is `$0.00`, and a real charge shown as $0.00 is a claim.
    expect(html).not.toContain("$0.00")
    expect(html).toContain("0.0000001250 USD")

    /*
     * Including in the provenance line, which is where this nearly went wrong.
     * The reader's own `describeShapeRate` renders a rate through the currency's
     * display precision — "0.00 USD per WriteRequestUnits (0 minor units of
     * USD)" — which is correct for a log line and is the exact rendering this
     * surface exists to refuse. So the evidence for a resolved rate is built
     * from the published decimal and the exact integer instead.
     */
    expect(row.evidence).toContain("0.0000001250 USD")
    expect(row.evidence).not.toContain("0 minor units of USD")
    expect(row.evidence).toContain("125 × 10^-6 minor units of USD")
    // And it still names the SKU and the rate code, so a disputed figure is
    // traceable to the line AWS published.
    expect(row.evidence).toContain("DDBWRU0000001")
  })

  it("gives a per-request rate no monthly figure at all", async () => {
    const readings = await read([{ shape: "dynamodb-write-request-units" }], {
      products: { AmazonDynamoDB: DYNAMODB_PRODUCTS },
    })

    const [row] = rateRows(readings)
    // Known rate, unknowable month: the quantity belongs to the plan being
    // quoted. Not the word Unknown — that would make a perfectly readable price
    // look like a failed read — and not a number this engine made up.
    expect(row.monthly.text).toBe("depends on volume")
    expect(row.monthly.known).toBe(true)
    expect(row.monthly.title).toMatch(/will not invent a volume/)

    const standing = standingMonthly(readings)
    expect(standing.known).toBe(false)
    if (standing.known) throw new Error("unreachable")
    expect(standing.excluded.map((entry) => entry.shape)).toEqual([
      "dynamodb-write-request-units",
    ])
    expect(markup(readings)).toContain("depends on volume")
  })

  it("knows which units are a span of time", () => {
    for (const unit of ["Hrs", "hours", "vCPU-Hours", "GB-Hours", "LCU-Hrs"]) {
      expect(isHourly(unit)).toBe(true)
    }
    for (const unit of ["GB-Mo", "Requests", "WriteRequestUnits", "Messages", "GB"]) {
      expect(isHourly(unit)).toBe(false)
    }
  })
})

describe("currencies do not add", () => {
  it("reports the total unknown rather than summing dollars with yuan", async () => {
    const readings = await read([{ shape: "fargate-vcpu-hour" }, { shape: "alb-hour" }], {
      products: { AmazonECS: ECS_PRODUCTS, AWSELB: ELB_PRODUCTS_CNY },
    })

    const rows = rateRows(readings)
    expect(rows.map((row) => row.status)).toEqual(["priced", "priced"])
    expect(rows[1].unit.text).toContain("CNY")

    const standing = standingMonthly(readings)
    expect(standing.known).toBe(false)
    if (standing.known) throw new Error("unreachable")
    expect(standing.why).toContain("CNY and USD")

    const total = totalBlock(markup(readings))
    expect(total).toContain("Unknown")
    // Neither currency's figure stands in for a total of both.
    expect(total).not.toMatch(/\$\d/)
    expect(total).not.toContain("113.88")
  })
})

describe("the total is read against the approval policy", () => {
  it("bands the standing commitment through the same function that gates a plan", async () => {
    // $10/hour is $7,300 a month, which is above the executive threshold.
    const readings = await read([{ shape: "alb-hour" }], {
      products: { AWSELB: ELB_PRODUCTS_EXPENSIVE },
    })

    const standing = standingMonthly(readings)
    expect(standing.known).toBe(true)
    if (!standing.known) throw new Error("unreachable")
    expect(standing.amount).toEqual({ units: 1_000_000_000 * 730, currency: "USD" })
    expect(standing.approval).toBe("EXECUTIVE")

    const html = markup(readings)
    expect(totalBlock(html)).toContain("$7300.00")
    expect(html).toContain("an executive decision")
  })
})

describe("a read this engine could not perform is a refusal, not an empty table", () => {
  it("renders the denial once, with the principal, the action and a pasteable statement", async () => {
    const readings = await read(
      [{ shape: "fargate-vcpu-hour" }, { shape: "fargate-gb-hour" }],
      { outcomes: { AmazonECS: "denied" } },
    )

    const groups = unknownGroups(readings)
    // One panel, not one per shape: grouping is by the arm and the capability,
    // which is exactly what the remedy depends on, and both shapes are named in
    // it so neither failure disappears into a summary.
    expect(groups).toHaveLength(1)
    expect(groups[0].shapes).toEqual(["fargate-vcpu-hour", "fargate-gb-hour"])

    const html = markup(readings)
    expect(html.match(/data-reason="DENIED"/g) ?? []).toHaveLength(1)
    expect(html).toContain("pricing:GetProducts")
    expect(html).toContain(PRINCIPAL)
    // The pasteable minimum statement — STUDIO-000-007's own remedy.
    expect(html).toContain("&quot;Action&quot;")
    // And nothing anywhere claims these shapes are free.
    expect(html).not.toContain("$0.00")
    expect(standingMonthly(readings).known).toBe(false)
  })

  it("keeps a throttle apart from a denial", async () => {
    const readings = await read([{ shape: "fargate-vcpu-hour" }], {
      outcomes: { AmazonECS: "throttled" },
    })

    const groups = unknownGroups(readings)
    expect(groups).toHaveLength(1)
    expect(groups[0].read.state).toBe("THROTTLED")
    // Nothing is broken and no policy needs editing — a different remedy, and
    // therefore a different panel.
    expect(markup(readings)).toContain('data-reason="THROTTLED"')
  })

  it("propagates an unresolved rate into the monthly extension", async () => {
    // AmazonSES answers successfully with no products at all, which is the
    // EMPTY arm: the call worked and the shape is not in the published list.
    // That is not a denial and it is not a price of zero.
    const readings = await read([{ shape: "ses-outbound-message" }], { products: {} })
    expect(monthlyFor(readings.shapes[0]).kind).toBe("unknown")
    expect(rateRows(readings)[0].monthly.text).toBe("Unknown")
    expect(markup(readings)).not.toContain("$0.00")
  })
})
