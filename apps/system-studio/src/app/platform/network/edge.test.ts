import {
  certificateLegOf,
  certificateRows,
  certificateSeverity,
  chainBreaks,
  dnsLegOf,
  edgeAnswer,
  edgeVerdict,
  invalidationRows,
  leadOf,
  originLegOf,
  unknownLegs,
  wafLegOf,
  type CertificateLeg,
  type DnsLeg,
  type OriginLeg,
  type WafLeg,
} from "./edge"
import type {
  CdnReadings,
  DistributionConfigReading,
  DistributionReading,
  OriginReading,
} from "../../../lib/aws/cdn"
import type {
  CertificateDetail,
  CertificateReading,
  CertificateReadings,
} from "../../../lib/aws/certificates"
import type { DnsReadings, HostVerdict, ZoneReading } from "../../../lib/aws/dns"
import type { Identity } from "../../../lib/aws/identity"
import type { AwsRead } from "../../../lib/aws/read"
import type { ResourceProtection, WafReadings } from "../../../lib/aws/waf"

/**
 * The edge section of `/platform/network`, driven with no browser and no AWS.
 *
 * `e2e/network-surface.spec.ts` is the browser half — that the route boots with
 * every read in a valueless arm and says so. This is the half a browser pointed
 * at any estate cannot reach, because every case below needs a condition an
 * operator only meets on their worst morning:
 *
 *   * a Route 53 record aliasing a distribution this account does not own,
 *     while the ownership index ANSWERED — the subdomain takeover;
 *   * a certificate at `PENDING_VALIDATION` carrying the exact CNAME that would
 *     end it, which is the commonest cause of a stalled tenant provision;
 *   * an ACM ARN in `us-east-1` while the listing covers `eu-west-2` — the case
 *     a naive join renders as "certificate missing";
 *   * `wafv2:GetWebACLForResource` answering EMPTY versus being REFUSED, which
 *     mean opposite things and must not produce the same row;
 *   * an origin on `http-only`, and a web ACL every one of whose rules is in
 *     count mode.
 */

/* ─────────────────────────────────────────────────────────── fixtures ──── */

const NOW = "2026-08-14T00:00:00.000Z"

const IDENTITY: Identity = {
  accountId: "111122223333",
  arn: "arn:aws:iam::111122223333:role/tenure-studio",
  partition: "aws",
  region: "eu-west-2",
}

function actual<T>(value: T, capability = "cloudfront:ListDistributions"): AwsRead<T> {
  return { state: "ACTUAL", capability: capability as never, value, asOf: NOW, fresh: true }
}

function empty<T>(capability = "wafv2:GetWebACLForResource"): AwsRead<T> {
  return { state: "EMPTY", capability: capability as never, asOf: NOW }
}

function denied<T>(action = "acm:ListCertificates"): AwsRead<T> {
  return {
    state: "DENIED",
    capability: action as never,
    action,
    principal: IDENTITY.arn,
    accountId: IDENTITY.accountId,
    region: IDENTITY.region,
    partition: IDENTITY.partition,
    errorCode: "AccessDenied",
    minimumStatement: `{"Effect":"Allow","Action":"${action}","Resource":"*"}`,
  }
}

function origin(overrides: Partial<OriginReading> = {}): OriginReading {
  return {
    id: "alb-origin",
    domainName: "tenure-prod-alb.eu-west-2.elb.amazonaws.com",
    originPath: null,
    protocol: { kind: "tls", policy: "https-only", sslProtocols: ["TLSv1.2"] },
    ...overrides,
  }
}

function config(overrides: Partial<DistributionConfigReading> = {}): DistributionConfigReading {
  return {
    comment: null,
    enabled: true,
    aliases: ["app.tenure.example"],
    defaultRootObject: null,
    origins: [origin()],
    tls: {
      kind: "modern",
      version: "TLSv1.2_2021",
      certificateSource: {
        kind: "acm",
        arn: "arn:aws:acm:us-east-1:111122223333:certificate/abc",
        sslSupportMethod: "sni-only",
      },
    },
    waf: { kind: "associated", webAclId: "acl-1", why: "a web ACL is attached." },
    behaviours: [],
    logging: { kind: "off", why: "no access log" } as never,
    geo: { kind: "none", why: "served everywhere" } as never,
    priceClass: null,
    httpVersion: null,
    ipv6Enabled: null,
    ...overrides,
  }
}

function distribution(overrides: Partial<DistributionReading> = {}): DistributionReading {
  return {
    id: "E1TENURE",
    arn: "arn:aws:cloudfront::111122223333:distribution/E1TENURE",
    domainName: "d111.cloudfront.net",
    status: "Deployed",
    enabled: true,
    aliases: ["app.tenure.example"],
    lastModifiedAt: NOW,
    region: null,
    whyNoRegion: "CloudFront is partition-global",
    partition: "aws",
    attribution: { kind: "tenant", tenantSlug: "acme" },
    config: actual(config()),
    invalidations: empty("cloudfront:ListInvalidations"),
    invalidationBacklog: { kind: "none", why: "no invalidation history" },
    invalidationTruncation: { kind: "complete" },
    refreshMs: { config: 300_000, invalidations: 60_000 },
    asOf: NOW,
    ...overrides,
  }
}

function cdnReadingsFixture(overrides: Partial<CdnReadings> = {}): CdnReadings {
  return {
    identity: actual(IDENTITY, "sts:GetCallerIdentity"),
    tagged: empty("tag:GetResources"),
    distributions: actual<readonly DistributionReading[]>([distribution()]),
    truncation: { kind: "complete" },
    exposure: { kind: "clear", distributionsRead: 1 },
    findings: [],
    invalidationsInFlight: [],
    asOf: NOW,
    refreshMs: { distributions: 300_000, config: 300_000, invalidations: 60_000 },
    ...overrides,
  }
}

function zone(overrides: Partial<ZoneReading> = {}): ZoneReading {
  return {
    id: "Z1TENURE",
    arn: "arn:aws:route53:::hostedzone/Z1TENURE",
    arnProvenance: "built from the resolved identity's partition",
    name: "tenure.example.",
    normalisedName: "tenure.example",
    privateZone: false,
    comment: null,
    declaredRecordCount: 3,
    records: actual([], "route53:ListResourceRecordSets"),
    pagination: { kind: "complete", pages: 1, records: 3 } as never,
    delegation: { kind: "unknown", why: "not read" },
    attribution: { kind: "shared" },
    region: null,
    partition: "aws",
    refreshMs: 300_000,
    asOf: NOW,
    ...overrides,
  }
}

function dnsReadingsFixture(overrides: Partial<DnsReadings> = {}): DnsReadings {
  return {
    identity: actual(IDENTITY, "sts:GetCallerIdentity"),
    tagged: empty("tag:GetResources"),
    zones: actual<readonly ZoneReading[]>([zone()], "route53:ListHostedZones"),
    zonePagination: { kind: "complete", pages: 1, records: 1 } as never,
    distributions: actual([], "cloudfront:ListDistributions"),
    distributionPagination: { kind: "complete", pages: 1, records: 0 } as never,
    loadBalancers: actual([], "elasticloadbalancing:DescribeLoadBalancers"),
    loadBalancerPagination: { kind: "complete", pages: 1, records: 0 } as never,
    takeover: { kind: "clear", pointersChecked: 0, unverified: [] },
    asOf: NOW,
    refreshMs: { zones: 300_000, records: 300_000, distributions: 300_000, loadBalancers: 300_000 },
    ...overrides,
  }
}

function certificateDetail(overrides: Partial<CertificateDetail> = {}): CertificateDetail {
  return {
    arn: "arn:aws:acm:us-east-1:111122223333:certificate/abc",
    domainName: "app.tenure.example",
    subjectAlternativeNames: ["app.tenure.example"],
    status: "ISSUED",
    type: "AMAZON_ISSUED",
    keyAlgorithm: "RSA_2048",
    inUseBy: ["arn:aws:cloudfront::111122223333:distribution/E1TENURE"],
    validation: { kind: "validated", domains: ["app.tenure.example"] },
    renewal: { kind: "eligible", why: "eligible" },
    expiry: { kind: "expires", notAfter: "2026-12-01T00:00:00.000Z", daysRemaining: 109 },
    renewalEligibility: "ELIGIBLE",
    notBefore: null,
    notAfter: "2026-12-01T00:00:00.000Z",
    createdAt: null,
    issuedAt: null,
    importedAt: null,
    revokedAt: null,
    revocationReason: null,
    failureReason: null,
    ...overrides,
  }
}

function certificate(overrides: Partial<CertificateReading> = {}): CertificateReading {
  return {
    arn: "arn:aws:acm:us-east-1:111122223333:certificate/abc",
    domainName: "app.tenure.example",
    listedStatus: "ISSUED",
    region: "us-east-1",
    partition: "aws",
    accountId: "111122223333",
    attribution: { kind: "tenant", tenantSlug: "acme" },
    detail: actual(certificateDetail(), "acm:DescribeCertificate"),
    refreshMs: 300_000,
    asOf: NOW,
    ...overrides,
  }
}

function certificateReadingsFixture(
  overrides: Partial<CertificateReadings> = {},
): CertificateReadings {
  return {
    identity: actual(IDENTITY, "sts:GetCallerIdentity"),
    tagged: empty("tag:GetResources"),
    certificates: actual<readonly CertificateReading[]>([certificate()], "acm:ListCertificates"),
    pages: { kind: "complete", pagesRead: 1, certificatesRead: 1 },
    stuckValidation: { kind: "none", certificatesRead: 1, unreadable: [] },
    renewalRisk: { kind: "none", certificatesRead: 1, horizonDays: 60, unreadable: [] },
    asOf: NOW,
    refreshMs: { certificates: 300_000, detail: 300_000 },
    ...overrides,
  }
}

function wafReadingsFixture(overrides: Partial<WafReadings> = {}): WafReadings {
  return {
    identity: actual(IDENTITY, "sts:GetCallerIdentity"),
    tagged: empty("tag:GetResources"),
    regional: empty("wafv2:ListWebACLs"),
    cloudfront: empty("wafv2:ListWebACLs"),
    loadBalancers: empty("elasticloadbalancing:DescribeLoadBalancers"),
    distributions: empty("cloudfront:ListDistributions"),
    protection: [],
    coverage: {
      kind: "no-web-acl-exists",
      scopesRead: ["REGIONAL", "CLOUDFRONT"],
      exposed: [],
      unreadable: [],
      remedy: "add an aws_wafv2_web_acl",
    },
    asOf: NOW,
    refreshMs: { webAcls: 300_000, association: 300_000 },
    ...overrides,
  }
}

function protectionFor(association: ResourceProtection["association"]): ResourceProtection {
  return {
    target: {
      arn: "arn:aws:cloudfront::111122223333:distribution/E1TENURE",
      name: "d111.cloudfront.net",
      kind: "distribution",
      scope: "CLOUDFRONT",
      scheme: null,
    },
    association,
    attribution: { kind: "shared" },
    refreshMs: 300_000,
    asOf: NOW,
  }
}

/* ──────────────────────────────────────────────────────────── the DNS leg ── */

describe("dnsLegOf — the record, and whether it reaches THIS distribution", () => {
  it("reads a record that aliases this distribution as resolving", () => {
    const verdict: HostVerdict = {
      kind: "points-at-distribution",
      host: "app.tenure.example",
      zoneName: "tenure.example",
      recordType: "A",
      via: "alias",
      distributionId: "E1TENURE",
      distributionDomain: "d111.cloudfront.net",
      enabled: true,
      why: "the alias target is this distribution",
    }
    const leg = dnsLegOf(verdict, "E1TENURE")
    expect(leg.kind).toBe("resolves")
  })

  it("reads a record aliasing a DIFFERENT distribution as pointing elsewhere, not as resolving", () => {
    const verdict: HostVerdict = {
      kind: "points-at-distribution",
      host: "app.tenure.example",
      zoneName: "tenure.example",
      recordType: "A",
      via: "alias",
      distributionId: "E2OTHER",
      distributionDomain: "d222.cloudfront.net",
      enabled: true,
      why: "the alias target is a distribution",
    }
    const leg = dnsLegOf(verdict, "E1TENURE")
    expect(leg.kind).toBe("elsewhere")
    if (leg.kind !== "elsewhere") throw new Error("unreachable")
    expect(leg.why).toContain("E2OTHER")
  })

  it("carries a dangling target through as the takeover finding", () => {
    const verdict: HostVerdict = {
      kind: "dangling",
      host: "old.tenure.example",
      zoneName: "tenure.example",
      recordType: "CNAME",
      target: "d999.cloudfront.net",
      service: "cloudfront",
      why: "the CloudFront listing answered and holds no such distribution",
    }
    expect(dnsLegOf(verdict, "E1TENURE").kind).toBe("dangling")
  })

  it("never turns an unreadable zone into an absent record", () => {
    const verdict: HostVerdict = {
      kind: "unknown",
      host: "app.tenure.example",
      why: "route53:ListHostedZones was refused",
    }
    const leg = dnsLegOf(verdict, "E1TENURE")
    expect(leg.kind).toBe("unknown")
    expect(leg.kind === "unknown" ? leg.why : "").toContain("refused")
  })
})

/* ────────────────────────────────────────────────── the certificate leg ── */

describe("certificateLegOf — and the region trap", () => {
  it("joins an ACM ARN to the listed certificate and carries days remaining as a number", () => {
    const leg = certificateLegOf(
      { kind: "acm", arn: certificate().arn, sslSupportMethod: "sni-only" },
      certificateReadingsFixture(),
      "us-east-1",
    )
    expect(leg.kind).toBe("acm")
    if (leg.kind !== "acm") throw new Error("unreachable")
    expect(leg.daysRemaining).toBe(109)
    expect(typeof leg.daysRemaining).toBe("number")
  })

  it("reports an ARN the listing does not contain as a REGION difference, never as a missing certificate", () => {
    // The listing answered, and covers eu-west-2. The distribution's certificate
    // is in us-east-1, as every CloudFront certificate must be. A naive join
    // renders this as "certificate missing" and sends an operator to reissue one
    // that already exists.
    const leg = certificateLegOf(
      {
        kind: "acm",
        arn: "arn:aws:acm:us-east-1:111122223333:certificate/elsewhere",
        sslSupportMethod: "sni-only",
      },
      certificateReadingsFixture(),
      "eu-west-2",
    )
    expect(leg.kind).toBe("not-in-listing")
    if (leg.kind !== "not-in-listing") throw new Error("unreachable")
    expect(leg.certificateRegion).toBe("us-east-1")
    expect(leg.why).toContain("eu-west-2")
    expect(leg.why).toContain("us-east-1")
    expect(leg.why).toContain("are NOT known")
    expect(leg.why).not.toContain("missing certificate.")
  })

  it("a refused acm:ListCertificates is unknown, and says the expiry is unknown rather than fine", () => {
    const leg = certificateLegOf(
      { kind: "acm", arn: certificate().arn, sslSupportMethod: null },
      certificateReadingsFixture({ certificates: denied("acm:ListCertificates") }),
      "eu-west-2",
    )
    expect(leg.kind).toBe("unknown")
    expect(leg.kind === "unknown" ? leg.why : "").toContain("Unknown, not valid")
  })

  it("an unread distribution config is unknown, never the default certificate", () => {
    const leg = certificateLegOf(null, certificateReadingsFixture(), "eu-west-2")
    expect(leg.kind).toBe("unknown")
  })

  it("names the CloudFront default certificate as unusable for a custom hostname", () => {
    const leg = certificateLegOf(
      { kind: "cloudfront-default" },
      certificateReadingsFixture(),
      "eu-west-2",
    )
    expect(leg.kind).toBe("cloudfront-default")
  })
})

/* ─────────────────────────────────────────────────────────── the WAF leg ── */

describe("wafLegOf — a successful EMPTY and a refusal are opposite facts", () => {
  it("reads GetWebACLForResource answering EMPTY as NO web ACL, and says the read answered", () => {
    const leg = wafLegOf(null, protectionFor(empty("wafv2:GetWebACLForResource")))
    expect(leg.kind).toBe("none")
    expect(leg.kind === "none" ? leg.why : "").toContain("not a refusal")
  })

  it("reads a REFUSED association as unknown, never as no web ACL", () => {
    // The defect this bars: a denial rendered as "nothing is in front of this
    // distribution" — a finding this console did not establish.
    const leg = wafLegOf(null, protectionFor(denied("wafv2:GetWebACLForResource")))
    expect(leg.kind).toBe("unknown")
    expect(leg.kind === "unknown" ? leg.why : "").toContain("Unknown, not unprotected")
  })

  it("reports an attached ACL whose every rule is in count mode as blocking nothing", () => {
    const leg = wafLegOf(
      null,
      protectionFor(
        actual(
          {
            kind: "web-acl" as const,
            arn: "arn:aws:wafv2:us-east-1:111122223333:global/webacl/edge/1",
            name: "edge",
            detail: {
              kind: "read" as const,
              via: "wafv2:GetWebACLForResource" as const,
              defaultAction: { kind: "allow" as const },
              capacity: 100,
              rules: [],
              blocks: false,
            },
          },
          "wafv2:GetWebACLForResource",
        ),
      ),
    )
    expect(leg.kind).toBe("attached")
    if (leg.kind !== "attached") throw new Error("unreachable")
    expect(leg.blocking).toBe(false)
    expect(leg.why).toContain("NOT ONE of its rules")
  })

  it("falls back to the distribution's own config when no association was read", () => {
    const leg = wafLegOf({ kind: "none", why: "no web ACL is associated" }, undefined)
    expect(leg.kind).toBe("none")
  })

  it("an attached ACL whose rules could not be read carries blocking as null, not as true", () => {
    const leg = wafLegOf({ kind: "associated", webAclId: "acl-1", why: "attached" }, undefined)
    expect(leg.kind).toBe("attached")
    expect(leg.kind === "attached" ? leg.blocking : "x").toBeNull()
  })
})

/* ──────────────────────────────────────────────────────── the origin leg ── */

describe("originLegOf", () => {
  it("finds an origin the edge reaches over plain HTTP", () => {
    const leg = originLegOf([
      origin({ protocol: { kind: "plaintext", policy: "http-only", why: "in the clear" } }),
    ])
    expect(leg.kind).toBe("plaintext")
  })

  it("finds an S3 origin with no origin access control", () => {
    const leg = originLegOf([origin({ protocol: { kind: "s3-managed", access: "public" } })])
    expect(leg.kind).toBe("public-bucket")
  })

  it("an unread config is unknown, never encrypted", () => {
    expect(originLegOf(null).kind).toBe("unknown")
  })
})

/* ─────────────────────────────────────────────────────────── the breaks ─── */

describe("chainBreaks — what is wrong, worst first", () => {
  const resolving: DnsLeg = {
    kind: "resolves",
    host: "app.tenure.example",
    zoneName: "tenure.example",
    recordType: "A",
    via: "alias",
    why: "resolves",
  }
  const issued: CertificateLeg = {
    kind: "acm",
    arn: certificate().arn,
    domainName: "app.tenure.example",
    status: "ISSUED",
    daysRemaining: 109,
    notAfter: "2026-12-01T00:00:00.000Z",
    waiting: [],
    validation: "validated",
    renewal: "ACM manages renewal",
    expiry: "109 day(s) left",
  }
  const attached: WafLeg = {
    kind: "attached",
    webAclId: "acl-1",
    name: "edge",
    blocking: true,
    why: "blocks",
  }
  const encrypted: OriginLeg = { kind: "encrypted", origins: ["alb-origin → alb"] }

  it("finds nothing wrong with a chain whose every leg is sound", () => {
    expect(
      chainBreaks({
        dns: resolving,
        certificate: issued,
        waf: attached,
        origin: encrypted,
        enabled: true,
        host: "app.tenure.example",
      }),
    ).toEqual([])
  })

  it("ranks a dangling record as critical and puts it first", () => {
    const breaks = chainBreaks({
      dns: {
        kind: "dangling",
        host: "old.tenure.example",
        zoneName: "tenure.example",
        target: "d999.cloudfront.net",
        why: "not in the listing",
      },
      certificate: issued,
      waf: { kind: "none", why: "no web ACL" },
      origin: encrypted,
      enabled: true,
      host: "old.tenure.example",
    })
    expect(breaks[0].code).toBe("dangling-record")
    expect(breaks[0].severity).toBe("critical")
  })

  it("names a PENDING_VALIDATION certificate and prints the exact CNAME still required", () => {
    const breaks = chainBreaks({
      dns: resolving,
      certificate: {
        ...issued,
        status: "PENDING_VALIDATION",
        validation: "PENDING — waiting for a DNS validation record",
        waiting: [
          {
            domain: "app.tenure.example",
            record: {
              kind: "cname",
              name: "_x1.app.tenure.example.",
              type: "CNAME",
              value: "_y2.acm-validations.aws.",
            },
          },
        ],
      },
      waf: attached,
      origin: encrypted,
      enabled: true,
      host: "app.tenure.example",
    })
    const pending = breaks.find((b) => b.code === "certificate-pending")
    expect(pending).toBeDefined()
    expect(pending?.severity).toBe("critical")
    expect(pending?.detail).toContain("_x1.app.tenure.example.")
    expect(pending?.detail).toContain("_y2.acm-validations.aws.")
  })

  it("finds no WAF and a plaintext origin, and ranks the plaintext origin above the WAF", () => {
    const breaks = chainBreaks({
      dns: resolving,
      certificate: issued,
      waf: { kind: "none", why: "no web ACL is associated" },
      origin: { kind: "plaintext", origins: ["alb-origin → alb"], why: "http-only" },
      enabled: true,
      host: "app.tenure.example",
    })
    expect(breaks.map((b) => b.code)).toContain("no-waf")
    expect(breaks[0].code).toBe("plaintext-origin")
  })

  it("produces NO break from a leg that was never read", () => {
    // The rule this holds: an unread certificate is an absence of knowledge, not
    // a finding. Inventing one here is the same defect as suppressing a real one.
    const breaks = chainBreaks({
      dns: { kind: "unknown", host: null, why: "zones refused" },
      certificate: { kind: "unknown", why: "listing refused" },
      waf: { kind: "unknown", why: "association refused" },
      origin: { kind: "unknown", why: "config refused" },
      enabled: null,
      host: null,
    })
    expect(breaks).toEqual([])
  })
})

/* ────────────────────────────────────────────────────────────── verdict ─── */

describe("edgeVerdict — a clean screen is not a clean bill", () => {
  it("cannot reach `intact` while any chain has a leg nobody read", () => {
    const chain = edgeAnswer(
      cdnReadingsFixture(),
      dnsReadingsFixture({ zones: denied("route53:ListHostedZones") }),
      certificateReadingsFixture(),
      wafReadingsFixture(),
    )
    expect(chain.verdict.kind).not.toBe("intact")
  })

  it("says `unknown` when the distribution listing did not answer, and never `no-edge`", () => {
    const verdict = edgeVerdict(denied("cloudfront:ListDistributions"), [])
    expect(verdict.kind).toBe("unknown")
    expect(verdict.kind === "unknown" ? verdict.why : "").toContain("no absence of one")
  })

  it("says `no-edge` only when the listing ANSWERED with nothing", () => {
    const verdict = edgeVerdict(empty("cloudfront:ListDistributions"), [])
    expect(verdict.kind).toBe("no-edge")
  })
})

/* ────────────────────────────────────────────────────── the whole answer ── */

describe("edgeAnswer — the join four separate tables cannot make", () => {
  it("draws one chain per alternate domain name, joined across all four readers", () => {
    const answer = edgeAnswer(
      cdnReadingsFixture(),
      dnsReadingsFixture(),
      certificateReadingsFixture(),
      wafReadingsFixture({
        protection: [
          protectionFor(
            actual(
              {
                kind: "web-acl" as const,
                arn: "arn:aws:wafv2:us-east-1:111122223333:global/webacl/edge/1",
                name: "edge",
                detail: {
                  kind: "read" as const,
                  via: "wafv2:GetWebACLForResource" as const,
                  defaultAction: { kind: "block" as const },
                  capacity: 100,
                  rules: [],
                  blocks: true,
                },
              },
              "wafv2:GetWebACLForResource",
            ),
          ),
        ],
      }),
    )
    expect(answer.chains).toHaveLength(1)
    const chain = answer.chains[0]
    expect(chain.host).toBe("app.tenure.example")
    expect(chain.distributionId).toBe("E1TENURE")
    // The WAF leg came from the WAF reader, the certificate leg from the ACM
    // reader, the DNS leg from the Route 53 reader — one row, four readers.
    expect(chain.waf.kind).toBe("attached")
    expect(chain.certificate.kind).toBe("acm")
  })

  it("puts a subdomain takeover at the top of the lead, above every other break", () => {
    const answer = edgeAnswer(
      cdnReadingsFixture(),
      dnsReadingsFixture({
        takeover: {
          kind: "dangling",
          pointersChecked: 2,
          unverified: [],
          risks: [
            {
              zoneId: "Z1TENURE",
              zoneName: "tenure.example",
              recordName: "old.tenure.example",
              recordType: "CNAME",
              target: "d999.cloudfront.net",
              service: "cloudfront",
              via: "cname",
              why: "the CloudFront listing answered and holds no such distribution",
              asOf: NOW,
            },
          ],
        },
      }),
      certificateReadingsFixture(),
      wafReadingsFixture(),
    )
    expect(answer.takeovers).toHaveLength(1)
    expect(answer.lead.verdict).toBe("Subdomain takeover")
    expect(answer.lead.tone).toBe("bad")
  })

  it("names a distribution with a purge still in flight", () => {
    const answer = edgeAnswer(
      cdnReadingsFixture({
        distributions: actual<readonly DistributionReading[]>([
          distribution({
            invalidationBacklog: {
              kind: "in-flight",
              ids: ["I123"],
              oldestCreatedAt: NOW,
              why: "1 invalidation(s) are still InProgress",
            },
          }),
        ]),
      }),
      dnsReadingsFixture(),
      certificateReadingsFixture(),
      wafReadingsFixture(),
    )
    expect(answer.invalidations).toHaveLength(1)
    expect(answer.invalidations[0].distributionId).toBe("E1TENURE")
    expect(answer.chains[0].invalidationsInFlight).toEqual(["I123"])
  })

  it("draws no chain at all, and claims nothing, when every read is refused", () => {
    const answer = edgeAnswer(
      cdnReadingsFixture({ distributions: denied("cloudfront:ListDistributions") }),
      dnsReadingsFixture({ zones: denied("route53:ListHostedZones") }),
      certificateReadingsFixture({ certificates: denied("acm:ListCertificates") }),
      wafReadingsFixture({
        regional: denied("wafv2:ListWebACLs"),
        cloudfront: denied("wafv2:ListWebACLs"),
        coverage: { kind: "unknown", why: "a scope was refused" },
      }),
    )
    expect(answer.chains).toEqual([])
    expect(answer.verdict.kind).toBe("unknown")
    expect(answer.certificates).toEqual([])
    expect(answer.invalidations).toEqual([])
    expect(answer.lead.tone).toBe("warn")
  })
})

/* ──────────────────────────────────────────────── certificates, ranked ─── */

describe("certificateRows — the number the table ranks by", () => {
  it("sorts by days remaining and puts a certificate with no expiry LAST, named", () => {
    const rows = certificateRows(
      certificateReadingsFixture({
        certificates: actual<readonly CertificateReading[]>(
          [
            certificate({
              arn: "arn:aws:acm:us-east-1:111122223333:certificate/far",
              detail: actual(
                certificateDetail({
                  arn: "arn:aws:acm:us-east-1:111122223333:certificate/far",
                  expiry: { kind: "expires", notAfter: "2027-01-01T00:00:00.000Z", daysRemaining: 140 },
                }),
                "acm:DescribeCertificate",
              ),
            }),
            certificate({
              arn: "arn:aws:acm:us-east-1:111122223333:certificate/unread",
              detail: denied("acm:DescribeCertificate"),
            }),
            certificate({
              arn: "arn:aws:acm:us-east-1:111122223333:certificate/soon",
              detail: actual(
                certificateDetail({
                  arn: "arn:aws:acm:us-east-1:111122223333:certificate/soon",
                  expiry: { kind: "expires", notAfter: "2026-08-18T00:00:00.000Z", daysRemaining: 4 },
                }),
                "acm:DescribeCertificate",
              ),
            }),
          ],
          "acm:ListCertificates",
        ),
      }),
    )
    expect(rows.map((r) => r.daysRemaining)).toEqual([4, 140, null])
    // Not a zero, and not sorted into the comfortable end.
    expect(rows[2].expiry).toContain("expiry unknown")
  })

  it("a refused listing produces no rows at all rather than an empty estate", () => {
    expect(certificateRows(certificateReadingsFixture({ certificates: denied() }))).toEqual([])
  })
})

describe("certificateSeverity", () => {
  it("calls PENDING_VALIDATION critical whatever its expiry says", () => {
    expect(certificateSeverity("PENDING_VALIDATION", 300)).toBe("critical")
  })

  it("calls an unread expiry medium, never low", () => {
    expect(certificateSeverity("ISSUED", null)).toBe("medium")
  })

  it("ranks an expired certificate critical and a comfortable one low", () => {
    expect(certificateSeverity("ISSUED", -1)).toBe("critical")
    expect(certificateSeverity("ISSUED", 200)).toBe("low")
  })
})

/* ─────────────────────────────────────────────────────────────── others ─── */

describe("unknownLegs and invalidationRows", () => {
  it("counts a not-in-listing certificate as an unread leg, not as a read one", () => {
    const answer = edgeAnswer(
      cdnReadingsFixture(),
      dnsReadingsFixture(),
      certificateReadingsFixture({ certificates: empty("acm:ListCertificates") }),
      wafReadingsFixture(),
    )
    expect(unknownLegs(answer.chains[0])).toContain("certificate")
  })

  it("lists no invalidation when the distribution listing did not answer", () => {
    expect(invalidationRows(cdnReadingsFixture({ distributions: denied() }))).toEqual([])
  })
})

describe("leadOf", () => {
  it("never says the edge is intact while the listing was refused", () => {
    const lead = leadOf({ kind: "unknown", why: "the listing did not answer" }, 0)
    expect(lead.verdict).toBe("Edge not read")
    expect(lead.tone).toBe("warn")
  })
})
