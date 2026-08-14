import {
  attachmentsFromLoadBalancers,
  classifySubnet,
  describeAttachment,
  leadAnswer,
  networkAnswer,
  openPaths,
  pathSeverity,
  plaintextListeners,
  portsPhrase,
  rankPaths,
  sensitivePortsCovered,
  servingVerdict,
  subnetRows,
  tallyTargets,
  targetSeverity,
  unattachedCandidates,
  unhealthyTargets,
  vpcRows,
  type AttachmentIndex,
} from "./answer"
import type { Capability } from "../../../lib/aws/capabilities"
import type {
  LoadBalancerReading,
  LoadBalancerReadings,
  ListenerReading,
  TargetGroupReading,
  TargetHealthReading,
} from "../../../lib/aws/loadbalancer"
import type {
  NetworkReadings,
  PagedList,
  SecurityGroupReading,
  SecurityGroupRule,
  SubnetReading,
  InternetIngressFinding,
  VpcReading,
} from "../../../lib/aws/network"
import type { AwsRead } from "../../../lib/aws/read"

/**
 * `/platform/network`'s decisions, driven with no browser, no server and no AWS
 * account.
 *
 * `e2e/network-surface.spec.ts` is the browser half: that the route boots
 * without credentials and renders a named unknown rather than an empty list.
 * This is the half a browser pointed at any estate cannot reach at all. Every
 * arm below needs a condition an operator only sees on their worst morning:
 *
 *   * `ec2:DescribeSecurityGroups` REFUSED — which a naive page renders as
 *     "0 paths from the internet", a clean bill of health for an estate nobody
 *     was allowed to look at;
 *   * a rule from `0.0.0.0/0` spanning 3000–4000, which opens 3306 without
 *     either endpoint being it;
 *   * a target reporting `Target.ResponseCodeMismatch`, and another reporting
 *     no reason code at all;
 *   * a subnet named `tenure-prod-private-a` whose route table sends
 *     `0.0.0.0/0` to an internet gateway;
 *   * a security group an internet-facing load balancer is carrying, while the
 *     load balancer listing is REFUSED.
 *
 * Each `it` states the rule it defends in its name, and each was mutation-proven
 * — the assertion was watched to FAIL against a deliberately broken
 * implementation before being kept.
 *
 * ── The fixtures are fictional and are labelled as such ────────────────────
 *
 * `000000000000` is not an account this platform owns or has ever read; it is
 * the all-zero placeholder, chosen precisely because no real account can be it.
 * Every id below is shaped like AWS's and belongs to nothing.
 */

/* ────────────────────────────────────────────────────────── fixtures ────── */

const NOW = "2026-08-13T09:00:00.000Z"
const ACCOUNT = "000000000000"
const REGION = "eu-west-2"

function actual<T>(capability: Capability, value: T): AwsRead<T> {
  return { state: "ACTUAL", capability, value, asOf: NOW, fresh: true }
}

function empty<T>(capability: Capability): AwsRead<T> {
  return { state: "EMPTY", capability, asOf: NOW }
}

function denied<T>(capability: Capability, action: string): AwsRead<T> {
  return {
    state: "DENIED",
    capability,
    action,
    principal: `arn:aws:sts::${ACCOUNT}:assumed-role/studio-reader/test`,
    accountId: ACCOUNT,
    region: REGION,
    partition: "aws",
    errorCode: "AccessDeniedException",
    minimumStatement: `{"Effect":"Allow","Action":"${action}","Resource":"*"}`,
  }
}

function paged<T>(items: readonly T[], truncated = false): PagedList<T> {
  return { items, truncated, pages: 1, cap: 40 }
}

/** One flattened security group rule. Every field the reader would have filled. */
function rule(over: Partial<SecurityGroupRule> = {}): SecurityGroupRule {
  return {
    direction: "ingress",
    protocol: "tcp",
    protocolLabel: "TCP",
    fromPort: 443,
    toPort: 443,
    source: "0.0.0.0/0",
    sourceKind: "ipv4",
    description: null,
    world: true,
    ...over,
  }
}

function finding(over: Partial<InternetIngressFinding> = {}): InternetIngressFinding {
  return {
    groupId: "sg-db",
    groupName: "tenure-db",
    vpcId: "vpc-1",
    cidr: "0.0.0.0/0",
    protocol: "tcp",
    protocolLabel: "TCP",
    fromPort: 3306,
    toPort: 3306,
    reach: "0.0.0.0/0 can reach this group on TCP port 3306",
    attribution: { kind: "shared", source: "describe-response" },
    asOf: NOW,
    ...over,
  }
}

function group(over: Partial<SecurityGroupReading> = {}): SecurityGroupReading {
  return {
    groupId: "sg-db",
    groupName: "tenure-db",
    description: "database",
    vpcId: "vpc-1",
    arn: `arn:aws:ec2:${REGION}:${ACCOUNT}:security-group/sg-db`,
    ownerId: ACCOUNT,
    region: REGION,
    partition: "aws",
    ingress: [],
    egress: [],
    openIngress: [],
    webIngress: [],
    usage: {
      kind: "no-attachment-visible",
      needs: "ec2:DescribeNetworkInterfaces",
      why: "nothing this engine read refers to sg-db",
    },
    name: null,
    attribution: { kind: "shared", source: "describe-response" },
    tags: {},
    ...over,
  }
}

function subnet(over: Partial<SubnetReading> = {}): SubnetReading {
  return {
    subnetId: "subnet-a",
    vpcId: "vpc-1",
    arn: `arn:aws:ec2:${REGION}:${ACCOUNT}:subnet/subnet-a`,
    cidrBlock: "10.0.1.0/24",
    ipv6CidrBlocks: [],
    availabilityZone: `${REGION}a`,
    availabilityZoneId: "euw2-az1",
    mapPublicIpOnLaunch: false,
    availableIpAddressCount: 250,
    state: "available",
    ownerId: ACCOUNT,
    region: REGION,
    partition: "aws",
    name: null,
    reachability: { kind: "private", routeTableId: "rtb-1", association: "explicit", egress: "nat", egressVia: ["nat-1"] },
    attribution: { kind: "shared", source: "describe-response" },
    tags: {},
    ...over,
  }
}

function vpc(over: Partial<VpcReading> = {}): VpcReading {
  return {
    vpcId: "vpc-1",
    arn: `arn:aws:ec2:${REGION}:${ACCOUNT}:vpc/vpc-1`,
    cidrBlock: "10.0.0.0/16",
    cidrBlocks: ["10.0.0.0/16"],
    ipv6CidrBlocks: [],
    state: "available",
    isDefault: false,
    ownerId: ACCOUNT,
    region: REGION,
    partition: "aws",
    name: "tenure-prod",
    attribution: { kind: "shared", source: "describe-response" },
    tags: {},
    ...over,
  }
}

function target(over: Partial<TargetHealthReading> = {}): TargetHealthReading {
  return {
    targetId: "10.0.1.10",
    port: 3000,
    availabilityZone: `${REGION}a`,
    healthCheckPort: "3000",
    health: { kind: "healthy" },
    ...over,
  }
}

function targetGroup(over: Partial<TargetGroupReading> = {}): TargetGroupReading {
  const health: AwsRead<readonly TargetHealthReading[]> = actual(
    "elasticloadbalancing:DescribeTargetHealth",
    [target()],
  )
  return {
    arn: `arn:aws:elasticloadbalancing:${REGION}:${ACCOUNT}:targetgroup/tenure-web/aaaa`,
    name: "tenure-web",
    protocol: "HTTP",
    port: 3000,
    vpcId: "vpc-1",
    targetType: "ip",
    protocolVersion: "HTTP1",
    loadBalancerArns: [],
    healthCheck: {
      enabled: true,
      protocol: "HTTP",
      port: "traffic-port",
      path: "/api/health",
      intervalSeconds: 30,
      timeoutSeconds: 5,
      healthyThreshold: 2,
      unhealthyThreshold: 2,
      matcher: "200",
    },
    attribution: { kind: "shared" },
    health,
    serving: { kind: "all-serving", healthy: 1 },
    refreshMs: 10_000,
    asOf: NOW,
    ...over,
  }
}

function listener(over: Partial<ListenerReading> = {}): ListenerReading {
  return {
    arn: `arn:aws:elasticloadbalancing:${REGION}:${ACCOUNT}:listener/app/tenure/aaaa/bbbb`,
    loadBalancerArn: `arn:aws:elasticloadbalancing:${REGION}:${ACCOUNT}:loadbalancer/app/tenure/aaaa`,
    port: 80,
    protocol: "HTTP",
    tls: {
      kind: "plaintext-no-redirect",
      protocol: "HTTP",
      why: "this listener speaks HTTP, its default action is not a redirect to HTTPS, and no listener rule redirects to HTTPS either.",
    },
    certificates: [],
    sslPolicy: null,
    defaultActionTypes: ["forward"],
    forwardsTo: [],
    refreshMs: 180_000,
    asOf: NOW,
    ...over,
  }
}

function loadBalancer(over: Partial<LoadBalancerReading> = {}): LoadBalancerReading {
  return {
    arn: `arn:aws:elasticloadbalancing:${REGION}:${ACCOUNT}:loadbalancer/app/tenure/aaaa`,
    name: "tenure-alb",
    type: "application",
    scheme: { kind: "internet-facing" },
    dnsName: "tenure-alb-000000000.eu-west-2.elb.amazonaws.com",
    vpcId: "vpc-1",
    stateCode: "active",
    stateReason: null,
    availabilityZones: [`${REGION}a`],
    subnetIds: ["subnet-a"],
    securityGroupIds: ["sg-alb"],
    ipAddressType: "ipv4",
    createdAt: NOW,
    region: REGION,
    partition: "aws",
    accountId: ACCOUNT,
    attribution: { kind: "shared" },
    listeners: actual("elasticloadbalancing:DescribeListeners", [listener()]),
    targetGroups: actual("elasticloadbalancing:DescribeTargetGroups", [targetGroup()]),
    refreshMs: 180_000,
    asOf: NOW,
    ...over,
  }
}

function balancers(
  read: AwsRead<readonly LoadBalancerReading[]> = actual(
    "elasticloadbalancing:DescribeLoadBalancers",
    [loadBalancer()],
  ),
): LoadBalancerReadings {
  return {
    identity: actual("sts:GetCallerIdentity", {
      accountId: ACCOUNT,
      arn: `arn:aws:sts::${ACCOUNT}:assumed-role/studio-reader/test`,
      partition: "aws",
      region: REGION,
    }),
    tagged: empty("tag:GetResources"),
    loadBalancers: read,
    findings: [],
    truncation: { kind: "complete" },
    asOf: NOW,
    refreshMs: {
      loadBalancers: 180_000,
      listeners: 180_000,
      targetGroups: 180_000,
      targetHealth: 10_000,
      rules: 180_000,
    },
  }
}

function network(over: Partial<NetworkReadings> = {}): NetworkReadings {
  return {
    identity: actual("sts:GetCallerIdentity", {
      accountId: ACCOUNT,
      arn: `arn:aws:sts::${ACCOUNT}:assumed-role/studio-reader/test`,
      partition: "aws",
      region: REGION,
    }),
    tagged: empty("tag:GetResources"),
    vpcs: actual("ec2:DescribeVpcs", paged([vpc()])),
    subnets: actual("ec2:DescribeSubnets", paged([subnet()])),
    routeTables: empty("ec2:DescribeRouteTables"),
    internetGateways: empty("ec2:DescribeInternetGateways"),
    natGateways: empty("ec2:DescribeNatGateways"),
    vpcEndpoints: empty("ec2:DescribeVpcEndpoints"),
    networkAcls: empty("ec2:DescribeNetworkAcls"),
    securityGroups: actual("ec2:DescribeSecurityGroups", paged([group()])),
    exposure: { kind: "closed", groupsRead: 1, webFacingGroupIds: [], truncated: false },
    unreferencedSecurityGroupIds: [],
    contradictoryNames: [],
    asOf: NOW,
    refreshMs: {
      vpcs: 300_000,
      subnets: 300_000,
      routeTables: 300_000,
      internetGateways: 300_000,
      natGateways: 300_000,
      vpcEndpoints: 300_000,
      networkAcls: 300_000,
      securityGroups: 300_000,
    },
    ...over,
  }
}

const NO_ATTACHMENTS: AttachmentIndex = {
  byGroup: new Map(),
  loadBalancersRead: true,
  why: "",
}

/* ──────────────────────────────────────────────── a refused read is not 0 ── */

describe("a security-group read that did not answer", () => {
  it("is unknown, never a count of zero paths", () => {
    const read = denied<PagedList<SecurityGroupReading>>(
      "ec2:DescribeSecurityGroups",
      "ec2:DescribeSecurityGroups",
    )
    const paths = openPaths(read, NO_ATTACHMENTS)

    expect(paths.kind).toBe("unknown")
    // The remedy travels with the absence: the reader's own sentence names the
    // action, and this page prints it rather than a number.
    if (paths.kind !== "unknown") throw new Error("unreachable")
    expect(paths.why).toContain("ec2:DescribeSecurityGroups")
  })

  it("makes the lead say so in words, with no path count at all", () => {
    const lead = leadAnswer(
      { kind: "unknown", why: "ec2:DescribeSecurityGroups was refused." },
      servingVerdict(balancers()),
    )
    expect(lead.verdict).toBe("Unknown")
    expect(lead.tone).toBe("warn")
    expect(lead.headline).toContain("cannot say what can reach this estate")
    expect(lead.headline).not.toMatch(/\b0 path/)
  })

  it("is distinguished from a read that answered with no security group at all", () => {
    const paths = openPaths(empty("ec2:DescribeSecurityGroups"), NO_ATTACHMENTS)
    expect(paths.kind).toBe("known")
    if (paths.kind !== "known") throw new Error("unreachable")
    expect(paths.paths).toHaveLength(0)
    expect(paths.groupsRead).toBe(0)
  })
})

/* ──────────────────────────────────────────────────────────── grading ───── */

describe("how hard a path from the internet is", () => {
  it("is critical for a range that COVERS a sensitive port, not only one that lands on it", () => {
    // 3000–4000 opens 3306. A check comparing the two endpoints against a list
    // would wave this through, which is the defect this assertion exists for.
    expect(sensitivePortsCovered(3000, 4000)).toEqual([
      "3306 (MySQL / Aurora MySQL)",
      "3389 (RDP)",
    ])
    expect(pathSeverity(true, 3000, 4000)).toBe("critical")
  })

  it("is critical when the rule has no port concept at all", () => {
    expect(pathSeverity(true, null, null)).toBe("critical")
  })

  it("is high for anything else open past 80 and 443", () => {
    expect(pathSeverity(true, 8080, 8080)).toBe("high")
    expect(sensitivePortsCovered(8080, 8080)).toEqual([])
  })

  it("is low — and never absent — for 80 and 443 from the whole internet", () => {
    expect(pathSeverity(false, 443, 443)).toBe("low")
  })

  it("names the ports in words, and an absent port range as an absence", () => {
    expect(portsPhrase(22, 22)).toBe("port 22")
    expect(portsPhrase(80, 443)).toBe("ports 80–443 (364 ports)")
    expect(portsPhrase(null, null)).toBe("no port restriction")
  })
})

describe("the ranked table", () => {
  const read = actual(
    "ec2:DescribeSecurityGroups",
    paged([
      group({
        groupId: "sg-web",
        webIngress: [rule({ source: "0.0.0.0/0", fromPort: 443, toPort: 443 })],
      }),
      group({
        groupId: "sg-db",
        openIngress: [finding({ groupId: "sg-db", fromPort: 3306, toPort: 3306 })],
      }),
    ]),
  )

  it("puts the worst first — a database on the internet above an open 443", () => {
    const paths = openPaths(read, NO_ATTACHMENTS)
    if (paths.kind !== "known") throw new Error("unreachable")
    expect(paths.paths.map((path) => path.severity)).toEqual(["critical", "low"])
    expect(paths.paths[0].groupId).toBe("sg-db")
    expect(paths.paths[0].sensitive).toEqual(["3306 (MySQL / Aurora MySQL)"])
  })

  it("counts the two kinds separately, because only one of them is a finding", () => {
    const paths = openPaths(read, NO_ATTACHMENTS)
    if (paths.kind !== "known") throw new Error("unreachable")
    expect(paths.beyondWeb).toBe(1)
    expect(paths.webOnly).toBe(1)
    expect(paths.paths).toHaveLength(2)
  })

  it("sorts deterministically, so two loads of the same estate render alike", () => {
    const rows = openPaths(read, NO_ATTACHMENTS)
    if (rows.kind !== "known") throw new Error("unreachable")
    const reversed = rankPaths([...rows.paths].reverse())
    expect(reversed.map((path) => path.key)).toEqual(rows.paths.map((path) => path.key))
  })
})

/* ──────────────────────────────────────── the join neither reader can do ── */

describe("what carries a security group", () => {
  it("names the load balancer, which the network reader alone cannot see", () => {
    const index = attachmentsFromLoadBalancers(balancers())
    expect(index.loadBalancersRead).toBe(true)
    expect(describeAttachment(group({ groupId: "sg-alb" }), index)).toBe(
      "attached to load balancer tenure-alb",
    )
  })

  it("never says unused, and names the grant that would settle it", () => {
    const said = describeAttachment(group({ groupId: "sg-db" }), NO_ATTACHMENTS)
    expect(said).toContain("no attachment visible to this engine")
    expect(said).toContain("ec2:DescribeNetworkInterfaces")
    expect(said).not.toContain("unused")
  })

  it("says the load balancers were unread when they were, rather than implying nothing carries it", () => {
    const index = attachmentsFromLoadBalancers(
      balancers(
        denied<readonly LoadBalancerReading[]>(
          "elasticloadbalancing:DescribeLoadBalancers",
          "elasticloadbalancing:DescribeLoadBalancers",
        ),
      ),
    )
    expect(index.loadBalancersRead).toBe(false)
    expect(describeAttachment(group({ groupId: "sg-alb" }), index)).toContain(
      "the load balancers were not read at all",
    )
  })
})

describe("security groups nothing this engine read carries", () => {
  const groups = actual(
    "ec2:DescribeSecurityGroups",
    paged([group({ groupId: "sg-alb" }), group({ groupId: "sg-orphan" })]),
  )

  it("excludes a group a load balancer is carrying", () => {
    const index = attachmentsFromLoadBalancers(balancers())
    const reading = unattachedCandidates(groups, index)
    expect(reading.kind).toBe("candidates")
    if (reading.kind !== "candidates") throw new Error("unreachable")
    expect(reading.groups.map((row) => row.groupId)).toEqual(["sg-orphan"])
  })

  it("names no candidate at all while the load balancer listing is unread", () => {
    // The defect this bars: a group an internet-facing ALB is carrying,
    // appearing on a list an operator might act on by deleting it.
    const index = attachmentsFromLoadBalancers(
      balancers(
        denied<readonly LoadBalancerReading[]>(
          "elasticloadbalancing:DescribeLoadBalancers",
          "elasticloadbalancing:DescribeLoadBalancers",
        ),
      ),
    )
    const reading = unattachedCandidates(groups, index)
    expect(reading.kind).toBe("unknown")
    if (reading.kind !== "unknown") throw new Error("unreachable")
    expect(reading.why).toContain("while the load balancers are unread")
  })

  it("keeps the word CANDIDATE even when both reads answered", () => {
    const reading = unattachedCandidates(groups, attachmentsFromLoadBalancers(balancers()))
    if (reading.kind !== "candidates") throw new Error("unreachable")
    expect(reading.caveat).toContain("candidates, not findings")
    expect(reading.caveat).toContain("ec2:DescribeNetworkInterfaces")
  })
})

/* ───────────────────────────────────────────────────── is it serving? ───── */

describe("whether traffic is getting to the services", () => {
  it("cannot say all-healthy while one target group's health is unreadable", () => {
    const unreadable = targetGroup({
      arn: "arn:aws:elasticloadbalancing:eu-west-2:000000000000:targetgroup/tenure-api/bbbb",
      name: "tenure-api",
      health: denied<readonly TargetHealthReading[]>(
        "elasticloadbalancing:DescribeTargetHealth",
        "elasticloadbalancing:DescribeTargetHealth",
      ),
      serving: { kind: "unknown", why: "elasticloadbalancing:DescribeTargetHealth was refused." },
    })
    const readings = balancers(
      actual("elasticloadbalancing:DescribeLoadBalancers", [
        loadBalancer({
          targetGroups: actual("elasticloadbalancing:DescribeTargetGroups", [
            targetGroup(),
            unreadable,
          ]),
        }),
      ]),
    )
    const verdict = servingVerdict(readings)
    expect(verdict.kind).toBe("partly-unknown")
    expect(verdict.why).toContain("did not answer a health call")
  })

  it("cannot say all-healthy while a load balancer's target groups are unreadable", () => {
    const readings = balancers(
      actual("elasticloadbalancing:DescribeLoadBalancers", [
        loadBalancer(),
        loadBalancer({
          arn: "arn:aws:elasticloadbalancing:eu-west-2:000000000000:loadbalancer/app/tenure-2/cccc",
          name: "tenure-alb-2",
          targetGroups: denied<readonly TargetGroupReading[]>(
            "elasticloadbalancing:DescribeTargetGroups",
            "elasticloadbalancing:DescribeTargetGroups",
          ),
        }),
      ]),
    )
    expect(servingVerdict(readings).kind).toBe("partly-unknown")
  })

  it("cannot say all-healthy while a target group holds no registered target", () => {
    const readings = balancers(
      actual("elasticloadbalancing:DescribeLoadBalancers", [
        loadBalancer({
          targetGroups: actual("elasticloadbalancing:DescribeTargetGroups", [
            targetGroup({
              health: empty("elasticloadbalancing:DescribeTargetHealth"),
              serving: { kind: "no-targets", why: "no registered targets." },
            }),
          ]),
        }),
      ]),
    )
    expect(servingVerdict(readings).kind).toBe("partly-unknown")
  })

  it("says all-healthy only when every health call answered and nothing is refused", () => {
    const verdict = servingVerdict(balancers())
    expect(verdict.kind).toBe("all-healthy")
    if (verdict.kind !== "all-healthy") throw new Error("unreachable")
    expect(verdict.healthy).toBe(1)
    expect(verdict.groups).toBe(1)
  })

  it("tells a refused listing apart from an account with no load balancer", () => {
    expect(
      servingVerdict(
        balancers(
          denied<readonly LoadBalancerReading[]>(
            "elasticloadbalancing:DescribeLoadBalancers",
            "elasticloadbalancing:DescribeLoadBalancers",
          ),
        ),
      ).kind,
    ).toBe("unknown")
    expect(
      servingVerdict(balancers(empty("elasticloadbalancing:DescribeLoadBalancers"))).kind,
    ).toBe("no-load-balancers")
  })

  it("counts what was read without letting an unread group inflate the healthy total", () => {
    const tally = tallyTargets(balancers())
    expect(tally).toEqual({
      groups: 1,
      healthy: 1,
      notServing: 0,
      groupsUnreadable: 0,
      groupsWithNoTargets: 0,
      loadBalancersUnreadable: 0,
      loadBalancers: 1,
    })
  })
})

/* ──────────────────────────────────────────────────── the reason code ───── */

describe("a target the load balancer refuses", () => {
  const degraded = balancers(
    actual("elasticloadbalancing:DescribeLoadBalancers", [
      loadBalancer({
        targetGroups: actual("elasticloadbalancing:DescribeTargetGroups", [
          targetGroup({
            serving: {
              kind: "degraded",
              healthy: 1,
              notServing: [
                {
                  targetId: "10.0.1.11",
                  port: 3000,
                  state: "unhealthy",
                  reasonCode: "Target.ResponseCodeMismatch",
                  description: "Health checks failed with these codes: [503]",
                },
                {
                  targetId: "10.0.1.12",
                  port: 3000,
                  state: "unhealthy",
                  reasonCode: null,
                  description: "AWS reported target 10.0.1.12 as unhealthy with no Reason code.",
                },
              ],
            },
          }),
        ]),
      }),
    ]),
  )

  it("keeps AWS's reason code verbatim — Timeout and ResponseCodeMismatch are different places to go", () => {
    const rows = unhealthyTargets(degraded)
    expect(rows.map((row) => row.reasonCode)).toEqual(["Target.ResponseCodeMismatch", null])
  })

  it("carries a missing reason code as null, never as an empty string", () => {
    const rows = unhealthyTargets(degraded)
    const missing = rows.find((row) => row.targetId === "10.0.1.12")
    expect(missing?.reasonCode).toBeNull()
    expect(missing?.reasonCode).not.toBe("")
    expect(missing?.description).toContain("no Reason code")
  })

  it("grades a draining target below an unhealthy one — a deploy is not an outage", () => {
    expect(targetSeverity("draining")).toBe("low")
    expect(targetSeverity("initial")).toBe("medium")
    expect(targetSeverity("unhealthy")).toBe("high")
    expect(targetSeverity("unused")).toBe("high")
  })

  it("makes the lead say the estate is not serving", () => {
    const lead = leadAnswer(
      openPaths(empty("ec2:DescribeSecurityGroups"), NO_ATTACHMENTS),
      servingVerdict(degraded),
    )
    expect(lead.verdict).toBe("Not serving")
    expect(lead.tone).toBe("bad")
  })
})

/* ─────────────────────────────────────────────────── plaintext listeners ── */

describe("an HTTP listener with no redirect to HTTPS", () => {
  const withBoth = balancers(
    actual("elasticloadbalancing:DescribeLoadBalancers", [
      loadBalancer({
        listeners: actual("elasticloadbalancing:DescribeListeners", [
          listener(),
          listener({
            arn: "arn:aws:elasticloadbalancing:eu-west-2:000000000000:listener/app/tenure/aaaa/cccc",
            port: 8080,
            tls: {
              kind: "plaintext-redirect-unknown",
              protocol: "HTTP",
              why: "whether a listener RULE redirects could not be established.",
            },
          }),
        ]),
      }),
    ]),
  )

  it("is only a finding when this engine established there is no redirect anywhere", () => {
    const split = plaintextListeners(withBoth)
    expect(split.confirmed.map((row) => row.port)).toEqual([80])
    expect(split.unknown.map((row) => row.port)).toEqual([8080])
  })

  it("is graded harder on an internet-facing load balancer than on an internal one", () => {
    expect(plaintextListeners(withBoth).confirmed[0].severity).toBe("high")
    const internal = balancers(
      actual("elasticloadbalancing:DescribeLoadBalancers", [
        loadBalancer({
          scheme: { kind: "internal" },
          listeners: actual("elasticloadbalancing:DescribeListeners", [listener()]),
        }),
      ]),
    )
    expect(plaintextListeners(internal).confirmed[0].severity).toBe("medium")
  })

  it("draws nothing at all from a listener read that did not answer", () => {
    const refused = balancers(
      actual("elasticloadbalancing:DescribeLoadBalancers", [
        loadBalancer({
          listeners: denied<readonly ListenerReading[]>(
            "elasticloadbalancing:DescribeListeners",
            "elasticloadbalancing:DescribeListeners",
          ),
        }),
      ]),
    )
    const split = plaintextListeners(refused)
    expect(split.confirmed).toHaveLength(0)
    expect(split.unknown).toHaveLength(0)
  })
})

/* ──────────────────────────────────── public is a property of the route ── */

describe("public versus private", () => {
  const misnamed = subnet({
    subnetId: "subnet-lie",
    name: "tenure-prod-private-a",
    reachability: {
      kind: "public",
      via: "igw-1",
      destination: "0.0.0.0/0",
      routeTableId: "rtb-public",
      association: "explicit",
    },
  })

  it("is decided by the route table even when the name says the opposite", () => {
    const classified = classifySubnet(misnamed)
    expect(classified.verdict).toBe("PUBLIC")
    expect(classified.evidence).toContain("rtb-public")
    expect(classified.evidence).toContain("igw-1")
  })

  it("prints the route table that produced the verdict, so the classifier can be checked", () => {
    const rows = subnetRows(actual("ec2:DescribeSubnets", paged([subnet()])), [])
    expect(rows[0].verdict).toBe("private")
    expect(rows[0].evidence).toContain("rtb-1")
    expect(rows[0].evidence).toContain("nat-1")
  })

  it("is unknown — never private — when the route tables could not be read", () => {
    const unread = subnet({
      reachability: {
        kind: "unknown",
        why: "ec2:DescribeRouteTables was refused. Not private — unread.",
      },
    })
    const classified = classifySubnet(unread)
    expect(classified.verdict).toBe("unknown")
    expect(classified.verdict).not.toBe("private")
    expect(classified.evidence).toContain("Not private — unread")
  })

  it("carries the contradiction through to the row", () => {
    const rows = subnetRows(actual("ec2:DescribeSubnets", paged([misnamed])), [
      {
        subnetId: "subnet-lie",
        name: "tenure-prod-private-a",
        routeTableId: "rtb-public",
        via: "igw-1",
        why: "it is a public subnet. The name is wrong, not the route.",
      },
    ])
    expect(rows[0].misnamed).toBe(true)
  })

  it("draws no row at all from a subnet read that did not answer", () => {
    expect(
      subnetRows(
        denied<PagedList<SubnetReading>>("ec2:DescribeSubnets", "ec2:DescribeSubnets"),
        [],
      ),
    ).toHaveLength(0)
  })

  it("counts a VPC's subnets by their route-table verdict", () => {
    const rows = subnetRows(actual("ec2:DescribeSubnets", paged([subnet(), misnamed])), [])
    const vpcs = vpcRows(actual("ec2:DescribeVpcs", paged([vpc()])), rows)
    expect(vpcs[0]).toMatchObject({ vpcId: "vpc-1", publicSubnets: 1, privateSubnets: 1, unknownSubnets: 0 })
  })
})

/* ────────────────────────────────────────────────────────── the lead ───── */

describe("the answer at the top of the page", () => {
  it("reports an open path before it reports anything about serving", () => {
    const paths = openPaths(
      actual("ec2:DescribeSecurityGroups", paged([group({ openIngress: [finding()] })])),
      NO_ATTACHMENTS,
    )
    const lead = leadAnswer(paths, servingVerdict(balancers()))
    expect(lead.verdict).toBe("Open to the internet")
    expect(lead.tone).toBe("bad")
  })

  it("refuses to say closed when the security-group walk stopped at its page cap", () => {
    const truncated = openPaths(
      actual("ec2:DescribeSecurityGroups", paged([group()], true)),
      NO_ATTACHMENTS,
    )
    const lead = leadAnswer(truncated, servingVerdict(balancers()))
    expect(lead.tone).not.toBe("ok")
    expect(lead.verdict).toBe("Partly read")
    expect(lead.because).toContain("stopped at its page cap")
  })

  it("says closed and serving only when both halves answered and both are clean", () => {
    const lead = leadAnswer(
      openPaths(actual("ec2:DescribeSecurityGroups", paged([group()])), NO_ATTACHMENTS),
      servingVerdict(balancers()),
    )
    expect(lead.verdict).toBe("Closed and serving")
    expect(lead.tone).toBe("ok")
  })
})

/* ─────────────────────────────────────────────── the whole composition ─── */

describe("networkAnswer — what the route actually calls", () => {
  it("composes both readers into one answer the page renders", () => {
    const answer = networkAnswer(network(), balancers())
    expect(answer.lead.verdict).toBe("Closed and serving")
    expect(answer.paths.kind).toBe("known")
    expect(answer.serving.kind).toBe("all-healthy")
    expect(answer.subnets).toHaveLength(1)
    expect(answer.vpcs).toHaveLength(1)
    expect(answer.plaintext.confirmed).toHaveLength(1)
    expect(answer.attachments.loadBalancersRead).toBe(true)
  })

  it("keeps every panel honest when the security groups are refused", () => {
    const answer = networkAnswer(
      network({
        securityGroups: denied<PagedList<SecurityGroupReading>>(
          "ec2:DescribeSecurityGroups",
          "ec2:DescribeSecurityGroups",
        ),
      }),
      balancers(),
    )
    expect(answer.paths.kind).toBe("unknown")
    expect(answer.unattached.kind).toBe("unknown")
    expect(answer.lead.verdict).toBe("Unknown")
  })
})
