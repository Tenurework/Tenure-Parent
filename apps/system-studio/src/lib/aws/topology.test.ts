import { ENHANCED_SCANNING_NOT_READABLE } from "./ecr"
import { ECS_STOPPED_WINDOW } from "./containers"
import { __resetIdentity } from "./identity"
import {
  ACCOUNT_ROLES,
  EDGE_WORD,
  ESTATE_SCALES,
  LATENT_EDGE_KINDS,
  NO_DEPLOY_WINDOW,
  PATH_EDGE_KINDS,
  describeEdge,
  describeReach,
  describeRole,
  isLatentEdge,
  isPathEdge,
  parseImageReference,
  reconcileTopology,
  requiredAt,
  roleFor,
  s3BucketFromOrigin,
  tenantWiring,
  wiringAttribution,
  wiringLines,
  wiringReadings,
  type DeployWindow,
  type EstateScale,
  type ObservedAccount,
  type WiringEdgeKind,
  type WiringReadings,
} from "./topology"

import type { S3Readings, BucketReading } from "./buckets"
import type { Capability } from "./capabilities"
import type { CdnReadings, DistributionReading, DistributionConfigReading, OriginReading } from "./cdn"
import type { CertificateReadings, CertificateReading, CertificateDetail } from "./certificates"
import type {
  ClusterReading,
  ContainerReadings,
  ServiceReading,
  TaskReading,
  TaskDefinitionReading,
} from "./containers"
import type { DatabaseReadings } from "./database"
import type {
  DistributionTarget,
  DnsReadings,
  LoadBalancerTarget,
  PointerReading,
  RecordSet,
  ZoneReading,
} from "./dns"
import type { DynamoDbReadings, TableReading } from "./dynamodb-tables"
import type { EcrReadings, ImageReading, RepositoryReading } from "./ecr"
import type { Identity } from "./identity"
import type {
  ListenerReading,
  LoadBalancerReading,
  LoadBalancerReadings,
  ServingState,
  TargetGroupReading,
} from "./loadbalancer"
import type { AwsGateway, AwsRead } from "./read"
import type { SecretsReadings, SecretReading } from "./secrets"
import type { SqsReadings } from "./sqs"

/**
 * STUDIO-080-001 — the wiring graph, and the broken edge it exists to surface.
 *
 * Three rules govern every case below, and each is a lesson this programme has
 * already paid for.
 *
 *   1. **It drives the production function.** Every case calls `tenantWiring`,
 *      the exported entry point, over the whole-reading shapes the eleven readers
 *      actually return. A test that exercised a private helper would stay green
 *      the day the traversal stopped calling it.
 *   2. **`absent` and `unknown` must be provably different.** Half the cases here
 *      are pairs: the same estate with a read that ANSWERED and did not contain
 *      the far side, then with a read that was REFUSED. The first must be a break
 *      and the second must never be one. That is the whole point of the module,
 *      and a suite that only tested the happy path would not notice it invert.
 *   3. **Nothing here is a real resource.** `123456789012` is AWS's own
 *      documentation account id, every domain is an RFC 2606 reserved name, and
 *      the distribution ids, load balancer names, digests and certificate ARNs
 *      correspond to nothing that exists. No approval, review or verification is
 *      asserted anywhere.
 */

/* --------------------------------------------------------------- fixtures */

const NOW = new Date("2026-08-13T00:00:00.000Z")
const AS_OF = NOW.toISOString()
const ACCOUNT = "123456789012"
const SLUG = "riverbend-academy"
const OTHER_SLUG = "coastal-college"
const HOST = "riverbend.example.com"
const DISTRIBUTION_DOMAIN = "d111111abcdef8.cloudfront.net"
const LB_DNS = "tenure-alb-1234567890.us-east-1.elb.amazonaws.com"
const LB_ARN = `arn:aws:elasticloadbalancing:us-east-1:${ACCOUNT}:loadbalancer/app/tenure-alb/50dc6c495c0c9188`
const TG_ARN = `arn:aws:elasticloadbalancing:us-east-1:${ACCOUNT}:targetgroup/tenure-app/73e2d6bc24d8a067`
const LISTENER_ARN = `${LB_ARN.replace(":loadbalancer/", ":listener/")}/f2f7dc8efc522ab2`
const CERT_ARN = `arn:aws:acm:us-east-1:${ACCOUNT}:certificate/12345678-1234-1234-1234-123456789012`
const CLUSTER_ARN = `arn:aws:ecs:us-east-1:${ACCOUNT}:cluster/tenure-prod`
const SERVICE_ARN = `arn:aws:ecs:us-east-1:${ACCOUNT}:service/tenure-prod/tenure-app`
const TASK_DEF_ARN = `arn:aws:ecs:us-east-1:${ACCOUNT}:task-definition/tenure-app:41`
const TASK_ARN = `arn:aws:ecs:us-east-1:${ACCOUNT}:task/tenure-prod/9f0e1d2c3b4a5968`
const REGISTRY = `${ACCOUNT}.dkr.ecr.us-east-1.amazonaws.com`
const IMAGE = `${REGISTRY}/tenure-app:2026.08.13`
const DIGEST = "sha256:1111111111111111111111111111111111111111111111111111111111111111"

const IDENTITY: AwsRead<Identity> = {
  state: "ACTUAL",
  capability: "sts:GetCallerIdentity",
  value: {
    accountId: ACCOUNT,
    arn: `arn:aws:iam::${ACCOUNT}:role/tenure-system-studio`,
    partition: "aws",
    region: "us-east-1",
  },
  asOf: AS_OF,
  fresh: true,
}

function actual<T>(capability: Capability, value: T): AwsRead<T> {
  return { state: "ACTUAL", capability, value, asOf: AS_OF, fresh: true }
}

function empty<T>(capability: Capability): AwsRead<T> {
  return { state: "EMPTY", capability, asOf: AS_OF }
}

function denied<T>(capability: Capability, action: string): AwsRead<T> {
  return {
    state: "DENIED",
    capability,
    action,
    principal: `arn:aws:iam::${ACCOUNT}:role/tenure-system-studio`,
    accountId: ACCOUNT,
    region: "us-east-1",
    partition: "aws",
    errorCode: "AccessDeniedException",
    minimumStatement: `{"Effect":"Allow","Action":["${action}"],"Resource":"*"}`,
  }
}

const TAGGED = empty<readonly never[]>("tag:GetResources")

const MINE = { kind: "tenant", tenantSlug: SLUG } as const
const THEIRS = { kind: "tenant", tenantSlug: OTHER_SLUG } as const
const UNTAGGED = { kind: "unattributed" } as const

/* ------------------------------------------------------------------- DNS */

function pointer(overrides: Partial<PointerReading> = {}): PointerReading {
  return {
    raw: DISTRIBUTION_DOMAIN,
    dnsName: DISTRIBUTION_DOMAIN,
    via: "alias",
    service: "cloudfront",
    ownership: {
      kind: "owned",
      what: "CloudFront distribution E1EXAMPLE",
      evidence: `cloudfront:ListDistributions returned ${DISTRIBUTION_DOMAIN} as distribution E1EXAMPLE`,
    },
    ...overrides,
  }
}

function record(p: PointerReading | null): RecordSet {
  return {
    name: `${HOST}.`,
    normalisedName: HOST,
    type: "A",
    setIdentifier: null,
    ttlSeconds: null,
    values: [],
    alias: { hostedZoneId: "Z2FDTNDATAQYW2", evaluateTargetHealth: false },
    pointer: p,
    weight: null,
    latencyRegion: null,
    failover: null,
    healthCheckId: null,
  }
}

function zone(records: AwsRead<readonly RecordSet[]>): ZoneReading {
  return {
    id: "Z0EXAMPLE1",
    arn: "arn:aws:route53:::hostedzone/Z0EXAMPLE1",
    arnProvenance: "assembled from the partition in the resolved identity's ARN",
    name: "example.com.",
    normalisedName: "example.com",
    privateZone: false,
    comment: null,
    declaredRecordCount: 1,
    records,
    pagination: { kind: "complete", pages: 1, items: 1 },
    delegation: { kind: "unknown", why: "not exercised by this fixture" },
    attribution: MINE,
    region: null,
    partition: "aws",
    refreshMs: 300_000,
    asOf: AS_OF,
  }
}

const DISTRIBUTION_TARGET: DistributionTarget = {
  id: "E1EXAMPLE",
  arn: `arn:aws:cloudfront::${ACCOUNT}:distribution/E1EXAMPLE`,
  domainName: DISTRIBUTION_DOMAIN,
  aliases: [HOST],
  enabled: true,
  status: "Deployed",
}

const LB_TARGET: LoadBalancerTarget = {
  arn: LB_ARN,
  name: "tenure-alb",
  dnsName: LB_DNS,
  scheme: "internet-facing",
  state: "active",
}

function dnsFixture(overrides: Partial<DnsReadings> = {}): DnsReadings {
  return {
    identity: IDENTITY,
    tagged: TAGGED,
    zones: actual<readonly ZoneReading[]>("route53:ListHostedZones", [
      zone(actual<readonly RecordSet[]>("route53:ListResourceRecordSets", [record(pointer())])),
    ]),
    zonePagination: { kind: "complete", pages: 1, items: 1 },
    distributions: actual<readonly DistributionTarget[]>("cloudfront:ListDistributions", [
      DISTRIBUTION_TARGET,
    ]),
    distributionPagination: { kind: "complete", pages: 1, items: 1 },
    loadBalancers: actual<readonly LoadBalancerTarget[]>(
      "elasticloadbalancing:DescribeLoadBalancers",
      [LB_TARGET],
    ),
    loadBalancerPagination: { kind: "complete", pages: 1, items: 1 },
    takeover: { kind: "clear", pointersChecked: 1, unverified: [] },
    asOf: AS_OF,
    refreshMs: { zones: 300_000, records: 300_000, distributions: 300_000, loadBalancers: 300_000 },
    ...overrides,
  }
}

/* ------------------------------------------------------------------- CDN */

function origin(domainName: string, id = "alb-origin"): OriginReading {
  return {
    id,
    domainName,
    originPath: null,
    protocol: { kind: "tls", policy: "https-only", sslProtocols: ["TLSv1.2"] },
  }
}

function distributionConfig(origins: readonly OriginReading[]): DistributionConfigReading {
  return {
    comment: "tenure edge",
    enabled: true,
    aliases: [HOST],
    defaultRootObject: null,
    origins,
    tls: {
      kind: "modern",
      version: "TLSv1.2_2021",
      certificateSource: { kind: "acm", arn: CERT_ARN, sslSupportMethod: "sni-only" },
    },
    waf: { kind: "associated", webAclId: "arn:aws:wafv2::web-acl/tenure", why: "WebACLId was set" },
    behaviours: [],
    logging: { kind: "disabled", why: "AWS reported Enabled=false" },
    geo: { kind: "none", why: "RestrictionType was none" },
    priceClass: "PriceClass_100",
    httpVersion: "http2",
    ipv6Enabled: true,
  }
}

function distribution(
  overrides: Partial<DistributionReading> = {},
  origins: readonly OriginReading[] = [origin(LB_DNS)],
): DistributionReading {
  return {
    id: "E1EXAMPLE",
    arn: `arn:aws:cloudfront::${ACCOUNT}:distribution/E1EXAMPLE`,
    domainName: DISTRIBUTION_DOMAIN,
    status: "Deployed",
    enabled: true,
    aliases: [HOST],
    lastModifiedAt: AS_OF,
    region: null,
    whyNoRegion: "CloudFront is partition-global; its ARNs carry an empty region segment",
    partition: "aws",
    attribution: MINE,
    config: actual<DistributionConfigReading>(
      "cloudfront:GetDistributionConfig",
      distributionConfig(origins),
    ),
    invalidations: denied("cloudfront:ListInvalidations", "cloudfront:ListInvalidations"),
    invalidationBacklog: { kind: "unknown", why: "cloudfront:ListInvalidations was refused" },
    invalidationTruncation: { kind: "complete" },
    refreshMs: { config: 300_000, invalidations: 300_000 },
    asOf: AS_OF,
    ...overrides,
  }
}

function cdnFixture(overrides: Partial<CdnReadings> = {}): CdnReadings {
  return {
    identity: IDENTITY,
    tagged: TAGGED,
    distributions: actual<readonly DistributionReading[]>("cloudfront:ListDistributions", [
      distribution(),
    ]),
    truncation: { kind: "complete" },
    exposure: { kind: "clear", distributionsRead: 1 },
    findings: [],
    invalidationsInFlight: [],
    asOf: AS_OF,
    refreshMs: { distributions: 300_000, config: 300_000, invalidations: 300_000 },
    ...overrides,
  }
}

/* --------------------------------------------------------- load balancer */

function listener(overrides: Partial<ListenerReading> = {}): ListenerReading {
  return {
    arn: LISTENER_ARN,
    loadBalancerArn: LB_ARN,
    port: 443,
    protocol: "HTTPS",
    tls: {
      kind: "terminates-tls",
      protocol: "HTTPS",
      certificateArns: [CERT_ARN],
      sslPolicy: "ELBSecurityPolicy-TLS13-1-2-2021-06",
    },
    certificates: [{ arn: CERT_ARN, isDefault: null }],
    sslPolicy: "ELBSecurityPolicy-TLS13-1-2-2021-06",
    defaultActionTypes: ["forward"],
    forwardsTo: [TG_ARN],
    refreshMs: 300_000,
    asOf: AS_OF,
    ...overrides,
  }
}

const ALL_SERVING: ServingState = { kind: "all-serving", healthy: 2 }

function targetGroup(overrides: Partial<TargetGroupReading> = {}): TargetGroupReading {
  return {
    arn: TG_ARN,
    name: "tenure-app",
    protocol: "HTTP",
    port: 3000,
    vpcId: "vpc-0123456789abcdef0",
    targetType: "ip",
    protocolVersion: "HTTP1",
    loadBalancerArns: [LB_ARN],
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
    attribution: MINE,
    health: empty("elasticloadbalancing:DescribeTargetHealth"),
    serving: ALL_SERVING,
    refreshMs: 60_000,
    asOf: AS_OF,
    ...overrides,
  }
}

function loadBalancer(overrides: Partial<LoadBalancerReading> = {}): LoadBalancerReading {
  return {
    arn: LB_ARN,
    name: "tenure-alb",
    type: "application",
    scheme: { kind: "internet-facing" },
    dnsName: LB_DNS,
    vpcId: "vpc-0123456789abcdef0",
    stateCode: "active",
    stateReason: null,
    availabilityZones: ["us-east-1a", "us-east-1b"],
    subnetIds: ["subnet-0a", "subnet-0b"],
    securityGroupIds: ["sg-0123456789abcdef0"],
    ipAddressType: "ipv4",
    createdAt: AS_OF,
    region: "us-east-1",
    partition: "aws",
    accountId: ACCOUNT,
    attribution: MINE,
    listeners: actual<readonly ListenerReading[]>("elasticloadbalancing:DescribeListeners", [
      listener(),
    ]),
    targetGroups: actual<readonly TargetGroupReading[]>(
      "elasticloadbalancing:DescribeTargetGroups",
      [targetGroup()],
    ),
    refreshMs: 300_000,
    asOf: AS_OF,
    ...overrides,
  }
}

function lbFixture(overrides: Partial<LoadBalancerReadings> = {}): LoadBalancerReadings {
  return {
    identity: IDENTITY,
    tagged: TAGGED,
    loadBalancers: actual<readonly LoadBalancerReading[]>(
      "elasticloadbalancing:DescribeLoadBalancers",
      [loadBalancer()],
    ),
    findings: [],
    truncation: { kind: "complete" },
    asOf: AS_OF,
    refreshMs: {
      loadBalancers: 300_000,
      listeners: 300_000,
      targetGroups: 300_000,
      targetHealth: 60_000,
      rules: 300_000,
    },
    ...overrides,
  }
}

/* ------------------------------------------------------------- containers */

function taskDefinition(): TaskDefinitionReading {
  return {
    arn: TASK_DEF_ARN,
    family: "tenure-app",
    revision: 41,
    status: "ACTIVE",
    cpu: "1024",
    memory: "2048",
    networkMode: "awsvpc",
    taskRoleArn: `arn:aws:iam::${ACCOUNT}:role/tenure-app-task`,
    executionRoleArn: `arn:aws:iam::${ACCOUNT}:role/tenure-app-execution`,
    requiresCompatibilities: ["FARGATE"],
    registeredAt: AS_OF,
    containers: [
      {
        name: "app",
        image: IMAGE,
        cpu: 1024,
        memory: 2048,
        memoryReservation: null,
        essential: true,
        logConfiguration: {
          kind: "configured",
          driver: "awslogs",
          logGroup: "/ecs/tenure-app",
          logRegion: "us-east-1",
          streamPrefix: "ecs",
          otherOptionNames: [],
          secretOptionNames: [],
        },
        secretNames: ["DATABASE_URL"],
        environmentNames: ["NODE_ENV"],
        credentialLookingEnvironmentNames: [],
      },
    ],
    declaresSecrets: true,
    declaresPlainTextEnvironment: true,
    credentialFindings: [],
  }
}

function task(imageDigest: string | null = DIGEST, image: string | null = IMAGE): TaskReading {
  return {
    arn: TASK_ARN,
    taskDefinitionArn: TASK_DEF_ARN,
    group: "service:tenure-app",
    lastStatus: "RUNNING",
    desiredStatus: "RUNNING",
    healthStatus: "HEALTHY",
    cpu: "1024",
    memory: "2048",
    launchType: "FARGATE",
    capacityProviderName: "FARGATE",
    availabilityZone: "us-east-1a",
    connectivity: "CONNECTED",
    startedBy: "ecs-svc/1234567890123456789",
    stopCode: null,
    createdAt: AS_OF,
    startedAt: AS_OF,
    stoppedAt: null,
    stopCause: { kind: "unreported", why: "the task is running; ECS reported no stoppedReason" },
    containers: [
      {
        name: "app",
        image,
        imageDigest,
        lastStatus: "RUNNING",
        exitCode: null,
        reason: null,
        healthStatus: "HEALTHY",
      },
    ],
  }
}

function service(overrides: Partial<ServiceReading> = {}): ServiceReading {
  return {
    name: "tenure-app",
    arn: SERVICE_ARN,
    clusterArn: CLUSTER_ARN,
    status: "ACTIVE",
    desiredCount: 2,
    runningCount: 2,
    pendingCount: 0,
    launchType: "FARGATE",
    taskDefinitionArn: TASK_DEF_ARN,
    healthCheckGracePeriodSeconds: 60,
    targetGroupArns: [TG_ARN],
    deployments: [],
    attribution: MINE,
    taskDefinition: actual<TaskDefinitionReading>(
      "ecs:DescribeTaskDefinition",
      taskDefinition(),
    ),
    gap: { kind: "none", desired: 2, running: 2 },
    ...overrides,
  }
}

function cluster(overrides: Partial<ClusterReading> = {}): ClusterReading {
  return {
    arn: CLUSTER_ARN,
    name: "tenure-prod",
    region: "us-east-1",
    partition: "aws",
    attribution: MINE,
    detail: denied("ecs:DescribeClusters", "ecs:DescribeClusters"),
    services: actual<readonly ServiceReading[]>("ecs:DescribeServices", [service()]),
    serviceTruncation: { kind: "complete" },
    runningTasks: actual<readonly TaskReading[]>("ecs:DescribeTasks", [task()]),
    runningTaskTruncation: { kind: "complete" },
    stoppedTasks: empty("ecs:DescribeTasks"),
    stoppedTaskTruncation: { kind: "complete" },
    stoppedWindow: ECS_STOPPED_WINDOW,
    failures: [],
    asOf: AS_OF,
    ...overrides,
  }
}

function containerFixture(overrides: Partial<ContainerReadings> = {}): ContainerReadings {
  return {
    identity: IDENTITY,
    tagged: TAGGED,
    clusters: actual<readonly ClusterReading[]>("ecs:ListClusters", [cluster()]),
    truncation: { kind: "complete" },
    fleet: { kind: "steady", clusters: 1, services: 1, runningTasks: 1 },
    credentialFindings: [],
    asOf: AS_OF,
    refreshMs: {
      clusters: 300_000,
      clusterDetail: 300_000,
      services: 60_000,
      tasks: 60_000,
      taskDefinition: 3_600_000,
    },
    ...overrides,
  }
}

/* -------------------------------------------------------------------- ECR */

function image(digest: string): ImageReading {
  return {
    digest,
    repositoryName: "tenure-app",
    tags: ["2026.08.13"],
    pushedAt: AS_OF,
    sizeBytes: 120_000_000,
    artifactMediaType: "application/vnd.docker.container.image.v1+json",
    manifestMediaType: "application/vnd.docker.distribution.manifest.v2+json",
    lastPulledAt: AS_OF,
    vulnerability: { kind: "clean", completedAt: AS_OF, source: "summary" },
    scanDetail: denied("ecr:DescribeImageScanFindings", "ecr:DescribeImageScanFindings"),
  }
}

function repository(overrides: Partial<RepositoryReading> = {}): RepositoryReading {
  return {
    name: "tenure-app",
    arn: `arn:aws:ecr:us-east-1:${ACCOUNT}:repository/tenure-app`,
    registryId: ACCOUNT,
    uri: `${REGISTRY}/tenure-app`,
    createdAt: AS_OF,
    region: "us-east-1",
    partition: "aws",
    tagMutability: { kind: "immutable" },
    scanOnPush: { kind: "enabled" },
    encryptionType: "AES256",
    attribution: MINE,
    images: actual<readonly ImageReading[]>("ecr:DescribeImages", [image(DIGEST)]),
    imageTruncation: { kind: "complete" },
    lifecycle: actual("ecr:GetLifecyclePolicy", {
      kind: "absent",
      why: "AWS answered LifecyclePolicyNotFoundException",
    }),
    refreshMs: { images: 300_000, scan: 300_000, lifecycle: 3_600_000 },
    asOf: AS_OF,
    ...overrides,
  }
}

function ecrFixture(overrides: Partial<EcrReadings> = {}): EcrReadings {
  return {
    identity: IDENTITY,
    tagged: TAGGED,
    repositories: actual<readonly RepositoryReading[]>("ecr:DescribeRepositories", [repository()]),
    truncation: { kind: "complete" },
    deployedRisk: { kind: "clear", repositoriesScanned: 1, imagesScanned: 1 },
    tagCollisions: [],
    enhancedScanning: ENHANCED_SCANNING_NOT_READABLE,
    asOf: AS_OF,
    refreshMs: { repositories: 300_000, images: 300_000, scan: 300_000, lifecycle: 3_600_000 },
    ...overrides,
  }
}

/* ----------------------------------------------------------- certificates */

function certificateDetail(notAfter: string): CertificateDetail {
  return {
    arn: CERT_ARN,
    domainName: HOST,
    subjectAlternativeNames: [HOST],
    status: "ISSUED",
    type: "AMAZON_ISSUED",
    keyAlgorithm: "RSA-2048",
    inUseBy: [LB_ARN],
    validation: { kind: "validated", domains: [HOST] },
    renewal: { kind: "eligible", why: "outside the 60-day renewal window" },
    expiry: {
      kind: "expires",
      notAfter,
      daysRemaining: Math.round((Date.parse(notAfter) - NOW.getTime()) / 86_400_000),
    },
    renewalEligibility: "ELIGIBLE",
    notBefore: "2026-06-01T00:00:00.000Z",
    notAfter,
    createdAt: "2026-06-01T00:00:00.000Z",
    issuedAt: "2026-06-01T00:00:00.000Z",
    importedAt: null,
    revokedAt: null,
    revocationReason: null,
    failureReason: null,
  }
}

function certificate(overrides: Partial<CertificateReading> = {}): CertificateReading {
  return {
    arn: CERT_ARN,
    domainName: HOST,
    listedStatus: "ISSUED",
    region: "us-east-1",
    partition: "aws",
    accountId: ACCOUNT,
    attribution: MINE,
    detail: actual<CertificateDetail>(
      "acm:DescribeCertificate",
      certificateDetail("2026-11-01T00:00:00.000Z"),
    ),
    refreshMs: 3_600_000,
    asOf: AS_OF,
    ...overrides,
  }
}

function certificateFixture(overrides: Partial<CertificateReadings> = {}): CertificateReadings {
  return {
    identity: IDENTITY,
    tagged: TAGGED,
    certificates: actual<readonly CertificateReading[]>("acm:ListCertificates", [certificate()]),
    pages: { kind: "complete", pagesRead: 1, certificatesRead: 1 },
    stuckValidation: { kind: "none", certificatesRead: 1, unreadable: [] },
    renewalRisk: { kind: "none", certificatesRead: 1, horizonDays: 60, unreadable: [] },
    asOf: AS_OF,
    refreshMs: { certificates: 300_000, detail: 3_600_000 },
    ...overrides,
  }
}

/* ------------------------------------------------------------- data plane */

function databaseFixture(): DatabaseReadings {
  return {
    identity: IDENTITY,
    tagged: TAGGED,
    instances: denied("rds:DescribeDBInstances", "rds:DescribeDBInstances"),
    pendingMaintenance: denied(
      "rds:DescribePendingMaintenanceActions",
      "rds:DescribePendingMaintenanceActions",
    ),
    parameterGroups: denied("rds:DescribeDBParameterGroups", "rds:DescribeDBParameterGroups"),
    snapshots: denied("rds:DescribeDBSnapshots", "rds:DescribeDBSnapshots"),
    outage: { kind: "unknown", why: "rds:DescribeDBInstances was refused" },
    truncation: {
      instances: { kind: "not-read", why: "refused" },
      pendingMaintenance: { kind: "not-read", why: "refused" },
      parameterGroups: { kind: "not-read", why: "refused" },
      snapshots: { kind: "not-read", why: "refused" },
    },
    asOf: AS_OF,
    refreshMs: {
      instances: 300_000,
      pendingMaintenance: 300_000,
      events: 300_000,
      parameterGroups: 3_600_000,
      snapshots: 300_000,
    },
  }
}

function table(name: string, attribution: TableReading["attribution"]): TableReading {
  return {
    name,
    arn: `arn:aws:dynamodb:us-east-1:${ACCOUNT}:table/${name}`,
    arnProvenance: "assembled from the resolved identity's partition, region and account",
    region: "us-east-1",
    partition: "aws",
    accountId: ACCOUNT,
    isTenantRegistry: false,
    attribution,
    detail: denied("dynamodb:DescribeTable", "dynamodb:DescribeTable"),
    backups: denied("dynamodb:DescribeContinuousBackups", "dynamodb:DescribeContinuousBackups"),
    ttl: denied("dynamodb:DescribeTimeToLive", "dynamodb:DescribeTimeToLive"),
    keyManagement: denied("kms:DescribeKey", "kms:DescribeKey"),
    refreshMs: 300_000,
    asOf: AS_OF,
  }
}

function tableFixture(tables: readonly TableReading[]): DynamoDbReadings {
  return {
    identity: IDENTITY,
    tagged: TAGGED,
    tables: actual<readonly TableReading[]>("dynamodb:ListTables", tables),
    more: { kind: "complete" },
    registry: { kind: "unnamed", why: "TENANT_TABLE is unset in this fixture" },
    registryTableName: null,
    asOf: AS_OF,
    refreshMs: {
      tables: 300_000,
      detail: 300_000,
      backups: 300_000,
      ttl: 300_000,
      keyManagement: 300_000,
    },
  }
}

function bucket(name: string, attribution: BucketReading["attribution"]): BucketReading {
  return {
    name,
    arn: `arn:aws:s3:::${name}`,
    partition: "aws",
    region: { kind: "stated", region: "us-east-1" },
    createdAt: AS_OF,
    attribution,
    attributionSource: "the Resource Groups Tagging API index",
    publicAccessBlock: denied("s3:GetBucketPublicAccessBlock", "s3:GetBucketPublicAccessBlock"),
    policyStatus: denied("s3:GetBucketPolicyStatus", "s3:GetBucketPolicyStatus"),
    encryption: denied("s3:GetBucketEncryption", "s3:GetBucketEncryption"),
    versioning: denied("s3:GetBucketVersioning", "s3:GetBucketVersioning"),
    lifecycle: denied("s3:GetBucketLifecycleConfiguration", "s3:GetBucketLifecycleConfiguration"),
    tags: denied("s3:GetBucketTagging", "s3:GetBucketTagging"),
    cors: denied("s3:GetBucketCors", "s3:GetBucketCors"),
    refreshMs: 300_000,
    asOf: AS_OF,
  }
}

function bucketFixture(buckets: readonly BucketReading[]): S3Readings {
  return {
    identity: IDENTITY,
    tagged: TAGGED,
    buckets: actual<readonly BucketReading[]>("s3:ListBuckets", buckets),
    publicExposure: { kind: "none-observed", bucketsRead: buckets.length, partiallyUnread: [] },
    listing: { kind: "complete", bucketsListed: buckets.length, pagesRead: 1 },
    asOf: AS_OF,
    refreshMs: { buckets: 300_000, posture: 300_000 },
  }
}

function queueFixture(): SqsReadings {
  return {
    identity: IDENTITY,
    tagged: TAGGED,
    queues: empty<readonly never[]>("sqs:ListQueues"),
    deadLetters: { kind: "unknown", why: "sqs:ListQueues returned nothing to assess" },
    asOf: AS_OF,
    refreshMs: { queues: 300_000, depth: 60_000 },
  }
}

function secret(name: string, attribution: SecretReading["attribution"]): SecretReading {
  return {
    name,
    arn: `arn:aws:secretsmanager:us-east-1:${ACCOUNT}:secret:${name}-AbCdEf`,
    arnProvenance: "AWS's own ARN from ListSecrets",
    region: "us-east-1",
    partition: "aws",
    accountId: ACCOUNT,
    attribution,
    encryption: { kind: "aws-managed", why: "no KmsKeyId was returned" },
    rotation: { kind: "not-configured", why: "RotationEnabled was false" },
    age: { kind: "no-interval", why: "rotation is off, so there is no interval to be past" },
    deletion: { kind: "active" },
    createdAt: AS_OF,
    lastChangedAt: AS_OF,
    lastRotatedAt: null,
    lastAccessedAt: AS_OF,
    owningService: null,
    detail: denied("secretsmanager:DescribeSecret", "secretsmanager:DescribeSecret"),
    refreshMs: 300_000,
    asOf: AS_OF,
  }
}

function secretFixture(secrets: readonly SecretReading[]): SecretsReadings {
  return {
    identity: IDENTITY,
    tagged: TAGGED,
    secrets: actual<readonly SecretReading[]>("secretsmanager:ListSecrets", secrets),
    pagination: { kind: "complete", pages: 1, secrets: secrets.length },
    posture: { kind: "unknown", why: "the details were refused in this fixture" },
    asOf: AS_OF,
    refreshMs: { inventory: 300_000, detail: 300_000 },
  }
}

/* ---------------------------------------------------------- the whole load */

function readings(overrides: Partial<WiringReadings> = {}): WiringReadings {
  return {
    dns: dnsFixture(),
    cdn: cdnFixture(),
    loadBalancers: lbFixture(),
    containers: containerFixture(),
    ecr: ecrFixture(),
    certificates: certificateFixture(),
    databases: databaseFixture(),
    tables: tableFixture([table("tenure-riverbend-sessions", MINE)]),
    buckets: bucketFixture([bucket("tenure-riverbend-uploads", MINE)]),
    queues: queueFixture(),
    secrets: secretFixture([secret("tenure/riverbend/database", { ...MINE, source: "tag index" })]),
    asOf: AS_OF,
    ...overrides,
  }
}

const WINDOW_AFTER: DeployWindow = {
  nextDeployAt: "2026-09-01T00:00:00.000Z",
  provenance: "the release calendar row supplied by the caller",
}
const WINDOW_BEYOND_EXPIRY: DeployWindow = {
  nextDeployAt: "2026-12-01T00:00:00.000Z",
  provenance: "the release calendar row supplied by the caller",
}

function wire(
  overrides: Partial<WiringReadings> = {},
  deployWindow: DeployWindow = WINDOW_AFTER,
  hosts: readonly string[] = [HOST],
) {
  return tenantWiring({ slug: SLUG, hosts, readings: readings(overrides), deployWindow, now: NOW })
}

function edgesOfKind(
  wiring: ReturnType<typeof wire>,
  kind: WiringEdgeKind,
): ReturnType<typeof wire>["edges"] {
  return wiring.edges.filter((e) => e.kind === kind)
}

/* ==================================================== 1. the happy chain == */

describe("the whole path, when it holds", () => {
  test("walks host -> record -> distribution -> load balancer -> target group -> service -> task definition -> digest -> repository", () => {
    const wiring = wire()
    const kinds = wiring.edges.filter((e) => e.state === "present").map((e) => e.kind)

    for (const hop of [
      "host->dns-record",
      "dns-record->cloudfront-distribution",
      "cloudfront-distribution->load-balancer",
      "load-balancer->listener",
      "load-balancer->target-group",
      "listener->acm-certificate",
      "acm-certificate->deploy-window",
      "target-group->targets",
      "target-group->ecs-service",
      "ecs-service->task-definition",
      "task-definition->container-image",
      "container-image->ecr-repository",
    ] as const) {
      expect(kinds).toContain(hop)
    }
    expect(wiring.broken).toHaveLength(0)
  })

  test("every hop that is present names the read that proved it and the node it reached", () => {
    for (const e of wire().edges.filter((edge) => edge.state === "present")) {
      expect(e.why.length).toBeGreaterThan(0)
      // `target-group->targets` is the one documented exception: its far side is
      // a set of registered IPs, not a resource with an ARN.
      if (e.kind === "target-group->targets") {
        expect(e.why).toContain("healthy target")
        continue
      }
      expect(e.to).not.toBeNull()
    }
  })
})

/* ============================================== 2. the DNS alias that dangles */

describe("a DNS alias pointing at a distribution that does not exist", () => {
  const dangling = () =>
    wire({
      dns: dnsFixture({
        zones: actual<readonly ZoneReading[]>("route53:ListHostedZones", [
          zone(
            actual<readonly RecordSet[]>("route53:ListResourceRecordSets", [
              record(
                pointer({
                  ownership: {
                    kind: "dangling",
                    what: `CloudFront domain ${DISTRIBUTION_DOMAIN}`,
                    why:
                      "cloudfront:ListDistributions listed every distribution in this account and " +
                      "none of them serves that domain",
                  },
                }),
              ),
            ]),
          ),
        ]),
        distributions: empty<readonly DistributionTarget[]>("cloudfront:ListDistributions"),
      }),
    })

  test("is an ABSENT edge, not a missing row", () => {
    const wiring = dangling()
    const edge = edgesOfKind(wiring, "dns-record->cloudfront-distribution")[0]
    expect(edge.state).toBe("absent")
    expect(edge.to).toBeNull()
    expect(wiring.broken).toContain(edge)
  })

  test("makes the tenant's reach BROKEN rather than unverified", () => {
    expect(dangling().reach.kind).toBe("broken")
  })
})

/* ================================== 3. a refused index is NEVER a break === */

describe("unknown and absent are provably different", () => {
  const refused = () =>
    wire({
      dns: dnsFixture({
        zones: denied<readonly ZoneReading[]>("route53:ListHostedZones", "route53:ListHostedZones"),
      }),
    })

  test("a refused zone listing produces an unknown edge and NO break", () => {
    const wiring = refused()
    const edge = edgesOfKind(wiring, "host->dns-record")[0]
    expect(edge.state).toBe("unknown")
    expect(wiring.broken).toHaveLength(0)
    expect(wiring.unreadable).toContain(edge)
  })

  test("a refused chain is never reported as intact", () => {
    expect(refused().reach.kind).toBe("unverified")
  })

  test("the three states render provably different words", () => {
    const words = new Set(Object.values(EDGE_WORD))
    expect(words.size).toBe(3)
    expect(EDGE_WORD.absent).not.toContain(EDGE_WORD.unknown)
    expect(EDGE_WORD.present).not.toContain(EDGE_WORD.unknown)
  })

  test("an unknown edge names the capability that would answer it; an absent edge never does", () => {
    const unknownEdge = refused().unreadable[0]
    expect(describeEdge(unknownEdge)).toContain("Grant route53:ListResourceRecordSets")

    const brokenEdge = wire({
      containers: containerFixture({
        clusters: empty<readonly ClusterReading[]>("ecs:ListClusters"),
      }),
    }).broken.find((e) => e.kind === "target-group->ecs-service")
    expect(brokenEdge).toBeDefined()
    expect(describeEdge(brokenEdge!)).not.toContain("Grant ")
  })
})

/* ============================================ 4. the target group breaks == */

describe("a target group with no target the load balancer will route to", () => {
  test("no registered target at all is a break", () => {
    const wiring = wire({
      loadBalancers: lbFixture({
        loadBalancers: actual<readonly LoadBalancerReading[]>(
          "elasticloadbalancing:DescribeLoadBalancers",
          [
            loadBalancer({
              targetGroups: actual<readonly TargetGroupReading[]>(
                "elasticloadbalancing:DescribeTargetGroups",
                [
                  targetGroup({
                    serving: {
                      kind: "no-targets",
                      why: "DescribeTargetHealth returned an empty TargetHealthDescriptions",
                    },
                  }),
                ],
              ),
            }),
          ],
        ),
      }),
    })
    const edge = edgesOfKind(wiring, "target-group->targets")[0]
    expect(edge.state).toBe("absent")
    expect(edge.why).toContain("no target at all")
  })

  test("registered targets that are all unhealthy is a break naming each one", () => {
    const wiring = wire({
      loadBalancers: lbFixture({
        loadBalancers: actual<readonly LoadBalancerReading[]>(
          "elasticloadbalancing:DescribeLoadBalancers",
          [
            loadBalancer({
              targetGroups: actual<readonly TargetGroupReading[]>(
                "elasticloadbalancing:DescribeTargetGroups",
                [
                  targetGroup({
                    serving: {
                      kind: "none-serving",
                      notServing: [
                        {
                          targetId: "10.0.1.42",
                          port: 3000,
                          state: "unhealthy",
                          reasonCode: "Target.ResponseCodeMismatch",
                          description: "Health checks failed with these codes: [503]",
                        },
                      ],
                    },
                  }),
                ],
              ),
            }),
          ],
        ),
      }),
    })
    const edge = edgesOfKind(wiring, "target-group->targets")[0]
    expect(edge.state).toBe("absent")
    expect(edge.why).toContain("10.0.1.42:3000")
    expect(edge.why).toContain("Target.ResponseCodeMismatch")
  })

  test("health that could not be read is unknown, not a break", () => {
    const wiring = wire({
      loadBalancers: lbFixture({
        loadBalancers: actual<readonly LoadBalancerReading[]>(
          "elasticloadbalancing:DescribeLoadBalancers",
          [
            loadBalancer({
              targetGroups: actual<readonly TargetGroupReading[]>(
                "elasticloadbalancing:DescribeTargetGroups",
                [
                  targetGroup({
                    serving: {
                      kind: "unknown",
                      why: "elasticloadbalancing:DescribeTargetHealth was refused",
                    },
                  }),
                ],
              ),
            }),
          ],
        ),
      }),
    })
    const edge = edgesOfKind(wiring, "target-group->targets")[0]
    expect(edge.state).toBe("unknown")
    expect(wiring.broken).toHaveLength(0)
  })

  test("a listener forwarding to a target group the describe did not return is a break", () => {
    const orphanArn = `${TG_ARN}-deleted`
    const wiring = wire({
      loadBalancers: lbFixture({
        loadBalancers: actual<readonly LoadBalancerReading[]>(
          "elasticloadbalancing:DescribeLoadBalancers",
          [loadBalancer({ listeners: actual<readonly ListenerReading[]>(
            "elasticloadbalancing:DescribeListeners",
            [listener({ forwardsTo: [orphanArn] })],
          ) })],
        ),
      }),
    })
    const broken = wiring.broken.find((e) => e.why.includes(orphanArn))
    expect(broken).toBeDefined()
    expect(broken!.kind).toBe("load-balancer->target-group")
  })

  test("a target group no ECS service registers is a break", () => {
    const wiring = wire({
      containers: containerFixture({
        clusters: actual<readonly ClusterReading[]>("ecs:ListClusters", [
          cluster({
            services: actual<readonly ServiceReading[]>("ecs:DescribeServices", [
              service({ targetGroupArns: [] }),
            ]),
          }),
        ]),
      }),
    })
    const edge = edgesOfKind(wiring, "target-group->ecs-service")[0]
    expect(edge.state).toBe("absent")
    expect(edge.why).toContain("nothing puts tasks into it")
  })

  test("a cluster whose services were refused is unknown, not a break", () => {
    const wiring = wire({
      containers: containerFixture({
        clusters: actual<readonly ClusterReading[]>("ecs:ListClusters", [
          cluster({ services: denied("ecs:DescribeServices", "ecs:DescribeServices") }),
        ]),
      }),
    })
    const edge = edgesOfKind(wiring, "target-group->ecs-service")[0]
    expect(edge.state).toBe("unknown")
    expect(wiring.broken).toHaveLength(0)
  })
})

/* ================================= 5. the digest that ECR no longer holds = */

describe("the image a task is running", () => {
  test("a digest ECR does not hold is a break naming the digest", () => {
    const other = "sha256:2222222222222222222222222222222222222222222222222222222222222222"
    const wiring = wire({
      ecr: ecrFixture({
        repositories: actual<readonly RepositoryReading[]>("ecr:DescribeRepositories", [
          repository({
            images: actual<readonly ImageReading[]>("ecr:DescribeImages", [image(other)]),
          }),
        ]),
      }),
    })
    const edge = edgesOfKind(wiring, "container-image->ecr-repository")[0]
    expect(edge.state).toBe("absent")
    expect(edge.why).toContain(DIGEST)
    expect(edge.why).toContain("cannot be rolled back to")
  })

  test("an empty repository listing is a break, and names the repository", () => {
    const wiring = wire({
      ecr: ecrFixture({
        repositories: empty<readonly RepositoryReading[]>("ecr:DescribeRepositories"),
      }),
    })
    const edge = edgesOfKind(wiring, "container-image->ecr-repository")[0]
    expect(edge.state).toBe("absent")
    expect(edge.why).toContain("tenure-app")
  })

  test("a refused ecr:DescribeImages is unknown, never a break", () => {
    const wiring = wire({
      ecr: ecrFixture({
        repositories: actual<readonly RepositoryReading[]>("ecr:DescribeRepositories", [
          repository({ images: denied("ecr:DescribeImages", "ecr:DescribeImages") }),
        ]),
      }),
    })
    const edge = edgesOfKind(wiring, "container-image->ecr-repository")[0]
    expect(edge.state).toBe("unknown")
    expect(wiring.broken).toHaveLength(0)
  })

  test("an image from a registry that is not ECR is unknown, not absent", () => {
    const wiring = wire({
      containers: containerFixture({
        clusters: actual<readonly ClusterReading[]>("ecs:ListClusters", [
          cluster({
            runningTasks: actual<readonly TaskReading[]>("ecs:DescribeTasks", [
              task(DIGEST, "ghcr.io/example/app:1.2.3"),
            ]),
          }),
        ]),
      }),
    })
    const edge = edgesOfKind(wiring, "container-image->ecr-repository")[0]
    expect(edge.state).toBe("unknown")
    expect(edge.why).toContain("not an ECR")
  })

  test("a service scaled to zero reports the digest as unknown, not as a break", () => {
    const wiring = wire({
      containers: containerFixture({
        clusters: actual<readonly ClusterReading[]>("ecs:ListClusters", [
          cluster({
            services: actual<readonly ServiceReading[]>("ecs:DescribeServices", [
              service({ desiredCount: 0, runningCount: 0 }),
            ]),
            runningTasks: empty<readonly TaskReading[]>("ecs:DescribeTasks"),
          }),
        ]),
      }),
    })
    const edge = edgesOfKind(wiring, "task-definition->container-image")[0]
    expect(edge.state).toBe("unknown")
    expect(edge.why).toContain("scaled to zero")
    expect(wiring.broken).toHaveLength(0)
  })
})

/* ============================== 6. the certificate and the deploy window == */

describe("a listener certificate against the next deploy window", () => {
  test("expiring BEFORE the window is a break", () => {
    const wiring = wire(
      {
        certificates: certificateFixture({
          certificates: actual<readonly CertificateReading[]>("acm:ListCertificates", [
            certificate({
              detail: actual<CertificateDetail>(
                "acm:DescribeCertificate",
                certificateDetail("2026-08-20T00:00:00.000Z"),
              ),
            }),
          ]),
        }),
      },
      WINDOW_AFTER,
    )
    const edge = edgesOfKind(wiring, "acm-certificate->deploy-window")[0]
    expect(edge.state).toBe("absent")
    expect(edge.why).toContain("BEFORE the next deploy window")
    expect(edge.why).toContain("2026-09-01T00:00:00.000Z")
  })

  test("expiring after the window is present", () => {
    const edge = edgesOfKind(wire({}, WINDOW_AFTER), "acm-certificate->deploy-window")[0]
    expect(edge.state).toBe("present")
  })

  test("a later window turns the same certificate into a break", () => {
    const edge = edgesOfKind(wire({}, WINDOW_BEYOND_EXPIRY), "acm-certificate->deploy-window")[0]
    expect(edge.state).toBe("absent")
  })

  test("no declared window is unknown, never present", () => {
    const edge = edgesOfKind(wire({}, NO_DEPLOY_WINDOW), "acm-certificate->deploy-window")[0]
    expect(edge.state).toBe("unknown")
    expect(edge.why).toContain("no deploy window was supplied")
  })

  test("a certificate the listing does not contain is a break naming the ARN", () => {
    const wiring = wire({
      certificates: certificateFixture({
        certificates: empty<readonly CertificateReading[]>("acm:ListCertificates"),
      }),
    })
    const edge = edgesOfKind(wiring, "listener->acm-certificate")[0]
    expect(edge.state).toBe("absent")
    expect(edge.why).toContain(CERT_ARN)
  })

  test("a refused certificate listing is unknown, never a break", () => {
    const wiring = wire({
      certificates: certificateFixture({
        certificates: denied<readonly CertificateReading[]>(
          "acm:ListCertificates",
          "acm:ListCertificates",
        ),
      }),
    })
    const edge = edgesOfKind(wiring, "listener->acm-certificate")[0]
    expect(edge.state).toBe("unknown")
    expect(wiring.broken).toHaveLength(0)
  })
})

/* =========================================================== 7. attribution */

describe("attribution: shared, untagged and crossed", () => {
  test("an untagged resource is labelled SHARED and is not attributed to the tenant", () => {
    expect(wiringAttribution({ kind: "unattributed" })).toEqual({
      kind: "shared",
      declared: false,
      problem: expect.stringContaining("carries no tenure:tenant"),
    })
    expect(roleFor(wiringAttribution({ kind: "unattributed" }), SLUG)).toEqual({
      kind: "shared",
      declared: false,
    })
  })

  test("a declared shared resource is distinguishable from an untagged one", () => {
    const declared = describeRole(roleFor(wiringAttribution({ kind: "shared" }), SLUG))
    const untagged = describeRole(roleFor(wiringAttribution({ kind: "unattributed" }), SLUG))
    expect(declared).not.toBe(untagged)
    expect(declared).toContain("by decision")
    expect(untagged).toContain("by default")
  })

  test("an untagged load balancer on the path is kept, labelled shared, and counted", () => {
    const wiring = wire({
      loadBalancers: lbFixture({
        loadBalancers: actual<readonly LoadBalancerReading[]>(
          "elasticloadbalancing:DescribeLoadBalancers",
          [loadBalancer({ attribution: UNTAGGED })],
        ),
      }),
    })
    const lbNode = wiring.nodes.find((n) => n.kind === "load-balancer")
    expect(lbNode).toBeDefined()
    expect(lbNode!.role).toEqual({ kind: "shared", declared: false })
    expect(wiring.shared).toContain(lbNode)
    expect(wiring.undeclaredShared).toBeGreaterThan(0)
  })

  test("a resource tagged for a DIFFERENT tenant on the path is a crossed wire", () => {
    const wiring = wire({
      loadBalancers: lbFixture({
        loadBalancers: actual<readonly LoadBalancerReading[]>(
          "elasticloadbalancing:DescribeLoadBalancers",
          [loadBalancer({ attribution: THEIRS })],
        ),
      }),
    })
    const lbNode = wiring.nodes.find((n) => n.kind === "load-balancer")
    expect(wiring.foreign).toContain(lbNode)
    expect(describeRole(lbNode!.role)).toContain(OTHER_SLUG)
  })

  test("a tag index that was not read is unknown, not untagged", () => {
    const role = roleFor(
      wiringAttribution({ kind: "unknown", why: "tag:GetResources was refused" }),
      SLUG,
    )
    expect(role.kind).toBe("unknown")
    expect(describeRole(role)).toContain("tag:GetResources was refused")
  })
})

/* ============================================================ 8. data plane */

describe("the data plane", () => {
  test("a refused RDS listing is unknown, never 'this tenant has no database'", () => {
    const edge = edgesOfKind(wire(), "tenant->rds-instance")[0]
    expect(edge.state).toBe("unknown")
    expect(edge.needs).toBe("rds:DescribeDBInstances")
  })

  test("an EMPTY queue listing is absent — the read answered and there is nothing", () => {
    const wiring = wire()
    const edge = edgesOfKind(wiring, "tenant->sqs-queue")[0]
    expect(edge.state).toBe("absent")
    expect(edge.why).toContain("answered")
    // And it is NOT a break: a tenant with no queue is not a severed chain, and
    // filing it with the outages is how the row that means an outage gets missed.
    expect(wiring.absentAttributions).toContain(edge)
    expect(wiring.broken).not.toContain(edge)
  })

  test("an absent attribution never counts towards the reach verdict's breaks", () => {
    const wiring = wire()
    expect(wiring.absentAttributions.length).toBeGreaterThan(0)
    expect(wiring.reach.kind).not.toBe("broken")
  })

  test("a table tagged for this tenant is present and says the edge is an attribution", () => {
    const edge = edgesOfKind(wire(), "tenant->dynamodb-table")[0]
    expect(edge.state).toBe("present")
    expect(edge.why).toContain("ATTRIBUTION")
    expect(edge.why).toContain("not an observed connection")
  })

  test("a bucket tagged for ANOTHER tenant is not attached to this tenant", () => {
    const wiring = wire({
      buckets: bucketFixture([bucket("tenure-coastal-uploads", THEIRS)]),
    })
    const bucketEdges = edgesOfKind(wiring, "tenant->s3-bucket")
    expect(bucketEdges).toHaveLength(1)
    expect(bucketEdges[0].state).toBe("absent")
    expect(bucketEdges[0].to).toBeNull()
    expect(wiring.absentAttributions).toContain(bucketEdges[0])
  })

  test("an untagged bucket IS attached, labelled shared rather than dropped", () => {
    const wiring = wire({
      buckets: bucketFixture([bucket("legacy-uploads", UNTAGGED)]),
    })
    const bucketEdges = edgesOfKind(wiring, "tenant->s3-bucket")
    expect(bucketEdges).toHaveLength(1)
    expect(bucketEdges[0].state).toBe("present")
    expect(bucketEdges[0].to!.role).toEqual({ kind: "shared", declared: false })
  })
})

/* =========================================================== 9. the headline */

describe("the reach verdict", () => {
  test("a tenant with no hostname reports no-hosts, never intact", () => {
    const wiring = wire({}, WINDOW_AFTER, [])
    expect(wiring.reach.kind).toBe("no-hosts")
    expect(describeReach(wiring.reach)).toContain("no chain to walk")
  })

  test("intact is unreachable while any hop is unreadable", () => {
    const wiring = wire({
      certificates: certificateFixture({
        certificates: denied<readonly CertificateReading[]>(
          "acm:ListCertificates",
          "acm:ListCertificates",
        ),
      }),
    })
    expect(wiring.broken).toHaveLength(0)
    expect(wiring.reach.kind).toBe("unverified")
    expect(describeReach(wiring.reach)).toContain("not a chain that holds")
  })

  test("a break outranks an unreadable hop in the headline", () => {
    const wiring = wire({
      loadBalancers: lbFixture({
        loadBalancers: actual<readonly LoadBalancerReading[]>(
          "elasticloadbalancing:DescribeLoadBalancers",
          [
            loadBalancer({
              targetGroups: actual<readonly TargetGroupReading[]>(
                "elasticloadbalancing:DescribeTargetGroups",
                [targetGroup({ serving: { kind: "no-targets", why: "nothing registered" } })],
              ),
            }),
          ],
        ),
      }),
    })
    expect(wiring.reach.kind).toBe("broken")
    expect(describeReach(wiring.reach)).toContain("BROKEN")
  })

  test("hosts are normalised, deduplicated and sorted", () => {
    const wiring = wire({}, WINDOW_AFTER, [`${HOST}.`, HOST.toUpperCase(), HOST])
    expect(wiring.hosts).toEqual([HOST])
  })

  test("the rendered lines put breaks first and the intact chain last", () => {
    const wiring = wire({
      ecr: ecrFixture({
        repositories: empty<readonly RepositoryReading[]>("ecr:DescribeRepositories"),
      }),
    })
    const lines = wiringLines(wiring)
    expect(lines[0].state).toBe("absent")
    expect(lines[lines.length - 1].state).toBe("present")
  })
})

/* ================================================== 10. the image reference */

describe("parseImageReference", () => {
  test("splits an ECR reference into registry, repository and tag", () => {
    expect(parseImageReference(IMAGE)).toEqual({
      registry: REGISTRY,
      repository: "tenure-app",
      tag: "2026.08.13",
      digest: null,
      ecr: true,
    })
  })

  test("keeps a nested repository path intact", () => {
    expect(parseImageReference(`${REGISTRY}/tenure/app:1`)?.repository).toBe("tenure/app")
  })

  test("reads a digest reference", () => {
    const parsed = parseImageReference(`${REGISTRY}/tenure-app@${DIGEST}`)
    expect(parsed?.digest).toBe(DIGEST)
    expect(parsed?.tag).toBeNull()
  })

  test("does not mistake a tag for a repository", () => {
    expect(parseImageReference("app:2026.08.13")).toEqual({
      registry: null,
      repository: "app",
      tag: "2026.08.13",
      digest: null,
      ecr: false,
    })
  })

  test("recognises a non-commercial partition's ECR host", () => {
    expect(parseImageReference(`${ACCOUNT}.dkr.ecr.cn-north-1.amazonaws.com.cn/app:1`)?.ecr).toBe(
      true,
    )
  })

  test("does not call a non-ECR registry ECR", () => {
    expect(parseImageReference("ghcr.io/example/app:1")?.ecr).toBe(false)
  })

  test("returns null rather than inventing a repository", () => {
    expect(parseImageReference("   ")).toBeNull()
  })
})

describe("s3BucketFromOrigin", () => {
  test("reads the bucket out of a REST endpoint", () => {
    expect(s3BucketFromOrigin("tenure-assets.s3.us-east-1.amazonaws.com")).toBe("tenure-assets")
  })

  test("reads the bucket out of a website endpoint", () => {
    expect(s3BucketFromOrigin("tenure-assets.s3-website-us-east-1.amazonaws.com")).toBe(
      "tenure-assets",
    )
  })

  test("is null for a name that is not an S3 endpoint", () => {
    expect(s3BucketFromOrigin(LB_DNS)).toBeNull()
  })
})

/* ============================================== 11. the origin that is gone */

describe("a distribution origin", () => {
  test("pointing at a load balancer that no longer exists is a break", () => {
    const wiring = wire({
      loadBalancers: lbFixture({
        loadBalancers: empty<readonly LoadBalancerReading[]>(
          "elasticloadbalancing:DescribeLoadBalancers",
        ),
      }),
      dns: dnsFixture({
        loadBalancers: empty<readonly LoadBalancerTarget[]>(
          "elasticloadbalancing:DescribeLoadBalancers",
        ),
      }),
    })
    const edge = edgesOfKind(wiring, "cloudfront-distribution->load-balancer")[0]
    expect(edge.state).toBe("absent")
    expect(edge.why).toContain(LB_DNS)
  })

  test("pointing at an S3 bucket that no longer exists is a break", () => {
    const wiring = wire({
      cdn: cdnFixture({
        distributions: actual<readonly DistributionReading[]>("cloudfront:ListDistributions", [
          distribution({}, [origin("tenure-assets.s3.us-east-1.amazonaws.com", "s3-origin")]),
        ]),
      }),
    })
    const edge = edgesOfKind(wiring, "cloudfront-distribution->s3-bucket")[0]
    expect(edge.state).toBe("absent")
    expect(edge.why).toContain("tenure-assets")
  })

  test("a refused distribution config is unknown, never a break", () => {
    const wiring = wire({
      cdn: cdnFixture({
        distributions: actual<readonly DistributionReading[]>("cloudfront:ListDistributions", [
          distribution({
            config: denied("cloudfront:GetDistributionConfig", "cloudfront:GetDistributionConfig"),
          }),
        ]),
      }),
    })
    const edge = edgesOfKind(wiring, "cloudfront-distribution->load-balancer")[0]
    expect(edge.state).toBe("unknown")
    expect(wiring.broken).toHaveLength(0)
  })
})

/* ============================================== 12. the production seam === */

describe("wiringReadings drives the readers through the one gateway", () => {
  beforeEach(() => {
    __resetIdentity()
  })

  test("an account that refuses everything yields unknown edges and NOT ONE break", async () => {
    const calls: string[] = []
    const refusing: AwsGateway = {
      async call(capability) {
        calls.push(capability)
        const error = new Error(`not authorized to perform ${capability}`)
        error.name = "AccessDeniedException"
        throw error
      },
      async resolvedRegion() {
        return "us-east-1"
      },
    }

    const loaded = await wiringReadings(refusing, { now: () => NOW })

    // Every reader was reached through the seam, and each carries a refusal
    // rather than an empty list.
    expect(calls).toContain("route53:ListHostedZones")
    expect(calls).toContain("cloudfront:ListDistributions")
    expect(calls).toContain("ecs:ListClusters")
    expect(calls).toContain("ecr:DescribeRepositories")
    expect(loaded.dns.zones.state).toBe("DENIED")
    expect(loaded.ecr.repositories.state).toBe("DENIED")

    const wiring = tenantWiring({
      slug: SLUG,
      hosts: [HOST],
      readings: loaded,
      deployWindow: NO_DEPLOY_WINDOW,
      now: NOW,
    })

    expect(wiring.broken).toHaveLength(0)
    expect(wiring.unreadable.length).toBeGreaterThan(0)
    expect(wiring.reach.kind).toBe("unverified")
    for (const e of wiring.unreadable) expect(e.state).toBe("unknown")
  }, 30_000)
})

/* ======================== 13. the image the NEXT task pulls (latent) ====== */

/**
 * The blind spot in the running-digest walk, and why it is its own severity.
 *
 * Every case below is an estate where a request arriving right now is served
 * correctly. That is what makes them worth a test: the digest walk reports the
 * chain connected, because the container that is already up pulled its image when
 * it started and never pulls again. The break is in the future tense, and the
 * whole point of `LATENT_EDGE_KINDS` is that a future break is neither an outage
 * nor housekeeping.
 */

/** The same image, still in ECR by digest, with every tag stripped off it. */
function untaggedImage(digest: string): ImageReading {
  return { ...image(digest), tags: [] }
}

/** A cluster whose service is at zero and has no running task. */
function scaledToZero(): ClusterReading {
  return cluster({
    services: actual<readonly ServiceReading[]>("ecs:DescribeServices", [
      service({ desiredCount: 0, runningCount: 0, gap: { kind: "none", desired: 0, running: 0 } }),
    ]),
    runningTasks: empty<readonly TaskReading[]>("ecs:DescribeTasks"),
  })
}

/** A cluster whose one service points at a revision with these containers. */
function declaring(containers: TaskDefinitionReading["containers"]): ClusterReading {
  return cluster({
    services: actual<readonly ServiceReading[]>("ecs:DescribeServices", [
      service({
        taskDefinition: actual<TaskDefinitionReading>("ecs:DescribeTaskDefinition", {
          ...taskDefinition(),
          containers,
        }),
      }),
    ]),
  })
}

describe("the image a task definition DECLARES", () => {
  test("the declared image and the repository it names are walked from the revision", () => {
    const wiring = wire()

    const declared = edgesOfKind(wiring, "task-definition->declared-image")
    expect(declared).toHaveLength(1)
    expect(declared[0].state).toBe("present")
    expect(declared[0].why).toContain(IMAGE)
    expect(declared[0].to?.kind).toBe("declared-image")

    const repo = edgesOfKind(wiring, "declared-image->ecr-repository")
    expect(repo).toHaveLength(1)
    expect(repo[0].state).toBe("present")
    expect(repo[0].why).toContain("the tag 2026.08.13")
    expect(wiring.latent).toHaveLength(0)
  })

  test("a tag expired out of ECR while the task keeps serving is LATENT, not a break", () => {
    // The digest is still there — the running task's image can be found — and the
    // TAG the revision names is gone. Nothing is failing; the next placement fails.
    const wiring = wire({
      ecr: ecrFixture({
        repositories: actual<readonly RepositoryReading[]>("ecr:DescribeRepositories", [
          repository({
            images: actual<readonly ImageReading[]>("ecr:DescribeImages", [untaggedImage(DIGEST)]),
          }),
        ]),
      }),
    })

    // The hop about what is RUNNING is still connected. That is the trap.
    expect(edgesOfKind(wiring, "container-image->ecr-repository")[0].state).toBe("present")

    const latent = edgesOfKind(wiring, "declared-image->ecr-repository")[0]
    expect(latent.state).toBe("absent")
    expect(latent.why).toContain("the tag 2026.08.13")
    expect(latent.why).toContain("CannotPullContainerError")
    expect(latent.why).toContain("Nothing is failing now")

    expect(wiring.latent).toHaveLength(1)
    expect(wiring.broken).toHaveLength(0)
    expect(wiring.absentAttributions).not.toContain(latent)
    expect(wiring.reach.kind).not.toBe("broken")
    expect(wiring.reach.latent).toBe(1)
    expect(describeReach(wiring.reach)).toContain("NEXT task placement")
  })

  test("a service scaled to zero still gets its ECR answer — the digest walk cannot", () => {
    const wiring = wire({
      containers: containerFixture({
        clusters: actual<readonly ClusterReading[]>("ecs:ListClusters", [scaledToZero()]),
      }),
      ecr: ecrFixture({
        repositories: actual<readonly RepositoryReading[]>("ecr:DescribeRepositories", [
          repository({
            images: actual<readonly ImageReading[]>("ecr:DescribeImages", [untaggedImage(DIGEST)]),
          }),
        ]),
      }),
    })

    // No running task, so the digest hop can say nothing at all.
    expect(edgesOfKind(wiring, "task-definition->container-image")[0].state).toBe("unknown")
    expect(edgesOfKind(wiring, "container-image->ecr-repository")).toHaveLength(0)

    // The revision is readable whether or not anything runs, so this one answers.
    const latent = edgesOfKind(wiring, "declared-image->ecr-repository")[0]
    expect(latent.state).toBe("absent")
    expect(latent.why).toContain("cannot be scaled back up from zero")
    expect(wiring.latent).toHaveLength(1)
    expect(wiring.broken).toHaveLength(0)
  })

  test("a repository the listing does not contain is latent and names the repository", () => {
    const wiring = wire({
      ecr: ecrFixture({
        repositories: empty<readonly RepositoryReading[]>("ecr:DescribeRepositories"),
      }),
    })
    const latent = edgesOfKind(wiring, "declared-image->ecr-repository")[0]
    expect(latent.state).toBe("absent")
    expect(latent.why).toContain("tenure-app")
    expect(latent.why).toContain("without returning")
    expect(wiring.latent).toContain(latent)
  })

  test("a refused ecr:DescribeImages is unknown and names the grant that would answer it", () => {
    const wiring = wire({
      ecr: ecrFixture({
        repositories: actual<readonly RepositoryReading[]>("ecr:DescribeRepositories", [
          repository({ images: denied("ecr:DescribeImages", "ecr:DescribeImages") }),
        ]),
      }),
    })
    const edge = edgesOfKind(wiring, "declared-image->ecr-repository")[0]
    expect(edge.state).toBe("unknown")
    expect(edge.needs).toBe("ecr:DescribeImages")
    expect(wiring.latent).toHaveLength(0)
    expect(wiring.broken).toHaveLength(0)
  })

  test("a refused ecr:DescribeRepositories is unknown, never latent", () => {
    const wiring = wire({
      ecr: ecrFixture({
        repositories: denied<readonly RepositoryReading[]>(
          "ecr:DescribeRepositories",
          "ecr:DescribeRepositories",
        ),
      }),
    })
    const edge = edgesOfKind(wiring, "declared-image->ecr-repository")[0]
    expect(edge.state).toBe("unknown")
    expect(wiring.latent).toHaveLength(0)
  })

  test("a declared image from a registry that is not ECR is unknown, not latent", () => {
    const wiring = wire({
      containers: containerFixture({
        clusters: actual<readonly ClusterReading[]>("ecs:ListClusters", [
          declaring([{ ...taskDefinition().containers[0], image: "ghcr.io/example/app:1.2.3" }]),
        ]),
      }),
    })
    const edge = edgesOfKind(wiring, "declared-image->ecr-repository")[0]
    expect(edge.state).toBe("unknown")
    expect(edge.why).toContain("not an ECR")
    expect(wiring.latent).toHaveLength(0)
  })

  test("a reference with no tag is looked up as latest, and says so", () => {
    const wiring = wire({
      containers: containerFixture({
        clusters: actual<readonly ClusterReading[]>("ecs:ListClusters", [
          declaring([{ ...taskDefinition().containers[0], image: `${REGISTRY}/tenure-app` }]),
        ]),
      }),
    })
    const edge = edgesOfKind(wiring, "declared-image->ecr-repository")[0]
    expect(edge.state).toBe("absent")
    expect(edge.why).toContain("the tag latest, which is what a reference carrying no tag at all")
  })

  test("a reference with no tag matches an image ECR holds under latest", () => {
    // The pair of the case above, and the one that proves `latest` is what is
    // actually LOOKED UP rather than only what the sentence says. A mutation that
    // defaulted the lookup to the empty string kept the sentence and survived the
    // case above; it cannot survive this one.
    const wiring = wire({
      containers: containerFixture({
        clusters: actual<readonly ClusterReading[]>("ecs:ListClusters", [
          declaring([{ ...taskDefinition().containers[0], image: `${REGISTRY}/tenure-app` }]),
        ]),
      }),
      ecr: ecrFixture({
        repositories: actual<readonly RepositoryReading[]>("ecr:DescribeRepositories", [
          repository({
            images: actual<readonly ImageReading[]>("ecr:DescribeImages", [
              { ...image(DIGEST), tags: ["latest"] },
            ]),
          }),
        ]),
      }),
    })
    const edge = edgesOfKind(wiring, "declared-image->ecr-repository")[0]
    expect(edge.state).toBe("present")
    expect(edge.why).toContain("the tag latest")
    expect(wiring.latent).toHaveLength(0)
  })

  test("a revision declaring no container at all is an absent hop, not a silent one", () => {
    const wiring = wire({
      containers: containerFixture({
        clusters: actual<readonly ClusterReading[]>("ecs:ListClusters", [declaring([])]),
      }),
    })
    const edge = edgesOfKind(wiring, "task-definition->declared-image")[0]
    expect(edge.state).toBe("absent")
    expect(edge.why).toContain("no container definition at all")
    expect(wiring.latent).toContain(edge)
  })

  test("a container definition with no image is unknown, never absent", () => {
    const wiring = wire({
      containers: containerFixture({
        clusters: actual<readonly ClusterReading[]>("ecs:ListClusters", [
          declaring([{ ...taskDefinition().containers[0], image: null }]),
        ]),
      }),
    })
    const edge = edgesOfKind(wiring, "task-definition->declared-image")[0]
    expect(edge.state).toBe("unknown")
    expect(wiring.latent).toHaveLength(0)
  })

  test("latent, path and attribution are three disjoint sets", () => {
    for (const kind of LATENT_EDGE_KINDS) expect(PATH_EDGE_KINDS.has(kind)).toBe(false)

    const wiring = wire({
      ecr: ecrFixture({
        repositories: empty<readonly RepositoryReading[]>("ecr:DescribeRepositories"),
      }),
    })
    for (const e of wiring.latent) {
      expect(isLatentEdge(e)).toBe(true)
      expect(isPathEdge(e)).toBe(false)
      expect(wiring.broken).not.toContain(e)
      expect(wiring.absentAttributions).not.toContain(e)
    }
    for (const e of wiring.broken) expect(isLatentEdge(e)).toBe(false)
    for (const e of wiring.absentAttributions) expect(isLatentEdge(e)).toBe(false)

    // Nothing is lost between the three lists: every absent edge is in exactly one.
    const absent = wiring.edges.filter((e) => e.state === "absent")
    expect(wiring.broken.length + wiring.latent.length + wiring.absentAttributions.length).toBe(
      absent.length,
    )
  })

  test("the intact headline carries the latent count rather than reading clean", () => {
    // Called on the state directly: the whole risk is an author adding an arm and
    // forgetting the clause, and this asserts the arm where that is most tempting.
    expect(describeReach({ kind: "intact", edges: 14, latent: 0 })).not.toContain("NEXT task")
    const withLatent = describeReach({ kind: "intact", edges: 14, latent: 2 })
    expect(withLatent).toContain("intact")
    expect(withLatent).toContain("2 hops will break at the NEXT task placement")
  })
})

/* ================================ 14. the account topology, reconciled ==== */

describe("reconcileTopology", () => {
  const ORG_ACCOUNTS: readonly ObservedAccount[] = [
    { id: "111111111111", name: "tenure-management", role: "management" },
    { id: "222222222222", name: "log-archive" },
  ]

  function rows(input: Parameters<typeof reconcileTopology>[0]) {
    return new Map(reconcileTopology(input).map((r) => [r.role.key, r]))
  }

  test("an unreadable Organization makes EVERY row unknown, never missing", () => {
    const verdicts = reconcileTopology({
      scale: "regulated-multi-tenant",
      accounts: ORG_ACCOUNTS,
      selfAccountId: "111111111111",
      organizationInUse: true,
      unknownBecause: "organizations:ListAccounts was refused",
    })
    expect(verdicts).toHaveLength(ACCOUNT_ROLES.length)
    for (const v of verdicts) {
      expect(v.state).toBe("UNKNOWN")
      if (v.state === "UNKNOWN") expect(v.because).toContain("organizations:ListAccounts")
    }
  })

  test("a single-account estate answers SINGLE_ACCOUNT, not eleven findings", () => {
    const verdicts = reconcileTopology({
      scale: "single-account-pilot",
      accounts: [],
      selfAccountId: "111111111111",
      organizationInUse: false,
    })
    for (const v of verdicts) {
      expect(v.state).toBe("SINGLE_ACCOUNT")
      if (v.state === "SINGLE_ACCOUNT") expect(v.accountId).toBe("111111111111")
    }
  })

  test("no resolved account id is unknown, never single-account", () => {
    const verdicts = reconcileTopology({
      scale: "single-account-pilot",
      accounts: [],
      selfAccountId: null,
      organizationInUse: false,
    })
    for (const v of verdicts) expect(v.state).toBe("UNKNOWN")
  })

  test("a tagged account fills its role, and a matching name fills one too", () => {
    const byKey = rows({
      scale: "multi-account",
      accounts: ORG_ACCOUNTS,
      selfAccountId: "111111111111",
      organizationInUse: true,
    })
    const management = byKey.get("management")
    expect(management?.state).toBe("FILLED")
    if (management?.state === "FILLED") {
      expect(management.accountId).toBe("111111111111")
      expect(management.by).toBe("tenure-management")
    }
    // Filled by NAME, with no tenure:account-role tag on it at all.
    expect(byKey.get("log-archive")?.state).toBe("FILLED")
  })

  test("scale decides whether an empty role is a finding or a row", () => {
    const atMulti = rows({
      scale: "multi-account",
      accounts: ORG_ACCOUNTS,
      selfAccountId: "111111111111",
      organizationInUse: true,
    })
    // network is declared requiredFrom regulated-multi-tenant.
    expect(atMulti.get("network")?.state).toBe("NOT_REQUIRED_AT_THIS_SCALE")
    expect(atMulti.get("production-cell")?.state).toBe("MISSING")

    const atRegulated = rows({
      scale: "regulated-multi-tenant",
      accounts: ORG_ACCOUNTS,
      selfAccountId: "111111111111",
      organizationInUse: true,
    })
    expect(atRegulated.get("network")?.state).toBe("MISSING")
  })

  test("requiredAt only ever grows with the scale", () => {
    const sizes = ESTATE_SCALES.map((s: EstateScale) => requiredAt(s).length)
    expect(sizes[0]).toBe(0)
    expect(sizes[1]).toBeGreaterThan(sizes[0])
    expect(sizes[2]).toBeGreaterThan(sizes[1])
    expect(sizes[2]).toBe(ACCOUNT_ROLES.length)

    const smaller = new Set(requiredAt("multi-account").map((r) => r.key))
    for (const key of smaller) {
      expect(requiredAt("regulated-multi-tenant").some((r) => r.key === key)).toBe(true)
    }
  })

  test("every declared role has a distinct key and says what it is for", () => {
    expect(new Set(ACCOUNT_ROLES.map((r) => r.key)).size).toBe(ACCOUNT_ROLES.length)
    for (const role of ACCOUNT_ROLES) expect(role.purpose.length).toBeGreaterThan(40)
  })
})
