import { __resetIdentity } from "./identity"
import type { AwsGateway } from "./read"
import {
  MAX_INDIVIDUAL_QUOTA_READS,
  MAX_QUOTA_PAGES,
  QUOTA_TARGETS,
  headroomOf,
  parseArn,
  quotaLines,
  quotaReadings,
  resolveFromListing,
  type QuotaReadings,
  type QuotaTarget,
} from "./quotas"

/**
 * STUDIO-070-011 (Service Quotas) — the quota surface tells four different
 * truths apart, and never renders a ceiling it did not read.
 *
 * The assertions are on `quotaReadings` and `quotaLines`, the functions a route
 * renders, rather than on `readAws` or on any parser. A test that drove
 * `readAws` directly would stay green on the day this module stopped calling it,
 * which is the failure this programme has already paid for twice.
 *
 * ## The stand-in is a client, not a stub
 *
 * `fakeAws` answers four capabilities with the shapes the real SDK returns —
 * `{Quotas: [{ServiceCode, QuotaCode, QuotaName, Value, Unit, Adjustable,
 * GlobalQuota, UsageMetric, QuotaArn}], NextToken}` from ListServiceQuotas,
 * `{Quota: {…}}` from GetServiceQuota, `{ResourceTagMappingList: [{ResourceARN,
 * Tags}]}` from the Tagging API and `{Account, Arn}` from STS — and it can fail
 * each of them independently, PER SERVICE, with `AccessDeniedException`, a
 * `ThrottlingException`, an empty-but-successful listing, or a populated one. A
 * stand-in that returned `[]` regardless of what was asked would prove nothing
 * about code whose entire job is telling those four apart, and it is the fake
 * this repository has already been burnt by.
 *
 * ## The account id is constructed, and says so
 *
 * `123456789012` is the obviously-fake twelve-digit account used throughout.
 * Nothing here is a real AWS account, ARN, region or resource name. The region
 * is `eu-west-2` and it is threaded through the fixture from ONE constant, so a
 * hardcoded `us-east-1` anywhere in the module under test shows up as a failed
 * assertion rather than as a residency defect nobody noticed.
 */

/* ------------------------------------------------------------- the estate -- */

/** Obviously constructed. Not a real AWS account. */
const ACCOUNT = "123456789012"

/**
 * One region for the whole fixture, referenced rather than retyped. GE-010-007
 * was a data-residency defect caused by a literal region; the module must carry
 * this value through, and nothing in it may substitute one of its own.
 */
const REGION = "eu-west-2"
const PARTITION = "aws"

interface QuotaFixture {
  serviceCode: string
  quotaCode: string
  quotaName: string
  value: number
  unit?: string
  adjustable?: boolean
  global?: boolean
  usageMetric?: {
    MetricNamespace: string
    MetricName: string
    MetricDimensions: Record<string, string>
    MetricStatisticRecommendation: string
  }
  period?: { PeriodValue: number; PeriodUnit: string }
}

/** The ARN Service Quotas returns for an applied quota. Global quotas carry no region. */
function quotaArn(fixture: QuotaFixture): string {
  const region = fixture.global ? "" : REGION
  return `arn:${PARTITION}:servicequotas:${region}:${ACCOUNT}:${fixture.serviceCode}/${fixture.quotaCode}`
}

/** The SDK's `ServiceQuota` shape, as `ListServiceQuotas` and `GetServiceQuota` return it. */
function asServiceQuota(fixture: QuotaFixture): Record<string, unknown> {
  return {
    ServiceCode: fixture.serviceCode,
    ServiceName: fixture.serviceCode.toUpperCase(),
    QuotaArn: quotaArn(fixture),
    QuotaCode: fixture.quotaCode,
    QuotaName: fixture.quotaName,
    Value: fixture.value,
    Unit: fixture.unit ?? "None",
    // AWS OMITS Adjustable entirely for a quota that cannot be raised. The fake
    // omits it too, because a fake that always sent `false` would hide the fact
    // that the module has to read an absence as "cannot be raised".
    ...(fixture.adjustable === false ? {} : { Adjustable: true }),
    ...(fixture.global ? { GlobalQuota: true } : {}),
    ...(fixture.usageMetric ? { UsageMetric: fixture.usageMetric } : {}),
    ...(fixture.period ? { Period: fixture.period } : {}),
  }
}

const VPC_USAGE_METRIC = {
  MetricNamespace: "AWS/Usage",
  MetricName: "ResourceCount",
  MetricDimensions: { Service: "VPC", Class: "None", Type: "Resource", Resource: "VPC" },
  MetricStatisticRecommendation: "Maximum",
}

const LAMBDA_USAGE_METRIC = {
  MetricNamespace: "AWS/Usage",
  MetricName: "ResourceCount",
  MetricDimensions: { Service: "Lambda", Class: "None", Type: "Resource", Resource: "ConcurrentExecutions" },
  MetricStatisticRecommendation: "Maximum",
}

/**
 * The applied quotas for the nine services `QUOTA_TARGETS` names, with values
 * chosen so the healthy estate is nowhere near a ceiling. Every quota code and
 * name here is the one the module looks for, so the base case exercises the
 * code-match route.
 */
const ESTATE: readonly QuotaFixture[] = [
  { serviceCode: "vpc", quotaCode: "L-F678F1CE", quotaName: "VPCs per Region", value: 5, usageMetric: VPC_USAGE_METRIC },
  { serviceCode: "vpc", quotaCode: "L-E79EC296", quotaName: "VPC security groups per Region", value: 2500 },
  { serviceCode: "vpc", quotaCode: "L-0EA8095F", quotaName: "Inbound or outbound rules per security group", value: 60 },
  // A quota AWS does not let you raise. Present so the "NOT adjustable" branch
  // is driven by an absent `Adjustable`, which is what AWS actually sends.
  { serviceCode: "vpc", quotaCode: "L-45FE3B85", quotaName: "Egress-only internet gateways per Region", value: 5, adjustable: false },
  { serviceCode: "ecs", quotaCode: "L-9EF96962", quotaName: "Services per cluster", value: 5000 },
  // A second ecs quota with an obviously-constructed code, so that omitting the
  // target above leaves a listing that ANSWERED with something. Without it the
  // omission would make the whole service EMPTY, and the fallback path would
  // never be reached — the fixture would be testing a different branch than the
  // one it names.
  {
    serviceCode: "ecs",
    quotaCode: "L-FIXTURE1",
    quotaName: "a second ecs quota, constructed so an omitted target leaves a non-empty listing",
    value: 100,
  },
  { serviceCode: "elasticloadbalancing", quotaCode: "L-53DA6B97", quotaName: "Application Load Balancers per Region", value: 50 },
  { serviceCode: "elasticloadbalancing", quotaCode: "L-B22855CB", quotaName: "Target Groups per Region", value: 3000 },
  { serviceCode: "rds", quotaCode: "L-7B6409FD", quotaName: "DB instances", value: 40 },
  { serviceCode: "cloudfront", quotaCode: "L-24B04930", quotaName: "Distributions per AWS account", value: 200, global: true },
  { serviceCode: "acm", quotaCode: "L-F141DD1D", quotaName: "ACM certificates", value: 2500 },
  { serviceCode: "cognito-idp", quotaCode: "L-627C1657", quotaName: "User pools per account", value: 1000 },
  {
    serviceCode: "lambda",
    quotaCode: "L-B99A9384",
    quotaName: "Concurrent executions",
    value: 1000,
    usageMetric: LAMBDA_USAGE_METRIC,
  },
  {
    serviceCode: "ses",
    quotaCode: "L-804C8AE8",
    quotaName: "Daily sending quota",
    value: 50000,
    unit: "None",
    period: { PeriodValue: 1, PeriodUnit: "DAY" },
  },
]

/* ------------------------------------------------------------- the tags -- */

function tenantTags(slug: string): Array<{ Key: string; Value: string }> {
  return [
    { Key: "tenure:tenant", Value: slug },
    { Key: "tenure:environment", Value: "production" },
  ]
}

function arn(service: string, resource: string, region: string = REGION): string {
  return `arn:${PARTITION}:${service}:${region}:${ACCOUNT}:${resource}`
}

/**
 * The tagged estate. Two VPCs, three security groups, two ECS services, one
 * load balancer, two target groups, one database, one distribution, one
 * certificate and one user pool — every one of which counts against a quota the
 * module reads, and none of which is anywhere near it.
 */
const TAGGED_ESTATE: Record<string, Array<{ Key: string; Value: string }>> = {
  [arn("ec2", "vpc/vpc-0aa1")]: tenantTags("northgate-academy"),
  [arn("ec2", "vpc/vpc-0bb2")]: tenantTags("riverside-college"),
  [arn("ec2", "security-group/sg-0aa1")]: tenantTags("northgate-academy"),
  [arn("ec2", "security-group/sg-0bb2")]: tenantTags("riverside-college"),
  [arn("ec2", "security-group/sg-0cc3")]: [{ Key: "tenure:tenant", Value: "tenure:shared" }],
  [arn("ecs", "service/tenure-prod/web")]: tenantTags("northgate-academy"),
  [arn("ecs", "service/tenure-prod/worker")]: tenantTags("riverside-college"),
  [arn("elasticloadbalancing", "loadbalancer/app/tenure-prod/abc123")]: [
    { Key: "tenure:tenant", Value: "tenure:shared" },
  ],
  [arn("elasticloadbalancing", "targetgroup/tenure-web/abc123")]: tenantTags("northgate-academy"),
  [arn("elasticloadbalancing", "targetgroup/tenure-worker/def456")]: tenantTags("riverside-college"),
  [arn("rds", "db:tenure-prod")]: [{ Key: "tenure:tenant", Value: "tenure:shared" }],
  [`arn:${PARTITION}:cloudfront::${ACCOUNT}:distribution/E1AAAAAAAAAAAA`]: [
    { Key: "tenure:tenant", Value: "tenure:shared" },
  ],
  [arn("acm", "certificate/11111111-2222-3333-4444-555555555555")]: tenantTags("northgate-academy"),
  [arn("cognito-idp", "userpool/eu-west-2_AAAAAAAAA")]: [
    { Key: "tenure:tenant", Value: "tenure:shared" },
  ],
}

/* ------------------------------------------------------------- the client -- */

type Outcome = "populated" | "empty" | "denied" | "throttled"

interface FakeOptions {
  /** How every `ListServiceQuotas` behaves. The four cases this suite separates. */
  listQuotas?: Outcome
  /** Per-service override, so one refused service can be shown not to sink the rest. */
  perService?: Record<string, Outcome>
  /** Quota codes removed from every listing, forcing the GetServiceQuota fallback. */
  omitCodes?: readonly string[]
  /** Quota codes rewritten in the listing, so only the NAME can still match. */
  recodeAs?: Record<string, string>
  /** How `GetServiceQuota` behaves. `notfound` is what AWS raises for a bad code. */
  getQuota?: Outcome | "notfound"
  /** Services whose listing never runs out of pages, so the page cap is reached. */
  endlessPages?: readonly string[]
  /**
   * A quota AWS answers with a field missing. The SDK's types make these
   * optional and the wire really can omit them, which is the whole reason the
   * module refuses to substitute a number of its own.
   */
  malformed?: { code: string; drop: "Value" | "QuotaCode" }
  tags?: Record<string, Array<{ Key: string; Value: string }>>
  tagsOutcome?: Outcome
  identity?: { arn: string; account: string; region: string } | "denied"
  /** Set by the fake so a test can assert what was and was not called. */
  calls?: string[]
}

function throwing(name: string): never {
  const error = new Error(`${name} raised by the stand-in AWS client`)
  error.name = name
  throw error
}

function fakeAws(options: FakeOptions = {}): AwsGateway {
  const base = options.listQuotas ?? "populated"
  const identity = options.identity ?? {
    arn: `arn:${PARTITION}:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
    account: ACCOUNT,
    region: REGION,
  }
  const calls = options.calls ?? []
  const omit = new Set(options.omitCodes ?? [])
  const endless = new Set(options.endlessPages ?? [])

  return {
    async call(capability, input) {
      calls.push(String(capability))
      switch (capability) {
        case "sts:GetCallerIdentity":
          if (identity === "denied") throwing("AccessDenied")
          return { Account: identity.account, Arn: identity.arn, UserId: "AROA:studio" }

        case "tag:GetResources": {
          const outcome = options.tagsOutcome ?? "populated"
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          if (outcome === "empty") return { ResourceTagMappingList: [] }
          return {
            ResourceTagMappingList: Object.entries(options.tags ?? TAGGED_ESTATE).map(
              ([resourceArn, Tags]) => ({ ResourceARN: resourceArn, Tags }),
            ),
          }
        }

        case "servicequotas:ListServiceQuotas": {
          const serviceCode = String((input as { ServiceCode?: unknown } | undefined)?.ServiceCode ?? "")
          const outcome = options.perService?.[serviceCode] ?? base
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          // The real API OMITS `Quotas` entirely when it has nothing to return.
          // It does not send an empty array, and a fake that did would be testing
          // a response AWS never sends.
          if (outcome === "empty") return {}

          const token = (input as { NextToken?: unknown } | undefined)?.NextToken
          const quotas =
            // A service whose pages never end returns its quotas once and then
            // keeps handing back a token, which is how a real runaway listing
            // behaves and what the page cap exists for.
            token === undefined
              ? ESTATE.filter((q) => q.serviceCode === serviceCode && !omit.has(q.quotaCode)).map(
                  (q) => {
                    const recoded = options.recodeAs?.[q.quotaCode]
                    const shaped = asServiceQuota(recoded ? { ...q, quotaCode: recoded } : q)
                    if (options.malformed?.code === q.quotaCode) {
                      delete shaped[options.malformed.drop]
                    }
                    return shaped
                  },
                )
              : []
          if (endless.has(serviceCode)) {
            return { Quotas: quotas, NextToken: `page-after-${String(token ?? "first")}` }
          }
          return { Quotas: quotas }
        }

        case "servicequotas:GetServiceQuota": {
          const outcome = options.getQuota ?? "populated"
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          if (outcome === "notfound") throwing("NoSuchResourceException")
          const quotaCode = String((input as { QuotaCode?: unknown } | undefined)?.QuotaCode ?? "")
          const found = ESTATE.find((q) => q.quotaCode === quotaCode)
          // AWS raises rather than returning an empty envelope for a code it does
          // not know. `empty` here means "answered with no Quota", which the
          // module must treat as a fault and not as a ceiling.
          if (outcome === "empty" || !found) return {}
          return { Quota: asServiceQuota(found) }
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

async function load(
  options: FakeOptions = {},
  readOptions: Parameters<typeof quotaReadings>[1] = {},
): Promise<QuotaReadings> {
  return quotaReadings(fakeAws(options), { now: AT, ...readOptions })
}

/** The whole surface as one string, which is what an operator actually reads. */
function surfaceText(readings: QuotaReadings): string {
  return quotaLines(readings)
    .map((line) => `${line.label}: ${line.text}`)
    .join("\n")
}

function reading(readings: QuotaReadings, key: string) {
  const found = readings.quotas.find((q) => q.key === key)
  if (!found) throw new Error(`no reading for ${key}`)
  return found
}

beforeEach(() => {
  // resolveIdentity caches per process. Every case here supplies its own
  // gateway, which bypasses the cache, but a stale cache from another suite
  // would silently make these assertions test the wrong identity.
  __resetIdentity()
})

/* -------------------------------------------- the four outcomes, compared -- */

describe("the quota surface says something different for each of the four outcomes", () => {
  test("a populated listing is ACTUAL and carries every applied value", async () => {
    const readings = await load()
    expect(readings.quotas).toHaveLength(QUOTA_TARGETS.length)
    for (const q of readings.quotas) {
      expect(q.quota.state).toBe("ACTUAL")
    }
    const vpcs = reading(readings, "vpcs-per-region")
    if (vpcs.quota.state !== "ACTUAL") throw new Error("narrowing")
    expect(vpcs.quota.value.value).toBe(5)
    expect(vpcs.quota.value.provenance).toContain("matched on quota code")

    const text = surfaceText(readings)
    expect(text).toContain("VPCs per Region")
    expect(text).toContain("applied 5")
    expect(text).toContain("Daily sending quota")
    expect(text).toContain("applied 50000")
  })

  test("an empty-but-successful listing is EMPTY and says none, not refused", async () => {
    const readings = await load({ listQuotas: "empty" })
    for (const q of readings.quotas) {
      expect(q.quota.state).toBe("EMPTY")
    }
    const text = surfaceText(readings)
    expect(text).toContain("none —")
    expect(text).not.toContain("refused")
    expect(text).not.toContain("Minimum statement")
  })

  test("AccessDenied is DENIED, carries the principal, the action and a pasteable statement", async () => {
    const readings = await load({ listQuotas: "denied" })
    const vpcs = reading(readings, "vpcs-per-region")
    expect(vpcs.quota.state).toBe("DENIED")
    if (vpcs.quota.state !== "DENIED") throw new Error("narrowing")

    expect(vpcs.quota.action).toBe("servicequotas:ListServiceQuotas")
    expect(vpcs.quota.principal).toContain("assumed-role/tenure-studio-task")
    expect(vpcs.quota.accountId).toBe(ACCOUNT)
    expect(vpcs.quota.region).toBe(REGION)
    expect(vpcs.quota.partition).toBe(PARTITION)
    expect(JSON.parse(vpcs.quota.minimumStatement)).toEqual({
      Effect: "Allow",
      Action: ["servicequotas:ListServiceQuotas"],
      Resource: "*",
    })

    // And the thing it must NOT be. There is no `value` on this arm at all, so a
    // caller cannot reach a ceiling that was never read.
    expect("value" in vpcs.quota).toBe(false)
    const text = surfaceText(readings)
    expect(text).toContain("unknown")
    expect(text).not.toMatch(/\bnone —/)
  })

  test(
    "a throttle is THROTTLED — its own state, not a failure and not an empty list",
    async () => {
      const readings = await load({ listQuotas: "throttled" })
      const vpcs = reading(readings, "vpcs-per-region")
      expect(vpcs.quota.state).toBe("THROTTLED")
      if (vpcs.quota.state !== "THROTTLED") throw new Error("narrowing")
      // The schedule is throttle.ts's — 200ms after the first failure, doubling —
      // not a number retyped in this module.
      expect(vpcs.quota.retryAfterMs).toBe(800)
      const text = surfaceText(readings)
      expect(text).toContain("throttled")
      expect(text).toContain("retrying in")
      expect(text).not.toContain("Minimum statement")
    },
    60_000,
  )

  test(
    "the four render as four visibly different surfaces",
    async () => {
      const texts: string[] = []
      for (const outcome of ["populated", "empty", "denied", "throttled"] as const) {
        __resetIdentity()
        texts.push(surfaceText(await load({ listQuotas: outcome })))
      }
      expect(new Set(texts).size).toBe(4)
      // And they differ in the way that matters, not merely in a timestamp.
      const [populated, empty, denied, throttled] = texts
      expect(populated).toContain("applied 5")
      expect(empty).toContain("none —")
      expect(denied).toContain("Minimum statement")
      expect(throttled).toContain("retrying in")
      for (const other of [empty, denied, throttled]) {
        expect(other).not.toContain("applied 5")
      }
    },
    60_000,
  )
})

/* --------------------------------------------- independent degradation -- */

describe("one refused service does not collapse the rest", () => {
  test("a denied vpc listing leaves ecs, rds and ses standing", async () => {
    const readings = await load({ perService: { vpc: "denied" } })

    expect(reading(readings, "vpcs-per-region").quota.state).toBe("DENIED")
    expect(reading(readings, "rules-per-security-group").quota.state).toBe("DENIED")

    const ecs = reading(readings, "ecs-services-per-cluster")
    expect(ecs.quota.state).toBe("ACTUAL")
    if (ecs.quota.state !== "ACTUAL") throw new Error("narrowing")
    expect(ecs.quota.value.value).toBe(5000)

    const rds = reading(readings, "rds-db-instances")
    expect(rds.quota.state).toBe("ACTUAL")

    const text = surfaceText(readings)
    // Both facts, on one surface, at once. That is the whole point.
    expect(text).toContain("Minimum statement")
    expect(text).toContain("applied 5000")
  })

  test("an empty ecs listing does not make the vpc quotas unknown", async () => {
    const readings = await load({ perService: { ecs: "empty" } })
    expect(reading(readings, "ecs-services-per-cluster").quota.state).toBe("EMPTY")
    expect(reading(readings, "vpcs-per-region").quota.state).toBe("ACTUAL")
  })

  test("a refused tag index does not cost the quotas their applied values", async () => {
    const readings = await load({ tagsOutcome: "denied" })
    const vpcs = reading(readings, "vpcs-per-region")
    expect(vpcs.quota.state).toBe("ACTUAL")
    // The usage, which DOES depend on the tag index, degrades on its own — and
    // it degrades to "not known", never to zero.
    expect(vpcs.usage.kind).toBe("not-known")
    expect(vpcs.attribution.kind).toBe("unknown")
    const text = surfaceText(readings)
    expect(text).toContain("usage could not be estimated")
    expect(text).toContain("attribution unknown")
    expect(text).not.toContain("at least 0 in use")
  })
})

/* ------------------------------------------------------ batching + paging -- */

describe("the reads are batched by service and bounded", () => {
  test("one ListServiceQuotas per service code, not one call per target", async () => {
    const calls: string[] = []
    await load({ calls })
    const listings = calls.filter((c) => c === "servicequotas:ListServiceQuotas")
    const services = new Set(QUOTA_TARGETS.map((t) => t.serviceCode))
    expect(listings).toHaveLength(services.size)
    expect(listings.length).toBeLessThan(QUOTA_TARGETS.length)
    // And no per-quota call at all when the listing answered every target.
    expect(calls).not.toContain("servicequotas:GetServiceQuota")
  })

  test("a listing whose pages never end stops at the cap and SAYS it was truncated", async () => {
    const calls: string[] = []
    const readings = await load({ endlessPages: ["vpc"], calls })

    const vpcService = readings.services.find((s) => s.serviceCode === "vpc")
    expect(vpcService?.completeness.kind).toBe("truncated")

    // Bounded: exactly the cap for vpc, one page each for the other services.
    const services = new Set(QUOTA_TARGETS.map((t) => t.serviceCode))
    expect(calls.filter((c) => c === "servicequotas:ListServiceQuotas")).toHaveLength(
      MAX_QUOTA_PAGES + (services.size - 1),
    )

    const text = surfaceText(readings)
    expect(text).toContain("truncated after")
    expect(text).toContain("has not been ruled out")
    // The truncation reaches the individual quota's own line, not only the
    // service row: a target's absence from a truncated listing is not a fact.
    expect(reading(readings, "vpcs-per-region").listingCompleteness.kind).toBe("truncated")
    expect(reading(readings, "ecs-services-per-cluster").listingCompleteness.kind).toBe("complete")
  })
})

/* ------------------------------------------------------------- fallback -- */

describe("a quota the listing omits is asked for individually", () => {
  test("the fallback resolves it and says which call answered", async () => {
    const calls: string[] = []
    const readings = await load({ omitCodes: ["L-9EF96962"], calls })

    expect(readings.individualReads).toBe(1)
    expect(calls.filter((c) => c === "servicequotas:GetServiceQuota")).toHaveLength(1)

    const ecs = reading(readings, "ecs-services-per-cluster")
    expect(ecs.quota.state).toBe("ACTUAL")
    if (ecs.quota.state !== "ACTUAL") throw new Error("narrowing")
    expect(ecs.quota.value.value).toBe(5000)
    expect(ecs.quota.value.provenance).toBe("servicequotas:GetServiceQuota")
    expect(surfaceText(readings)).toContain("resolved via servicequotas:GetServiceQuota")
  })

  test("a denied fallback names GetServiceQuota, not ListServiceQuotas", async () => {
    const readings = await load({ omitCodes: ["L-9EF96962"], getQuota: "denied" })
    const ecs = reading(readings, "ecs-services-per-cluster")
    expect(ecs.quota.state).toBe("DENIED")
    if (ecs.quota.state !== "DENIED") throw new Error("narrowing")
    // The action an operator has to grant is the one that was actually refused.
    expect(ecs.quota.action).toBe("servicequotas:GetServiceQuota")
    // And the rest of the estate is untouched.
    expect(reading(readings, "vpcs-per-region").quota.state).toBe("ACTUAL")
  })

  test("a code AWS does not know is an error, never a ceiling", async () => {
    const readings = await load({ omitCodes: ["L-9EF96962"], getQuota: "notfound" })
    const ecs = reading(readings, "ecs-services-per-cluster")
    expect(ecs.quota.state).toBe("ERROR")
    if (ecs.quota.state !== "ERROR") throw new Error("narrowing")
    expect(ecs.quota.code).toBe("NoSuchResourceException")
    expect(ecs.headroom.kind).toBe("not-known")
    expect(surfaceText(readings)).not.toContain("Services per cluster [ecs] — eu-west-2 (partition aws) — applied")
  })

  test("a quota code that has drifted still resolves by NAME, and says so", async () => {
    const readings = await load({ recodeAs: { "L-9EF96962": "L-CHANGED1" } })
    const ecs = reading(readings, "ecs-services-per-cluster")
    expect(ecs.quota.state).toBe("ACTUAL")
    if (ecs.quota.state !== "ACTUAL") throw new Error("narrowing")
    expect(ecs.quota.value.value).toBe(5000)
    expect(ecs.quota.value.provenance).toContain("matched on quota NAME")
    expect(ecs.quota.value.provenance).toContain("L-CHANGED1")
    // Resolving by name must not have cost an individual call.
    expect(readings.individualReads).toBe(0)
  })

  test("the individual-read cap leaves the rest UNCONFIGURED, never unlimited", async () => {
    // Thirty targets whose codes are obviously constructed and are in no AWS
    // listing, so every one falls through to the individual path.
    const synthetic: QuotaTarget[] = Array.from({ length: 30 }, (_, i) => ({
      key: `synthetic-${String(i).padStart(2, "0")}`,
      serviceCode: "vpc",
      quotaCode: `L-SYNTH${String(i).padStart(3, "0")}`,
      quotaName: `constructed target ${i}`,
      bounds: "nothing — this target exists to drive the per-load cap",
      countsArn: null,
    }))
    const calls: string[] = []
    const readings = await load({ getQuota: "notfound", calls }, { targets: synthetic })

    expect(readings.individualReads).toBe(MAX_INDIVIDUAL_QUOTA_READS)
    expect(calls.filter((c) => c === "servicequotas:GetServiceQuota")).toHaveLength(
      MAX_INDIVIDUAL_QUOTA_READS,
    )

    const past = readings.quotas.slice(MAX_INDIVIDUAL_QUOTA_READS)
    expect(past).toHaveLength(30 - MAX_INDIVIDUAL_QUOTA_READS)
    for (const q of past) {
      expect(q.quota.state).toBe("UNCONFIGURED")
      if (q.quota.state !== "UNCONFIGURED") throw new Error("narrowing")
      expect(q.quota.why).toContain("not the same as its being unlimited")
    }
  })
})

/* ---------------------------------------------------------------- usage -- */

describe("usage is a bound when it is a bound, and unknown when it is unknown", () => {
  test("the tag index gives a LOWER bound on usage and an UPPER bound on headroom", async () => {
    const readings = await load()
    const vpcs = reading(readings, "vpcs-per-region")
    expect(vpcs.usage.kind).toBe("at-least")
    if (vpcs.usage.kind !== "at-least") throw new Error("narrowing")
    expect(vpcs.usage.usedAtLeast).toBe(2)
    expect(vpcs.usage.source).toBe("tag:GetResources")

    expect(vpcs.headroom.kind).toBe("upper-bound")
    if (vpcs.headroom.kind !== "upper-bound") throw new Error("narrowing")
    expect(vpcs.headroom.applied).toBe(5)
    expect(vpcs.headroom.remainingAtMost).toBe(3)

    const text = surfaceText(readings)
    // The direction is the whole point: "at most 3 left" cannot read as
    // reassuring the way a bare "3 left" from a partial count would.
    expect(text).toContain("at least 2 of 5 used, AT MOST 3 left")
    expect(text).toContain("lower bound on usage and therefore an upper bound on headroom")
  })

  test("each countable quota counts only the ARNs of its own shape", async () => {
    const readings = await load()
    const counted: Record<string, number> = {}
    for (const q of readings.quotas) {
      if (q.usage.kind === "at-least") counted[q.key] = q.usage.usedAtLeast
    }
    expect(counted).toEqual({
      "vpcs-per-region": 2,
      "security-groups-per-region": 3,
      "ecs-services-per-cluster": 2,
      "application-load-balancers-per-region": 1,
      "target-groups-per-region": 2,
      "rds-db-instances": 1,
      "cloudfront-distributions-per-account": 1,
      "acm-certificates-per-region": 1,
      "cognito-user-pools-per-account": 1,
    })
  })

  test("a quota nothing countable maps to says so and names CloudWatch, never zero", async () => {
    const readings = await load()
    for (const key of [
      "rules-per-security-group",
      "lambda-concurrent-executions",
      "ses-daily-sending-quota",
    ]) {
      const q = reading(readings, key)
      expect(q.quota.state).toBe("ACTUAL")
      expect(q.usage.kind).toBe("not-known")
      expect(q.headroom.kind).toBe("not-known")
    }
    const lambda = reading(readings, "lambda-concurrent-executions")
    if (lambda.usage.kind !== "not-known") throw new Error("narrowing")
    expect(lambda.usage.why).toContain("cloudwatch:GetMetricData")
    // The metric AWS itself named travels with the unknown, so the grant that
    // would answer it is unambiguous.
    expect(lambda.usage.usageMetric?.metricName).toBe("ResourceCount")
    expect(lambda.usage.usageMetric?.namespace).toBe("AWS/Usage")

    const text = surfaceText(readings)
    expect(text).toContain("Unknown, not zero")
    expect(text).toContain("usage not known")
  })

  test("an exact count from a sibling reader is exact, attributed, and beats the tag index", async () => {
    const readings = await load(
      {},
      {
        usage: [
          {
            quotaKey: "application-load-balancers-per-region",
            used: 48,
            source: "loadbalancer.ts loadBalancerReadings()",
            asOf: "2026-08-13T09:14:00.000Z",
          },
        ],
      },
    )
    const albs = reading(readings, "application-load-balancers-per-region")
    expect(albs.usage.kind).toBe("known")
    if (albs.usage.kind !== "known") throw new Error("narrowing")
    expect(albs.usage.used).toBe(48)
    expect(albs.usage.source).toBe("loadbalancer.ts loadBalancerReadings()")

    expect(albs.headroom.kind).toBe("known")
    if (albs.headroom.kind !== "known") throw new Error("narrowing")
    expect(albs.headroom.remaining).toBe(2)

    const text = surfaceText(readings)
    expect(text).toContain("48 of 50 used, 2 left (96%)")
    expect(text).toContain("counted by loadbalancer.ts")
    // An exact count reads differently from a bound. Deliberately.
    expect(text).not.toContain("at least 48 of 50")
  })

  test("an observation for a key this module does not carry is dropped, not attached", async () => {
    const readings = await load(
      {},
      {
        usage: [
          { quotaKey: "not-a-target", used: 999, source: "a reader that is confused", asOf: "2026-08-13T09:14:00.000Z" },
        ],
      },
    )
    const text = surfaceText(readings)
    expect(text).not.toContain("a reader that is confused")
    // Nothing acquired an exact count: every countable quota is still a bound.
    for (const q of readings.quotas) {
      expect(q.usage.kind).not.toBe("known")
    }
  })
})

/* ------------------------------------------------------------- pressure -- */

describe("quota pressure is an incident, and its absence is qualified", () => {
  test("the healthy estate is clear, and names what it could not compare", async () => {
    const readings = await load()
    expect(readings.pressure.kind).toBe("clear")
    if (readings.pressure.kind !== "clear") throw new Error("narrowing")
    expect(readings.pressure.compared).toBe(9)
    expect(readings.pressure.usageUnknown).toEqual([
      "rules-per-security-group",
      "lambda-concurrent-executions",
      "ses-daily-sending-quota",
    ])
    expect(surfaceText(readings)).toContain("no quota pressure")
  })

  test("a quota at or past the fraction is an alarm, and it is worded as one", async () => {
    const readings = await load(
      {},
      {
        usage: [
          {
            quotaKey: "application-load-balancers-per-region",
            used: 48,
            source: "loadbalancer.ts loadBalancerReadings()",
            asOf: "2026-08-13T09:14:00.000Z",
          },
        ],
      },
    )
    expect(readings.pressure.kind).toBe("at-risk")
    if (readings.pressure.kind !== "at-risk") throw new Error("narrowing")
    expect(readings.pressure.at).toHaveLength(1)
    expect(readings.pressure.at[0].key).toBe("application-load-balancers-per-region")
    expect(readings.pressure.at[0].exact).toBe(true)
    const text = surfaceText(readings)
    expect(text).toContain("QUOTA PRESSURE")
    expect(text).toContain("a tenant's stack comes up with nothing routing traffic to it")
  })

  test("a lower-bound count can raise the alarm too, and is worded as a bound", async () => {
    // Four tagged VPCs against an applied quota of five: at least 80% used.
    const tags = {
      ...TAGGED_ESTATE,
      [arn("ec2", "vpc/vpc-0cc3")]: tenantTags("hillside-school"),
      [arn("ec2", "vpc/vpc-0dd4")]: tenantTags("eastbrook-trust"),
    }
    const readings = await load({ tags })
    expect(readings.pressure.kind).toBe("at-risk")
    if (readings.pressure.kind !== "at-risk") throw new Error("narrowing")
    const point = readings.pressure.at.find((p) => p.key === "vpcs-per-region")
    expect(point?.exact).toBe(false)
    expect(point?.usedAtLeast).toBe(4)
    expect(point?.remainingAtMost).toBe(1)
    expect(surfaceText(readings)).toContain("VPCs per Region is at least 80% used")
  })

  test("no usage anywhere is NOT clear — it says the headroom was never established", async () => {
    const readings = await load(
      {},
      {
        targets: QUOTA_TARGETS.filter((t) => t.countsArn === null),
      },
    )
    expect(readings.pressure.kind).toBe("no-usage-known")
    const text = surfaceText(readings)
    expect(text).toContain("headroom not established")
    expect(text).toContain('This is not "clear"')
    expect(text).not.toContain("no quota pressure")
  })

  test("every quota refused is unknown, and is not clear either", async () => {
    const readings = await load({ listQuotas: "denied" })
    expect(readings.pressure.kind).toBe("unknown")
    const text = surfaceText(readings)
    expect(text).toContain("nothing can be said about any ceiling")
    expect(text).not.toContain("no quota pressure")
  })
})

/* -------------------------------------------------- what is NOT claimed -- */

describe("the AWS default is never claimed", () => {
  test("every reading says the default is unreadable and names the capability", async () => {
    const readings = await load()
    for (const q of readings.quotas) {
      expect(q.defaultValue.state).toBe("NOT_READABLE")
      expect(q.defaultValue.iamAction).toBe("servicequotas:GetAWSDefaultServiceQuota")
    }
    const text = surfaceText(readings)
    expect(text).toContain("servicequotas:GetAWSDefaultServiceQuota")
    expect(text).toContain("Whether this value was raised is unknown, not 'no'")
    // The two sentences this module must never print, because it cannot know them.
    expect(text).not.toContain("at the AWS default")
    expect(text).not.toContain("raised from the default")
  })
})

/* ------------------------------------------------ region and attribution -- */

describe("region and partition come from AWS, never from a literal", () => {
  test("a regional quota reports the region its own ARN carries", async () => {
    const readings = await load()
    const vpcs = reading(readings, "vpcs-per-region")
    expect(vpcs.region).toBe(REGION)
    expect(vpcs.partition).toBe(PARTITION)
    expect(vpcs.accountId).toBe(ACCOUNT)
    const text = surfaceText(readings)
    expect(text).not.toContain("us-east-1")
  })

  test("an account-wide quota carries no region, and is not given one", async () => {
    const readings = await load()
    const cloudfront = reading(readings, "cloudfront-distributions-per-account")
    expect(cloudfront.region).toBeNull()
    expect(cloudfront.partition).toBe(PARTITION)
    if (cloudfront.quota.state !== "ACTUAL") throw new Error("narrowing")
    expect(cloudfront.quota.value.scope).toBe("ACCOUNT")
    expect(surfaceText(readings)).toContain("account-wide (partition aws)")
  })

  test("a different partition and region travel through unchanged", async () => {
    const readings = await load({
      identity: {
        arn: `arn:aws-us-gov:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
        account: ACCOUNT,
        region: "us-gov-west-1",
      },
      // The listings are refused, so nothing carries an ARN and the module must
      // fall back to the resolved identity — which is where a hardcoded region
      // would show itself.
      listQuotas: "denied",
    })
    const vpcs = reading(readings, "vpcs-per-region")
    expect(vpcs.partition).toBe("aws-us-gov")
    expect(vpcs.region).toBe("us-gov-west-1")
    if (vpcs.quota.state !== "DENIED") throw new Error("narrowing")
    expect(vpcs.quota.region).toBe("us-gov-west-1")
    expect(vpcs.quota.partition).toBe("aws-us-gov")
  })

  test("an untagged quota is shared with a reason, and a tagged one attributes", async () => {
    const readings = await load()
    const vpcs = reading(readings, "vpcs-per-region")
    expect(vpcs.attribution.kind).toBe("shared")
    if (vpcs.attribution.kind !== "shared") throw new Error("narrowing")
    // The quota carries an ARN and the tag index answered without it, so the
    // reason is the one about a ceiling nobody can own — NOT the one about an
    // ARN this engine could not state. The two are different observations.
    expect(vpcs.attribution.why).toContain("carries no tags")
    expect(vpcs.attribution.why).toContain("is not a finding")

    const tagged = await load({
      tags: {
        ...TAGGED_ESTATE,
        [quotaArn({ serviceCode: "vpc", quotaCode: "L-F678F1CE", quotaName: "", value: 0 })]:
          tenantTags("northgate-academy"),
      },
    })
    const attributed = reading(tagged, "vpcs-per-region")
    expect(attributed.attribution.kind).toBe("tenant")
    if (attributed.attribution.kind !== "tenant") throw new Error("narrowing")
    expect(attributed.attribution.tenantSlug).toBe("northgate-academy")
  })
})

/* ------------------------------------------------------- the API's shape -- */

describe("what AWS returns is read, not assumed", () => {
  test("a quota with no Adjustable is reported as NOT adjustable", async () => {
    const readings = await load(
      {},
      {
        targets: [
          {
            key: "egress-only-gateways",
            serviceCode: "vpc",
            quotaCode: "L-45FE3B85",
            quotaName: "Egress-only internet gateways per Region",
            bounds: "a tenant's IPv6 egress cannot be created",
            countsArn: null,
          },
        ],
      },
    )
    const q = reading(readings, "egress-only-gateways")
    if (q.quota.state !== "ACTUAL") throw new Error("narrowing")
    expect(q.quota.value.adjustable).toBe(false)
    expect(surfaceText(readings)).toContain("NOT adjustable")
  })

  test("a rate quota carries its period", async () => {
    const readings = await load()
    const ses = reading(readings, "ses-daily-sending-quota")
    if (ses.quota.state !== "ACTUAL") throw new Error("narrowing")
    expect(ses.quota.value.period).toEqual({ value: 1, unit: "DAY" })
    expect(surfaceText(readings)).toContain("per 1 DAY")
  })

  test("a quota answered without a Value is an ERROR, never a ceiling of zero", async () => {
    const readings = await load({ malformed: { code: "L-F678F1CE", drop: "Value" } })

    // The whole vpc listing fails, because a listing carrying a quota this
    // engine cannot read is not a listing it can stand behind.
    const vpcs = reading(readings, "vpcs-per-region")
    expect(vpcs.quota.state).toBe("ERROR")
    if (vpcs.quota.state !== "ERROR") throw new Error("narrowing")
    expect(vpcs.quota.safeDetail).toContain("without a numeric Value")
    expect(vpcs.headroom.kind).toBe("not-known")

    const text = surfaceText(readings)
    // The two numbers a defaulting parser would have invented, and what each
    // would have meant: an estate that can create nothing, or one that never
    // runs out.
    expect(text).not.toContain("applied 0")
    expect(text).not.toContain("applied Infinity")
    // And every other service is untouched.
    expect(reading(readings, "ecs-services-per-cluster").quota.state).toBe("ACTUAL")
  })

  test("a quota answered without a QuotaCode is an ERROR, not rendered unidentified", async () => {
    const readings = await load({ malformed: { code: "L-F678F1CE", drop: "QuotaCode" } })
    const vpcs = reading(readings, "vpcs-per-region")
    expect(vpcs.quota.state).toBe("ERROR")
    if (vpcs.quota.state !== "ERROR") throw new Error("narrowing")
    expect(vpcs.quota.safeDetail).toContain("no QuotaCode or QuotaName")
  })

  test("an as-of timestamp and the capability's own cadence are carried", async () => {
    const readings = await load()
    expect(readings.asOf).toBe("2026-08-13T09:15:00.000Z")
    expect(readings.refreshMs.listing).toBe(6 * 3_600_000)
    expect(readings.refreshMs.individual).toBe(6 * 3_600_000)
    expect(surfaceText(readings)).toContain("refreshed every 21600s")
  })
})

/* --------------------------------------------------------- pure helpers -- */

describe("the joins these readings depend on", () => {
  test("parseArn keeps a resource's colons and does not assume a partition", () => {
    expect(parseArn(`arn:aws-cn:rds:cn-north-1:${ACCOUNT}:db:tenure-prod`)).toEqual({
      partition: "aws-cn",
      service: "rds",
      region: "cn-north-1",
      accountId: ACCOUNT,
      resource: "db:tenure-prod",
    })
    expect(parseArn("not-an-arn")).toBeNull()
  })

  test("resolveFromListing prefers the code and falls back to the exact name", () => {
    const target = QUOTA_TARGETS[0]
    const byName = resolveFromListing(target, [
      {
        serviceCode: "vpc",
        serviceName: "VPC",
        quotaCode: "L-DIFFERENT",
        quotaName: target.quotaName,
        arn: null,
        value: 5,
        unit: null,
        adjustable: true,
        scope: "REGION",
        period: null,
        usageMetric: null,
        provenance: "fixture",
      },
    ])
    expect(byName?.provenance).toContain("matched on quota NAME")
    expect(resolveFromListing(target, [])).toBeNull()
  })

  test("headroomOf refuses to turn a bound into a number", () => {
    const quota = {
      state: "ACTUAL" as const,
      capability: "servicequotas:ListServiceQuotas" as const,
      asOf: "2026-08-13T09:15:00.000Z",
      fresh: true,
      value: {
        serviceCode: "vpc",
        serviceName: "VPC",
        quotaCode: "L-F678F1CE",
        quotaName: "VPCs per Region",
        arn: null,
        value: 5,
        unit: null,
        adjustable: true,
        scope: "REGION" as const,
        period: null,
        usageMetric: null,
        provenance: "fixture",
      },
    }
    expect(
      headroomOf(quota, { kind: "at-least", usedAtLeast: 4, source: "tag:GetResources", why: "…" }),
    ).toEqual({
      kind: "upper-bound",
      applied: 5,
      usedAtLeast: 4,
      remainingAtMost: 1,
      utilisationAtLeast: 0.8,
    })
  })
})
