import { SHARED } from "@tenure/provisioning"

import { __resetIdentity } from "./identity"
import {
  MAX_PAGES,
  contradictorySubnetNames,
  describeExposure,
  listOf,
  networkLines,
  networkReadings,
  opensBeyondWeb,
  protocolLabel,
  subnetReachability,
  wasTruncated,
  type NetworkReadings,
} from "./network"
import type { AwsGateway } from "./read"
import { READ_ATTEMPTS, backoffMs } from "./throttle"

/**
 * STUDIO-070-004 (NETWORK) — the network surface tells four different truths
 * apart, and decides public from the route table.
 *
 * The assertions are on `networkReadings` and `networkLines`, the functions a
 * route renders, rather than on `readAws` or on a parser. A test that drove a
 * private helper would stay green on the day this module stopped calling it.
 *
 * ## The stand-in is a client, not a stub
 *
 * `fakeAws` answers ten capabilities with the shapes the real SDK returns —
 * `{Vpcs:[…], NextToken}`, `{Subnets:[…]}`, `{RouteTables:[{Associations,
 * Routes}]}`, `{SecurityGroups:[{IpPermissions:[{IpProtocol, FromPort, ToPort,
 * IpRanges:[{CidrIp}]}]}]}`, `{ResourceTagMappingList:[…]}`, `{Account, Arn}` —
 * and each can fail independently with `AccessDeniedException`,
 * `ThrottlingException`, an empty-but-successful list, or a populated one. A
 * stand-in returning `[]` regardless would prove nothing about code whose whole
 * job is telling those four apart.
 *
 * Every id below is obviously constructed (`vpc-0a1`, account `123456789012`).
 * Nothing here is a real account, ARN or resource.
 */

/* ------------------------------------------------------------- the estate -- */

/** Obviously constructed. Not a real AWS account. */
const ACCOUNT = "123456789012"
const REGION = "eu-west-2"

const VPC_ID = "vpc-0a1"
const IGW_ID = "igw-0a1"
const NAT_ID = "nat-0a1"
const RTB_PUBLIC = "rtb-0public"
const RTB_MAIN = "rtb-0main"
const RTB_TRAP = "rtb-0trap"
const SUBNET_PUBLIC = "subnet-0pub"
const SUBNET_PRIVATE = "subnet-0priv"
const SUBNET_TRAP = "subnet-0trap"
const SG_ALB = "sg-0alb"
const SG_APP = "sg-0app"
const SG_DB = "sg-0db"
const SG_ORPHAN = "sg-0orphan"
const SG_ENDPOINT = "sg-0vpce"

type Tag = { Key: string; Value: string }

function tags(entries: Record<string, string>): Tag[] {
  return Object.entries(entries).map(([Key, Value]) => ({ Key, Value }))
}

interface Estate {
  Vpcs: unknown[]
  Subnets: unknown[]
  RouteTables: unknown[]
  InternetGateways: unknown[]
  NatGateways: unknown[]
  VpcEndpoints: unknown[]
  NetworkAcls: unknown[]
  SecurityGroups: unknown[]
}

/** The estate `infrastructure/terraform/vpc.tf` describes, plus one planted defect. */
function estate(): Estate {
  return {
    Vpcs: [
      {
        VpcId: VPC_ID,
        CidrBlock: "10.0.0.0/16",
        State: "available",
        IsDefault: false,
        OwnerId: ACCOUNT,
        CidrBlockAssociationSet: [
          { CidrBlock: "10.0.0.0/16", CidrBlockState: { State: "associated" } },
        ],
        Tags: tags({ Name: "tenure-prod", "tenure:tenant": SHARED }),
      },
    ],
    Subnets: [
      {
        SubnetId: SUBNET_PUBLIC,
        VpcId: VPC_ID,
        CidrBlock: "10.0.1.0/24",
        AvailabilityZone: `${REGION}a`,
        MapPublicIpOnLaunch: true,
        AvailableIpAddressCount: 250,
        State: "available",
        OwnerId: ACCOUNT,
        Tags: tags({ Name: "tenure-prod-public-a", "tenure:tenant": SHARED }),
      },
      {
        SubnetId: SUBNET_PRIVATE,
        VpcId: VPC_ID,
        CidrBlock: "10.0.10.0/24",
        AvailabilityZone: `${REGION}a`,
        MapPublicIpOnLaunch: false,
        AvailableIpAddressCount: 250,
        State: "available",
        OwnerId: ACCOUNT,
        Tags: tags({ Name: "tenure-prod-private-a", "tenure:tenant": "simon-ose" }),
      },
      {
        // The defect this module exists to catch: named private, routed at an
        // internet gateway, and not even MapPublicIpOnLaunch to give it away.
        SubnetId: SUBNET_TRAP,
        VpcId: VPC_ID,
        CidrBlock: "10.0.11.0/24",
        AvailabilityZone: `${REGION}b`,
        MapPublicIpOnLaunch: false,
        AvailableIpAddressCount: 250,
        State: "available",
        OwnerId: ACCOUNT,
        Tags: tags({ Name: "tenure-prod-private-b" }),
      },
    ],
    RouteTables: [
      {
        RouteTableId: RTB_PUBLIC,
        VpcId: VPC_ID,
        OwnerId: ACCOUNT,
        Associations: [{ RouteTableAssociationId: "rtbassoc-1", SubnetId: SUBNET_PUBLIC }],
        Routes: [
          { DestinationCidrBlock: "10.0.0.0/16", GatewayId: "local", State: "active" },
          { DestinationCidrBlock: "0.0.0.0/0", GatewayId: IGW_ID, State: "active" },
        ],
        Tags: tags({ Name: "tenure-prod-public" }),
      },
      {
        RouteTableId: RTB_MAIN,
        VpcId: VPC_ID,
        OwnerId: ACCOUNT,
        // Main, with no subnet association. SUBNET_PRIVATE uses it anyway, which
        // is the case a check that only looked at explicit associations misses.
        Associations: [{ RouteTableAssociationId: "rtbassoc-2", Main: true }],
        Routes: [
          { DestinationCidrBlock: "10.0.0.0/16", GatewayId: "local", State: "active" },
          { DestinationCidrBlock: "0.0.0.0/0", NatGatewayId: NAT_ID, State: "active" },
        ],
        Tags: tags({ Name: "tenure-prod-private" }),
      },
      {
        RouteTableId: RTB_TRAP,
        VpcId: VPC_ID,
        OwnerId: ACCOUNT,
        Associations: [{ RouteTableAssociationId: "rtbassoc-3", SubnetId: SUBNET_TRAP }],
        Routes: [
          { DestinationCidrBlock: "10.0.0.0/16", GatewayId: "local", State: "active" },
          { DestinationCidrBlock: "0.0.0.0/0", GatewayId: IGW_ID, State: "active" },
        ],
        Tags: tags({ Name: "tenure-prod-private-b-rt" }),
      },
    ],
    InternetGateways: [
      {
        InternetGatewayId: IGW_ID,
        OwnerId: ACCOUNT,
        Attachments: [{ VpcId: VPC_ID, State: "available" }],
        Tags: tags({ Name: "tenure-prod-igw" }),
      },
    ],
    NatGateways: [
      {
        NatGatewayId: NAT_ID,
        VpcId: VPC_ID,
        SubnetId: SUBNET_PUBLIC,
        State: "available",
        ConnectivityType: "public",
        NatGatewayAddresses: [{ PublicIp: "198.51.100.7", PrivateIp: "10.0.1.20" }],
        Tags: tags({ Name: "tenure-prod-nat" }),
      },
    ],
    VpcEndpoints: [
      {
        VpcEndpointId: "vpce-0a1",
        VpcEndpointType: "Interface",
        ServiceName: "com.amazonaws.eu-west-2.secretsmanager",
        VpcId: VPC_ID,
        State: "available",
        PrivateDnsEnabled: true,
        SubnetIds: [SUBNET_PRIVATE],
        Groups: [{ GroupId: SG_ENDPOINT, GroupName: "tenure-prod-vpce" }],
        Tags: tags({ Name: "tenure-prod-secretsmanager" }),
      },
    ],
    NetworkAcls: [
      {
        NetworkAclId: "acl-0a1",
        VpcId: VPC_ID,
        IsDefault: true,
        OwnerId: ACCOUNT,
        Associations: [{ SubnetId: SUBNET_PUBLIC, NetworkAclAssociationId: "aclassoc-1" }],
        Entries: [
          { RuleNumber: 100, Protocol: "-1", RuleAction: "allow", Egress: false, CidrBlock: "0.0.0.0/0" },
          { RuleNumber: 100, Protocol: "-1", RuleAction: "allow", Egress: true, CidrBlock: "0.0.0.0/0" },
        ],
      },
    ],
    SecurityGroups: [
      {
        GroupId: SG_ALB,
        GroupName: "tenure-prod-alb",
        Description: "load balancer",
        VpcId: VPC_ID,
        OwnerId: ACCOUNT,
        IpPermissions: [
          { IpProtocol: "tcp", FromPort: 80, ToPort: 80, IpRanges: [{ CidrIp: "0.0.0.0/0" }] },
          { IpProtocol: "tcp", FromPort: 443, ToPort: 443, IpRanges: [{ CidrIp: "0.0.0.0/0" }] },
        ],
        // Wide open egress. The AWS default, and deliberately NOT a finding.
        IpPermissionsEgress: [{ IpProtocol: "-1", IpRanges: [{ CidrIp: "0.0.0.0/0" }] }],
        Tags: tags({ Name: "tenure-prod-alb", "tenure:tenant": SHARED }),
      },
      {
        GroupId: SG_APP,
        GroupName: "tenure-prod-app",
        Description: "ecs tasks",
        VpcId: VPC_ID,
        OwnerId: ACCOUNT,
        IpPermissions: [
          {
            IpProtocol: "tcp",
            FromPort: 3000,
            ToPort: 3000,
            UserIdGroupPairs: [{ GroupId: SG_ALB, UserId: ACCOUNT }],
          },
        ],
        IpPermissionsEgress: [{ IpProtocol: "-1", IpRanges: [{ CidrIp: "0.0.0.0/0" }] }],
        Tags: tags({ Name: "tenure-prod-app", "tenure:tenant": "simon-ose" }),
      },
      {
        // The finding. Postgres on the public internet.
        GroupId: SG_DB,
        GroupName: "tenure-prod-db",
        Description: "database",
        VpcId: VPC_ID,
        OwnerId: ACCOUNT,
        IpPermissions: [
          { IpProtocol: "tcp", FromPort: 5432, ToPort: 5432, IpRanges: [{ CidrIp: "0.0.0.0/0" }] },
        ],
        IpPermissionsEgress: [],
        Tags: tags({ Name: "tenure-prod-db" }),
      },
      {
        GroupId: SG_ORPHAN,
        GroupName: "tenure-legacy-bastion",
        Description: "left behind",
        VpcId: VPC_ID,
        OwnerId: ACCOUNT,
        IpPermissions: [],
        IpPermissionsEgress: [],
        Tags: tags({ Name: "tenure-legacy-bastion" }),
      },
      {
        GroupId: SG_ENDPOINT,
        GroupName: "tenure-prod-vpce",
        Description: "interface endpoint",
        VpcId: VPC_ID,
        OwnerId: ACCOUNT,
        IpPermissions: [
          { IpProtocol: "tcp", FromPort: 443, ToPort: 443, IpRanges: [{ CidrIp: "10.0.0.0/16" }] },
        ],
        IpPermissionsEgress: [],
        Tags: tags({ Name: "tenure-prod-vpce" }),
      },
    ],
  }
}

/* ------------------------------------------------------------- the client -- */

type Outcome = "populated" | "empty" | "denied" | "throttled"

/** Which response key each capability answers with, exactly as the SDK does. */
const KEY_FOR: Record<string, keyof Estate> = {
  "ec2:DescribeVpcs": "Vpcs",
  "ec2:DescribeSubnets": "Subnets",
  "ec2:DescribeRouteTables": "RouteTables",
  "ec2:DescribeInternetGateways": "InternetGateways",
  "ec2:DescribeNatGateways": "NatGateways",
  "ec2:DescribeVpcEndpoints": "VpcEndpoints",
  "ec2:DescribeNetworkAcls": "NetworkAcls",
  "ec2:DescribeSecurityGroups": "SecurityGroups",
}

interface FakeOptions {
  estate?: Estate
  /** Per-capability outcome. Anything unnamed is "populated". */
  outcomes?: Partial<Record<string, Outcome>>
  /** How many pages each populated describe hands back. 1 unless a test wants more. */
  pages?: number
  tagsOutcome?: Outcome
  tagIndex?: Record<string, Tag[]>
  identity?: { arn: string; account: string; region: string } | "denied"
  calls?: string[]
}

function throwing(name: string): never {
  const error = new Error(`${name} raised by the stand-in AWS client`)
  error.name = name
  throw error
}

function fakeAws(options: FakeOptions = {}): AwsGateway {
  const data = options.estate ?? estate()
  const outcomes = options.outcomes ?? {}
  const pages = options.pages ?? 1
  const identity = options.identity ?? {
    arn: `arn:aws:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
    account: ACCOUNT,
    region: REGION,
  }
  const calls = options.calls ?? []

  return {
    async call(capability, input) {
      const name = String(capability)
      calls.push(name)

      if (name === "sts:GetCallerIdentity") {
        if (identity === "denied") throwing("AccessDenied")
        return { Account: identity.account, Arn: identity.arn, UserId: "AROA:studio" }
      }

      if (name === "tag:GetResources") {
        const outcome = options.tagsOutcome ?? "populated"
        if (outcome === "denied") throwing("AccessDeniedException")
        if (outcome === "throttled") throwing("ThrottlingException")
        if (outcome === "empty") return { ResourceTagMappingList: [] }
        return {
          ResourceTagMappingList: Object.entries(options.tagIndex ?? {}).map(([arn, Tags]) => ({
            ResourceARN: arn,
            Tags,
          })),
        }
      }

      const key = KEY_FOR[name]
      if (!key) {
        throw new Error(`the stand-in was asked for ${name}, which this suite does not exercise`)
      }
      const outcome = outcomes[name] ?? "populated"
      if (outcome === "denied") throwing("AccessDeniedException")
      if (outcome === "throttled") throwing("ThrottlingException")
      // The real API OMITS the list entirely when there is nothing, rather than
      // returning an empty array. A fake that returned `[]` would be testing a
      // response AWS never sends.
      if (outcome === "empty") return {}

      const token = (input as { NextToken?: unknown } | undefined)?.NextToken
      const page = typeof token === "string" ? Number(token.replace("page-", "")) : 1
      const body: Record<string, unknown> = { [key]: page === 1 ? data[key] : [] }
      if (page < pages) body.NextToken = `page-${page + 1}`
      return body
    },
    async resolvedRegion() {
      return identity === "denied" ? REGION : identity.region
    },
  }
}

const AT = () => new Date("2026-08-13T09:15:00.000Z")

async function load(options: FakeOptions = {}): Promise<NetworkReadings> {
  return networkReadings(fakeAws(options), { now: AT })
}

/** The whole surface as one string, which is what an operator actually reads. */
function surfaceText(readings: NetworkReadings): string {
  return networkLines(readings)
    .map((line) => `${line.label}: ${line.text}`)
    .join("\n")
}

function lineFor(readings: NetworkReadings, label: string): string {
  return networkLines(readings).find((l) => l.label === label)?.text ?? ""
}

beforeEach(() => {
  // resolveIdentity caches per process. Every case supplies its own gateway,
  // which bypasses the cache, but a stale one would test the wrong identity.
  __resetIdentity()
})

/* -------------------------------------------- the four outcomes, compared -- */

describe("the network surface says something different for each of the four outcomes", () => {
  test("a populated list is ACTUAL and names every security group", async () => {
    const readings = await load()
    expect(readings.securityGroups.state).toBe("ACTUAL")
    if (readings.securityGroups.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.securityGroups.value.items).toHaveLength(5)
    const text = surfaceText(readings)
    expect(text).toContain(SG_DB)
    expect(text).toContain("tenure-prod-alb")
  })

  test("an empty-but-successful list is EMPTY and says none, not refused", async () => {
    const readings = await load({ outcomes: { "ec2:DescribeSecurityGroups": "empty" } })
    expect(readings.securityGroups.state).toBe("EMPTY")
    const line = lineFor(readings, "Security groups")
    expect(line).toContain("none —")
    expect(line).not.toContain("refused")
    expect(line).not.toContain("Minimum statement")
    // And the exposure verdict must not read as "closed" off an empty list it
    // never got: EMPTY has no value, so exposure is unknown.
    expect(readings.exposure.kind).toBe("unknown")
  })

  test("AccessDenied is DENIED and carries the principal, the action and a pasteable statement", async () => {
    const readings = await load({ outcomes: { "ec2:DescribeSecurityGroups": "denied" } })
    expect(readings.securityGroups.state).toBe("DENIED")
    if (readings.securityGroups.state !== "DENIED") throw new Error("narrowing")

    expect(readings.securityGroups.action).toBe("ec2:DescribeSecurityGroups")
    expect(readings.securityGroups.principal).toContain("assumed-role/tenure-studio-task")
    expect(readings.securityGroups.accountId).toBe(ACCOUNT)
    expect(readings.securityGroups.region).toBe(REGION)
    expect(readings.securityGroups.partition).toBe("aws")
    expect(JSON.parse(readings.securityGroups.minimumStatement)).toEqual({
      Effect: "Allow",
      Action: ["ec2:DescribeSecurityGroups"],
      Resource: "*",
    })

    // The thing it must NOT be. There is no `value` on this arm at all.
    expect("value" in readings.securityGroups).toBe(false)
    expect(listOf(readings.securityGroups)).toEqual([])
    const line = lineFor(readings, "Security groups")
    expect(line).toContain("unknown")
    expect(line).not.toMatch(/\bnone\b/)
    // And the exposure verdict is unknown, never "nothing is reachable".
    expect(readings.exposure.kind).toBe("unknown")
    expect(describeExposure(readings.exposure)).toContain("unknown")
    expect(describeExposure(readings.exposure)).not.toContain(
      "nothing beyond HTTP and HTTPS is reachable",
    )
  })

  test("a throttle is THROTTLED — its own state, on throttle.ts's schedule", async () => {
    const readings = await load({ outcomes: { "ec2:DescribeSecurityGroups": "throttled" } })
    expect(readings.securityGroups.state).toBe("THROTTLED")
    if (readings.securityGroups.state !== "THROTTLED") throw new Error("narrowing")
    // Not a number retyped in network.ts: this is throttle.ts's own curve.
    expect(readings.securityGroups.retryAfterMs).toBe(backoffMs(READ_ATTEMPTS + 1))
    const line = lineFor(readings, "Security groups")
    expect(line).toContain("throttled")
    expect(line).toContain("retrying in")
    expect(line).not.toContain("Minimum statement")
    expect(readings.exposure.kind).toBe("unknown")
  })

  test("the four render as four visibly different surfaces", async () => {
    const texts: string[] = []
    for (const outcome of ["populated", "empty", "denied", "throttled"] as const) {
      __resetIdentity()
      texts.push(surfaceText(await load({ outcomes: { "ec2:DescribeSecurityGroups": outcome } })))
    }
    // Pairwise distinct. A fake returning [] regardless would collapse at least
    // two of these into one string, and this is the assertion that notices.
    expect(new Set(texts).size).toBe(4)
    for (const text of texts) expect(text.length).toBeGreaterThan(0)
  })

  test("the same four outcomes are told apart on a second, independent capability", async () => {
    const texts: string[] = []
    for (const outcome of ["populated", "empty", "denied", "throttled"] as const) {
      __resetIdentity()
      const readings = await load({ outcomes: { "ec2:DescribeVpcs": outcome } })
      texts.push(lineFor(readings, "VPCs"))
    }
    expect(new Set(texts).size).toBe(4)
    expect(texts[2]).toContain("ec2:DescribeVpcs")
  })
})

/* ------------------------------------------- degradation stays independent -- */

describe("one denied sub-call does not collapse the rest of the row", () => {
  test("a refused security-group read leaves VPCs, subnets and routes intact", async () => {
    const readings = await load({ outcomes: { "ec2:DescribeSecurityGroups": "denied" } })
    expect(readings.securityGroups.state).toBe("DENIED")
    expect(readings.vpcs.state).toBe("ACTUAL")
    expect(readings.subnets.state).toBe("ACTUAL")
    expect(readings.routeTables.state).toBe("ACTUAL")
    // The subnets still classify, because reachability needs routes, not groups.
    const subnet = listOf(readings.subnets).find((s) => s.subnetId === SUBNET_PUBLIC)
    expect(subnet?.reachability.kind).toBe("public")
  })

  test("a refused VPC-endpoint read makes group USAGE unknown and nothing else", async () => {
    const readings = await load({ outcomes: { "ec2:DescribeVpcEndpoints": "denied" } })
    expect(readings.vpcEndpoints.state).toBe("DENIED")
    expect(readings.securityGroups.state).toBe("ACTUAL")
    const orphan = listOf(readings.securityGroups).find((g) => g.groupId === SG_ORPHAN)
    expect(orphan?.usage.kind).toBe("unknown")
    if (orphan?.usage.kind !== "unknown") throw new Error("narrowing")
    expect(orphan.usage.why).toContain("ec2:DescribeVpcEndpoints")
    // And it must NOT be reported as a drift candidate off a read that failed.
    expect(readings.unreferencedSecurityGroupIds).toEqual([])
    expect(surfaceText(readings)).not.toContain("Drift candidates")
    // The exposure verdict is unaffected: the group read answered.
    expect(readings.exposure.kind).toBe("open")
  })

  test("a refused route-table read makes every subnet unknown, never private", async () => {
    const readings = await load({ outcomes: { "ec2:DescribeRouteTables": "denied" } })
    expect(readings.routeTables.state).toBe("DENIED")
    expect(readings.subnets.state).toBe("ACTUAL")
    for (const subnet of listOf(readings.subnets)) {
      expect(subnet.reachability.kind).toBe("unknown")
    }
    const text = surfaceText(readings)
    expect(text).toContain("reachability unknown")
    expect(text).toContain("Not private — unread")
    expect(text).not.toContain("private — route table")
    expect(text).not.toContain("PUBLIC — route table")
    // The contradiction hunt cannot run either, and must not report "none found"
    // as though it had looked.
    expect(readings.contradictoryNames).toEqual([])
  })
})

/* ------------------------------------- public is decided by the route table -- */

describe("public and private come from the route table, not from the name", () => {
  test("a subnet named private with an active IGW route is PUBLIC, and is called out", async () => {
    const readings = await load()
    const trap = listOf(readings.subnets).find((s) => s.subnetId === SUBNET_TRAP)
    expect(trap?.name).toBe("tenure-prod-private-b")
    expect(trap?.mapPublicIpOnLaunch).toBe(false)
    expect(trap?.reachability.kind).toBe("public")
    if (trap?.reachability.kind !== "public") throw new Error("narrowing")
    expect(trap.reachability.via).toBe(IGW_ID)
    expect(trap.reachability.routeTableId).toBe(RTB_TRAP)
    expect(trap.reachability.association).toBe("explicit")

    expect(readings.contradictoryNames.map((c) => c.subnetId)).toEqual([SUBNET_TRAP])
    const text = surfaceText(readings)
    expect(text).toContain("MISNAMED")
    expect(text).toContain("The name is wrong, not the route")
  })

  test("a subnet with no explicit association falls to the VPC's MAIN table", async () => {
    const readings = await load()
    const priv = listOf(readings.subnets).find((s) => s.subnetId === SUBNET_PRIVATE)
    expect(priv?.reachability.kind).toBe("private")
    if (priv?.reachability.kind !== "private") throw new Error("narrowing")
    expect(priv.reachability.routeTableId).toBe(RTB_MAIN)
    expect(priv.reachability.association).toBe("main")
    expect(priv.reachability.egress).toBe("nat")
    expect(priv.reachability.egressVia).toEqual([NAT_ID])
  })

  test("a blackholed route to an internet gateway does not make a subnet public", async () => {
    const data = estate()
    ;(data.RouteTables[2] as { Routes: Array<{ State?: string }> }).Routes[1].State = "blackhole"
    const readings = await load({ estate: data })
    const trap = listOf(readings.subnets).find((s) => s.subnetId === SUBNET_TRAP)
    expect(trap?.reachability.kind).toBe("private")
    expect(readings.contradictoryNames).toEqual([])
  })

  test("an egress-only internet gateway is egress, not reachability", async () => {
    const data = estate()
    ;(data.RouteTables[2] as { Routes: unknown[] }).Routes[1] = {
      DestinationIpv6CidrBlock: "::/0",
      EgressOnlyInternetGatewayId: "eigw-0a1",
      State: "active",
    }
    const readings = await load({ estate: data })
    const trap = listOf(readings.subnets).find((s) => s.subnetId === SUBNET_TRAP)
    expect(trap?.reachability.kind).toBe("private")
    if (trap?.reachability.kind !== "private") throw new Error("narrowing")
    expect(trap.reachability.egress).toBe("egress-only-igw")
    expect(trap.reachability.egressVia).toEqual(["eigw-0a1"])
  })

  test("MapPublicIpOnLaunch alone does not make a subnet public", async () => {
    const data = estate()
    // Private subnet, main table with no IGW route, but launches public IPs.
    ;(data.Subnets[1] as { MapPublicIpOnLaunch: boolean }).MapPublicIpOnLaunch = true
    const readings = await load({ estate: data })
    const priv = listOf(readings.subnets).find((s) => s.subnetId === SUBNET_PRIVATE)
    expect(priv?.reachability.kind).toBe("private")
    expect(priv?.mapPublicIpOnLaunch).toBe(true)
    expect(lineFor(readings, SUBNET_PRIVATE)).toContain("public IP on launch: true")
  })

  test("a subnet whose table this engine never read is unknown, not private", () => {
    // Driven through the exported derivation because the case is "the listing
    // answered and this subnet's table is not in it" — a truncated read.
    expect(
      subnetReachability("subnet-0missing", "vpc-0other", {
        state: "ACTUAL",
        capability: "ec2:DescribeRouteTables",
        value: { items: [], truncated: true, pages: MAX_PAGES, cap: MAX_PAGES },
        asOf: "2026-08-13T09:15:00.000Z",
        fresh: true,
      }),
    ).toEqual({
      kind: "unknown",
      why: expect.stringContaining("stopped at its"),
    })
  })
})

/* ------------------------------------------- 0.0.0.0/0 on anything but web -- */

describe("world ingress beyond 80 and 443 is the finding", () => {
  test("Postgres open to 0.0.0.0/0 is reported, and 80/443 on the ALB is not", async () => {
    const readings = await load()
    expect(readings.exposure.kind).toBe("open")
    if (readings.exposure.kind !== "open") throw new Error("narrowing")
    expect(readings.exposure.findings).toHaveLength(1)
    const finding = readings.exposure.findings[0]
    expect(finding.groupId).toBe(SG_DB)
    expect(finding.cidr).toBe("0.0.0.0/0")
    expect(finding.fromPort).toBe(5432)
    expect(finding.reach).toContain("TCP port 5432")

    const alb = listOf(readings.securityGroups).find((g) => g.groupId === SG_ALB)
    expect(alb?.openIngress).toHaveLength(0)
    expect(alb?.webIngress).toHaveLength(2)
    expect(readings.exposure.findings.map((f) => f.groupId)).not.toContain(SG_ALB)

    const text = surfaceText(readings)
    expect(text).toContain("OPEN TO THE INTERNET")
    expect(text).toContain("5432")
  })

  test("open egress to the whole internet is not a finding", async () => {
    const readings = await load()
    const app = listOf(readings.securityGroups).find((g) => g.groupId === SG_APP)
    expect(app?.egress.some((rule) => rule.world)).toBe(true)
    expect(app?.openIngress).toHaveLength(0)
    expect(readings.exposure.kind).toBe("open")
    if (readings.exposure.kind !== "open") throw new Error("narrowing")
    expect(readings.exposure.findings.map((f) => f.groupId)).toEqual([SG_DB])
  })

  test("::/0 is the internet too", async () => {
    const data = estate()
    ;(data.SecurityGroups[3] as { IpPermissions: unknown[] }).IpPermissions = [
      { IpProtocol: "tcp", FromPort: 22, ToPort: 22, Ipv6Ranges: [{ CidrIpv6: "::/0" }] },
    ]
    const readings = await load({ estate: data })
    if (readings.exposure.kind !== "open") throw new Error("narrowing")
    const ipv6 = readings.exposure.findings.find((f) => f.cidr === "::/0")
    expect(ipv6?.groupId).toBe(SG_ORPHAN)
    expect(ipv6?.fromPort).toBe(22)
  })

  test("a range spanning 80 to 443 is a finding, because it also opens 81", () => {
    expect(opensBeyondWeb("tcp", 80, 80)).toBe(false)
    expect(opensBeyondWeb("tcp", 443, 443)).toBe(false)
    expect(opensBeyondWeb("tcp", 80, 443)).toBe(true)
    expect(opensBeyondWeb("tcp", 22, 22)).toBe(true)
    expect(opensBeyondWeb("tcp", 0, 65535)).toBe(true)
    // Every protocol and ICMP have no ports and are never web.
    expect(opensBeyondWeb("-1", null, null)).toBe(true)
    expect(opensBeyondWeb("icmp", -1, -1)).toBe(true)
    // A tcp rule that arrived without ports is treated as the whole range.
    expect(opensBeyondWeb("tcp", null, null)).toBe(true)
  })

  test("an all-protocols rule from the world reads as every protocol, not as a port", async () => {
    const data = estate()
    ;(data.SecurityGroups[2] as { IpPermissions: unknown[] }).IpPermissions = [
      { IpProtocol: "-1", IpRanges: [{ CidrIp: "0.0.0.0/0" }] },
    ]
    const readings = await load({ estate: data })
    if (readings.exposure.kind !== "open") throw new Error("narrowing")
    const finding = readings.exposure.findings.find((f) => f.groupId === SG_DB)
    expect(finding?.protocolLabel).toBe("every protocol")
    expect(finding?.fromPort).toBeNull()
    expect(finding?.reach).toContain("no port restriction applies")
    expect(protocolLabel("6")).toBe("TCP")
  })

  test("an estate with nothing open beyond 80/443 reads as closed, and names the web groups", async () => {
    const data = estate()
    ;(data.SecurityGroups[2] as { IpPermissions: unknown[] }).IpPermissions = [
      { IpProtocol: "tcp", FromPort: 5432, ToPort: 5432, UserIdGroupPairs: [{ GroupId: SG_APP }] },
    ]
    const readings = await load({ estate: data })
    expect(readings.exposure.kind).toBe("closed")
    if (readings.exposure.kind !== "closed") throw new Error("narrowing")
    expect(readings.exposure.webFacingGroupIds).toEqual([SG_ALB])
    expect(readings.exposure.truncated).toBe(false)
    const line = lineFor(readings, "Internet exposure")
    expect(line).toContain("nothing beyond HTTP and HTTPS is reachable")
    expect(line).not.toContain("OPEN TO THE INTERNET")
  })

  test("a managed prefix list is a named source, neither world nor silently safe", async () => {
    const data = estate()
    ;(data.SecurityGroups[3] as { IpPermissions: unknown[] }).IpPermissions = [
      { IpProtocol: "tcp", FromPort: 22, ToPort: 22, PrefixListIds: [{ PrefixListId: "pl-0a1" }] },
    ]
    const readings = await load({ estate: data })
    const orphan = listOf(readings.securityGroups).find((g) => g.groupId === SG_ORPHAN)
    expect(orphan?.ingress).toHaveLength(1)
    expect(orphan?.ingress[0].sourceKind).toBe("prefix-list")
    expect(orphan?.ingress[0].source).toBe("pl-0a1")
    expect(orphan?.openIngress).toHaveLength(0)
  })

  test("a default network ACL that allows everything inbound is visible", async () => {
    const readings = await load()
    const acl = listOf(readings.networkAcls)[0]
    expect(acl.isDefault).toBe(true)
    expect(acl.openIngressEntries).toHaveLength(1)
    expect(acl.entries).toHaveLength(2)
    // Egress is not counted as an inbound opening.
    expect(acl.openIngressEntries.every((e) => !e.egress)).toBe(true)
  })
})

/* --------------------------------------------------- unused is not provable -- */

describe("an unreferenced security group is drift, and is never called unused", () => {
  test("a group nothing refers to is a candidate, and names the grant that would settle it", async () => {
    const readings = await load()
    expect(readings.unreferencedSecurityGroupIds).toContain(SG_ORPHAN)
    const orphan = listOf(readings.securityGroups).find((g) => g.groupId === SG_ORPHAN)
    expect(orphan?.usage.kind).toBe("no-attachment-visible")
    if (orphan?.usage.kind !== "no-attachment-visible") throw new Error("narrowing")
    expect(orphan.usage.needs).toBe("ec2:DescribeNetworkInterfaces")

    const text = surfaceText(readings)
    expect(text).toContain("Drift candidates")
    expect(text).toContain("ec2:DescribeNetworkInterfaces")
    expect(text).toContain("drift candidate and not a finding")
    // The word this module must never print about a group it cannot prove.
    expect(text).not.toMatch(/\bunused\b/)
  })

  test("a group another group's rule names is referenced, and is not a candidate", async () => {
    const readings = await load()
    const alb = listOf(readings.securityGroups).find((g) => g.groupId === SG_ALB)
    expect(alb?.usage.kind).toBe("referenced")
    if (alb?.usage.kind !== "referenced") throw new Error("narrowing")
    expect(alb.usage.by).toEqual([`security group ${SG_APP} rule`])
    expect(readings.unreferencedSecurityGroupIds).not.toContain(SG_ALB)
  })

  test("a group a VPC endpoint lists is referenced", async () => {
    const readings = await load()
    const vpce = listOf(readings.securityGroups).find((g) => g.groupId === SG_ENDPOINT)
    expect(vpce?.usage.kind).toBe("referenced")
    if (vpce?.usage.kind !== "referenced") throw new Error("narrowing")
    expect(vpce.usage.by).toEqual(["VPC endpoint vpce-0a1"])
  })
})

/* ------------------------------------------------ pagination and its bound -- */

describe("every read paginates to completion, with a bound it declares", () => {
  test("a multi-page listing is walked to the end and is not truncated", async () => {
    const calls: string[] = []
    const readings = await load({ pages: 3, calls })
    expect(readings.vpcs.state).toBe("ACTUAL")
    if (readings.vpcs.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.vpcs.value.pages).toBe(3)
    expect(readings.vpcs.value.truncated).toBe(false)
    expect(wasTruncated(readings.vpcs)).toBe(false)
    expect(calls.filter((c) => c === "ec2:DescribeVpcs")).toHaveLength(3)
    expect(surfaceText(readings)).not.toContain("TRUNCATED")
  })

  test("hitting the page cap sets truncated and the surface says there were more", async () => {
    const readings = await load({ pages: MAX_PAGES + 5 })
    if (readings.securityGroups.state !== "ACTUAL") throw new Error("narrowing")
    expect(readings.securityGroups.value.pages).toBe(MAX_PAGES)
    expect(readings.securityGroups.value.truncated).toBe(true)
    expect(readings.securityGroups.value.cap).toBe(MAX_PAGES)
    // The items read are kept, not thrown away — an estate larger than the cap
    // must not render as nothing at all.
    expect(readings.securityGroups.value.items).toHaveLength(5)
    const line = lineFor(readings, "Security groups")
    expect(line).toContain("TRUNCATED")
    expect(line).toContain("not the whole estate")
    // And a truncated read cannot claim the estate is closed without saying so.
    expect(describeExposure(readings.exposure)).toContain("page cap")
  })
})

/* ------------------------------------------------------ residency and tags -- */

describe("region and partition come from the resolved identity, never a literal", () => {
  test("a GovCloud identity produces GovCloud ARNs and no commercial region anywhere", async () => {
    const readings = await load({
      identity: {
        arn: `arn:aws-us-gov:sts::${ACCOUNT}:assumed-role/tenure-studio-task/abc`,
        account: ACCOUNT,
        region: "us-gov-west-1",
      },
    })
    const vpc = listOf(readings.vpcs)[0]
    expect(vpc.arn).toBe(`arn:aws-us-gov:ec2:us-gov-west-1:${ACCOUNT}:vpc/${VPC_ID}`)
    expect(vpc.partition).toBe("aws-us-gov")
    expect(vpc.region).toBe("us-gov-west-1")
    const sg = listOf(readings.securityGroups)[0]
    expect(sg.partition).toBe("aws-us-gov")
    expect(surfaceText(readings)).not.toContain("us-east-1")
    expect(surfaceText(readings)).not.toContain(REGION)
  })

  test("with identity unresolved no ARN is invented", async () => {
    const readings = await load({ identity: "denied" })
    expect(readings.identity.state).toBe("DENIED")
    for (const vpc of listOf(readings.vpcs)) {
      expect(vpc.arn).toBeNull()
      expect(vpc.region).toBeNull()
      expect(vpc.partition).toBeNull()
    }
    // The reads themselves still work: identity is needed for ARNs, not routes.
    expect(readings.subnets.state).toBe("ACTUAL")
    expect(
      listOf(readings.subnets).find((s) => s.subnetId === SUBNET_PUBLIC)?.reachability.kind,
    ).toBe("public")
  })

  test("a resource's own OwnerId is used, not the caller's account", async () => {
    const data = estate()
    ;(data.Subnets[0] as { OwnerId: string }).OwnerId = "210987654321"
    const readings = await load({ estate: data })
    const shared = listOf(readings.subnets).find((s) => s.subnetId === SUBNET_PUBLIC)
    expect(shared?.arn).toBe(`arn:aws:ec2:${REGION}:210987654321:subnet/${SUBNET_PUBLIC}`)
  })
})

describe("attribution comes from tags, and says which read supplied them", () => {
  test("a tenure:tenant tag on the describe response attributes the resource", async () => {
    const readings = await load()
    const priv = listOf(readings.subnets).find((s) => s.subnetId === SUBNET_PRIVATE)
    expect(priv?.attribution).toEqual({
      kind: "tenant",
      tenantSlug: "simon-ose",
      source: "describe-response",
    })
    expect(lineFor(readings, SUBNET_PRIVATE)).toContain("simon-ose")
  })

  test("the shared sentinel is shared, and an untagged resource is unattributable", async () => {
    const readings = await load()
    const pub = listOf(readings.subnets).find((s) => s.subnetId === SUBNET_PUBLIC)
    const trap = listOf(readings.subnets).find((s) => s.subnetId === SUBNET_TRAP)
    expect(pub?.attribution.kind).toBe("shared")
    expect(trap?.attribution.kind).toBe("unattributed")
    const text = surfaceText(readings)
    expect(text).toContain("shared — platform overhead")
    expect(text).toContain("unattributable — missing tenure:tenant")
  })

  test("a denied tag index does not lose attribution, because EC2 returns tags itself", async () => {
    // The deliberate difference from sqs.ts, and the reason this module has no
    // `unknown` attribution arm: the describe response carried the tags.
    const readings = await load({ tagsOutcome: "denied" })
    expect(readings.tagged.state).toBe("DENIED")
    const priv = listOf(readings.subnets).find((s) => s.subnetId === SUBNET_PRIVATE)
    expect(priv?.attribution).toEqual({
      kind: "tenant",
      tenantSlug: "simon-ose",
      source: "describe-response",
    })
  })

  test("the tag index answers for a resource whose describe response carried no tags", async () => {
    // EC2 omits `Tags` entirely for an untagged resource; the Tagging API is
    // eventually consistent in both directions, so it is the second opinion.
    const data = estate()
    delete (data.Subnets[2] as { Tags?: unknown }).Tags
    const readings = await load({
      estate: data,
      tagIndex: {
        [`arn:aws:ec2:${REGION}:${ACCOUNT}:subnet/${SUBNET_TRAP}`]: tags({
          "tenure:tenant": "acme",
        }),
      },
    })
    const trap = listOf(readings.subnets).find((s) => s.subnetId === SUBNET_TRAP)
    expect(trap?.attribution).toEqual({
      kind: "tenant",
      tenantSlug: "acme",
      source: "tag-index",
    })
    expect(lineFor(readings, SUBNET_TRAP)).toContain("from the tag index")
  })
})

/* ---------------------------------------------------- as-of and cadence -- */

describe("every reading carries when it was taken and how often it refreshes", () => {
  test("the load stamps an explicit asOf and each capability's own cadence", async () => {
    const readings = await load()
    expect(readings.asOf).toBe("2026-08-13T09:15:00.000Z")
    // The registry's declarations, not numbers retyped here: NETWORK_TOPOLOGY
    // and SECURITY_GROUP TTLs.
    expect(readings.refreshMs.vpcs).toBe(300_000)
    expect(readings.refreshMs.subnets).toBe(300_000)
    expect(readings.refreshMs.routeTables).toBe(300_000)
    expect(readings.refreshMs.securityGroups).toBe(60_000)
    expect(readings.refreshMs.networkAcls).toBe(60_000)
    const text = surfaceText(readings)
    expect(text).toContain("refreshed every 300s")
    expect(text).toContain("refreshed every 60s")
    expect(text).toContain("as of 2026-08-13T09:15:00.000Z")
    for (const finding of readings.exposure.kind === "open" ? readings.exposure.findings : []) {
      expect(finding.asOf).toBe("2026-08-13T09:15:00.000Z")
    }
  })

  test("contradictorySubnetNames reports nothing when the subnets were not read", () => {
    expect(
      contradictorySubnetNames({
        state: "DENIED",
        capability: "ec2:DescribeSubnets",
        action: "ec2:DescribeSubnets",
        principal: "unknown principal",
        accountId: null,
        region: null,
        partition: null,
        errorCode: "AccessDeniedException",
        minimumStatement: "{}",
      }),
    ).toEqual([])
  })
})
