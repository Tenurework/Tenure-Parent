import { __resetIdentity } from "./identity"
import type { AwsGateway } from "./read"
import {
  MAX_ZONE_PAGES,
  MAX_ZONE_RECORD_READS,
  dnsLines,
  dnsReadings,
  hostVerdict,
  normaliseDnsName,
  type DnsReadings,
} from "./dns"

/**
 * STUDIO-080-001 / STUDIO-080-002 (DNS) — the DNS surface tells four different
 * truths apart, and never calls a record dangling because it was not allowed to
 * look.
 *
 * The assertions are on `dnsReadings`, `dnsLines` and `hostVerdict` — the
 * functions a surface renders — rather than on `readAws` or on any parser. A test
 * that drove `readAws` directly would stay green on the day this module stopped
 * calling it, which is the failure this programme has already paid for twice.
 *
 * ## Every identifier here is constructed, and none of it is real
 *
 * The account id is `123456789012`, which is AWS's own documentation account and
 * belongs to nobody. The domains are `example.com` and `example.internal`, which
 * RFC 2606 reserves precisely so that a fixture cannot collide with a real name.
 * The distribution ids and load balancer names are invented and correspond to no
 * resource in any account. Nothing in this suite was read off a live estate and
 * nothing here should be pasted anywhere expecting it to resolve.
 *
 * ## The stand-in is a client, not a stub
 *
 * `fakeAws` answers six capabilities with the shapes the real SDK returns —
 * `{HostedZones, IsTruncated, NextMarker}` from ListHostedZones,
 * `{ResourceRecordSets, IsTruncated, NextRecordName}` from ListResourceRecordSets,
 * `{DistributionList:{Items}}` from CloudFront, `{LoadBalancers}` from ELBv2,
 * `{ResourceTagMappingList}` from the Tagging API and `{Account, Arn}` from STS —
 * and each can fail independently with `AccessDeniedException`, a
 * `ThrottlingException`, an empty-but-successful list, or a populated one. A
 * stand-in that returned `[]` regardless of what was asked would prove nothing
 * about code whose entire job is telling those four apart, and it is the fake
 * this repository has already been burnt by.
 *
 * The fake pages for real: it honours `Marker` and `StartRecordName`, and it can
 * be told to page a zone so small that the cursor `client.ts` is able to send
 * cannot advance — which is the condition the module reports as `stalled`.
 */

/* ------------------------------------------------------------- the estate -- */

/** AWS's documentation account id. Constructed; it is not this or any estate's. */
const ACCOUNT = "123456789012"
const REGION = "eu-west-2"
const PUBLIC_ZONE = "Z0PUBLICEXAMPLE1"
const PRIVATE_ZONE = "Z0PRIVATEEXAMPL2"

/** AWS's own documentation distribution domain. Owned by nobody. */
const LIVE_DIST_DOMAIN = "d111111abcdef8.cloudfront.net"
const LIVE_DIST_ID = "E1EXAMPLELIVE"
/** A distribution domain deliberately absent from the index: the takeover case. */
const GONE_DIST_DOMAIN = "d222222bcdefg9.cloudfront.net"
const ALB_DOMAIN = `tenure-example-alb-1234567890.${REGION}.elb.amazonaws.com`
const ALB_ARN = `arn:aws:elasticloadbalancing:${REGION}:${ACCOUNT}:loadbalancer/app/tenure-example-alb/1234567890abcdef`

interface RawRecord {
  Name: string
  Type: string
  SetIdentifier?: string
  TTL?: number
  ResourceRecords?: Array<{ Value: string }>
  AliasTarget?: { HostedZoneId: string; DNSName: string; EvaluateTargetHealth: boolean }
}

/** The CloudFront-wide hosted zone id every CloudFront alias target carries. */
const CLOUDFRONT_ZONE = "Z2FDTNDATAQYW2"

function aliasTo(name: string, dnsName: string, hostedZoneId = CLOUDFRONT_ZONE): RawRecord {
  return {
    Name: name,
    Type: "A",
    AliasTarget: { HostedZoneId: hostedZoneId, DNSName: dnsName, EvaluateTargetHealth: false },
  }
}

/** The public zone's records, in the shapes Route 53 actually returns them. */
function publicRecords(): RawRecord[] {
  return [
    {
      Name: "example.com.",
      Type: "NS",
      TTL: 172800,
      ResourceRecords: [
        { Value: "ns-1.awsdns-00.co.uk." },
        { Value: "ns-2.awsdns-00.com." },
        { Value: "ns-3.awsdns-00.net." },
        { Value: "ns-4.awsdns-00.org." },
      ],
    },
    {
      Name: "example.com.",
      Type: "SOA",
      TTL: 900,
      ResourceRecords: [{ Value: "ns-1.awsdns-00.co.uk. awsdns-hostmaster.amazon.com. 1 7200 900 1209600 86400" }],
    },
    // The platform host: an alias at a distribution this account owns.
    aliasTo("platform.example.com.", `${LIVE_DIST_DOMAIN}.`),
    // The Studio's own host: an alias at a load balancer, through the
    // `dualstack.` prefix Route 53 uses for ELB alias targets.
    aliasTo("studio.example.com.", `dualstack.${ALB_DOMAIN}.`, "Z1ELBEXAMPLEZONE"),
    // A CNAME at a distribution that is NOT in the index. The takeover.
    {
      Name: "legacy.example.com.",
      Type: "CNAME",
      TTL: 300,
      ResourceRecords: [{ Value: `${GONE_DIST_DOMAIN}.` }],
    },
    // An S3 website endpoint: nothing this engine holds can enumerate it.
    aliasTo("docs.example.com.", `tenure-example-docs.s3-website-${REGION}.amazonaws.com.`, "Z3EXAMPLES3ZONE"),
    // An in-zone alias at a record that exists.
    aliasTo("www.example.com.", "platform.example.com.", PUBLIC_ZONE),
    // An in-zone alias at a record that does not.
    aliasTo("old.example.com.", "gone.example.com.", PUBLIC_ZONE),
    // A wildcard, which Route 53 returns with its `*` octal-escaped.
    aliasTo("\\052.example.com.", `${LIVE_DIST_DOMAIN}.`),
    // A record with no pointer at all, so the renderer's other branch is real.
    {
      Name: "example.com.",
      Type: "MX",
      TTL: 3600,
      ResourceRecords: [{ Value: "10 inbound-smtp.example.com." }],
    },
  ]
}

/** The private zone: split-horizon, and deliberately without an apex NS set. */
function privateRecords(): RawRecord[] {
  return [
    {
      Name: "example.internal.",
      Type: "SOA",
      TTL: 900,
      ResourceRecords: [{ Value: "ns-0.awsdns-00.org. awsdns-hostmaster.amazon.com. 1 7200 900 1209600 86400" }],
    },
    { Name: "db.example.internal.", Type: "A", TTL: 60, ResourceRecords: [{ Value: "10.0.4.17" }] },
  ]
}

/* ------------------------------------------------------------- the client -- */

type Outcome = "populated" | "empty" | "denied" | "throttled"

interface ZoneFixture {
  id: string
  name: string
  privateZone: boolean
  comment?: string
  records: RawRecord[]
  /** How THIS zone's record read behaves. Per zone, so degradation is provable. */
  recordsOutcome?: Outcome
}

interface FakeOptions {
  zonesOutcome?: Outcome
  zones?: ZoneFixture[]
  distributionsOutcome?: Outcome
  loadBalancersOutcome?: Outcome
  tagsOutcome?: Outcome
  /** ARN → tags, as the Resource Groups Tagging API returns them. */
  tags?: Record<string, Array<{ Key: string; Value: string }>>
  identity?: { arn: string; account: string; region: string } | "denied"
  /** Records returned per ListResourceRecordSets page. Small values force paging. */
  recordPageSize?: number
  /** Hosted zones per ListHostedZones page. */
  zonePageSize?: number
  /** Never stop reporting more zones — proves the page cap's own signal. */
  endlessZonePages?: boolean
  /** Report more records while returning the same page — the stalled cursor. */
  stallRecordCursor?: boolean
  calls?: string[]
}

function throwing(name: string): never {
  const error = new Error(`${name} raised by the stand-in AWS client`)
  error.name = name
  throw error
}

function defaultZones(): ZoneFixture[] {
  return [
    {
      id: PUBLIC_ZONE,
      name: "example.com.",
      privateZone: false,
      comment: "the public zone",
      records: publicRecords(),
    },
    {
      id: PRIVATE_ZONE,
      name: "example.internal.",
      privateZone: true,
      records: privateRecords(),
    },
  ]
}

function fakeAws(options: FakeOptions = {}): AwsGateway {
  const zones = options.zones ?? defaultZones()
  const identity = options.identity ?? {
    arn: `arn:aws:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
    account: ACCOUNT,
    region: REGION,
  }
  const calls = options.calls ?? []
  const recordPageSize = options.recordPageSize ?? 1000
  const zonePageSize = options.zonePageSize ?? 100

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
          const outcome = options.distributionsOutcome ?? "populated"
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          // The real API omits Items entirely when there are none.
          if (outcome === "empty") return { DistributionList: { Quantity: 0 } }
          return {
            DistributionList: {
              Items: [
                {
                  Id: LIVE_DIST_ID,
                  ARN: `arn:aws:cloudfront::${ACCOUNT}:distribution/${LIVE_DIST_ID}`,
                  DomainName: LIVE_DIST_DOMAIN,
                  Enabled: true,
                  Status: "Deployed",
                  Aliases: { Quantity: 1, Items: ["platform.example.com"] },
                },
              ],
              IsTruncated: false,
            },
          }
        }

        case "elasticloadbalancing:DescribeLoadBalancers": {
          const outcome = options.loadBalancersOutcome ?? "populated"
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          if (outcome === "empty") return { LoadBalancers: [] }
          return {
            LoadBalancers: [
              {
                LoadBalancerArn: ALB_ARN,
                LoadBalancerName: "tenure-example-alb",
                DNSName: ALB_DOMAIN,
                Scheme: "internet-facing",
                Type: "application",
                State: { Code: "active" },
              },
            ],
          }
        }

        case "route53:ListHostedZones": {
          const outcome = options.zonesOutcome ?? "populated"
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          // The real API returns an empty HostedZones array, not an absent key.
          if (outcome === "empty") return { HostedZones: [], IsTruncated: false }

          const marker = typeof arg.Marker === "string" ? Number(arg.Marker) : 0
          const page = zones.slice(marker, marker + zonePageSize)
          const next = marker + zonePageSize
          const truncated = options.endlessZonePages || next < zones.length
          return {
            HostedZones: page.map((z) => ({
              Id: `/hostedzone/${z.id}`,
              Name: z.name,
              CallerReference: `${z.id}-ref`,
              Config: { Comment: z.comment, PrivateZone: z.privateZone },
              ResourceRecordSetCount: z.records.length,
            })),
            IsTruncated: truncated,
            NextMarker: truncated ? String(options.endlessZonePages ? marker + 1 : next) : undefined,
          }
        }

        case "route53:ListResourceRecordSets": {
          const zoneId = String(arg.HostedZoneId ?? "")
          const zone = zones.find((z) => z.id === zoneId)
          if (!zone) throwing("NoSuchHostedZone")
          const outcome = zone.recordsOutcome ?? "populated"
          if (outcome === "denied") throwing("AccessDeniedException")
          if (outcome === "throttled") throwing("ThrottlingException")
          if (outcome === "empty") return { ResourceRecordSets: [], IsTruncated: false }

          // Route 53 orders by name then type, and StartRecordName restarts at
          // the first record with that name — including ones already returned.
          const ordered = [...zone.records].sort((a, b) =>
            a.Name === b.Name ? a.Type.localeCompare(b.Type) : a.Name.localeCompare(b.Name),
          )
          const start =
            typeof arg.StartRecordName === "string"
              ? Math.max(0, ordered.findIndex((r) => r.Name === arg.StartRecordName))
              : 0
          if (options.stallRecordCursor) {
            // Every page returns the same first record and claims there is more,
            // which is exactly what a name with more record sets than fit in one
            // page does to a cursor that can only carry StartRecordName.
            return {
              ResourceRecordSets: ordered.slice(0, 1),
              IsTruncated: true,
              NextRecordName: ordered[0]?.Name,
              NextRecordType: ordered[0]?.Type,
            }
          }
          const page = ordered.slice(start, start + recordPageSize)
          const nextIndex = start + recordPageSize
          const truncated = nextIndex < ordered.length
          return {
            ResourceRecordSets: page,
            IsTruncated: truncated,
            NextRecordName: truncated ? ordered[nextIndex].Name : undefined,
            NextRecordType: truncated ? ordered[nextIndex].Type : undefined,
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

async function load(options: FakeOptions = {}): Promise<DnsReadings> {
  return dnsReadings(fakeAws(options), { now: AT })
}

const HOSTS = ["platform.example.com", "studio.example.com", "legacy.example.com"]

function surfaceText(readings: DnsReadings): string {
  return dnsLines(readings, HOSTS)
    .map((line) => `${line.label}: ${line.text}`)
    .join("\n")
}

beforeEach(() => {
  // resolveIdentity caches per process. Every case supplies its own gateway,
  // which bypasses the cache, but a stale cache from another suite would
  // silently make these assertions test the wrong identity.
  __resetIdentity()
})

/* -------------------------------------------- the four outcomes, compared -- */

describe("the DNS surface says something different for each of the four outcomes", () => {
  test("a populated list is ACTUAL and names every zone and record", async () => {
    const readings = await load()
    expect(readings.zones.state).toBe("ACTUAL")
    if (readings.zones.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.zones.value).toHaveLength(2)
    expect(readings.zonePagination).toEqual({ kind: "complete", pages: 1, items: 2 })

    const text = surfaceText(readings)
    expect(text).toContain("example.com. (Z0PUBLICEXAMPLE1, public)")
    expect(text).toContain("example.internal. (Z0PRIVATEEXAMPL2, private)")
    expect(text).toContain("platform.example.com.")
  })

  test("an empty-but-successful list is EMPTY and says none, not refused", async () => {
    const readings = await load({ zonesOutcome: "empty" })
    expect(readings.zones.state).toBe("EMPTY")
    const text = surfaceText(readings)
    expect(text).toContain("none —")
    expect(text).not.toContain("refused")
    expect(text).not.toContain("Minimum statement")
  })

  test("AccessDenied is DENIED, carries the principal, the action and a pasteable statement", async () => {
    const readings = await load({ zonesOutcome: "denied" })
    expect(readings.zones.state).toBe("DENIED")
    if (readings.zones.state !== "DENIED") throw new Error("narrowing")

    expect(readings.zones.action).toBe("route53:ListHostedZones")
    expect(readings.zones.principal).toContain("assumed-role/tenure-studio-task")
    expect(readings.zones.accountId).toBe(ACCOUNT)
    expect(readings.zones.region).toBe(REGION)
    expect(readings.zones.partition).toBe("aws")
    expect(JSON.parse(readings.zones.minimumStatement)).toEqual({
      Effect: "Allow",
      Action: ["route53:ListHostedZones"],
      Resource: "*",
    })

    // There is no `value` arm on DENIED at all, so a caller cannot reach an
    // empty array; the render says unknown, and the takeover verdict does too.
    expect("value" in readings.zones).toBe(false)
    expect(readings.takeover.kind).toBe("unknown")
    const text = surfaceText(readings)
    expect(text).toContain("unknown")
    expect(text).not.toMatch(/\bnone\b/)
  })

  test("a throttle is THROTTLED — its own state, not a failure and not an empty list", async () => {
    const readings = await load({ zonesOutcome: "throttled" })
    expect(readings.zones.state).toBe("THROTTLED")
    if (readings.zones.state !== "THROTTLED") throw new Error("narrowing")
    // The schedule is throttle.ts's — 200ms after the first failure, doubling.
    expect(readings.zones.retryAfterMs).toBe(800)
    const text = surfaceText(readings)
    expect(text).toContain("throttled")
    expect(text).toContain("retrying in")
    expect(text).not.toContain("Minimum statement")
  })

  test("the four render as four visibly different surfaces", async () => {
    const texts: string[] = []
    for (const outcome of ["populated", "empty", "denied", "throttled"] as const) {
      __resetIdentity()
      texts.push(surfaceText(await load({ zonesOutcome: outcome })))
    }
    expect(new Set(texts).size).toBe(4)
    for (const text of texts) expect(text.length).toBeGreaterThan(0)
  })
})

/* ------------------------------------------ the question the estate asks -- */

describe("does this host actually point at our distribution", () => {
  test("the platform host resolves to the distribution the account owns", async () => {
    const readings = await load()
    const verdict = hostVerdict(readings, "platform.example.com")
    expect(verdict.kind).toBe("points-at-distribution")
    if (verdict.kind !== "points-at-distribution") throw new Error("narrowing")
    expect(verdict.distributionId).toBe(LIVE_DIST_ID)
    expect(verdict.distributionDomain).toBe(LIVE_DIST_DOMAIN)
    expect(verdict.enabled).toBe(true)
    expect(verdict.via).toBe("alias")
  })

  test("a host on a load balancer is reported as NOT CloudFront, not as fine", async () => {
    const readings = await load()
    const verdict = hostVerdict(readings, "studio.example.com")
    expect(verdict.kind).toBe("points-elsewhere")
    if (verdict.kind !== "points-elsewhere") throw new Error("narrowing")
    // The `dualstack.` prefix is the same load balancer, and matching it is what
    // keeps a live Studio host out of the takeover list.
    expect(verdict.what).toContain("tenure-example-alb")
    expect(verdict.why).toContain("does not pass the edge")
  })

  test("a host whose target is gone is DANGLING, and named as a takeover", async () => {
    const readings = await load()
    const verdict = hostVerdict(readings, "legacy.example.com")
    expect(verdict.kind).toBe("dangling")
    if (verdict.kind !== "dangling") throw new Error("narrowing")
    expect(verdict.target).toBe(GONE_DIST_DOMAIN)
    expect(verdict.why).toContain("subdomain takeover")

    expect(readings.takeover.kind).toBe("dangling")
    if (readings.takeover.kind !== "dangling") throw new Error("narrowing")
    // Two: the CNAME at the deleted distribution, and the in-zone alias at a
    // record that does not exist.
    const targets = readings.takeover.risks.map((r) => r.target).sort()
    expect(targets).toEqual([GONE_DIST_DOMAIN, "gone.example.com"])
    expect(surfaceText(readings)).toContain("SUBDOMAIN TAKEOVER RISK")
  })

  test("a host no zone covers is no-zone, and a host in a read zone with no record is no-record", async () => {
    const readings = await load()
    expect(hostVerdict(readings, "www.elsewhere.test").kind).toBe("no-zone")
    const missing = hostVerdict(readings, "nothing-here.example.com")
    expect(missing.kind).toBe("no-record")
    if (missing.kind !== "no-record") throw new Error("narrowing")
    expect(missing.why).toContain("read to the end")
  })

  test("a wildcard record is matched: Route 53's octal escape is decoded", async () => {
    expect(normaliseDnsName("\\052.example.com.")).toBe("*.example.com")
    const readings = await load()
    if (readings.zones.state !== "ACTUAL") throw new Error("narrowing")
    const names = readings.zones.value.flatMap((z) =>
      z.records.state === "ACTUAL" ? z.records.value.map((r) => r.normalisedName) : [],
    )
    expect(names).toContain("*.example.com")
  })
})

/* ------------------------------------------------- the guard that matters -- */

describe("a denied ownership index is unverified — never owned and never dangling", () => {
  test("with CloudFront denied, the deleted-distribution CNAME is NOT called dangling", async () => {
    const readings = await load({ distributionsOutcome: "denied" })
    expect(readings.distributions.state).toBe("DENIED")

    const verdict = hostVerdict(readings, "legacy.example.com")
    expect(verdict.kind).toBe("unknown")
    if (verdict.kind !== "unknown") throw new Error("narrowing")
    expect(verdict.why).toContain("cloudfront:ListDistributions")
    expect(verdict.why).toContain("NOT confirmed and it is NOT dangling")

    // And the live platform host is not silently promoted to fine either.
    expect(hostVerdict(readings, "platform.example.com").kind).toBe("unknown")

    // The one real finding left is the in-zone alias, which needs no index.
    if (readings.takeover.kind !== "dangling") throw new Error("expected the in-zone dangle")
    expect(readings.takeover.risks.map((r) => r.target)).toEqual(["gone.example.com"])
    expect(readings.takeover.unverified.join(" ")).toContain(GONE_DIST_DOMAIN)
  })

  test("with CloudFront throttled the verdict is unverified too, and says throttled", async () => {
    const readings = await load({ distributionsOutcome: "throttled" })
    expect(readings.distributions.state).toBe("THROTTLED")
    const verdict = hostVerdict(readings, "platform.example.com")
    expect(verdict.kind).toBe("unknown")
    if (verdict.kind !== "unknown") throw new Error("narrowing")
    expect(verdict.why).toContain("throttled")
  })

  test("an EMPTY distribution index IS conclusive: nothing is owned, so the alias dangles", async () => {
    const readings = await load({ distributionsOutcome: "empty" })
    expect(readings.distributions.state).toBe("EMPTY")
    // "we looked and there are no distributions" is a real answer, and it is the
    // one case where absence proves the alias points at nothing.
    const verdict = hostVerdict(readings, "platform.example.com")
    expect(verdict.kind).toBe("dangling")
  })

  test("with the load balancer index denied, the Studio host is unverified, not dangling", async () => {
    const readings = await load({ loadBalancersOutcome: "denied" })
    const verdict = hostVerdict(readings, "studio.example.com")
    expect(verdict.kind).toBe("unknown")
    if (verdict.kind !== "unknown") throw new Error("narrowing")
    expect(verdict.why).toContain("elasticloadbalancing:DescribeLoadBalancers")
    // The CloudFront finding survives: one denied index does not collapse the other.
    if (readings.takeover.kind !== "dangling") throw new Error("narrowing")
    expect(readings.takeover.risks.map((r) => r.target)).toContain(GONE_DIST_DOMAIN)
  })

  test("an S3 website alias is left explicitly unverified, with the reason", async () => {
    const readings = await load()
    const text = surfaceText(readings)
    expect(text).toContain("s3:GetBucketWebsite")
    expect(text).toContain("left UNVERIFIED rather than shown as fine")
  })
})

/* ------------------------------------------ sub-calls degrade on their own -- */

describe("one zone's refused records does not collapse the others", () => {
  const zonesWithOneDenied = (): ZoneFixture[] => {
    const zones = defaultZones()
    zones[0] = { ...zones[0], recordsOutcome: "denied" }
    return zones
  }

  test("the refused zone says refused and the other zone still reads", async () => {
    const readings = await load({ zones: zonesWithOneDenied() })
    expect(readings.zones.state).toBe("ACTUAL")
    if (readings.zones.state !== "ACTUAL") throw new Error("narrowing")

    const [publicZone, privateZone] = readings.zones.value
    expect(publicZone.records.state).toBe("DENIED")
    if (publicZone.records.state !== "DENIED") throw new Error("narrowing")
    expect(publicZone.records.action).toBe("route53:ListResourceRecordSets")
    // The minimum statement names the RECORD action, not the listing action —
    // otherwise an operator grants the wrong one and is refused identically.
    expect(publicZone.records.minimumStatement).toContain("route53:ListResourceRecordSets")
    expect(publicZone.pagination.kind).toBe("not-read")

    expect(privateZone.records.state).toBe("ACTUAL")
    if (privateZone.records.state !== "ACTUAL") throw new Error("narrowing")
    expect(privateZone.records.value.length).toBeGreaterThan(0)

    const text = surfaceText(readings)
    // The refused zone must not render as an empty zone. "0 record set(s)" is
    // the string the ACTUAL branch would print, and it must appear nowhere.
    expect(text).not.toContain("0 record set(s)")
    expect(text).toContain("route53:ListResourceRecordSets")
  })

  test("a host in the refused zone is unknown, not no-record", async () => {
    const readings = await load({ zones: zonesWithOneDenied() })
    const verdict = hostVerdict(readings, "platform.example.com")
    expect(verdict.kind).toBe("unknown")
    if (verdict.kind !== "unknown") throw new Error("narrowing")
    expect(verdict.why).toContain("its records were not read")
  })

  test("the takeover verdict names the zone it could not read rather than calling it clear", async () => {
    const zones = defaultZones().map((z) =>
      z.id === PUBLIC_ZONE ? { ...z, recordsOutcome: "denied" as const } : z,
    )
    const readings = await load({ zones })
    expect(readings.takeover.kind).toBe("clear")
    if (readings.takeover.kind !== "clear") throw new Error("narrowing")
    expect(readings.takeover.unverified.join(" ")).toContain("example.com.")
    expect(describeClear(readings)).toContain("could not be verified")
  })

  function describeClear(readings: DnsReadings): string {
    return dnsLines(readings).find((l) => l.label === "Takeover risk")?.text ?? ""
  }
})

/* --------------------------------------------------- bounds, and the signal -- */

describe("pagination is bounded and says so when it stops short", () => {
  test("the zone listing reports truncated when the page cap is hit, and blocks a no-zone claim", async () => {
    const readings = await load({ endlessZonePages: true, zonePageSize: 1 })
    expect(readings.zonePagination.kind).toBe("truncated")
    if (readings.zonePagination.kind !== "truncated") throw new Error("narrowing")
    expect(readings.zonePagination.pages).toBe(MAX_ZONE_PAGES)
    expect(readings.zonePagination.why).toContain("not the whole zone list")

    // A host no zone covers must NOT be answered "no zone" from a partial list.
    const verdict = hostVerdict(readings, "www.elsewhere.test")
    expect(verdict.kind).toBe("unknown")
    expect(surfaceText(readings)).toContain("INCOMPLETE")
  })

  test("records page to completion across several pages", async () => {
    const readings = await load({ recordPageSize: 3 })
    if (readings.zones.state !== "ACTUAL") throw new Error("narrowing")
    const publicZone = readings.zones.value[0]
    expect(publicZone.pagination.kind).toBe("complete")
    if (publicZone.pagination.kind !== "complete") throw new Error("narrowing")
    expect(publicZone.pagination.pages).toBeGreaterThan(1)
    // Deduplicated: StartRecordName restarts at a name already returned.
    expect(publicZone.pagination.items).toBe(publicRecords().length)
    // And the answer is unchanged by the paging.
    expect(hostVerdict(readings, "platform.example.com").kind).toBe("points-at-distribution")
  })

  test("a cursor that cannot advance is reported as stalled, naming the missing parameter", async () => {
    const readings = await load({ stallRecordCursor: true })
    if (readings.zones.state !== "ACTUAL") throw new Error("narrowing")
    const publicZone = readings.zones.value[0]
    expect(publicZone.pagination.kind).toBe("stalled")
    if (publicZone.pagination.kind !== "stalled") throw new Error("narrowing")
    expect(publicZone.pagination.why).toContain("StartRecordType")
    expect(publicZone.pagination.items).toBe(1)

    // Nothing may claim a host has no record from a stalled read.
    const verdict = hostVerdict(readings, "platform.example.com")
    expect(verdict.kind).toBe("unknown")
    if (verdict.kind !== "unknown") throw new Error("narrowing")
    expect(verdict.why).toContain('This is not "no record"')
  })

  test("a stalled zone is named in the takeover verdict's unverified list, not silently counted clear", async () => {
    // The guard this covers was found by a mutation that survived: disabling the
    // `isConclusive` check inside `takeoverState` changed nothing observable,
    // because nothing asserted that an incomplete zone qualifies the verdict.
    const readings = await load({ stallRecordCursor: true })
    expect(readings.takeover.kind).toBe("clear")
    if (readings.takeover.kind !== "clear") throw new Error("narrowing")
    const named = readings.takeover.unverified.join(" | ")
    expect(named).toContain("example.com.")
    expect(named).toContain("INCOMPLETE")
    expect(named).toContain("StartRecordType")
    // And the sentence an operator reads carries the qualification too, so
    // "no dangling records" never stands alone on a read that did not finish.
    const line = dnsLines(readings).find((l) => l.label === "Takeover risk")?.text ?? ""
    expect(line).toContain("could not be verified")
  })

  test("zones past the record-read budget are UNCONFIGURED, not empty", async () => {
    const many: ZoneFixture[] = []
    for (let i = 0; i < MAX_ZONE_RECORD_READS + 2; i += 1) {
      // Zero-padded so the module's own sort and this fixture's order agree.
      const label = String(i).padStart(3, "0")
      many.push({
        id: `Z0EXAMPLEZONE${label}`,
        name: `zone-${label}.example.com.`,
        privateZone: false,
        records: [
          {
            Name: `zone-${label}.example.com.`,
            Type: "A",
            TTL: 60,
            ResourceRecords: [{ Value: "10.0.0.1" }],
          },
        ],
      })
    }
    const readings = await load({ zones: many })
    if (readings.zones.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.zones.value).toHaveLength(MAX_ZONE_RECORD_READS + 2)

    const last = readings.zones.value[readings.zones.value.length - 1]
    expect(last.records.state).toBe("UNCONFIGURED")
    if (last.records.state !== "UNCONFIGURED") throw new Error("narrowing")
    expect(last.records.why).toContain("not the same as its having none")
    expect(last.pagination.kind).toBe("not-read")

    const first = readings.zones.value[0]
    expect(first.records.state).toBe("ACTUAL")
  })
})

/* ----------------------------------------------------------- delegation -- */

describe("delegation is reported against a registrar this account cannot see", () => {
  test("the public zone's apex NS set is the delegation, and the registrar is named as invisible", async () => {
    const readings = await load()
    if (readings.zones.state !== "ACTUAL") throw new Error("narrowing")
    const publicZone = readings.zones.value[0]
    expect(publicZone.delegation.kind).toBe("nameservers")
    if (publicZone.delegation.kind !== "nameservers") throw new Error("narrowing")
    expect(publicZone.delegation.nameservers).toEqual([
      "ns-1.awsdns-00.co.uk",
      "ns-2.awsdns-00.com",
      "ns-3.awsdns-00.net",
      "ns-4.awsdns-00.org",
    ])
    expect(publicZone.delegation.registrar.state).toBe("NOT_READABLE")
    expect(publicZone.delegation.registrar.needs).toBe("route53domains:GetDomainDetail")

    const text = surfaceText(readings)
    expect(text).toContain("outside this account's visibility")
    expect(text).toContain("has to be checked at the registrar")
  })

  test("a private zone with no apex NS says so, and says why that is expected", async () => {
    const readings = await load()
    if (readings.zones.state !== "ACTUAL") throw new Error("narrowing")
    const privateZone = readings.zones.value[1]
    expect(privateZone.delegation.kind).toBe("none-in-zone")
    if (privateZone.delegation.kind !== "none-in-zone") throw new Error("narrowing")
    expect(privateZone.delegation.privateZone).toBe(true)
    expect(privateZone.delegation.why).toContain("not delegated from the public DNS")
  })

  test("delegation from a stalled read is unknown, not none", async () => {
    const readings = await load({ stallRecordCursor: true })
    if (readings.zones.state !== "ACTUAL") throw new Error("narrowing")
    // The first record by name+type is the apex MX, so no NS was seen — and the
    // read did not complete, so "no apex NS" is not a claim this may make.
    expect(readings.zones.value[0].delegation.kind).toBe("unknown")
  })
})

/* ------------------------------------------- identity, region, attribution -- */

describe("identity, attribution and the things that must not be literals", () => {
  test("the zone ARN takes its partition from the resolved identity, never a literal", async () => {
    const govIdentity = {
      arn: `arn:aws-us-gov:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
      account: ACCOUNT,
      region: "us-gov-west-1",
    }
    const readings = await load({ identity: govIdentity })
    if (readings.zones.state !== "ACTUAL") throw new Error("narrowing")
    const zone = readings.zones.value[0]
    expect(zone.partition).toBe("aws-us-gov")
    expect(zone.arn).toBe(`arn:aws-us-gov:route53:::hostedzone/${PUBLIC_ZONE}`)
    // Route 53 is global; the reading must not carry an invented region.
    expect(zone.region).toBeNull()
    expect(surfaceText(readings)).toContain("no region (Route 53 is global)")
  })

  test("with identity denied no ARN is assembled and attribution says so", async () => {
    const readings = await load({ identity: "denied" })
    if (readings.zones.state !== "ACTUAL") throw new Error("narrowing")
    const zone = readings.zones.value[0]
    expect(zone.arn).toBeNull()
    expect(zone.partition).toBeNull()
    expect(zone.attribution.kind).toBe("unknown")
    expect(zone.arnProvenance).toContain("will not assemble an ARN it cannot stand behind")
  })

  test("a tagged zone attributes to its tenant, an untagged one is unattributable", async () => {
    const readings = await load({
      tags: {
        [`arn:aws:route53:::hostedzone/${PUBLIC_ZONE}`]: [
          { Key: "tenure:tenant", Value: "pilot-school" },
          { Key: "tenure:environment", Value: "production" },
        ],
      },
    })
    if (readings.zones.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.zones.value[0].attribution).toEqual({
      kind: "tenant",
      tenantSlug: "pilot-school",
    })
    expect(readings.zones.value[1].attribution.kind).toBe("unattributed")
  })

  test("a denied tag index makes attribution unknown, NOT unattributable", async () => {
    const readings = await load({ tagsOutcome: "denied" })
    if (readings.zones.state !== "ACTUAL") throw new Error("narrowing")
    const attribution = readings.zones.value[0].attribution
    expect(attribution.kind).toBe("unknown")
    if (attribution.kind !== "unknown") throw new Error("narrowing")
    expect(attribution.why).toContain("tags were not read")
    // The sentence that would send an operator to add a tag that is already
    // there must not appear for a zone whose tags were never read.
    expect(surfaceText(readings)).not.toContain("unattributable — missing tenure:tenant")
  })

  test("an alias record reports no TTL rather than a TTL of zero", async () => {
    const readings = await load()
    if (readings.zones.state !== "ACTUAL") throw new Error("narrowing")
    const zone = readings.zones.value[0]
    if (zone.records.state !== "ACTUAL") throw new Error("narrowing")
    const alias = zone.records.value.find((r) => r.normalisedName === "platform.example.com")
    expect(alias?.ttlSeconds).toBeNull()
    expect(surfaceText(readings)).toContain("no TTL (alias — inherits the target's)")
    expect(surfaceText(readings)).not.toContain("TTL 0s")
  })

  test("the capability cadences come from the registry, not from numbers retyped here", async () => {
    const readings = await load()
    // 900_000 is ROUTE53_RECORDS_TTL_MS in capabilities.ts. Asserting the value
    // is asserting that the module read the registry rather than inventing one.
    expect(readings.refreshMs.records).toBe(900_000)
    expect(readings.refreshMs.zones).toBeGreaterThan(0)
    expect(readings.refreshMs.distributions).toBeGreaterThan(0)
    expect(readings.refreshMs.loadBalancers).toBeGreaterThan(0)
    if (readings.zones.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.zones.value[0].refreshMs).toBe(readings.refreshMs.records)
    expect(readings.zones.value[0].asOf).toBe("2026-08-13T09:15:00.000Z")
  })

  test("every capability this module calls is one the registry already declares", async () => {
    const calls: string[] = []
    await dnsReadings(fakeAws({ calls }), { now: AT })
    expect(new Set(calls)).toEqual(
      new Set([
        "sts:GetCallerIdentity",
        "tag:GetResources",
        "cloudfront:ListDistributions",
        "elasticloadbalancing:DescribeLoadBalancers",
        "route53:ListHostedZones",
        "route53:ListResourceRecordSets",
      ]),
    )
  })
})
