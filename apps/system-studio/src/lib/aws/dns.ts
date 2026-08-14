/**
 * STUDIO-080-001 / STUDIO-080-002 (DNS) — where a tenant's hostname actually
 * resolves, and whether the thing it resolves to still exists.
 *
 * `infrastructure/terraform` provisions Route 53 and nothing in the running
 * product ever issued a Route 53 call, so the console could not answer the one
 * question this estate asks about DNS. Tenant URLs are path-based —
 * `<platform host>/<slug>` — and the Studio has its own host, which means a
 * single misdirected apex record takes every tenant offline at once and a single
 * stale alias is a subdomain takeover for all of them.
 *
 * ## The three facts this module keeps apart
 *
 * 1. **This record points at something we own.** The alias or CNAME target
 *    matches a CloudFront distribution domain or a load balancer DNS name that
 *    `cloudfront:ListDistributions` / `elasticloadbalancing:DescribeLoadBalancers`
 *    returned for THIS account.
 * 2. **This record points at something that is not there.** The ownership index
 *    was read successfully and the target is not in it. For a `*.cloudfront.net`
 *    or `*.elb.*` name that is a dangling alias: the name is re-registrable by
 *    whoever claims the next distribution, and the record keeps sending this
 *    estate's users at it. That is a subdomain takeover, and it is the finding.
 * 3. **We could not check.** The index read was refused, throttled or broken, or
 *    no capability this engine holds can enumerate that kind of target at all.
 *
 * (3) is NOT (2). A `dangling` verdict raised because `cloudfront:ListDistributions`
 * was denied is a false alarm that costs an operator an afternoon; a `owned`
 * verdict on the same denial is the reassuring default that gets somebody's
 * subdomain taken. So `AliasOwnership` has a third arm, `unverifiable`, and it is
 * only ever possible to reach `dangling` from an index whose read state was
 * ACTUAL or EMPTY.
 *
 * ## Pagination this engine cannot complete, said out loud
 *
 * `ListResourceRecordSets` pages on THREE cursors — `StartRecordName`,
 * `StartRecordType` and `StartRecordIdentifier`. `client.ts` forwards only
 * `StartRecordName`, and `client.ts` is not this module's file to change. Passing
 * the name alone restarts at the first record with that name, so records already
 * seen come back (deduplicated here by name + type + set identifier) and a single
 * name carrying more record sets than one page holds makes no progress at all.
 *
 * That is reported rather than papered over: `Pagination` has a `stalled` arm
 * naming the missing parameter, alongside `truncated` for the page cap. Nothing
 * downstream may claim "this host has no record" from a read that did not
 * complete — `hostVerdict` returns `unknown` in that case, which is the whole
 * point of the read plane.
 *
 * ## The registrar
 *
 * The apex `NS` record set in a zone is Route 53's own delegation set — the four
 * name servers AWS assigned. Whether the REGISTRAR delegates to those four name
 * servers is a fact that lives at the registrar, and it is outside this account's
 * visibility: `route53domains:GetDomainDetail` is not in the capability registry,
 * and even with it AWS can only answer for domains registered through Route 53
 * Domains in this same account. A domain registered anywhere else cannot be read
 * from AWS at all. So the comparison is reported as NOT_READABLE with that
 * sentence, rather than as a green tick nobody checked.
 *
 * ## Region and partition
 *
 * Route 53 is a global service: a hosted zone has no region, and this module
 * prints that rather than a literal. The PARTITION in a zone ARN comes from the
 * resolved identity's ARN — `arn:aws-us-gov:route53:::hostedzone/…` is a real
 * string and a hardcoded `aws` is the GE-010-007 shape of defect. When identity
 * is unresolved no ARN is assembled at all, because half an ARN joins against the
 * tag index and matches nothing, which reads exactly like an untagged zone.
 *
 * ## Attribution
 *
 * Through `tags.ts` and the Resource Groups Tagging API, so a hosted zone
 * attributes the way an RDS instance does. Following `sqs.ts`, `shared`
 * (somebody decided) stays apart from `unattributed` (nobody tagged it) and a
 * FOURTH answer, `unknown`, covers "the tag index itself was not readable" —
 * "we could not look up this zone's tags" is not "this zone has no tenant tag".
 */

import { CAPABILITIES, type Capability } from "./capabilities"
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
 * How many `ListHostedZones` pages to walk. `client.ts` asks for the API default
 * (100 zones a page), so this is two thousand zones before the cap is reported.
 */
export const MAX_ZONE_PAGES = 20

/**
 * How many `ListResourceRecordSets` pages to walk PER ZONE. `client.ts` asks for
 * 300 records a page, so six thousand record sets in one zone before the cap.
 */
export const MAX_RECORD_PAGES = 20

/**
 * How many zones get their records read in one load.
 *
 * Record sets are one paged call per zone against a Route 53 throttle that is
 * five requests per second for the whole account. Zones past the cap are NOT
 * dropped and do NOT render as having no records: they carry an UNCONFIGURED
 * reading whose `why` says the engine stopped.
 */
export const MAX_ZONE_RECORD_READS = 50

/** How many zone record reads are in flight at once. Route 53's throttle is tight. */
const ZONE_CONCURRENCY = 4

/** Pages of the two ownership indexes. Both are small; the bound is for runaways. */
const MAX_INDEX_PAGES = 20

/* ---------------------------------------------------------------- shapes -- */

/** The API shapes, declared rather than imported — see client.ts's one-owner rule. */
interface ListHostedZonesResponse {
  HostedZones?: Array<{
    Id?: string
    Name?: string
    CallerReference?: string
    Config?: { Comment?: string; PrivateZone?: boolean }
    ResourceRecordSetCount?: number
  }>
  IsTruncated?: boolean
  NextMarker?: string
}

interface ListResourceRecordSetsResponse {
  ResourceRecordSets?: Array<{
    Name?: string
    Type?: string
    SetIdentifier?: string
    TTL?: number
    Weight?: number
    Region?: string
    Failover?: string
    HealthCheckId?: string
    ResourceRecords?: Array<{ Value?: string }>
    AliasTarget?: {
      HostedZoneId?: string
      DNSName?: string
      EvaluateTargetHealth?: boolean
    }
  }>
  IsTruncated?: boolean
  NextRecordName?: string
  NextRecordType?: string
  NextRecordIdentifier?: string
}

interface ListDistributionsResponse {
  DistributionList?: {
    Items?: Array<{
      Id?: string
      ARN?: string
      DomainName?: string
      Enabled?: boolean
      Status?: string
      Aliases?: { Items?: string[] }
    }>
    IsTruncated?: boolean
    NextMarker?: string
  }
}

interface DescribeLoadBalancersResponse {
  LoadBalancers?: Array<{
    LoadBalancerArn?: string
    LoadBalancerName?: string
    DNSName?: string
    Scheme?: string
    Type?: string
    State?: { Code?: string }
  }>
  NextMarker?: string
}

/* ------------------------------------------------------------ pagination -- */

/**
 * Whether a paged read reached the end, and if not, why not.
 *
 * A reader that silently returns the first page is the same lie as an empty
 * list, so "there were more" is a value rather than a log line. Three ways it
 * can fall short and they are not interchangeable: `truncated` means the page cap
 * stopped us and another load with a higher cap would finish; `stalled` means the
 * cursor this engine can send does not advance and no cap change would help;
 * `not-read` means the call never produced a page at all.
 */
export type Pagination =
  | { kind: "complete"; pages: number; items: number }
  | { kind: "truncated"; pages: number; items: number; why: string }
  | { kind: "stalled"; pages: number; items: number; why: string }
  | { kind: "not-read"; why: string }

/** Whether a pagination result may be used to claim that something is ABSENT. */
export function isConclusive(pagination: Pagination): boolean {
  return pagination.kind === "complete"
}

export function describePagination(pagination: Pagination): string {
  switch (pagination.kind) {
    case "complete":
      return `${pagination.items} read over ${pagination.pages} page(s), complete`
    case "truncated":
      return `${pagination.items} read over ${pagination.pages} page(s) — INCOMPLETE: ${pagination.why}`
    case "stalled":
      return `${pagination.items} read over ${pagination.pages} page(s) — INCOMPLETE: ${pagination.why}`
    case "not-read":
      return `not paged — ${pagination.why}`
  }
}

/* ------------------------------------------------------ ownership indexes -- */

/** One CloudFront distribution, reduced to what a DNS target is matched against. */
export interface DistributionTarget {
  id: string
  arn: string | null
  /** `d111111abcdef8.cloudfront.net`, lowercased with any trailing dot removed. */
  domainName: string
  /** The alternate domain names configured on the distribution, normalised. */
  aliases: readonly string[]
  enabled: boolean | null
  status: string | null
}

/** One load balancer, reduced the same way. */
export interface LoadBalancerTarget {
  arn: string
  name: string | null
  /** The ELB DNS name, lowercased with any trailing dot removed. */
  dnsName: string
  scheme: string | null
  state: string | null
}

/* --------------------------------------------------------------- records -- */

/**
 * What kind of thing a DNS target names, decided from the name's own shape.
 *
 * Used to pick which ownership index can answer for it — NEVER to decide whether
 * it is owned. A suffix says which API to ask; only the API says whether the
 * resource exists.
 */
export type TargetService =
  | "cloudfront"
  | "elb"
  | "s3-website"
  | "apigateway"
  | "same-zone"
  | "other"

/**
 * Whether the thing a record points at belongs to this estate.
 *
 * `dangling` is reachable ONLY from an index whose read succeeded. See the module
 * header: a denial rendered as `dangling` is a false alarm and a denial rendered
 * as `owned` is a takeover, so the third arm is not optional.
 */
export type AliasOwnership =
  /** Matched a resource this account returned. `evidence` names which read proved it. */
  | { kind: "owned"; what: string; evidence: string }
  /** The index answered and the target is not in it. This is the takeover finding. */
  | { kind: "dangling"; what: string; why: string }
  /** Not checkable: the index was not readable, or nothing here can enumerate it. */
  | { kind: "unverifiable"; why: string; needs: Capability | null }

/** A record's target, whether it got there by ALIAS or by CNAME. Both can dangle. */
export interface PointerReading {
  /** Exactly what AWS returned, unmodified. */
  raw: string
  /** Lowercased, trailing dot removed, Route 53 octal escapes decoded. */
  dnsName: string
  via: "alias" | "cname"
  service: TargetService
  ownership: AliasOwnership
}

/** Alias-only metadata. Null on every record that is not an alias. */
export interface AliasMetadata {
  /** The target's hosted zone id — `Z2FDTNDATAQYW2` for CloudFront, or this zone. */
  hostedZoneId: string | null
  /** Whether Route 53 fails the alias over on the target's own health. */
  evaluateTargetHealth: boolean | null
}

export interface RecordSet {
  /** AWS's own `Name`, unmodified — trailing dot and octal escapes included. */
  name: string
  /** Lowercased, trailing dot removed, `\\052` decoded to `*`. The join key. */
  normalisedName: string
  type: string
  /** Weighted, latency and failover record sets share a name; this separates them. */
  setIdentifier: string | null
  /**
   * TTL in seconds, or null.
   *
   * Null for an alias record, because Route 53 does not return one — the alias
   * inherits the target's TTL. Rendering `0` there would read as "this record is
   * never cached", which is a different and wrong claim.
   */
  ttlSeconds: number | null
  /** `ResourceRecords` values verbatim. Empty for an alias record. */
  values: readonly string[]
  alias: AliasMetadata | null
  /** The correlated target, for the record types that have one. */
  pointer: PointerReading | null
  weight: number | null
  /** Latency routing's region. Route 53's own field; NOT this engine's region. */
  latencyRegion: string | null
  failover: string | null
  healthCheckId: string | null
}

/* ------------------------------------------------------------ delegation -- */

/**
 * Whether the registrar delegates to the zone's name servers.
 *
 * One arm. See the module header: `route53domains:GetDomainDetail` is not in the
 * capability registry, and it would only answer for a domain registered through
 * Route 53 Domains in this account anyway. This type exists so the absence is a
 * value a surface has to render, not a field a surface can forget.
 */
export interface RegistrarComparison {
  state: "NOT_READABLE"
  /** The capability that would answer it, for domains registered in this account. */
  needs: "route53domains:GetDomainDetail"
  why: string
}

export const REGISTRAR_NOT_READABLE: RegistrarComparison = {
  state: "NOT_READABLE",
  needs: "route53domains:GetDomainDetail",
  why:
    "the registrar's delegation is outside this account's visibility. This engine holds no " +
    "route53domains:GetDomainDetail capability, and that API answers only for domains registered " +
    "through Route 53 Domains in this same account — a domain held at an external registrar cannot " +
    "be read from AWS at all. The name servers below are what Route 53 assigned, not what the " +
    "registrar publishes; whether they match has to be checked at the registrar.",
}

/** The zone's own delegation set, taken from the apex NS record set. */
export type DelegationReading =
  | {
      kind: "nameservers"
      nameservers: readonly string[]
      registrar: RegistrarComparison
    }
  /** No apex NS in a completed read. Normal for a private zone, a finding for a public one. */
  | { kind: "none-in-zone"; privateZone: boolean; why: string }
  /** The records were not read, or not read to completion. Nothing can be said. */
  | { kind: "unknown"; why: string }

/* ------------------------------------------------------------------ zone -- */

/** Which tenant a zone belongs to. `unknown` is the tag index's own failure. */
export type ZoneAttribution =
  | { kind: "tenant"; tenantSlug: string }
  | { kind: "shared" }
  | { kind: "unattributed" }
  | { kind: "unknown"; why: string }

export interface ZoneReading {
  /** The bare id — `Z0123ABC`, with Route 53's `/hostedzone/` prefix removed. */
  id: string
  /** `arn:<partition>:route53:::hostedzone/<id>`, or null when identity is unresolved. */
  arn: string | null
  /** Where the ARN came from, or why there is none. Never silent. */
  arnProvenance: string
  /** AWS's own `Name`, trailing dot included. */
  name: string
  /** Lowercased with the trailing dot removed. What a hostname is matched against. */
  normalisedName: string
  privateZone: boolean
  comment: string | null
  /** `ResourceRecordSetCount` from the listing — AWS's count, not one derived here. */
  declaredRecordCount: number | null
  /** Refused, throttled, broken or read — per zone, with its own action named. */
  records: AwsRead<readonly RecordSet[]>
  /** Whether the record read reached the end. Absence claims depend on this. */
  pagination: Pagination
  delegation: DelegationReading
  attribution: ZoneAttribution
  /** Route 53 is global. Stated, so a surface does not print a region it invented. */
  region: null
  /** From the resolved identity's ARN. Null when identity is unresolved. */
  partition: string | null
  /** This zone's record cadence, from the capability's own declaration. */
  refreshMs: number
  asOf: string
}

/* --------------------------------------------------------------- finding -- */

/** A record pointing at a name the estate does not own. The takeover finding. */
export interface TakeoverRisk {
  zoneId: string
  zoneName: string
  recordName: string
  recordType: string
  target: string
  service: TargetService
  via: "alias" | "cname"
  why: string
  asOf: string
}

/**
 * Whether any record points at something that is not there.
 *
 * `clear` carries the records it could NOT verify, so "clear" never quietly
 * means "clear as far as we were allowed to look".
 */
export type TakeoverState =
  | { kind: "unknown"; why: string }
  | { kind: "clear"; pointersChecked: number; unverified: readonly string[] }
  | {
      kind: "dangling"
      risks: readonly TakeoverRisk[]
      pointersChecked: number
      unverified: readonly string[]
    }

/* -------------------------------------------------------------- readings -- */

/** Everything a DNS surface needs, in one load. */
export interface DnsReadings {
  identity: AwsRead<Identity>
  tagged: AwsRead<readonly TaggedResource[]>
  /**
   * The hosted zones. DENIED here is a refused `route53:ListHostedZones` and is
   * NEVER `[]` — an operator reading "no zones" when the truth is "we were not
   * allowed to look" is the single most dangerous thing this surface can say.
   */
  zones: AwsRead<readonly ZoneReading[]>
  zonePagination: Pagination
  /** The CloudFront ownership index. Degrades on its own; see AliasOwnership. */
  distributions: AwsRead<readonly DistributionTarget[]>
  distributionPagination: Pagination
  /** The load balancer ownership index. Degrades on its own. */
  loadBalancers: AwsRead<readonly LoadBalancerTarget[]>
  loadBalancerPagination: Pagination
  takeover: TakeoverState
  /** When this whole load was assembled. Explicit, so a surface need not invent one. */
  asOf: string
  /** Each capability's own declared cadence, read from the registry, not retyped. */
  refreshMs: {
    zones: number
    records: number
    distributions: number
    loadBalancers: number
  }
}

/* --------------------------------------------------------------- parsing -- */

/**
 * A Route 53 name as a hostname.
 *
 * Route 53 returns names with a trailing dot and escapes anything outside a
 * narrow ASCII set as a three-digit OCTAL sequence — a wildcard record comes back
 * as `\\052.example.com.`. Comparing that string against `*.example.com` fails,
 * so a wildcard would silently never match the host it serves.
 */
export function normaliseDnsName(raw: string): string {
  const decoded = raw.replace(/\\(\d{3})/g, (_match, octal: string) => {
    const code = Number.parseInt(octal, 8)
    return Number.isFinite(code) && code > 0 && code < 128 ? String.fromCharCode(code) : _match
  })
  return decoded.replace(/\.$/, "").toLowerCase()
}

/**
 * Which ownership index can answer for a target, from the target's own shape.
 *
 * Matched on segments rather than on a full commercial-partition suffix:
 * `elb.amazonaws.com` is only the commercial spelling, and a rule keyed on it
 * would classify every GovCloud or China load balancer as `other` and quietly
 * stop checking them.
 */
export function classifyTarget(dnsName: string, sameZone: boolean): TargetService {
  if (/\.cloudfront\.net$/.test(dnsName)) return "cloudfront"
  if (/\.elb\./.test(dnsName)) return "elb"
  if (/(^|\.)s3-website[.-]/.test(dnsName)) return "s3-website"
  if (/\.execute-api\./.test(dnsName)) return "apigateway"
  // Checked last: an in-zone alias to a name that is itself a CloudFront alias
  // still has to be resolved against CloudFront, not against the zone.
  if (sameZone) return "same-zone"
  return "other"
}

/** The bare hosted zone id. `ListHostedZones` returns `/hostedzone/Z0123`. */
export function bareZoneId(id: string): string {
  return id.replace(/^\/hostedzone\//, "")
}

/**
 * A hosted zone's ARN, assembled from the resolved identity's partition.
 *
 * Route 53 ARNs carry no region and no account id — `arn:aws:route53:::hostedzone/Z0123`
 * is the whole shape. The partition is read from the identity's own ARN and never
 * defaulted, because a guessed partition is the GE-010-007 defect and a wrong ARN
 * joins against the tag index and matches nothing, which reads as untagged.
 */
export function deriveZoneArn(id: string, identity: AwsRead<Identity>): string | null {
  if (identity.state !== "ACTUAL" && identity.state !== "STALE") return null
  const bare = bareZoneId(id)
  if (!bare) return null
  return `arn:${identity.value.partition}:route53:::hostedzone/${bare}`
}

/* ----------------------------------------------------------- the reading -- */

/** The retry schedule is throttle.ts's, not a literal. See its header on jitter. */
const RETRY: { attempts: number; backoffMs: number } = {
  attempts: READ_ATTEMPTS,
  // `backoffMs(2)` is the pause after the first failure; readAws doubles it.
  backoffMs: backoffMs(2),
}

interface RawZone {
  id: string
  name: string
  privateZone: boolean
  comment: string | null
  declaredRecordCount: number | null
}

async function listHostedZones(
  gw: AwsGateway,
  options: { now: () => Date; denial: DenialContext },
  report: (pagination: Pagination) => void,
): Promise<AwsRead<readonly RawZone[]>> {
  return readAws<readonly RawZone[]>(
    "route53:ListHostedZones",
    async () => {
      const out: RawZone[] = []
      let marker: string | undefined
      let pages = 0
      report({ kind: "not-read", why: "the hosted zone listing has not answered yet" })
      for (let page = 0; page < MAX_ZONE_PAGES; page += 1) {
        const response = (await gw.call("route53:ListHostedZones", {
          Marker: marker,
        })) as ListHostedZonesResponse
        pages += 1
        for (const zone of response?.HostedZones ?? []) {
          if (!zone.Id || !zone.Name) continue
          out.push({
            id: bareZoneId(zone.Id),
            name: zone.Name,
            privateZone: zone.Config?.PrivateZone === true,
            comment: zone.Config?.Comment ?? null,
            declaredRecordCount:
              typeof zone.ResourceRecordSetCount === "number" ? zone.ResourceRecordSetCount : null,
          })
        }
        marker = response?.IsTruncated ? response?.NextMarker || undefined : undefined
        if (!marker) {
          report({ kind: "complete", pages, items: out.length })
          break
        }
        if (page === MAX_ZONE_PAGES - 1) {
          report({
            kind: "truncated",
            pages,
            items: out.length,
            why:
              `route53:ListHostedZones still reported more after ${MAX_ZONE_PAGES} pages. This is ` +
              `not the whole zone list, and nothing may conclude that a hostname has no zone from it.`,
          })
        }
      }
      // Sorted so two loads of the same estate produce the same order. The API
      // promises lexical order by name, but not across a marker restart, and an
      // order that changes between renders makes a diff of two screenshots
      // unreadable.
      return out.sort((a, b) => (a.name === b.name ? a.id.localeCompare(b.id) : a.name.localeCompare(b.name)))
    },
    { now: options.now, denial: options.denial, ...RETRY },
  )
}

/**
 * One zone's record sets, paged as far as `client.ts`'s cursor allows.
 *
 * See the module header on why the cursor cannot always complete. Duplicates are
 * removed on name + type + set identifier because restarting at a name re-reads
 * everything at that name, and a page that adds nothing new means the cursor has
 * stopped advancing.
 */
async function listRecordSets(
  gw: AwsGateway,
  zone: RawZone,
  options: { now: () => Date; denial: DenialContext },
  report: (pagination: Pagination) => void,
): Promise<AwsRead<readonly RecordSet[]>> {
  return readAws<readonly RecordSet[]>(
    "route53:ListResourceRecordSets",
    async () => {
      const seen = new Set<string>()
      const out: RecordSet[] = []
      let startName: string | undefined
      let pages = 0
      report({ kind: "not-read", why: `the record read for ${zone.name} has not answered yet` })

      for (let page = 0; page < MAX_RECORD_PAGES; page += 1) {
        const response = (await gw.call("route53:ListResourceRecordSets", {
          HostedZoneId: zone.id,
          StartRecordName: startName,
        })) as ListResourceRecordSetsResponse
        pages += 1

        let added = 0
        for (const raw of response?.ResourceRecordSets ?? []) {
          if (!raw.Name || !raw.Type) continue
          const key = `${raw.Name} ${raw.Type} ${raw.SetIdentifier ?? ""}`
          if (seen.has(key)) continue
          seen.add(key)
          added += 1
          out.push(projectRecord(raw, zone))
        }

        if (!response?.IsTruncated || !response?.NextRecordName) {
          report({ kind: "complete", pages, items: out.length })
          break
        }
        if (added === 0) {
          // The cursor did not advance. Raising the page cap would not help: the
          // parameter that would move it past this name is StartRecordType, and
          // this engine has no way to send it.
          report({
            kind: "stalled",
            pages,
            items: out.length,
            why:
              `route53:ListResourceRecordSets reported more records for ${zone.name} but returning ` +
              `to ${response.NextRecordName} produced nothing new. Paging past a name needs ` +
              `StartRecordType (and StartRecordIdentifier), which this engine's AWS adapter does ` +
              `not send. This record list is INCOMPLETE.`,
          })
          break
        }
        startName = response.NextRecordName
        if (page === MAX_RECORD_PAGES - 1) {
          report({
            kind: "truncated",
            pages,
            items: out.length,
            why:
              `route53:ListResourceRecordSets still reported more for ${zone.name} after ` +
              `${MAX_RECORD_PAGES} pages. This record list is INCOMPLETE.`,
          })
        }
      }
      return out
    },
    { now: options.now, denial: options.denial, ...RETRY },
  )
}

/** One record set, with its pointer left unresolved — ownership needs the indexes. */
function projectRecord(
  raw: NonNullable<ListResourceRecordSetsResponse["ResourceRecordSets"]>[number],
  zone: RawZone,
): RecordSet {
  const name = raw.Name as string
  const type = raw.Type as string
  const values = (raw.ResourceRecords ?? [])
    .map((r) => r.Value)
    .filter((v): v is string => typeof v === "string" && v.length > 0)

  const aliasDns = raw.AliasTarget?.DNSName
  const alias: AliasMetadata | null = raw.AliasTarget
    ? {
        hostedZoneId: raw.AliasTarget.HostedZoneId ?? null,
        evaluateTargetHealth:
          typeof raw.AliasTarget.EvaluateTargetHealth === "boolean"
            ? raw.AliasTarget.EvaluateTargetHealth
            : null,
      }
    : null

  let pointer: PointerReading | null = null
  if (typeof aliasDns === "string" && aliasDns.length > 0) {
    const dnsName = normaliseDnsName(aliasDns)
    const sameZone = bareZoneId(raw.AliasTarget?.HostedZoneId ?? "") === zone.id
    pointer = {
      raw: aliasDns,
      dnsName,
      via: "alias",
      service: classifyTarget(dnsName, sameZone),
      // Replaced by `resolveOwnership` once the indexes are in hand. The
      // placeholder is the honest one: nothing has been checked yet.
      ownership: { kind: "unverifiable", why: "not yet correlated", needs: null },
    }
  } else if (type === "CNAME" && values.length > 0) {
    // A CNAME at a distribution domain is the same exposure as an alias at one,
    // and it is what a hand-made record usually is. Correlated identically.
    const dnsName = normaliseDnsName(values[0])
    pointer = {
      raw: values[0],
      dnsName,
      via: "cname",
      service: classifyTarget(dnsName, dnsName.endsWith(normaliseDnsName(zone.name))),
      ownership: { kind: "unverifiable", why: "not yet correlated", needs: null },
    }
  }

  return {
    name,
    normalisedName: normaliseDnsName(name),
    type,
    setIdentifier: raw.SetIdentifier ?? null,
    // Alias records carry no TTL and must not be reported as TTL 0.
    ttlSeconds: typeof raw.TTL === "number" ? raw.TTL : null,
    values,
    alias,
    pointer,
    weight: typeof raw.Weight === "number" ? raw.Weight : null,
    latencyRegion: raw.Region ?? null,
    failover: raw.Failover ?? null,
    healthCheckId: raw.HealthCheckId ?? null,
  }
}

/* ------------------------------------------------------ ownership indexes -- */

async function listDistributions(
  gw: AwsGateway,
  options: { now: () => Date; denial: DenialContext },
  report: (pagination: Pagination) => void,
): Promise<AwsRead<readonly DistributionTarget[]>> {
  return readAws<readonly DistributionTarget[]>(
    "cloudfront:ListDistributions",
    async () => {
      const out: DistributionTarget[] = []
      let marker: string | undefined
      let pages = 0
      report({ kind: "not-read", why: "the distribution index has not answered yet" })
      for (let page = 0; page < MAX_INDEX_PAGES; page += 1) {
        const response = (await gw.call("cloudfront:ListDistributions", {
          Marker: marker,
        })) as ListDistributionsResponse
        pages += 1
        for (const dist of response?.DistributionList?.Items ?? []) {
          if (!dist.Id || !dist.DomainName) continue
          out.push({
            id: dist.Id,
            arn: dist.ARN ?? null,
            domainName: normaliseDnsName(dist.DomainName),
            aliases: (dist.Aliases?.Items ?? []).map(normaliseDnsName),
            enabled: typeof dist.Enabled === "boolean" ? dist.Enabled : null,
            status: dist.Status ?? null,
          })
        }
        marker = response?.DistributionList?.IsTruncated
          ? response?.DistributionList?.NextMarker || undefined
          : undefined
        if (!marker) {
          report({ kind: "complete", pages, items: out.length })
          break
        }
        if (page === MAX_INDEX_PAGES - 1) {
          report({
            kind: "truncated",
            pages,
            items: out.length,
            why:
              `cloudfront:ListDistributions still reported more after ${MAX_INDEX_PAGES} pages. ` +
              `An alias whose target is not in this partial index must NOT be called dangling.`,
          })
        }
      }
      return out.sort((a, b) => a.domainName.localeCompare(b.domainName))
    },
    { now: options.now, denial: options.denial, ...RETRY },
  )
}

async function listLoadBalancers(
  gw: AwsGateway,
  options: { now: () => Date; denial: DenialContext },
  report: (pagination: Pagination) => void,
): Promise<AwsRead<readonly LoadBalancerTarget[]>> {
  return readAws<readonly LoadBalancerTarget[]>(
    "elasticloadbalancing:DescribeLoadBalancers",
    async () => {
      const out: LoadBalancerTarget[] = []
      let marker: string | undefined
      let pages = 0
      report({ kind: "not-read", why: "the load balancer index has not answered yet" })
      for (let page = 0; page < MAX_INDEX_PAGES; page += 1) {
        const response = (await gw.call("elasticloadbalancing:DescribeLoadBalancers", {
          Marker: marker,
        })) as DescribeLoadBalancersResponse
        pages += 1
        for (const lb of response?.LoadBalancers ?? []) {
          if (!lb.LoadBalancerArn || !lb.DNSName) continue
          out.push({
            arn: lb.LoadBalancerArn,
            name: lb.LoadBalancerName ?? null,
            dnsName: normaliseDnsName(lb.DNSName),
            scheme: lb.Scheme ?? null,
            state: lb.State?.Code ?? null,
          })
        }
        marker = response?.NextMarker || undefined
        if (!marker) {
          report({ kind: "complete", pages, items: out.length })
          break
        }
        if (page === MAX_INDEX_PAGES - 1) {
          report({
            kind: "truncated",
            pages,
            items: out.length,
            why:
              `elasticloadbalancing:DescribeLoadBalancers still reported more after ` +
              `${MAX_INDEX_PAGES} pages. An alias whose target is not in this partial index must ` +
              `NOT be called dangling.`,
          })
        }
      }
      return out.sort((a, b) => a.dnsName.localeCompare(b.dnsName))
    },
    { now: options.now, denial: options.denial, ...RETRY },
  )
}

/* -------------------------------------------------------- the correlation -- */

/** Whether a reading is usable as PROOF OF ABSENCE, which is stricter than usable. */
function answered<T>(read: AwsRead<T>): boolean {
  return read.state === "ACTUAL" || read.state === "STALE" || read.state === "EMPTY"
}

function valueOr<T>(read: AwsRead<readonly T[]>): readonly T[] {
  return read.state === "ACTUAL" || read.state === "STALE" ? read.value : []
}

interface OwnershipIndexes {
  distributions: AwsRead<readonly DistributionTarget[]>
  distributionPagination: Pagination
  loadBalancers: AwsRead<readonly LoadBalancerTarget[]>
  loadBalancerPagination: Pagination
}

/**
 * Whether the estate owns the name a record points at.
 *
 * The one place `dangling` can be produced, and it is guarded twice: the index
 * read must have ANSWERED (ACTUAL, STALE or EMPTY — never DENIED, THROTTLED,
 * ERROR or UNCONFIGURED) and its pagination must be `complete`. An index that was
 * cut short is not proof that a target is missing from it, and calling a live
 * distribution dangling sends an operator to re-point production DNS.
 */
export function resolveOwnership(
  pointer: PointerReading,
  indexes: OwnershipIndexes,
  zoneRecords: { names: ReadonlySet<string>; conclusive: boolean; why: string },
): AliasOwnership {
  switch (pointer.service) {
    case "cloudfront": {
      if (!answered(indexes.distributions)) {
        return {
          kind: "unverifiable",
          needs: "cloudfront:ListDistributions",
          why:
            `${pointer.dnsName} is a CloudFront domain and the distribution index was not read — ` +
            `${describeRead(indexes.distributions, "cloudfront:ListDistributions")}. Whether this ` +
            `estate owns it is unknown; it is NOT confirmed and it is NOT dangling.`,
        }
      }
      const match = valueOr(indexes.distributions).find((d) => d.domainName === pointer.dnsName)
      if (match) {
        return {
          kind: "owned",
          what: `CloudFront distribution ${match.id}${match.enabled === false ? " (DISABLED)" : ""}`,
          evidence: `cloudfront:ListDistributions returned ${match.domainName} as distribution ${match.id}`,
        }
      }
      if (!isConclusive(indexes.distributionPagination)) {
        return {
          kind: "unverifiable",
          needs: "cloudfront:ListDistributions",
          why:
            `${pointer.dnsName} is not in the distribution index, but that index is incomplete — ` +
            `${describePagination(indexes.distributionPagination)}. An absence from a partial list ` +
            `is not an absence.`,
        }
      }
      return {
        kind: "dangling",
        what: `CloudFront domain ${pointer.dnsName}`,
        why:
          `cloudfront:ListDistributions listed every distribution in this account and none of them ` +
          `serves ${pointer.dnsName}. A ${pointer.via === "alias" ? "Route 53 alias" : "CNAME"} at a ` +
          `CloudFront domain this account does not own is a subdomain takeover: whoever is given ` +
          `that domain next receives this estate's traffic.`,
      }
    }

    case "elb": {
      if (!answered(indexes.loadBalancers)) {
        return {
          kind: "unverifiable",
          needs: "elasticloadbalancing:DescribeLoadBalancers",
          why:
            `${pointer.dnsName} is a load balancer domain and the load balancer index was not read — ` +
            `${describeRead(indexes.loadBalancers, "elasticloadbalancing:DescribeLoadBalancers")}. ` +
            `Whether this estate owns it is unknown.`,
        }
      }
      const match = valueOr(indexes.loadBalancers).find(
        // ELB alias targets are conventionally prefixed `dualstack.`, which is
        // the same load balancer under a different record. Matched on the suffix
        // so a dualstack alias is not reported as dangling.
        (lb) => pointer.dnsName === lb.dnsName || pointer.dnsName.endsWith(`.${lb.dnsName}`),
      )
      if (match) {
        return {
          kind: "owned",
          what: `load balancer ${match.name ?? match.arn}${match.state && match.state !== "active" ? ` (${match.state})` : ""}`,
          evidence: `elasticloadbalancing:DescribeLoadBalancers returned ${match.dnsName} as ${match.arn}`,
        }
      }
      if (!isConclusive(indexes.loadBalancerPagination)) {
        return {
          kind: "unverifiable",
          needs: "elasticloadbalancing:DescribeLoadBalancers",
          why:
            `${pointer.dnsName} is not in the load balancer index, but that index is incomplete — ` +
            `${describePagination(indexes.loadBalancerPagination)}.`,
        }
      }
      return {
        kind: "dangling",
        what: `load balancer domain ${pointer.dnsName}`,
        why:
          `elasticloadbalancing:DescribeLoadBalancers listed every load balancer in this account ` +
          `and none of them answers to ${pointer.dnsName}. The record points at a load balancer ` +
          `that no longer exists.`,
      }
    }

    case "same-zone": {
      if (!zoneRecords.conclusive) {
        return {
          kind: "unverifiable",
          needs: "route53:ListResourceRecordSets",
          why:
            `${pointer.dnsName} is an alias to another record in this same zone, and this zone's ` +
            `record list is not complete — ${zoneRecords.why}.`,
        }
      }
      if (zoneRecords.names.has(pointer.dnsName)) {
        return {
          kind: "owned",
          what: `the record ${pointer.dnsName} in this same zone`,
          evidence: "route53:ListResourceRecordSets returned that record set from this zone",
        }
      }
      return {
        kind: "dangling",
        what: `${pointer.dnsName} in this same zone`,
        why:
          `this record aliases ${pointer.dnsName} in its own zone and the zone's complete record ` +
          `list contains no such record. The alias resolves to nothing.`,
      }
    }

    case "s3-website":
      return {
        kind: "unverifiable",
        needs: null,
        why:
          `${pointer.dnsName} is an S3 website endpoint. Confirming it needs a per-bucket ` +
          `s3:GetBucketWebsite, which is not in this engine's capability registry, so whether the ` +
          `bucket still exists cannot be answered here. An S3 website alias to a deleted bucket is ` +
          `a takeover vector and is deliberately left UNVERIFIED rather than shown as fine.`,
      }

    case "apigateway":
      return {
        kind: "unverifiable",
        needs: null,
        why:
          `${pointer.dnsName} is an API Gateway endpoint. Confirming it needs apigateway:GET, ` +
          `which is not in this engine's capability registry.`,
      }

    case "other":
      return {
        kind: "unverifiable",
        needs: null,
        why:
          `${pointer.dnsName} is not a name any index this engine holds can enumerate — it is not ` +
          `CloudFront, not a load balancer and not a record in this zone. It may be correct; this ` +
          `engine has no way to say so.`,
      }
  }
}

/* ------------------------------------------------------------ delegation -- */

/** The zone's own name servers, from the apex NS record set. */
export function delegationOf(
  zone: RawZone,
  records: AwsRead<readonly RecordSet[]>,
  pagination: Pagination,
): DelegationReading {
  if (records.state !== "ACTUAL" && records.state !== "STALE") {
    return {
      kind: "unknown",
      why: `this zone's records were not read — ${describeRead(records, `records in ${zone.name}`)}`,
    }
  }
  const apex = normaliseDnsName(zone.name)
  const ns = records.value.find((r) => r.type === "NS" && r.normalisedName === apex)
  if (ns) {
    return {
      kind: "nameservers",
      nameservers: [...ns.values].map((v) => normaliseDnsName(v)).sort(),
      registrar: REGISTRAR_NOT_READABLE,
    }
  }
  if (!isConclusive(pagination)) {
    return {
      kind: "unknown",
      why:
        `no apex NS record was seen, but this zone's record list is incomplete — ` +
        `${describePagination(pagination)}. Absent is not the same as not yet read.`,
    }
  }
  return {
    kind: "none-in-zone",
    privateZone: zone.privateZone,
    why: zone.privateZone
      ? "a private hosted zone is not delegated from the public DNS, so it has no public NS set"
      : "a PUBLIC zone with no apex NS record set is not resolvable from the internet at all",
  }
}

/* ---------------------------------------------------------- attribution -- */

/** Attribution from the tag index, with `unknown` when the index was not readable. */
function attributionFor(
  arn: string | null,
  tagged: AwsRead<readonly TaggedResource[]>,
  index: Map<string, Readonly<Record<string, string>>>,
): ZoneAttribution {
  if (!answered(tagged)) {
    return {
      kind: "unknown",
      why: `this zone's tags were not read — ${describeRead(tagged, "the tag index")}`,
    }
  }
  if (!arn) {
    return {
      kind: "unknown",
      why:
        "this zone has no ARN this engine can state, because the caller identity that carries the " +
        "partition is unresolved. It cannot be joined against the tag index; unattributed would be " +
        "a claim about its tags, and this is a claim about ours.",
    }
  }
  const tags = index.get(arn)
  if (tags === undefined) return { kind: "unattributed" }
  const decided = attributionOf(tags)
  switch (decided.kind) {
    case "tenant":
      return { kind: "tenant", tenantSlug: decided.tenantSlug }
    case "shared":
      return { kind: "shared" }
    case "unattributed":
      return { kind: "unattributed" }
  }
}

/* ----------------------------------------------------------- the surface -- */

/**
 * Every hosted zone, every record in it, and whether its targets still exist.
 *
 * The production entry point. A route or a page calls it with no arguments and
 * gets the live gateway; a test passes a stand-in gateway to the SAME function,
 * because a test that drove a private helper would stay green on the day the
 * caller stopped calling it.
 */
export async function dnsReadings(
  supplied?: AwsGateway,
  options: { now?: () => Date } = {},
): Promise<DnsReadings> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())

  const identity = await resolveIdentity(supplied, { now })
  const denial = denialContextFrom(identity)
  const tagged = await taggedResources(supplied, { now, denial })
  const index = tagIndex(valueOr(tagged))

  const refreshMs = {
    zones: CAPABILITIES["route53:ListHostedZones"].refreshMs,
    records: CAPABILITIES["route53:ListResourceRecordSets"].refreshMs,
    distributions: CAPABILITIES["cloudfront:ListDistributions"].refreshMs,
    loadBalancers: CAPABILITIES["elasticloadbalancing:DescribeLoadBalancers"].refreshMs,
  }

  let distributionPagination: Pagination = { kind: "not-read", why: "not started" }
  let loadBalancerPagination: Pagination = { kind: "not-read", why: "not started" }
  let zonePagination: Pagination = { kind: "not-read", why: "not started" }

  // The two ownership indexes and the zone listing are three separate IAM
  // actions and a role is routinely granted one without the others. Each is its
  // own reading; a denied CloudFront index degrades the alias VERDICTS to
  // unverifiable and does not collapse the zone list.
  const [distributions, loadBalancers] = await Promise.all([
    listDistributions(gw, { now, denial }, (p) => {
      distributionPagination = p
    }),
    listLoadBalancers(gw, { now, denial }, (p) => {
      loadBalancerPagination = p
    }),
  ])

  const listed = await listHostedZones(gw, { now, denial }, (p) => {
    zonePagination = p
  })
  const asOf = now().toISOString()

  const base = {
    identity,
    tagged,
    distributions,
    distributionPagination,
    loadBalancers,
    loadBalancerPagination,
    asOf,
    refreshMs,
  }

  if (listed.state !== "ACTUAL" && listed.state !== "STALE") {
    // No cast: the arms left after this narrowing are precisely the ones with no
    // `value` field, so they are already an `AwsRead<ZoneReading[]>`. A cast here
    // would be the place a future empty array could be smuggled in.
    const zones: AwsRead<readonly ZoneReading[]> = listed
    return {
      ...base,
      zones,
      zonePagination,
      takeover: takeoverState(zones),
    }
  }

  const rawZones = listed.value
  const recordReads: Array<AwsRead<readonly RecordSet[]>> = new Array(rawZones.length)
  const recordPaginations: Pagination[] = new Array(rawZones.length)

  for (let start = 0; start < rawZones.length; start += ZONE_CONCURRENCY) {
    const batch = rawZones.slice(start, start + ZONE_CONCURRENCY)
    await Promise.all(
      batch.map(async (zone, offset) => {
        const position = start + offset
        if (position >= MAX_ZONE_RECORD_READS) {
          recordReads[position] = {
            state: "UNCONFIGURED",
            capability: "route53:ListResourceRecordSets",
            why:
              `this engine reads the records of at most ${MAX_ZONE_RECORD_READS} zones per load and ` +
              `this zone is number ${position + 1} of ${rawZones.length}. Its records were not read — ` +
              `which is not the same as its having none.`,
          }
          recordPaginations[position] = {
            kind: "not-read",
            why: `zone ${position + 1} of ${rawZones.length} is past the ${MAX_ZONE_RECORD_READS}-zone budget`,
          }
          return
        }
        recordPaginations[position] = { kind: "not-read", why: "not started" }
        recordReads[position] = await listRecordSets(gw, zone, { now, denial }, (p) => {
          recordPaginations[position] = p
        })
      }),
    )
  }

  const indexes: OwnershipIndexes = {
    distributions,
    distributionPagination,
    loadBalancers,
    loadBalancerPagination,
  }

  const readings: ZoneReading[] = rawZones.map((zone, i) => {
    const records = recordReads[i]
    const pagination = recordPaginations[i]
    const names = new Set(valueOr(records).map((r) => r.normalisedName))
    const zoneRecords = {
      names,
      conclusive: answered(records) && isConclusive(pagination),
      why: describePagination(pagination),
    }

    // Correlation happens here, once every index is in hand. The record objects
    // are rebuilt rather than mutated so the placeholder ownership cannot leak.
    const correlated: readonly RecordSet[] = valueOr(records).map((record) =>
      record.pointer === null
        ? record
        : {
            ...record,
            pointer: {
              ...record.pointer,
              ownership: resolveOwnership(record.pointer, indexes, zoneRecords),
            },
          },
    )
    const withOwnership: AwsRead<readonly RecordSet[]> =
      records.state === "ACTUAL" || records.state === "STALE"
        ? { ...records, value: correlated }
        : records

    const arn = deriveZoneArn(zone.id, identity)
    const identityResolved = identity.state === "ACTUAL" || identity.state === "STALE"

    return {
      id: zone.id,
      arn,
      arnProvenance: arn
        ? "assembled from the resolved identity's partition — a Route 53 ARN carries no region " +
          "and no account id"
        : "none — the caller identity is unresolved, so the partition is unknown and this engine " +
          "will not assemble an ARN it cannot stand behind",
      name: zone.name,
      normalisedName: normaliseDnsName(zone.name),
      privateZone: zone.privateZone,
      comment: zone.comment,
      declaredRecordCount: zone.declaredRecordCount,
      records: withOwnership,
      pagination,
      delegation: delegationOf(zone, withOwnership, pagination),
      attribution: attributionFor(arn, tagged, index),
      region: null,
      partition: identityResolved ? identity.value.partition : null,
      refreshMs: refreshMs.records,
      asOf,
    }
  })

  const zones: AwsRead<readonly ZoneReading[]> = { ...listed, value: readings }
  return { ...base, zones, zonePagination, takeover: takeoverState(zones) }
}

/* ------------------------------------------------------------- findings -- */

/**
 * Whether any record points at something the estate does not own.
 *
 * Exported and pure so the derivation can be reasoned about on its own, but
 * `dnsReadings` is the only production caller and the tests drive it through
 * there rather than through here.
 */
export function takeoverState(zones: AwsRead<readonly ZoneReading[]>): TakeoverState {
  if (zones.state !== "ACTUAL" && zones.state !== "STALE") {
    return { kind: "unknown", why: describeRead(zones, "the hosted zone listing") }
  }

  const risks: TakeoverRisk[] = []
  const unverified: string[] = []
  let pointersChecked = 0

  for (const zone of zones.value) {
    if (!answered(zone.records)) {
      unverified.push(`${zone.name} (records: ${describeRead(zone.records, "record sets")})`)
      continue
    }
    if (!isConclusive(zone.pagination)) {
      unverified.push(`${zone.name} (${describePagination(zone.pagination)})`)
    }
    for (const record of valueOr(zone.records)) {
      if (!record.pointer) continue
      pointersChecked += 1
      const ownership = record.pointer.ownership
      if (ownership.kind === "dangling") {
        risks.push({
          zoneId: zone.id,
          zoneName: zone.name,
          recordName: record.name,
          recordType: record.type,
          target: record.pointer.dnsName,
          service: record.pointer.service,
          via: record.pointer.via,
          why: ownership.why,
          asOf: zone.asOf,
        })
      } else if (ownership.kind === "unverifiable") {
        unverified.push(`${record.name} ${record.type} → ${record.pointer.dnsName}`)
      }
    }
  }

  if (risks.length > 0) return { kind: "dangling", risks, pointersChecked, unverified }
  return { kind: "clear", pointersChecked, unverified }
}

/* ---------------------------------------------- the operational question -- */

/**
 * Where one hostname actually resolves, and whether that is our distribution.
 *
 * This is the question the estate asks: tenant URLs are path-based under one
 * platform host, so "does the DNS for this tenant point at our CloudFront
 * distribution" is one hostname's verdict, and it has to be answerable without
 * leaving the page.
 *
 * Every arm that could be mistaken for "fine" is guarded on the pagination that
 * produced it. `no-record` is a CLAIM — it says the zone was read to the end and
 * this host is not in it — so it is unreachable from a truncated or stalled read.
 */
export type HostVerdict =
  | { kind: "unknown"; host: string; why: string }
  | { kind: "no-zone"; host: string; why: string }
  | { kind: "ambiguous-zone"; host: string; zones: readonly string[]; why: string }
  | { kind: "no-record"; host: string; zoneName: string; why: string }
  | {
      kind: "points-at-distribution"
      host: string
      zoneName: string
      recordType: string
      via: "alias" | "cname"
      distributionId: string
      distributionDomain: string
      enabled: boolean | null
      why: string
    }
  | {
      kind: "points-elsewhere"
      host: string
      zoneName: string
      recordType: string
      target: string
      service: TargetService
      what: string
      why: string
    }
  | {
      kind: "dangling"
      host: string
      zoneName: string
      recordType: string
      target: string
      service: TargetService
      why: string
    }

/** Record types that decide where a hostname resolves. */
const ADDRESS_TYPES = new Set(["A", "AAAA", "CNAME"])

export function hostVerdict(readings: DnsReadings, host: string): HostVerdict {
  const wanted = normaliseDnsName(host)
  if (readings.zones.state !== "ACTUAL" && readings.zones.state !== "STALE") {
    return {
      kind: "unknown",
      host: wanted,
      why: describeRead(readings.zones, "the hosted zone listing"),
    }
  }

  // The most specific zone whose name is a suffix of the host. A public and a
  // private zone of the same name is split-horizon DNS, and answering from one
  // of them silently would be answering the wrong question half the time.
  const candidates = readings.zones.value.filter(
    (z) => wanted === z.normalisedName || wanted.endsWith(`.${z.normalisedName}`),
  )
  if (candidates.length === 0) {
    if (!isConclusive(readings.zonePagination)) {
      return {
        kind: "unknown",
        host: wanted,
        why:
          `no hosted zone in the part of the list this engine read covers ${wanted}, and that list ` +
          `is incomplete — ${describePagination(readings.zonePagination)}.`,
      }
    }
    return {
      kind: "no-zone",
      host: wanted,
      why: `this account holds no hosted zone covering ${wanted}; its DNS is served somewhere else`,
    }
  }
  const longest = Math.max(...candidates.map((z) => z.normalisedName.length))
  const best = candidates.filter((z) => z.normalisedName.length === longest)
  if (best.length > 1) {
    return {
      kind: "ambiguous-zone",
      host: wanted,
      zones: best.map((z) => `${z.id} (${z.privateZone ? "private" : "public"})`),
      why:
        `${best.length} hosted zones of equal specificity cover ${wanted}. Which one answers ` +
        `depends on the resolver's vantage point, and this engine will not pick one for you.`,
    }
  }

  const zone = best[0]
  if (!answered(zone.records)) {
    return {
      kind: "unknown",
      host: wanted,
      why: `zone ${zone.name} was listed but its records were not read — ${describeRead(zone.records, "record sets")}`,
    }
  }

  const match = valueOr(zone.records).find(
    (r) => r.normalisedName === wanted && ADDRESS_TYPES.has(r.type),
  )
  if (!match) {
    if (!isConclusive(zone.pagination)) {
      return {
        kind: "unknown",
        host: wanted,
        why:
          `no A, AAAA or CNAME for ${wanted} was seen in ${zone.name}, but that zone's record list ` +
          `is incomplete — ${describePagination(zone.pagination)}. This is not "no record".`,
      }
    }
    return {
      kind: "no-record",
      host: wanted,
      zoneName: zone.name,
      why:
        `${zone.name} was read to the end and holds no A, AAAA or CNAME for ${wanted}. The host ` +
        `does not resolve from this zone.`,
    }
  }

  const pointer = match.pointer
  if (!pointer) {
    return {
      kind: "points-elsewhere",
      host: wanted,
      zoneName: zone.name,
      recordType: match.type,
      target: match.values.join(", "),
      service: "other",
      what: `a literal ${match.type} record`,
      why:
        `${wanted} is a plain ${match.type} record pointing at ${match.values.join(", ") || "nothing"} ` +
        `— not an alias and not a CNAME, so it does not go through CloudFront`,
    }
  }

  const ownership = pointer.ownership
  if (ownership.kind === "unverifiable") {
    return { kind: "unknown", host: wanted, why: ownership.why }
  }
  if (ownership.kind === "dangling") {
    return {
      kind: "dangling",
      host: wanted,
      zoneName: zone.name,
      recordType: match.type,
      target: pointer.dnsName,
      service: pointer.service,
      why: ownership.why,
    }
  }
  if (pointer.service === "cloudfront") {
    const dist = valueOr(readings.distributions).find((d) => d.domainName === pointer.dnsName)
    return {
      kind: "points-at-distribution",
      host: wanted,
      zoneName: zone.name,
      recordType: match.type,
      via: pointer.via,
      distributionId: dist?.id ?? "unknown",
      distributionDomain: pointer.dnsName,
      enabled: dist?.enabled ?? null,
      why: ownership.evidence,
    }
  }
  return {
    kind: "points-elsewhere",
    host: wanted,
    zoneName: zone.name,
    recordType: match.type,
    target: pointer.dnsName,
    service: pointer.service,
    what: ownership.what,
    why:
      `${wanted} resolves to ${ownership.what}, not to a CloudFront distribution. Traffic for this ` +
      `host does not pass the edge.`,
  }
}

/* ------------------------------------------------------------ rendering -- */

export function describeOwnership(ownership: AliasOwnership): string {
  switch (ownership.kind) {
    case "owned":
      return `points at ${ownership.what} — ${ownership.evidence}`
    case "dangling":
      return `DANGLING — ${ownership.why}`
    case "unverifiable":
      return `unverified — ${ownership.why}${ownership.needs ? ` (would need ${ownership.needs})` : ""}`
  }
}

export function describeDelegation(delegation: DelegationReading): string {
  switch (delegation.kind) {
    case "nameservers":
      return (
        `delegated to ${delegation.nameservers.join(", ")} — registrar comparison ` +
        `${delegation.registrar.state}: ${delegation.registrar.why}`
      )
    case "none-in-zone":
      return `no apex NS record — ${delegation.why}`
    case "unknown":
      return `delegation unknown — ${delegation.why}`
  }
}

export function describeZoneAttribution(attribution: ZoneAttribution): string {
  switch (attribution.kind) {
    case "tenant":
      return attribution.tenantSlug
    case "shared":
      return "shared — platform overhead, decided"
    case "unattributed":
      return "unattributable — missing tenure:tenant"
    case "unknown":
      return `attribution unknown — ${attribution.why}`
  }
}

export function describeRecord(record: RecordSet): string {
  const ttl =
    record.ttlSeconds === null
      ? record.alias
        ? "no TTL (alias — inherits the target's)"
        : "no TTL returned"
      : `TTL ${record.ttlSeconds}s`
  const head = `${record.name} ${record.type}${record.setIdentifier ? ` [${record.setIdentifier}]` : ""} — ${ttl}`
  if (record.pointer) {
    return `${head} — ${record.pointer.via} → ${record.pointer.dnsName} — ${describeOwnership(record.pointer.ownership)}`
  }
  return `${head} — ${record.values.length > 0 ? record.values.join(", ") : "no values"}`
}

export function describeZone(zone: ZoneReading): string {
  const where = zone.partition
    ? `partition ${zone.partition}, no region (Route 53 is global)`
    : "partition unknown — the caller identity is unresolved"
  const head =
    `${zone.name} (${zone.id}, ${zone.privateZone ? "private" : "public"}) — ${where} — ` +
    `${describeZoneAttribution(zone.attribution)}`

  if (zone.records.state === "ACTUAL" || zone.records.state === "STALE") {
    return (
      `${head} — ${zone.records.value.length} record set(s), ${describePagination(zone.pagination)} · ` +
      `${describeDelegation(zone.delegation)} · as of ${zone.asOf}, refreshed every ` +
      `${Math.round(zone.refreshMs / 1000)}s`
    )
  }
  // Every other state goes through the one renderer, so a refused record read
  // reads as a refusal here exactly as it does everywhere else — never as "0
  // records".
  return `${head} — ${describeRead(zone.records, `record sets in ${zone.name}`)}`
}

export function describeTakeoverState(state: TakeoverState): string {
  switch (state.kind) {
    case "unknown":
      return `unknown — ${state.why}`
    case "clear": {
      const qualifier =
        state.unverified.length === 0
          ? ""
          : `, though ${state.unverified.length} target(s) could not be verified (${state.unverified.join("; ")})`
      return (
        `no dangling records — ${state.pointersChecked} alias/CNAME target(s) were checked against ` +
        `this account's distributions and load balancers and every verified one still exists${qualifier}`
      )
    }
    case "dangling": {
      const named = state.risks
        .map((r) => `${r.recordName} ${r.recordType} → ${r.target} (${r.service}, via ${r.via})`)
        .join("; ")
      const qualifier =
        state.unverified.length === 0
          ? ""
          : ` A further ${state.unverified.length} target(s) could not be verified.`
      return (
        `SUBDOMAIN TAKEOVER RISK — ${state.risks.length} record(s) point at a name this account does ` +
        `not own: ${named}.${qualifier}`
      )
    }
  }
}

export function describeHostVerdict(verdict: HostVerdict): string {
  switch (verdict.kind) {
    case "unknown":
      return `${verdict.host}: unknown — ${verdict.why}`
    case "no-zone":
      return `${verdict.host}: no zone — ${verdict.why}`
    case "ambiguous-zone":
      return `${verdict.host}: ambiguous — ${verdict.why} (${verdict.zones.join(", ")})`
    case "no-record":
      return `${verdict.host}: no record — ${verdict.why}`
    case "points-at-distribution":
      return (
        `${verdict.host}: points at CloudFront distribution ${verdict.distributionId} ` +
        `(${verdict.distributionDomain}) by ${verdict.via} ${verdict.recordType} in ${verdict.zoneName}` +
        `${verdict.enabled === false ? " — but that distribution is DISABLED" : ""}`
      )
    case "points-elsewhere":
      return `${verdict.host}: NOT CloudFront — ${verdict.why}`
    case "dangling":
      return `${verdict.host}: DANGLING — ${verdict.why}`
  }
}

export interface DnsLine {
  label: string
  text: string
}

/**
 * What a DNS surface prints.
 *
 * The surface agent renders exactly these strings. The tests assert on them,
 * which is what makes the mutation proofs land on the production path rather
 * than on a helper nothing calls.
 *
 * `hosts` are the hostnames the caller wants a verdict on — the platform host
 * and the Studio's own host. They are the CALLER's, never a literal here: this
 * module is not the place a domain name gets hardcoded.
 */
export function dnsLines(readings: DnsReadings, hosts: readonly string[] = []): readonly DnsLine[] {
  const lines: DnsLine[] = [
    {
      label: "Hosted zones",
      text:
        describeRead(
          readings.zones,
          `hosted zones read from AWS, refreshed every ${Math.round(readings.refreshMs.zones / 1000)}s`,
        ) + ` · ${describePagination(readings.zonePagination)}`,
    },
    {
      label: "Distribution index",
      text:
        describeRead(readings.distributions, "CloudFront distributions, the alias ownership index") +
        ` · ${describePagination(readings.distributionPagination)}`,
    },
    {
      label: "Load balancer index",
      text:
        describeRead(readings.loadBalancers, "load balancers, the second alias ownership index") +
        ` · ${describePagination(readings.loadBalancerPagination)}`,
    },
    { label: "Takeover risk", text: describeTakeoverState(readings.takeover) },
  ]
  for (const host of hosts) {
    lines.push({ label: host, text: describeHostVerdict(hostVerdict(readings, host)) })
  }
  if (readings.zones.state === "ACTUAL" || readings.zones.state === "STALE") {
    for (const zone of readings.zones.value) {
      lines.push({ label: zone.name, text: describeZone(zone) })
      for (const record of valueOr(zone.records)) {
        lines.push({ label: `${zone.name} ${record.name} ${record.type}`, text: describeRecord(record) })
      }
    }
  }
  return lines
}
