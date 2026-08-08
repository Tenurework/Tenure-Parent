/**
 * STUDIO-070-004 — every AWS read this engine can perform, named.
 *
 * A closed union, not a string. The alternative — an endpoint that takes a
 * service, an action and a parameter bag — is an IAM bypass with a JSON body:
 * whatever the task role holds becomes reachable from a browser, and no review
 * of this repository can tell you what the console is able to do. Here the
 * answer is `Object.keys(CAPABILITIES)`.
 *
 * Each entry carries three things that are otherwise invented at the call site:
 *
 *   * `iamActions` — the exact actions the call needs. This is what a denial
 *     renders back to the operator, and what `studio-task-role-is-narrow`
 *     compares the Terraform against. One source, so the grant, the guard and
 *     the error message cannot disagree.
 *   * `resource` — the ARN pattern. `"*"` where the API genuinely has no
 *     resource-level scoping (List/Describe on most services), written out
 *     rather than left implied, because "why is this a star" is a question a
 *     reviewer must be able to answer from the line itself.
 *   * `refreshMs` — how long a reading may be reused. Per surface, never one
 *     global number: an ECS deployment moves in seconds and a certificate
 *     inventory moves in months, and a single TTL is either a stale console or
 *     a bill.
 *
 * No `@aws-sdk` import: this module is the vocabulary, `client.ts` is the only
 * thing that holds a client. Keeping them apart is what lets every other module
 * — and every test — talk about capabilities without a credential path.
 */

/* ------------------------------------------------------------ cadences -- */

/**
 * How long each surface's reading stays usable.
 *
 * Named constants rather than literals at the call site, because the number is
 * an argument about the resource, and an argument needs somewhere to live.
 */

/** Identity does not change under a task; re-resolved only after a denial. */
export const IDENTITY_REFRESH_MS = 15 * 60_000

/** Service desired/running counts move on every deployment. */
export const ECS_TTL_MS = 15_000

/** Instance class and storage change on maintenance windows, not on requests. */
export const RDS_TTL_MS = 120_000

/** Distributions change when a domain is added — rare, and expensive to poll. */
export const CLOUDFRONT_TTL_MS = 300_000

/** Certificates renew on a 60-day horizon. Polling this quickly buys nothing. */
export const ACM_TTL_MS = 3_600_000

/** The tag index is the join key for attribution; stale tags mis-attribute cost. */
export const INVENTORY_REFRESH_MS = 60_000

/** Alarm state is the fastest-moving thing here and the cheapest to ask for. */
export const ALARM_REFRESH_MS = 20_000

/** Findings are aggregated by Security Hub on its own cadence, minutes at best. */
export const SECURITY_REFRESH_MS = 300_000

/** Organizations describes a structure that changes when a human changes it. */
export const ORGANIZATION_REFRESH_MS = 3_600_000

/** Cost Explorer is billed per request. Hours, not seconds. */
export const COST_REFRESH_MS = 6 * 3_600_000

/** Trails, aggregators and report definitions are configuration, not telemetry. */
export const POSTURE_REFRESH_MS = 3_600_000

/**
 * Whether a secret EXISTS changes when somebody creates or deletes one.
 *
 * Short, because this reading gates a provisioning run: a cached "it is there"
 * from an hour ago is exactly the answer that lets a manifest naming a deleted
 * secret pass VERIFYING and fail inside the cell.
 */
export const SECRET_REF_REFRESH_MS = 30_000

/* -------------------------------------------------------- the catalogue -- */

/** Which page a capability feeds. Used by the read-only API to group surfaces. */
export type SurfaceKey =
  | "identity"
  | "estate"
  | "organization"
  | "posture"
  | "health"
  | "security"
  | "cost"
  | "retention"

export interface CapabilitySpec {
  /** The IAM actions the call needs, exactly. */
  readonly iamActions: readonly string[]
  /** The resource the actions must be allowed on. */
  readonly resource: string
  /** How long a reading may be reused before it is re-read. */
  readonly refreshMs: number
  /** The surface this capability feeds. */
  readonly surface: SurfaceKey
  /** What an operator gets from it, in their language rather than the API's. */
  readonly reads: string
}

export const CAPABILITIES = {
  "sts:GetCallerIdentity": {
    iamActions: ["sts:GetCallerIdentity"],
    resource: "*",
    refreshMs: IDENTITY_REFRESH_MS,
    surface: "identity",
    reads: "which account, principal and partition this engine is actually running as",
  },
  "organizations:DescribeOrganization": {
    iamActions: ["organizations:DescribeOrganization"],
    resource: "*",
    refreshMs: ORGANIZATION_REFRESH_MS,
    surface: "organization",
    reads: "whether an AWS Organization exists and which account manages it",
  },
  "organizations:ListAccounts": {
    iamActions: ["organizations:ListAccounts"],
    resource: "*",
    refreshMs: ORGANIZATION_REFRESH_MS,
    surface: "organization",
    reads: "every account in the organization, to reconcile against the declared topology",
  },
  "tag:GetResources": {
    iamActions: ["tag:GetResources"],
    resource: "*",
    refreshMs: INVENTORY_REFRESH_MS,
    surface: "estate",
    reads: "every tagged resource, which is how a resource is attributed to a tenant",
  },
  "ecs:ListClusters": {
    iamActions: ["ecs:ListClusters"],
    resource: "*",
    refreshMs: ECS_TTL_MS,
    surface: "estate",
    reads: "the clusters services are listed under",
  },
  "ecs:ListServices": {
    iamActions: ["ecs:ListServices"],
    resource: "*",
    refreshMs: ECS_TTL_MS,
    surface: "estate",
    reads: "the services running in each cluster",
  },
  "ecs:DescribeServices": {
    iamActions: ["ecs:DescribeServices"],
    resource: "*",
    refreshMs: ECS_TTL_MS,
    surface: "estate",
    reads: "desired and running task counts, and which target group each service sits behind",
  },
  "rds:DescribeDBInstances": {
    iamActions: ["rds:DescribeDBInstances"],
    resource: "*",
    refreshMs: RDS_TTL_MS,
    surface: "estate",
    reads: "database instances, their class, and the subnet group they live in",
  },
  "rds:DescribeDBSnapshots": {
    iamActions: ["rds:DescribeDBSnapshots"],
    resource: "*",
    refreshMs: RDS_TTL_MS,
    surface: "retention",
    reads: "snapshots retained after a tenant stopped serving, which still bill",
  },
  "cloudfront:ListDistributions": {
    iamActions: ["cloudfront:ListDistributions"],
    resource: "*",
    refreshMs: CLOUDFRONT_TTL_MS,
    surface: "estate",
    reads: "edge distributions and the origins they front",
  },
  "acm:ListCertificates": {
    iamActions: ["acm:ListCertificates"],
    resource: "*",
    refreshMs: ACM_TTL_MS,
    surface: "estate",
    reads: "certificates and the domains they cover",
  },
  "cloudwatch:DescribeAlarms": {
    iamActions: ["cloudwatch:DescribeAlarms"],
    resource: "*",
    refreshMs: ALARM_REFRESH_MS,
    surface: "health",
    reads: "every alarm, its state, whether its actions are enabled and when it last moved",
  },
  "securityhub:GetFindings": {
    iamActions: ["securityhub:GetFindings"],
    resource: "*",
    refreshMs: SECURITY_REFRESH_MS,
    surface: "security",
    reads: "findings aggregated from GuardDuty, Inspector, Macie, Config and Access Analyzer",
  },
  "cloudtrail:DescribeTrails": {
    iamActions: ["cloudtrail:DescribeTrails"],
    resource: "*",
    refreshMs: POSTURE_REFRESH_MS,
    surface: "posture",
    reads: "whether an organization-wide, multi-region, validated trail exists",
  },
  "config:DescribeConfigurationAggregators": {
    iamActions: ["config:DescribeConfigurationAggregators"],
    resource: "*",
    refreshMs: POSTURE_REFRESH_MS,
    surface: "posture",
    reads: "whether configuration state is aggregated centrally or only locally",
  },
  "cur:DescribeReportDefinitions": {
    iamActions: ["cur:DescribeReportDefinitions"],
    resource: "*",
    refreshMs: POSTURE_REFRESH_MS,
    surface: "posture",
    reads: "whether a Cost and Usage Report is delivered at all, in the payer account",
  },
  "ce:GetCostAndUsageWithResources": {
    iamActions: ["ce:GetCostAndUsageWithResources"],
    resource: "*",
    refreshMs: COST_REFRESH_MS,
    surface: "cost",
    reads: "billed cost grouped by service, filtered to one tenant's tag",
  },
  "logs:DescribeLogGroups": {
    iamActions: ["logs:DescribeLogGroups"],
    resource: "*",
    refreshMs: RDS_TTL_MS,
    surface: "retention",
    reads: "log groups a tenant left behind, their retention setting and their stored bytes",
  },
  /* ------------------------------------------------------ STUDIO-040-005 --
   * Existence of a secret, without its value.
   *
   * `DescribeSecret` and `DescribeParameters` are METADATA calls: they answer
   * "does this exist, when did it last change, is it rotating" and cannot
   * return a secret value. `GetSecretValue` and `GetParameter` are deliberately
   * NOT here and never will be — a control plane that renders every tenant's
   * configuration must not be able to read any tenant's credentials, and
   * `secret-refs-never-read-a-value` fails the build if the string
   * `GetSecretValue` appears anywhere under `apps/system-studio/src`.
   */
  "secretsmanager:DescribeSecret": {
    iamActions: ["secretsmanager:DescribeSecret"],
    // Scoped to this platform's own namespace. A star here would let the
    // console confirm the existence of every secret in the account, which is
    // itself information worth withholding.
    resource: "arn:aws:secretsmanager:*:*:secret:tenure/*",
    refreshMs: SECRET_REF_REFRESH_MS,
    surface: "posture",
    reads: "whether a manifest's secret reference names something that exists — never its value",
  },
  "ssm:DescribeParameters": {
    iamActions: ["ssm:DescribeParameters"],
    resource: "*",
    refreshMs: SECRET_REF_REFRESH_MS,
    surface: "posture",
    reads: "whether a manifest's Parameter Store reference exists — never its value",
  },
  "backup:ListBackupVaults": {
    iamActions: ["backup:ListBackupVaults"],
    resource: "*",
    refreshMs: POSTURE_REFRESH_MS,
    surface: "retention",
    reads: "backup vaults, which is where a recovery point outlives its tenant",
  },
  "backup:ListRecoveryPointsByBackupVault": {
    iamActions: ["backup:ListRecoveryPointsByBackupVault"],
    resource: "*",
    refreshMs: RDS_TTL_MS,
    surface: "retention",
    reads: "recovery points still held for a tenant, and whether any is under legal hold",
  },
  "kms:ListKeys": {
    iamActions: ["kms:ListKeys", "kms:ListResourceTags"],
    resource: "*",
    refreshMs: POSTURE_REFRESH_MS,
    surface: "retention",
    reads: "customer-managed keys, which bill monthly whether or not anything is encrypted with them",
  },
  "route53:ListHostedZones": {
    iamActions: ["route53:ListHostedZones"],
    resource: "*",
    refreshMs: POSTURE_REFRESH_MS,
    surface: "retention",
    reads: "hosted zones whose record sets still point at a tenant that stopped serving",
  },
  "s3:ListObjectVersions": {
    iamActions: ["s3:ListBucketVersions"],
    resource: "*",
    refreshMs: RDS_TTL_MS,
    surface: "retention",
    reads: "object versions retained under a tenant's prefix, and the bytes they hold",
  },
} as const satisfies Record<string, CapabilitySpec>

export type Capability = keyof typeof CAPABILITIES

export const ALL_CAPABILITIES = Object.keys(CAPABILITIES) as readonly Capability[]

/**
 * The smallest IAM statement that would let a denied call succeed.
 *
 * Returned as an object rather than a sentence so the page can render it as
 * JSON an operator pastes into a policy without retyping it — a denial whose
 * remedy has to be looked up is a denial that stays.
 */
export function minimumStatement(capability: Capability): {
  Effect: "Allow"
  Action: string[]
  Resource: string
} {
  const spec = CAPABILITIES[capability]
  return { Effect: "Allow", Action: [...spec.iamActions], Resource: spec.resource }
}

/** The same statement, as the text a page prints. */
export function minimumStatementText(capability: Capability): string {
  return JSON.stringify(minimumStatement(capability))
}

/** Capabilities feeding one surface, so the API route can read a whole page's worth. */
export function capabilitiesFor(surface: SurfaceKey): readonly Capability[] {
  return ALL_CAPABILITIES.filter((c) => CAPABILITIES[c].surface === surface)
}

/**
 * Every read verb this engine is allowed to hold, flattened.
 *
 * `studio-task-role-is-narrow` compares the Terraform against this, so adding a
 * grant to the role that no capability names fails the guard — which is the
 * point: a permission nothing calls is a permission nobody reviewed.
 */
export function allIamActions(): readonly string[] {
  return [...new Set(ALL_CAPABILITIES.flatMap((c) => [...CAPABILITIES[c].iamActions]))].sort()
}
