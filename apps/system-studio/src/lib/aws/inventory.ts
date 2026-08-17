/**
 * STUDIO-080-001 / STUDIO-000-008 — what is actually running, read from AWS.
 *
 * The estate the console showed before this was a JSON file: `tools/aws-inventory.mjs`
 * shelled out to the `aws` CLI in a workflow, wrote counts into
 * `docs/architecture/aws-inventory.json`, and `/platform` rendered them with a
 * date. Nothing in the running product had ever issued an ECS, RDS, CloudFront
 * or ACM call. Worse, the collector mapped every failure to `null` and every
 * `null` to `[]`, so a role with no permissions and an estate with no resources
 * produced the same page.
 *
 * Every read here returns `AwsRead<T>`, so those two are different values before
 * they are different pixels. Every resource lands on ONE shape, `EstateResource`,
 * so a dependency edge or a tenant attribution means the same thing whichever
 * service it came from.
 *
 * Dependency edges come only from identifiers the describe response already
 * carries — a service's cluster ARN, its target group, a distribution's origin
 * domain, a database's subnet group. Nothing is inferred from a name.
 */

import {
  CONTROL_PLANE_SCHEMA_VERSIONS,
  parseEstateResource,
  type EstateResource as PublishedResource,
} from "@tenure/contracts"

import {
  ACM_TTL_MS,
  CAPABILITIES,
  CLOUDFRONT_TTL_MS,
  ECS_TTL_MS,
  RDS_TTL_MS,
  type Capability,
} from "./capabilities"
import { denialContextFrom, resolveIdentity, type Identity } from "./identity"
import {
  describeRead,
  errorName,
  isThrottle,
  liveGateway,
  readAws,
  safeDetail,
  type AwsGateway,
  type AwsRead,
  type DenialContext,
} from "./read"
import { attributionOf, tagIndex, taggedResources, type Attribution, type TaggedResource } from "./tags"
import { isTransient } from "./throttle"

/* --------------------------------------------- every other service's reader -- */

import { analyzerReadings, type AnalyzerReading } from "./analyzer"
import { alarmSurface } from "./alarms"
import { awsHealthSurface } from "./aws-health"
import { budgetReadings, type BudgetReading } from "./budgets"
import { bucketPosture, type BucketReading } from "./buckets"
import { cdnReadings } from "./cdn"
import { certificateReadings } from "./certificates"
import { cognitoReadings, type PoolReading } from "./cognito"
import { complianceReadings, type ConfigRuleReading } from "./compliance"
import { containerReadings, type ClusterReading } from "./containers"
import { dashboardReadings, type DashboardRow } from "./dashboards"
import { databaseReadings, type SnapshotReading } from "./database"
import { dnsReadings, type ZoneReading } from "./dns"
import { tableReadings, type TableReading } from "./dynamodb-tables"
import { ecrReadings, type RepositoryReading } from "./ecr"
import { elastiCacheReadings, type CacheClusterReading, type ReplicationGroupReading } from "./elasticache"
import { eventBridgeSurface, type RuleRow } from "./eventbridge"
import { securityFindings } from "./findings"
import { guardDutyReadings, type DetectorReading } from "./guardduty"
import { iamPosture } from "./iam"
import { keyReadings, type KeyReading } from "./keys"
import { lambdaInventory, type LambdaFunctionReading } from "./lambda"
import { loadBalancerReadings, type LoadBalancerReading } from "./loadbalancer"
import { logGroupReadings, type LogGroupReading } from "./logs"
import {
  networkReadings,
  type InternetGatewayReading,
  type NatGatewayReading,
  type NetworkAclReading,
  type RouteTableReading,
  type SecurityGroupReading,
  type SubnetReading,
  type VpcEndpointReading,
  type VpcReading,
} from "./network"
import { organizationSurface } from "./organization"
import { curExistence, type CurExistence } from "./posture"
import { pricingReadings } from "./pricing"
import { quotaReadings } from "./quotas"
import { secretReadings, type SecretReading } from "./secrets"
import { sesReadings, type SesIdentity } from "./ses"
import { queueReadings, type QueueReading } from "./sqs"
import { trailReadings, type TrailReading } from "./trail"
import { wafReadings, type WafReadings, type WebAclSummary } from "./waf"

/* --------------------------------------------------------------- shapes -- */

export interface EstateResource {
  arn: string
  /** `ecs:service`, `rds:db`, `cloudfront:distribution`, `acm:certificate`. */
  resourceType: string
  name: string
  /** The service's own word for what it is doing. Never normalised away. */
  state: string
  region: string
  accountId: string
  partition: string
  tags: Readonly<Record<string, string>>
  attribution: Attribution
  /** ARNs and domains this resource names in its own describe response. */
  dependsOn: readonly string[]
  asOf: string
  /**
   * STUDIO-130-001 — the same resource in the published, versioned shape.
   *
   * Not a copy for convenience. `parseEstateResource` is a runtime gate, and
   * this is where it is applied: an adapter that starts emitting a resource
   * with an ARN naming another account, an account id that is not twelve
   * digits, or a field this build has never heard of is refused HERE, inside
   * the `readAws` wrapper, so the surface becomes ERROR rather than rendering
   * it. The alternative is a malformed resource reaching an operator who then
   * acts on it, which is the one outcome the read plane exists to prevent.
   *
   * Kept beside the local shape rather than replacing it because the two answer
   * different questions: `state` and `dependsOn` are what this console draws,
   * and `schemaVersion`/`stateful` are what anything outside this process needs
   * in order to read the resource at all.
   */
  contract: PublishedResource
}

/**
 * Resource types whose deletion destroys data that recreating does not restore.
 *
 * The one input `reversible` is derived from, here rather than in the drift
 * detector, because this module is the only one that knows what the resource
 * IS. Removing an ECS service and putting it back is a deployment; removing an
 * RDS instance and putting it back is a new empty database with the same name.
 */
export const STATEFUL_RESOURCE_TYPES: ReadonlySet<string> = new Set([
  "rds:db",
  "rds:cluster",
  "s3:bucket",
  "dynamodb:table",
  "efs:file-system",
  "elasticache:cluster",
  "backup:vault",
  /*
   * Added when the inventory learned to read these services. Each one destroys
   * something that recreating the resource does not bring back, which is the
   * only test this set applies:
   *
   *   rds:snapshot            the restore point itself — there is no second copy
   *   elasticache:replication-group  the cached data and the failover topology
   *   cognito-idp:userpool    every operator account in it, and their passwords
   *   secretsmanager:secret   the material; recreating gives an empty name
   *   kms:key                 everything ever encrypted under it, permanently
   *   ecr:repository          every image digest, including what is running now
   *   logs:log-group          the retained events, which is what an audit reads
   *   route53:hostedzone      the record set, and the delegation with it
   *   cloudtrail:trail        recreating starts a NEW history, not the old one
   */
  "rds:snapshot",
  "elasticache:replication-group",
  "cognito-idp:userpool",
  "secretsmanager:secret",
  "kms:key",
  "ecr:repository",
  "logs:log-group",
  "route53:hostedzone",
  "cloudtrail:trail",
])

export interface ParsedArn {
  partition: string
  service: string
  region: string
  accountId: string
  resource: string
}

/**
 * The five fields an ARN carries, or null.
 *
 * Null rather than partial: half a parsed ARN produces a resource whose region
 * is `""`, which renders as a resource with no region rather than as a parse
 * failure, and the two need different responses.
 */
export function parseArn(arn: string): ParsedArn | null {
  const parts = arn.split(":")
  if (parts.length < 6 || parts[0] !== "arn") return null
  return {
    partition: parts[1],
    service: parts[2],
    region: parts[3],
    accountId: parts[4],
    resource: parts.slice(5).join(":"),
  }
}

/* ---------------------------------------------------- the service reads -- */

interface ListClustersResponse {
  clusterArns?: string[]
}
interface ListServicesResponse {
  serviceArns?: string[]
  nextToken?: string
}
interface DescribeServicesResponse {
  services?: Array<{
    serviceArn?: string
    serviceName?: string
    status?: string
    clusterArn?: string
    desiredCount?: number
    runningCount?: number
    loadBalancers?: Array<{ targetGroupArn?: string }>
    tags?: Array<{ key?: string; value?: string }>
  }>
}
interface DescribeDBInstancesResponse {
  DBInstances?: Array<{
    DBInstanceArn?: string
    DBInstanceIdentifier?: string
    DBInstanceStatus?: string
    DBSubnetGroup?: { DBSubnetGroupName?: string }
    VpcSecurityGroups?: Array<{ VpcSecurityGroupId?: string }>
  }>
  Marker?: string
}
interface ListDistributionsResponse {
  DistributionList?: {
    Items?: Array<{
      ARN?: string
      Id?: string
      Status?: string
      Origins?: { Items?: Array<{ DomainName?: string }> }
    }>
    NextMarker?: string
  }
}
interface ListCertificatesResponse {
  CertificateSummaryList?: Array<{
    CertificateArn?: string
    DomainName?: string
    Status?: string
  }>
  NextToken?: string
}

interface ReadContext {
  now: () => Date
  denial: DenialContext
  tags: Map<string, Readonly<Record<string, string>>>
  /**
   * The resolved account, region and partition — used ONLY where the ARN itself
   * carries none.
   *
   * `arn:aws:s3:::tenure-prod-uploads` and
   * `arn:aws:route53:::hostedzone/Z0123ABC` are complete, correct ARNs whose
   * region and account segments are empty by construction: S3 bucket names and
   * hosted zones are partition-global. `parseEstateResource` requires a
   * twelve-digit account, and its cross-field rule explicitly permits an empty
   * ARN segment beside a stated account — so the account is taken from the
   * identity STS resolved, which is the account the call was made in and the
   * only account those resources can have been returned from.
   *
   * Null when identity itself could not be read. It is never a literal, and
   * never a default: a resource whose ARN carries no account, read by an engine
   * that cannot see its own account, is omitted with that reason rather than
   * published under a guessed one.
   */
  accountId: string | null
  region: string | null
  partition: string | null
}

function resourceFrom(
  arn: string,
  resourceType: string,
  name: string,
  state: string,
  dependsOn: readonly string[],
  ctx: ReadContext,
  inlineTags: Readonly<Record<string, string>> = {},
): EstateResource {
  const parsed = parseArn(arn)
  // The tag index wins over inline tags: it is the same source the cost
  // allocation and the orphan detector read, and two attributions that
  // disagree is worse than one that is missing.
  const tags = { ...inlineTags, ...(ctx.tags.get(arn) ?? {}) }
  const attribution = attributionOf(tags)
  const asOf = ctx.now().toISOString()
  const [service, kind] = resourceType.split(":")

  // Only where the ARN segment is genuinely empty. `||` rather than `??` for
  // exactly that reason: an ARN that carries an account uses it, and one whose
  // account segment is `""` — which is what a bucket or hosted-zone ARN is —
  // falls through to the resolved identity. See `ReadContext`.
  const accountId = parsed?.accountId || ctx.accountId || ""
  const partition = parsed?.partition || ctx.partition || ""

  return {
    arn,
    resourceType,
    name,
    state,
    region: parsed?.region ?? "",
    accountId,
    partition,
    tags,
    attribution,
    dependsOn: dependsOn.filter(Boolean),
    asOf,
    // Parsed, not asserted. Whatever this throws is thrown inside `readAws`,
    // which is what turns a malformed mapping into an ERROR surface instead of
    // a rendered row.
    contract: parseEstateResource({
      schemaVersion: CONTROL_PLANE_SCHEMA_VERSIONS.EstateResource,
      arn,
      service,
      resourceType: kind,
      name,
      accountId,
      // A CloudFront distribution's ARN carries no region because the resource
      // has none. `""` would render as "a resource with no region", which is
      // the same string an unparsed ARN produces; `global` is what it is.
      region: parsed?.region || "global",
      partition,
      tenantId: attribution.kind === "tenant" ? attribution.tenantSlug : null,
      cell: tags["tenure:cell"] ?? null,
      environment: tags["tenure:environment"] ?? null,
      stateful: STATEFUL_RESOURCE_TYPES.has(resourceType),
      tags,
      observedAt: asOf,
    }),
  }
}

async function readEcsServices(
  gw: AwsGateway,
  ctx: ReadContext,
): Promise<AwsRead<readonly EstateResource[]>> {
  return readAws<readonly EstateResource[]>(
    "ecs:DescribeServices",
    async () => {
      const clusters = ((await gw.call("ecs:ListClusters")) as ListClustersResponse)?.clusterArns ?? []
      const out: EstateResource[] = []

      for (const cluster of clusters) {
        let token: string | undefined
        do {
          const listed = (await gw.call("ecs:ListServices", {
            cluster,
            nextToken: token,
          })) as ListServicesResponse
          const arns = listed?.serviceArns ?? []
          token = listed?.nextToken || undefined
          if (arns.length === 0) continue

          // DescribeServices takes at most ten at a time. Batching is not an
          // optimisation here: eleven services in one call is a validation
          // error, which would surface as ERROR on a healthy estate.
          for (let i = 0; i < arns.length; i += 10) {
            const described = (await gw.call("ecs:DescribeServices", {
              cluster,
              services: arns.slice(i, i + 10),
            })) as DescribeServicesResponse

            for (const service of described?.services ?? []) {
              if (!service.serviceArn) continue
              const inline: Record<string, string> = {}
              for (const t of service.tags ?? []) if (t.key) inline[t.key] = t.value ?? ""
              out.push(
                resourceFrom(
                  service.serviceArn,
                  "ecs:service",
                  service.serviceName ?? service.serviceArn,
                  `${service.status ?? "UNKNOWN"} ${service.runningCount ?? 0}/${service.desiredCount ?? 0}`,
                  [
                    service.clusterArn ?? "",
                    ...(service.loadBalancers ?? []).map((lb) => lb.targetGroupArn ?? ""),
                  ],
                  ctx,
                  inline,
                ),
              )
            }
          }
        } while (token)
      }
      return out
    },
    { now: ctx.now, denial: ctx.denial },
  )
}

async function readDatabases(gw: AwsGateway, ctx: ReadContext): Promise<AwsRead<readonly EstateResource[]>> {
  return readAws<readonly EstateResource[]>(
    "rds:DescribeDBInstances",
    async () => {
      const out: EstateResource[] = []
      let marker: string | undefined
      do {
        const response = (await gw.call("rds:DescribeDBInstances", {
          Marker: marker,
        })) as DescribeDBInstancesResponse
        for (const db of response?.DBInstances ?? []) {
          if (!db.DBInstanceArn) continue
          out.push(
            resourceFrom(
              db.DBInstanceArn,
              "rds:db",
              db.DBInstanceIdentifier ?? db.DBInstanceArn,
              db.DBInstanceStatus ?? "unknown",
              [
                db.DBSubnetGroup?.DBSubnetGroupName ?? "",
                ...(db.VpcSecurityGroups ?? []).map((g) => g.VpcSecurityGroupId ?? ""),
              ],
              ctx,
            ),
          )
        }
        marker = response?.Marker || undefined
      } while (marker)
      return out
    },
    { now: ctx.now, denial: ctx.denial },
  )
}

async function readDistributions(
  gw: AwsGateway,
  ctx: ReadContext,
): Promise<AwsRead<readonly EstateResource[]>> {
  return readAws<readonly EstateResource[]>(
    "cloudfront:ListDistributions",
    async () => {
      const out: EstateResource[] = []
      let marker: string | undefined
      do {
        const response = (await gw.call("cloudfront:ListDistributions", {
          Marker: marker,
        })) as ListDistributionsResponse
        for (const dist of response?.DistributionList?.Items ?? []) {
          if (!dist.ARN) continue
          out.push(
            resourceFrom(
              dist.ARN,
              "cloudfront:distribution",
              dist.Id ?? dist.ARN,
              dist.Status ?? "unknown",
              (dist.Origins?.Items ?? []).map((o) => o.DomainName ?? ""),
              ctx,
            ),
          )
        }
        marker = response?.DistributionList?.NextMarker || undefined
      } while (marker)
      return out
    },
    { now: ctx.now, denial: ctx.denial },
  )
}

async function readCertificates(
  gw: AwsGateway,
  ctx: ReadContext,
): Promise<AwsRead<readonly EstateResource[]>> {
  return readAws<readonly EstateResource[]>(
    "acm:ListCertificates",
    async () => {
      const out: EstateResource[] = []
      let token: string | undefined
      do {
        const response = (await gw.call("acm:ListCertificates", {
          NextToken: token,
        })) as ListCertificatesResponse
        for (const cert of response?.CertificateSummaryList ?? []) {
          if (!cert.CertificateArn) continue
          out.push(
            resourceFrom(
              cert.CertificateArn,
              "acm:certificate",
              cert.DomainName ?? cert.CertificateArn,
              cert.Status ?? "unknown",
              [cert.DomainName ?? ""],
              ctx,
            ),
          )
        }
        token = response?.NextToken || undefined
      } while (token)
      return out
    },
    { now: ctx.now, denial: ctx.denial },
  )
}

/* ============================================== the cadence-aware gateway == */

/**
 * STUDIO-080-001 — reading thirty services without issuing thirty times the
 * calls.
 *
 * Every reader in this directory is a self-contained production entry point: it
 * resolves identity, reads the tag index, and then reads its own service. That
 * is right for a page that reads ONE service and wrong the moment thirty of
 * them run together — thirty `sts:GetCallerIdentity` calls and thirty
 * twenty-page walks of `tag:GetResources` before a single service is described.
 *
 * So the readers are handed a gateway that answers the same question once:
 *
 *   **within one load** identical calls collapse onto one in-flight promise, so
 *   the thirty identity reads are one call and the thirty tag walks are one
 *   walk;
 *
 *   **between loads** an answer is reused until the CAPABILITY'S OWN
 *   `refreshMs` has elapsed — `ecs:ListClusters` at fifteen seconds,
 *   `acm:ListCertificates` at an hour, `pricing:GetProducts` at a day. The
 *   cadence is read from `capabilities.ts`, never retyped here, so a capability
 *   whose window changes changes this too.
 *
 * A REJECTION is cached on the same terms, with one exception: anything
 * `throttle.ts` or `read.ts` calls transient is never cached, because the
 * remedy for a throttle is to try again and a cached throttle would make the
 * next thirty loads fail for a reason that had already passed. A denial IS
 * cached — an IAM policy does not change between two reads a second apart, and
 * re-asking is thirty pointless refusals per load.
 *
 * The cross-load cache is on only for the production path (`estateInventory()`
 * with no gateway), for the reason `resolveIdentity` gives: a caller that
 * supplied its own gateway is exercising a specific answer, and serving it one
 * another gateway produced would be a test asserting on the wrong thing.
 */

/** What one load actually cost, so a caller can state it rather than assume it. */
export interface GatewayLedger {
  /** Calls that reached the inner gateway. The number that hits AWS. */
  issued: number
  /** Calls the readers asked for. `asked - issued` is what the cadence saved. */
  asked: number
  /** Answered from the cross-load cadence cache without a new call. */
  fromCache: number
  /** Answered by joining a call already in flight in THIS load. */
  deduplicated: number
  /** Issued calls per capability, so a fan-out regression is visible per service. */
  byCapability: Readonly<Record<string, number>>
}

type Settled = { ok: true; value: unknown } | { ok: false; error: unknown }

const cadenceCache = new Map<string, { at: number; settled: Settled }>()

/**
 * Drop every cached answer.
 *
 * Exported for tests and for nothing else. Production never calls it: the
 * cadence expiry IS the invalidation, and a manual flush would let a surface
 * decide it wants fresher data than the capability declares.
 */
export function __resetInventoryCache(): void {
  cadenceCache.clear()
}

/** A stable key for one call. Object key order must not produce two cache lines. */
function callKey(capability: string, input?: Record<string, unknown>): string {
  if (!input) return `${capability}|`
  const keys = Object.keys(input).sort()
  const parts: string[] = []
  for (const key of keys) {
    const value = input[key]
    if (value === undefined) continue
    parts.push(`${key}=${JSON.stringify(value)}`)
  }
  return `${capability}|${parts.join("~")}`
}

interface CadencedGateway {
  gateway: AwsGateway
  ledger: () => GatewayLedger
}

function cadencedGateway(
  inner: AwsGateway,
  options: { now: () => Date; cache: boolean },
): CadencedGateway {
  const inflight = new Map<string, Promise<unknown>>()
  /**
   * What this load has already asked, for as long as the load lasts.
   *
   * Stronger than joining an in-flight promise, and needed: the readers are
   * launched AFTER identity and the tag index have already settled, so an
   * in-flight join alone would let thirty readers re-issue a call that finished
   * a millisecond earlier. It is also the right answer on its own terms — one
   * page is one instant, and a service asked twice inside one render can
   * answer two different things, which is a page that contradicts itself.
   */
  const thisLoad = new Map<string, Settled>()
  const byCapability: Record<string, number> = {}
  let issued = 0
  let asked = 0
  let fromCache = 0
  let deduplicated = 0

  /** Whether an answer may be reused. A throttle never is: see `remember`. */
  function reusable(settled: Settled): boolean {
    return settled.ok || !(isTransient(settled.error) || isThrottle(settled.error))
  }

  function remember(key: string, settled: Settled): void {
    inflight.delete(key)
    // A throttle is a fact about the second it happened in, not about the
    // account. Holding it would spread one busy moment across the whole
    // refresh window — and inside a load it would defeat `readAws`'s own
    // backoff, whose retry is usually the entire fix.
    if (!reusable(settled)) return
    thisLoad.set(key, settled)
    if (!options.cache) return
    cadenceCache.set(key, { at: options.now().getTime(), settled })
  }

  async function perform(
    key: string,
    capability: string,
    ttlMs: number,
    run: () => Promise<unknown>,
  ): Promise<unknown> {
    asked += 1

    const already = thisLoad.get(key)
    if (already) {
      deduplicated += 1
      if (already.ok) return already.value
      throw already.error
    }

    if (options.cache) {
      const hit = cadenceCache.get(key)
      if (hit && options.now().getTime() - hit.at < ttlMs) {
        fromCache += 1
        if (hit.settled.ok) return hit.settled.value
        throw hit.settled.error
      }
    }

    const pending = inflight.get(key)
    if (pending) {
      deduplicated += 1
      return pending
    }

    issued += 1
    byCapability[capability] = (byCapability[capability] ?? 0) + 1
    const promise = run().then(
      (value) => {
        remember(key, { ok: true, value })
        return value
      },
      (error: unknown) => {
        remember(key, { ok: false, error })
        throw error
      },
    )
    inflight.set(key, promise)
    return promise
  }

  return {
    ledger: () => ({ issued, asked, fromCache, deduplicated, byCapability: { ...byCapability } }),
    gateway: {
      call(capability, input) {
        return perform(
          callKey(capability, input),
          capability,
          CAPABILITIES[capability].refreshMs,
          () => inner.call(capability, input),
        )
      },
      resolvedRegion() {
        // Not a capability of its own — it is the second half of resolving
        // identity, which is why it holds for exactly as long as identity does.
        // Thirty readers each awaiting the SDK's region resolution is thirty
        // credential-chain resolutions for one answer that does not change.
        return perform(
          "|resolvedRegion",
          "|resolvedRegion",
          CAPABILITIES["sts:GetCallerIdentity"].refreshMs,
          () => inner.resolvedRegion(),
        ) as Promise<string>
      },
    },
  }
}

/* ================================================== a service's own section = */

/** What a section could not turn into a named resource, and why. Never silent. */
export interface OmittedResource {
  /** The service the item came from, so the omission is attributable. */
  service: string
  /** The best label the reader had for it — a name, an id, a domain. */
  label: string
  why: string
}

/**
 * Whether this engine can see a service, worded so a caller cannot collapse the
 * four answers into one.
 *
 * `ABSENT` is the only arm that is a claim about the ACCOUNT. `UNKNOWN` and
 * `NOT_COMPOSED` are claims about this engine, and `NO_READER` is a claim about
 * this build. A surface that rendered `UNKNOWN` the way it renders `ABSENT`
 * would be telling an operator there is no ECR on an account that has four
 * repositories, which is the defect the whole read plane exists against.
 */
export type SectionCoverage =
  | { kind: "VISIBLE"; resources: number; asOf: string }
  | { kind: "ABSENT"; asOf: string }
  | {
      kind: "UNKNOWN"
      /** The failing `AwsRead` state, so a caller can branch without re-parsing prose. */
      state: "DENIED" | "THROTTLED" | "ERROR" | "UNCONFIGURED"
      /** `describeRead`'s sentence — the same one every other surface prints. */
      why: string
    }
  | { kind: "NOT_COMPOSED"; why: string }
  | { kind: "NO_READER"; why: string }

/**
 * What a section puts into the estate.
 *
 * Three kinds rather than one nullable read. A `signal` section reads a service
 * that has no enumerable resources of its own — an alarm is not a resource, a
 * price is not a resource — and folding it into a resource count would inflate
 * the estate with things nobody provisioned. A `not-composed` section names a
 * reader that exists and that this composition deliberately does not drive, and
 * says why; `holdsResources` is what decides whether its absence makes the
 * total a floor rather than a total.
 */
export type SectionContribution =
  | {
      kind: "resources"
      read: AwsRead<readonly EstateResource[]>
      omitted: readonly OmittedResource[]
    }
  | { kind: "signal"; read: AwsRead<unknown>; why: string }
  | { kind: "not-composed"; why: string; holdsResources: boolean }

export interface EstateSection {
  /** The capability whose reading governs this section. Its own id. */
  capability: Capability
  /** The IAM service prefix: `ecs`, `wafv2`, `access-analyzer`. */
  service: string
  /** What an operator calls it. */
  label: string
  /** From `CAPABILITIES[capability].refreshMs`. Read, never retyped. */
  refreshMs: number
  /**
   * Every capability this section's reader issues, including the per-item reads
   * nested inside it.
   *
   * Declared rather than observed because a capability that was never REACHED —
   * `ecr:DescribeImages` after `ecr:DescribeRepositories` was refused — is still
   * covered by this build. `estateCoverage` subtracts this union from the whole
   * registry, so a capability nobody claims shows up as NO_READER rather than
   * quietly not existing.
   */
  covers: readonly Capability[]
  contribution: SectionContribution
  coverage: SectionCoverage
  /** The sentence a surface prints. One funnel, as `describeRead` is one funnel. */
  text: string
}

/** What a service reports when the API publishes no state for the resource. */
export const NO_STATE_REPORTED = "no state reported"

/** The five fields a reading has to give up to become an estate resource. */
interface Mapped {
  /** Null when the reader could not name one. The item is then omitted, not dropped. */
  arn: string | null
  resourceType: string
  name: string
  state: string
  /** Identifiers this resource names in its own describe response. Never inferred. */
  dependsOn?: readonly string[]
  tags?: Readonly<Record<string, string>>
}

/** A reader that threw rather than returning a reading. Its own failure, alone. */
type Loaded<T> = { ok: true; value: T } | { ok: false; error: unknown }

async function load<T>(run: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    return { ok: false, error }
  }
}

/** The ERROR arm a reader that threw outright degrades to. */
function threw(capability: Capability, error: unknown): AwsRead<never> {
  return { state: "ERROR", capability, code: errorName(error), safeDetail: safeDetail(error) }
}

/**
 * The reading a section is built on, or the reader's own failure.
 *
 * The whole of property 2 is here: a reader that threw, was refused or was
 * throttled produces a failing `AwsRead` for ITS section and touches no other.
 */
function from<T, R>(
  loaded: Loaded<T>,
  capability: Capability,
  select: (value: T) => AwsRead<R>,
): AwsRead<R> {
  if (!loaded.ok) return threw(capability, loaded.error)
  return select(loaded.value)
}

/** Narrow a reading onto the list inside it, keeping the state it arrived in. */
function items<C, I>(read: AwsRead<C>, pick: (value: C) => readonly I[]): AwsRead<readonly I[]> {
  if (read.state === "ACTUAL") return { ...read, value: pick(read.value) }
  if (read.state === "STALE") return { ...read, value: pick(read.value) }
  // The arms left carry no `value` at all, so this is already the narrowed
  // type. No cast — a cast here is where an empty array could be smuggled in.
  return read
}

/** The first reading that answered, for a surface whose reader returns several. */
function firstAnswering<T>(reads: readonly AwsRead<T>[], fallback: AwsRead<T>): AwsRead<T> {
  return (
    reads.find((read) => read.state === "ACTUAL" || read.state === "STALE") ?? reads[0] ?? fallback
  )
}

function serviceOfCapability(capability: Capability): string {
  return capability.slice(0, capability.indexOf(":"))
}

function coverageOf(
  read: AwsRead<readonly EstateResource[]>,
  what: string,
): SectionCoverage {
  switch (read.state) {
    case "ACTUAL":
    case "STALE":
      return { kind: "VISIBLE", resources: read.value.length, asOf: read.asOf }
    case "EMPTY":
      return { kind: "ABSENT", asOf: read.asOf }
    default:
      return { kind: "UNKNOWN", state: read.state, why: describeRead(read, what) }
  }
}

function resourceSection<I>(spec: {
  capability: Capability
  covers: readonly Capability[]
  label: string
  read: AwsRead<readonly I[]>
  map: (item: I) => Mapped
  ctx: ReadContext
  /** Omissions the caller already knows about — a second scope that was refused. */
  alsoOmitted?: readonly OmittedResource[]
}): EstateSection {
  const service = serviceOfCapability(spec.capability)
  const omitted: OmittedResource[] = [...(spec.alsoOmitted ?? [])]
  let read: AwsRead<readonly EstateResource[]>

  if (spec.read.state === "ACTUAL" || spec.read.state === "STALE") {
    try {
      const resources: EstateResource[] = []
      for (const item of spec.read.value) {
        const mapped = spec.map(item)
        if (!mapped.arn) {
          omitted.push({
            service,
            label: mapped.name,
            why:
              `${spec.capability} returned this ${mapped.resourceType} without an ARN this engine ` +
              `could name it by, so it is not in the resource count. It is still there.`,
          })
          continue
        }
        resources.push(
          resourceFrom(
            mapped.arn,
            mapped.resourceType,
            mapped.name,
            mapped.state,
            mapped.dependsOn ?? [],
            spec.ctx,
            mapped.tags ?? {},
          ),
        )
      }
      read = { ...spec.read, value: resources }
    } catch (error) {
      // `parseEstateResource` refused something. That is the runtime gate doing
      // its job, and it takes down THIS section — not the load. A malformed
      // resource must not render; a hundred well-formed ones beside it must.
      read = threw(spec.capability, error)
    }
  } else {
    read = spec.read
  }

  return {
    capability: spec.capability,
    service,
    label: spec.label,
    refreshMs: CAPABILITIES[spec.capability].refreshMs,
    covers: spec.covers,
    contribution: { kind: "resources", read, omitted },
    coverage: coverageOf(read, `${spec.label} read from AWS`),
    text: describeRead(read, `${spec.label} read from AWS`),
  }
}

function signalSection(spec: {
  capability: Capability
  covers: readonly Capability[]
  label: string
  read: AwsRead<unknown>
  /** What this section tells the estate, given it contributes no resources. */
  why: string
}): EstateSection {
  const coverage: SectionCoverage =
    spec.read.state === "ACTUAL" || spec.read.state === "STALE"
      ? { kind: "VISIBLE", resources: 0, asOf: spec.read.asOf }
      : spec.read.state === "EMPTY"
        ? { kind: "ABSENT", asOf: spec.read.asOf }
        : {
            kind: "UNKNOWN",
            state: spec.read.state,
            why: describeRead(spec.read, `${spec.label} read from AWS`),
          }

  return {
    capability: spec.capability,
    service: serviceOfCapability(spec.capability),
    label: spec.label,
    refreshMs: CAPABILITIES[spec.capability].refreshMs,
    covers: spec.covers,
    contribution: { kind: "signal", read: spec.read, why: spec.why },
    coverage,
    text: describeRead(spec.read, `${spec.label} read from AWS`),
  }
}

function notComposedSection(spec: {
  capability: Capability
  covers: readonly Capability[]
  label: string
  why: string
  holdsResources: boolean
}): EstateSection {
  return {
    capability: spec.capability,
    service: serviceOfCapability(spec.capability),
    label: spec.label,
    refreshMs: CAPABILITIES[spec.capability].refreshMs,
    covers: spec.covers,
    contribution: { kind: "not-composed", why: spec.why, holdsResources: spec.holdsResources },
    coverage: { kind: "NOT_COMPOSED", why: spec.why },
    text: `not read here — ${spec.why}`,
  }
}

/* --------------------------------------------- the per-service mappings -- */

/** The state of a nested reading, when the row's own state lives behind one. */
function nestedState<T>(read: AwsRead<T>, pick: (value: T) => string | null): string {
  if (read.state === "ACTUAL" || read.state === "STALE") return pick(read.value) ?? NO_STATE_REPORTED
  return `state not read (${read.state})`
}

const MAP = {
  cognitoPool: (pool: PoolReading): Mapped => ({
    arn: pool.arn,
    resourceType: "cognito-idp:userpool",
    name: pool.listedName ?? pool.poolId,
    state: nestedState(pool.operators, (roster) => `${roster.operators.length} operators`),
  }),
  vpc: (vpc: VpcReading): Mapped => ({
    arn: vpc.arn,
    resourceType: "ec2:vpc",
    name: vpc.name ?? vpc.vpcId,
    state: vpc.state ?? NO_STATE_REPORTED,
    tags: vpc.tags,
  }),
  subnet: (subnet: SubnetReading): Mapped => ({
    arn: subnet.arn,
    resourceType: "ec2:subnet",
    name: subnet.name ?? subnet.subnetId,
    state: subnet.state ?? NO_STATE_REPORTED,
    dependsOn: [subnet.vpcId ?? ""],
    tags: subnet.tags,
  }),
  securityGroup: (group: SecurityGroupReading): Mapped => ({
    arn: group.arn,
    resourceType: "ec2:security-group",
    name: group.groupName ?? group.groupId,
    state: `${group.ingress.length} ingress / ${group.egress.length} egress`,
    dependsOn: [group.vpcId ?? ""],
    tags: group.tags,
  }),
  routeTable: (table: RouteTableReading): Mapped => ({
    arn: table.arn,
    resourceType: "ec2:route-table",
    name: table.name ?? table.routeTableId,
    state: table.isMain ? "main" : `${table.associatedSubnetIds.length} subnets associated`,
    dependsOn: [table.vpcId ?? "", ...table.associatedSubnetIds],
    tags: table.tags,
  }),
  internetGateway: (gateway: InternetGatewayReading): Mapped => ({
    arn: gateway.arn,
    resourceType: "ec2:internet-gateway",
    name: gateway.name ?? gateway.internetGatewayId,
    state:
      gateway.attachedVpcIds.length === 0
        ? "detached"
        : gateway.attachedVpcIds.map((vpc) => gateway.attachmentStates[vpc] ?? "attached").join(", "),
    dependsOn: gateway.attachedVpcIds,
    tags: gateway.tags,
  }),
  natGateway: (gateway: NatGatewayReading): Mapped => ({
    arn: gateway.arn,
    resourceType: "ec2:natgateway",
    name: gateway.name ?? gateway.natGatewayId,
    state: gateway.state ?? NO_STATE_REPORTED,
    dependsOn: [gateway.vpcId ?? "", gateway.subnetId ?? ""],
    tags: gateway.tags,
  }),
  vpcEndpoint: (endpoint: VpcEndpointReading): Mapped => ({
    arn: endpoint.arn,
    resourceType: "ec2:vpc-endpoint",
    name: endpoint.name ?? endpoint.vpcEndpointId,
    state: endpoint.state ?? NO_STATE_REPORTED,
    dependsOn: [endpoint.vpcId ?? "", ...endpoint.subnetIds, ...endpoint.securityGroupIds],
    tags: endpoint.tags,
  }),
  networkAcl: (acl: NetworkAclReading): Mapped => ({
    arn: acl.arn,
    resourceType: "ec2:network-acl",
    name: acl.name ?? acl.networkAclId,
    state: acl.isDefault ? "default (allow all)" : `${acl.entries.length} entries`,
    dependsOn: [acl.vpcId ?? "", ...acl.associatedSubnetIds],
    tags: acl.tags,
  }),
  loadBalancer: (lb: LoadBalancerReading): Mapped => ({
    arn: lb.arn,
    resourceType: "elasticloadbalancing:loadbalancer",
    name: lb.name ?? lb.arn,
    state: lb.stateCode ?? NO_STATE_REPORTED,
    dependsOn: [lb.vpcId ?? "", ...lb.subnetIds, ...lb.securityGroupIds],
  }),
  repository: (repo: RepositoryReading): Mapped => ({
    arn: repo.arn,
    resourceType: "ecr:repository",
    name: repo.name,
    state: nestedState(repo.images, (images) => `${images.length} images`),
  }),
  cacheCluster: (cluster: CacheClusterReading): Mapped => ({
    arn: cluster.arn,
    resourceType: "elasticache:cluster",
    name: cluster.clusterId,
    state: cluster.status ?? NO_STATE_REPORTED,
    dependsOn: [cluster.replicationGroupId ?? ""],
  }),
  replicationGroup: (group: ReplicationGroupReading): Mapped => ({
    arn: group.arn,
    resourceType: "elasticache:replication-group",
    name: group.replicationGroupId,
    state: group.status ?? NO_STATE_REPORTED,
    dependsOn: group.memberClusterIds,
  }),
  table: (table: TableReading): Mapped => ({
    arn: table.arn,
    resourceType: "dynamodb:table",
    name: table.name,
    state: nestedState(table.detail, (detail) => detail.status),
  }),
  logGroup: (group: LogGroupReading): Mapped => ({
    arn: group.arn,
    resourceType: "logs:log-group",
    name: group.logGroupName,
    state: group.logGroupClass ?? NO_STATE_REPORTED,
  }),
  bucket: (bucket: BucketReading): Mapped => ({
    arn: bucket.arn,
    resourceType: "s3:bucket",
    name: bucket.name,
    state: nestedState(bucket.versioning, (fact) => fact.status),
  }),
  secret: (secret: SecretReading): Mapped => ({
    arn: secret.arn,
    resourceType: "secretsmanager:secret",
    name: secret.name,
    state: secret.deletion.kind,
  }),
  key: (key: KeyReading): Mapped => ({
    arn: key.arn,
    resourceType: "kms:key",
    name: key.keyId,
    state: key.lifecycle.kind,
  }),
  trail: (trail: TrailReading): Mapped => ({
    arn: trail.configuration.arn,
    resourceType: "cloudtrail:trail",
    name: trail.configuration.name,
    state: nestedState(trail.status, (status) => (status.isLogging ? "logging" : "not logging")),
    dependsOn: [
      trail.configuration.cloudWatchLogsLogGroupArn ?? "",
      trail.configuration.snsTopicArn ?? "",
    ],
  }),
  configRule: (rule: ConfigRuleReading): Mapped => ({
    arn: rule.arn,
    resourceType: "config:config-rule",
    name: rule.name,
    state: rule.ruleState ?? NO_STATE_REPORTED,
  }),
  zone: (zone: ZoneReading): Mapped => ({
    arn: zone.arn,
    resourceType: "route53:hostedzone",
    name: zone.name,
    state: zone.privateZone ? "private" : "public",
  }),
  snapshot: (snapshot: SnapshotReading): Mapped => ({
    arn: snapshot.arn,
    resourceType: "rds:snapshot",
    name: snapshot.snapshotId,
    state: snapshot.status ?? NO_STATE_REPORTED,
    dependsOn: [snapshot.instanceId ?? ""],
  }),
  ecsCluster: (cluster: ClusterReading): Mapped => ({
    arn: cluster.arn,
    resourceType: "ecs:cluster",
    name: cluster.name,
    state: nestedState(cluster.detail, (detail) => detail.status),
  }),
  analyzer: (analyzer: AnalyzerReading): Mapped => ({
    arn: analyzer.arn,
    resourceType: "access-analyzer:analyzer",
    name: analyzer.name,
    state: analyzer.status,
  }),
  detector: (detector: DetectorReading): Mapped => ({
    arn: detector.arn,
    resourceType: "guardduty:detector",
    name: detector.detectorId,
    state: NO_STATE_REPORTED,
  }),
  webAcl: (acl: WebAclSummary): Mapped => ({
    arn: acl.arn,
    resourceType: "wafv2:webacl",
    name: acl.name,
    state: acl.scope,
  }),
  dashboard: (dashboard: DashboardRow): Mapped => ({
    arn: dashboard.arn,
    resourceType: "cloudwatch:dashboard",
    name: dashboard.name,
    state: NO_STATE_REPORTED,
  }),
  sesIdentity: (identity: SesIdentity): Mapped => ({
    arn: identity.arn,
    resourceType: "ses:identity",
    name: identity.name,
    state: identity.verification.state,
  }),
  queue: (queue: QueueReading): Mapped => ({
    arn: queue.arn,
    resourceType: "sqs:queue",
    name: queue.name,
    state: nestedState(queue.depth, (depth) => `${depth.visible ?? "?"} visible`),
  }),
  lambdaFunction: (fn: LambdaFunctionReading): Mapped => ({
    arn: fn.arn,
    resourceType: "lambda:function",
    name: fn.name,
    state: fn.runtime ?? fn.packageType,
    tags: fn.tags,
  }),
  budget: (budget: BudgetReading): Mapped => ({
    arn: budget.arn,
    resourceType: "budgets:budget",
    name: budget.name,
    state: budget.posture,
  }),
  rule: (rule: RuleRow): Mapped => ({
    arn: rule.arn,
    resourceType: "events:rule",
    name: rule.name,
    state: rule.state ?? NO_STATE_REPORTED,
  }),
} as const

/**
 * `curExistence` in the vocabulary every other section speaks.
 *
 * `posture.ts` answers this one question with its own three-armed union rather
 * than an `AwsRead`, and the translation is exact rather than lossy: DEFINED is
 * a reading, NONE_DEFINED is a real absence — AWS answered, and there are no
 * report definitions — and UNKNOWN already carries the action, the error code
 * and the pasteable statement a DENIED arm needs. Nothing is invented and
 * nothing is flattened; in particular NONE_DEFINED does not become DENIED and
 * UNKNOWN does not become EMPTY.
 */
function curRead(
  existence: CurExistence,
  denial: DenialContext,
  asOf: string,
): AwsRead<CurExistence> {
  const capability: Capability = "cur:DescribeReportDefinitions"
  switch (existence.state) {
    case "DEFINED":
      return { state: "ACTUAL", capability, value: existence, asOf, fresh: true }
    case "NONE_DEFINED":
      return { state: "EMPTY", capability, asOf }
    case "UNKNOWN":
      return {
        state: "DENIED",
        capability,
        action: existence.action,
        principal: denial.principal,
        accountId: denial.accountId,
        region: denial.region,
        partition: denial.partition,
        errorCode: existence.errorCode,
        minimumStatement: existence.minimumStatement,
      }
  }
}

/** Both WAF scopes as one list, with the scope that could not be read named. */
function wafAcls(readings: WafReadings): {
  read: AwsRead<readonly WebAclSummary[]>
  omitted: readonly OmittedResource[]
} {
  const regional = items(readings.regional, (listing) => listing.acls)
  const global = readings.cloudfront
  const omitted: OmittedResource[] = []

  if (global.state !== "ACTUAL" && global.state !== "STALE" && global.state !== "EMPTY") {
    omitted.push({
      service: "wafv2",
      label: "CLOUDFRONT-scope web ACLs",
      why: describeRead(global, "the partition-global WAF scope"),
    })
  }
  if (regional.state !== "ACTUAL" && regional.state !== "STALE") return { read: regional, omitted }

  const extra = global.state === "ACTUAL" || global.state === "STALE" ? global.value.acls : []
  return { read: { ...regional, value: [...regional.value, ...extra] }, omitted }
}

/* -------------------------------------------------------- the whole page -- */

export interface EstateReadings {
  identity: AwsRead<Identity>
  tagged: AwsRead<readonly TaggedResource[]>
  ecsServices: AwsRead<readonly EstateResource[]>
  databases: AwsRead<readonly EstateResource[]>
  distributions: AwsRead<readonly EstateResource[]>
  certificates: AwsRead<readonly EstateResource[]>
  /**
   * Every service, each degrading on its own.
   *
   * The four readings above are the same four sections, kept as named fields
   * because three pages already read them by name. They are not a second
   * source: `estateInventory` builds each field FROM its section, so a page
   * reading `readings.databases` and a page reading the RDS section cannot
   * disagree.
   */
  sections: readonly EstateSection[]
  /** Which services this engine can see, which it was refused, which nothing reads. */
  coverage: CoverageReport
  /** The resource total, and what it excludes. Never a bare number. */
  count: EstateCount
  /** What this load cost in AWS calls. Evidence for the cadence, not a guess. */
  calls: GatewayLedger
}

/**
 * The estate page's whole data load, in one call.
 *
 * `apps/system-studio/src/app/platform/estate/page.tsx` calls this with no
 * arguments. Tests call it with a stand-in gateway. That is deliberately the
 * SAME function: a test that drove a helper the page does not call would stay
 * green the day the page stopped calling it.
 *
 * ── Every service, and one of them failing changes nothing else ────────────
 *
 * Each reader runs concurrently behind the cadenced gateway, and each is
 * `load`ed rather than awaited directly: a reader that THROWS produces an ERROR
 * arm for its own sections and leaves every other section exactly as it was.
 * `Promise.all` over the raw readers would have made one broken adapter take
 * down the estate, which is the same failure as a denial rendering as an empty
 * list, one level up.
 */
export async function estateInventory(
  supplied?: AwsGateway,
  options: {
    now?: () => Date
    /**
     * Reuse answers across loads while each capability's own window holds.
     *
     * Defaults to on for the production path and off when a gateway is supplied,
     * for the reason `resolveIdentity` gives: a caller that supplied a gateway
     * is exercising a specific answer, and serving it one that another gateway
     * produced would be a test asserting on the wrong thing.
     */
    cache?: boolean
  } = {},
): Promise<EstateReadings> {
  const now = options.now ?? (() => new Date())
  const cadenced = cadencedGateway(supplied ?? liveGateway(), {
    now,
    cache: options.cache ?? supplied === undefined,
  })
  const gw = cadenced.gateway

  // Every reader below is handed `gw` rather than `supplied`, so their own
  // identity and tag reads join this load's single call instead of issuing
  // thirty of each.
  const identity = await resolveIdentity(gw, { now })
  const denial = denialContextFrom(identity)
  const resolved = identity.state === "ACTUAL" || identity.state === "STALE" ? identity.value : null

  const tagged = await taggedResources(gw, { now, denial })
  const ctx: ReadContext = {
    now,
    denial,
    tags: tagIndex(tagged.state === "ACTUAL" || tagged.state === "STALE" ? tagged.value : []),
    accountId: resolved?.accountId ?? null,
    region: resolved?.region ?? null,
    partition: resolved?.partition ?? null,
  }

  const [
    ecsServices,
    databases,
    distributions,
    certificates,
    cognito,
    network,
    loadBalancers,
    ecr,
    elasticache,
    dynamodb,
    logs,
    s3,
    secrets,
    kms,
    trail,
    compliance,
    dns,
    cdn,
    rds,
    containers,
    acm,
    quotas,
    analyzer,
    guardduty,
    pricing,
    waf,
    dashboards,
    ses,
    sqs,
    lambda,
    iam,
    budgets,
    awsHealth,
    eventbridge,
    alarms,
    findings,
    organization,
    posture,
  ] = await Promise.all([
    readEcsServices(gw, ctx),
    readDatabases(gw, ctx),
    readDistributions(gw, ctx),
    readCertificates(gw, ctx),
    load(() => cognitoReadings(gw, { now })),
    load(() => networkReadings(gw, { now })),
    load(() => loadBalancerReadings(gw, { now })),
    load(() => ecrReadings(gw, { now })),
    load(() => elastiCacheReadings(gw, { now })),
    load(() => tableReadings(gw, { now })),
    load(() => logGroupReadings(gw, { now })),
    load(() => bucketPosture(gw, { now })),
    load(() => secretReadings(gw, { now })),
    load(() => keyReadings(gw, { now })),
    load(() => trailReadings(gw, { now })),
    load(() => complianceReadings(gw, { now })),
    load(() => dnsReadings(gw, { now })),
    load(() => cdnReadings(gw, { now })),
    load(() => databaseReadings(gw, { now })),
    load(() => containerReadings(gw, { now })),
    load(() => certificateReadings(gw, { now })),
    load(() => quotaReadings(gw, { now })),
    load(() => analyzerReadings(gw, { now })),
    load(() => guardDutyReadings(gw, { now })),
    load(() => pricingReadings(gw, { now })),
    load(() => wafReadings(gw, { now })),
    load(() => dashboardReadings(gw, { now })),
    load(() => sesReadings(gw, { now })),
    load(() => queueReadings(gw, { now })),
    load(() => lambdaInventory(gw, { now })),
    load(() => iamPosture(gw, { now })),
    load(() => budgetReadings(gw, { now, identity, tagged })),
    load(() => awsHealthSurface(gw, { now, identity })),
    load(() => eventBridgeSurface(gw, { now })),
    load(() => alarmSurface(gw, { now })),
    load(() => securityFindings(gw, { now })),
    load(() => organizationSurface(gw, { now })),
    load(() => curExistence(gw, { now, denial })),
  ])

  const wafListing = waf.ok
    ? wafAcls(waf.value)
    : { read: threw("wafv2:ListWebACLs", waf.error), omitted: [] as readonly OmittedResource[] }

  const sections: readonly EstateSection[] = [
    /* --- the four surfaces three pages already read by name ---------------- */
    resourceSection({
      capability: "ecs:DescribeServices",
      covers: ["ecs:ListClusters", "ecs:ListServices", "ecs:DescribeServices"],
      label: "ECS services",
      read: ecsServices,
      map: (resource) => resource,
      ctx,
    }),
    resourceSection({
      capability: "rds:DescribeDBInstances",
      covers: ["rds:DescribeDBInstances"],
      label: "Databases",
      read: databases,
      map: (resource) => resource,
      ctx,
    }),
    resourceSection({
      capability: "cloudfront:ListDistributions",
      covers: ["cloudfront:ListDistributions"],
      label: "Edge distributions",
      read: distributions,
      map: (resource) => resource,
      ctx,
    }),
    resourceSection({
      capability: "acm:ListCertificates",
      covers: ["acm:ListCertificates"],
      label: "Certificates",
      read: certificates,
      map: (resource) => resource,
      ctx,
    }),

    /* --- everything the service programme made readable -------------------- */
    resourceSection({
      capability: "cognito-idp:ListUserPools",
      covers: [
        "cognito-idp:ListUserPools",
        "cognito-idp:DescribeUserPool",
        "cognito-idp:ListUserPoolClients",
        "cognito-idp:DescribeUserPoolClient",
        "cognito-idp:DescribeUserPoolDomain",
        "cognito-idp:GetUserPoolMfaConfig",
        "cognito-idp:ListUsers",
      ],
      label: "User pools",
      read: from(cognito, "cognito-idp:ListUserPools", (r) => items(r.pools, (i) => i.pools)),
      map: MAP.cognitoPool,
      ctx,
    }),
    resourceSection({
      capability: "ec2:DescribeVpcs",
      covers: ["ec2:DescribeVpcs"],
      label: "VPCs",
      read: from(network, "ec2:DescribeVpcs", (r) => items(r.vpcs, (p) => p.items)),
      map: MAP.vpc,
      ctx,
    }),
    resourceSection({
      capability: "ec2:DescribeSubnets",
      covers: ["ec2:DescribeSubnets"],
      label: "Subnets",
      read: from(network, "ec2:DescribeSubnets", (r) => items(r.subnets, (p) => p.items)),
      map: MAP.subnet,
      ctx,
    }),
    resourceSection({
      capability: "ec2:DescribeSecurityGroups",
      covers: ["ec2:DescribeSecurityGroups"],
      label: "Security groups",
      read: from(network, "ec2:DescribeSecurityGroups", (r) => items(r.securityGroups, (p) => p.items)),
      map: MAP.securityGroup,
      ctx,
    }),
    resourceSection({
      capability: "ec2:DescribeRouteTables",
      covers: ["ec2:DescribeRouteTables"],
      label: "Route tables",
      read: from(network, "ec2:DescribeRouteTables", (r) => items(r.routeTables, (p) => p.items)),
      map: MAP.routeTable,
      ctx,
    }),
    resourceSection({
      capability: "ec2:DescribeInternetGateways",
      covers: ["ec2:DescribeInternetGateways"],
      label: "Internet gateways",
      read: from(network, "ec2:DescribeInternetGateways", (r) =>
        items(r.internetGateways, (p) => p.items),
      ),
      map: MAP.internetGateway,
      ctx,
    }),
    resourceSection({
      capability: "ec2:DescribeNatGateways",
      covers: ["ec2:DescribeNatGateways"],
      label: "NAT gateways",
      read: from(network, "ec2:DescribeNatGateways", (r) => items(r.natGateways, (p) => p.items)),
      map: MAP.natGateway,
      ctx,
    }),
    resourceSection({
      capability: "ec2:DescribeVpcEndpoints",
      covers: ["ec2:DescribeVpcEndpoints"],
      label: "VPC endpoints",
      read: from(network, "ec2:DescribeVpcEndpoints", (r) => items(r.vpcEndpoints, (p) => p.items)),
      map: MAP.vpcEndpoint,
      ctx,
    }),
    resourceSection({
      capability: "ec2:DescribeNetworkAcls",
      covers: ["ec2:DescribeNetworkAcls"],
      label: "Network ACLs",
      read: from(network, "ec2:DescribeNetworkAcls", (r) => items(r.networkAcls, (p) => p.items)),
      map: MAP.networkAcl,
      ctx,
    }),
    resourceSection({
      capability: "elasticloadbalancing:DescribeLoadBalancers",
      covers: [
        "elasticloadbalancing:DescribeLoadBalancers",
        "elasticloadbalancing:DescribeListeners",
        "elasticloadbalancing:DescribeTargetGroups",
        "elasticloadbalancing:DescribeTargetHealth",
        "elasticloadbalancing:DescribeRules",
      ],
      label: "Load balancers",
      read: from(loadBalancers, "elasticloadbalancing:DescribeLoadBalancers", (r) => r.loadBalancers),
      map: MAP.loadBalancer,
      ctx,
    }),
    resourceSection({
      capability: "ecr:DescribeRepositories",
      covers: [
        "ecr:DescribeRepositories",
        "ecr:DescribeImages",
        "ecr:DescribeImageScanFindings",
        "ecr:GetLifecyclePolicy",
      ],
      label: "Image repositories",
      read: from(ecr, "ecr:DescribeRepositories", (r) => r.repositories),
      map: MAP.repository,
      ctx,
    }),
    resourceSection({
      capability: "elasticache:DescribeCacheClusters",
      covers: ["elasticache:DescribeCacheClusters", "elasticache:DescribeCacheParameters"],
      label: "Cache clusters",
      read: from(elasticache, "elasticache:DescribeCacheClusters", (r) => r.clusters),
      map: MAP.cacheCluster,
      ctx,
    }),
    resourceSection({
      capability: "elasticache:DescribeReplicationGroups",
      covers: ["elasticache:DescribeReplicationGroups"],
      label: "Cache replication groups",
      read: from(elasticache, "elasticache:DescribeReplicationGroups", (r) => r.replicationGroups),
      map: MAP.replicationGroup,
      ctx,
    }),
    resourceSection({
      capability: "dynamodb:ListTables",
      covers: [
        "dynamodb:ListTables",
        "dynamodb:DescribeTable",
        "dynamodb:DescribeContinuousBackups",
        "dynamodb:DescribeTimeToLive",
      ],
      label: "DynamoDB tables",
      read: from(dynamodb, "dynamodb:ListTables", (r) => r.tables),
      map: MAP.table,
      ctx,
    }),
    resourceSection({
      capability: "logs:DescribeLogGroups",
      covers: ["logs:DescribeLogGroups", "logs:DescribeMetricFilters", "logs:FilterLogEvents"],
      label: "Log groups",
      read: from(logs, "logs:DescribeLogGroups", (r) => r.groups),
      map: MAP.logGroup,
      ctx,
    }),
    resourceSection({
      capability: "s3:ListBuckets",
      covers: [
        "s3:ListBuckets",
        "s3:GetBucketPublicAccessBlock",
        "s3:GetBucketEncryption",
        "s3:GetBucketVersioning",
        "s3:GetBucketLifecycleConfiguration",
        "s3:GetBucketPolicyStatus",
        "s3:GetBucketTagging",
        "s3:GetBucketCors",
      ],
      label: "Buckets",
      read: from(s3, "s3:ListBuckets", (r) => r.buckets),
      map: MAP.bucket,
      ctx,
    }),
    resourceSection({
      capability: "secretsmanager:ListSecrets",
      covers: ["secretsmanager:ListSecrets", "secretsmanager:DescribeSecret"],
      label: "Secrets",
      read: from(secrets, "secretsmanager:ListSecrets", (r) => r.secrets),
      map: MAP.secret,
      ctx,
    }),
    resourceSection({
      capability: "kms:ListKeys",
      covers: ["kms:ListKeys", "kms:DescribeKey", "kms:GetKeyRotationStatus"],
      label: "Encryption keys",
      read: from(kms, "kms:ListKeys", (r) => r.keys),
      map: MAP.key,
      ctx,
    }),
    resourceSection({
      capability: "cloudtrail:DescribeTrails",
      covers: ["cloudtrail:DescribeTrails", "cloudtrail:GetTrailStatus", "cloudtrail:LookupEvents"],
      label: "Audit trails",
      read: from(trail, "cloudtrail:DescribeTrails", (r) => r.trails),
      map: MAP.trail,
      ctx,
    }),
    resourceSection({
      capability: "config:DescribeConfigRules",
      covers: [
        "config:DescribeConfigRules",
        "config:DescribeComplianceByConfigRule",
        "config:DescribeConfigurationAggregators",
      ],
      label: "Config rules",
      read: from(compliance, "config:DescribeConfigRules", (r) => r.rules),
      map: MAP.configRule,
      ctx,
    }),
    resourceSection({
      capability: "route53:ListHostedZones",
      covers: ["route53:ListHostedZones", "route53:ListResourceRecordSets"],
      label: "Hosted zones",
      read: from(dns, "route53:ListHostedZones", (r) => r.zones),
      map: MAP.zone,
      ctx,
    }),
    resourceSection({
      capability: "rds:DescribeDBSnapshots",
      covers: ["rds:DescribeDBSnapshots"],
      label: "Database snapshots",
      read: from(rds, "rds:DescribeDBSnapshots", (r) => r.snapshots),
      map: MAP.snapshot,
      ctx,
    }),
    resourceSection({
      capability: "ecs:DescribeClusters",
      covers: [
        "ecs:DescribeClusters",
        "ecs:ListTasks",
        "ecs:DescribeTasks",
        "ecs:DescribeTaskDefinition",
      ],
      label: "ECS clusters",
      read: from(containers, "ecs:DescribeClusters", (r) => r.clusters),
      map: MAP.ecsCluster,
      ctx,
    }),
    resourceSection({
      capability: "access-analyzer:ListAnalyzers",
      covers: ["access-analyzer:ListAnalyzers", "access-analyzer:ListFindingsV2"],
      label: "Access analyzers",
      read: from(analyzer, "access-analyzer:ListAnalyzers", (r) =>
        items(r.analyzers, (listing) => listing.analyzers),
      ),
      map: MAP.analyzer,
      ctx,
    }),
    resourceSection({
      capability: "guardduty:ListDetectors",
      covers: ["guardduty:ListDetectors", "guardduty:ListFindings", "guardduty:GetFindings"],
      label: "Threat detectors",
      read: from(guardduty, "guardduty:ListDetectors", (r) => r.detectors),
      map: MAP.detector,
      ctx,
    }),
    resourceSection({
      capability: "wafv2:ListWebACLs",
      covers: ["wafv2:ListWebACLs", "wafv2:GetWebACLForResource"],
      label: "Web ACLs",
      read: wafListing.read,
      map: MAP.webAcl,
      ctx,
      alsoOmitted: wafListing.omitted,
    }),
    resourceSection({
      capability: "cloudwatch:ListDashboards",
      covers: ["cloudwatch:ListDashboards", "cloudwatch:GetDashboard"],
      label: "Dashboards",
      read: from(dashboards, "cloudwatch:ListDashboards", (r) => r.dashboards),
      map: MAP.dashboard,
      ctx,
    }),
    resourceSection({
      capability: "ses:ListEmailIdentities",
      covers: [
        "ses:GetAccount",
        "ses:ListEmailIdentities",
        "ses:ListConfigurationSets",
        "ses:GetConfigurationSet",
        "ses:ListSuppressedDestinations",
      ],
      label: "Email identities",
      read: from(ses, "ses:ListEmailIdentities", (r) => r.identities),
      map: MAP.sesIdentity,
      ctx,
    }),
    resourceSection({
      capability: "sqs:ListQueues",
      covers: ["sqs:ListQueues", "sqs:GetQueueAttributes"],
      label: "Queues",
      read: from(sqs, "sqs:ListQueues", (r) => r.queues),
      map: MAP.queue,
      ctx,
    }),
    resourceSection({
      capability: "lambda:ListFunctions",
      covers: ["lambda:ListFunctions", "lambda:GetFunctionConcurrency"],
      label: "Functions",
      read: from(lambda, "lambda:ListFunctions", (r) => r.functions),
      map: MAP.lambdaFunction,
      ctx,
    }),
    resourceSection({
      capability: "budgets:DescribeBudgets",
      covers: ["budgets:DescribeBudgets"],
      label: "Budgets",
      read: from(budgets, "budgets:DescribeBudgets", (r) => r.budgets),
      map: MAP.budget,
      ctx,
    }),
    resourceSection({
      capability: "events:ListRules",
      covers: ["events:ListRules", "events:ListTargetsByRule"],
      label: "Event rules",
      read: from(eventbridge, "events:ListRules", (r) => r.read),
      map: MAP.rule,
      ctx,
    }),

    /* --- read, and contributing something other than a resource ------------ */
    signalSection({
      capability: "sts:GetCallerIdentity",
      covers: ["sts:GetCallerIdentity"],
      label: "Caller identity",
      read: identity,
      why: "the account, region and partition every other section is read in and attributed to",
    }),
    signalSection({
      capability: "tag:GetResources",
      covers: ["tag:GetResources"],
      label: "Tag index",
      read: tagged,
      why: "the tenant attribution every resource in every other section is joined against",
    }),
    signalSection({
      capability: "cloudfront:GetDistributionConfig",
      covers: ["cloudfront:GetDistributionConfig", "cloudfront:ListInvalidations"],
      label: "Edge configuration",
      read: from(cdn, "cloudfront:GetDistributionConfig", (r) => r.distributions),
      why: "origin, TLS and invalidation posture for distributions the CloudFront section already counts",
    }),
    signalSection({
      capability: "rds:DescribePendingMaintenanceActions",
      covers: [
        "rds:DescribePendingMaintenanceActions",
        "rds:DescribeEvents",
        "rds:DescribeDBParameterGroups",
      ],
      label: "Database maintenance",
      read: from(rds, "rds:DescribePendingMaintenanceActions", (r) => r.pendingMaintenance),
      why: "pending actions, events and parameter groups for databases the RDS section already counts",
    }),
    signalSection({
      capability: "acm:DescribeCertificate",
      covers: ["acm:DescribeCertificate"],
      label: "Certificate detail",
      read: from(acm, "acm:DescribeCertificate", (r) => r.certificates),
      why: "validation and renewal state for certificates the ACM section already counts",
    }),
    signalSection({
      capability: "servicequotas:ListServiceQuotas",
      covers: ["servicequotas:ListServiceQuotas", "servicequotas:GetServiceQuota"],
      label: "Service quotas",
      read: from(quotas, "servicequotas:ListServiceQuotas", (r) =>
        firstAnswering(
          r.services.map((service) => service.quotas),
          { state: "EMPTY", capability: "servicequotas:ListServiceQuotas", asOf: now().toISOString() },
        ),
      ),
      why: "the ceilings the estate is allowed to grow to; a quota is a limit, not a resource",
    }),
    signalSection({
      capability: "pricing:GetProducts",
      covers: ["pricing:GetProducts", "pricing:ListPriceLists"],
      label: "List prices",
      read: from(pricing, "pricing:GetProducts", (r) =>
        firstAnswering(
          r.shapes.map((shape) => shape.products),
          { state: "EMPTY", capability: "pricing:GetProducts", asOf: now().toISOString() },
        ),
      ),
      why: "published list prices for quoting; a price belongs to no account and is not a resource",
    }),
    signalSection({
      capability: "iam:GetAccountAuthorizationDetails",
      covers: ["iam:GetAccountAuthorizationDetails", "iam:ListAccessKeys"],
      label: "IAM posture",
      read: from(iam, "iam:GetAccountAuthorizationDetails", (r) => r.read),
      why: "who may act on the estate; principals are counted by the IAM surface, not the estate",
    }),
    signalSection({
      capability: "health:DescribeEvents",
      covers: ["health:DescribeEvents", "health:DescribeAffectedEntities"],
      label: "AWS health events",
      read: from(awsHealth, "health:DescribeEvents", (r) => r.events),
      why: "what AWS says is wrong with the estate; an incident is not a resource",
    }),
    signalSection({
      capability: "cloudwatch:DescribeAlarms",
      covers: ["cloudwatch:DescribeAlarms"],
      label: "Alarms",
      read: from(alarms, "cloudwatch:DescribeAlarms", (r) => r.read),
      why: "whether the estate is watched; an alarm is a rule about resources, not one of them",
    }),
    signalSection({
      capability: "securityhub:GetFindings",
      covers: ["securityhub:GetFindings"],
      label: "Security findings",
      read: from(findings, "securityhub:GetFindings", (r) => r.read),
      why: "what is wrong with the resources the other sections counted",
    }),
    signalSection({
      capability: "organizations:ListAccounts",
      covers: ["organizations:DescribeOrganization", "organizations:ListAccounts"],
      label: "Organization accounts",
      read: from(organization, "organizations:ListAccounts", (r) => r.accounts),
      why: "which accounts exist beside this one; this inventory reads THIS account only",
    }),
    signalSection({
      capability: "cur:DescribeReportDefinitions",
      covers: ["cur:DescribeReportDefinitions"],
      label: "Cost and usage reports",
      read: from(posture, "cur:DescribeReportDefinitions", (r) =>
        curRead(r, denial, now().toISOString()),
      ),
      why: "whether billing is centralised; a report definition is not an estate resource",
    }),

    /* --- a reader exists, and this composition deliberately does not drive it */
    notComposedSection({
      capability: "organizations:ListRoots",
      covers: [
        "organizations:ListRoots",
        "organizations:ListOrganizationalUnitsForParent",
        "organizations:ListPoliciesForTarget",
      ],
      label: "Organizational units",
      why:
        "`organization-units.ts` walks the unit hierarchy and the policies attached to it, on " +
        "`/platform/estate` under STUDIO-010-003. An organizational unit is not an estate resource " +
        "— nothing runs in one, nothing is billed for one — it is where a guardrail is attached, so " +
        "counting units beside ECS services would inflate the estate with governance structure.",
      holdsResources: false,
    }),
    notComposedSection({
      capability: "cloudwatch:GetMetricData",
      covers: ["cloudwatch:GetMetricData"],
      label: "Metric series",
      why:
        "`metrics.ts` needs the caller's own queries — a namespace, a metric, a statistic and a " +
        "window. An inventory has no such question, and issuing an invented set of queries would " +
        "bill for data nothing on this page reads.",
      holdsResources: false,
    }),
    notComposedSection({
      capability: "ce:GetCostAndUsageWithResources",
      covers: ["ce:GetCostAndUsageWithResources"],
      label: "Cost and usage",
      why:
        "Cost Explorer is read by the cost surface, per period and per dimension. Money is not " +
        "an estate resource, and every one of these calls is billed.",
      holdsResources: false,
    }),
    notComposedSection({
      capability: "backup:ListBackupVaults",
      covers: ["backup:ListBackupVaults", "backup:ListRecoveryPointsByBackupVault"],
      label: "Backup vaults",
      why:
        "`retained.ts` reads vaults and recovery points FOR ONE TENANT, on the tenant's own page. " +
        "The estate-wide inventory has no tenant to read for, so backup vaults are not in the " +
        "resource total below and the total says so.",
      holdsResources: true,
    }),
    notComposedSection({
      capability: "ssm:DescribeParameters",
      covers: ["ssm:DescribeParameters"],
      label: "SSM parameters",
      why:
        "read per tenant by `retained.ts`, for the same reason as the backup vaults above. " +
        "Parameters are resources; they are not counted here.",
      holdsResources: true,
    }),
    notComposedSection({
      capability: "s3:ListObjectVersions",
      covers: ["s3:ListObjectVersions"],
      label: "Retained object versions",
      why:
        "an object version is not an estate resource — it is content inside a bucket the S3 " +
        "section already counts — and listing versions across every bucket is unbounded.",
      holdsResources: false,
    }),
  ]

  return {
    identity,
    tagged,
    ecsServices,
    databases,
    distributions,
    certificates,
    sections,
    coverage: estateCoverage(sections),
    count: estateResourceCount(sections),
    calls: cadenced.ledger(),
  }
}

/* ================================================== coverage, as data ===== */

/** One capability this engine cannot answer for, with what would fix it. */
export interface CoverageGap {
  capability: Capability
  service: string
  label: string
  why: string
}

/**
 * Which services this engine can see, and which it cannot — and WHY not.
 *
 * The four lists are four different facts and are never merged. `absent` is the
 * only one that says anything about the account.
 */
export interface CoverageReport {
  /** Capabilities that answered with something. */
  visible: readonly Capability[]
  /** Capabilities that answered with nothing. A real absence, and a claim. */
  absent: readonly Capability[]
  /** Refused, throttled, broken or unconfigured. Not an absence. */
  unknown: readonly CoverageGap[]
  /** A reader exists; this composition does not drive it, and says why. */
  notComposed: readonly CoverageGap[]
  /** No module in this build reads it at all. Computed, never hand-listed. */
  noReader: readonly CoverageGap[]
  /** The sentence a surface prints. One funnel. */
  text: string
}

/**
 * Coverage, computed from the sections and from the capability registry.
 *
 * `noReader` is the registry MINUS every capability some section claims, so a
 * capability added to `capabilities.ts` that nothing reads appears here on the
 * next render rather than being invisible until somebody notices. That is the
 * one direction this has to be automatic in: a hand-maintained list of gaps
 * goes stale exactly when a gap opens.
 */
export function estateCoverage(sections: readonly EstateSection[]): CoverageReport {
  const visible: Capability[] = []
  const absent: Capability[] = []
  const unknown: CoverageGap[] = []
  const notComposed: CoverageGap[] = []
  const claimed = new Set<string>()

  for (const section of sections) {
    for (const capability of section.covers) claimed.add(capability)
    const gap = (why: string): CoverageGap => ({
      capability: section.capability,
      service: section.service,
      label: section.label,
      why,
    })
    switch (section.coverage.kind) {
      case "VISIBLE":
        visible.push(section.capability)
        break
      case "ABSENT":
        absent.push(section.capability)
        break
      case "UNKNOWN":
        unknown.push(gap(section.coverage.why))
        break
      case "NOT_COMPOSED":
        notComposed.push(gap(section.coverage.why))
        break
      case "NO_READER":
        break
    }
  }

  const noReader: CoverageGap[] = []
  for (const capability of Object.keys(CAPABILITIES) as Capability[]) {
    if (claimed.has(capability)) continue
    noReader.push({
      capability,
      service: serviceOfCapability(capability),
      label: CAPABILITIES[capability].reads,
      why:
        `no module in this build reads ${capability}. This is a gap in the CONSOLE, not a ` +
        `statement about the account: whatever ${capability} would have shown is invisible here ` +
        `and may well be present there.`,
    })
  }

  return {
    visible,
    absent,
    unknown,
    notComposed,
    noReader,
    text:
      `${visible.length} services answered, ${absent.length} answered with nothing, ` +
      `${unknown.length} could not be read, ${notComposed.length} have a reader this page does ` +
      `not drive, and ${noReader.length} capabilities have no reader at all. Only the ` +
      `${absent.length} that answered with nothing are a statement about the account.`,
  }
}

/* ================================================== the total, and its floor */

/** A service whose resources are NOT in the total, and the reason they are not. */
export interface ExcludedFromCount {
  capability: Capability
  service: string
  label: string
  why: string
}

export interface EstateCount {
  /** Resources actually read and named. */
  counted: number
  /** How many sections that came from. */
  sections: number
  /** False when anything at all was left out. A false here makes `counted` a floor. */
  complete: boolean
  excluded: readonly ExcludedFromCount[]
  /** Read, but not nameable as a resource. Never dropped without being counted. */
  omitted: readonly OmittedResource[]
  /** The sentence. It says "at least" whenever `complete` is false. */
  text: string
}

/**
 * The resource total, and everything it does not include.
 *
 * A count that silently omits a denied service is a lie with a number on it, so
 * this one cannot be rendered without its exclusions: the number and the list
 * come out of the same call, and `text` says "at least" whenever the list is not
 * empty.
 */
export function estateResourceCount(sections: readonly EstateSection[]): EstateCount {
  let counted = 0
  let contributing = 0
  const excluded: ExcludedFromCount[] = []
  const omitted: OmittedResource[] = []

  for (const section of sections) {
    const gap = (why: string): ExcludedFromCount => ({
      capability: section.capability,
      service: section.service,
      label: section.label,
      why,
    })

    if (section.contribution.kind === "resources") {
      omitted.push(...section.contribution.omitted)
      const read = section.contribution.read
      if (read.state === "ACTUAL" || read.state === "STALE") {
        counted += read.value.length
        contributing += 1
      } else if (read.state === "EMPTY") {
        contributing += 1
      } else {
        excluded.push(gap(describeRead(read, `${section.label} read from AWS`)))
      }
      continue
    }

    if (section.contribution.kind === "not-composed" && section.contribution.holdsResources) {
      excluded.push(gap(section.contribution.why))
    }
  }

  const complete = excluded.length === 0 && omitted.length === 0
  const head = complete
    ? `${counted} resources across ${contributing} services.`
    : `at least ${counted} resources across ${contributing} services.`

  const parts = [head]
  if (excluded.length > 0) {
    parts.push(
      `This total EXCLUDES ${excluded.length} service${excluded.length === 1 ? "" : "s"} — ` +
        `${excluded.map((entry) => entry.label).join(", ")} — that this engine could not read. ` +
        `Whatever is running there is not in the number above.`,
    )
  }
  if (omitted.length > 0) {
    parts.push(
      `${omitted.length} resource${omitted.length === 1 ? " was" : "s were"} read but could not ` +
        `be named by an ARN, and ${omitted.length === 1 ? "is" : "are"} not counted either.`,
    )
  }

  return { counted, sections: contributing, complete, excluded, omitted, text: parts.join(" ") }
}

/** Every resource a section produced, and `[]` only where the read said so. */
export function sectionResources(section: EstateSection): readonly EstateResource[] {
  if (section.contribution.kind !== "resources") return []
  const read = section.contribution.read
  return read.state === "ACTUAL" || read.state === "STALE" ? read.value : []
}

/** Every surface's refresh window, named, so the page can print its own cadence. */
export const SURFACE_REFRESH_MS: Readonly<Record<string, number>> = {
  "ecs:service": ECS_TTL_MS,
  "rds:db": RDS_TTL_MS,
  "cloudfront:distribution": CLOUDFRONT_TTL_MS,
  "acm:certificate": ACM_TTL_MS,
}

export interface EstateLine {
  surface: string
  /** The rendered sentence. One funnel, so DENIED cannot be worded as absence. */
  text: string
  resources: readonly EstateResource[]
  read: AwsRead<readonly EstateResource[]>
}

/**
 * What the estate page prints, per surface.
 *
 * The page renders exactly these strings. Asserting on them is asserting on the
 * production render path, which is why the mutation proofs target this and not
 * `describeRead`.
 *
 * ── Why this still returns four lines and not thirty ───────────────────────
 *
 * These four are the four the page has always drawn, by these four names, and
 * three surfaces plus their tests read them positionally. `estateSectionLines`
 * below returns the SAME four first and then every other service, so adopting
 * the full estate is one identifier at each call site rather than a rewrite —
 * and until a call site changes, nothing it renders changes. The full picture
 * is on `readings.sections`, `readings.coverage` and `readings.count`
 * regardless of which of the two a surface draws.
 */
export function estateLines(readings: EstateReadings): readonly EstateLine[] {
  const surfaces: Array<[string, AwsRead<readonly EstateResource[]>]> = [
    ["ECS services", readings.ecsServices],
    ["Databases", readings.databases],
    ["Edge distributions", readings.distributions],
    ["Certificates", readings.certificates],
  ]
  return surfaces.map(([surface, read]) => ({
    surface,
    text: describeRead(read, `${surface} read from AWS`),
    resources: read.state === "ACTUAL" ? read.value : [],
    read,
  }))
}

/**
 * Every resource-bearing service as a line, in section order.
 *
 * The first four are byte-identical to `estateLines`: same surface names, same
 * `text` out of the same `describeRead`, same readings. A surface that swaps one
 * for the other gains the other twenty-odd services and changes nothing about
 * the four it already drew.
 *
 * Signal and not-composed sections are NOT here, because an `EstateLine` is a
 * list of resources and neither of those has any — they belong to
 * `readings.coverage`, where a caller can render "we cannot see ECR"
 * differently from "there is no ECR".
 */
export function estateSectionLines(readings: EstateReadings): readonly EstateLine[] {
  const lines: EstateLine[] = []
  for (const section of readings.sections) {
    if (section.contribution.kind !== "resources") continue
    const read = section.contribution.read
    lines.push({
      surface: section.label,
      text: section.text,
      resources: read.state === "ACTUAL" ? read.value : [],
      read,
    })
  }
  return lines
}
