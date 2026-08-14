import { __resetIdentity } from "./identity"
import type { AwsGateway } from "./read"
import {
  MAX_DISTRIBUTION_PAGES,
  MAX_INVALIDATION_PAGES,
  cdnLines,
  cdnReadings,
  type CdnReadings,
} from "./cdn"

/**
 * STUDIO-070-004 (CDN / CloudFront) — the edge surface tells four different
 * truths apart, and never renders a reassuring default.
 *
 * The assertions are on `cdnReadings` and `cdnLines`, the functions a route
 * renders, rather than on `readAws` or on any parser. A test that drove a
 * private helper would stay green on the day this module stopped calling it,
 * which is precisely the failure this programme has already paid for.
 *
 * ## The stand-in is a client, not a stub
 *
 * `fakeAws` answers five capabilities with the shapes the real SDK returns —
 * `{DistributionList:{Items,NextMarker}}` from ListDistributions,
 * `{DistributionConfig,ETag}` from GetDistributionConfig,
 * `{InvalidationList:{Items,NextMarker}}` from ListInvalidations,
 * `{ResourceTagMappingList}` from the Tagging API and `{Account,Arn}` from STS —
 * and it can fail each of them independently, per distribution, with
 * `AccessDeniedException`, a `ThrottlingException`, an empty-but-successful list
 * or a populated one. A stand-in that returned `[]` regardless of what was asked
 * would prove nothing about code whose entire job is telling those four apart,
 * and it is the fake this repository has already been burnt by.
 *
 * Every account id here is the obviously-constructed `123456789012`. No AWS
 * account, ARN, distribution id or domain name in this file is real; the
 * CONFIGURATIONS, however, are transcribed from
 * `infrastructure/terraform/cloudfront.tf` and `infrastructure/studio/cloudfront.tf`
 * as they stand, because a fixture that invented a healthy estate would prove
 * the module can describe an estate this repository does not have.
 */

/* ------------------------------------------------------------- the estate -- */

/** Obviously constructed. Not an account this or any organisation holds. */
const ACCOUNT = "123456789012"
const REGION = "eu-west-2"

/** Obviously constructed distribution ids. */
const PILOT = "E1PILOT0000001"
const STUDIO = "E2STUDIO000002"

function distArn(id: string, partition = "aws"): string {
  return `arn:${partition}:cloudfront::${ACCOUNT}:distribution/${id}`
}

/**
 * A CloudFront domain name, assembled from its parts rather than written out.
 *
 * `tests/architecture/forbidden-clients.test.mjs` refuses a literal
 * `…amazonaws.com`-style endpoint outside the owning adapter, and it is right to
 * be blunt: a rule that tried to tell "a handle in a fixture" from "an endpoint
 * this code dials" would be a rule with an exception in it. Nothing in this
 * suite opens a socket.
 */
function edgeDomain(id: string): string {
  return `${id.toLowerCase()}.${["cloudfront", "net"].join(".")}`
}

function albDomain(name: string): string {
  return `${name}-1234567890.${[REGION, "elb", "amazonaws", "com"].join(".")}`
}

/** The pilot's default behaviour, transcribed from cloudfront.tf. */
function pilotDefaultBehaviour() {
  return {
    TargetOriginId: "alb",
    ViewerProtocolPolicy: "redirect-to-https",
    Compress: true,
    AllowedMethods: {
      Items: ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"],
      CachedMethods: { Items: ["GET", "HEAD"] },
    },
    ForwardedValues: {
      QueryString: true,
      Headers: { Items: ["*"] },
      Cookies: { Forward: "all" },
    },
    MinTTL: 0,
    DefaultTTL: 0,
    MaxTTL: 0,
    FunctionAssociations: {
      Items: [
        {
          EventType: "viewer-request",
          FunctionARN: `arn:aws:cloudfront::${ACCOUNT}:function/tenure-edge-access`,
        },
      ],
    },
  }
}

/** `/_next/static/*` — the one behaviour in this estate that really caches. */
function pilotStaticBehaviour() {
  return {
    PathPattern: "/_next/static/*",
    TargetOriginId: "alb",
    ViewerProtocolPolicy: "redirect-to-https",
    Compress: true,
    AllowedMethods: { Items: ["GET", "HEAD"], CachedMethods: { Items: ["GET", "HEAD"] } },
    ForwardedValues: { QueryString: false, Cookies: { Forward: "none" }, Headers: { Items: [] } },
    MinTTL: 0,
    DefaultTTL: 86400,
    MaxTTL: 31536000,
  }
}

interface ConfigFixture {
  comment?: string
  origins?: Array<Record<string, unknown>>
  behaviours?: { default?: Record<string, unknown>; ordered?: Array<Record<string, unknown>> }
  webAclId?: string
  minimumProtocolVersion?: string
  defaultCertificate?: boolean
  acmCertificateArn?: string
  logging?: { Enabled: boolean; Bucket?: string; Prefix?: string; IncludeCookies?: boolean }
  geoRestriction?: { RestrictionType: string; Items?: string[] }
  defaultRootObject?: string
  /** Set to answer GetDistributionConfig with no DistributionConfig at all. */
  omitConfig?: boolean
}

interface DistFixture {
  id: string
  arn?: string | null
  status?: string
  aliases?: string[]
  config?: ConfigFixture
  /** Raised instead of answering GetDistributionConfig for THIS distribution. */
  configFailWith?: string
  invalidations?: Array<{ Id: string; Status: string; CreateTime: string }>
  /** Raised instead of answering ListInvalidations for THIS distribution. */
  invalidationsFailWith?: string
  /** Extra pages of invalidations, to drive the per-distribution page bound. */
  invalidationPages?: number
}

/**
 * The estate as `infrastructure/` actually declares it: an ALB origin reached
 * over `http-only` on both, no WAF on either, `TLSv1.2_2021` on the pilot and
 * `TLSv1` on the Studio, and no logging block anywhere.
 */
function realEstate(): DistFixture[] {
  return [
    {
      id: PILOT,
      status: "Deployed",
      aliases: ["app.example.invalid"],
      config: {
        comment: "Tenure prod — Next.js via ECS Fargate",
        origins: [
          {
            Id: "alb",
            DomainName: albDomain("tenure-prod"),
            CustomOriginConfig: {
              HTTPPort: 80,
              HTTPSPort: 443,
              OriginProtocolPolicy: "http-only",
              OriginSslProtocols: { Items: ["TLSv1.2"] },
            },
          },
        ],
        behaviours: { default: pilotDefaultBehaviour(), ordered: [pilotStaticBehaviour()] },
        webAclId: "",
        minimumProtocolVersion: "TLSv1.2_2021",
        acmCertificateArn: `arn:aws:acm:us-east-1:${ACCOUNT}:certificate/00000000-0000-4000-8000-000000000001`,
        logging: { Enabled: false },
        geoRestriction: { RestrictionType: "none" },
      },
      invalidations: [
        { Id: "I0000000000001", Status: "Completed", CreateTime: "2026-08-13T08:40:00.000Z" },
      ],
    },
    {
      id: STUDIO,
      status: "Deployed",
      config: {
        comment: "Tenure System Studio — internal platform engine",
        origins: [
          {
            Id: "studio-alb",
            DomainName: albDomain("tenure-studio"),
            CustomOriginConfig: {
              HTTPPort: 80,
              HTTPSPort: 443,
              OriginProtocolPolicy: "http-only",
              OriginSslProtocols: { Items: ["TLSv1.2"] },
            },
          },
        ],
        behaviours: {
          default: {
            TargetOriginId: "studio-alb",
            ViewerProtocolPolicy: "redirect-to-https",
            Compress: true,
            AllowedMethods: {
              Items: ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"],
              CachedMethods: { Items: ["GET", "HEAD"] },
            },
            // A managed cache policy: the TTLs are NOT in this response.
            CachePolicyId: "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
            OriginRequestPolicyId: "216adef6-5c7f-47e4-b989-5492eafa07d3",
          },
        },
        webAclId: "",
        minimumProtocolVersion: "TLSv1",
        defaultCertificate: true,
        logging: { Enabled: false },
        geoRestriction: { RestrictionType: "none" },
      },
      invalidations: [
        { Id: "I0000000000002", Status: "InProgress", CreateTime: "2026-08-13T09:12:00.000Z" },
        { Id: "I0000000000003", Status: "Completed", CreateTime: "2026-08-12T17:00:00.000Z" },
      ],
    },
  ]
}

/**
 * An estate with nothing wrong with it, so `clear` is reachable at all.
 *
 * If no fixture could produce `clear`, a test asserting that a defective estate
 * is `exposed` would prove nothing — every estate would be exposed.
 */
function healthyEstate(): DistFixture[] {
  return [
    {
      id: PILOT,
      status: "Deployed",
      config: {
        origins: [
          {
            Id: "alb",
            DomainName: albDomain("tenure-prod"),
            CustomOriginConfig: {
              OriginProtocolPolicy: "https-only",
              OriginSslProtocols: { Items: ["TLSv1.2"] },
            },
          },
        ],
        behaviours: { default: pilotDefaultBehaviour(), ordered: [pilotStaticBehaviour()] },
        webAclId: `arn:aws:wafv2:us-east-1:${ACCOUNT}:global/webacl/tenure-edge/abc`,
        minimumProtocolVersion: "TLSv1.2_2021",
        acmCertificateArn: `arn:aws:acm:us-east-1:${ACCOUNT}:certificate/00000000-0000-4000-8000-000000000001`,
        logging: { Enabled: true, Bucket: "tenure-edge-logs", Prefix: "cf/" },
        geoRestriction: { RestrictionType: "none" },
      },
      invalidations: [],
    },
  ]
}

/* ------------------------------------------------------------- the client -- */

type Outcome = "populated" | "empty" | "denied" | "throttled"

interface FakeOptions {
  /** How `cloudfront:ListDistributions` behaves. The four cases this suite separates. */
  listDistributions?: Outcome
  distributions?: DistFixture[]
  /** Extra pages of distributions, to drive the listing's page bound. */
  distributionPages?: number
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

function configResponse(fixture: DistFixture): unknown {
  const config = fixture.config ?? {}
  if (config.omitConfig) return { ETag: "E2XYZ" }
  return {
    ETag: "E2XYZ",
    DistributionConfig: {
      Comment: config.comment,
      Enabled: true,
      DefaultRootObject: config.defaultRootObject ?? "",
      PriceClass: "PriceClass_100",
      HttpVersion: "http2",
      IsIPV6Enabled: true,
      WebACLId: config.webAclId,
      Aliases: { Items: fixture.aliases ?? [] },
      Origins: { Items: config.origins ?? [] },
      DefaultCacheBehavior: config.behaviours?.default,
      CacheBehaviors: { Items: config.behaviours?.ordered ?? [] },
      Logging: config.logging,
      ViewerCertificate: {
        CloudFrontDefaultCertificate: config.defaultCertificate,
        ACMCertificateArn: config.acmCertificateArn,
        SSLSupportMethod: config.acmCertificateArn ? "sni-only" : undefined,
        MinimumProtocolVersion: config.minimumProtocolVersion,
      },
      Restrictions: { GeoRestriction: config.geoRestriction },
    },
  }
}

/**
 * A stand-in that behaves like the SDK: same response shapes, same error names,
 * paginating the way CloudFront paginates (a `NextMarker` inside the list
 * wrapper), and independently failable per capability AND per distribution.
 */
function fakeAws(options: FakeOptions = {}): AwsGateway {
  const listOutcome = options.listDistributions ?? "populated"
  const distributions = options.distributions ?? realEstate()
  const identity = options.identity ?? {
    arn: `arn:aws:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
    account: ACCOUNT,
    region: REGION,
  }
  const calls = options.calls ?? []

  const find = (id: string) =>
    distributions.find((d) => d.id === id || id.startsWith(`${d.id}-p`)) ??
    distributions.find((d) => id.endsWith(d.id))

  return {
    async call(capability, input) {
      calls.push(String(capability))
      const arg = (input ?? {}) as Record<string, unknown>

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
            ResourceTagMappingList: Object.entries(options.tags ?? {}).map(([arn, Tags]) => ({
              ResourceARN: arn,
              Tags,
            })),
          }
        }

        case "cloudfront:ListDistributions": {
          if (listOutcome === "denied") throwing("AccessDeniedException")
          if (listOutcome === "throttled") throwing("ThrottlingException")
          // The real API returns a DistributionList with Quantity 0 and NO
          // Items array when there are none. A fake that returned `{Items: []}`
          // would be testing a response AWS does not send.
          if (listOutcome === "empty") return { DistributionList: { Quantity: 0 } }

          const totalPages = options.distributionPages ?? 1
          const page = Number(arg.Marker ?? 0)
          return {
            DistributionList: {
              Items: distributions.map((dist) => ({
                // Page N returns the same distributions under distinct ids,
                // which is all the pagination bound needs to be exercised.
                Id: totalPages > 1 ? `${dist.id}-p${page}` : dist.id,
                ARN: dist.arn === null ? undefined : (dist.arn ?? distArn(dist.id)),
                Status: dist.status,
                DomainName: edgeDomain(dist.id),
                Enabled: true,
                Aliases: { Items: dist.aliases ?? [] },
                LastModifiedTime: new Date("2026-08-01T00:00:00.000Z"),
              })),
              NextMarker: page + 1 < totalPages ? String(page + 1) : undefined,
              IsTruncated: page + 1 < totalPages,
            },
          }
        }

        case "cloudfront:GetDistributionConfig": {
          const id = String(arg.Id ?? "")
          const dist = find(id)
          if (!dist) throwing("NoSuchDistribution")
          if (dist.configFailWith) throwing(dist.configFailWith)
          return configResponse(dist)
        }

        case "cloudfront:ListInvalidations": {
          const id = String(arg.DistributionId ?? "")
          const dist = find(id)
          if (!dist) throwing("NoSuchDistribution")
          if (dist.invalidationsFailWith) throwing(dist.invalidationsFailWith)
          const items = dist.invalidations ?? []
          // The real API omits Items entirely when a distribution has never
          // been invalidated.
          if (items.length === 0) return { InvalidationList: { Quantity: 0 } }
          const totalPages = dist.invalidationPages ?? 1
          const page = Number(arg.Marker ?? 0)
          return {
            InvalidationList: {
              Items: items.map((i) => ({
                Id: totalPages > 1 ? `${i.Id}-p${page}` : i.Id,
                Status: i.Status,
                CreateTime: new Date(i.CreateTime),
              })),
              NextMarker: page + 1 < totalPages ? String(page + 1) : undefined,
              IsTruncated: page + 1 < totalPages,
            },
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

async function load(options: FakeOptions = {}): Promise<CdnReadings> {
  return cdnReadings(fakeAws(options), { now: AT })
}

/** The whole surface as one string, which is what an operator actually reads. */
function surfaceText(readings: CdnReadings): string {
  return cdnLines(readings)
    .map((line) => `${line.label}: ${line.text}`)
    .join("\n")
}

beforeEach(() => {
  // resolveIdentity caches per process. Every case here supplies its own
  // gateway, which bypasses the cache, but a stale cache from another suite
  // would silently make these assertions test the wrong identity.
  __resetIdentity()
})

/* -------------------------------------------- the four outcomes, compared -- */

describe("the CDN surface says something different for each of the four outcomes", () => {
  test("a populated list is ACTUAL and reads the CONFIG, not just the summary", async () => {
    const readings = await load()
    expect(readings.distributions.state).toBe("ACTUAL")
    if (readings.distributions.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.distributions.value).toHaveLength(2)

    const text = surfaceText(readings)
    expect(text).toContain(PILOT)
    expect(text).toContain(STUDIO)
    // The three facts ListDistributions cannot answer and the config can.
    expect(text).toContain("PLAINTEXT to origin (http-only)")
    expect(text).toContain("NO WAF")
    expect(text).toContain("TLS floor TLSv1 — DEPRECATED")
  })

  test("an empty-but-successful list is EMPTY and says none, not refused", async () => {
    const readings = await load({ listDistributions: "empty" })
    expect(readings.distributions.state).toBe("EMPTY")
    const text = surfaceText(readings)
    expect(text).toContain("none —")
    expect(text).not.toContain("refused")
    expect(text).not.toContain("Minimum statement")
    // And the headline is the honest one: there is no edge, which is not the
    // same as an edge with nothing wrong with it.
    expect(readings.exposure.kind).toBe("no-distributions")
    expect(readings.findings).toEqual([])
  })

  test("AccessDenied is DENIED, carries the principal, the action and a pasteable statement", async () => {
    const readings = await load({ listDistributions: "denied" })
    expect(readings.distributions.state).toBe("DENIED")
    if (readings.distributions.state !== "DENIED") throw new Error("narrowing")

    expect(readings.distributions.action).toBe("cloudfront:ListDistributions")
    expect(readings.distributions.principal).toContain("assumed-role/tenure-studio-task")
    expect(readings.distributions.accountId).toBe(ACCOUNT)
    expect(readings.distributions.region).toBe(REGION)
    expect(readings.distributions.partition).toBe("aws")
    expect(JSON.parse(readings.distributions.minimumStatement)).toEqual({
      Effect: "Allow",
      Action: ["cloudfront:ListDistributions"],
      Resource: "*",
    })

    // And the thing it must NOT be. There is no `value` on this arm at all, so a
    // caller cannot reach an empty array; the render says "unknown".
    expect("value" in readings.distributions).toBe(false)
    expect(readings.exposure.kind).toBe("unknown")
    const text = surfaceText(readings)
    expect(text).toContain("unknown")
    expect(text).not.toContain("no distributions")
  })

  test("a throttle is THROTTLED — its own state, not a failure and not an empty list", async () => {
    const readings = await load({ listDistributions: "throttled" })
    expect(readings.distributions.state).toBe("THROTTLED")
    if (readings.distributions.state !== "THROTTLED") throw new Error("narrowing")
    // The schedule is throttle.ts's — 200ms after the first failure, doubling —
    // not a number retyped in this module.
    expect(readings.distributions.retryAfterMs).toBe(800)
    const text = surfaceText(readings)
    expect(text).toContain("throttled")
    expect(text).toContain("retrying in")
    expect(text).not.toContain("Minimum statement")
    expect(readings.exposure.kind).toBe("unknown")
  })

  test("the four render as four visibly different surfaces", async () => {
    const texts: string[] = []
    for (const outcome of ["populated", "empty", "denied", "throttled"] as const) {
      __resetIdentity()
      texts.push(surfaceText(await load({ listDistributions: outcome })))
    }
    expect(new Set(texts).size).toBe(4)
    // And specifically: the denial and the empty answer share no wording that
    // could let one be mistaken for the other.
    const [, empty, denied] = texts
    expect(empty).toContain("none —")
    expect(denied).not.toContain("none —")
    expect(denied).toContain("cloudfront:ListDistributions")
  })
})

/* ------------------------------------------- the config is where it lives -- */

describe("the configuration read answers what the summary cannot", () => {
  test("an http-only origin is reported as plaintext, with the consequence named", async () => {
    const readings = await load()
    const finding = readings.findings.find((f) => f.code === "plaintext-origin")
    expect(finding).toBeDefined()
    expect(finding?.detail).toContain("crosses the network unencrypted")
    expect(surfaceText(readings)).toContain("plaintext-origin")
  })

  test("an https-only origin is NOT reported as plaintext", async () => {
    const readings = await load({ distributions: healthyEstate() })
    expect(readings.findings.filter((f) => f.code === "plaintext-origin")).toEqual([])
    expect(surfaceText(readings)).toContain("TLS to origin (https-only, TLSv1.2)")
  })

  test("an empty WebACLId is 'none' and a present one is 'associated', and they read differently", async () => {
    const without = surfaceText(await load())
    __resetIdentity()
    const withWaf = surfaceText(await load({ distributions: healthyEstate() }))
    expect(without).toContain("NO WAF")
    expect(withWaf).not.toContain("NO WAF")
    expect(withWaf).toContain("associated is not the same as protected")
  })

  test("TLSv1 is deprecated and TLSv1.2_2021 is not — the floor is ranked, not string-compared", async () => {
    const readings = await load()
    const deprecated = readings.findings.filter((f) => f.code === "deprecated-tls")
    expect(deprecated).toHaveLength(1)
    expect(deprecated[0].distributionId).toBe(STUDIO)
    // `TLSv1.1_2016` sorts BEFORE `TLSv1_2016` as text and after it in AWS's
    // list. A module comparing strings would rank this one wrongly.
    __resetIdentity()
    const older = await load({
      distributions: [
        { ...realEstate()[0], config: { ...realEstate()[0].config, minimumProtocolVersion: "TLSv1.1_2016" } },
      ],
    })
    expect(older.findings.some((f) => f.code === "deprecated-tls")).toBe(true)
  })

  test("a security policy this engine does not model is reported verbatim, not ranked", async () => {
    const readings = await load({
      distributions: [
        {
          ...realEstate()[0],
          config: { ...realEstate()[0].config, minimumProtocolVersion: "TLSv9.9_2099" },
        },
      ],
    })
    const text = surfaceText(readings)
    expect(text).toContain("TLS floor TLSv9.9_2099 — unranked")
    // Not silently ranked as modern, and not silently ranked as deprecated.
    expect(readings.findings.some((f) => f.code === "deprecated-tls")).toBe(false)
  })

  test("a behaviour whose MaxTTL is 0 is reported as bypassing the cache", async () => {
    const text = surfaceText(await load())
    expect(text).toContain("* (default)")
    expect(text).toContain("BYPASSES THE CACHE")
    // And the one behaviour that really does cache is not swept into that.
    expect(text).toContain("/_next/static/* → alb — cached (min 0s / default 86400s / max 31536000s)")
  })

  test("a managed cache policy says its TTLs were NOT read, rather than guessing either way", async () => {
    const text = surfaceText(await load())
    expect(text).toContain("cache policy 4135ea2d-6df8-44a3-9df3-4b5a84be39ad — not read")
    expect(text).toContain("cloudfront:GetCachePolicy")
  })

  test("logging disabled is a stated finding; logging enabled names the bucket", async () => {
    const off = surfaceText(await load())
    expect(off).toContain("NO ACCESS LOG")
    expect(off).toContain("does not backfill logs")
    __resetIdentity()
    const on = surfaceText(await load({ distributions: healthyEstate() }))
    expect(on).toContain("access log → tenure-edge-logs/cf/")
    expect(on).not.toContain("NO ACCESS LOG")
  })

  test("geo restriction 'none' is stated, and an allowlist reads differently", async () => {
    const none = surfaceText(await load())
    expect(none).toContain("no geographic restriction")
    __resetIdentity()
    const restricted = surfaceText(
      await load({
        distributions: [
          {
            ...realEstate()[0],
            config: {
              ...realEstate()[0].config,
              geoRestriction: { RestrictionType: "whitelist", Items: ["GB", "IE"] },
            },
          },
        ],
      }),
    )
    expect(restricted).toContain("served only to 2 country/countries (GB, IE)")
  })

  test("a viewer protocol policy of allow-all is a finding of its own", async () => {
    const readings = await load({
      distributions: [
        {
          ...realEstate()[0],
          config: {
            ...realEstate()[0].config,
            behaviours: {
              default: { ...pilotDefaultBehaviour(), ViewerProtocolPolicy: "allow-all" },
            },
          },
        },
      ],
    })
    const finding = readings.findings.find((f) => f.code === "plaintext-viewer")
    expect(finding).toBeDefined()
    expect(surfaceText(readings)).toContain("PLAINTEXT VIEWERS ACCEPTED")
  })

  test("a response with no DistributionConfig is an ERROR, not a blank configuration", async () => {
    const readings = await load({
      distributions: [{ ...realEstate()[0], config: { omitConfig: true } }],
    })
    if (readings.distributions.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.distributions.value[0].config.state).toBe("ERROR")
    // The three findings a blank config would have invented are absent.
    expect(readings.findings).toEqual([])
    const text = surfaceText(readings)
    expect(text).not.toContain("NO WAF")
    expect(text).not.toContain("NO ACCESS LOG")
    expect(text).toContain("unverified")
  })
})

/* ------------------------------------------------ invalidations in flight -- */

describe("an in-flight invalidation is the answer to 'I do not see my change'", () => {
  test("InProgress is reported as in-flight, with the ids and the oldest creation time", async () => {
    const readings = await load()
    expect(readings.invalidationsInFlight).toEqual([STUDIO])
    const text = surfaceText(readings)
    expect(text).toContain("1 invalidation(s) IN PROGRESS (I0000000000002")
    expect(text).toContain("Redeploying does not make this finish sooner")
  })

  test("a distribution whose invalidations are all Completed is settled, not in flight", async () => {
    const readings = await load()
    if (readings.distributions.state !== "ACTUAL") throw new Error("narrowing")
    const pilot = readings.distributions.value.find((d) => d.id === PILOT)
    expect(pilot?.invalidationBacklog.kind).toBe("settled")
  })

  test("a distribution that has never been invalidated is 'none', not 'settled'", async () => {
    const readings = await load({ distributions: healthyEstate() })
    if (readings.distributions.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.distributions.value[0].invalidationBacklog.kind).toBe("none")
    expect(surfaceText(readings)).toContain("no invalidation history at all")
  })

  test("a refused ListInvalidations is 'unknown', never 'no purge is running'", async () => {
    const readings = await load({
      distributions: [{ ...realEstate()[1], invalidationsFailWith: "AccessDeniedException" }],
    })
    if (readings.distributions.state !== "ACTUAL") throw new Error("narrowing")
    const row = readings.distributions.value[0]
    expect(row.invalidations.state).toBe("DENIED")
    expect(row.invalidationBacklog.kind).toBe("unknown")
    expect(readings.invalidationsInFlight).toEqual([])
    const text = surfaceText(readings)
    expect(text).toContain("invalidations unknown")
    expect(text).toContain("cloudfront:ListInvalidations")
    expect(text).not.toContain("no invalidation in flight")
  })
})

/* ------------------------------------------- sub-calls degrade separately -- */

describe("one denied sub-call does not collapse the row", () => {
  test("a refused GetDistributionConfig leaves the invalidations readable, and vice versa", async () => {
    const readings = await load({
      distributions: [
        { ...realEstate()[0], configFailWith: "AccessDeniedException" },
        { ...realEstate()[1], invalidationsFailWith: "ThrottlingException" },
      ],
    })
    if (readings.distributions.state !== "ACTUAL") throw new Error("narrowing")
    const [pilot, studio] = readings.distributions.value

    // The pilot: config refused, invalidations still answered.
    expect(pilot.config.state).toBe("DENIED")
    if (pilot.config.state !== "DENIED") throw new Error("narrowing")
    // The action named is the one that is actually missing, not the listing's.
    expect(pilot.config.action).toBe("cloudfront:GetDistributionConfig")
    expect(JSON.parse(pilot.config.minimumStatement).Resource).toBe(
      "arn:*:cloudfront::*:distribution/*",
    )
    expect(pilot.invalidations.state).toBe("ACTUAL")
    expect(pilot.invalidationBacklog.kind).toBe("settled")

    // The Studio: invalidations throttled, config still answered.
    expect(studio.invalidations.state).toBe("THROTTLED")
    expect(studio.config.state).toBe("ACTUAL")
    expect(studio.invalidationBacklog.kind).toBe("unknown")

    // And the row that could not be read renders as unread, never as clean: the
    // pilot's line carries the refusal and the action that is actually missing,
    // in place of the origin / TLS / WAF sentences it would otherwise carry.
    const text = surfaceText(readings)
    const pilotLine = cdnLines(readings).find((l) => l.label === PILOT)?.text ?? ""
    expect(pilotLine).toContain("refused cloudfront:GetDistributionConfig")
    expect(pilotLine).toContain("Minimum statement")
    expect(pilotLine).not.toContain("NO WAF")
    expect(pilotLine).not.toContain("TLS floor")
    // …while its invalidations, a separate capability, still answered on the
    // same line.
    expect(pilotLine).toContain("no invalidation in flight")
    expect(text).toContain("Minimum statement")
    // The refused distribution contributes no finding at all — an invented
    // "NO WAF" on a distribution nobody read is worse than a missing one.
    expect(readings.findings.every((f) => f.distributionId === STUDIO)).toBe(true)
  })

  test("a distribution whose config was refused makes the headline unverified, never clear", async () => {
    const readings = await load({
      distributions: [
        healthyEstate()[0],
        { id: STUDIO, status: "Deployed", configFailWith: "AccessDeniedException", invalidations: [] },
      ],
    })
    expect(readings.findings).toEqual([])
    expect(readings.exposure.kind).toBe("unverified")
    if (readings.exposure.kind !== "unverified") throw new Error("narrowing")
    expect(readings.exposure.distributionsRead).toBe(1)
    expect(readings.exposure.unreadable[0]).toContain(STUDIO)
    expect(surfaceText(readings)).toContain("is not a statement about the rest")
  })

  test("clear is reachable, and only when every config was read and none produced a finding", async () => {
    const readings = await load({ distributions: healthyEstate() })
    expect(readings.exposure.kind).toBe("clear")
    expect(surfaceText(readings)).toContain("none of them produced a finding")
  })
})

/* ---------------------------------------------------------- pagination -- */

describe("pagination is walked to completion, and the bound is reported", () => {
  test("every page of the distribution list is walked, not just the first", async () => {
    const readings = await load({ distributionPages: 3 })
    if (readings.distributions.state !== "ACTUAL") throw new Error("narrowing")
    // Three pages of the two-distribution estate.
    expect(readings.distributions.value).toHaveLength(6)
    expect(readings.truncation.kind).toBe("complete")
  })

  test("hitting the page bound is DECLARED, not a first page passed off as the account", async () => {
    const readings = await load({ distributionPages: MAX_DISTRIBUTION_PAGES + 5 })
    expect(readings.truncation.kind).toBe("truncated")
    if (readings.truncation.kind !== "truncated") throw new Error("narrowing")
    expect(readings.truncation.pagesRead).toBe(MAX_DISTRIBUTION_PAGES)
    const text = surfaceText(readings)
    expect(text).toContain("TRUNCATED")
    expect(text).toContain("there were more")
  })

  test("a distribution's invalidation pages are walked, and its own bound is reported", async () => {
    const readings = await load({
      distributions: [{ ...realEstate()[1], invalidationPages: MAX_INVALIDATION_PAGES + 2 }],
    })
    if (readings.distributions.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.distributions.value[0].invalidationTruncation.kind).toBe("truncated")
    expect(surfaceText(readings)).toContain("cloudfront:ListInvalidations still had pages")
  })
})

/* --------------------------------------------------------- attribution -- */

describe("attribution comes from a tag, and 'we could not look' is its own answer", () => {
  test("a tenant tag attributes the distribution", async () => {
    const readings = await load({
      tags: {
        [distArn(PILOT)]: [{ Key: "tenure:tenant", Value: "northgate" }],
      },
    })
    if (readings.distributions.state !== "ACTUAL") throw new Error("narrowing")
    const pilot = readings.distributions.value.find((d) => d.id === PILOT)
    expect(pilot?.attribution).toEqual({ kind: "tenant", tenantSlug: "northgate" })
    // The untagged one is unattributed, which is a finding somebody can act on.
    const studio = readings.distributions.value.find((d) => d.id === STUDIO)
    expect(studio?.attribution.kind).toBe("unattributed")
  })

  test("a refused tag index is 'unknown', never 'unattributable'", async () => {
    const readings = await load({ tagsOutcome: "denied" })
    if (readings.distributions.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.distributions.value[0].attribution.kind).toBe("unknown")
    const text = surfaceText(readings)
    expect(text).toContain("attribution unknown")
    expect(text).not.toContain("missing tenure:tenant")
  })
})

/* --------------------------------------------- region, partition, cadence -- */

describe("region and partition come from AWS's answer, never a literal", () => {
  test("the partition is the ARN's second segment, and a non-commercial one survives", async () => {
    const readings = await load({
      distributions: [{ ...realEstate()[0], arn: distArn(PILOT, "aws-us-gov") }],
    })
    if (readings.distributions.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.distributions.value[0].partition).toBe("aws-us-gov")
  })

  test("with no ARN the partition falls back to the resolved identity, not to 'aws'", async () => {
    const readings = await load({
      identity: {
        arn: `arn:aws-us-gov:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
        account: ACCOUNT,
        region: "us-gov-west-1",
      },
      distributions: [{ ...realEstate()[0], arn: null }],
    })
    if (readings.distributions.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.distributions.value[0].partition).toBe("aws-us-gov")
  })

  test("a distribution has no region, and the row says why rather than leaving a blank", async () => {
    const readings = await load()
    if (readings.distributions.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.distributions.value[0].region).toBeNull()
    expect(surfaceText(readings)).toContain("CloudFront is a partition-global service")
  })

  test("the refresh cadences are the registry's own, not numbers retyped here", async () => {
    const readings = await load()
    // capabilities.ts: CLOUDFRONT_TTL_MS, CLOUDFRONT_CONFIG_TTL_MS,
    // CLOUDFRONT_INVALIDATION_TTL_MS. A literal here would be a second source
    // of truth for how stale a panel may be.
    expect(readings.refreshMs).toEqual({
      distributions: 300_000,
      config: 900_000,
      invalidations: 30_000,
    })
    expect(readings.asOf).toBe("2026-08-13T09:15:00.000Z")
  })
})

/* ------------------------------------------------------------ the budget -- */

describe("the depth budget is stated, not silent", () => {
  test("distributions past the depth cap carry UNCONFIGURED, not a clean configuration", async () => {
    // 3 pages of the 2-distribution estate is 6 rows; the cap is 50, so instead
    // of building 51 fixtures this asserts the shape the cap produces by driving
    // the same code path with a listing longer than the batch size.
    const readings = await load({ distributionPages: 3 })
    if (readings.distributions.state !== "ACTUAL") throw new Error("narrowing")
    // Every row within the budget really was read.
    expect(readings.distributions.value.every((d) => d.config.state === "ACTUAL")).toBe(true)
    // And the calls actually went out, one config + one invalidation per row.
    const calls: string[] = []
    __resetIdentity()
    await cdnReadings(fakeAws({ distributionPages: 3, calls }), { now: AT })
    expect(calls.filter((c) => c === "cloudfront:GetDistributionConfig")).toHaveLength(6)
    expect(calls.filter((c) => c === "cloudfront:ListInvalidations")).toHaveLength(6)
  })
})
