/**
 * STUDIO-080-003 — the escape hatch, built from the resolved estate rather than
 * from a habit.
 *
 * There was no console link anywhere in the Studio. That is not the safe state:
 * an operator who needs the console and has no link pastes an ARN into a search
 * box in whatever account their browser is already signed into, which is the
 * unsafe path this exists to replace.
 *
 * Two properties make it safe rather than convenient:
 *
 *   * **The host comes from the partition, and an unknown partition gets `null`.**
 *     `console.aws.amazon.com` is not where a GovCloud or a China resource
 *     lives, and a link that points at the commercial console for a `aws-us-gov`
 *     ARN is the GE-010-007 residency defect in miniature — it invites an
 *     operator to look for a resource in the wrong jurisdiction, decide it does
 *     not exist, and act on that. Returning `null` makes the surface say "no
 *     console link for partition X" instead.
 *   * **It is gated on a role, not on being an operator.** `isOperator` is one
 *     boolean for every role family; break-glass is not.
 *
 * And it says what it is: actions taken in the console happen outside this
 * engine's audit. That sentence is the honest form of "never depend on them for
 * normal operation" — it is the reason not to, stated where the link is.
 *
 * ── STUDIO-080-010 — one link per readable resource type ────────────────────
 *
 * The service programme made two dozen more resource types readable, and a
 * reading an operator cannot open in the console is a reading they will find by
 * typing a name into a search box — in whatever account their browser happens to
 * be signed into. So every newly-readable type gets a deep link here, built by
 * `resourceConsoleLink`, and every one of them obeys four rules that the type
 * system and this module's tests enforce rather than the caller remembering:
 *
 *   1. **The host is the partition's.** Same table as above; an unknown
 *      partition is `NO_LINK`, never a commercial-console guess.
 *   2. **The region is the resolved identity's, and it must belong to that
 *      partition.** `cn-north-1` inside partition `aws` is a context that got
 *      assembled wrong somewhere upstream; a link built from it would point at
 *      an account in the wrong jurisdiction, so it is refused. The check is by
 *      region prefix — the one part of a region name that is load-bearing.
 *   3. **Global services carry no region at all.** IAM, CloudFront, Route 53 and
 *      WAF at CLOUDFRONT scope are not regional, and a `?region=` on their
 *      console URL is at best ignored and at worst renders an empty page for a
 *      resource that does exist. `RegionScope` names the four behaviours —
 *      regional host + region query, global host + nothing, global host + region
 *      query (S3, whose console is global but whose bucket view wants the
 *      bucket's region), and global host + the literal `region=global` (WAF at
 *      CLOUDFRONT scope) — so a caller cannot pick the wrong one by accident.
 *   4. **An identifier that does not parse produces no link.** Every ARN arm
 *      checks the ARN's partition, region, account AND service against the
 *      context it was asked to link from. A link to the wrong account is worse
 *      than no link: the operator opens a page, sees nothing that matches, and
 *      concludes the resource is gone.
 *
 * Where a console path is one this module cannot build with confidence — an
 * ElastiCache engine whose console route is not one of the two this table
 * names — the answer is `NO_LINK` with the reason, not a URL that sends someone
 * to a 404 wearing the right account number.
 *
 * And because an estate is not one region, `consoleContextForReading` takes the
 * `{partition, region, accountId}` triple thirty readers in this directory
 * already carry and reconciles it with the resolved identity: a stated region
 * wins (it came off the resource's own ARN, and the reader already fell back to
 * the identity where AWS returned none), a stated account that is not the
 * identity's is refused.
 *
 * ## What this module deliberately does not do
 *
 * It reads nothing. It takes identifiers a reader in this directory already
 * returned and composes a URL; it holds no AWS client, issues no call and can be
 * imported anywhere. Nothing here is a reader and nothing here stands in for
 * one — a resource this engine cannot read has no identifier to link to, and
 * that is the correct outcome.
 */

/*
 * `parseArn` is `tags.ts`'s, imported rather than written again.
 *
 * Three copies of an ARN parser already exist in this directory — `tags.ts`,
 * `quotas.ts` and `inventory.ts` — and a fourth here would be a fourth set of
 * edge cases to keep in step for a module whose whole job is deciding whether
 * an ARN belongs to the account being linked into. `tags.ts` is the one the
 * estate page already loads and the one that splits `resourceType` from
 * `resourceId`, which is exactly what the ACM and Access Analyzer arms below
 * need. Consuming it means a fix to the colon/slash rule lands here too.
 */
import { parseArn, type ParsedArn } from "./tags"

/* ------------------------------------------------------- partition + host -- */

/** Console hosts, by partition. Nothing is derived by pattern; each is named. */
const CONSOLE_HOSTS: Readonly<Record<string, string>> = {
  aws: "console.aws.amazon.com",
  "aws-us-gov": "console.amazonaws-us-gov.com",
  "aws-cn": "console.amazonaws.cn",
}

/**
 * Which partition a region name belongs to, or null when it is one this module
 * will not link into.
 *
 * The prefix is the only part of a region name that is load-bearing, and it is
 * a closed set: `us-gov-*` is GovCloud, `cn-*` is China, and a second segment
 * beginning `iso` is one of the air-gapped partitions — which have no console
 * this module can name, so they are refused here rather than being silently
 * classified as commercial. Everything else that looks like a region name is
 * commercial.
 *
 * This exists so that a context assembled from two different sources — a
 * partition from an ARN and a region from an environment variable, say — cannot
 * produce a link. That combination is how a resource in one jurisdiction gets
 * looked for in another.
 */
export function partitionOfRegion(region: string): string | null {
  const name = region.trim()
  if (!/^[a-z]{2}(-[a-z0-9]+)+-\d+$/.test(name)) return null
  if (name.startsWith("us-gov-")) return "aws-us-gov"
  if (name.startsWith("cn-")) return "aws-cn"
  const second = name.split("-")[1] ?? ""
  // us-iso-east-1, us-isob-east-1, eu-isoe-west-1, us-isof-south-1 — no console
  // host is named for these, and calling them commercial would invent one.
  if (second.startsWith("iso")) return null
  return "aws"
}

/** Partitions this module can build a link for, for a surface to explain itself. */
export function linkablePartitions(): readonly string[] {
  return Object.keys(CONSOLE_HOSTS).sort()
}

/* ------------------------------------------------------------- the shape -- */

/**
 * How a console app treats the region.
 *
 * Four behaviours, each named, because the difference between them is the
 * difference between a link that opens the resource and one that opens an empty
 * page. Encoding it as data next to the path means a new entry has to state
 * which it is; there is no default to fall through to.
 */
type RegionScope =
  /** `https://{region}.{host}/{path}?region={region}` — the ordinary case. */
  | "REGIONAL"
  /** `https://{host}/{path}` — IAM, CloudFront, Route 53. No region anywhere. */
  | "GLOBAL"
  /** `https://{host}/{path}?region={region}` — S3: global console, regional bucket. */
  | "GLOBAL_REGION_QUERY"
  /** `https://{host}/{path}?region=global` — WAF at CLOUDFRONT scope, exactly. */
  | "GLOBAL_REGION_LITERAL"

/** One console destination, before a partition and a region are applied to it. */
interface LinkSpec {
  scope: RegionScope
  /** Path after the host, with no leading slash and no region query. */
  path: string
  /** Query pairs the path itself needs. Values are encoded here, once. */
  query?: readonly (readonly [string, string])[]
  /** Fragment, already encoded by whichever arm built it. No leading `#`. */
  hash?: string
  /**
   * Partitions this console app exists in. Undefined means every partition in
   * `CONSOLE_HOSTS`. Named only where the service is absent from a partition,
   * and erring towards absent: a missing link is a surface saying so, while a
   * link into a console that does not host the service is a dead end.
   */
  partitions?: readonly string[]
}

/** The account, region and partition a link is being built for. */
export interface ConsoleContext {
  /** From the resolved identity's ARN — never a literal. */
  partition: string
  /** From the resolved identity — never a literal. */
  region: string
  /**
   * The account the identity resolved to.
   *
   * Required, not optional. Every ARN-bearing arm checks it, and a link built
   * without knowing which account it is for is the failure this module exists
   * to prevent. A caller whose identity read did not succeed has no account and
   * therefore has no business rendering a link.
   */
  accountId: string
}

/** A link, or the reason there is not one. Never a URL and a caveat. */
export type ConsoleLinkOutcome =
  | { state: "LINK"; url: string }
  | { state: "NO_LINK"; because: string }

/* ------------------------------------------------------- service home pages -- */

export interface ConsoleTarget {
  /** The partition the resource is in, from its ARN or from the resolved identity. */
  partition: string
  /** The region the resource is in. */
  region: string
  /**
   * Which console page to open. A closed set, because a caller-supplied path
   * is an open redirect with extra steps.
   */
  service:
    | "ecs"
    | "rds"
    | "cloudfront"
    | "acm"
    | "cloudwatch"
    | "securityhub"
    | "resource-groups"
    | "cognito"
    | "vpc"
    | "ec2"
    | "ecr"
    | "elasticache"
    | "dynamodb"
    | "logs"
    | "s3"
    | "secretsmanager"
    | "kms"
    | "cloudtrail"
    | "config"
    | "route53"
    | "guardduty"
    | "wafv2"
    | "servicequotas"
    | "access-analyzer"
    | "iam"
}

/**
 * The home page of each console app.
 *
 * The first seven entries reproduce the `{service}/home` shape this module
 * shipped with, byte for byte, so the two call sites that existed when the
 * table was introduced — `src/app/platform/estate/page.tsx` (`resource-groups`)
 * and `e2e/aws-unknown-is-not-absent.spec.ts` (`ecs`) — keep the URL they had.
 * `cloudfront` is the one exception and is deliberate: CloudFront is a global
 * service and its old regional URL was wrong in the way rule 3 above describes.
 * No caller passes it today.
 */
const SERVICE_HOMES: Readonly<Record<ConsoleTarget["service"], LinkSpec>> = {
  ecs: { scope: "REGIONAL", path: "ecs/home" },
  rds: { scope: "REGIONAL", path: "rds/home" },
  acm: { scope: "REGIONAL", path: "acm/home" },
  cloudwatch: { scope: "REGIONAL", path: "cloudwatch/home" },
  securityhub: { scope: "REGIONAL", path: "securityhub/home" },
  "resource-groups": { scope: "REGIONAL", path: "resource-groups/home" },
  cognito: { scope: "REGIONAL", path: "cognito/v2/idp/user-pools" },
  vpc: { scope: "REGIONAL", path: "vpc/home" },
  ec2: { scope: "REGIONAL", path: "ec2/home" },
  ecr: { scope: "REGIONAL", path: "ecr/repositories" },
  elasticache: { scope: "REGIONAL", path: "elasticache/home" },
  dynamodb: { scope: "REGIONAL", path: "dynamodbv2/home" },
  logs: { scope: "REGIONAL", path: "cloudwatch/home", hash: "logsV2:log-groups" },
  secretsmanager: { scope: "REGIONAL", path: "secretsmanager/listsecrets" },
  kms: { scope: "REGIONAL", path: "kms/home", hash: "/kms/keys" },
  cloudtrail: { scope: "REGIONAL", path: "cloudtrail/home" },
  config: { scope: "REGIONAL", path: "config/home" },
  guardduty: { scope: "REGIONAL", path: "guardduty/home" },
  wafv2: { scope: "REGIONAL", path: "wafv2/homev2" },
  servicequotas: { scope: "REGIONAL", path: "servicequotas/home" },
  "access-analyzer": { scope: "REGIONAL", path: "access-analyzer/home" },
  // Global console, regional bucket list — S3's own shape, not a compromise.
  s3: { scope: "GLOBAL_REGION_QUERY", path: "s3/buckets" },
  iam: { scope: "GLOBAL", path: "iam/home" },
  cloudfront: { scope: "GLOBAL", path: "cloudfront/v4/home", partitions: COMMERCIAL_ONLY() },
  route53: { scope: "GLOBAL", path: "route53/v2/hostedzones", partitions: COMMERCIAL_ONLY() },
}

/**
 * The partitions the two globally-scoped edge services are offered in.
 *
 * A function rather than a shared frozen array so no entry in the table can
 * mutate the list another entry reads. The value is `["aws"]`: CloudFront and
 * Route 53's public hosted zones are commercial-partition services, and a
 * GovCloud or China console has no page for them. Refusing the link makes the
 * surface say so; producing one sends an operator to a page that will not load.
 */
function COMMERCIAL_ONLY(): readonly string[] {
  return ["aws"]
}

/* -------------------------------------------------------------- assembly -- */

/** `key=value&…`, encoded once, in the order given. No `?`. */
function queryString(pairs: readonly (readonly [string, string])[]): string {
  return pairs
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&")
}

/**
 * Apply a partition, a region and an account to one `LinkSpec`.
 *
 * Every refusal names itself. The surface that renders `NO_LINK` prints
 * `because`, which is how "there is no console link for this" stops looking
 * like "this resource does not exist".
 */
function render(context: ConsoleContext, spec: LinkSpec): ConsoleLinkOutcome {
  const partition = context.partition.trim()
  const region = context.region.trim()

  const host = CONSOLE_HOSTS[partition]
  if (!host) {
    return {
      state: "NO_LINK",
      because:
        `no console host is named for partition ${partition || "(none resolved)"}. ` +
        `This module knows ${linkablePartitions().join(", ")}; linking into a console it cannot name ` +
        `would point at the wrong jurisdiction.`,
    }
  }
  if (!region) {
    return {
      state: "NO_LINK",
      because: "no region was resolved, and a console URL built without one opens an arbitrary region.",
    }
  }

  const regionPartition = partitionOfRegion(region)
  if (regionPartition === null) {
    return {
      state: "NO_LINK",
      because: `region ${region} is not one this module can place in a partition, so it cannot build a host for it.`,
    }
  }
  if (regionPartition !== partition) {
    return {
      state: "NO_LINK",
      because:
        `region ${region} belongs to partition ${regionPartition}, not to ${partition}. ` +
        `This context was assembled from two sources that disagree; a link built from it would ` +
        `point at an account in the wrong partition.`,
    }
  }

  if (spec.partitions && !spec.partitions.includes(partition)) {
    return {
      state: "NO_LINK",
      because:
        `this service has no console page in partition ${partition} ` +
        `(it is offered in ${spec.partitions.join(", ")}).`,
    }
  }

  const pairs = [...(spec.query ?? [])]
  let urlHost: string
  switch (spec.scope) {
    case "REGIONAL":
      urlHost = `${region}.${host}`
      pairs.push(["region", region])
      break
    case "GLOBAL":
      urlHost = host
      break
    case "GLOBAL_REGION_QUERY":
      urlHost = host
      pairs.push(["region", region])
      break
    case "GLOBAL_REGION_LITERAL":
      urlHost = host
      // The literal AWS itself uses for CLOUDFRONT-scope WAF. Not the region,
      // and not omitted — the console reads this exact value.
      pairs.push(["region", "global"])
      break
  }

  const search = pairs.length > 0 ? `?${queryString(pairs)}` : ""
  const fragment = spec.hash ? `#${spec.hash}` : ""
  return { state: "LINK", url: `https://${urlHost}/${spec.path}${search}${fragment}` }
}

/* ----------------------------------------------------------- ARN parsing -- */

/**
 * Whether an ARN describes a resource in the account this link is being built
 * for.
 *
 * All four fields, and the service too. The service check is not paranoia: the
 * arms below each take one kind of ARN, and a certificate ARN handed to the
 * load-balancer arm would otherwise produce a plausible URL to nothing.
 *
 * An empty region or account in the ARN is accepted — S3 bucket and CloudFront
 * distribution ARNs genuinely have none — but a populated one that disagrees
 * with the context is refused.
 */
function arnFits(
  parsed: ParsedArn,
  context: ConsoleContext,
  service: string,
): { ok: true } | { ok: false; because: string } {
  if (parsed.service !== service) {
    return {
      ok: false,
      because: `this is a ${parsed.service} ARN, and this link is built from a ${service} ARN.`,
    }
  }
  if (parsed.partition !== context.partition.trim()) {
    return {
      ok: false,
      because:
        `the ARN is in partition ${parsed.partition} and this console context is ${context.partition}. ` +
        `Opening it here would show an account in another partition.`,
    }
  }
  if (parsed.region && parsed.region !== context.region.trim()) {
    return {
      ok: false,
      because: `the ARN is in region ${parsed.region} and this console context is ${context.region}.`,
    }
  }
  if (parsed.accountId && parsed.accountId !== context.accountId.trim()) {
    return {
      ok: false,
      because:
        `the ARN is in account ${parsed.accountId} and this console context is account ` +
        `${context.accountId}. A link to the wrong account is worse than no link.`,
    }
  }
  return { ok: true }
}

/* ------------------------------------------------------------ identifiers -- */

/** A non-blank identifier, or null. Nothing here links from an empty string. */
function id(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * The console's own encoding for a CloudWatch Logs log-group name.
 *
 * `logsV2` puts the name in the path, percent-encodes it twice and then
 * replaces `%` with `$` — so `/aws/lambda/x` becomes `$252Faws$252Flambda$252Fx`.
 * Encoding it once produces a URL the console silently resolves to nothing,
 * which for a log group looks exactly like a log group with no events.
 */
function logsSegment(name: string): string {
  return encodeURIComponent(encodeURIComponent(name)).replace(/%/g, "$")
}

/** A Route 53 zone id with the `/hostedzone/` prefix the API sometimes carries. */
function bareHostedZoneId(value: string): string | null {
  const trimmed = value.trim().replace(/^\/hostedzone\//, "")
  return /^[A-Z0-9]+$/.test(trimmed) ? trimmed : null
}

/** ElastiCache console routes, by engine. Anything else has no route here. */
const ELASTICACHE_ROUTES: Readonly<Record<string, string>> = {
  redis: "redis",
  memcached: "memcached",
}

/* -------------------------------------------------------- the resources -- */

export interface ConsoleMetricDimension {
  name: string
  value: string
}

/**
 * Every resource type a reader in this directory can produce an identifier for.
 *
 * A discriminated union, and each arm carries exactly the identifiers its
 * console route needs — required, never optional. That is the whole reason it
 * is shaped this way: an optional field a caller omits is invisible to `tsc`,
 * and the failure would be a link missing the one segment that made it point at
 * the right resource.
 */
export type ConsoleResource =
  | { kind: "cognito-user-pool"; poolId: string }
  | { kind: "vpc"; vpcId: string }
  | { kind: "subnet"; subnetId: string }
  | { kind: "security-group"; groupId: string }
  | { kind: "load-balancer"; loadBalancerArn: string }
  | { kind: "target-group"; targetGroupArn: string }
  | { kind: "ecr-repository"; registryId: string; repositoryName: string }
  | { kind: "ecr-image"; registryId: string; repositoryName: string; imageDigest: string }
  | { kind: "elasticache-cluster"; engine: string; clusterId: string }
  | { kind: "dynamodb-table"; tableName: string }
  | {
      kind: "cloudwatch-metric"
      namespace: string
      metricName: string
      dimensions: readonly ConsoleMetricDimension[]
      stat: string
      periodSeconds: number
    }
  | { kind: "cloudwatch-dashboard"; dashboardName: string }
  | { kind: "cloudwatch-alarm"; alarmName: string }
  | { kind: "log-group"; logGroupName: string }
  | { kind: "log-stream"; logGroupName: string; logStreamName: string }
  | { kind: "s3-bucket"; bucketName: string }
  | { kind: "secret"; secretArn: string }
  | { kind: "kms-key"; keyId: string }
  | { kind: "cloudtrail-trail"; trailArn: string }
  | { kind: "config-rule"; ruleName: string }
  | { kind: "hosted-zone"; hostedZoneId: string }
  | { kind: "cloudfront-distribution"; distributionId: string }
  | { kind: "rds-instance"; dbInstanceIdentifier: string }
  | { kind: "ecs-cluster"; clusterName: string }
  | { kind: "ecs-service"; clusterName: string; serviceName: string }
  | { kind: "ecs-task"; clusterName: string; taskId: string }
  | { kind: "acm-certificate"; certificateArn: string }
  | { kind: "service-quota"; serviceCode: string; quotaCode: string }
  | { kind: "access-analyzer"; analyzerArn: string }
  | { kind: "guardduty-finding"; findingId: string }
  | { kind: "waf-web-acl"; wafScope: "REGIONAL" | "CLOUDFRONT"; name: string; webAclId: string }
  | { kind: "iam-role"; roleName: string }

/** Every resource kind this module can link, for a surface to explain itself. */
export function linkableResourceKinds(): readonly ConsoleResource["kind"][] {
  return [
    "access-analyzer",
    "acm-certificate",
    "cloudfront-distribution",
    "cloudtrail-trail",
    "cloudwatch-alarm",
    "cloudwatch-dashboard",
    "cloudwatch-metric",
    "cognito-user-pool",
    "config-rule",
    "dynamodb-table",
    "ecr-image",
    "ecr-repository",
    "ecs-cluster",
    "ecs-service",
    "ecs-task",
    "elasticache-cluster",
    "guardduty-finding",
    "hosted-zone",
    "iam-role",
    "kms-key",
    "load-balancer",
    "log-group",
    "log-stream",
    "rds-instance",
    "s3-bucket",
    "secret",
    "security-group",
    "service-quota",
    "subnet",
    "target-group",
    "vpc",
    "waf-web-acl",
  ]
}

/**
 * Turn one resource into the console destination for it, or say why not.
 *
 * Returns a `LinkSpec` on success and a sentence on failure. It never touches
 * the partition or the region — `render` owns those — so a change to how a
 * region reaches a URL cannot be made in one arm and forgotten in thirty.
 */
function specFor(
  context: ConsoleContext,
  resource: ConsoleResource,
): LinkSpec | { because: string } {
  switch (resource.kind) {
    /* ------------------------------------------------------------ cognito */
    case "cognito-user-pool": {
      const pool = id(resource.poolId)
      if (!pool) return { because: "no user pool id was read." }
      return {
        scope: "REGIONAL",
        path: `cognito/v2/idp/user-pools/${encodeURIComponent(pool)}/user-pool-properties`,
      }
    }

    /* ------------------------------------------------------------ network */
    case "vpc": {
      const vpc = id(resource.vpcId)
      if (!vpc || !/^vpc-[0-9a-f]+$/.test(vpc)) {
        return { because: `"${resource.vpcId}" is not a VPC id, so there is nothing to open.` }
      }
      return { scope: "REGIONAL", path: "vpc/home", hash: `VpcDetails:VpcId=${encodeURIComponent(vpc)}` }
    }
    case "subnet": {
      const subnet = id(resource.subnetId)
      if (!subnet || !/^subnet-[0-9a-f]+$/.test(subnet)) {
        return { because: `"${resource.subnetId}" is not a subnet id, so there is nothing to open.` }
      }
      return {
        scope: "REGIONAL",
        path: "vpc/home",
        hash: `SubnetDetails:subnetId=${encodeURIComponent(subnet)}`,
      }
    }
    case "security-group": {
      const group = id(resource.groupId)
      if (!group || !/^sg-[0-9a-f]+$/.test(group)) {
        return {
          because: `"${resource.groupId}" is not a security group id, so there is nothing to open.`,
        }
      }
      return {
        scope: "REGIONAL",
        path: "vpc/home",
        hash: `SecurityGroup:groupId=${encodeURIComponent(group)}`,
      }
    }

    /* ------------------------------------------------------ load balancing */
    case "load-balancer": {
      const parsed = parseArn(resource.loadBalancerArn)
      if (!parsed) return { because: `"${resource.loadBalancerArn}" is not an ARN.` }
      const fits = arnFits(parsed, context, "elasticloadbalancing")
      if (!fits.ok) return { because: fits.because }
      return {
        scope: "REGIONAL",
        path: "ec2/home",
        hash: `LoadBalancer:loadBalancerArn=${encodeURIComponent(resource.loadBalancerArn.trim())}`,
      }
    }
    case "target-group": {
      const parsed = parseArn(resource.targetGroupArn)
      if (!parsed) return { because: `"${resource.targetGroupArn}" is not an ARN.` }
      const fits = arnFits(parsed, context, "elasticloadbalancing")
      if (!fits.ok) return { because: fits.because }
      return {
        scope: "REGIONAL",
        path: "ec2/home",
        hash: `TargetGroup:targetGroupArn=${encodeURIComponent(resource.targetGroupArn.trim())}`,
      }
    }

    /* ---------------------------------------------------------------- ECR */
    case "ecr-repository":
    case "ecr-image": {
      const registry = id(resource.registryId)
      const repository = id(resource.repositoryName)
      if (!registry || !repository) {
        return { because: "an ECR link needs both the registry account and the repository name." }
      }
      if (registry !== context.accountId.trim()) {
        return {
          because:
            `this repository is in registry ${registry} and this console context is account ` +
            `${context.accountId}. A link to the wrong account is worse than no link.`,
        }
      }
      const base = `ecr/repositories/private/${encodeURIComponent(registry)}/${encodeURIComponent(repository)}`
      if (resource.kind === "ecr-repository") return { scope: "REGIONAL", path: base }
      const digest = id(resource.imageDigest)
      if (!digest || !/^sha256:[0-9a-f]{64}$/.test(digest)) {
        return { because: `"${resource.imageDigest}" is not an image digest, so there is no image to open.` }
      }
      return { scope: "REGIONAL", path: `${base}/_/image/${encodeURIComponent(digest)}/details` }
    }

    /* -------------------------------------------------------- ElastiCache */
    case "elasticache-cluster": {
      const cluster = id(resource.clusterId)
      if (!cluster) return { because: "no cache cluster id was read." }
      const route = ELASTICACHE_ROUTES[resource.engine.trim().toLowerCase()]
      if (!route) {
        return {
          because:
            `this module has no console route for ElastiCache engine "${resource.engine}". ` +
            `It knows ${Object.keys(ELASTICACHE_ROUTES).sort().join(", ")}; guessing a path would ` +
            `open a page that does not exist wearing the right account number.`,
        }
      }
      return { scope: "REGIONAL", path: "elasticache/home", hash: `/${route}/${encodeURIComponent(cluster)}` }
    }

    /* ----------------------------------------------------------- DynamoDB */
    case "dynamodb-table": {
      const table = id(resource.tableName)
      if (!table) return { because: "no table name was read." }
      return { scope: "REGIONAL", path: "dynamodbv2/home", hash: `table?name=${encodeURIComponent(table)}` }
    }

    /* --------------------------------------------------------- CloudWatch */
    case "cloudwatch-metric": {
      const namespace = id(resource.namespace)
      const metricName = id(resource.metricName)
      if (!namespace || !metricName) {
        return { because: "a metric link needs both a namespace and a metric name." }
      }
      if (!Number.isFinite(resource.periodSeconds) || resource.periodSeconds <= 0) {
        return { because: `${resource.periodSeconds} is not a period, so the graph cannot be built.` }
      }
      // The console's `graph=` payload. Dimensions keep the order the reader
      // gave them: CloudWatch treats a metric's dimension set as ordered in
      // this encoding, and re-sorting them here would silently graph a
      // different metric from the one the surface read.
      const metric: string[] = [namespace, metricName]
      for (const dimension of resource.dimensions) {
        const name = id(dimension.name)
        const value = id(dimension.value)
        if (!name || !value) {
          return { because: "a metric dimension arrived with no name or no value, so the graph would be of a different metric." }
        }
        metric.push(name, value)
      }
      const graph = JSON.stringify({
        metrics: [metric],
        stat: resource.stat,
        period: resource.periodSeconds,
        region: context.region.trim(),
        view: "timeSeries",
      })
      return { scope: "REGIONAL", path: "cloudwatch/home", hash: `metricsV2?graph=${encodeURIComponent(graph)}` }
    }
    case "cloudwatch-dashboard": {
      const dashboard = id(resource.dashboardName)
      if (!dashboard) return { because: "no dashboard name was read." }
      return { scope: "REGIONAL", path: "cloudwatch/home", hash: `dashboards:name=${encodeURIComponent(dashboard)}` }
    }
    case "cloudwatch-alarm": {
      const alarm = id(resource.alarmName)
      if (!alarm) return { because: "no alarm name was read." }
      return {
        scope: "REGIONAL",
        path: "cloudwatch/home",
        hash: `alarmsV2:alarm/${encodeURIComponent(alarm)}`,
      }
    }
    case "log-group": {
      const group = id(resource.logGroupName)
      if (!group) return { because: "no log group name was read." }
      return {
        scope: "REGIONAL",
        path: "cloudwatch/home",
        hash: `logsV2:log-groups/log-group/${logsSegment(group)}`,
      }
    }
    case "log-stream": {
      const group = id(resource.logGroupName)
      const stream = id(resource.logStreamName)
      if (!group || !stream) return { because: "a log stream link needs both the group and the stream." }
      return {
        scope: "REGIONAL",
        path: "cloudwatch/home",
        hash: `logsV2:log-groups/log-group/${logsSegment(group)}/log-events/${logsSegment(stream)}`,
      }
    }

    /* ----------------------------------------------------------------- S3 */
    case "s3-bucket": {
      const bucket = id(resource.bucketName)
      // The bucket naming rules, which are also what stops a path segment being
      // smuggled in: no slashes, no uppercase, no dots at the ends.
      if (!bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
        return { because: `"${resource.bucketName}" is not a bucket name, so there is nothing to open.` }
      }
      return { scope: "GLOBAL_REGION_QUERY", path: `s3/buckets/${encodeURIComponent(bucket)}` }
    }

    /* ---------------------------------------------------- Secrets Manager */
    case "secret": {
      const parsed = parseArn(resource.secretArn)
      if (!parsed) return { because: `"${resource.secretArn}" is not an ARN.` }
      const fits = arnFits(parsed, context, "secretsmanager")
      if (!fits.ok) return { because: fits.because }
      return {
        scope: "REGIONAL",
        path: "secretsmanager/secret",
        query: [["name", resource.secretArn.trim()]],
      }
    }

    /* ---------------------------------------------------------------- KMS */
    case "kms-key": {
      const key = id(resource.keyId)
      if (!key) return { because: "no key id was read." }
      // A KMS key id is a UUID; an alias or an ARN is not what this route takes.
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(key)) {
        return { because: `"${resource.keyId}" is not a KMS key id, so there is nothing to open.` }
      }
      return { scope: "REGIONAL", path: "kms/home", hash: `/kms/keys/${encodeURIComponent(key)}` }
    }

    /* --------------------------------------------------------- CloudTrail */
    case "cloudtrail-trail": {
      const parsed = parseArn(resource.trailArn)
      if (!parsed) return { because: `"${resource.trailArn}" is not an ARN.` }
      const fits = arnFits(parsed, context, "cloudtrail")
      if (!fits.ok) return { because: fits.because }
      return {
        scope: "REGIONAL",
        path: "cloudtrail/home",
        hash: `/trails/${encodeURIComponent(resource.trailArn.trim())}`,
      }
    }

    /* ------------------------------------------------------------- Config */
    case "config-rule": {
      const rule = id(resource.ruleName)
      if (!rule) return { because: "no Config rule name was read." }
      return {
        scope: "REGIONAL",
        path: "config/home",
        hash: `/rules/rule-details/${encodeURIComponent(rule)}`,
      }
    }

    /* ----------------------------------------------------------- Route 53 */
    case "hosted-zone": {
      const zone = bareHostedZoneId(resource.hostedZoneId)
      if (!zone) {
        return { because: `"${resource.hostedZoneId}" is not a hosted zone id, so there is nothing to open.` }
      }
      return {
        scope: "GLOBAL",
        path: "route53/v2/hostedzones",
        hash: `ListRecordSets/${encodeURIComponent(zone)}`,
        partitions: COMMERCIAL_ONLY(),
      }
    }

    /* --------------------------------------------------------- CloudFront */
    case "cloudfront-distribution": {
      const distribution = id(resource.distributionId)
      if (!distribution || !/^[A-Z0-9]+$/.test(distribution)) {
        return {
          because: `"${resource.distributionId}" is not a distribution id, so there is nothing to open.`,
        }
      }
      return {
        scope: "GLOBAL",
        path: "cloudfront/v4/home",
        hash: `/distributions/${encodeURIComponent(distribution)}`,
        partitions: COMMERCIAL_ONLY(),
      }
    }

    /* ---------------------------------------------------------------- RDS */
    case "rds-instance": {
      const instance = id(resource.dbInstanceIdentifier)
      if (!instance) return { because: "no database instance identifier was read." }
      return {
        scope: "REGIONAL",
        path: "rds/home",
        hash: `database:id=${encodeURIComponent(instance)};is-cluster=false`,
      }
    }

    /* ---------------------------------------------------------------- ECS */
    case "ecs-cluster": {
      const cluster = id(resource.clusterName)
      if (!cluster) return { because: "no cluster name was read." }
      return { scope: "REGIONAL", path: `ecs/v2/clusters/${encodeURIComponent(cluster)}` }
    }
    case "ecs-service": {
      const cluster = id(resource.clusterName)
      const service = id(resource.serviceName)
      if (!cluster || !service) return { because: "an ECS service link needs both the cluster and the service." }
      return {
        scope: "REGIONAL",
        path: `ecs/v2/clusters/${encodeURIComponent(cluster)}/services/${encodeURIComponent(service)}`,
      }
    }
    case "ecs-task": {
      const cluster = id(resource.clusterName)
      const task = id(resource.taskId)
      if (!cluster || !task) return { because: "an ECS task link needs both the cluster and the task id." }
      return {
        scope: "REGIONAL",
        path: `ecs/v2/clusters/${encodeURIComponent(cluster)}/tasks/${encodeURIComponent(task)}`,
      }
    }

    /* ---------------------------------------------------------------- ACM */
    case "acm-certificate": {
      const parsed = parseArn(resource.certificateArn)
      if (!parsed) return { because: `"${resource.certificateArn}" is not an ARN.` }
      const fits = arnFits(parsed, context, "acm")
      if (!fits.ok) return { because: fits.because }
      if (parsed.resourceType !== "certificate" || !parsed.resourceId) {
        return { because: `"${resource.certificateArn}" does not name a certificate.` }
      }
      return {
        scope: "REGIONAL",
        path: "acm/home",
        hash: `/certificates/${encodeURIComponent(parsed.resourceId)}`,
      }
    }

    /* ------------------------------------------------------ Service Quotas */
    case "service-quota": {
      const serviceCode = id(resource.serviceCode)
      const quotaCode = id(resource.quotaCode)
      if (!serviceCode || !quotaCode) {
        return { because: "a quota link needs both the service code and the quota code." }
      }
      return {
        scope: "REGIONAL",
        path: `servicequotas/home/services/${encodeURIComponent(serviceCode)}/quotas/${encodeURIComponent(quotaCode)}`,
      }
    }

    /* ------------------------------------------------------ Access Analyzer */
    case "access-analyzer": {
      const parsed = parseArn(resource.analyzerArn)
      if (!parsed) return { because: `"${resource.analyzerArn}" is not an ARN.` }
      const fits = arnFits(parsed, context, "access-analyzer")
      if (!fits.ok) return { because: fits.because }
      if (parsed.resourceType !== "analyzer" || !parsed.resourceId) {
        return { because: `"${resource.analyzerArn}" does not name an analyzer.` }
      }
      return {
        scope: "REGIONAL",
        path: "access-analyzer/home",
        hash: `/analyzer/${encodeURIComponent(parsed.resourceId)}`,
      }
    }

    /* ----------------------------------------------------------- GuardDuty */
    case "guardduty-finding": {
      const finding = id(resource.findingId)
      if (!finding || !/^[0-9a-f]+$/.test(finding)) {
        return { because: `"${resource.findingId}" is not a GuardDuty finding id, so there is nothing to open.` }
      }
      return {
        scope: "REGIONAL",
        path: "guardduty/home",
        hash: `/findings?macros=current&fId=${encodeURIComponent(finding)}`,
      }
    }

    /* ----------------------------------------------------------------- WAF */
    case "waf-web-acl": {
      const name = id(resource.name)
      const webAclId = id(resource.webAclId)
      if (!name || !webAclId) return { because: "a web ACL link needs both its name and its id." }
      const path = `wafv2/homev2/web-acl/${encodeURIComponent(name)}/${encodeURIComponent(webAclId)}/overview`
      if (resource.wafScope === "CLOUDFRONT") {
        // CLOUDFRONT scope is not a region, and the console does not accept one
        // here: it reads the literal `global`. Encoded, not inferred.
        return { scope: "GLOBAL_REGION_LITERAL", path, partitions: COMMERCIAL_ONLY() }
      }
      return { scope: "REGIONAL", path }
    }

    /* ----------------------------------------------------------------- IAM */
    case "iam-role": {
      const role = id(resource.roleName)
      if (!role || !/^[\w+=,.@-]+$/.test(role)) {
        return { because: `"${resource.roleName}" is not an IAM role name, so there is nothing to open.` }
      }
      return { scope: "GLOBAL", path: "iam/home", hash: `/roles/details/${encodeURIComponent(role)}` }
    }
  }
}

/* ------------------------------------------- a reading's own placement -- */

/**
 * Where a reading says its resource is.
 *
 * Thirty readers in this directory carry this exact nullable triple —
 * `network.ts`, `dynamodb-tables.ts`, `guardduty.ts`, `quotas.ts`, `waf.ts` and
 * the rest — each with the same documented rule: the value comes from the
 * resource's own ARN where AWS returned one, and is null where it did not, so
 * that a surface never prints a guessed region. This is the type that carries
 * that answer here.
 *
 * Two of them call the account field something else — `network.ts`'s VPC,
 * subnet and security-group readings name it `ownerId`, because that is what
 * `DescribeVpcs` calls it. The mapping happens at the call site rather than by
 * renaming a reader's field, so a surface writes `accountId: vpc.ownerId` and
 * the compiler checks it.
 */
export interface StatedPlacement {
  /** From the resource's own ARN, or null where AWS returned none. */
  partition: string | null
  /** From the resource's own ARN, or null where AWS returned none. */
  region: string | null
  /** From the resource's own ARN — `ownerId` on the EC2 readings. */
  accountId: string | null
}

/** A context to link from, or the reason there is not one. */
export type ConsoleContextOutcome =
  | { state: "CONTEXT"; context: ConsoleContext }
  | { state: "NO_LINK"; because: string }

/** A stated value, or null. A blank string is not a placement. */
function statedValue(value: string | null): string | null {
  if (value === null) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Reconcile what a reading says about where its resource is with the resolved
 * identity, and produce the context to build its link from.
 *
 * The two fields are not treated the same way, and the difference is the whole
 * point of this function:
 *
 *   * **The REGION and PARTITION may legitimately differ from the identity's.**
 *     An estate is not one region. A GuardDuty finding in `us-east-1` read by a
 *     console whose identity resolved `eu-west-2` is a real finding, and the
 *     link that opens it is the `us-east-1` one. Refusing it would hide a
 *     resource that exists; building it against the identity's region would open
 *     an empty page and read as "the finding is gone". So a stated region wins —
 *     and it is still not a literal, because the reader took it off the
 *     resource's own ARN and falls back to the identity when there was none.
 *   * **The ACCOUNT may not.** A reading whose account is not the account this
 *     engine resolved is a reading from somewhere this link has no business
 *     pointing at, and a link to the wrong account is worse than no link.
 *
 * A stated partition and a stated region that disagree with each other are not
 * checked here on purpose: `render` already refuses that combination, with the
 * sentence that names both, and one check in one place cannot drift from itself.
 */
export function consoleContextForReading(
  identity: ConsoleContext,
  placement: StatedPlacement,
): ConsoleContextOutcome {
  const identityAccount = identity.accountId.trim()
  if (!identityAccount) {
    return {
      state: "NO_LINK",
      because:
        "the identity did not resolve to an account, so there is no account to open this in. " +
        "A console link built without one opens whichever account the browser is already signed into.",
    }
  }

  const account = statedValue(placement.accountId)
  if (account && account !== identityAccount) {
    return {
      state: "NO_LINK",
      because:
        `this resource is in account ${account} and the resolved identity is account ` +
        `${identityAccount}. A link to the wrong account is worse than no link.`,
    }
  }

  return {
    state: "CONTEXT",
    context: {
      partition: statedValue(placement.partition) ?? identity.partition,
      region: statedValue(placement.region) ?? identity.region,
      accountId: identityAccount,
    },
  }
}

/**
 * The deep link for a reading, from the reading's own placement.
 *
 * The call a surface should make. Doing it in one step is what stops the
 * reconcile above being the step somebody forgets — a surface that passes the
 * identity's context straight to `resourceConsoleLink` for a resource in another
 * region gets a URL that opens an empty page, and nothing about that URL looks
 * wrong.
 */
export function resourceConsoleLinkForReading(
  identity: ConsoleContext,
  placement: StatedPlacement,
  resource: ConsoleResource,
): ConsoleLinkOutcome {
  const reconciled = consoleContextForReading(identity, placement)
  if (reconciled.state === "NO_LINK") {
    return { state: "NO_LINK", because: `no console link for this ${resource.kind}: ${reconciled.because}` }
  }
  return resourceConsoleLinkOutcome(reconciled.context, resource)
}

/* --------------------------------------------------------------- the API -- */

/**
 * A console URL for a service's home page, or null when this partition has no
 * console we can name.
 *
 * Null rather than a guess. Every caller renders "no console link for partition
 * X" for null, which is a true statement; a guessed URL is a false one.
 */
export function consoleLink(target: ConsoleTarget): string | null {
  const outcome = consoleLinkOutcome(target)
  return outcome.state === "LINK" ? outcome.url : null
}

/**
 * The same, with the reason when there is no link.
 *
 * `consoleLink` is the older, narrower signature and is kept because a caller
 * that only renders a button does not need a sentence. A caller that renders
 * the absence should use this one — "no link, and here is why" is the shape
 * every other unknown in this directory takes.
 *
 * The account is not part of `ConsoleTarget` and a service home page does not
 * need one, so this synthesises a context whose `accountId` is empty. No arm
 * reached from here reads it: `SERVICE_HOMES` entries carry no ARN.
 */
export function consoleLinkOutcome(target: ConsoleTarget): ConsoleLinkOutcome {
  const spec = SERVICE_HOMES[target.service]
  if (!spec) {
    return { state: "NO_LINK", because: `no console page is named for "${target.service}".` }
  }
  return render({ partition: target.partition, region: target.region, accountId: "" }, spec)
}

/**
 * A console URL for one specific resource, or null.
 *
 * The deep link. Every identifier comes from a reader in this directory, and
 * every refusal is a refusal rather than a guess — see the four rules at the
 * top of this file.
 */
export function resourceConsoleLink(
  context: ConsoleContext,
  resource: ConsoleResource,
): string | null {
  const outcome = resourceConsoleLinkOutcome(context, resource)
  return outcome.state === "LINK" ? outcome.url : null
}

/** The same, with the sentence a surface prints when there is no link. */
export function resourceConsoleLinkOutcome(
  context: ConsoleContext,
  resource: ConsoleResource,
): ConsoleLinkOutcome {
  const spec = specFor(context, resource)
  if ("because" in spec) {
    return { state: "NO_LINK", because: `no console link for this ${resource.kind}: ${spec.because}` }
  }
  return render(context, spec)
}

/**
 * The sentence that must accompany every console link.
 *
 * Exported rather than written at each call site so it cannot be dropped from
 * one of them — a link without it is a link that looks like part of the product.
 */
export function consoleCaveat(accountId: string): string {
  return (
    `Read-only view of account ${accountId}. Actions taken here are outside Tenure's audit: ` +
    `nothing done in the AWS console appears in this engine's evidence, and no approval gate applies to it.`
  )
}
