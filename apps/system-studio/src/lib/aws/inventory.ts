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
  CLOUDFRONT_TTL_MS,
  ECS_TTL_MS,
  RDS_TTL_MS,
} from "./capabilities"
import { denialContextFrom, resolveIdentity, type Identity } from "./identity"
import {
  describeRead,
  liveGateway,
  readAws,
  type AwsGateway,
  type AwsRead,
  type DenialContext,
} from "./read"
import { attributionOf, tagIndex, taggedResources, type Attribution, type TaggedResource } from "./tags"

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

  return {
    arn,
    resourceType,
    name,
    state,
    region: parsed?.region ?? "",
    accountId: parsed?.accountId ?? "",
    partition: parsed?.partition ?? "",
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
      accountId: parsed?.accountId ?? "",
      // A CloudFront distribution's ARN carries no region because the resource
      // has none. `""` would render as "a resource with no region", which is
      // the same string an unparsed ARN produces; `global` is what it is.
      region: parsed?.region || "global",
      partition: parsed?.partition ?? "",
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

/* -------------------------------------------------------- the whole page -- */

export interface EstateReadings {
  identity: AwsRead<Identity>
  tagged: AwsRead<readonly TaggedResource[]>
  ecsServices: AwsRead<readonly EstateResource[]>
  databases: AwsRead<readonly EstateResource[]>
  distributions: AwsRead<readonly EstateResource[]>
  certificates: AwsRead<readonly EstateResource[]>
}

/**
 * The estate page's whole data load, in one call.
 *
 * `apps/system-studio/src/app/platform/estate/page.tsx` calls this with no
 * arguments. Tests call it with a stand-in gateway. That is deliberately the
 * SAME function: a test that drove a helper the page does not call would stay
 * green the day the page stopped calling it.
 */
export async function estateInventory(
  supplied?: AwsGateway,
  options: { now?: () => Date } = {},
): Promise<EstateReadings> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())

  const identity = await resolveIdentity(supplied, { now })
  const denial = denialContextFrom(identity)

  const tagged = await taggedResources(supplied, { now, denial })
  const ctx: ReadContext = {
    now,
    denial,
    tags: tagIndex(tagged.state === "ACTUAL" ? tagged.value : []),
  }

  const [ecsServices, databases, distributions, certificates] = await Promise.all([
    readEcsServices(gw, ctx),
    readDatabases(gw, ctx),
    readDistributions(gw, ctx),
    readCertificates(gw, ctx),
  ])

  return { identity, tagged, ecsServices, databases, distributions, certificates }
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
