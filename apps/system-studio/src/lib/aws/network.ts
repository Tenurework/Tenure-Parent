/**
 * STUDIO-070-004 (NETWORK) — what can reach this estate from the internet.
 *
 * `infrastructure/terraform/vpc.tf` and `security_groups.tf` build a network
 * that nothing in the running product has ever read. Terraform can tell you what
 * it INTENDED; only these eight calls can tell you what is actually there, and
 * the gap between the two is where an `aws_vpc_security_group_ingress_rule` with
 * `cidr_ipv4 = "0.0.0.0/0"` lives — a database on the public internet that no
 * surface in this console could see.
 *
 * ## Public is a property of the ROUTE TABLE, never of the name
 *
 * The single most important decision in this file. A subnet tagged
 * `Name = tenure-prod-private-a` that is associated with a route table carrying
 * an active `0.0.0.0/0 → igw-…` route is a PUBLIC subnet, and every instance in
 * it with a public IP is on the internet. Classifying by name would report it as
 * private, which is worse than reporting nothing: it is a confident wrong answer
 * on the page an operator uses to decide whether a breach is possible.
 *
 * So `subnetReachability()` reads:
 *
 *   1. the route table EXPLICITLY associated with the subnet, if there is one;
 *   2. otherwise the VPC's MAIN route table, which is what an unassociated
 *      subnet actually uses — and a subnet nobody associated is exactly the one
 *      that quietly inherits the main table's internet route;
 *   3. and if neither can be found, `unknown` — never `private`.
 *
 * A route counts only when `State === "active"`. A blackholed route to a
 * detached gateway does not carry a packet, and reporting a subnet as public
 * because of one would be a finding an operator cannot close.
 *
 * `igw-` is a resource-id prefix AWS assigns, not a label somebody typed, so
 * matching on it is not the naming mistake this module exists to avoid.
 * `eigw-` is deliberately NOT treated as public: an egress-only internet gateway
 * is IPv6 outbound only and accepts no inbound connection.
 *
 * The subnet's own `MapPublicIpOnLaunch` is carried, and is carried as evidence
 * rather than as the classifier. It says what happens to a NEW interface, not
 * whether packets can arrive.
 *
 * Names are used for exactly one thing: `contradictorySubnetNames()` reports a
 * subnet whose `Name` tag says "private" and whose ROUTES say public. The name
 * is the accusation there; the route table is still the verdict.
 *
 * ## 0.0.0.0/0 ingress on anything but 80 and 443
 *
 * `openIngressFindings()` walks every security group's `IpPermissions` and
 * reports every rule reachable from `0.0.0.0/0` or `::/0` whose covered ports
 * are not a subset of {80, 443}. `-1` (every protocol) and ICMP are findings by
 * construction — neither is a web port. A rule spanning 80–443 IS a finding,
 * because it also opens 81 through 442, and a check that pattern-matched the two
 * endpoints would pass it.
 *
 * Egress is read and reported, and is not a finding. Open egress is the AWS
 * default and flagging it would bury the ingress findings under noise.
 *
 * ## An unused security group is drift, and this engine cannot prove one
 *
 * `ec2:DescribeNetworkInterfaces` is not in the capability registry, and it is
 * the only call that answers "what is this group attached to". Reporting a group
 * as unused from the eight reads available would be a false finding of exactly
 * the kind this programme has already shipped: the group could be on an ECS
 * task, an RDS instance, a Lambda ENI or an interface endpoint in another
 * account, and none of those is visible here.
 *
 * So `SecurityGroupUsage` has a `referenced` arm — for the attachments this
 * engine CAN see, which are another group's rules naming it and a VPC endpoint
 * listing it — and a `no-attachment-visible` arm that names
 * `ec2:DescribeNetworkInterfaces` as the grant that would settle it. The
 * renderer never says "unused". A surface that wants to show drift shows the
 * candidates and the sentence saying what was not read.
 *
 * ## Every read degrades on its own
 *
 * Eight capabilities, eight `AwsRead`s. A refused `ec2:DescribeSecurityGroups`
 * leaves the VPC and subnet readings intact; a refused
 * `ec2:DescribeRouteTables` makes every subnet's reachability `unknown` carrying
 * the route-table denial's own sentence, and emphatically not `private`, which
 * is the reassuring default this whole read plane exists to prevent.
 *
 * ## Region, partition and pagination
 *
 * Region and partition come from the resolved identity and from each resource's
 * own `OwnerId`; there is no literal region and no `"aws"` fallback in this file
 * (GE-010-007). Every read paginates to completion with a page cap, and carries
 * `truncated` so a capped answer can never be rendered as the whole estate.
 */

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
import { attributionOf, tagIndex, taggedResources, type TaggedResource } from "./tags"
import { READ_ATTEMPTS, backoffMs } from "./throttle"

/* ---------------------------------------------------------------- limits -- */

/**
 * How many pages any one EC2 describe walks before it stops.
 *
 * `client.ts` asks for `MaxResults: 100`, so this is four thousand resources per
 * call. A reader with no bound is how one agent takes the console down; a reader
 * that stops silently is the same lie as an empty list, which is why stopping
 * sets `truncated` rather than throwing the page away.
 */
export const MAX_PAGES = 40

/** The CIDRs that mean "the entire internet". Both, because `::/0` is not `0.0.0.0/0`. */
export const WORLD_CIDRS: readonly string[] = ["0.0.0.0/0", "::/0"]

/**
 * The only ports an internet-facing ingress rule may carry without being a
 * finding. HTTP and HTTPS, and nothing else.
 */
export const WEB_PORTS: readonly number[] = [80, 443]

/* ----------------------------------------------------------- the API shapes -- */

/** The API's shapes, declared rather than imported — see client.ts's one-owner rule. */
interface AwsTag {
  Key?: string
  Value?: string
}

interface RawVpc {
  VpcId?: string
  CidrBlock?: string
  State?: string
  IsDefault?: boolean
  OwnerId?: string
  Tags?: AwsTag[]
  CidrBlockAssociationSet?: Array<{ CidrBlock?: string; CidrBlockState?: { State?: string } }>
  Ipv6CidrBlockAssociationSet?: Array<{ Ipv6CidrBlock?: string }>
}

interface RawSubnet {
  SubnetId?: string
  VpcId?: string
  CidrBlock?: string
  Ipv6CidrBlockAssociationSet?: Array<{ Ipv6CidrBlock?: string }>
  AvailabilityZone?: string
  AvailabilityZoneId?: string
  MapPublicIpOnLaunch?: boolean
  AvailableIpAddressCount?: number
  State?: string
  OwnerId?: string
  Tags?: AwsTag[]
}

interface RawRoute {
  DestinationCidrBlock?: string
  DestinationIpv6CidrBlock?: string
  DestinationPrefixListId?: string
  GatewayId?: string
  NatGatewayId?: string
  TransitGatewayId?: string
  VpcPeeringConnectionId?: string
  EgressOnlyInternetGatewayId?: string
  NetworkInterfaceId?: string
  State?: string
  Origin?: string
}

interface RawRouteTable {
  RouteTableId?: string
  VpcId?: string
  OwnerId?: string
  Tags?: AwsTag[]
  Routes?: RawRoute[]
  Associations?: Array<{
    RouteTableAssociationId?: string
    SubnetId?: string
    Main?: boolean
    AssociationState?: { State?: string }
  }>
}

interface RawInternetGateway {
  InternetGatewayId?: string
  OwnerId?: string
  Tags?: AwsTag[]
  Attachments?: Array<{ VpcId?: string; State?: string }>
}

interface RawNatGateway {
  NatGatewayId?: string
  VpcId?: string
  SubnetId?: string
  State?: string
  ConnectivityType?: string
  Tags?: AwsTag[]
  NatGatewayAddresses?: Array<{ PublicIp?: string; PrivateIp?: string }>
}

interface RawVpcEndpoint {
  VpcEndpointId?: string
  VpcEndpointType?: string
  ServiceName?: string
  VpcId?: string
  State?: string
  PrivateDnsEnabled?: boolean
  RouteTableIds?: string[]
  SubnetIds?: string[]
  Groups?: Array<{ GroupId?: string; GroupName?: string }>
  Tags?: AwsTag[]
}

interface RawNetworkAclEntry {
  RuleNumber?: number
  Protocol?: string
  RuleAction?: string
  Egress?: boolean
  CidrBlock?: string
  Ipv6CidrBlock?: string
  PortRange?: { From?: number; To?: number }
}

interface RawNetworkAcl {
  NetworkAclId?: string
  VpcId?: string
  IsDefault?: boolean
  OwnerId?: string
  Tags?: AwsTag[]
  Entries?: RawNetworkAclEntry[]
  Associations?: Array<{ SubnetId?: string; NetworkAclAssociationId?: string }>
}

interface RawIpPermission {
  IpProtocol?: string
  FromPort?: number
  ToPort?: number
  IpRanges?: Array<{ CidrIp?: string; Description?: string }>
  Ipv6Ranges?: Array<{ CidrIpv6?: string; Description?: string }>
  PrefixListIds?: Array<{ PrefixListId?: string; Description?: string }>
  UserIdGroupPairs?: Array<{ GroupId?: string; UserId?: string; Description?: string }>
}

interface RawSecurityGroup {
  GroupId?: string
  GroupName?: string
  Description?: string
  VpcId?: string
  OwnerId?: string
  Tags?: AwsTag[]
  IpPermissions?: RawIpPermission[]
  IpPermissionsEgress?: RawIpPermission[]
}

/* ------------------------------------------------------------- pagination -- */

/**
 * A list read to completion, or read to the cap and honest about it.
 *
 * `truncated` travels WITH the items rather than beside them, because the whole
 * failure being prevented is a surface rendering a first page as if it were the
 * estate. A caller that destructures `items` and ignores `truncated` has at
 * least had to walk past it.
 */
export interface PagedList<T> {
  items: readonly T[]
  /** True when `cap` pages were spent and AWS still offered a next token. */
  truncated: boolean
  /** How many pages were actually walked. */
  pages: number
  /** The bound that was applied, so a surface can state it. */
  cap: number
}

/** Items when the read produced some; `[]` ONLY for EMPTY, never for a refusal. */
export function listOf<T>(read: AwsRead<PagedList<T>>): readonly T[] {
  if (read.state === "ACTUAL" || read.state === "STALE") return read.value.items
  return []
}

/** Whether a read stopped at the page cap. Unknown reads are not "complete". */
export function wasTruncated(read: AwsRead<PagedList<unknown>>): boolean {
  return (read.state === "ACTUAL" || read.state === "STALE") && read.value.truncated
}

/* ------------------------------------------------------------- the readings -- */

/**
 * Which tenant a network resource belongs to, and which read said so.
 *
 * There is deliberately NO `unknown` arm, and the reason is specific to EC2:
 * every `Describe*` in this module returns each resource's own `Tags` alongside
 * it, so a resource this engine read is a resource whose tags this engine read.
 * `sqs.ts` needs an `unknown` arm because `ListQueues` returns no tags at all
 * and the Resource Groups Tagging API is its only source; here the tag index is
 * a corroborating second source, not the only one.
 *
 * `source` records which of the two answered, because a disagreement between
 * them is real — the Tagging API is eventually consistent and a tag set two
 * minutes ago is in the describe response before it is in the index.
 */
export type AttributionSource = "tag-index" | "describe-response"

export type NetworkAttribution =
  | { kind: "tenant"; tenantSlug: string; source: AttributionSource }
  | { kind: "shared"; source: AttributionSource }
  | { kind: "unattributed"; source: AttributionSource }

export interface VpcReading {
  vpcId: string
  arn: string | null
  cidrBlock: string | null
  /** Every CIDR associated with the VPC, not just the primary. */
  cidrBlocks: readonly string[]
  ipv6CidrBlocks: readonly string[]
  state: string | null
  isDefault: boolean
  ownerId: string | null
  region: string | null
  partition: string | null
  name: string | null
  attribution: NetworkAttribution
  tags: Readonly<Record<string, string>>
}

/**
 * How a subnet is reachable, decided from the route table it actually uses.
 *
 * `unknown` is a first-class answer and is what a denied, throttled or truncated
 * `ec2:DescribeRouteTables` produces. It is never `private`: "we could not read
 * the routes" and "nothing routes here from the internet" are the two facts this
 * union exists to keep apart.
 */
export type SubnetReachability =
  | {
      kind: "public"
      /** The gateway id carrying the default route. An `igw-…`, from AWS. */
      via: string
      /** `0.0.0.0/0` or `::/0`, verbatim from the route. */
      destination: string
      routeTableId: string
      association: "explicit" | "main"
    }
  | {
      kind: "private"
      routeTableId: string
      association: "explicit" | "main"
      /** How it reaches out, if it can. `none` is a posture, not an error. */
      egress: "nat" | "egress-only-igw" | "none"
      egressVia: readonly string[]
    }
  | { kind: "unknown"; why: string }

export interface SubnetReading {
  subnetId: string
  vpcId: string | null
  arn: string | null
  cidrBlock: string | null
  ipv6CidrBlocks: readonly string[]
  availabilityZone: string | null
  availabilityZoneId: string | null
  /** What happens to a NEW interface. Evidence, never the classifier. */
  mapPublicIpOnLaunch: boolean | null
  availableIpAddressCount: number | null
  state: string | null
  ownerId: string | null
  region: string | null
  partition: string | null
  /** The `Name` tag. A label for a human; used only to find a contradiction. */
  name: string | null
  reachability: SubnetReachability
  attribution: NetworkAttribution
  tags: Readonly<Record<string, string>>
}

export interface RouteReading {
  destination: string | null
  target: string | null
  /** `active` or `blackhole`. Only `active` carries a packet. */
  state: string | null
  origin: string | null
}

export interface RouteTableReading {
  routeTableId: string
  vpcId: string | null
  arn: string | null
  /** True when this is the VPC's main table — what an unassociated subnet uses. */
  isMain: boolean
  associatedSubnetIds: readonly string[]
  routes: readonly RouteReading[]
  /** The active default route at an internet gateway, if there is one. */
  internetRoute: { destination: string; gatewayId: string } | null
  ownerId: string | null
  name: string | null
  attribution: NetworkAttribution
  tags: Readonly<Record<string, string>>
}

export interface InternetGatewayReading {
  internetGatewayId: string
  arn: string | null
  attachedVpcIds: readonly string[]
  attachmentStates: Readonly<Record<string, string>>
  ownerId: string | null
  name: string | null
  attribution: NetworkAttribution
  tags: Readonly<Record<string, string>>
}

export interface NatGatewayReading {
  natGatewayId: string
  vpcId: string | null
  subnetId: string | null
  arn: string | null
  state: string | null
  /** `public` or `private`. A private NAT gateway does not reach the internet. */
  connectivityType: string | null
  publicIps: readonly string[]
  name: string | null
  attribution: NetworkAttribution
  tags: Readonly<Record<string, string>>
}

export interface VpcEndpointReading {
  vpcEndpointId: string
  vpcId: string | null
  arn: string | null
  /** `Interface`, `Gateway` or `GatewayLoadBalancer`. */
  endpointType: string | null
  serviceName: string | null
  state: string | null
  privateDnsEnabled: boolean | null
  routeTableIds: readonly string[]
  subnetIds: readonly string[]
  securityGroupIds: readonly string[]
  name: string | null
  attribution: NetworkAttribution
  tags: Readonly<Record<string, string>>
}

export interface NetworkAclEntryReading {
  ruleNumber: number | null
  protocol: string | null
  action: string | null
  egress: boolean
  cidr: string | null
  fromPort: number | null
  toPort: number | null
}

export interface NetworkAclReading {
  networkAclId: string
  vpcId: string | null
  arn: string | null
  /** True for the ACL nobody wrote, whose rules are ALLOW ALL both ways. */
  isDefault: boolean
  associatedSubnetIds: readonly string[]
  entries: readonly NetworkAclEntryReading[]
  /** Ingress entries that ALLOW from 0.0.0.0/0 or ::/0 beyond 80 and 443. */
  openIngressEntries: readonly NetworkAclEntryReading[]
  ownerId: string | null
  name: string | null
  attribution: NetworkAttribution
  tags: Readonly<Record<string, string>>
}

/** One ingress or egress rule, flattened to one source per row. */
export interface SecurityGroupRule {
  direction: "ingress" | "egress"
  /** `-1`, `tcp`, `udp`, `icmp`, or the IP protocol number AWS returned. */
  protocol: string
  /** Human wording for the protocol, so a surface does not re-derive it. */
  protocolLabel: string
  /** Null when the protocol has no port concept. */
  fromPort: number | null
  toPort: number | null
  /** Where it comes from / goes to: a CIDR, a prefix list id, or a group id. */
  source: string
  sourceKind: "ipv4" | "ipv6" | "prefix-list" | "security-group"
  description: string | null
  /** True when `source` is `0.0.0.0/0` or `::/0`. */
  world: boolean
}

/**
 * What this engine can say about whether a security group is in use.
 *
 * See the module header. There is no `unused` arm and there will not be one
 * until `ec2:DescribeNetworkInterfaces` is in the registry.
 */
export type SecurityGroupUsage =
  /** Something this engine read names it: another group's rule, or an endpoint. */
  | { kind: "referenced"; by: readonly string[] }
  /** Nothing this engine read names it — which is not the same as unattached. */
  | {
      kind: "no-attachment-visible"
      needs: "ec2:DescribeNetworkInterfaces"
      why: string
    }
  /** The reads that would have shown a reference did not answer. */
  | { kind: "unknown"; why: string }

export interface SecurityGroupReading {
  groupId: string
  groupName: string | null
  description: string | null
  vpcId: string | null
  arn: string | null
  ownerId: string | null
  region: string | null
  partition: string | null
  ingress: readonly SecurityGroupRule[]
  egress: readonly SecurityGroupRule[]
  /** Every world-reachable ingress rule beyond 80/443. The finding. */
  openIngress: readonly InternetIngressFinding[]
  /** World-reachable and confined to 80/443. Expected on a load balancer. */
  webIngress: readonly SecurityGroupRule[]
  usage: SecurityGroupUsage
  name: string | null
  attribution: NetworkAttribution
  tags: Readonly<Record<string, string>>
}

/** A security group rule that puts something on the public internet. */
export interface InternetIngressFinding {
  groupId: string
  groupName: string | null
  vpcId: string | null
  /** `0.0.0.0/0` or `::/0`, verbatim. */
  cidr: string
  protocol: string
  protocolLabel: string
  fromPort: number | null
  toPort: number | null
  /** The sentence naming exactly what the internet can reach. */
  reach: string
  attribution: NetworkAttribution
  asOf: string
}

/**
 * Whether anything is reachable from the internet, as one answer.
 *
 * Lifted out of the security-group table for the same reason `sqs.ts` lifts
 * dead letters out of the queue table: it is the one network fact that is an
 * incident rather than an inventory row. `closed` carries `truncated` so it can
 * never quietly mean "closed as far as we bothered to look".
 */
export type InternetExposureState =
  | { kind: "unknown"; why: string }
  | {
      kind: "closed"
      groupsRead: number
      /** Groups open to the world on 80/443 only. Expected, and named anyway. */
      webFacingGroupIds: readonly string[]
      truncated: boolean
    }
  | {
      kind: "open"
      findings: readonly InternetIngressFinding[]
      groupsRead: number
      truncated: boolean
    }

/** A subnet whose name claims one thing and whose routes prove another. */
export interface SubnetNameContradiction {
  subnetId: string
  name: string
  routeTableId: string
  via: string
  why: string
}

/** Everything a network surface needs, in one load. */
export interface NetworkReadings {
  identity: AwsRead<Identity>
  tagged: AwsRead<readonly TaggedResource[]>
  vpcs: AwsRead<PagedList<VpcReading>>
  subnets: AwsRead<PagedList<SubnetReading>>
  routeTables: AwsRead<PagedList<RouteTableReading>>
  internetGateways: AwsRead<PagedList<InternetGatewayReading>>
  natGateways: AwsRead<PagedList<NatGatewayReading>>
  vpcEndpoints: AwsRead<PagedList<VpcEndpointReading>>
  networkAcls: AwsRead<PagedList<NetworkAclReading>>
  securityGroups: AwsRead<PagedList<SecurityGroupReading>>
  exposure: InternetExposureState
  /** Groups nothing this engine read refers to. Drift candidates, not findings. */
  unreferencedSecurityGroupIds: readonly string[]
  contradictoryNames: readonly SubnetNameContradiction[]
  asOf: string
  /** Each capability's own declared cadence, read from the registry, not retyped. */
  refreshMs: {
    vpcs: number
    subnets: number
    routeTables: number
    internetGateways: number
    natGateways: number
    vpcEndpoints: number
    networkAcls: number
    securityGroups: number
  }
}

/* ------------------------------------------------------------- primitives -- */

function tagsOf(tags: AwsTag[] | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const tag of tags ?? []) {
    if (tag.Key) out[tag.Key] = tag.Value ?? ""
  }
  return out
}

function nameOf(tags: Readonly<Record<string, string>>): string | null {
  return tags.Name ?? null
}

/**
 * An EC2 resource ARN, assembled from the resolved identity.
 *
 * EC2's describe responses do not return ARNs, and the Resource Groups Tagging
 * API keys on them, so one has to be built to join the two. Partition and region
 * come from `sts:GetCallerIdentity` and the SDK's resolved region — never from a
 * literal, which is the GE-010-007 shape of defect — and the account comes from
 * the resource's own `OwnerId` when AWS returned one, because a shared subnet
 * belongs to the account that owns it and not to the account looking at it.
 *
 * Returns null when identity is unresolved. Half an ARN would join against the
 * tag index and match nothing, which reads exactly like an untagged resource.
 */
export function ec2Arn(
  identity: AwsRead<Identity>,
  resourceType: string,
  id: string | null | undefined,
  ownerId: string | null | undefined,
): string | null {
  if (identity.state !== "ACTUAL" && identity.state !== "STALE") return null
  if (!id) return null
  const account = ownerId || identity.value.accountId
  if (!account) return null
  return `arn:${identity.value.partition}:ec2:${identity.value.region}:${account}:${resourceType}/${id}`
}

/**
 * Which tenant a resource belongs to.
 *
 * The resource's own tags first — they arrived with the resource, from the same
 * call, and cannot be stale relative to it. EC2 returns a resource's whole tag
 * set or omits the field entirely; it never returns a partial one, so a describe
 * response carrying ANY tag is the complete answer and the index cannot add to
 * it. The index is consulted only when the field was absent, which is the one
 * case where the two could legitimately differ: the Resource Groups Tagging API
 * is eventually consistent in both directions.
 */
export function networkAttribution(
  inlineTags: Readonly<Record<string, string>>,
  arn: string | null,
  tagged: AwsRead<readonly TaggedResource[]>,
  index: Map<string, Readonly<Record<string, string>>>,
): NetworkAttribution {
  const indexReadable =
    tagged.state === "ACTUAL" || tagged.state === "STALE" || tagged.state === "EMPTY"

  if (Object.keys(inlineTags).length > 0) {
    return withSource(attributionOf(inlineTags), "describe-response")
  }
  if (indexReadable && arn) {
    const fromIndex = index.get(arn)
    if (fromIndex) return withSource(attributionOf(fromIndex), "tag-index")
  }
  // No tags on the resource and none in the index. EC2 omits `Tags` when a
  // resource has none, so this is an observation rather than a gap.
  return { kind: "unattributed", source: "describe-response" }
}

function withSource(
  decided: { kind: "tenant"; tenantSlug: string } | { kind: "shared" } | { kind: "unattributed" },
  source: AttributionSource,
): NetworkAttribution {
  switch (decided.kind) {
    case "tenant":
      return { kind: "tenant", tenantSlug: decided.tenantSlug, source }
    case "shared":
      return { kind: "shared", source }
    case "unattributed":
      return { kind: "unattributed", source }
  }
}

/** Whether a CIDR is the whole internet. Both families, exactly. */
export function isWorldCidr(cidr: string | null | undefined): boolean {
  return typeof cidr === "string" && WORLD_CIDRS.includes(cidr.trim())
}

/**
 * The wording for an IP protocol number or name.
 *
 * `-1` is every protocol, which is what an `aws_security_group` with no
 * protocol set produces and what a rule created in the console with "All
 * traffic" produces. TCP, UDP and ICMP arrive as either the name or the number
 * depending on how the rule was created, so both are recognised.
 */
export function protocolLabel(protocol: string): string {
  const raw = protocol.trim().toLowerCase()
  if (raw === "-1" || raw === "all") return "every protocol"
  if (raw === "tcp" || raw === "6") return "TCP"
  if (raw === "udp" || raw === "17") return "UDP"
  if (raw === "icmp" || raw === "1") return "ICMP"
  if (raw === "icmpv6" || raw === "58") return "ICMPv6"
  return `IP protocol ${protocol}`
}

/** Whether the protocol has ports at all. ICMP and "every protocol" do not. */
function hasPorts(protocol: string): boolean {
  const raw = protocol.trim().toLowerCase()
  return raw === "tcp" || raw === "6" || raw === "udp" || raw === "17"
}

/**
 * Whether a rule opens anything beyond HTTP and HTTPS.
 *
 * The covered port range must be a SUBSET of {80, 443}. A rule spanning 80–443
 * is a finding: it opens 81 through 442 as well, and a check that compared the
 * two endpoints against the two allowed ports would wave it through. `-1` and
 * ICMP are findings by construction — neither is a web port.
 *
 * A tcp/udp rule that arrives with no `FromPort` is treated as the whole range.
 * AWS always sends them for tcp and udp; assuming "no ports" would turn a
 * malformed response into a clean bill of health, and the safe direction for an
 * exposure check is the loud one.
 */
export function opensBeyondWeb(
  protocol: string,
  fromPort: number | null,
  toPort: number | null,
): boolean {
  if (!hasPorts(protocol)) return true
  const from = fromPort ?? 0
  const to = toPort ?? 65535
  if (to < from) return true
  // 80 and 443 are not adjacent, so any range covering more than one port
  // necessarily covers a port that is neither. Stated as an argument rather than
  // walked as a loop, because walking 65,536 ports per rule is how a page render
  // becomes a stall.
  if (from !== to) return true
  return !WEB_PORTS.includes(from)
}

/** The sentence naming what the internet can reach through one rule. */
export function reachSentence(
  protocol: string,
  fromPort: number | null,
  toPort: number | null,
  cidr: string,
): string {
  const label = protocolLabel(protocol)
  if (!hasPorts(protocol)) {
    return `${cidr} can reach this group on ${label} — no port restriction applies`
  }
  const from = fromPort ?? 0
  const to = toPort ?? 65535
  const ports = from === to ? `port ${from}` : `ports ${from}–${to} (${to - from + 1} ports)`
  return `${cidr} can reach this group on ${label} ${ports}`
}

/* ------------------------------------------------------------- flattening -- */

/** One `IpPermission` becomes one row per source, because a rule can have many. */
export function flattenPermission(
  permission: RawIpPermission,
  direction: "ingress" | "egress",
): SecurityGroupRule[] {
  const protocol = permission.IpProtocol ?? "-1"
  const ports = hasPorts(protocol)
  const fromPort = ports ? (permission.FromPort ?? null) : null
  const toPort = ports ? (permission.ToPort ?? null) : null
  const base = {
    direction,
    protocol,
    protocolLabel: protocolLabel(protocol),
    fromPort,
    toPort,
  }
  const rows: SecurityGroupRule[] = []

  for (const range of permission.IpRanges ?? []) {
    if (!range.CidrIp) continue
    rows.push({
      ...base,
      source: range.CidrIp,
      sourceKind: "ipv4",
      description: range.Description ?? null,
      world: isWorldCidr(range.CidrIp),
    })
  }
  for (const range of permission.Ipv6Ranges ?? []) {
    if (!range.CidrIpv6) continue
    rows.push({
      ...base,
      source: range.CidrIpv6,
      sourceKind: "ipv6",
      description: range.Description ?? null,
      world: isWorldCidr(range.CidrIpv6),
    })
  }
  for (const list of permission.PrefixListIds ?? []) {
    if (!list.PrefixListId) continue
    rows.push({
      ...base,
      source: list.PrefixListId,
      sourceKind: "prefix-list",
      description: list.Description ?? null,
      // A managed prefix list can contain public ranges, and this engine cannot
      // read its entries — `ec2:GetManagedPrefixListEntries` is not a capability
      // it holds. Reporting it as `world: true` would invent findings; reporting
      // it as world-safe would hide them. It is neither: it is a named source a
      // surface shows as-is.
      world: false,
    })
  }
  for (const pair of permission.UserIdGroupPairs ?? []) {
    if (!pair.GroupId) continue
    rows.push({
      ...base,
      source: pair.GroupId,
      sourceKind: "security-group",
      description: pair.Description ?? null,
      world: false,
    })
  }
  return rows
}

/* ------------------------------------------------------------ the reading -- */

/** The retry schedule is throttle.ts's, not a literal. See its header on jitter. */
const RETRY: { attempts: number; backoffMs: number } = {
  attempts: READ_ATTEMPTS,
  // `backoffMs(2)` is the pause after the first failure; readAws doubles it.
  backoffMs: backoffMs(2),
}

/** Every read is a bounded page walk, so the bound exists in exactly one place. */
async function pageThrough<R, T>(
  gw: AwsGateway,
  capability: Parameters<AwsGateway["call"]>[0],
  key: keyof R & string,
  map: (raw: unknown) => T | null,
): Promise<PagedList<T>> {
  const items: T[] = []
  let token: string | undefined
  let pages = 0
  let truncated = false

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = (await gw.call(capability, { NextToken: token })) as
      | (Record<string, unknown> & { NextToken?: string })
      | undefined
    pages += 1
    const raw = response?.[key]
    if (Array.isArray(raw)) {
      for (const entry of raw) {
        const mapped = map(entry)
        if (mapped) items.push(mapped)
      }
    }
    token = typeof response?.NextToken === "string" && response.NextToken ? response.NextToken : undefined
    if (!token) break
    if (page === MAX_PAGES - 1) {
      // Not thrown, and not silent. A partial answer rendered as complete is the
      // failure this whole read plane is built against; a THROWN partial answer
      // would discard the pages that were read, which on an estate genuinely
      // larger than the cap means the console shows nothing at all.
      truncated = true
    }
  }
  return { items, truncated, pages, cap: MAX_PAGES }
}

/** A PagedList is empty when it holds nothing. Truncation cannot make it empty. */
const pagedIsEmpty = (value: unknown): boolean =>
  ((value as PagedList<unknown> | null)?.items ?? []).length === 0

function readOptions(options: { now: () => Date; denial: DenialContext }) {
  return { now: options.now, denial: options.denial, isEmpty: pagedIsEmpty, ...RETRY }
}

/* ---------------------------------------------------------- route analysis -- */

/**
 * The active default route at an internet gateway, if a table has one.
 *
 * `State === "active"` is required: a blackholed route to a gateway that was
 * detached carries no packet, and a subnet reported public because of one is a
 * finding an operator cannot close. `igw-` is AWS's own resource-id prefix.
 * `eigw-` is excluded — an egress-only gateway is IPv6 outbound and accepts no
 * inbound connection, so a subnet behind one is not reachable from outside.
 */
export function internetRouteOf(
  routes: readonly RouteReading[],
): { destination: string; gatewayId: string } | null {
  for (const route of routes) {
    if (route.state !== "active") continue
    if (!isWorldCidr(route.destination)) continue
    const target = route.target ?? ""
    if (target.startsWith("igw-")) {
      return { destination: route.destination as string, gatewayId: target }
    }
  }
  return null
}

function egressOf(routes: readonly RouteReading[]): {
  egress: "nat" | "egress-only-igw" | "none"
  egressVia: string[]
} {
  const nat: string[] = []
  const eigw: string[] = []
  for (const route of routes) {
    if (route.state !== "active") continue
    if (!isWorldCidr(route.destination)) continue
    const target = route.target ?? ""
    if (target.startsWith("nat-")) nat.push(target)
    if (target.startsWith("eigw-")) eigw.push(target)
  }
  if (nat.length > 0) return { egress: "nat", egressVia: nat.sort() }
  if (eigw.length > 0) return { egress: "egress-only-igw", egressVia: eigw.sort() }
  return { egress: "none", egressVia: [] }
}

/**
 * Whether a subnet is reachable from the internet, from its ROUTE TABLE.
 *
 * Exported and pure so the derivation can be reasoned about on its own. The
 * production path calls it through `networkReadings`, and the tests drive it
 * from there — a test that only drove this directly would stay green on the day
 * the caller stopped calling it.
 */
export function subnetReachability(
  subnetId: string,
  vpcId: string | null,
  routeTables: AwsRead<PagedList<RouteTableReading>>,
): SubnetReachability {
  if (routeTables.state !== "ACTUAL" && routeTables.state !== "STALE") {
    return {
      kind: "unknown",
      why:
        `whether ${subnetId} is reachable from the internet is decided by its route table, and ` +
        `${describeRead(routeTables, "the route tables")}. Not private — unread.`,
    }
  }

  const tables = routeTables.value.items
  const explicit = tables.find((t) => t.associatedSubnetIds.includes(subnetId))
  const main = vpcId ? tables.find((t) => t.isMain && t.vpcId === vpcId) : undefined
  const table = explicit ?? main
  const association: "explicit" | "main" = explicit ? "explicit" : "main"

  if (!table) {
    const qualifier = routeTables.value.truncated
      ? ` The route-table read stopped at its ${routeTables.value.cap}-page cap, so the table may exist and not have been read.`
      : ""
    return {
      kind: "unknown",
      why:
        `no route table is associated with ${subnetId} and no main route table was found for ` +
        `${vpcId ?? "its VPC"}. A subnet always uses one, so this engine has not read it.${qualifier}`,
    }
  }

  if (table.internetRoute) {
    return {
      kind: "public",
      via: table.internetRoute.gatewayId,
      destination: table.internetRoute.destination,
      routeTableId: table.routeTableId,
      association,
    }
  }
  const { egress, egressVia } = egressOf(table.routes)
  return { kind: "private", routeTableId: table.routeTableId, association, egress, egressVia }
}

/* ------------------------------------------------------------ the surface -- */

/**
 * The whole VPC network, read live.
 *
 * The production entry point. A route or a page calls it with no arguments and
 * gets the live gateway; a test passes a stand-in gateway to the SAME function.
 */
export async function networkReadings(
  supplied?: AwsGateway,
  options: { now?: () => Date } = {},
): Promise<NetworkReadings> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())

  const identity = await resolveIdentity(supplied, { now })
  const denial = denialContextFrom(identity)
  const tagged = await taggedResources(supplied, { now, denial })
  const index = tagIndex(
    tagged.state === "ACTUAL" || tagged.state === "STALE" ? tagged.value : [],
  )
  const opts = readOptions({ now, denial })

  const attribute = (
    inline: Readonly<Record<string, string>>,
    arn: string | null,
  ): NetworkAttribution => networkAttribution(inline, arn, tagged, index)

  const region = identity.state === "ACTUAL" || identity.state === "STALE" ? identity.value.region : null
  const partition =
    identity.state === "ACTUAL" || identity.state === "STALE" ? identity.value.partition : null

  /* --- the seven reads that do not depend on each other, in parallel ------ */

  const [vpcs, subnetsRaw, routeTables, internetGateways, natGateways, vpcEndpoints, networkAcls] =
    await Promise.all([
      readAws<PagedList<VpcReading>>(
        "ec2:DescribeVpcs",
        () =>
          pageThrough<{ Vpcs?: RawVpc[] }, VpcReading>(gw, "ec2:DescribeVpcs", "Vpcs", (entry) => {
            const raw = entry as RawVpc
            if (!raw.VpcId) return null
            const tags = tagsOf(raw.Tags)
            const arn = ec2Arn(identity, "vpc", raw.VpcId, raw.OwnerId)
            return {
              vpcId: raw.VpcId,
              arn,
              cidrBlock: raw.CidrBlock ?? null,
              cidrBlocks: (raw.CidrBlockAssociationSet ?? [])
                .filter((a) => a.CidrBlockState?.State === "associated" && a.CidrBlock)
                .map((a) => a.CidrBlock as string)
                .sort(),
              ipv6CidrBlocks: (raw.Ipv6CidrBlockAssociationSet ?? [])
                .filter((a) => a.Ipv6CidrBlock)
                .map((a) => a.Ipv6CidrBlock as string)
                .sort(),
              state: raw.State ?? null,
              isDefault: raw.IsDefault === true,
              ownerId: raw.OwnerId ?? null,
              region,
              partition,
              name: nameOf(tags),
              attribution: attribute(tags, arn),
              tags,
            }
          }),
        opts,
      ),

      readAws<PagedList<RawSubnet>>(
        "ec2:DescribeSubnets",
        () =>
          pageThrough<{ Subnets?: RawSubnet[] }, RawSubnet>(
            gw,
            "ec2:DescribeSubnets",
            "Subnets",
            (entry) => ((entry as RawSubnet).SubnetId ? (entry as RawSubnet) : null),
          ),
        opts,
      ),

      readAws<PagedList<RouteTableReading>>(
        "ec2:DescribeRouteTables",
        () =>
          pageThrough<{ RouteTables?: RawRouteTable[] }, RouteTableReading>(
            gw,
            "ec2:DescribeRouteTables",
            "RouteTables",
            (entry) => {
              const raw = entry as RawRouteTable
              if (!raw.RouteTableId) return null
              const tags = tagsOf(raw.Tags)
              const arn = ec2Arn(identity, "route-table", raw.RouteTableId, raw.OwnerId)
              const routes: RouteReading[] = (raw.Routes ?? []).map((route) => ({
                destination:
                  route.DestinationCidrBlock ??
                  route.DestinationIpv6CidrBlock ??
                  route.DestinationPrefixListId ??
                  null,
                target:
                  route.GatewayId ??
                  route.NatGatewayId ??
                  route.TransitGatewayId ??
                  route.VpcPeeringConnectionId ??
                  route.EgressOnlyInternetGatewayId ??
                  route.NetworkInterfaceId ??
                  null,
                state: route.State ?? null,
                origin: route.Origin ?? null,
              }))
              return {
                routeTableId: raw.RouteTableId,
                vpcId: raw.VpcId ?? null,
                arn,
                isMain: (raw.Associations ?? []).some((a) => a.Main === true),
                associatedSubnetIds: (raw.Associations ?? [])
                  .filter((a) => a.SubnetId)
                  .map((a) => a.SubnetId as string)
                  .sort(),
                routes,
                internetRoute: internetRouteOf(routes),
                ownerId: raw.OwnerId ?? null,
                name: nameOf(tags),
                attribution: attribute(tags, arn),
                tags,
              }
            },
          ),
        opts,
      ),

      readAws<PagedList<InternetGatewayReading>>(
        "ec2:DescribeInternetGateways",
        () =>
          pageThrough<{ InternetGateways?: RawInternetGateway[] }, InternetGatewayReading>(
            gw,
            "ec2:DescribeInternetGateways",
            "InternetGateways",
            (entry) => {
              const raw = entry as RawInternetGateway
              if (!raw.InternetGatewayId) return null
              const tags = tagsOf(raw.Tags)
              const arn = ec2Arn(identity, "internet-gateway", raw.InternetGatewayId, raw.OwnerId)
              const states: Record<string, string> = {}
              for (const attachment of raw.Attachments ?? []) {
                if (attachment.VpcId) states[attachment.VpcId] = attachment.State ?? "unknown"
              }
              return {
                internetGatewayId: raw.InternetGatewayId,
                arn,
                attachedVpcIds: Object.keys(states).sort(),
                attachmentStates: states,
                ownerId: raw.OwnerId ?? null,
                name: nameOf(tags),
                attribution: attribute(tags, arn),
                tags,
              }
            },
          ),
        opts,
      ),

      readAws<PagedList<NatGatewayReading>>(
        "ec2:DescribeNatGateways",
        () =>
          pageThrough<{ NatGateways?: RawNatGateway[] }, NatGatewayReading>(
            gw,
            "ec2:DescribeNatGateways",
            "NatGateways",
            (entry) => {
              const raw = entry as RawNatGateway
              if (!raw.NatGatewayId) return null
              const tags = tagsOf(raw.Tags)
              const arn = ec2Arn(identity, "natgateway", raw.NatGatewayId, null)
              return {
                natGatewayId: raw.NatGatewayId,
                vpcId: raw.VpcId ?? null,
                subnetId: raw.SubnetId ?? null,
                arn,
                state: raw.State ?? null,
                connectivityType: raw.ConnectivityType ?? null,
                publicIps: (raw.NatGatewayAddresses ?? [])
                  .filter((a) => a.PublicIp)
                  .map((a) => a.PublicIp as string)
                  .sort(),
                name: nameOf(tags),
                attribution: attribute(tags, arn),
                tags,
              }
            },
          ),
        opts,
      ),

      readAws<PagedList<VpcEndpointReading>>(
        "ec2:DescribeVpcEndpoints",
        () =>
          pageThrough<{ VpcEndpoints?: RawVpcEndpoint[] }, VpcEndpointReading>(
            gw,
            "ec2:DescribeVpcEndpoints",
            "VpcEndpoints",
            (entry) => {
              const raw = entry as RawVpcEndpoint
              if (!raw.VpcEndpointId) return null
              const tags = tagsOf(raw.Tags)
              const arn = ec2Arn(identity, "vpc-endpoint", raw.VpcEndpointId, null)
              return {
                vpcEndpointId: raw.VpcEndpointId,
                vpcId: raw.VpcId ?? null,
                arn,
                endpointType: raw.VpcEndpointType ?? null,
                serviceName: raw.ServiceName ?? null,
                state: raw.State ?? null,
                privateDnsEnabled: raw.PrivateDnsEnabled ?? null,
                routeTableIds: [...(raw.RouteTableIds ?? [])].sort(),
                subnetIds: [...(raw.SubnetIds ?? [])].sort(),
                securityGroupIds: (raw.Groups ?? [])
                  .filter((g) => g.GroupId)
                  .map((g) => g.GroupId as string)
                  .sort(),
                name: nameOf(tags),
                attribution: attribute(tags, arn),
                tags,
              }
            },
          ),
        opts,
      ),

      readAws<PagedList<NetworkAclReading>>(
        "ec2:DescribeNetworkAcls",
        () =>
          pageThrough<{ NetworkAcls?: RawNetworkAcl[] }, NetworkAclReading>(
            gw,
            "ec2:DescribeNetworkAcls",
            "NetworkAcls",
            (entry) => {
              const raw = entry as RawNetworkAcl
              if (!raw.NetworkAclId) return null
              const tags = tagsOf(raw.Tags)
              const arn = ec2Arn(identity, "network-acl", raw.NetworkAclId, raw.OwnerId)
              const entries: NetworkAclEntryReading[] = (raw.Entries ?? []).map((e) => ({
                ruleNumber: e.RuleNumber ?? null,
                protocol: e.Protocol ?? null,
                action: e.RuleAction ?? null,
                egress: e.Egress === true,
                cidr: e.CidrBlock ?? e.Ipv6CidrBlock ?? null,
                fromPort: e.PortRange?.From ?? null,
                toPort: e.PortRange?.To ?? null,
              }))
              return {
                networkAclId: raw.NetworkAclId,
                vpcId: raw.VpcId ?? null,
                arn,
                isDefault: raw.IsDefault === true,
                associatedSubnetIds: (raw.Associations ?? [])
                  .filter((a) => a.SubnetId)
                  .map((a) => a.SubnetId as string)
                  .sort(),
                entries,
                openIngressEntries: entries.filter(
                  (e) =>
                    !e.egress &&
                    e.action === "allow" &&
                    isWorldCidr(e.cidr) &&
                    opensBeyondWeb(e.protocol ?? "-1", e.fromPort, e.toPort),
                ),
                ownerId: raw.OwnerId ?? null,
                name: nameOf(tags),
                attribution: attribute(tags, arn),
                tags,
              }
            },
          ),
        opts,
      ),
    ])

  /* --- security groups, which need the endpoint read to see references ---- */

  const asOf = now().toISOString()

  const securityGroupsRaw = await readAws<PagedList<RawSecurityGroup>>(
    "ec2:DescribeSecurityGroups",
    () =>
      pageThrough<{ SecurityGroups?: RawSecurityGroup[] }, RawSecurityGroup>(
        gw,
        "ec2:DescribeSecurityGroups",
        "SecurityGroups",
        (entry) => ((entry as RawSecurityGroup).GroupId ? (entry as RawSecurityGroup) : null),
      ),
    opts,
  )

  // Which groups something this engine READ refers to. Never "attached to".
  const referencedBy = new Map<string, string[]>()
  const noteReference = (groupId: string, by: string) => {
    const existing = referencedBy.get(groupId) ?? []
    existing.push(by)
    referencedBy.set(groupId, existing)
  }
  for (const endpoint of listOf(vpcEndpoints)) {
    for (const groupId of endpoint.securityGroupIds) {
      noteReference(groupId, `VPC endpoint ${endpoint.vpcEndpointId}`)
    }
  }
  if (securityGroupsRaw.state === "ACTUAL" || securityGroupsRaw.state === "STALE") {
    for (const group of securityGroupsRaw.value.items) {
      for (const permission of [
        ...(group.IpPermissions ?? []),
        ...(group.IpPermissionsEgress ?? []),
      ]) {
        for (const pair of permission.UserIdGroupPairs ?? []) {
          if (pair.GroupId && pair.GroupId !== group.GroupId) {
            noteReference(pair.GroupId, `security group ${group.GroupId} rule`)
          }
        }
      }
    }
  }

  const referencesReadable =
    (securityGroupsRaw.state === "ACTUAL" || securityGroupsRaw.state === "STALE") &&
    (vpcEndpoints.state === "ACTUAL" ||
      vpcEndpoints.state === "STALE" ||
      vpcEndpoints.state === "EMPTY")

  const securityGroups: AwsRead<PagedList<SecurityGroupReading>> =
    securityGroupsRaw.state === "ACTUAL" || securityGroupsRaw.state === "STALE"
      ? {
          ...securityGroupsRaw,
          value: {
            ...securityGroupsRaw.value,
            items: securityGroupsRaw.value.items
              .map((raw) => {
                const tags = tagsOf(raw.Tags)
                const arn = ec2Arn(identity, "security-group", raw.GroupId, raw.OwnerId)
                const attribution = attribute(tags, arn)
                const ingress = (raw.IpPermissions ?? []).flatMap((p) =>
                  flattenPermission(p, "ingress"),
                )
                const egress = (raw.IpPermissionsEgress ?? []).flatMap((p) =>
                  flattenPermission(p, "egress"),
                )
                const worldIngress = ingress.filter((rule) => rule.world)
                const openIngress: InternetIngressFinding[] = worldIngress
                  .filter((rule) => opensBeyondWeb(rule.protocol, rule.fromPort, rule.toPort))
                  .map((rule) => ({
                    groupId: raw.GroupId as string,
                    groupName: raw.GroupName ?? null,
                    vpcId: raw.VpcId ?? null,
                    cidr: rule.source,
                    protocol: rule.protocol,
                    protocolLabel: rule.protocolLabel,
                    fromPort: rule.fromPort,
                    toPort: rule.toPort,
                    reach: reachSentence(rule.protocol, rule.fromPort, rule.toPort, rule.source),
                    attribution,
                    asOf,
                  }))
                const references = referencedBy.get(raw.GroupId as string)
                const usage: SecurityGroupUsage = references
                  ? { kind: "referenced", by: [...new Set(references)].sort() }
                  : referencesReadable
                    ? {
                        kind: "no-attachment-visible",
                        needs: "ec2:DescribeNetworkInterfaces",
                        why:
                          `nothing this engine read refers to ${raw.GroupId} — no other group's rule ` +
                          `names it and no VPC endpoint lists it. That is not proof it is unattached: ` +
                          `an ECS task, an RDS instance or a Lambda ENI could hold it, and only ` +
                          `ec2:DescribeNetworkInterfaces would show that. This engine does not hold it.`,
                      }
                    : {
                        kind: "unknown",
                        why:
                          `whether anything refers to ${raw.GroupId} cannot be said — ` +
                          `${describeRead(vpcEndpoints, "the VPC endpoints")}`,
                      }
                return {
                  groupId: raw.GroupId as string,
                  groupName: raw.GroupName ?? null,
                  description: raw.Description ?? null,
                  vpcId: raw.VpcId ?? null,
                  arn,
                  ownerId: raw.OwnerId ?? null,
                  region,
                  partition,
                  ingress,
                  egress,
                  openIngress,
                  webIngress: worldIngress.filter(
                    (rule) => !opensBeyondWeb(rule.protocol, rule.fromPort, rule.toPort),
                  ),
                  usage,
                  name: nameOf(tags),
                  attribution,
                  tags,
                }
              })
              // Sorted so two loads of the same estate render in the same order.
              .sort((a, b) => a.groupId.localeCompare(b.groupId)),
          },
        }
      : securityGroupsRaw

  /* --- subnets, which need the route tables to be classified -------------- */

  const subnets: AwsRead<PagedList<SubnetReading>> =
    subnetsRaw.state === "ACTUAL" || subnetsRaw.state === "STALE"
      ? {
          ...subnetsRaw,
          value: {
            ...subnetsRaw.value,
            items: subnetsRaw.value.items
              .map((raw) => {
                const tags = tagsOf(raw.Tags)
                const arn = ec2Arn(identity, "subnet", raw.SubnetId, raw.OwnerId)
                return {
                  subnetId: raw.SubnetId as string,
                  vpcId: raw.VpcId ?? null,
                  arn,
                  cidrBlock: raw.CidrBlock ?? null,
                  ipv6CidrBlocks: (raw.Ipv6CidrBlockAssociationSet ?? [])
                    .filter((a) => a.Ipv6CidrBlock)
                    .map((a) => a.Ipv6CidrBlock as string)
                    .sort(),
                  availabilityZone: raw.AvailabilityZone ?? null,
                  availabilityZoneId: raw.AvailabilityZoneId ?? null,
                  mapPublicIpOnLaunch: raw.MapPublicIpOnLaunch ?? null,
                  availableIpAddressCount: raw.AvailableIpAddressCount ?? null,
                  state: raw.State ?? null,
                  ownerId: raw.OwnerId ?? null,
                  region,
                  partition,
                  name: nameOf(tags),
                  reachability: subnetReachability(
                    raw.SubnetId as string,
                    raw.VpcId ?? null,
                    routeTables,
                  ),
                  attribution: attribute(tags, arn),
                  tags,
                }
              })
              .sort((a, b) => a.subnetId.localeCompare(b.subnetId)),
          },
        }
      : subnetsRaw

  return {
    identity,
    tagged,
    vpcs,
    subnets,
    routeTables,
    internetGateways,
    natGateways,
    vpcEndpoints,
    networkAcls,
    securityGroups,
    exposure: internetExposure(securityGroups),
    unreferencedSecurityGroupIds: unreferencedSecurityGroups(securityGroups),
    contradictoryNames: contradictorySubnetNames(subnets),
    asOf,
    refreshMs: {
      vpcs: CAPABILITIES["ec2:DescribeVpcs"].refreshMs,
      subnets: CAPABILITIES["ec2:DescribeSubnets"].refreshMs,
      routeTables: CAPABILITIES["ec2:DescribeRouteTables"].refreshMs,
      internetGateways: CAPABILITIES["ec2:DescribeInternetGateways"].refreshMs,
      natGateways: CAPABILITIES["ec2:DescribeNatGateways"].refreshMs,
      vpcEndpoints: CAPABILITIES["ec2:DescribeVpcEndpoints"].refreshMs,
      networkAcls: CAPABILITIES["ec2:DescribeNetworkAcls"].refreshMs,
      securityGroups: CAPABILITIES["ec2:DescribeSecurityGroups"].refreshMs,
    },
  }
}

/* ------------------------------------------------------------ derivations -- */

/**
 * Whether anything is reachable from the internet, as one answer.
 *
 * A security-group read that did not answer produces `unknown`, carrying the
 * read's own sentence. There is no branch here that turns a refusal into
 * `closed`.
 */
export function internetExposure(
  securityGroups: AwsRead<PagedList<SecurityGroupReading>>,
): InternetExposureState {
  if (securityGroups.state !== "ACTUAL" && securityGroups.state !== "STALE") {
    return { kind: "unknown", why: describeRead(securityGroups, "the security groups") }
  }
  const groups = securityGroups.value.items
  const findings = groups.flatMap((group) => group.openIngress)
  if (findings.length > 0) {
    return {
      kind: "open",
      findings,
      groupsRead: groups.length,
      truncated: securityGroups.value.truncated,
    }
  }
  return {
    kind: "closed",
    groupsRead: groups.length,
    webFacingGroupIds: groups.filter((g) => g.webIngress.length > 0).map((g) => g.groupId).sort(),
    truncated: securityGroups.value.truncated,
  }
}

/**
 * Groups nothing this engine read refers to.
 *
 * Named `unreferenced`, not `unused`, throughout — including in the field on
 * `NetworkReadings` — because the two are not the same claim and this engine can
 * only make the first. See the module header.
 */
export function unreferencedSecurityGroups(
  securityGroups: AwsRead<PagedList<SecurityGroupReading>>,
): readonly string[] {
  if (securityGroups.state !== "ACTUAL" && securityGroups.state !== "STALE") return []
  return securityGroups.value.items
    .filter((g) => g.usage.kind === "no-attachment-visible")
    .map((g) => g.groupId)
    .sort()
}

/**
 * Subnets whose name says private and whose routes say public.
 *
 * The defect worth catching, and the only place in this module a name is read
 * for anything but display. The name is the accusation; the route table is the
 * verdict, and the verdict is already in `reachability` before this runs.
 */
export function contradictorySubnetNames(
  subnets: AwsRead<PagedList<SubnetReading>>,
): readonly SubnetNameContradiction[] {
  if (subnets.state !== "ACTUAL" && subnets.state !== "STALE") return []
  const out: SubnetNameContradiction[] = []
  for (const subnet of subnets.value.items) {
    if (subnet.reachability.kind !== "public") continue
    const name = subnet.name
    if (!name || !/private|internal|isolated/i.test(name)) continue
    out.push({
      subnetId: subnet.subnetId,
      name,
      routeTableId: subnet.reachability.routeTableId,
      via: subnet.reachability.via,
      why:
        `${subnet.subnetId} is named ${JSON.stringify(name)} and route table ` +
        `${subnet.reachability.routeTableId} sends ${subnet.reachability.destination} to ` +
        `${subnet.reachability.via}. It is a public subnet. The name is wrong, not the route.`,
    })
  }
  return out.sort((a, b) => a.subnetId.localeCompare(b.subnetId))
}

/* ------------------------------------------------------------- rendering -- */

/** The sentence a surface prints for one resource's attribution. */
export function describeNetworkAttribution(attribution: NetworkAttribution): string {
  const from = attribution.source === "tag-index" ? "tag index" : "describe response"
  switch (attribution.kind) {
    case "tenant":
      return `${attribution.tenantSlug} (from the ${from})`
    case "shared":
      return `shared — platform overhead, decided (from the ${from})`
    case "unattributed":
      return `unattributable — missing tenure:tenant (from the ${from})`
  }
}

/** The sentence a surface prints for one subnet's reachability. */
export function describeReachability(reachability: SubnetReachability): string {
  switch (reachability.kind) {
    case "public":
      return (
        `PUBLIC — route table ${reachability.routeTableId} (${reachability.association} association) ` +
        `sends ${reachability.destination} to ${reachability.via}`
      )
    case "private":
      return (
        `private — route table ${reachability.routeTableId} (${reachability.association} association) ` +
        `has no internet-gateway route; egress ` +
        (reachability.egress === "none"
          ? "is not available"
          : `via ${reachability.egressVia.join(", ")}`)
      )
    case "unknown":
      return `reachability unknown — ${reachability.why}`
  }
}

/** The sentence a surface prints for one group's usage. Never says "unused". */
export function describeSecurityGroupUsage(usage: SecurityGroupUsage): string {
  switch (usage.kind) {
    case "referenced":
      return `referred to by ${usage.by.join(", ")}`
    case "no-attachment-visible":
      return `no attachment visible to this engine — ${usage.why}`
    case "unknown":
      return `usage unknown — ${usage.why}`
  }
}

/** The sentence a surface prints for the estate's internet exposure. */
export function describeExposure(exposure: InternetExposureState): string {
  switch (exposure.kind) {
    case "unknown":
      return `unknown — ${exposure.why}`
    case "closed": {
      const qualifier = exposure.truncated
        ? " This read stopped at its page cap, so it does not cover every group in the account."
        : ""
      const web =
        exposure.webFacingGroupIds.length === 0
          ? ""
          : ` ${exposure.webFacingGroupIds.length} group(s) are open to the world on 80/443 only ` +
            `(${exposure.webFacingGroupIds.join(", ")}).`
      return (
        `nothing beyond HTTP and HTTPS is reachable from the internet — all ${exposure.groupsRead} ` +
        `security group(s) answered.${web}${qualifier}`
      )
    }
    case "open": {
      const named = exposure.findings.map((f) => `${f.groupId} — ${f.reach}`).join("; ")
      const qualifier = exposure.truncated
        ? " This read stopped at its page cap; there may be more."
        : ""
      return (
        `OPEN TO THE INTERNET — ${exposure.findings.length} rule(s) across ${exposure.groupsRead} ` +
        `security group(s) accept traffic from the whole internet on something other than 80 or ` +
        `443: ${named}.${qualifier}`
      )
    }
  }
}

export interface NetworkLine {
  label: string
  text: string
}

/**
 * What a network surface prints.
 *
 * The route agent renders exactly these strings, and the tests assert on them,
 * which is what makes the mutation proofs land on the production path rather
 * than on a helper nothing calls.
 */
export function networkLines(readings: NetworkReadings): readonly NetworkLine[] {
  const lines: NetworkLine[] = []
  const seconds = (ms: number) => Math.round(ms / 1000)

  const listing = (
    label: string,
    read: AwsRead<PagedList<unknown>>,
    what: string,
    refreshMs: number,
  ) => {
    const base = describeRead(read, `${what}, refreshed every ${seconds(refreshMs)}s`)
    const truncated = wasTruncated(read)
      ? ` — TRUNCATED at the ${MAX_PAGES}-page cap; there were more, and this is not the whole estate`
      : ""
    lines.push({ label, text: `${base}${truncated}` })
  }

  listing("VPCs", readings.vpcs, "VPCs read from AWS", readings.refreshMs.vpcs)
  listing("Subnets", readings.subnets, "subnets read from AWS", readings.refreshMs.subnets)
  listing(
    "Route tables",
    readings.routeTables,
    "route tables read from AWS",
    readings.refreshMs.routeTables,
  )
  listing(
    "Internet gateways",
    readings.internetGateways,
    "internet gateways read from AWS",
    readings.refreshMs.internetGateways,
  )
  listing(
    "NAT gateways",
    readings.natGateways,
    "NAT gateways read from AWS",
    readings.refreshMs.natGateways,
  )
  listing(
    "VPC endpoints",
    readings.vpcEndpoints,
    "VPC endpoints read from AWS",
    readings.refreshMs.vpcEndpoints,
  )
  listing(
    "Network ACLs",
    readings.networkAcls,
    "network ACLs read from AWS",
    readings.refreshMs.networkAcls,
  )
  listing(
    "Security groups",
    readings.securityGroups,
    "security groups read from AWS",
    readings.refreshMs.securityGroups,
  )

  lines.push({ label: "Internet exposure", text: describeExposure(readings.exposure) })

  for (const subnet of listOf(readings.subnets)) {
    lines.push({
      label: subnet.subnetId,
      text:
        `${subnet.name ?? subnet.subnetId} — ${describeReachability(subnet.reachability)} · ` +
        `${describeNetworkAttribution(subnet.attribution)} · ` +
        `public IP on launch: ${
          subnet.mapPublicIpOnLaunch === null ? "not reported" : String(subnet.mapPublicIpOnLaunch)
        } · as of ${readings.asOf}`,
    })
  }

  for (const contradiction of readings.contradictoryNames) {
    lines.push({ label: `${contradiction.subnetId} name`, text: `MISNAMED — ${contradiction.why}` })
  }

  for (const group of listOf(readings.securityGroups)) {
    lines.push({
      label: group.groupId,
      text:
        `${group.groupName ?? group.groupId} — ${group.ingress.length} ingress rule(s), ` +
        `${group.egress.length} egress rule(s) · ` +
        `${
          group.openIngress.length === 0
            ? "nothing open to the internet beyond 80/443"
            : `OPEN: ${group.openIngress.map((f) => f.reach).join("; ")}`
        } · ${describeSecurityGroupUsage(group.usage)} · ` +
        `${describeNetworkAttribution(group.attribution)}`,
    })
  }

  if (readings.unreferencedSecurityGroupIds.length > 0) {
    lines.push({
      label: "Drift candidates",
      text:
        `${readings.unreferencedSecurityGroupIds.length} security group(s) are referred to by ` +
        `nothing this engine read (${readings.unreferencedSecurityGroupIds.join(", ")}). ` +
        `ec2:DescribeNetworkInterfaces would settle whether they are attached; this engine does ` +
        `not hold it, so this is a drift candidate and not a finding.`,
    })
  }

  return lines
}
