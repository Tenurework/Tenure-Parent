/**
 * STUDIO-070-004 (Pricing) — what a shape this engine provisions actually
 * costs, from AWS's own published list price rather than from a table somebody
 * typed.
 *
 * The composer prices a tenant before it is provisioned: every configuration
 * option carries a per-seat and a per-organisation figure with a running total,
 * at every stage of setup. Today those figures come from `@tenure/finops`'s
 * `pricing.ts`, which is a hand-maintained catalogue — a transcribed table. A
 * transcribed table is right on the day it is typed and wrong from the next AWS
 * price change onwards, and nothing in the product can tell which day it is.
 * `ce:GetCostAndUsageWithResources` cannot help: Cost Explorer answers what was
 * SPENT, and this question is what a change WOULD cost.
 *
 * This module is the grounding. It reads the Price List API for the resource
 * shapes `infrastructure/terraform` provisions — Fargate vCPU- and GB-hours, an
 * RDS instance-hour for a stated class and engine, ElastiCache node-hours, ALB
 * hours and LCUs, CloudFront requests and data transfer, S3 storage and
 * requests, DynamoDB on-demand read and write request units, an SES outbound
 * message and an SQS request — and returns each as a typed rate a quote can be
 * built on.
 *
 * ## Money is integer minor units. There is no float on this path.
 *
 * The Price List publishes `pricePerUnit` as a DECIMAL STRING —
 * `"0.0000166667"` — and `Number("0.0000166667")` is the bug this whole
 * programme has already paid for once: a few thousand of those summed in
 * doubles disagree with the bill by an amount nobody can explain. Every price
 * here goes through `parseRate`, which shifts the decimal point with BigInt
 * digit arithmetic and hands `@tenure/finops`'s `money()` an INTEGER. The
 * currency travels with the amount and is read off the response, never assumed
 * to be USD — the China partition publishes CNY, and a quote that adds dollars
 * to yuan is wrong in a way that looks right.
 *
 * A price finer than `Money` can hold exactly is NOT truncated: `parseRate`
 * scales the quantity instead, so `$0.0000000167 per request` becomes
 * `$0.00000167 per 100 requests` — exact, with `perQuantity` stated. Truncating
 * it would render a real price as free, which is the single worst thing a
 * costing surface can do.
 *
 * ## Quoting only
 *
 * Nothing here moves money. The only import from `@tenure/finops` is its money
 * ARITHMETIC — `money`, `minorDigits`, `roundToInteger`, `toDecimal`,
 * `toMinorUnits` — and this module neither imports nor re-exports settlement,
 * payments, a gateway or a ledger write. Reading a public price list is not a
 * transaction and this file must never become the place one starts.
 *
 * ## The Price List API is not served from every region
 *
 * It answers from a small set of regions rather than from all of them — as of
 * writing, the commercial partition serves it from the North Virginia and
 * Mumbai endpoints only, and GovCloud does not offer it at all. That is a
 * property of the API, not a decision about where this estate's data lives.
 *
 * It is therefore NOT written down in this file. `client.ts` reads the endpoint
 * region from `AWS_GLOBAL_ENDPOINT_REGION` and throws `EndpointRegionUnset`
 * when it is not set, which `readAws` renders as UNCONFIGURED naming the
 * variable. A literal here would be silently wrong in two partitions out of
 * three, and "we have not been told where to ask" is not "there are no prices".
 * `tests/security/no-hardcoded-estate.test.mjs` enforces the same thing from
 * the outside.
 *
 * The region being PRICED is a different question and comes from the resolved
 * identity: `regionCode` is a real Price List filter field, so a shape that
 * varies by region is asked for at `sts:GetCallerIdentity`'s region and never at
 * a literal. When identity is unresolved, a region-scoped shape returns
 * UNCONFIGURED — this engine will not quote a region it cannot name — while
 * CloudFront, which prices by edge geography rather than by region, still
 * answers. That is the independent degradation the read plane exists for.
 *
 * ## A filter that matches nothing is EMPTY, and EMPTY is not zero
 *
 * The service codes, product families and usage-type fragments below are the
 * Price List API's own vocabulary. They have NOT been checked against a live
 * account — there is no AWS Organization to check them against — so any one of
 * them may be wrong. The design makes that survivable rather than dangerous: a
 * wrong filter returns EMPTY and the shape's rate is `unknown`, carrying the
 * selectors it searched for and the usage types it actually saw, so the fix is
 * visible from the page. No arm of `ShapeRate` other than `flat` and `tiered`
 * carries an amount at all, so a caller cannot substitute zero for a price this
 * engine could not fetch — the type is the guard, not everybody remembering.
 *
 * ## Attribution
 *
 * Deliberately not read from the Resource Groups Tagging API, and this is a
 * stated deviation rather than an omission. A public list price is not a
 * provisioned resource: it has no ARN, it carries no `tenure:tenant` tag, and
 * `tag:GetResources` would never return it. It is the same number for every
 * tenant. So every reading here is attributed `shared`, using `tags.ts`'s own
 * `Attribution` vocabulary so the surfaces render it identically, with the
 * reason stated on `PRICE_ATTRIBUTION_WHY`. What IS per-tenant is CONSUMPTION,
 * and that is `cost-report.ts`'s question, not this one.
 */

import {
  SCALE,
  minorDigits,
  money,
  roundToInteger,
  toDecimal,
  toMinorUnits,
  type Money,
  type RoundingMode,
} from "@tenure/finops"

import { CAPABILITIES } from "./capabilities"
import { denialContextFrom, resolveIdentity, type Identity } from "./identity"
import {
  describeRead,
  liveGateway,
  readAws,
  type AwsGateway,
  type AwsRead,
  type DenialContext,
} from "./read"
import type { Attribution } from "./tags"
import { READ_ATTEMPTS, backoffMs } from "./throttle"

/* ---------------------------------------------------------------- limits -- */

/**
 * How many `GetProducts` pages one shape may walk.
 *
 * `client.ts` asks for 100 products a page, so this is a thousand SKUs. A
 * runaway page loop is an outage in a server render with somebody waiting, and
 * the Price List is one of the few AWS APIs whose response bodies are megabytes.
 *
 * Hitting the cap is REPORTED, not swallowed: `ShapeReading.truncated` goes
 * true and the shape's rate becomes `unknown`. A rate picked out of a partial
 * list is a coin flip between SKUs, and quoting one is worse than saying so.
 */
export const MAX_PRODUCT_PAGES = 10

/** The same bound for the much smaller price-list publication listing. */
export const MAX_PRICE_LIST_PAGES = 5

/**
 * How far `parseRate` may scale a quantity to keep a published price exact.
 *
 * A million. Past that the published decimal has more than fourteen fractional
 * digits, which no AWS price has, and the honest answer is that this engine did
 * not understand the number rather than that it invented a quantity for it.
 */
export const MAX_QUANTITY_SCALE_UP = 6

/** The retry schedule is throttle.ts's, not a literal. See its header on jitter. */
const RETRY: { attempts: number; backoffMs: number } = {
  attempts: READ_ATTEMPTS,
  // `backoffMs(2)` is the pause after the first failure; readAws doubles it.
  backoffMs: backoffMs(2),
}

/* -------------------------------------------------------------- the money -- */

/**
 * One published price: an exact amount, the quantity it buys, and AWS's own
 * unit string.
 *
 * `perQuantity` is almost always 1. It is larger only when the published
 * decimal is finer than `Money` holds exactly, and then it is the power of ten
 * that makes the amount exact — see the module header. A caller that ignores it
 * is off by that power of ten, which is why it is a required field rather than
 * an optional one.
 */
export interface Rate {
  /** Integer minor units of `currency`, at `@tenure/finops`'s scale. Never a float. */
  readonly amount: Money
  /** How many `unit`s `amount` buys. Never zero. */
  readonly perQuantity: number
  /** AWS's own unit: "Hrs", "Requests", "GB-Mo", "LCU-Hrs". Never invented here. */
  readonly unit: string
  /** ISO 4217, read off the response. Never defaulted. */
  readonly currency: string
  /** The decimal exactly as published, so the arithmetic can be audited. */
  readonly publishedDecimal: string
  /**
   * AWS published this at no charge.
   *
   * A real commercial statement — the first tier of several AWS meters is free
   * — and it is a different fact from a price this engine could not read, which
   * has no `Rate` at all. Kept explicit so a surface never has to infer
   * "free" from a zero it might have produced itself.
   */
  readonly free: boolean
}

/** Why a published price could not be turned into money. Never rendered as zero. */
export interface UnreadablePrice {
  readonly rateCode: string
  readonly published: string
  readonly why: string
}

export type RateParse = { ok: true; rate: Rate } | { ok: false; why: string }

/** Digits a `Money` of this currency holds below the whole unit. */
function fractionalCapacity(currency: string): number {
  return minorDigits(currency) + SCALE
}

/**
 * A published decimal as exact integer minor units.
 *
 * The one place a price string becomes a number, so there is one place to read
 * and one place to be wrong. Deliberately NOT `@tenure/finops`'s `fromDecimal`:
 * that function is documented to TRUNCATE below its scale, which is correct for
 * an already-authoritative CUR line and catastrophic here — a Lambda-grain unit
 * price truncated to the eighth decimal is a real price rendered as free. This
 * scales the quantity instead and never drops a digit.
 *
 * BigInt for the digit arithmetic, because the whole point is that no step of
 * this passes through a float.
 */
export function parseRate(
  publishedDecimal: string,
  currency: string,
  unit: string,
): RateParse {
  const trimmed = publishedDecimal.trim()
  // Unsigned: a negative list price is not a thing AWS publishes, and reading
  // one would mean the field is not what this code thinks it is.
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return { ok: false, why: `${JSON.stringify(publishedDecimal)} is not a published decimal price` }
  }
  if (!currency.trim()) {
    return { ok: false, why: "the price carries no currency code, so it is not an amount of anything" }
  }

  const [whole, rawFraction = ""] = trimmed.split(".")
  // AWS right-pads its decimals with zeros — "0.0820000000" is three
  // significant digits wearing ten. Stripping them first is what keeps the
  // common case at perQuantity 1.
  const fraction = rawFraction.replace(/0+$/, "")
  const capacity = fractionalCapacity(currency)
  const scaleUp = Math.max(0, fraction.length - capacity)

  if (scaleUp > MAX_QUANTITY_SCALE_UP) {
    return {
      ok: false,
      why:
        `${trimmed} has ${fraction.length} significant fractional digits, which is finer than ` +
        `this engine will scale a quantity to hold exactly (${capacity + MAX_QUANTITY_SCALE_UP}). ` +
        `Reported unknown rather than rounded: a rounded unit price multiplied by a month of ` +
        `usage is not a small error.`,
    }
  }

  const digits = capacity + scaleUp
  const padded = (fraction + "0".repeat(digits)).slice(0, digits)
  const units = BigInt(whole + padded)
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) {
    return {
      ok: false,
      why: `${trimmed} ${currency} does not fit in an exact integer at this engine's money scale`,
    }
  }

  return {
    ok: true,
    rate: {
      amount: money(Number(units), currency),
      perQuantity: 10 ** scaleUp,
      unit,
      currency,
      publishedDecimal: trimmed,
      // `BigInt(0)` rather than the `0n` literal: this app targets ES2017 and a
      // BigInt literal does not compile there. The comparison is the same.
      free: units === BigInt(0),
    },
  }
}

/**
 * What `quantity` units of a rate cost.
 *
 * Here rather than at every surface, because the alternative is each of them
 * writing `price * hours` in floats and one of them getting it wrong. The
 * rounding mode is required for the reason `@tenure/finops` requires it
 * everywhere: a default is `Math.round` wearing a name, and it rounds a debit
 * and its exact reversal to different magnitudes.
 *
 * The division by `perQuantity` is the whole reason that field exists.
 */
export function extendRate(rate: Rate, quantity: number, rounding: RoundingMode): Money {
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new RangeError(`Cannot extend a rate over ${quantity} units.`)
  }
  return money(
    roundToInteger((rate.amount.units * quantity) / rate.perQuantity, rounding),
    rate.currency,
  )
}

/** A rate as a person reads it, at the currency's own precision. */
export function describeRate(rate: Rate): string {
  const per = rate.perQuantity === 1 ? rate.unit : `${rate.perQuantity} ${rate.unit}`
  const amount = `${toDecimal(rate.amount, "down")} ${rate.currency}`
  const exact = `${toMinorUnits(rate.amount, "down")} minor units of ${rate.currency}`
  return rate.free
    ? `no charge — AWS publishes ${rate.publishedDecimal} ${rate.currency} per ${per}`
    : `${amount} per ${per} (${exact}, published as ${rate.publishedDecimal})`
}

/* ------------------------------------------------------------ the shapes -- */

/**
 * The resource shapes this estate provisions, as the Price List names them.
 *
 * A closed union for the same reason `Capability` is one: an endpoint taking a
 * service code and a filter bag is an arbitrary query with a JSON body, and no
 * reader of this file could then say what the console asks AWS for.
 */
export type ShapeKey =
  | "fargate-vcpu-hour"
  | "fargate-gb-hour"
  | "rds-instance-hour"
  | "elasticache-node-hour"
  | "alb-hour"
  | "alb-lcu-hour"
  | "cloudfront-requests"
  | "cloudfront-data-transfer-out"
  | "s3-storage"
  | "s3-requests"
  | "dynamodb-write-request-units"
  | "dynamodb-read-request-units"
  | "ses-outbound-message"
  | "sqs-requests"

/** One TERM_MATCH filter. `client.ts` forces the match type; only the pair travels. */
export interface PriceFilter {
  readonly field: string
  readonly value: string
}

/** A parameter a caller may supply for a shape. Closed per shape, never open. */
export interface ParameterSpec {
  readonly field: string
  readonly required: boolean
  readonly describes: string
}

export interface ShapeSpec {
  /** The Price List's service code. Its vocabulary, not an ARN and not a region. */
  readonly serviceCode: string
  /**
   * Whether the price varies by the region this estate runs in.
   *
   * `global` is not a shortcut: CloudFront prices by EDGE GEOGRAPHY, and asking
   * for it at the estate's `regionCode` returns nothing at all.
   */
  readonly regionScope: "resolved-region" | "global"
  /** Filters that do not vary per request. */
  readonly filters: readonly PriceFilter[]
  readonly parameters: readonly ParameterSpec[]
  /**
   * Fragments that identify this shape's dimension among the products returned.
   *
   * Matched case-insensitively against the product's `usagetype` and the
   * dimension's description. When none matches, the shape's rate is `unknown`
   * and names both the fragments searched and the usage types actually seen —
   * which is how a wrong fragment gets fixed from the page rather than guessed
   * at again.
   */
  readonly select: readonly string[]
  /** Whether the answer is a tier ladder (S3 storage, CloudFront) or one rate. */
  readonly tiered: boolean
  /** What an operator gets from it, in their language rather than the API's. */
  readonly reads: string
}

/**
 * Every shape, its service code and its selectors.
 *
 * The values are the Price List API's published vocabulary. Where one is wrong
 * the read is EMPTY and the rate is `unknown` — see the module header. Nothing
 * here is an account id, an ARN, a region or a resource name.
 */
export const SHAPES: Readonly<Record<ShapeKey, ShapeSpec>> = {
  "fargate-vcpu-hour": {
    serviceCode: "AmazonECS",
    regionScope: "resolved-region",
    // No product-family filter: the ECS price list in one region is small, and
    // every extra filter value is another string that can be wrong and empty
    // the answer. The selector does the narrowing.
    filters: [],
    parameters: [],
    select: ["Fargate-vCPU-Hours", "vCPU-Hours"],
    tiered: false,
    reads: "what one vCPU-hour of Fargate costs, which is half of what a task costs to run",
  },
  "fargate-gb-hour": {
    serviceCode: "AmazonECS",
    regionScope: "resolved-region",
    filters: [],
    parameters: [],
    select: ["Fargate-GB-Hours", "GB-Hours"],
    tiered: false,
    reads: "what one GB-hour of Fargate memory costs — the other half of a task",
  },
  "rds-instance-hour": {
    serviceCode: "AmazonRDS",
    regionScope: "resolved-region",
    // Database Instance excludes the storage and IO SKUs, which otherwise match
    // the instance-hour selector and make the answer ambiguous.
    filters: [{ field: "productFamily", value: "Database Instance" }],
    parameters: [
      { field: "instanceType", required: true, describes: "the DB instance class, e.g. db.t4g.medium" },
      { field: "databaseEngine", required: true, describes: "the engine, e.g. PostgreSQL" },
      {
        field: "deploymentOption",
        required: false,
        describes: "Single-AZ or Multi-AZ — a Multi-AZ instance is not the same price",
      },
      { field: "licenseModel", required: false, describes: "e.g. No license required" },
    ],
    select: ["InstanceUsage", "Multi-AZUsage"],
    tiered: false,
    reads: "the on-demand hour for one database instance class and engine",
  },
  "elasticache-node-hour": {
    serviceCode: "AmazonElastiCache",
    regionScope: "resolved-region",
    filters: [],
    parameters: [
      { field: "instanceType", required: true, describes: "the cache node type, e.g. cache.t4g.micro" },
      { field: "cacheEngine", required: false, describes: "the engine, e.g. Redis" },
    ],
    select: ["NodeUsage"],
    tiered: false,
    reads: "the on-demand hour for one cache node",
  },
  "alb-hour": {
    serviceCode: "AWSELB",
    regionScope: "resolved-region",
    // Without the family, the classic and network load balancers publish the
    // same usage type and the answer is ambiguous rather than wrong — which is
    // the right failure, but a needless one.
    filters: [{ field: "productFamily", value: "Load Balancer-Application" }],
    parameters: [],
    select: ["LoadBalancerUsage"],
    tiered: false,
    reads: "the standing hourly charge for one application load balancer",
  },
  "alb-lcu-hour": {
    serviceCode: "AWSELB",
    regionScope: "resolved-region",
    filters: [{ field: "productFamily", value: "Load Balancer-Application" }],
    parameters: [],
    select: ["LCUUsage"],
    tiered: false,
    reads: "the load-balancer capacity unit hour — the part of an ALB bill that scales with traffic",
  },
  "cloudfront-requests": {
    serviceCode: "AmazonCloudFront",
    // Not the estate's region: CloudFront prices per edge geography, and a
    // regionCode filter returns nothing for it.
    regionScope: "global",
    filters: [{ field: "productFamily", value: "Request" }],
    parameters: [
      {
        field: "location",
        required: false,
        describes: "the edge geography, e.g. Europe — CloudFront prices differ by continent",
      },
    ],
    select: ["Requests"],
    tiered: true,
    reads: "the published request tiers at the edge",
  },
  "cloudfront-data-transfer-out": {
    serviceCode: "AmazonCloudFront",
    regionScope: "global",
    filters: [{ field: "productFamily", value: "Data Transfer" }],
    parameters: [
      { field: "location", required: false, describes: "the edge geography, e.g. Europe" },
    ],
    select: ["DataTransfer-Out-Bytes", "DataTransfer"],
    tiered: true,
    reads: "the data-transfer-out tiers at the edge, which is most of a CloudFront bill",
  },
  "s3-storage": {
    serviceCode: "AmazonS3",
    regionScope: "resolved-region",
    filters: [{ field: "productFamily", value: "Storage" }],
    parameters: [
      {
        field: "volumeType",
        required: false,
        describes: "the storage class, e.g. Standard — every class is a different ladder",
      },
    ],
    select: ["TimedStorage"],
    tiered: true,
    reads: "the storage tiers per GB-month for a bucket's storage class",
  },
  "s3-requests": {
    serviceCode: "AmazonS3",
    regionScope: "resolved-region",
    filters: [{ field: "productFamily", value: "API Request" }],
    parameters: [
      { field: "group", required: false, describes: "the request group, e.g. S3-API-Tier1" },
    ],
    select: ["Requests-Tier1", "Requests-Tier2", "Requests"],
    tiered: true,
    reads: "the per-request tiers for reads and writes against a bucket",
  },
  "dynamodb-write-request-units": {
    serviceCode: "AmazonDynamoDB",
    regionScope: "resolved-region",
    filters: [{ field: "productFamily", value: "Amazon DynamoDB PayPerRequest Throughput" }],
    parameters: [],
    select: ["WriteRequestUnits"],
    tiered: false,
    reads: "the on-demand write request unit — what one write to the registry table costs",
  },
  "dynamodb-read-request-units": {
    serviceCode: "AmazonDynamoDB",
    regionScope: "resolved-region",
    filters: [{ field: "productFamily", value: "Amazon DynamoDB PayPerRequest Throughput" }],
    parameters: [],
    select: ["ReadRequestUnits"],
    tiered: false,
    reads: "the on-demand read request unit — what one registry lookup costs",
  },
  "ses-outbound-message": {
    serviceCode: "AmazonSES",
    regionScope: "resolved-region",
    filters: [],
    parameters: [],
    select: ["Message", "Recipient"],
    tiered: false,
    reads: "what one outbound email costs, which is what a reminder run multiplies by",
  },
  "sqs-requests": {
    serviceCode: "AWSQueueService",
    regionScope: "resolved-region",
    filters: [],
    parameters: [
      { field: "queueType", required: false, describes: "Standard or FIFO — they are priced apart" },
    ],
    select: ["Requests"],
    tiered: false,
    reads: "what one queue request costs, which every job in the estate pays",
  },
}

export const ALL_SHAPES: readonly ShapeKey[] = Object.keys(SHAPES).sort() as ShapeKey[]

/* ------------------------------------------------------------- the shapes -- */

/** What one shape is being asked for. Parameters are validated against its spec. */
export interface ShapeRequest {
  readonly shape: ShapeKey
  readonly parameters?: Readonly<Record<string, string>>
}

/** Exactly what was asked of AWS, so a wrong answer can be traced to the question. */
export interface PriceQuery {
  readonly serviceCode: string
  readonly filters: readonly PriceFilter[]
  /** The region being priced, from the resolved identity. Null for edge pricing. */
  readonly regionCode: string | null
  /** Where the region came from, or why there is none. Never silent. */
  readonly regionProvenance: string
}

export interface PricedDimension {
  readonly rateCode: string
  readonly description: string
  /** Lower bound of the tier, in `rate.unit`s. */
  readonly beginRange: number
  /** Upper bound, or null for AWS's "Inf". */
  readonly endRange: number | null
  readonly rate: Rate
}

export interface PricedProduct {
  readonly sku: string
  readonly productFamily: string | null
  readonly usagetype: string | null
  readonly location: string | null
  readonly attributes: Readonly<Record<string, string>>
  /** AWS's own as-of for the price, which is not this engine's as-of for the read. */
  readonly publicationDate: string | null
  readonly effectiveDate: string | null
  readonly dimensions: readonly PricedDimension[]
  /** Dimensions whose published price this engine could not read, with why. */
  readonly unreadable: readonly UnreadablePrice[]
}

export interface PricedTier {
  readonly fromUnits: number
  readonly toUnits: number | null
  readonly rate: Rate
  readonly rateCode: string
  readonly description: string
}

/**
 * The rate for one shape.
 *
 * Only `flat` and `tiered` carry an amount. There is no arm with an optional
 * price and no arm with a zero stand-in, so a surface that wants a number has
 * to narrow first — which is the same mechanism `AwsRead` uses one level up,
 * for the same reason.
 */
export type ShapeRate =
  | {
      kind: "flat"
      sku: string
      rateCode: string
      rate: Rate
      description: string
      effectiveDate: string | null
    }
  | { kind: "tiered"; sku: string; tiers: readonly PricedTier[]; effectiveDate: string | null }
  /** Read, and the published list does not contain this shape. Never a zero. */
  | { kind: "unknown"; why: string }
  /** Several published rates match. Naming which one to take is the caller's. */
  | { kind: "ambiguous"; why: string; candidates: readonly string[] }

export interface ShapeReading {
  readonly shape: ShapeKey
  readonly reads: string
  readonly query: PriceQuery
  /**
   * The products AWS returned. DENIED here carries the principal, the action
   * and a pasteable statement, and is NEVER an empty list — "we were not
   * allowed to look" and "there is no such price" are opposite facts.
   */
  readonly products: AwsRead<readonly PricedProduct[]>
  readonly rate: ShapeRate
  /** True when the page cap was hit. The rate is then `unknown` by construction. */
  readonly truncated: boolean
  /** A list price belongs to no tenant. Stated, not inferred. */
  readonly attribution: Attribution
  /** This capability's own cadence, from the registry rather than retyped. */
  readonly refreshMs: number
  readonly asOf: string
}

/** One published price-list file, which is how AWS dates a price change. */
export interface PriceListPublication {
  readonly arn: string | null
  readonly regionCode: string | null
  readonly currencyCode: string | null
  readonly fileFormats: readonly string[]
}

export interface PricingReadings {
  readonly identity: AwsRead<Identity>
  readonly shapes: readonly ShapeReading[]
  readonly asOf: string
  readonly refreshMs: { products: number; priceLists: number }
}

/** Prices are the same number for every tenant. See the module header. */
export const PRICE_ATTRIBUTION: Attribution = { kind: "shared" }

export const PRICE_ATTRIBUTION_WHY =
  "a published list price is not a provisioned resource: it has no ARN, carries no tenure:tenant " +
  "tag and is the same figure for every tenant. Consumption is what attributes, and that is Cost " +
  "Explorer's reading, not this one."

/* --------------------------------------------------------------- parsing -- */

/** The API's shapes, declared rather than imported — see client.ts's one-owner rule. */
interface GetProductsResponse {
  PriceList?: unknown[]
  NextToken?: string
}

interface ListPriceListsResponse {
  PriceLists?: Array<{
    PriceListArn?: string
    RegionCode?: string
    CurrencyCode?: string
    FileFormats?: string[]
  }>
  NextToken?: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null
}

/** A string map, keeping only the string-valued entries AWS actually sent. */
function stringMap(value: unknown): Record<string, string> {
  const record = asRecord(value)
  if (!record) return {}
  const out: Record<string, string> = {}
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === "string") out[key] = entry
  }
  return out
}

/**
 * A range bound. `"Inf"` is null; anything unparseable throws.
 *
 * Throwing puts the dimension in `unreadable` rather than inventing a boundary:
 * a tier ladder whose edges are guessed prices the wrong tier, which is a wrong
 * number rendered as confidently as a right one.
 */
function parseRange(raw: unknown): number | null {
  const value = asString(raw)
  if (value === null) return null
  if (/^inf(inity)?$/i.test(value)) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${JSON.stringify(value)} is not a tier boundary`)
  }
  return parsed
}

/**
 * Which currency a `pricePerUnit` map is in.
 *
 * Never defaulted to USD. One key is the answer; several with no stated
 * preference is an ambiguity the caller resolves, because picking one would be
 * this engine choosing a currency for somebody's quote.
 */
export function currencyOf(
  pricePerUnit: Readonly<Record<string, string>>,
  preferred: string | undefined,
): { ok: true; currency: string } | { ok: false; why: string } {
  const codes = Object.keys(pricePerUnit).sort()
  if (codes.length === 0) return { ok: false, why: "the price dimension carries no currency at all" }
  if (preferred) {
    if (codes.includes(preferred)) return { ok: true, currency: preferred }
    return {
      ok: false,
      why: `this price is published in ${codes.join(", ")} and ${preferred} was asked for`,
    }
  }
  if (codes.length === 1) return { ok: true, currency: codes[0] }
  return {
    ok: false,
    why: `this price is published in ${codes.join(", ")} — name one rather than have this engine pick`,
  }
}

/**
 * One entry of `PriceList` — a JSON document, which the SDK hands back as a
 * string — as a typed product.
 *
 * ONLY the OnDemand term is read. A Reserved or Savings Plan rate is a
 * commitment this estate has not made, and quoting a proposed cell at one would
 * be a price nobody can actually buy today.
 */
export function parsePriceListEntry(
  entry: unknown,
  preferredCurrency: string | undefined,
): PricedProduct | null {
  let document: Record<string, unknown> | null
  if (typeof entry === "string") {
    try {
      document = asRecord(JSON.parse(entry))
    } catch {
      // Not silently skipped: throwing makes the whole read an ERROR naming the
      // fault, because a price list this engine cannot parse is a price list it
      // must not quote a partial answer from.
      throw new Error("a PriceList entry is not JSON, so the published prices cannot be read")
    }
  } else {
    document = asRecord(entry)
  }
  if (!document) return null

  const product = asRecord(document.product)
  const sku = asString(product?.sku)
  if (!sku) return null
  const attributes = stringMap(product?.attributes)

  const terms = asRecord(document.terms)
  const onDemand = asRecord(terms?.OnDemand)
  const dimensions: PricedDimension[] = []
  const unreadable: UnreadablePrice[] = []
  let effectiveDate: string | null = null

  for (const term of Object.values(onDemand ?? {})) {
    const termRecord = asRecord(term)
    if (!termRecord) continue
    effectiveDate = effectiveDate ?? asString(termRecord.effectiveDate)
    const priceDimensions = asRecord(termRecord.priceDimensions)
    for (const [key, dimension] of Object.entries(priceDimensions ?? {})) {
      const record = asRecord(dimension)
      if (!record) continue
      const rateCode = asString(record.rateCode) ?? key
      const pricePerUnit = stringMap(record.pricePerUnit)
      const description = asString(record.description) ?? ""
      const unit = asString(record.unit) ?? ""

      const currency = currencyOf(pricePerUnit, preferredCurrency)
      if (!currency.ok) {
        unreadable.push({ rateCode, published: JSON.stringify(pricePerUnit), why: currency.why })
        continue
      }
      const parsed = parseRate(pricePerUnit[currency.currency], currency.currency, unit)
      if (!parsed.ok) {
        unreadable.push({
          rateCode,
          published: pricePerUnit[currency.currency],
          why: parsed.why,
        })
        continue
      }

      let beginRange: number | null
      let endRange: number | null
      try {
        beginRange = parseRange(record.beginRange) ?? 0
        endRange = parseRange(record.endRange)
      } catch (error) {
        unreadable.push({
          rateCode,
          published: pricePerUnit[currency.currency],
          why: error instanceof Error ? error.message : String(error),
        })
        continue
      }

      dimensions.push({ rateCode, description, beginRange, endRange, rate: parsed.rate })
    }
  }

  return {
    sku,
    productFamily: asString(product?.productFamily),
    usagetype: attributes.usagetype ?? attributes.usageType ?? null,
    location: attributes.location ?? null,
    attributes,
    publicationDate: asString(document.publicationDate),
    effectiveDate,
    // Sorted so two loads of the same price list render identically. The API
    // does not promise an order, and an order that changes between refreshes
    // makes a diff of two quotes unreadable.
    dimensions: dimensions.sort(
      (left, right) => left.beginRange - right.beginRange || left.rateCode.localeCompare(right.rateCode),
    ),
    unreadable: unreadable.sort((left, right) => left.rateCode.localeCompare(right.rateCode)),
  }
}

/* ------------------------------------------------------------- the query -- */

const SAFE_PARAMETER = /^[A-Za-z0-9 ._:+/()-]{1,128}$/

/**
 * The filters for one shape, or why the question cannot be asked.
 *
 * A parameter the shape does not declare is REFUSED rather than passed through.
 * A filter bag a caller fills is an arbitrary query against the Price List, and
 * `client.ts` deliberately has no way to express one; this is the same rule one
 * level up.
 */
export function buildQuery(
  shape: ShapeKey,
  parameters: Readonly<Record<string, string>>,
  identity: AwsRead<Identity>,
): { ok: true; query: PriceQuery } | { ok: false; why: string } {
  const spec = SHAPES[shape]
  const filters: PriceFilter[] = [...spec.filters]

  for (const [field, value] of Object.entries(parameters)) {
    const declared = spec.parameters.find((p) => p.field === field)
    if (!declared) {
      return {
        ok: false,
        why:
          `${shape} does not take a ${field} parameter. It takes ` +
          `${spec.parameters.map((p) => p.field).join(", ") || "no parameters"}. ` +
          `This engine will not pass a filter field it does not declare.`,
      }
    }
    if (!SAFE_PARAMETER.test(value)) {
      return { ok: false, why: `${field}=${JSON.stringify(value)} is not a price-list filter value` }
    }
    filters.push({ field, value })
  }

  for (const declared of spec.parameters) {
    if (declared.required && !(declared.field in parameters)) {
      return {
        ok: false,
        why: `${shape} needs a ${declared.field} — ${declared.describes} — and none was supplied`,
      }
    }
  }

  if (spec.regionScope === "global") {
    return {
      ok: true,
      query: {
        serviceCode: spec.serviceCode,
        filters,
        regionCode: null,
        regionProvenance:
          "not region-scoped — this shape is priced by edge geography, so a regionCode filter " +
          "would match nothing",
      },
    }
  }

  if (identity.state !== "ACTUAL" && identity.state !== "STALE") {
    return {
      ok: false,
      why:
        `this price varies by region and the region is unresolved — ` +
        `${describeRead(identity, "sts:GetCallerIdentity")}. This engine will not quote a region ` +
        `it cannot name; a guessed region is a quote for somewhere else.`,
    }
  }

  filters.push({ field: "regionCode", value: identity.value.region })
  return {
    ok: true,
    query: {
      serviceCode: spec.serviceCode,
      filters,
      regionCode: identity.value.region,
      regionProvenance: `the region sts:GetCallerIdentity resolved (partition ${identity.value.partition})`,
    },
  }
}

/* ------------------------------------------------------------ the reading -- */

interface Paged<T> {
  items: T[]
  truncated: boolean
}

async function readProducts(
  gw: AwsGateway,
  query: PriceQuery,
  preferredCurrency: string | undefined,
  options: { now: () => Date; denial: DenialContext; sleep?: (ms: number) => Promise<void> },
): Promise<{ read: AwsRead<readonly PricedProduct[]>; truncated: boolean }> {
  const paged: Paged<PricedProduct> = { items: [], truncated: false }

  const read = await readAws<readonly PricedProduct[]>(
    "pricing:GetProducts",
    async () => {
      paged.items = []
      paged.truncated = false
      let token: string | undefined
      for (let page = 0; page < MAX_PRODUCT_PAGES; page += 1) {
        const response = (await gw.call("pricing:GetProducts", {
          ServiceCode: query.serviceCode,
          Filters: query.filters.map((f) => ({ Field: f.field, Value: f.value })),
          NextToken: token,
        })) as GetProductsResponse

        for (const entry of response?.PriceList ?? []) {
          const product = parsePriceListEntry(entry, preferredCurrency)
          if (product) paged.items.push(product)
        }

        token = response?.NextToken || undefined
        if (!token) break
        if (page === MAX_PRODUCT_PAGES - 1) {
          // Reported, not thrown: the products read so far are real and worth
          // showing. What must not happen is a RATE picked out of them, and
          // `rateFor` refuses that on this flag.
          paged.truncated = true
        }
      }
      // Sorted so two loads produce the same order; GetProducts promises none.
      return paged.items.sort((left, right) => left.sku.localeCompare(right.sku))
    },
    { now: options.now, denial: options.denial, sleep: options.sleep, ...RETRY },
  )

  return { read, truncated: paged.truncated }
}

/**
 * The published price-list files for a service, which is how AWS dates a price
 * change.
 *
 * A separate capability and therefore a separate reading: `pricing:GetProducts`
 * and `pricing:ListPriceLists` are separate IAM actions and a role is routinely
 * granted one without the other. Folding them would make a denied
 * `ListPriceLists` render as a refused `GetProducts`, so the statement an
 * operator pastes would not contain the action that is actually missing.
 *
 * `currency` is required and has no default for the same reason a price does:
 * this call takes a currency code, and choosing one here would be this engine
 * deciding what somebody is billed in.
 */
export async function priceListPublications(
  supplied: AwsGateway | undefined,
  request: { serviceCode: string; currency: string },
  options: { now?: () => Date; denial?: DenialContext; sleep?: (ms: number) => Promise<void> } = {},
): Promise<AwsRead<readonly PriceListPublication[]>> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())

  return readAws<readonly PriceListPublication[]>(
    "pricing:ListPriceLists",
    async () => {
      const out: PriceListPublication[] = []
      let token: string | undefined
      for (let page = 0; page < MAX_PRICE_LIST_PAGES; page += 1) {
        const response = (await gw.call("pricing:ListPriceLists", {
          ServiceCode: request.serviceCode,
          CurrencyCode: request.currency,
          NextToken: token,
        })) as ListPriceListsResponse

        for (const entry of response?.PriceLists ?? []) {
          out.push({
            arn: asString(entry?.PriceListArn),
            regionCode: asString(entry?.RegionCode),
            currencyCode: asString(entry?.CurrencyCode),
            fileFormats: (entry?.FileFormats ?? []).filter((f): f is string => typeof f === "string"),
          })
        }

        token = response?.NextToken || undefined
        if (!token) break
        if (page === MAX_PRICE_LIST_PAGES - 1) {
          throw new Error(
            `pricing:ListPriceLists still had pages after ${MAX_PRICE_LIST_PAGES}. This engine will ` +
              `not render a partial publication list as if it were complete.`,
          )
        }
      }
      return out.sort((left, right) => (left.arn ?? "").localeCompare(right.arn ?? ""))
    },
    { now, denial: options.denial, sleep: options.sleep, ...RETRY },
  )
}

/* ----------------------------------------------------------- the selection -- */

function matches(spec: ShapeSpec, product: PricedProduct, dimension: PricedDimension): boolean {
  if (spec.select.length === 0) return true
  const haystack = `${product.usagetype ?? ""} ${dimension.description}`.toLowerCase()
  return spec.select.some((fragment) => haystack.includes(fragment.toLowerCase()))
}

/** Every usage type actually seen, so a wrong selector is fixable from the page. */
function observedUsageTypes(products: readonly PricedProduct[]): string[] {
  const seen = new Set<string>()
  for (const product of products) {
    if (product.usagetype) seen.add(product.usagetype)
  }
  return [...seen].sort().slice(0, 20)
}

/**
 * The rate for one shape, or why there is none.
 *
 * Every path that cannot produce an exact price produces an arm with no amount
 * on it. There is no branch here that returns a zero, and adding one would have
 * to change the type.
 */
export function rateFor(
  shape: ShapeKey,
  products: AwsRead<readonly PricedProduct[]>,
  truncated: boolean,
): ShapeRate {
  const spec = SHAPES[shape]

  if (products.state !== "ACTUAL" && products.state !== "STALE") {
    return { kind: "unknown", why: describeRead(products, `the published price for ${shape}`) }
  }
  if (truncated) {
    return {
      kind: "unknown",
      why:
        `the price list had more than ${MAX_PRODUCT_PAGES} pages of products for this query. A rate ` +
        `chosen from a partial list could be the wrong SKU, so none was chosen. Narrow the query ` +
        `with a parameter — ${spec.parameters.map((p) => p.field).join(", ") || "this shape declares none"}.`,
    }
  }

  const matched: Array<{ product: PricedProduct; dimension: PricedDimension }> = []
  for (const product of products.value) {
    for (const dimension of product.dimensions) {
      if (matches(spec, product, dimension)) matched.push({ product, dimension })
    }
  }

  if (matched.length === 0) {
    const unreadable = products.value.flatMap((p) => p.unreadable)
    const seen = observedUsageTypes(products.value)
    return {
      kind: "unknown",
      why:
        `no published price dimension matched ${spec.select.join(" or ")} among ` +
        `${products.value.length} product(s) of ${spec.serviceCode}` +
        `${seen.length > 0 ? `. Usage types actually published: ${seen.join(", ")}` : ""}` +
        `${
          unreadable.length > 0
            ? `. ${unreadable.length} dimension(s) had a price this engine could not read: ` +
              `${unreadable.map((u) => `${u.rateCode} (${u.why})`).join("; ")}`
            : ""
        }`,
    }
  }

  const label = ({ product, dimension }: { product: PricedProduct; dimension: PricedDimension }) =>
    `${product.sku}/${dimension.rateCode} ${product.usagetype ?? "(no usagetype)"} — ${dimension.description}`

  const skus = [...new Set(matched.map((m) => m.product.sku))].sort()

  if (spec.tiered) {
    if (skus.length > 1) {
      return {
        kind: "ambiguous",
        why:
          `${skus.length} products publish a tier ladder for this shape. A ladder spliced from two ` +
          `SKUs is not a price anybody can be charged — narrow it with ` +
          `${spec.parameters.map((p) => `${p.field} (${p.describes})`).join(", ") || "a parameter this shape does not declare"}.`,
        candidates: matched.map(label).sort(),
      }
    }
    const tiers = matched
      .map(({ dimension }) => ({
        fromUnits: dimension.beginRange,
        toUnits: dimension.endRange,
        rate: dimension.rate,
        rateCode: dimension.rateCode,
        description: dimension.description,
      }))
      .sort((left, right) => left.fromUnits - right.fromUnits)

    for (let i = 1; i < tiers.length; i += 1) {
      if (tiers[i].fromUnits === tiers[i - 1].fromUnits) {
        return {
          kind: "ambiguous",
          why: `two published tiers start at ${tiers[i].fromUnits} ${tiers[i].rate.unit}, so the ladder is not a ladder`,
          candidates: matched.map(label).sort(),
        }
      }
    }
    return {
      kind: "tiered",
      sku: skus[0],
      tiers,
      effectiveDate: matched[0].product.effectiveDate,
    }
  }

  if (matched.length > 1) {
    return {
      kind: "ambiguous",
      why:
        `${matched.length} published rates match ${spec.select.join(" or ")}. This engine will not ` +
        `pick one — narrow it with ` +
        `${spec.parameters.map((p) => `${p.field} (${p.describes})`).join(", ") || "a parameter this shape does not declare"}.`,
      candidates: matched.map(label).sort(),
    }
  }

  const { product, dimension } = matched[0]
  return {
    kind: "flat",
    sku: product.sku,
    rateCode: dimension.rateCode,
    rate: dimension.rate,
    description: dimension.description,
    effectiveDate: product.effectiveDate,
  }
}

/* ----------------------------------------------------------- the surface -- */

export interface PricingOptions {
  now?: () => Date
  /** Which shapes to price. Every shape by default. */
  requests?: readonly ShapeRequest[]
  /**
   * The currency to quote in, when a dimension publishes several.
   *
   * No default. A price list with one currency answers in it; one with several
   * and no preference is reported ambiguous rather than picked for somebody.
   */
  currency?: string
  /** Injected so a throttle's backoff is instant under test, as `now` is for the clock. */
  sleep?: (ms: number) => Promise<void>
}

/**
 * Every requested shape's list price, each degrading on its own.
 *
 * The production entry point. A route or a page calls it with no arguments and
 * gets the live gateway; a test passes a stand-in gateway to the SAME function,
 * because a test that drove a private helper would stay green on the day the
 * caller stopped calling it.
 *
 * Shapes are read one after another rather than in parallel: the Price List
 * response bodies are large and its throttle is per account, and one page load
 * bursting fourteen of them is how a console rate-limits the estate it is
 * supposed to be watching. Each is its own `readAws`, so a denied Fargate price
 * leaves the DynamoDB one priced — one denied detail must not collapse the row.
 */
export async function pricingReadings(
  supplied?: AwsGateway,
  options: PricingOptions = {},
): Promise<PricingReadings> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())
  const requests: readonly ShapeRequest[] =
    options.requests ?? ALL_SHAPES.map((shape) => ({ shape }))

  const identity = await resolveIdentity(supplied, { now })
  const denial = denialContextFrom(identity)
  const asOf = now().toISOString()
  const refreshMs = {
    products: CAPABILITIES["pricing:GetProducts"].refreshMs,
    priceLists: CAPABILITIES["pricing:ListPriceLists"].refreshMs,
  }

  const shapes: ShapeReading[] = []
  for (const request of requests) {
    const spec = SHAPES[request.shape]
    const built = buildQuery(request.shape, request.parameters ?? {}, identity)

    if (!built.ok) {
      // The call is not made at all. UNCONFIGURED says exactly that, and it is
      // not EMPTY: nobody looked, so nothing was found is not a finding.
      const products: AwsRead<readonly PricedProduct[]> = {
        state: "UNCONFIGURED",
        capability: "pricing:GetProducts",
        why: built.why,
      }
      shapes.push({
        shape: request.shape,
        reads: spec.reads,
        query: {
          serviceCode: spec.serviceCode,
          filters: spec.filters,
          regionCode: null,
          regionProvenance: built.why,
        },
        products,
        rate: { kind: "unknown", why: `not configured — ${built.why}` },
        truncated: false,
        attribution: PRICE_ATTRIBUTION,
        refreshMs: refreshMs.products,
        asOf,
      })
      continue
    }

    const { read, truncated } = await readProducts(gw, built.query, options.currency, {
      now,
      denial,
      sleep: options.sleep,
    })

    shapes.push({
      shape: request.shape,
      reads: spec.reads,
      query: built.query,
      products: read,
      rate: rateFor(request.shape, read, truncated),
      truncated,
      attribution: PRICE_ATTRIBUTION,
      refreshMs: refreshMs.products,
      asOf,
    })
  }

  return { identity, shapes, asOf, refreshMs }
}

/* ------------------------------------------------------------ rendering -- */

/** The sentence a surface prints for one shape's rate. One funnel, so states cannot drift. */
export function describeShapeRate(rate: ShapeRate): string {
  switch (rate.kind) {
    case "flat":
      return (
        `${describeRate(rate.rate)} — ${rate.description} (SKU ${rate.sku}, rate ${rate.rateCode}` +
        `${rate.effectiveDate ? `, effective ${rate.effectiveDate}` : ""})`
      )
    case "tiered": {
      const ladder = rate.tiers
        .map((tier) => {
          const upper = tier.toUnits === null ? "and above" : `to ${tier.toUnits}`
          return `${tier.fromUnits} ${upper}: ${describeRate(tier.rate)}`
        })
        .join(" · ")
      return (
        `${rate.tiers.length} published tier(s) — ${ladder} (SKU ${rate.sku}` +
        `${rate.effectiveDate ? `, effective ${rate.effectiveDate}` : ""})`
      )
    }
    case "ambiguous":
      return `ambiguous — ${rate.why} Candidates: ${rate.candidates.join(" | ")}`
    case "unknown":
      return `unknown — ${rate.why}`
  }
}

export interface PricingLine {
  label: string
  text: string
}

/**
 * What a pricing surface prints.
 *
 * The surface agent renders exactly these strings, and the tests assert on
 * them, which is what makes a mutation proof land on the production path rather
 * than on a helper nothing calls.
 */
export function pricingLines(readings: PricingReadings): readonly PricingLine[] {
  const lines: PricingLine[] = [
    {
      label: "Price list",
      text:
        `${readings.shapes.length} shape(s) priced from the AWS Price List, as of ${readings.asOf}, ` +
        `refreshed every ${Math.round(readings.refreshMs.products / 3_600_000)}h · ` +
        `attribution: ${PRICE_ATTRIBUTION.kind} — ${PRICE_ATTRIBUTION_WHY}`,
    },
  ]
  for (const shape of readings.shapes) {
    // The read's own state goes through `describeRead`, so a denial reads as a
    // refusal here exactly as it does on every other surface — never as "free".
    const where = shape.query.regionCode
      ? `region ${shape.query.regionCode}`
      : shape.query.regionProvenance
    lines.push({
      label: shape.shape,
      text:
        `${shape.reads} — ${where} — ${describeShapeRate(shape.rate)} · ` +
        `${describeRead(shape.products, `${shape.query.serviceCode} products`)}` +
        `${shape.truncated ? " · TRUNCATED: more pages existed than this engine reads" : ""}`,
    })
  }
  return lines
}
