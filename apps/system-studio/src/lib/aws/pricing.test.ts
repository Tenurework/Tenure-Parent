import { toDecimal, toMinorUnits } from "@tenure/finops"

import { __resetIdentity } from "./identity"
import {
  MAX_PRODUCT_PAGES,
  PRICE_ATTRIBUTION,
  extendRate,
  parsePriceListEntry,
  parseRate,
  priceListPublications,
  pricingLines,
  pricingReadings,
  type PricingReadings,
  type ShapeKey,
  type ShapeRequest,
} from "./pricing"
import { EndpointRegionUnset, type AwsGateway } from "./read"

/**
 * STUDIO-070-004 (Pricing) — the price surface tells four different truths
 * apart, and never renders any of them as free.
 *
 * The assertions are on `pricingReadings`, `pricingLines` and `parseRate` — the
 * functions a surface renders and the one that turns a published decimal into
 * money — rather than on `readAws`. A test that drove `readAws` directly would
 * stay green on the day this module stopped calling it, which is the failure
 * this programme has already paid for twice.
 *
 * ## The stand-in is a client, not a stub
 *
 * `fakeAws` answers three capabilities with the shapes the real SDK returns:
 * `{PriceList: [<JSON STRING>, …], NextToken}` from GetProducts,
 * `{PriceLists: [{PriceListArn, RegionCode, CurrencyCode, FileFormats}]}` from
 * ListPriceLists, and `{Account, Arn}` from STS. Every price is a DECIMAL
 * STRING inside a JSON STRING, because that is exactly what the Price List API
 * sends — a fake handing back numbers would have hidden the parsing this module
 * exists to do, and a fake returning `[]` regardless would prove nothing about
 * code whose whole job is telling four outcomes apart.
 *
 * Each capability, and each service code within GetProducts, can fail
 * independently with `AccessDeniedException`, `ThrottlingException`, an
 * empty-but-successful list or a populated one.
 *
 * No account id, ARN or price here is real. `123456789012` is AWS's own
 * documentation placeholder, and the rates are obviously constructed round
 * numbers chosen to exercise the arithmetic rather than to state what AWS
 * charges.
 */

/* ------------------------------------------------------------- the estate -- */

const ACCOUNT = "123456789012"
const REGION = "eu-west-2"
const PRINCIPAL = `arn:aws:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`

interface DimensionFixture {
  rateCode: string
  unit: string
  description: string
  beginRange?: string
  endRange?: string
  /** Currency code to decimal string, exactly as the wire carries it. */
  pricePerUnit: Record<string, string>
}

interface ProductFixture {
  sku: string
  productFamily: string
  usagetype: string
  attributes?: Record<string, string>
  effectiveDate?: string
  publicationDate?: string
  dimensions: DimensionFixture[]
}

/** One `PriceList` entry: a JSON document the SDK hands back as a string. */
function priceDoc(product: ProductFixture): string {
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
      attributes: { usagetype: product.usagetype, ...(product.attributes ?? {}) },
    },
    serviceCode: "fixture",
    version: "20260813000000",
    publicationDate: product.publicationDate ?? "2026-08-01T00:00:00Z",
    terms: {
      OnDemand: {
        [`${product.sku}.JRTCKXETXF`]: {
          sku: product.sku,
          offerTermCode: "JRTCKXETXF",
          effectiveDate: product.effectiveDate ?? "2026-08-01T00:00:00Z",
          termAttributes: {},
          priceDimensions,
        },
      },
      // A committed rate, deliberately present and deliberately never read: a
      // reserved price is a purchase this estate has not made.
      Reserved: {
        [`${product.sku}.38NPMPTW36`]: {
          sku: product.sku,
          offerTermCode: "38NPMPTW36",
          effectiveDate: "2026-08-01T00:00:00Z",
          priceDimensions: {
            [`${product.sku}.38NPMPTW36.2TG2D8R56U`]: {
              rateCode: `${product.sku}.38NPMPTW36.2TG2D8R56U`,
              unit: "Hrs",
              description: "reserved — must never be quoted",
              beginRange: "0",
              endRange: "Inf",
              pricePerUnit: { USD: "0.0000000001" },
            },
          },
        },
      },
    },
  })
}

/** Fargate: one vCPU-hour and one GB-hour SKU, as ECS publishes them. */
function fargateProducts(): string[] {
  return [
    priceDoc({
      sku: "FARGATEVCPU001",
      productFamily: "Compute",
      usagetype: "EUW2-Fargate-vCPU-Hours:perCPU",
      dimensions: [
        {
          rateCode: "FARGATEVCPU001.JRTCKXETXF.6YS6EN2CT7",
          unit: "hours",
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
          unit: "hours",
          description: "AWS Fargate - Memory - per GB per hour",
          pricePerUnit: { USD: "0.0090000000" },
        },
      ],
    }),
  ]
}

/** DynamoDB on-demand: a write and a read request unit, priced per unit. */
function dynamoProducts(): string[] {
  return [
    priceDoc({
      sku: "DDBWRU0000001",
      productFamily: "Amazon DynamoDB PayPerRequest Throughput",
      usagetype: "EUW2-WriteRequestUnits",
      dimensions: [
        {
          rateCode: "DDBWRU0000001.JRTCKXETXF.6YS6EN2CT7",
          unit: "WriteRequestUnits",
          description: "DynamoDB PayPerRequest Write Request Units",
          // Finer than Money holds exactly. The module scales the QUANTITY
          // rather than truncating, and this fixture is why.
          pricePerUnit: { USD: "0.0000001250" },
        },
      ],
    }),
    priceDoc({
      sku: "DDBRRU0000001",
      productFamily: "Amazon DynamoDB PayPerRequest Throughput",
      usagetype: "EUW2-ReadRequestUnits",
      dimensions: [
        {
          rateCode: "DDBRRU0000001.JRTCKXETXF.6YS6EN2CT7",
          unit: "ReadRequestUnits",
          description: "DynamoDB PayPerRequest Read Request Units",
          pricePerUnit: { USD: "0.0000000250" },
        },
      ],
    }),
  ]
}

/** S3 Standard storage: a three-rung tier ladder under ONE sku. */
function s3StorageProducts(): string[] {
  return [
    priceDoc({
      sku: "S3STANDARD001",
      productFamily: "Storage",
      usagetype: "EUW2-TimedStorage-ByteHrs",
      attributes: { volumeType: "Standard" },
      dimensions: [
        {
          rateCode: "S3STANDARD001.JRTCKXETXF.A1",
          unit: "GB-Mo",
          description: "$0.024 per GB - first 50 TB / month of storage used",
          beginRange: "0",
          endRange: "51200",
          pricePerUnit: { USD: "0.0240000000" },
        },
        {
          rateCode: "S3STANDARD001.JRTCKXETXF.A2",
          unit: "GB-Mo",
          description: "$0.023 per GB - next 450 TB / month of storage used",
          beginRange: "51200",
          endRange: "512000",
          pricePerUnit: { USD: "0.0230000000" },
        },
        {
          rateCode: "S3STANDARD001.JRTCKXETXF.A3",
          unit: "GB-Mo",
          description: "$0.022 per GB - storage used / month over 500 TB",
          beginRange: "512000",
          endRange: "Inf",
          pricePerUnit: { USD: "0.0220000000" },
        },
      ],
    }),
  ]
}

/** CloudFront requests: priced by edge geography, so two locations both match. */
function cloudfrontRequestProducts(): string[] {
  return [
    priceDoc({
      sku: "CFREQEU000001",
      productFamily: "Request",
      usagetype: "EU-Requests-Tier1",
      attributes: { location: "Europe", locationType: "AWS Edge Location" },
      dimensions: [
        {
          rateCode: "CFREQEU000001.JRTCKXETXF.B1",
          unit: "Requests",
          description: "HTTP requests from Europe",
          pricePerUnit: { USD: "0.0000009000" },
        },
      ],
    }),
    priceDoc({
      sku: "CFREQUS000001",
      productFamily: "Request",
      usagetype: "US-Requests-Tier1",
      attributes: { location: "United States", locationType: "AWS Edge Location" },
      dimensions: [
        {
          rateCode: "CFREQUS000001.JRTCKXETXF.B1",
          unit: "Requests",
          description: "HTTP requests from United States",
          pricePerUnit: { USD: "0.0000007500" },
        },
      ],
    }),
  ]
}

/* ------------------------------------------------------------- the client -- */

type Outcome = "populated" | "empty" | "denied" | "throttled" | "endpoint-region-unset"

interface FakeOptions {
  /** How each service code's GetProducts behaves. Missing means "populated". */
  products?: Partial<Record<string, Outcome>>
  /** What each service code returns when populated. */
  priceLists?: Partial<Record<string, string[]>>
  /** Extra pages, keyed by service code: each entry is one further page. */
  pages?: Partial<Record<string, string[][]>>
  publications?: Outcome
  identity?: "denied" | { arn: string; account: string; region: string }
  /** Every call the module made, in order, for asserting what was NOT called. */
  calls?: Array<{ capability: string; input: Record<string, unknown> }>
}

function throwing(name: string): never {
  const error = new Error(`${name} raised by the stand-in AWS client`)
  error.name = name
  throw error
}

const DEFAULT_PRICE_LISTS: Record<string, string[]> = {
  AmazonECS: fargateProducts(),
  AmazonDynamoDB: dynamoProducts(),
  AmazonS3: s3StorageProducts(),
  AmazonCloudFront: cloudfrontRequestProducts(),
}

/**
 * A stand-in that behaves like the SDK: same response shapes, same error names,
 * independently failable per capability AND per service code.
 */
function fakeAws(options: FakeOptions = {}): AwsGateway {
  const identity =
    options.identity ?? { arn: PRINCIPAL, account: ACCOUNT, region: REGION }
  const calls = options.calls ?? []

  return {
    async call(capability, input = {}) {
      calls.push({ capability: String(capability), input })
      switch (capability) {
        case "sts:GetCallerIdentity":
          if (identity === "denied") throwing("AccessDenied")
          return { Account: identity.account, Arn: identity.arn, UserId: "AROA:studio" }

        case "pricing:GetProducts": {
          const serviceCode = String((input as { ServiceCode?: unknown }).ServiceCode ?? "")
          const outcome = options.products?.[serviceCode] ?? "populated"
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          if (outcome === "endpoint-region-unset") {
            // Exactly what client.ts raises when AWS_GLOBAL_ENDPOINT_REGION is
            // unset: the Price List is not served from every region and this
            // engine refuses to guess one.
            throw new EndpointRegionUnset(
              "the Price List API is not served from every region, and AWS_GLOBAL_ENDPOINT_REGION is not set.",
            )
          }
          // The real API omits PriceList entirely when nothing matches. It does
          // not send an empty array, and a fake that did would be testing a
          // response AWS never sends.
          if (outcome === "empty") return {}

          const pages = options.pages?.[serviceCode]
          if (pages) {
            const token = (input as { NextToken?: unknown }).NextToken
            const index = typeof token === "string" ? Number(token) : 0
            const page = pages[index] ?? []
            const next = index + 1 < pages.length ? String(index + 1) : undefined
            return { PriceList: page, NextToken: next }
          }
          return {
            PriceList: options.priceLists?.[serviceCode] ?? DEFAULT_PRICE_LISTS[serviceCode] ?? [],
          }
        }

        case "pricing:ListPriceLists": {
          const outcome = options.publications ?? "populated"
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          if (outcome === "empty") return {}
          return {
            PriceLists: [
              {
                PriceListArn: `arn:aws:pricing:::price-list/aws/${String(
                  (input as { ServiceCode?: unknown }).ServiceCode,
                )}/${String((input as { CurrencyCode?: unknown }).CurrencyCode)}/current`,
                RegionCode: REGION,
                CurrencyCode: String((input as { CurrencyCode?: unknown }).CurrencyCode),
                FileFormats: ["json", "csv"],
              },
            ],
          }
        }

        default:
          throw new Error(
            `the stand-in was asked for ${String(capability)}, which this suite does not exercise`,
          )
      }
    },
    async resolvedRegion() {
      return identity === "denied" ? REGION : identity.region
    },
  }
}

const AT = () => new Date("2026-08-13T09:15:00.000Z")
/** Backoff is spent as a schedule, not as wall-clock time. `now` is injected the same way. */
const NO_WAIT = async () => {}

async function load(
  requests: readonly ShapeRequest[],
  options: FakeOptions = {},
  extra: { currency?: string } = {},
): Promise<PricingReadings> {
  return pricingReadings(fakeAws(options), {
    now: AT,
    sleep: NO_WAIT,
    requests,
    currency: extra.currency,
  })
}

function surfaceText(readings: PricingReadings): string {
  return pricingLines(readings)
    .map((line) => `${line.label}: ${line.text}`)
    .join("\n")
}

function shapeOf(readings: PricingReadings, shape: ShapeKey) {
  const found = readings.shapes.find((s) => s.shape === shape)
  if (!found) throw new Error(`${shape} was not read`)
  return found
}

beforeEach(() => {
  // resolveIdentity caches per process. Every case supplies its own gateway,
  // which bypasses the cache, but a stale cache from another suite would
  // silently make these assertions test the wrong identity.
  __resetIdentity()
})

/* -------------------------------------------- the four outcomes, compared -- */

describe("the price surface says something different for each of the four outcomes", () => {
  const ONE: readonly ShapeRequest[] = [{ shape: "fargate-vcpu-hour" }]

  test("a populated price list is ACTUAL and carries an exact rate", async () => {
    const readings = await load(ONE)
    const shape = shapeOf(readings, "fargate-vcpu-hour")
    expect(shape.products.state).toBe("ACTUAL")
    expect(shape.rate.kind).toBe("flat")
    if (shape.rate.kind !== "flat") throw new Error("narrowing")
    expect(shape.rate.rate.publishedDecimal).toBe("0.0820000000")
    expect(shape.rate.rate.currency).toBe("USD")
    expect(shape.rate.rate.perQuantity).toBe(1)
    // 0.082 USD = 8.2 cents = 8,200,000 units at finops' scale. An INTEGER.
    expect(shape.rate.rate.amount.units).toBe(8_200_000)
    expect(Number.isInteger(shape.rate.rate.amount.units)).toBe(true)
    expect(surfaceText(readings)).toContain("0.08 USD per hours")
  })

  test("an empty-but-successful list is EMPTY and says none, not refused and not free", async () => {
    const readings = await load(ONE, { products: { AmazonECS: "empty" } })
    const shape = shapeOf(readings, "fargate-vcpu-hour")
    expect(shape.products.state).toBe("EMPTY")
    expect(shape.rate.kind).toBe("unknown")
    const text = surfaceText(readings)
    expect(text).toContain("none —")
    expect(text).not.toContain("Minimum statement")
    expect(text).not.toContain("no charge")
    // The arm carries no amount at all, so a caller cannot reach a zero.
    expect("rate" in shape.rate).toBe(false)
  })

  test("AccessDenied is DENIED, carries the principal, the action and a pasteable statement", async () => {
    const readings = await load(ONE, { products: { AmazonECS: "denied" } })
    const shape = shapeOf(readings, "fargate-vcpu-hour")
    expect(shape.products.state).toBe("DENIED")
    if (shape.products.state !== "DENIED") throw new Error("narrowing")

    expect(shape.products.action).toBe("pricing:GetProducts")
    expect(shape.products.principal).toContain("assumed-role/tenure-studio-task")
    expect(shape.products.accountId).toBe(ACCOUNT)
    expect(shape.products.region).toBe(REGION)
    expect(shape.products.partition).toBe("aws")
    expect(JSON.parse(shape.products.minimumStatement)).toEqual({
      Effect: "Allow",
      Action: ["pricing:GetProducts"],
      Resource: "*",
    })

    // And what it must NOT be: there is no `value` on this arm, so no caller
    // can reach an empty list, and no arm of the rate carries a zero.
    expect("value" in shape.products).toBe(false)
    expect(shape.rate.kind).toBe("unknown")
    const text = surfaceText(readings)
    expect(text).toContain("refused pricing:GetProducts")
    expect(text).not.toMatch(/\bnone —/)
    expect(text).not.toContain("no charge")
  })

  test("a throttle is THROTTLED — its own state, not a failure and not an empty list", async () => {
    const readings = await load(ONE, { products: { AmazonECS: "throttled" } })
    const shape = shapeOf(readings, "fargate-vcpu-hour")
    expect(shape.products.state).toBe("THROTTLED")
    if (shape.products.state !== "THROTTLED") throw new Error("narrowing")
    // The schedule is throttle.ts's — 200ms after the first failure, doubling —
    // not a number retyped in this module.
    expect(shape.products.retryAfterMs).toBe(800)
    const text = surfaceText(readings)
    expect(text).toContain("throttled")
    expect(text).toContain("retrying in")
    expect(text).not.toContain("Minimum statement")
  })

  test("the four render as four visibly different surfaces", async () => {
    const texts: string[] = []
    for (const outcome of ["populated", "empty", "denied", "throttled"] as const) {
      __resetIdentity()
      texts.push(surfaceText(await load(ONE, { products: { AmazonECS: outcome } })))
    }
    // Pairwise distinct. A stand-in that returned [] regardless would collapse
    // at least two of these into one string, and this is the assertion that
    // notices.
    expect(new Set(texts).size).toBe(4)
    for (const text of texts) expect(text.length).toBeGreaterThan(0)
  })

  test("an unset global-endpoint region is UNCONFIGURED, not an empty price list", async () => {
    const readings = await load(ONE, { products: { AmazonECS: "endpoint-region-unset" } })
    const shape = shapeOf(readings, "fargate-vcpu-hour")
    expect(shape.products.state).toBe("UNCONFIGURED")
    if (shape.products.state !== "UNCONFIGURED") throw new Error("narrowing")
    expect(shape.products.why).toContain("AWS_GLOBAL_ENDPOINT_REGION")
    expect(surfaceText(readings)).toContain("not configured —")
  })
})

/* ---------------------------------------------------- money is not a float -- */

describe("money is integer minor units, and a fine price is scaled rather than truncated", () => {
  test("a published decimal parses to an exact integer", () => {
    const parsed = parseRate("0.0820000000", "USD", "Hrs")
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error("narrowing")
    expect(parsed.rate.amount.units).toBe(8_200_000)
    expect(parsed.rate.perQuantity).toBe(1)
    expect(parsed.rate.free).toBe(false)
  })

  test("a price finer than money holds is scaled, never truncated to free", async () => {
    const readings = await load([{ shape: "dynamodb-write-request-units" }])
    const shape = shapeOf(readings, "dynamodb-write-request-units")
    expect(shape.rate.kind).toBe("flat")
    if (shape.rate.kind !== "flat") throw new Error("narrowing")
    // 0.000000125 USD per unit. Money holds 8 fractional digits of a dollar, so
    // the QUANTITY is scaled by ten and the amount is exact: 0.00000125 per 10.
    expect(shape.rate.rate.perQuantity).toBe(10)
    expect(shape.rate.rate.amount.units).toBe(125)
    expect(shape.rate.rate.free).toBe(false)
    // The whole point: it did not become zero.
    expect(surfaceText(readings)).not.toContain("no charge")
  })

  test("a price ten times finer scales a hundredfold and stays exact", () => {
    const parsed = parseRate("0.0000000167", "USD", "Requests")
    if (!parsed.ok) throw new Error(parsed.why)
    expect(parsed.rate.perQuantity).toBe(100)
    expect(parsed.rate.amount.units).toBe(167)
  })

  test("a rate extends over a month without a float error", () => {
    const parsed = parseRate("0.0090000000", "USD", "Hrs")
    if (!parsed.ok) throw new Error(parsed.why)
    // The trap, stated with a real one: `0.009 * 730` is 6.569999999999999 in
    // doubles, and that is what a surface doing the arithmetic in floats would
    // carry into a running total, once per line, all the way down the quote.
    expect(0.009 * 730).not.toBe(6.57)
    const month = extendRate(parsed.rate, 730, "half-even")
    expect(month.units).toBe(657_000_000)
    expect(toMinorUnits(month, "half-even")).toBe(657)
    expect(toDecimal(month, "half-even")).toBe("6.57")
  })

  test("a scaled rate extends by the quantity it is stated in", () => {
    const parsed = parseRate("0.0000001250", "USD", "WriteRequestUnits")
    if (!parsed.ok) throw new Error(parsed.why)
    // A caller that ignored perQuantity would be out by ten. One million writes
    // at $0.000000125 is $0.125 — 12 cents rounded down, 13 rounded half-even.
    const million = extendRate(parsed.rate, 1_000_000, "half-even")
    expect(million.units).toBe(12_500_000)
    expect(toDecimal(million, "down")).toBe("0.12")
  })

  test("a currency with no minor unit is not counted in hundredths", () => {
    const parsed = parseRate("1200", "JPY", "Hrs")
    if (!parsed.ok) throw new Error(parsed.why)
    expect(toMinorUnits(parsed.rate.amount, "down")).toBe(1200)
  })

  test("a zero AWS actually published is free, and says so", () => {
    const parsed = parseRate("0.0000000000", "USD", "Requests")
    if (!parsed.ok) throw new Error(parsed.why)
    expect(parsed.rate.free).toBe(true)
    expect(parsed.rate.amount.units).toBe(0)
  })

  test("something that is not a decimal price is refused rather than coerced", () => {
    for (const bad of ["", "N/A", "-0.01", "1e-9", "0.0.1"]) {
      const parsed = parseRate(bad, "USD", "Hrs")
      expect(parsed.ok).toBe(false)
    }
  })

  test("a price finer than the engine will scale is unknown, not rounded", () => {
    const parsed = parseRate("0.000000000000000123", "USD", "Requests")
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error("narrowing")
    expect(parsed.why).toContain("unknown rather than rounded")
  })
})

/* ------------------------------------------------------------- currency -- */

describe("the currency is read, never assumed", () => {
  test("a price list published only in CNY is read as CNY", async () => {
    const readings = await load([{ shape: "fargate-vcpu-hour" }], {
      priceLists: {
        AmazonECS: [
          priceDoc({
            sku: "FARGATECN0001",
            productFamily: "Compute",
            usagetype: "CN-Fargate-vCPU-Hours:perCPU",
            dimensions: [
              {
                rateCode: "FARGATECN0001.JRTCKXETXF.1",
                unit: "hours",
                description: "AWS Fargate - vCPU - per hour",
                pricePerUnit: { CNY: "0.5600000000" },
              },
            ],
          }),
        ],
      },
    })
    const shape = shapeOf(readings, "fargate-vcpu-hour")
    if (shape.rate.kind !== "flat") throw new Error(`expected flat, got ${shape.rate.kind}`)
    expect(shape.rate.rate.currency).toBe("CNY")
    expect(shape.rate.rate.amount.units).toBe(56_000_000)
    expect(surfaceText(readings)).toContain("CNY")
    expect(surfaceText(readings)).not.toContain("USD")
  })

  test("two currencies with no stated preference is unreadable, not a pick", async () => {
    const both = {
      AmazonECS: [
        priceDoc({
          sku: "FARGATEBOTH01",
          productFamily: "Compute",
          usagetype: "EUW2-Fargate-vCPU-Hours:perCPU",
          dimensions: [
            {
              rateCode: "FARGATEBOTH01.JRTCKXETXF.1",
              unit: "hours",
              description: "AWS Fargate - vCPU - per hour",
              pricePerUnit: { USD: "0.0820000000", CNY: "0.5600000000" },
            },
          ],
        }),
      ],
    }
    const readings = await load([{ shape: "fargate-vcpu-hour" }], { priceLists: both })
    const shape = shapeOf(readings, "fargate-vcpu-hour")
    expect(shape.rate.kind).toBe("unknown")
    expect(surfaceText(readings)).toContain("could not read")

    // And with a preference stated, the same list prices.
    __resetIdentity()
    const chosen = await load([{ shape: "fargate-vcpu-hour" }], { priceLists: both }, { currency: "CNY" })
    const picked = shapeOf(chosen, "fargate-vcpu-hour")
    if (picked.rate.kind !== "flat") throw new Error(`expected flat, got ${picked.rate.kind}`)
    expect(picked.rate.rate.currency).toBe("CNY")
  })
})

/* --------------------------------------------------- region and partition -- */

describe("the region comes from the resolved identity, never from a literal", () => {
  test("a region-scoped shape filters on the region STS resolved", async () => {
    const calls: FakeOptions["calls"] = []
    await load([{ shape: "fargate-vcpu-hour" }], { calls })
    const products = calls.filter((c) => c.capability === "pricing:GetProducts")
    expect(products).toHaveLength(1)
    expect(products[0].input.Filters).toEqual([{ Field: "regionCode", Value: REGION }])
  })

  test("an edge-priced shape is not asked for at a region, because it has none", async () => {
    const calls: FakeOptions["calls"] = []
    const readings = await load([{ shape: "cloudfront-requests" }], { calls })
    const filters = calls.find((c) => c.capability === "pricing:GetProducts")?.input.Filters
    expect(filters).toEqual([{ Field: "productFamily", Value: "Request" }])
    expect(shapeOf(readings, "cloudfront-requests").query.regionCode).toBeNull()
  })

  test("an unresolved identity leaves a region-scoped shape UNCONFIGURED and never calls AWS", async () => {
    const calls: FakeOptions["calls"] = []
    const readings = await load([{ shape: "fargate-vcpu-hour" }], { identity: "denied", calls })
    const shape = shapeOf(readings, "fargate-vcpu-hour")
    expect(shape.products.state).toBe("UNCONFIGURED")
    if (shape.products.state !== "UNCONFIGURED") throw new Error("narrowing")
    expect(shape.products.why).toContain("will not quote a region it cannot name")
    // The call was not made at all — this is not an empty answer, it is no question.
    expect(calls.some((c) => c.capability === "pricing:GetProducts")).toBe(false)
  })

  test("an unresolved identity still prices the shape that does not need one", async () => {
    const readings = await load(
      [{ shape: "fargate-vcpu-hour" }, { shape: "cloudfront-requests", parameters: { location: "Europe" } }],
      {
        identity: "denied",
        priceLists: { AmazonCloudFront: [cloudfrontRequestProducts()[0]] },
      },
    )
    // One denied detail must not collapse the row: the region-scoped shape is
    // unconfigured and the edge-priced one is priced, in the same load.
    expect(shapeOf(readings, "fargate-vcpu-hour").products.state).toBe("UNCONFIGURED")
    expect(shapeOf(readings, "cloudfront-requests").products.state).toBe("ACTUAL")
    expect(shapeOf(readings, "cloudfront-requests").rate.kind).toBe("tiered")
  })
})

/* ------------------------------------------------ independent degradation -- */

describe("shapes degrade independently", () => {
  test("a denied service leaves every other shape priced", async () => {
    const readings = await load(
      [
        { shape: "fargate-vcpu-hour" },
        { shape: "fargate-gb-hour" },
        { shape: "dynamodb-write-request-units" },
      ],
      { products: { AmazonECS: "denied" } },
    )
    expect(shapeOf(readings, "fargate-vcpu-hour").products.state).toBe("DENIED")
    expect(shapeOf(readings, "fargate-gb-hour").products.state).toBe("DENIED")
    const dynamo = shapeOf(readings, "dynamodb-write-request-units")
    expect(dynamo.products.state).toBe("ACTUAL")
    expect(dynamo.rate.kind).toBe("flat")

    const text = surfaceText(readings)
    expect(text).toContain("refused pricing:GetProducts")
    expect(text).toContain("dynamodb-write-request-units")
  })

  test("two shapes of the same service select different rates from one list", async () => {
    const readings = await load([{ shape: "fargate-vcpu-hour" }, { shape: "fargate-gb-hour" }])
    const vcpu = shapeOf(readings, "fargate-vcpu-hour").rate
    const gb = shapeOf(readings, "fargate-gb-hour").rate
    if (vcpu.kind !== "flat" || gb.kind !== "flat") throw new Error("both should price")
    expect(vcpu.rate.amount.units).toBe(8_200_000)
    expect(gb.rate.amount.units).toBe(900_000)
    expect(vcpu.sku).not.toBe(gb.sku)
  })
})

/* -------------------------------------------------------------- paging -- */

describe("pagination completes, is bounded, and says when it stopped", () => {
  test("every page is read, not just the first", async () => {
    const readings = await load([{ shape: "fargate-vcpu-hour" }], {
      pages: { AmazonECS: [[fargateProducts()[1]], [fargateProducts()[0]]] },
    })
    const shape = shapeOf(readings, "fargate-vcpu-hour")
    expect(shape.products.state).toBe("ACTUAL")
    if (shape.products.state !== "ACTUAL") throw new Error("narrowing")
    expect(shape.products.value).toHaveLength(2)
    // The vCPU rate is on the SECOND page. A reader that stopped at the first
    // would report this shape as unknown.
    expect(shape.rate.kind).toBe("flat")
    expect(shape.truncated).toBe(false)
  })

  test("hitting the page cap is an explicit signal, and no rate is chosen from a partial list", async () => {
    const pages = Array.from({ length: MAX_PRODUCT_PAGES + 3 }, () => [fargateProducts()[0]])
    const readings = await load([{ shape: "fargate-vcpu-hour" }], { pages: { AmazonECS: pages } })
    const shape = shapeOf(readings, "fargate-vcpu-hour")
    expect(shape.truncated).toBe(true)
    expect(shape.products.state).toBe("ACTUAL")
    expect(shape.rate.kind).toBe("unknown")
    if (shape.rate.kind !== "unknown") throw new Error("narrowing")
    expect(shape.rate.why).toContain(`more than ${MAX_PRODUCT_PAGES} pages`)
    expect(surfaceText(readings)).toContain("TRUNCATED")
  })
})

/* ------------------------------------------------------------- selection -- */

describe("a rate is never guessed", () => {
  test("a tier ladder is read in order, with its top rung open", async () => {
    const readings = await load([{ shape: "s3-storage", parameters: { volumeType: "Standard" } }])
    const rate = shapeOf(readings, "s3-storage").rate
    if (rate.kind !== "tiered") throw new Error(`expected tiered, got ${rate.kind}`)
    expect(rate.tiers.map((t) => t.fromUnits)).toEqual([0, 51_200, 512_000])
    expect(rate.tiers[0].toUnits).toBe(51_200)
    expect(rate.tiers[2].toUnits).toBeNull()
    expect(rate.tiers.map((t) => t.rate.amount.units)).toEqual([2_400_000, 2_300_000, 2_200_000])
    expect(surfaceText(readings)).toContain("3 published tier(s)")
  })

  test("two edge geographies are ambiguous, and the candidates are named", async () => {
    const readings = await load([{ shape: "cloudfront-requests" }])
    const rate = shapeOf(readings, "cloudfront-requests").rate
    expect(rate.kind).toBe("ambiguous")
    if (rate.kind !== "ambiguous") throw new Error("narrowing")
    expect(rate.candidates).toHaveLength(2)
    expect(rate.why).toContain("location")
    const text = surfaceText(readings)
    expect(text).toContain("ambiguous")
    // Ambiguity carries no amount. A surface cannot render a price from it.
    expect(text).not.toContain("no charge")
  })

  test("two published rates for a flat shape are ambiguous, never the first one silently", async () => {
    // SES publishes an outbound message price per region group. Two of them
    // match the selector, and picking the cheaper — or just the first the API
    // happened to return — would be this engine inventing a quote.
    const readings = await load([{ shape: "ses-outbound-message" }], {
      priceLists: {
        AmazonSES: [
          priceDoc({
            sku: "SESMSGEU00001",
            productFamily: "Sending Email",
            usagetype: "EUW2-Message-EU",
            dimensions: [
              {
                rateCode: "SESMSGEU00001.JRTCKXETXF.1",
                unit: "Messages",
                description: "outbound message from the EU",
                pricePerUnit: { USD: "0.0001000000" },
              },
            ],
          }),
          priceDoc({
            sku: "SESMSGVPC0001",
            productFamily: "Sending Email",
            usagetype: "EUW2-Message-VPC",
            dimensions: [
              {
                rateCode: "SESMSGVPC0001.JRTCKXETXF.1",
                unit: "Messages",
                description: "outbound message over an interface endpoint",
                pricePerUnit: { USD: "0.0002000000" },
              },
            ],
          }),
        ],
      },
    })
    const rate = shapeOf(readings, "ses-outbound-message").rate
    expect(rate.kind).toBe("ambiguous")
    if (rate.kind !== "ambiguous") throw new Error("narrowing")
    expect(rate.candidates).toHaveLength(2)
    expect(rate.candidates.join(" ")).toContain("SESMSGEU00001")
    expect(rate.candidates.join(" ")).toContain("SESMSGVPC0001")
    // No amount reaches the surface from an ambiguous rate.
    const text = surfaceText(readings)
    expect(text).toContain("ambiguous")
    expect(text).not.toContain("0.00 USD per")
  })

  test("a shape nothing matches names what it searched for and what it saw", async () => {
    const readings = await load([{ shape: "sqs-requests" }], {
      priceLists: {
        AWSQueueService: [
          priceDoc({
            sku: "SQSDATAOUT001",
            productFamily: "Data Transfer",
            usagetype: "EUW2-DataTransfer-Out-Bytes",
            dimensions: [
              {
                rateCode: "SQSDATAOUT001.JRTCKXETXF.1",
                unit: "GB",
                description: "data transfer out",
                pricePerUnit: { USD: "0.0900000000" },
              },
            ],
          }),
        ],
      },
    })
    const rate = shapeOf(readings, "sqs-requests").rate
    expect(rate.kind).toBe("unknown")
    if (rate.kind !== "unknown") throw new Error("narrowing")
    expect(rate.why).toContain("no published price dimension matched Requests")
    expect(rate.why).toContain("EUW2-DataTransfer-Out-Bytes")
  })

  test("a reserved term is never quoted", async () => {
    const readings = await load([{ shape: "fargate-vcpu-hour" }])
    const rate = shapeOf(readings, "fargate-vcpu-hour").rate
    if (rate.kind !== "flat") throw new Error("narrowing")
    // The fixture publishes a reserved rate of 0.0000000001 alongside the
    // on-demand one. Quoting a commitment this estate has not bought would show
    // up here as the wrong number.
    expect(rate.rate.publishedDecimal).toBe("0.0820000000")
    expect(rate.rateCode).toContain("JRTCKXETXF")
    expect(rate.rateCode).not.toContain("38NPMPTW36")
  })

  test("an unreadable range puts the dimension aside rather than inventing a tier", () => {
    const product = parsePriceListEntry(
      priceDoc({
        sku: "S3BADRANGE001",
        productFamily: "Storage",
        usagetype: "EUW2-TimedStorage-ByteHrs",
        dimensions: [
          {
            rateCode: "S3BADRANGE001.JRTCKXETXF.A1",
            unit: "GB-Mo",
            description: "first tier",
            beginRange: "0",
            endRange: "fifty terabytes",
            pricePerUnit: { USD: "0.0240000000" },
          },
        ],
      }),
      undefined,
    )
    expect(product?.dimensions).toHaveLength(0)
    expect(product?.unreadable).toHaveLength(1)
    expect(product?.unreadable[0].why).toContain("is not a tier boundary")
  })

  test("a PriceList entry that is not JSON fails the read rather than shrinking it", async () => {
    const readings = await load([{ shape: "fargate-vcpu-hour" }], {
      priceLists: { AmazonECS: ["{not json", fargateProducts()[0]] },
    })
    const shape = shapeOf(readings, "fargate-vcpu-hour")
    expect(shape.products.state).toBe("ERROR")
    expect(shape.rate.kind).toBe("unknown")
    expect(surfaceText(readings)).toContain("error —")
  })
})

/* ------------------------------------------------------------ parameters -- */

describe("parameters are closed, and a bad one is refused before AWS is asked", () => {
  test("a missing required parameter is UNCONFIGURED and names the field", async () => {
    const calls: FakeOptions["calls"] = []
    const readings = await load([{ shape: "rds-instance-hour" }], { calls })
    const shape = shapeOf(readings, "rds-instance-hour")
    expect(shape.products.state).toBe("UNCONFIGURED")
    if (shape.products.state !== "UNCONFIGURED") throw new Error("narrowing")
    expect(shape.products.why).toContain("instanceType")
    expect(calls.some((c) => c.capability === "pricing:GetProducts")).toBe(false)
  })

  test("a parameter the shape does not declare never reaches the API", async () => {
    const calls: FakeOptions["calls"] = []
    const readings = await load(
      [{ shape: "sqs-requests", parameters: { serviceCode: "AmazonEC2" } }],
      { calls },
    )
    const shape = shapeOf(readings, "sqs-requests")
    expect(shape.products.state).toBe("UNCONFIGURED")
    if (shape.products.state !== "UNCONFIGURED") throw new Error("narrowing")
    expect(shape.products.why).toContain("does not take a serviceCode parameter")
    expect(calls.some((c) => c.capability === "pricing:GetProducts")).toBe(false)
  })

  test("a declared parameter becomes a filter, alongside the resolved region", async () => {
    const calls: FakeOptions["calls"] = []
    await load(
      [
        {
          shape: "rds-instance-hour",
          parameters: { instanceType: "db.t4g.medium", databaseEngine: "PostgreSQL" },
        },
      ],
      { calls, priceLists: { AmazonRDS: [] } },
    )
    const filters = calls.find((c) => c.capability === "pricing:GetProducts")?.input.Filters
    expect(filters).toEqual([
      { Field: "productFamily", Value: "Database Instance" },
      { Field: "instanceType", Value: "db.t4g.medium" },
      { Field: "databaseEngine", Value: "PostgreSQL" },
      { Field: "regionCode", Value: REGION },
    ])
  })

  test("a filter value with quoting in it is refused", async () => {
    const readings = await load([
      { shape: "elasticache-node-hour", parameters: { instanceType: 'cache.t4g.micro","x' } },
    ])
    expect(shapeOf(readings, "elasticache-node-hour").products.state).toBe("UNCONFIGURED")
  })
})

/* -------------------------------------------- the second capability, alone -- */

describe("the publication listing is its own capability and its own denial", () => {
  test("a populated listing carries the published files", async () => {
    const read = await priceListPublications(
      fakeAws(),
      { serviceCode: "AmazonECS", currency: "USD" },
      { now: AT, sleep: NO_WAIT },
    )
    expect(read.state).toBe("ACTUAL")
    if (read.state !== "ACTUAL") throw new Error("narrowing")
    expect(read.value[0].currencyCode).toBe("USD")
    expect(read.value[0].fileFormats).toContain("json")
  })

  test("a denial names ListPriceLists, not GetProducts", async () => {
    const read = await priceListPublications(
      fakeAws({ publications: "denied" }),
      { serviceCode: "AmazonECS", currency: "USD" },
      { now: AT, sleep: NO_WAIT },
    )
    expect(read.state).toBe("DENIED")
    if (read.state !== "DENIED") throw new Error("narrowing")
    // The whole reason this is a separate reading: an operator pasting the
    // statement must get the action they are actually missing.
    expect(read.action).toBe("pricing:ListPriceLists")
  })

  test("an empty listing is EMPTY, and a throttle is THROTTLED", async () => {
    const empty = await priceListPublications(
      fakeAws({ publications: "empty" }),
      { serviceCode: "AmazonECS", currency: "USD" },
      { now: AT, sleep: NO_WAIT },
    )
    expect(empty.state).toBe("EMPTY")
    const throttled = await priceListPublications(
      fakeAws({ publications: "throttled" }),
      { serviceCode: "AmazonECS", currency: "USD" },
      { now: AT, sleep: NO_WAIT },
    )
    expect(throttled.state).toBe("THROTTLED")
  })
})

/* ------------------------------------------------------------- the load -- */

describe("the load carries its own as-of, cadence and attribution", () => {
  test("every shape carries the registry's cadence and the read's as-of", async () => {
    const readings = await load([{ shape: "fargate-vcpu-hour" }])
    expect(readings.asOf).toBe("2026-08-13T09:15:00.000Z")
    // A day, from capabilities.ts. Not a number retyped in this module.
    expect(readings.refreshMs.products).toBe(24 * 3_600_000)
    const shape = shapeOf(readings, "fargate-vcpu-hour")
    expect(shape.refreshMs).toBe(readings.refreshMs.products)
    expect(shape.asOf).toBe(readings.asOf)
    // AWS's own as-of for the PRICE is a different fact from ours for the read.
    if (shape.rate.kind !== "flat") throw new Error("narrowing")
    expect(shape.rate.effectiveDate).toBe("2026-08-01T00:00:00Z")
  })

  test("a list price is attributed shared, with the reason on the surface", async () => {
    const readings = await load([{ shape: "fargate-vcpu-hour" }])
    expect(shapeOf(readings, "fargate-vcpu-hour").attribution).toEqual(PRICE_ATTRIBUTION)
    expect(PRICE_ATTRIBUTION.kind).toBe("shared")
    expect(surfaceText(readings)).toContain("attribution: shared")
  })

  test("every shape in the catalogue is asked for by default", async () => {
    const calls: FakeOptions["calls"] = []
    const readings = await pricingReadings(fakeAws({ calls }), { now: AT, sleep: NO_WAIT })
    // Fourteen shapes, and each one either asked AWS or said why it did not.
    expect(readings.shapes).toHaveLength(14)
    for (const shape of readings.shapes) {
      expect(["ACTUAL", "EMPTY", "UNCONFIGURED"]).toContain(shape.products.state)
    }
    expect(pricingLines(readings)).toHaveLength(15)
  })
})
