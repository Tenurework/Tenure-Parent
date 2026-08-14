import { __resetIdentity } from "./identity"
import { EndpointRegionUnset, type AwsGateway } from "./read"
import {
  MAX_WEB_ACL_PAGES,
  actionBlocks,
  describeProtection,
  parseDistributionWebAcl,
  parseRuleAction,
  wafLines,
  wafReadings,
  type WafReadings,
} from "./waf"

/**
 * STUDIO-070-004 (WAFv2) — the WAF surface tells five different truths apart.
 *
 * The assertions are on `wafReadings` and `wafLines`, the functions a surface
 * renders, rather than on `readAws` or on a parser. A test that drove a private
 * helper would stay green on the day this module stopped calling it, which is
 * the failure this programme has already paid for.
 *
 * ## The stand-in is a client, not a stub
 *
 * `fakeAws` answers six capabilities with the shapes the real SDK returns —
 * `{WebACLs, NextMarker}` from ListWebACLs, `{WebACL:{DefaultAction, Rules}}`
 * from GetWebACLForResource, `{LoadBalancers, NextMarker}` from ELBv2,
 * `{DistributionList:{Items:[{WebACLId}]}}` from CloudFront,
 * `{ResourceTagMappingList}` from the Tagging API and `{Account, Arn}` from STS
 * — and every one of them can fail independently with `AccessDeniedException`,
 * `ThrottlingException`, an empty-but-successful answer, or a populated one. It
 * records the `Scope` of every ListWebACLs call, so "both scopes were actually
 * asked" is asserted rather than assumed. A stand-in that returned `[]`
 * regardless of what was asked would prove nothing about code whose entire job
 * is telling those answers apart, and it is the fake this repository has already
 * been burnt by.
 *
 * ## Nothing here is a real AWS resource
 *
 * `123456789012` is AWS's own documentation placeholder account. Every ARN,
 * distribution id and web ACL id below is obviously constructed. No value in
 * this suite was read from an AWS account, and none of it asserts that anybody
 * reviewed, approved or certified anything.
 */

/* ------------------------------------------------------------- the estate -- */

const ACCOUNT = "123456789012"
const REGION = "eu-west-2"
/** WAFv2's CLOUDFRONT scope is served from the commercial partition's global endpoint. */
const EDGE_REGION = "us-east-1"

function albArn(name: string, region = REGION, partition = "aws"): string {
  return `arn:${partition}:elasticloadbalancing:${region}:${ACCOUNT}:loadbalancer/app/${name}/0123456789abcdef`
}

function nlbArn(name: string): string {
  return `arn:aws:elasticloadbalancing:${REGION}:${ACCOUNT}:loadbalancer/net/${name}/0123456789abcdef`
}

function distributionArn(id: string): string {
  return `arn:aws:cloudfront::${ACCOUNT}:distribution/${id}`
}

function webAclArn(
  name: string,
  id: string,
  scope: "REGIONAL" | "CLOUDFRONT",
  partition = "aws",
): string {
  const region = scope === "CLOUDFRONT" ? EDGE_REGION : REGION
  const kind = scope === "CLOUDFRONT" ? "global" : "regional"
  return `arn:${partition}:wafv2:${region}:${ACCOUNT}:${kind}/webacl/${name}/${id}`
}

const ALB = albArn("tenure-prod-alb")
const SECOND_ALB = albArn("tenure-prod-admin-alb")
const NLB = nlbArn("tenure-prod-nlb")
const DISTRIBUTION = distributionArn("E1TENUREPILOT")

const REGIONAL_ACL_ID = "11111111-2222-3333-4444-555555555555"
const EDGE_ACL_ID = "66666666-7777-8888-9999-000000000000"
const REGIONAL_ACL = webAclArn("tenure-prod-regional", REGIONAL_ACL_ID, "REGIONAL")
const EDGE_ACL = webAclArn("tenure-prod-edge", EDGE_ACL_ID, "CLOUDFRONT")

/* ------------------------------------------------------- the WAFv2 shapes -- */

type Json = Record<string, unknown>

/** A managed rule group rule, as WAFv2 returns it. `count` overrides the whole group. */
function managedGroupRule(name: string, vendor: string, group: string, mode: "block" | "count"): Json {
  return {
    Name: name,
    Priority: 0,
    OverrideAction: mode === "count" ? { Count: {} } : { None: {} },
    Statement: {
      ManagedRuleGroupStatement: {
        VendorName: vendor,
        Name: group,
        Version: "Version_2.0",
        ExcludedRules: [{ Name: "SizeRestrictions_BODY" }],
      },
    },
  }
}

function rateRule(name: string, limit: number, mode: "block" | "count"): Json {
  return {
    Name: name,
    Priority: 1,
    Action: mode === "count" ? { Count: {} } : { Block: {} },
    Statement: { RateBasedStatement: { Limit: limit, AggregateKeyType: "IP" } },
  }
}

/** The full WebACL object, which is what GetWebACLForResource returns. */
function webAcl(
  name: string,
  id: string,
  arn: string,
  options: { defaultAction?: "allow" | "block"; rules?: Json[] } = {},
): Json {
  return {
    Name: name,
    Id: id,
    ARN: arn,
    Description: "built by the stand-in client",
    Capacity: 700,
    DefaultAction: options.defaultAction === "block" ? { Block: {} } : { Allow: {} },
    Rules: options.rules ?? [
      managedGroupRule("AWSManagedRulesCommonRuleSet", "AWS", "AWSManagedRulesCommonRuleSet", "block"),
      rateRule("RateLimit", 2000, "block"),
    ],
  }
}

/* ------------------------------------------------------------- the client -- */

type Outcome = "populated" | "empty" | "denied" | "throttled" | "unconfigured" | "truncated"

interface LbFixture {
  arn: string
  name: string
  type: "application" | "network"
  scheme?: string
}

interface DistFixture {
  arn: string
  id: string
  domain: string
  /** CloudFront's own field: "" for none, a WAFv2 ARN, or a WAF Classic id. */
  webAclId: string
}

/** Per-load-balancer association behaviour, so one row can fail while others do not. */
type AssociationFixture = Json | "none" | "denied" | "throttled"

interface FakeOptions {
  regional?: Outcome
  cloudfront?: Outcome
  regionalAcls?: Json[]
  cloudfrontAcls?: Json[]
  loadBalancers?: LbFixture[] | "denied" | "throttled" | "empty"
  distributions?: DistFixture[] | "denied" | "empty"
  associations?: Record<string, AssociationFixture>
  tags?: Record<string, Array<{ Key: string; Value: string }>>
  tagsOutcome?: "populated" | "empty" | "denied" | "throttled"
  identity?: { arn: string; account: string; region: string } | "denied"
  /** Set by the fake so a test can assert which scopes were actually asked for. */
  scopesSeen?: string[]
  calls?: string[]
}

function throwing(name: string): never {
  const error = new Error(`${name} raised by the stand-in AWS client`)
  error.name = name
  throw error
}

/** The summary shape ListWebACLs returns — no DefaultAction, no Rules. That is the point. */
function aclSummary(name: string, id: string, arn: string): Json {
  return { Name: name, Id: id, ARN: arn, Description: "listed", LockToken: "abc" }
}

const DEFAULT_LOAD_BALANCERS: LbFixture[] = [
  { arn: ALB, name: "tenure-prod-alb", type: "application", scheme: "internet-facing" },
]

const DEFAULT_DISTRIBUTIONS: DistFixture[] = [
  { arn: DISTRIBUTION, id: "E1TENUREPILOT", domain: "d111111abcdef8.cloudfront.net", webAclId: "" },
]

/**
 * A stand-in that behaves like the SDK: same response shapes, same error names,
 * independently failable per capability, per scope and per resource.
 */
function fakeAws(options: FakeOptions = {}): AwsGateway {
  const identity =
    options.identity ?? {
      arn: `arn:aws:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
      account: ACCOUNT,
      region: REGION,
    }
  const calls = options.calls ?? []
  const scopesSeen = options.scopesSeen ?? []

  function listing(outcome: Outcome, acls: Json[], marker: unknown): Json {
    if (outcome === "denied") throwing("AccessDeniedException")
    if (outcome === "throttled") throwing("ThrottlingException")
    if (outcome === "unconfigured") {
      // What client.ts raises when AWS_GLOBAL_ENDPOINT_REGION is unset: the
      // CLOUDFRONT scope has no region to be asked at, and this engine refuses
      // to invent one.
      throw new EndpointRegionUnset(
        "WAFv2's CLOUDFRONT scope is served only from the partition's global endpoint and " +
          "AWS_GLOBAL_ENDPOINT_REGION is not set.",
      )
    }
    // The real API omits WebACLs entirely when there are none rather than
    // sending an empty array.
    if (outcome === "empty") return {}
    if (outcome === "truncated") {
      // Never stops offering another page. This is how the bound gets tested.
      return { WebACLs: acls, NextMarker: `page-after-${String(marker ?? "start")}` }
    }
    return { WebACLs: acls }
  }

  return {
    async call(capability, input) {
      calls.push(String(capability))
      const args = (input ?? {}) as Json

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

        case "wafv2:ListWebACLs": {
          const scope = String(args.Scope)
          scopesSeen.push(scope)
          if (scope === "CLOUDFRONT") {
            return listing(
              options.cloudfront ?? "empty",
              options.cloudfrontAcls ?? [aclSummary("tenure-prod-edge", EDGE_ACL_ID, EDGE_ACL)],
              args.NextMarker,
            )
          }
          return listing(
            options.regional ?? "empty",
            options.regionalAcls ?? [
              aclSummary("tenure-prod-regional", REGIONAL_ACL_ID, REGIONAL_ACL),
            ],
            args.NextMarker,
          )
        }

        case "wafv2:GetWebACLForResource": {
          const arn = String(args.ResourceArn)
          const fixture = options.associations?.[arn] ?? "none"
          if (fixture === "denied") throwing("AccessDeniedException")
          if (fixture === "throttled") throwing("ThrottlingException")
          // AWS answers with an empty body when nothing is associated.
          if (fixture === "none") return {}
          return { WebACL: fixture }
        }

        case "elasticloadbalancing:DescribeLoadBalancers": {
          const fixture = options.loadBalancers ?? DEFAULT_LOAD_BALANCERS
          if (fixture === "denied") throwing("AccessDeniedException")
          if (fixture === "throttled") throwing("ThrottlingException")
          if (fixture === "empty") return {}
          return {
            LoadBalancers: fixture.map((lb) => ({
              LoadBalancerArn: lb.arn,
              LoadBalancerName: lb.name,
              Type: lb.type,
              Scheme: lb.scheme ?? "internet-facing",
            })),
          }
        }

        case "cloudfront:ListDistributions": {
          const fixture = options.distributions ?? DEFAULT_DISTRIBUTIONS
          if (fixture === "denied") throwing("AccessDeniedException")
          if (fixture === "empty") return { DistributionList: { Quantity: 0, IsTruncated: false } }
          return {
            DistributionList: {
              Quantity: fixture.length,
              IsTruncated: false,
              Items: fixture.map((d) => ({
                Id: d.id,
                ARN: d.arn,
                DomainName: d.domain,
                Enabled: true,
                WebACLId: d.webAclId,
              })),
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

async function load(options: FakeOptions = {}): Promise<WafReadings> {
  return wafReadings(fakeAws(options), { now: AT })
}

/** The whole surface as one string, which is what an operator actually reads. */
function surfaceText(readings: WafReadings): string {
  return wafLines(readings)
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

describe("the WAF surface says something different for each of the four outcomes", () => {
  test("a populated list is ACTUAL and names the web ACL it found", async () => {
    const readings = await load({ regional: "populated" })
    expect(readings.regional.state).toBe("ACTUAL")
    if (readings.regional.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.regional.value.acls).toHaveLength(1)
    expect(readings.regional.value.acls[0].name).toBe("tenure-prod-regional")
    // Region and partition come off the ARN AWS returned, never a literal.
    expect(readings.regional.value.acls[0].region).toBe(REGION)
    expect(readings.regional.value.acls[0].partition).toBe("aws")
    expect(readings.regional.value.acls[0].accountId).toBe(ACCOUNT)
    expect(readings.regional.value.truncation).toEqual({ kind: "complete", pages: 1 })

    const text = surfaceText(readings)
    expect(text).toContain("tenure-prod-regional")
    // The summary carries no rules, and the surface says so rather than
    // implying the ACL has none.
    expect(text).toContain("rules unknown")
    expect(text).toContain("wafv2:GetWebACL")
  })

  test("an empty-but-successful list is EMPTY and says no web ACL exists, not refused", async () => {
    const readings = await load({ regional: "empty", cloudfront: "empty" })
    expect(readings.regional.state).toBe("EMPTY")
    expect(readings.cloudfront.state).toBe("EMPTY")

    const text = surfaceText(readings)
    expect(text).toContain("wafv2:ListWebACLs succeeded and returned an empty list")
    expect(text).not.toContain("refused")
    expect(text).not.toContain("Minimum statement")
  })

  test("AccessDenied is DENIED, carries the principal, the action and a pasteable statement", async () => {
    const readings = await load({ regional: "denied" })
    expect(readings.regional.state).toBe("DENIED")
    if (readings.regional.state !== "DENIED") throw new Error("narrowing")

    expect(readings.regional.action).toBe("wafv2:ListWebACLs")
    expect(readings.regional.principal).toContain("assumed-role/tenure-studio-task")
    expect(readings.regional.accountId).toBe(ACCOUNT)
    expect(readings.regional.region).toBe(REGION)
    expect(readings.regional.partition).toBe("aws")
    expect(JSON.parse(readings.regional.minimumStatement)).toEqual({
      Effect: "Allow",
      Action: ["wafv2:ListWebACLs"],
      Resource: "*",
    })

    // And the thing it must NOT be. There is no `value` on this arm at all, so
    // no caller can reach an empty list out of a refusal.
    expect("value" in readings.regional).toBe(false)
    const text = surfaceText(readings)
    expect(text).toContain("Minimum statement")
    expect(text).not.toContain("no web ACL exists in the REGIONAL scope")
  })

  test("a throttle is THROTTLED — its own state, not a failure and not an empty list", async () => {
    const readings = await load({ regional: "throttled" })
    expect(readings.regional.state).toBe("THROTTLED")
    if (readings.regional.state !== "THROTTLED") throw new Error("narrowing")
    // The schedule is throttle.ts's — 200ms after the first failure, doubling —
    // not a number retyped in this module.
    expect(readings.regional.retryAfterMs).toBe(800)

    const text = surfaceText(readings)
    expect(text).toContain("throttled")
    expect(text).toContain("retrying in")
    expect(text).not.toContain("Minimum statement")
    expect(text).not.toContain("no web ACL exists in the REGIONAL scope")
  })

  test("the four render as four visibly different surfaces", async () => {
    const texts: string[] = []
    for (const outcome of ["populated", "empty", "denied", "throttled"] as const) {
      __resetIdentity()
      texts.push(surfaceText(await load({ regional: outcome })))
    }
    // Pairwise distinct. A stand-in returning [] regardless would collapse at
    // least two of these into one string, and this is the assertion that notices.
    expect(new Set(texts).size).toBe(4)
    for (const text of texts) expect(text.length).toBeGreaterThan(0)
  })
})

/* --------------------------------------------------- the two scopes, apart -- */

describe("the REGIONAL and CLOUDFRONT scopes are read and reported separately", () => {
  test("both scopes are actually asked for, by name", async () => {
    const scopesSeen: string[] = []
    await wafReadings(fakeAws({ scopesSeen }), { now: AT })
    expect([...scopesSeen].sort()).toEqual(["CLOUDFRONT", "REGIONAL"])
  })

  test("a denied CLOUDFRONT scope does not become 'no web ACL exists'", async () => {
    const readings = await load({ regional: "empty", cloudfront: "denied" })
    expect(readings.regional.state).toBe("EMPTY")
    expect(readings.cloudfront.state).toBe("DENIED")
    expect(readings.coverage.kind).toBe("unknown")
    if (readings.coverage.kind !== "unknown") throw new Error("narrowing")
    expect(readings.coverage.why).toContain("CLOUDFRONT")
    expect(readings.coverage.why).toContain("An unread scope is not an empty one")

    const text = surfaceText(readings)
    expect(text).not.toContain("NO WEB APPLICATION FIREWALL")
  })

  test("an unset global endpoint region is UNCONFIGURED, not an empty edge catalogue", async () => {
    const readings = await load({ regional: "empty", cloudfront: "unconfigured" })
    expect(readings.cloudfront.state).toBe("UNCONFIGURED")
    if (readings.cloudfront.state !== "UNCONFIGURED") throw new Error("narrowing")
    expect(readings.cloudfront.why).toContain("AWS_GLOBAL_ENDPOINT_REGION")
    expect(readings.coverage.kind).toBe("unknown")

    const text = surfaceText(readings)
    expect(text).toContain("not configured")
    expect(text).not.toContain("NO WEB APPLICATION FIREWALL")
  })

  test("the edge scope's region comes from the ARNs it returned, not from the caller's region", async () => {
    const readings = await load({ regional: "empty", cloudfront: "populated" })
    expect(readings.cloudfront.state).toBe("ACTUAL")
    if (readings.cloudfront.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.cloudfront.value.region).toBe(EDGE_REGION)
    expect(readings.cloudfront.value.region).not.toBe(REGION)
  })

  test("a non-commercial partition is carried from the ARN, never defaulted to aws", async () => {
    const govAcl = webAclArn("tenure-prod-regional", REGIONAL_ACL_ID, "REGIONAL", "aws-us-gov")
    const readings = await load({
      regional: "populated",
      regionalAcls: [aclSummary("tenure-prod-regional", REGIONAL_ACL_ID, govAcl)],
    })
    if (readings.regional.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.regional.value.acls[0].partition).toBe("aws-us-gov")
  })
})

/* ------------------------------------------------ the estate's real answer -- */

describe("no web ACL anywhere is a finding, not an empty table", () => {
  test("both scopes empty and a front door exposed renders as the headline", async () => {
    const readings = await load({ regional: "empty", cloudfront: "empty" })
    expect(readings.coverage.kind).toBe("no-web-acl-exists")
    if (readings.coverage.kind !== "no-web-acl-exists") throw new Error("narrowing")
    expect([...readings.coverage.scopesRead].sort()).toEqual(["CLOUDFRONT", "REGIONAL"])
    // The ALB and the distribution, both taking requests with nothing in front.
    expect(readings.coverage.exposed.map((e) => e.name).sort()).toEqual([
      "d111111abcdef8.cloudfront.net",
      "tenure-prod-alb",
    ])
    expect(readings.coverage.unreadable).toHaveLength(0)

    const text = surfaceText(readings)
    expect(text).toContain("NO WEB APPLICATION FIREWALL")
    // What it would take to change it, named as the Terraform that would do it.
    expect(text).toContain("aws_wafv2_web_acl_association")
    expect(text).toContain("web_acl_id")
    expect(text).toContain("NO WEB ACL")
    expect(text).toContain("Requests reach it unfiltered")
  })

  test("an estate with no load balancer and no distribution says so rather than 'protected'", async () => {
    const readings = await load({
      regional: "empty",
      cloudfront: "empty",
      loadBalancers: "empty",
      distributions: "empty",
    })
    expect(readings.coverage.kind).toBe("no-targets")
    expect(surfaceText(readings)).toContain("nothing to protect")
  })
})

/* --------------------------------------------- per resource, not per account -- */

describe("every resource is answered for on its own, and one failure stays on its own row", () => {
  test("an attached web ACL is read with its rules; an unattached resource says NO WEB ACL", async () => {
    const readings = await load({
      regional: "populated",
      loadBalancers: [
        { arn: ALB, name: "tenure-prod-alb", type: "application" },
        { arn: SECOND_ALB, name: "tenure-prod-admin-alb", type: "application" },
      ],
      associations: {
        [ALB]: webAcl("tenure-prod-regional", REGIONAL_ACL_ID, REGIONAL_ACL),
        [SECOND_ALB]: "none",
      },
    })

    const rows = readings.protection
    const front = rows.find((r) => r.target.arn === ALB)
    const admin = rows.find((r) => r.target.arn === SECOND_ALB)
    expect(front?.association.state).toBe("ACTUAL")
    expect(admin?.association.state).toBe("EMPTY")

    if (front?.association.state !== "ACTUAL") throw new Error("narrowing")
    const association = front.association.value
    if (association.kind !== "web-acl") throw new Error("narrowing")
    expect(association.arn).toBe(REGIONAL_ACL)
    if (association.detail.kind !== "read") throw new Error("narrowing")
    expect(association.detail.rules).toHaveLength(2)
    expect(association.detail.rules[0].statement).toEqual({
      kind: "managed-rule-group",
      vendor: "AWS",
      name: "AWSManagedRulesCommonRuleSet",
      version: "Version_2.0",
      excludedRules: ["SizeRestrictions_BODY"],
    })
    expect(association.detail.rules.every((rule) => rule.blocking)).toBe(true)
    expect(association.detail.blocks).toBe(true)
    expect(association.detail.capacity).toBe(700)
    expect(association.detail.defaultAction).toEqual({ kind: "allow" })

    // Two rows, two different sentences.
    expect(describeProtection(front)).toContain("behind web ACL tenure-prod-regional")
    expect(describeProtection(admin!)).toContain("NO WEB ACL")

    expect(readings.coverage.kind).toBe("exposed")
    if (readings.coverage.kind !== "exposed") throw new Error("narrowing")
    expect(readings.coverage.exposed.map((e) => e.name).sort()).toEqual([
      "d111111abcdef8.cloudfront.net",
      "tenure-prod-admin-alb",
    ])
    expect(readings.coverage.protectedCount).toBe(1)
  })

  test("one denied association does not collapse the other rows and never reads as unprotected", async () => {
    const readings = await load({
      regional: "populated",
      loadBalancers: [
        { arn: ALB, name: "tenure-prod-alb", type: "application" },
        { arn: SECOND_ALB, name: "tenure-prod-admin-alb", type: "application" },
      ],
      associations: {
        [ALB]: webAcl("tenure-prod-regional", REGIONAL_ACL_ID, REGIONAL_ACL),
        [SECOND_ALB]: "denied",
      },
    })

    const front = readings.protection.find((r) => r.target.arn === ALB)
    const admin = readings.protection.find((r) => r.target.arn === SECOND_ALB)
    // Degraded independently: one row read, the neighbouring row refused.
    expect(front?.association.state).toBe("ACTUAL")
    expect(admin?.association.state).toBe("DENIED")
    if (admin?.association.state !== "DENIED") throw new Error("narrowing")
    expect(admin.association.action).toBe("wafv2:GetWebACLForResource")
    expect("value" in admin.association).toBe(false)

    const line = describeProtection(admin)
    expect(line).toContain("Minimum statement")
    expect(line).not.toContain("NO WEB ACL")

    // And the verdict does not quietly count the refused row as protected or
    // as exposed: it is named as unreadable.
    expect(readings.coverage.kind).toBe("exposed")
    if (readings.coverage.kind !== "exposed") throw new Error("narrowing")
    expect(readings.coverage.unreadable.join(" ")).toContain("tenure-prod-admin-alb")
    expect(readings.coverage.exposed.map((e) => e.name)).not.toContain("tenure-prod-admin-alb")
  })

  test("a throttled association is THROTTLED on its row, not an absence", async () => {
    const readings = await load({
      regional: "populated",
      loadBalancers: [{ arn: ALB, name: "tenure-prod-alb", type: "application" }],
      associations: { [ALB]: "throttled" },
    })
    const row = readings.protection.find((r) => r.target.arn === ALB)
    expect(row?.association.state).toBe("THROTTLED")
    expect(describeProtection(row!)).toContain("retrying in")
    expect(describeProtection(row!)).not.toContain("NO WEB ACL")
  })

  test("a network load balancer cannot carry a web ACL, and that is not a finding about it", async () => {
    const calls: string[] = []
    const readings = await wafReadings(
      fakeAws({
        calls,
        regional: "empty",
        cloudfront: "empty",
        distributions: "empty",
        loadBalancers: [{ arn: NLB, name: "tenure-prod-nlb", type: "network" }],
      }),
      { now: AT },
    )
    const row = readings.protection.find((r) => r.target.arn === NLB)
    expect(row?.target.kind).toBe("network-load-balancer")
    expect(row?.association.state).toBe("UNCONFIGURED")
    if (row?.association.state !== "UNCONFIGURED") throw new Error("narrowing")
    expect(row.association.why).toContain("cannot carry a WAFv2 web ACL")

    // The call was not made at all — asking would fail on a resource behaving
    // exactly as designed.
    expect(calls).not.toContain("wafv2:GetWebACLForResource")

    // And it is not counted as an exposed resource.
    expect(readings.coverage.kind).toBe("no-targets")
  })
})

/* ------------------------------------------------------- CloudFront's field -- */

describe("a distribution's protection comes from its own WebACLId", () => {
  test("a WAFv2 ARN is an association; an empty string is none; a Classic id is neither", () => {
    expect(parseDistributionWebAcl("")).toBeNull()
    expect(parseDistributionWebAcl(undefined)).toBeNull()

    const v2 = parseDistributionWebAcl(EDGE_ACL)
    expect(v2?.kind).toBe("web-acl")
    if (v2?.kind !== "web-acl") throw new Error("narrowing")
    expect(v2.arn).toBe(EDGE_ACL)
    expect(v2.name).toBe("tenure-prod-edge")
    // Named, but its rules are not readable without wafv2:GetWebACL.
    expect(v2.detail.kind).toBe("not-readable")

    const classic = parseDistributionWebAcl("473e64fd-f30b-4765-81a0-62ad96dd167a")
    expect(classic?.kind).toBe("waf-classic")
  })

  test("a Classic-protected distribution is not reported as unprotected", async () => {
    const readings = await load({
      regional: "empty",
      cloudfront: "empty",
      loadBalancers: "empty",
      distributions: [
        {
          arn: DISTRIBUTION,
          id: "E1TENUREPILOT",
          domain: "d111111abcdef8.cloudfront.net",
          webAclId: "473e64fd-f30b-4765-81a0-62ad96dd167a",
        },
      ],
    })
    const row = readings.protection.find((r) => r.target.arn === DISTRIBUTION)
    expect(row?.association.state).toBe("ACTUAL")
    if (row?.association.state !== "ACTUAL") throw new Error("narrowing")
    expect(row.association.value.kind).toBe("waf-classic")

    const text = surfaceText(readings)
    expect(text).toContain("WAF Classic")
    expect(text).not.toContain("NO WEB ACL")
    // Both WAFv2 scopes are empty, but something IS in front of the edge, so
    // the "no web application firewall" headline would be false.
    expect(readings.coverage.kind).not.toBe("no-web-acl-exists")
  })

  test("a distribution behind a WAFv2 ACL is attached but its rules are not claimed to be read", async () => {
    const readings = await load({
      regional: "empty",
      cloudfront: "populated",
      loadBalancers: "empty",
      distributions: [
        {
          arn: DISTRIBUTION,
          id: "E1TENUREPILOT",
          domain: "d111111abcdef8.cloudfront.net",
          webAclId: EDGE_ACL,
        },
      ],
    })
    expect(readings.coverage.kind).toBe("protected")
    if (readings.coverage.kind !== "protected") throw new Error("narrowing")
    expect(readings.coverage.protectedCount).toBe(1)
    expect(readings.coverage.blockingConfirmed).toBe(0)
    expect(readings.coverage.detailUnread).toEqual(["d111111abcdef8.cloudfront.net"])

    const text = surfaceText(readings)
    expect(text).toContain("could NOT be read")
    expect(text).toContain("wafv2:GetWebACL")
  })
})

/* ------------------------------------------------------------- count mode -- */

describe("count mode is not protection", () => {
  test("an ACL whose every rule counts is monitoring-only, not protected", async () => {
    const readings = await load({
      regional: "populated",
      distributions: "empty",
      loadBalancers: [{ arn: ALB, name: "tenure-prod-alb", type: "application" }],
      associations: {
        [ALB]: webAcl("tenure-prod-regional", REGIONAL_ACL_ID, REGIONAL_ACL, {
          defaultAction: "allow",
          rules: [
            managedGroupRule("Common", "AWS", "AWSManagedRulesCommonRuleSet", "count"),
            rateRule("RateLimit", 2000, "count"),
          ],
        }),
      },
    })

    expect(readings.coverage.kind).toBe("monitoring-only")
    const text = surfaceText(readings)
    expect(text).toContain("MONITORING ONLY")
    expect(text).toContain("BLOCKS NOTHING")
    expect(text).toContain("does NOT block")
  })

  test("a rule group overridden to Count blocks nothing; the same group with None does", () => {
    expect(actionBlocks(parseRuleAction(undefined, { Count: {} }))).toBe(false)
    expect(actionBlocks(parseRuleAction(undefined, { None: {} }))).toBe(true)
    expect(actionBlocks(parseRuleAction({ Count: {} }, undefined))).toBe(false)
    expect(actionBlocks(parseRuleAction({ Block: {} }, undefined))).toBe(true)
    // An action this engine did not recognise is NOT evidence of blocking.
    const unreadable = parseRuleAction({ SomethingNew: {} }, undefined)
    expect(unreadable.kind).toBe("unreadable")
    expect(actionBlocks(unreadable)).toBe(false)
  })

  test("a Block default action makes an ACL with no blocking rule still block", async () => {
    const readings = await load({
      regional: "populated",
      distributions: "empty",
      loadBalancers: [{ arn: ALB, name: "tenure-prod-alb", type: "application" }],
      associations: {
        [ALB]: webAcl("tenure-prod-regional", REGIONAL_ACL_ID, REGIONAL_ACL, {
          defaultAction: "block",
          rules: [managedGroupRule("Common", "AWS", "AWSManagedRulesCommonRuleSet", "count")],
        }),
      },
    })
    expect(readings.coverage.kind).toBe("protected")
    expect(surfaceText(readings)).toContain("default action BLOCK")
  })
})

/* ---------------------------------------------------------------- the bound -- */

describe("pagination completes, and says so when it was capped", () => {
  test("a listing that never ends is capped, is NOT empty, and says there were more", async () => {
    const calls: string[] = []
    const readings = await wafReadings(
      fakeAws({ calls, regional: "truncated", cloudfront: "empty" }),
      { now: AT },
    )

    expect(readings.regional.state).toBe("ACTUAL")
    if (readings.regional.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.regional.value.truncation.kind).toBe("capped")
    if (readings.regional.value.truncation.kind !== "capped") throw new Error("narrowing")
    expect(readings.regional.value.truncation.pages).toBe(MAX_WEB_ACL_PAGES)

    // The bound actually bit: exactly MAX_WEB_ACL_PAGES calls for the REGIONAL
    // scope, plus one for the CLOUDFRONT scope. Unbounded paging is how one
    // agent takes down the console.
    expect(calls.filter((c) => c === "wafv2:ListWebACLs")).toHaveLength(MAX_WEB_ACL_PAGES + 1)

    const text = surfaceText(readings)
    expect(text).toContain("INCOMPLETE")
    expect(text).toContain("this list is NOT the whole scope")
  })

  test("an empty page with a marker is still not EMPTY — it is capped with nothing read", async () => {
    const readings = await load({ regional: "truncated", regionalAcls: [], cloudfront: "empty" })
    // Nothing was read, and yet this is emphatically not "there is nothing here".
    expect(readings.regional.state).toBe("ACTUAL")
    if (readings.regional.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.regional.value.acls).toHaveLength(0)
    expect(readings.regional.value.truncation.kind).toBe("capped")
    expect(readings.coverage.kind).not.toBe("no-web-acl-exists")
  })
})

/* ------------------------------------------------------------ attribution -- */

describe("attribution comes from a tag, and an unread tag index says so", () => {
  test("a tagged web ACL attributes to its tenant", async () => {
    const readings = await load({
      regional: "populated",
      tags: {
        [REGIONAL_ACL]: [
          { Key: "tenure:tenant", Value: "northgate-university" },
          { Key: "tenure:environment", Value: "production" },
        ],
      },
    })
    if (readings.regional.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.regional.value.acls[0].attribution).toEqual({
      kind: "tenant",
      tenantSlug: "northgate-university",
    })
    expect(surfaceText(readings)).toContain("northgate-university")
  })

  test("a denied tag index is 'attribution unknown', never 'unattributable'", async () => {
    const readings = await load({ regional: "populated", tagsOutcome: "denied" })
    if (readings.regional.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.regional.value.acls[0].attribution.kind).toBe("unknown")

    const text = surfaceText(readings)
    expect(text).toContain("attribution unknown")
    expect(text).not.toContain("unattributable — missing tenure:tenant")
  })

  test("a tag index that answered, with no tag for this ARN, IS unattributable", async () => {
    const readings = await load({ regional: "populated", tags: {} })
    if (readings.regional.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.regional.value.acls[0].attribution).toEqual({ kind: "unattributed" })
    expect(surfaceText(readings)).toContain("unattributable — missing tenure:tenant")
  })
})

/* --------------------------------------------------------- as of / cadence -- */

describe("every reading carries when it was taken and how often it is re-read", () => {
  test("the cadence comes from the capability registry and the timestamp from the clock", async () => {
    const readings = await load({ regional: "populated" })
    expect(readings.asOf).toBe("2026-08-13T09:15:00.000Z")
    // WAF_TTL_MS, read from capabilities.ts rather than retyped here.
    expect(readings.refreshMs.webAcls).toBe(900_000)
    expect(readings.refreshMs.association).toBe(900_000)
    for (const row of readings.protection) {
      expect(row.asOf).toBe("2026-08-13T09:15:00.000Z")
      expect(row.refreshMs).toBeGreaterThan(0)
    }
    expect(surfaceText(readings)).toContain("refreshed every 900s")
  })

  test("an unenumerable load balancer listing makes coverage unknown, not protected", async () => {
    const readings = await load({
      regional: "populated",
      cloudfront: "empty",
      loadBalancers: "denied",
    })
    expect(readings.loadBalancers.state).toBe("DENIED")
    expect(readings.coverage.kind).toBe("unknown")
    if (readings.coverage.kind !== "unknown") throw new Error("narrowing")
    expect(readings.coverage.why).toContain("could not enumerate")
  })
})
