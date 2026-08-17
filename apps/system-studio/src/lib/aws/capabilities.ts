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

/* ------------------------------------------- STUDIO-070-004 continuation --
 *
 * The seven services the engine PROVISIONS or DEPENDS ON and could not see.
 *
 * `infrastructure/terraform/ses.tf` creates a domain identity, an email
 * identity and a configuration set; `sqs.tf` creates five queues; `scheduler.tf`
 * creates an EventBridge rule that is the only thing making deliverable
 * reminders fire. None of it was readable from here, so "the reminders stopped"
 * and "the rule is DISABLED" were the same blank screen.
 *
 * Each fact below gets its own cadence, and they are separate constants because
 * they are separate arguments. A queue's DEPTH is a different kind of number
 * from the SET of queues that exist, and giving both the same TTL means either
 * polling ListQueues every ten seconds — an account-wide throttle the operator
 * did not ask for — or showing a backlog that is four minutes stale, which is a
 * backlog nobody can act on.
 */

/**
 * SES account state: sandbox, 24-hour quota and send rate.
 *
 * The fastest-moving SES fact and the one that silently limits who can be
 * emailed. A quota that is 90% spent has to be seen before it is 100% spent,
 * and `GetAccount` is one cheap call.
 */
export const SES_ACCOUNT_TTL_MS = 90_000

/**
 * SES configuration: identities and configuration sets.
 *
 * These change when Terraform runs, not when mail is sent. Polling them at the
 * account cadence would triple the SES call rate to re-read a domain
 * verification that moves once a quarter.
 */
export const SES_CONFIG_TTL_MS = 600_000

/**
 * The account suppression list.
 *
 * Grows on every bounce and complaint, so it is not configuration — but each
 * entry is permanent until removed, so a three-minute-old list is never wrong
 * about an address, only about how recently one was added.
 */
export const SES_SUPPRESSION_TTL_MS = 180_000

/** Which queues exist. Terraform's answer, and it changes when Terraform runs. */
export const SQS_QUEUE_TTL_MS = 150_000

/**
 * Queue depth, in-flight and delayed counts.
 *
 * The fastest cadence in this registry, faster than ECS deliberately: a backlog
 * that matters is one that is growing right now, and a dead-letter queue that
 * became non-empty thirty seconds ago is a delivery that already failed.
 */
export const SQS_DEPTH_TTL_MS = 10_000

/**
 * Function configuration and reserved concurrency.
 *
 * Runtime, memory, timeout and last-modified change on deploy. A deprecated
 * runtime is a scheduled outage that moves on AWS's calendar, not on ours.
 */
export const LAMBDA_TTL_MS = 45_000

/**
 * Roles, policies and access keys.
 *
 * Changed by a human running Terraform, so minutes rather than seconds — and
 * IAM is a low-TPS, account-wide API whose throttle is shared with every other
 * principal in the account, including the deploy role. Polling it hard here
 * would rate-limit the pipeline.
 */
export const IAM_POSTURE_TTL_MS = 720_000

/**
 * Budgets: limit, actual and forecast.
 *
 * AWS recomputes budget actuals a few times a day; anything faster returns the
 * same number. The Budgets API is also metered per request, so a dashboard left
 * open is a line on the bill it is supposed to be watching.
 */
export const BUDGETS_TTL_MS = 4 * 3_600_000

/**
 * Open and upcoming AWS Health events.
 *
 * This is the read that answers "is it us or is it AWS", which is asked during
 * an incident, by someone watching the page. Fast, and cheap enough to be.
 */
export const AWS_HEALTH_TTL_MS = 25_000

/**
 * EventBridge rules and their targets.
 *
 * A DISABLED scheduled rule is a job that stopped running silently — the same
 * defect shape as an alarm with its actions switched off. Four minutes is the
 * longest anybody should be told a reminder pipeline is fine when it is off.
 */
export const EVENTBRIDGE_TTL_MS = 240_000

/* ------------------------------------------- STUDIO-070-004 continuation --
 *
 * Everything `infrastructure/terraform` and `infrastructure/studio` PROVISION
 * that no capability could read.
 *
 * The registry named 41 reads over 27 SDK packages and still could not answer:
 * who may sign in to this console (its own Cognito pool), whether a security
 * group allows 0.0.0.0/0, whether the load balancer considers any ECS task
 * healthy, which image tag is actually deployed and what the scanner found in
 * it, whether the cache is up, whether the registry table has point-in-time
 * recovery, or whether the bucket Terraform set `public_access_block` on still
 * has it. Every one of those is provisioned in this repository and every one of
 * them was a blank screen.
 *
 * The cadences below are per fact, not per service, and that distinction is the
 * design. Target health moves in seconds; a certificate's expiry moves in
 * months; a price list moves when AWS publishes one. One global TTL is how a
 * console simultaneously throttles the account and shows a stale number.
 */

/* ------------------------------------------------------------- Cognito -- */

/**
 * The operator pool's configuration: the pool, its client, its domain and its
 * MFA policy.
 *
 * Terraform's answer, and it changes when Terraform runs. Ten minutes is short
 * enough that "MFA was switched from ON to OPTIONAL" is caught within a coffee
 * break and long enough that the console is not polling its own login system.
 */
export const COGNITO_POOL_TTL_MS = 600_000

/**
 * WHO may sign in to this console.
 *
 * Faster than the pool's configuration because the membership changes when a
 * human is hired or leaves, and a disabled operator who still appears on the
 * roster is the read this exists to make correct. Not seconds: `ListUsers` is
 * a paged call against a pool, not a counter.
 */
export const COGNITO_OPERATORS_TTL_MS = 120_000

/* ------------------------------------------------------------ networking -- */

/**
 * VPCs, subnets, route tables, gateways and endpoints.
 *
 * Structure. It changes on a Terraform apply and not otherwise, and every one
 * of these calls is against the account-wide EC2 Describe throttle that the
 * deploy pipeline also uses.
 */
export const NETWORK_TOPOLOGY_TTL_MS = 300_000

/**
 * Security groups and network ACLs — the rules, not the shape.
 *
 * Deliberately four times faster than the topology. An ingress rule opened to
 * 0.0.0.0/0 is the difference between a private database and a public one, it
 * is the change most often made by hand in the console during an incident, and
 * it is the one nobody remembers to close. A minute is the longest this estate
 * should be able to be wide open without the console saying so.
 */
export const SECURITY_GROUP_TTL_MS = 60_000

/* --------------------------------------------------------- load balancer -- */

/**
 * Load balancers, listeners, target groups and listener rules.
 *
 * The shape of the front door. Terraform's answer again — a listener is not
 * added during an incident.
 */
export const LOAD_BALANCER_TTL_MS = 180_000

/**
 * Target health.
 *
 * Ten seconds, and this is the justification the file asks for for anything
 * under thirty. `DescribeTargetHealth` is THE liveness signal for the ECS
 * service: `ecs:DescribeServices` reports the count of tasks ECS believes it
 * started, and the target group reports how many of them the load balancer is
 * willing to send a request to. Those two numbers disagree for the entire
 * duration of a failed deployment, which is exactly the window an operator is
 * staring at this page. One call per target group, and the estate has two.
 */
export const TARGET_HEALTH_TTL_MS = 10_000

/* ------------------------------------------------------------------ ECR -- */

/** Repositories and their lifecycle policy: configuration Terraform writes. */
export const ECR_REPO_TTL_MS = 600_000

/**
 * Image tags and their digests — which build is actually in the registry.
 *
 * A minute, because this is the read that answers "did the image the pipeline
 * says it pushed actually arrive", asked immediately after a deploy.
 */
export const ECR_IMAGE_TTL_MS = 60_000

/**
 * Image scan findings.
 *
 * ECR rescans on its own schedule — on push, and then daily for enhanced
 * scanning. Asking more often than the scanner runs returns the same CVE list
 * and bills the same API. Fifteen minutes is already faster than the source.
 */
export const ECR_SCAN_TTL_MS = 900_000

/* ---------------------------------------------------------- ElastiCache -- */

/** Cache cluster and replication-group status, node type and endpoint. */
export const ELASTICACHE_TTL_MS = 120_000

/**
 * Cache parameters — `maxmemory-policy` and the rest of the parameter group.
 *
 * These are a Terraform declaration. An hour, because re-reading them faster
 * cannot change the answer and `DescribeCacheParameters` returns the entire
 * engine default set, which is hundreds of rows.
 */
export const ELASTICACHE_PARAM_TTL_MS = 3_600_000

/* -------------------------------------------------------------- DynamoDB -- */

/**
 * The registry table as a CONTROL-PLANE object: capacity mode, encryption,
 * point-in-time recovery and TTL.
 *
 * Not the table's contents — `lib/registry.ts` reads those and is the only
 * thing that may. This is "is PITR on for the table that holds every tenant's
 * record", which is a question about the table and not about a tenant. It moves
 * on a Terraform apply, so five minutes.
 */
export const DYNAMODB_TABLE_TTL_MS = 300_000

/* ------------------------------------------------------------ CloudWatch -- */

/**
 * Metric datapoints.
 *
 * One minute because that is CloudWatch's own publication interval for the
 * standard ECS, ALB, RDS and SQS metrics: a faster poll returns the datapoint
 * it returned last time and is billed per metric per request. `GetMetricData`
 * batches up to 500 queries into one call, so this cadence is one request, not
 * one per metric.
 */
export const METRIC_DATA_TTL_MS = 60_000

/** Dashboards are documents somebody wrote. Fifteen minutes is generous. */
export const DASHBOARD_TTL_MS = 900_000

/* ----------------------------------------------------------------- logs -- */

/** Metric filters are configuration: the pattern that turns a log into an alarm. */
export const METRIC_FILTER_TTL_MS = 900_000

/**
 * The tail of a log group.
 *
 * Thirty seconds — not below it, deliberately. This is read while somebody is
 * looking at an incident, but `FilterLogEvents` scans ingested bytes and is
 * billed for them, so a console left open on this panel is a line on the bill.
 */
export const LOG_EVENTS_TTL_MS = 30_000

/* ------------------------------------------------------------------- S3 -- */

/** Which buckets exist. One call, account-wide, and rarely different. */
export const S3_INVENTORY_TTL_MS = 600_000

/**
 * The posture Terraform sets on a bucket: public-access block, encryption,
 * versioning, lifecycle, policy status, tagging and CORS.
 *
 * Seven calls per bucket, so this cannot be fast; five minutes. It is faster
 * than the bucket list because the LIST changes when somebody provisions and
 * the POSTURE changes when somebody makes a mistake.
 */
export const S3_POSTURE_TTL_MS = 300_000

/* ------------------------------------------------------- Secrets Manager -- */

/**
 * Which secrets exist, when each was last rotated, and whether rotation is on.
 *
 * Separate from SECRET_REF_REFRESH_MS on purpose: that one gates a provisioning
 * run and must be nearly current, this one is an inventory sweep across the
 * account and would be a throttle at thirty seconds.
 */
export const SECRET_INVENTORY_TTL_MS = 600_000

/* ------------------------------------------------------------------ KMS -- */

/** A key's state and whether annual rotation is enabled. Configuration. */
export const KMS_KEY_TTL_MS = 3_600_000

/* ----------------------------------------------------------- CloudTrail -- */

/**
 * Whether a trail is LOGGING right now, and when it last delivered.
 *
 * `DescribeTrails` says a trail exists; only `GetTrailStatus` says it is
 * running. A trail that exists and is stopped is the audit gap this reads.
 */
export const TRAIL_STATUS_TTL_MS = 300_000

/**
 * Recent management events — who changed what.
 *
 * A minute, because the question is asked immediately after something changed,
 * and CloudTrail's own delivery latency is already several minutes on top.
 */
export const TRAIL_EVENTS_TTL_MS = 60_000

/* --------------------------------------------------------------- Config -- */

/** Which Config rules exist at all. Changes when somebody adds one. */
export const CONFIG_RULES_TTL_MS = 3_600_000

/** Compliance re-evaluates on resource change; fifteen minutes tracks it. */
export const CONFIG_COMPLIANCE_TTL_MS = 900_000

/* -------------------------------------------------------------- Route 53 -- */

/** Record sets in a hosted zone: where a domain actually points. */
export const ROUTE53_RECORDS_TTL_MS = 900_000

/* ------------------------------------------------------------ CloudFront -- */

/** A distribution's origins, behaviours and TLS policy. Configuration. */
export const CLOUDFRONT_CONFIG_TTL_MS = 900_000

/**
 * In-flight cache invalidations.
 *
 * Thirty seconds. An invalidation takes minutes to complete and is watched
 * immediately after a deploy, which is the only time this panel is open.
 */
export const CLOUDFRONT_INVALIDATION_TTL_MS = 30_000

/* -------------------------------------------------------------------- RDS -- */

/** Pending maintenance moves on AWS's calendar, in weeks. */
export const RDS_MAINTENANCE_TTL_MS = 3_600_000

/**
 * Instance events — failovers, restarts, storage autoscaling.
 *
 * A minute: this is the read that says whether the database restarted itself
 * while somebody was looking at a spike of 500s.
 */
export const RDS_EVENTS_TTL_MS = 60_000

/** Parameter groups are a Terraform declaration; an hour is generous. */
export const RDS_PARAMETER_GROUP_TTL_MS = 3_600_000

/* -------------------------------------------------------------------- ECS -- */

/**
 * A task definition REVISION.
 *
 * An hour, and this one is not a compromise: a revision is immutable. Revision
 * 41 will describe identically forever. Only the pointer in the service moves,
 * and `ecs:DescribeServices` reads the pointer at ECS_TTL_MS.
 */
export const ECS_TASK_DEFINITION_TTL_MS = 3_600_000

/* ---------------------------------------------------------- ServiceQuotas -- */

/**
 * Applied quota values.
 *
 * Six hours. A quota changes when AWS grants an increase, which takes days, and
 * the value matters as a ceiling being approached rather than as a live number.
 */
export const QUOTA_TTL_MS = 6 * 3_600_000

/* --------------------------------------------------------- Access Analyzer -- */

/**
 * Analyzers and their external-access findings.
 *
 * IAM Access Analyzer re-evaluates on a resource change with its own delay of
 * up to thirty minutes; fifteen minutes here is already ahead of the source.
 */
export const ACCESS_ANALYZER_TTL_MS = 900_000

/* ---------------------------------------------------------------- GuardDuty -- */

/** Whether GuardDuty is enabled in this region at all. Rarely toggled. */
export const GUARDDUTY_DETECTOR_TTL_MS = 3_600_000

/**
 * Findings.
 *
 * Two minutes. GuardDuty publishes new findings on a five-minute default
 * cadence, so this is faster than the source without being wasteful, and an
 * active-compromise finding is the one thing on this console worth interrupting
 * somebody for.
 */
export const GUARDDUTY_FINDINGS_TTL_MS = 120_000

/* ------------------------------------------------------------------ Pricing -- */

/**
 * Public list prices.
 *
 * A day. These change when AWS publishes a price change, which is measured in
 * months, and the response bodies are megabytes.
 */
export const PRICING_TTL_MS = 24 * 3_600_000

/* --------------------------------------------------------------------- WAF -- */

/** Web ACLs and which one is associated with the load balancer. Configuration. */
export const WAF_TTL_MS = 900_000

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
  "organizations:ListRoots": {
    iamActions: ["organizations:ListRoots"],
    resource: "*",
    refreshMs: ORGANIZATION_REFRESH_MS,
    surface: "organization",
    reads: "the Organization root every organizational unit hangs from",
  },
  "organizations:ListOrganizationalUnitsForParent": {
    iamActions: ["organizations:ListOrganizationalUnitsForParent"],
    resource: "*",
    refreshMs: ORGANIZATION_REFRESH_MS,
    surface: "organization",
    reads: "the organizational units that actually exist, and which parent each hangs from — the parent is what decides the guardrails it inherits",
  },
  "organizations:ListPoliciesForTarget": {
    iamActions: ["organizations:ListPoliciesForTarget"],
    resource: "*",
    refreshMs: ORGANIZATION_REFRESH_MS,
    surface: "organization",
    reads: "the service control policies attached at an organizational unit, so a declared guardrail can be told from an assumed one",
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
    //
    // The partition is a wildcard, not the literal `aws`. This engine refuses
    // to boot without AWS_PARTITION rather than assume one, and a statement an
    // operator pastes is not the place to make the assumption anyway: in
    // aws-us-gov an `arn:aws:` resource matches nothing and the grant silently
    // does not work.
    resource: "arn:*:secretsmanager:*:*:secret:tenure/*",
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

  /* -------------------------------------------------- SES (SESv2 API) --
   * Terraform provisions the domain identity, the from-address identity and
   * the configuration set. Nothing read them back, so "the pilot cannot mail
   * this domain" and "the pilot has not been given production access" were
   * both invisible from the console that provisioned them.
   *
   * SESv2's IAM actions carry the `ses:` prefix — the same namespace as the
   * v1 API — which is why the action names below do not say "sesv2".
   *
   * `ses:SendEmail` is deliberately absent and is explicitly DENIED on the
   * task role: a console that can read every tenant's mail configuration must
   * not also be able to send as them.
   */
  "ses:GetAccount": {
    iamActions: ["ses:GetAccount"],
    // Account-level; the API has no resource to scope to.
    resource: "*",
    refreshMs: SES_ACCOUNT_TTL_MS,
    surface: "posture",
    reads: "whether this account is still in the SES sandbox, its 24-hour quota and how much of it is spent",
  },
  "ses:ListEmailIdentities": {
    iamActions: ["ses:ListEmailIdentities"],
    resource: "*",
    refreshMs: SES_CONFIG_TTL_MS,
    surface: "estate",
    reads: "the sending identities this engine created and whether each is actually verified",
  },
  "ses:ListConfigurationSets": {
    iamActions: ["ses:ListConfigurationSets"],
    resource: "*",
    refreshMs: SES_CONFIG_TTL_MS,
    surface: "estate",
    reads: "which configuration sets exist, which is the name every GetConfigurationSet needs",
  },
  "ses:GetConfigurationSet": {
    iamActions: ["ses:GetConfigurationSet"],
    // This one genuinely scopes: the ARN pattern is written with a wildcard
    // partition rather than a literal `aws`, because this engine refuses to
    // invent a partition anywhere else and a policy is not the exception.
    resource: "arn:*:ses:*:*:configuration-set/*",
    refreshMs: SES_CONFIG_TTL_MS,
    surface: "estate",
    reads: "one configuration set's TLS policy, reputation tracking and whether sending is enabled on it",
  },
  "ses:ListSuppressedDestinations": {
    iamActions: ["ses:ListSuppressedDestinations"],
    resource: "*",
    refreshMs: SES_SUPPRESSION_TTL_MS,
    surface: "health",
    reads: "addresses SES will refuse to mail because they bounced or complained",
  },

  /* --------------------------------------------------------------- SQS --
   * Five queues in `sqs.tf`, two of them dead-letter queues, and no way to see
   * that anything had landed in one. A DLQ with messages in it is a delivery
   * that failed and nobody was told.
   */
  "sqs:ListQueues": {
    iamActions: ["sqs:ListQueues"],
    resource: "*",
    refreshMs: SQS_QUEUE_TTL_MS,
    surface: "estate",
    reads: "every queue URL in the region, which is the input to every depth read",
  },
  "sqs:GetQueueAttributes": {
    iamActions: ["sqs:GetQueueAttributes"],
    resource: "arn:*:sqs:*:*:*",
    refreshMs: SQS_DEPTH_TTL_MS,
    surface: "health",
    reads: "one queue's visible, in-flight and delayed message counts, and its redrive policy",
  },

  /* ------------------------------------------------------------ Lambda -- */
  "lambda:ListFunctions": {
    iamActions: ["lambda:ListFunctions"],
    resource: "*",
    refreshMs: LAMBDA_TTL_MS,
    surface: "estate",
    reads: "functions, their runtime, memory, timeout and when each was last modified",
  },
  "lambda:GetFunctionConcurrency": {
    iamActions: ["lambda:GetFunctionConcurrency"],
    resource: "arn:*:lambda:*:*:function:*",
    refreshMs: LAMBDA_TTL_MS,
    surface: "estate",
    reads: "one function's reserved concurrency — absent means it shares the account pool",
  },

  /* --------------------------------------------------------------- IAM --
   * STUDIO-000-009 asks for console-created and unmanaged resources,
   * long-lived keys and wildcard policies.
   *
   * `GetAccountAuthorizationDetails` is ONE call that returns roles, users,
   * their attached and inline policies AND the policy documents themselves,
   * which is what a wildcard sweep has to read. The alternative is
   * ListRoles → ListAttachedRolePolicies → GetPolicy → GetPolicyVersion →
   * ListRolePolicies → GetRolePolicy: six grants, N+1 calls, and six chances
   * for one of them to be the denied one that quietly empties the sweep.
   *
   * Every mutating IAM verb is explicitly DENIED on the task role. That Deny
   * used to be `iam:*`, which would have refused these two reads as well —
   * see the note in infrastructure/studio/iam.tf.
   */
  "iam:GetAccountAuthorizationDetails": {
    iamActions: ["iam:GetAccountAuthorizationDetails"],
    resource: "*",
    refreshMs: IAM_POSTURE_TTL_MS,
    surface: "security",
    reads: "every role and user with its attached and inline policy documents, which is where a wildcard grant is visible",
  },
  "iam:ListAccessKeys": {
    iamActions: ["iam:ListAccessKeys"],
    resource: "arn:*:iam::*:user/*",
    refreshMs: IAM_POSTURE_TTL_MS,
    surface: "security",
    reads: "one user's access keys and their creation dates — a long-lived key is an age, not a boolean",
  },

  /* ----------------------------------------------------------- Budgets --
   * The IAM action is `budgets:ViewBudget`, NOT `budgets:DescribeBudgets`.
   * AWS Budgets authorizes its classic budget APIs with two actions,
   * ViewBudget and ModifyBudget, and a policy naming the API's own name grants
   * nothing at all — it denies quietly, which reads exactly like an account
   * with no budgets. The capability is keyed by the API and grants the action.
   */
  "budgets:DescribeBudgets": {
    iamActions: ["budgets:ViewBudget"],
    resource: "arn:*:budgets::*:budget/*",
    refreshMs: BUDGETS_TTL_MS,
    surface: "cost",
    reads: "each budget's limit, actual and forecast spend, and the thresholds that are supposed to notify somebody",
  },

  /* -------------------------------------------------------- AWS Health --
   * Needs a Business or Enterprise Support plan. On any lesser plan the API
   * raises `SubscriptionRequiredException`, which `read.ts` maps to
   * UNCONFIGURED with the plan named — not to ERROR, because no IAM change
   * fixes it, and not to EMPTY, because "no support plan" is not "no events".
   */
  "health:DescribeEvents": {
    iamActions: ["health:DescribeEvents"],
    resource: "*",
    refreshMs: AWS_HEALTH_TTL_MS,
    surface: "health",
    reads: "open and upcoming AWS-side events affecting this account, with their services and regions",
  },
  "health:DescribeAffectedEntities": {
    iamActions: ["health:DescribeAffectedEntities"],
    resource: "*",
    refreshMs: AWS_HEALTH_TTL_MS,
    surface: "health",
    reads: "which of this account's resources one AWS Health event actually touches",
  },

  /* ------------------------------------------------------ EventBridge --
   * `scheduler.tf`'s rule is the only thing that makes deliverable reminders
   * fire. A DISABLED rule is a job that stopped running and said nothing, and
   * a rule whose target was removed is the same outage one level down.
   */
  "events:ListRules": {
    iamActions: ["events:ListRules"],
    resource: "*",
    refreshMs: EVENTBRIDGE_TTL_MS,
    surface: "estate",
    reads: "every rule on a bus, its schedule or pattern, and whether it is ENABLED or DISABLED",
  },
  "events:ListTargetsByRule": {
    iamActions: ["events:ListTargetsByRule"],
    resource: "arn:*:events:*:*:rule/*",
    refreshMs: EVENTBRIDGE_TTL_MS,
    surface: "estate",
    reads: "what one rule actually invokes — a rule with no target is enabled and inert",
  },

  /* ------------------------------------------------------------ Cognito --
   * The Studio's OWN authentication, and the only part of this registry that
   * reads the thing standing in front of it.
   *
   * `infrastructure/studio/cognito.tf` creates the pool with MFA ON, one
   * app client and one hosted domain. Nothing read any of it back, so "MFA
   * was turned down to OPTIONAL" and "somebody added a user" were both
   * invisible from the console they let you into.
   *
   * The IAM prefix is `cognito-idp`, NOT `cognito` and not the SDK package's
   * `cognito-identity-provider`. A policy naming either of the other two
   * grants nothing and denies quietly, which on a login page reads as an
   * outage. `cognito-identity` is a DIFFERENT service (identity pools), which
   * this platform does not use.
   *
   * `AdminGetUser`, `AdminCreateUser` and every other `Admin*` verb are
   * absent and will stay absent: this console reports on who may sign in; it
   * does not administer them.
   */
  "cognito-idp:ListUserPools": {
    iamActions: ["cognito-idp:ListUserPools"],
    // No resource-level scoping: the call enumerates, so there is no ARN to
    // name until after it has answered.
    resource: "*",
    refreshMs: COGNITO_POOL_TTL_MS,
    surface: "identity",
    reads: "the user pools in this account, which is how the console finds the one guarding itself",
  },
  "cognito-idp:DescribeUserPool": {
    iamActions: ["cognito-idp:DescribeUserPool"],
    resource: "arn:*:cognito-idp:*:*:userpool/*",
    refreshMs: COGNITO_POOL_TTL_MS,
    surface: "identity",
    reads: "one pool's password policy, account-recovery setting and whether self-signup is open",
  },
  "cognito-idp:ListUserPoolClients": {
    iamActions: ["cognito-idp:ListUserPoolClients"],
    resource: "arn:*:cognito-idp:*:*:userpool/*",
    refreshMs: COGNITO_POOL_TTL_MS,
    surface: "identity",
    reads: "the app clients registered against a pool — an extra one is an extra way in",
  },
  "cognito-idp:DescribeUserPoolClient": {
    iamActions: ["cognito-idp:DescribeUserPoolClient"],
    resource: "arn:*:cognito-idp:*:*:userpool/*",
    refreshMs: COGNITO_POOL_TTL_MS,
    surface: "identity",
    reads: "one client's callback URLs, OAuth flows and token lifetimes",
  },
  "cognito-idp:DescribeUserPoolDomain": {
    iamActions: ["cognito-idp:DescribeUserPoolDomain"],
    // The domain API takes a domain string, not a pool ARN, and authorizes on
    // the pool the domain belongs to.
    resource: "arn:*:cognito-idp:*:*:userpool/*",
    refreshMs: COGNITO_POOL_TTL_MS,
    surface: "identity",
    reads: "the hosted-UI domain operators are redirected to, and its certificate status",
  },
  "cognito-idp:GetUserPoolMfaConfig": {
    iamActions: ["cognito-idp:GetUserPoolMfaConfig"],
    resource: "arn:*:cognito-idp:*:*:userpool/*",
    refreshMs: COGNITO_POOL_TTL_MS,
    surface: "identity",
    reads: "whether MFA is ON, OPTIONAL or OFF for the pool that guards this console",
  },
  "cognito-idp:ListUsers": {
    iamActions: ["cognito-idp:ListUsers"],
    resource: "arn:*:cognito-idp:*:*:userpool/*",
    refreshMs: COGNITO_OPERATORS_TTL_MS,
    surface: "identity",
    reads: "who may sign in to this console, and whether each account is enabled and confirmed",
  },

  /* ---------------------------------------------------------------- EC2 --
   * The network `vpc.tf` and `security_groups.tf` build.
   *
   * An `aws_vpc_security_group_ingress_rule` with `cidr_ipv4 = "0.0.0.0/0"`
   * is a database on the public internet, and nothing here could see one.
   *
   * Every EC2 `Describe*` action in this block carries `resource: "*"`, and
   * that is not laziness: EC2's Describe actions genuinely do not support
   * resource-level permissions. A policy that tries to scope them to a VPC
   * ARN denies every call, and the console reads as an empty network.
   *
   * No `RunInstances`, no `AuthorizeSecurityGroupIngress`, no
   * `TerminateInstances`. This service is the reason the write-verb assertion
   * in capabilities.test.ts exists.
   */
  "ec2:DescribeVpcs": {
    iamActions: ["ec2:DescribeVpcs"],
    resource: "*",
    refreshMs: NETWORK_TOPOLOGY_TTL_MS,
    surface: "estate",
    reads: "the VPCs this estate runs in, their CIDR blocks and which is the default",
  },
  "ec2:DescribeSubnets": {
    iamActions: ["ec2:DescribeSubnets"],
    resource: "*",
    refreshMs: NETWORK_TOPOLOGY_TTL_MS,
    surface: "estate",
    reads: "subnets, their availability zones and whether a public IP is assigned on launch",
  },
  "ec2:DescribeSecurityGroups": {
    iamActions: ["ec2:DescribeSecurityGroups"],
    resource: "*",
    refreshMs: SECURITY_GROUP_TTL_MS,
    surface: "security",
    reads: "every security group's ingress and egress rules — this is where an open 0.0.0.0/0 is visible",
  },
  "ec2:DescribeRouteTables": {
    iamActions: ["ec2:DescribeRouteTables"],
    resource: "*",
    refreshMs: NETWORK_TOPOLOGY_TTL_MS,
    surface: "estate",
    reads: "routes and their associations — a private subnet routed at an internet gateway is not private",
  },
  "ec2:DescribeInternetGateways": {
    iamActions: ["ec2:DescribeInternetGateways"],
    resource: "*",
    refreshMs: NETWORK_TOPOLOGY_TTL_MS,
    surface: "estate",
    reads: "internet gateways and the VPCs they are attached to",
  },
  "ec2:DescribeNatGateways": {
    iamActions: ["ec2:DescribeNatGateways"],
    // Terraform provisions none. That IS the reading: a private subnet with no
    // NAT gateway cannot reach the internet, which is a deliberate posture on
    // one estate and a broken deployment on another, and the console should be
    // able to say which. A NAT gateway nobody declared is also the single most
    // expensive thing that appears in an account by accident.
    resource: "*",
    refreshMs: NETWORK_TOPOLOGY_TTL_MS,
    surface: "estate",
    reads: "NAT gateways, which are both an egress path and a standing hourly charge",
  },
  "ec2:DescribeVpcEndpoints": {
    iamActions: ["ec2:DescribeVpcEndpoints"],
    resource: "*",
    refreshMs: NETWORK_TOPOLOGY_TTL_MS,
    surface: "estate",
    reads: "interface and gateway endpoints — whether traffic to S3 and Secrets Manager leaves the VPC",
  },
  "ec2:DescribeNetworkAcls": {
    iamActions: ["ec2:DescribeNetworkAcls"],
    // Terraform declares no NACL, but every VPC has a default one whose rules
    // are ALLOW ALL both ways. "We did not configure it" and "it allows
    // everything" are the same fact, and only this call shows it.
    resource: "*",
    refreshMs: SECURITY_GROUP_TTL_MS,
    surface: "security",
    reads: "network ACL rules, including the default ACL nobody wrote and which allows everything",
  },

  /* ------------------------------------------- Elastic Load Balancing v2 --
   * `alb.tf` creates two load balancers, two listeners and two target groups.
   *
   * The IAM prefix is `elasticloadbalancing` — one word, no version suffix,
   * shared by the v1 and v2 APIs. It is not `elb`, not `elbv2` and not the SDK
   * package's `elastic-load-balancing-v2`.
   *
   * Target health is the liveness signal this console was missing: ECS reports
   * the tasks it started, and only the target group reports which of them the
   * load balancer will actually send a request to.
   *
   * ELB's Describe actions do not support resource-level permissions, so these
   * are honestly `"*"` rather than an ARN pattern that would deny everything.
   */
  "elasticloadbalancing:DescribeLoadBalancers": {
    iamActions: ["elasticloadbalancing:DescribeLoadBalancers"],
    resource: "*",
    refreshMs: LOAD_BALANCER_TTL_MS,
    surface: "estate",
    reads: "load balancers, their scheme, their DNS name and the subnets they sit in",
  },
  "elasticloadbalancing:DescribeListeners": {
    iamActions: ["elasticloadbalancing:DescribeListeners"],
    resource: "*",
    refreshMs: LOAD_BALANCER_TTL_MS,
    surface: "estate",
    reads: "listeners, their ports, protocols and TLS policies",
  },
  "elasticloadbalancing:DescribeTargetGroups": {
    iamActions: ["elasticloadbalancing:DescribeTargetGroups"],
    resource: "*",
    refreshMs: LOAD_BALANCER_TTL_MS,
    surface: "estate",
    reads: "target groups and their health-check path, interval and thresholds",
  },
  "elasticloadbalancing:DescribeTargetHealth": {
    iamActions: ["elasticloadbalancing:DescribeTargetHealth"],
    resource: "*",
    refreshMs: TARGET_HEALTH_TTL_MS,
    surface: "health",
    reads: "which targets the load balancer will actually route to, and why it refuses the rest",
  },
  "elasticloadbalancing:DescribeRules": {
    iamActions: ["elasticloadbalancing:DescribeRules"],
    resource: "*",
    refreshMs: LOAD_BALANCER_TTL_MS,
    surface: "estate",
    reads: "listener rules — the conditions that decide which target group a request reaches",
  },

  /* ---------------------------------------------------------------- ECR --
   * `ecr.tf` creates two repositories with scan-on-push and a lifecycle
   * policy. Nothing read the scan results, so a critical CVE in the image
   * currently serving the pilot was a finding nobody had.
   */
  "ecr:DescribeRepositories": {
    iamActions: ["ecr:DescribeRepositories"],
    resource: "arn:*:ecr:*:*:repository/*",
    refreshMs: ECR_REPO_TTL_MS,
    surface: "estate",
    reads: "repositories, whether tags are immutable and whether scan-on-push is enabled",
  },
  "ecr:DescribeImages": {
    iamActions: ["ecr:DescribeImages"],
    resource: "arn:*:ecr:*:*:repository/*",
    refreshMs: ECR_IMAGE_TTL_MS,
    surface: "estate",
    reads: "image tags, digests, sizes and push times — which build is actually in the registry",
  },
  "ecr:DescribeImageScanFindings": {
    iamActions: ["ecr:DescribeImageScanFindings"],
    resource: "arn:*:ecr:*:*:repository/*",
    refreshMs: ECR_SCAN_TTL_MS,
    surface: "security",
    reads: "the vulnerabilities ECR found in one image, by severity",
  },
  "ecr:GetLifecyclePolicy": {
    iamActions: ["ecr:GetLifecyclePolicy"],
    resource: "arn:*:ecr:*:*:repository/*",
    refreshMs: ECR_REPO_TTL_MS,
    surface: "retention",
    reads: "the expiry rules that decide how many old images this account keeps paying for",
  },

  /* -------------------------------------------------------- ElastiCache -- */
  "elasticache:DescribeCacheClusters": {
    iamActions: ["elasticache:DescribeCacheClusters"],
    // ElastiCache's Describe actions carry no resource-level permissions.
    resource: "*",
    refreshMs: ELASTICACHE_TTL_MS,
    surface: "estate",
    reads: "cache clusters, their engine version, node type and status",
  },
  "elasticache:DescribeReplicationGroups": {
    iamActions: ["elasticache:DescribeReplicationGroups"],
    resource: "*",
    refreshMs: ELASTICACHE_TTL_MS,
    surface: "estate",
    // Terraform provisions a single-node `aws_elasticache_cluster` and no
    // replication group at all. An EMPTY reading here is the honest answer to
    // "is there a failover replica" — which is no.
    reads: "replication groups and their automatic-failover setting — an empty answer means no replica",
  },
  "elasticache:DescribeCacheParameters": {
    iamActions: ["elasticache:DescribeCacheParameters"],
    resource: "*",
    refreshMs: ELASTICACHE_PARAM_TTL_MS,
    surface: "estate",
    reads: "the parameter group's values, including the maxmemory-policy that decides what is evicted",
  },

  /* ----------------------------------------------- DynamoDB control plane --
   * The registry table's SHAPE, not its contents.
   *
   * `lib/registry.ts` reads the items and is the only thing that may. These
   * four answer "is point-in-time recovery on for the table holding every
   * tenant's record", which is a question about the table.
   */
  "dynamodb:ListTables": {
    iamActions: ["dynamodb:ListTables"],
    resource: "*",
    refreshMs: DYNAMODB_TABLE_TTL_MS,
    surface: "estate",
    reads: "the tables in this region, which is how a table nobody declared is found",
  },
  "dynamodb:DescribeTable": {
    iamActions: ["dynamodb:DescribeTable"],
    resource: "arn:*:dynamodb:*:*:table/*",
    refreshMs: DYNAMODB_TABLE_TTL_MS,
    surface: "estate",
    reads: "billing mode, item count, size, indexes and the KMS key a table is encrypted with",
  },
  "dynamodb:DescribeContinuousBackups": {
    iamActions: ["dynamodb:DescribeContinuousBackups"],
    resource: "arn:*:dynamodb:*:*:table/*",
    refreshMs: DYNAMODB_TABLE_TTL_MS,
    surface: "retention",
    reads: "whether point-in-time recovery is enabled, and the window it can restore to",
  },
  "dynamodb:DescribeTimeToLive": {
    iamActions: ["dynamodb:DescribeTimeToLive"],
    resource: "arn:*:dynamodb:*:*:table/*",
    refreshMs: DYNAMODB_TABLE_TTL_MS,
    surface: "retention",
    reads: "whether a TTL attribute is deleting rows, and which attribute it reads",
  },

  /* ------------------------------------------------- CloudWatch metrics --
   * Alarms were described and no metric was ever READ. An alarm in OK state
   * tells you a threshold is not crossed; it does not tell you the number is
   * climbing, and "climbing" is the reading an operator acts on.
   */
  "cloudwatch:GetMetricData": {
    iamActions: ["cloudwatch:GetMetricData"],
    resource: "*",
    refreshMs: METRIC_DATA_TTL_MS,
    surface: "health",
    reads: "actual datapoints for a metric over a window — the number behind an alarm's state",
  },
  "cloudwatch:ListDashboards": {
    iamActions: ["cloudwatch:ListDashboards"],
    resource: "*",
    refreshMs: DASHBOARD_TTL_MS,
    surface: "health",
    reads: "the dashboards this account has, including the one cloudwatch.tf creates",
  },
  "cloudwatch:GetDashboard": {
    iamActions: ["cloudwatch:GetDashboard"],
    resource: "*",
    refreshMs: DASHBOARD_TTL_MS,
    surface: "health",
    reads: "one dashboard's widget definitions — which metrics somebody decided were the ones to watch",
  },

  /* --------------------------------------------------------------- logs -- */
  "logs:DescribeMetricFilters": {
    iamActions: ["logs:DescribeMetricFilters"],
    resource: "arn:*:logs:*:*:log-group:*",
    refreshMs: METRIC_FILTER_TTL_MS,
    surface: "health",
    reads: "the patterns that turn a log line into a metric, and the metric each one feeds",
  },
  "logs:FilterLogEvents": {
    iamActions: ["logs:FilterLogEvents"],
    resource: "arn:*:logs:*:*:log-group:*",
    refreshMs: LOG_EVENTS_TTL_MS,
    surface: "health",
    // NOTE for the IAM grant: `logs:FilterLogEvents` is a READ whose name does
    // not begin with List/Describe/Get, so `studio-task-role-is-narrow`'s
    // read-verb rule will refuse it until it is named in that file's
    // READS_NOT_SPELLED_AS_READS set — the same treatment `budgets:ViewBudget`
    // already gets. That edit is the review, and it is deliberate.
    reads: "matching log lines from a group over a window — the errors behind a failing deployment",
  },

  /* ----------------------------------------------------------------- S3 --
   * `s3.tf` sets a public-access block, encryption, versioning, lifecycle and
   * CORS on two buckets. Only `ListObjectVersions` was ever read back, so the
   * posture Terraform declares and the posture the account holds were never
   * compared — and the drift that matters is somebody clearing the
   * public-access block by hand.
   *
   * Bucket-level reads only. `s3:GetObject` is absent and stays absent: these
   * buckets hold tenant documents, and a console that renders every tenant's
   * configuration must not be able to read any tenant's files.
   *
   * Three of these authorize under a DIFFERENT name than their API, which is
   * the same trap `budgets:ViewBudget` already sprang. The names below are the
   * IAM ones.
   */
  "s3:ListBuckets": {
    // The API is ListBuckets; the IAM action is `s3:ListAllMyBuckets`.
    iamActions: ["s3:ListAllMyBuckets"],
    resource: "*",
    refreshMs: S3_INVENTORY_TTL_MS,
    surface: "estate",
    reads: "every bucket in the account, which is the input to each posture read below",
  },
  "s3:GetBucketPublicAccessBlock": {
    // Keyed by the IAM action rather than by the API, which is the other way
    // round from the rest of this block. The S3 operation is called
    // `GetPublicAccessBlock` and the action that authorizes it is
    // `s3:GetBucketPublicAccessBlock`; the action is the name an operator sees
    // in a denial and pastes into a policy, so that is the name on the key.
    iamActions: ["s3:GetBucketPublicAccessBlock"],
    resource: "arn:*:s3:::*",
    refreshMs: S3_POSTURE_TTL_MS,
    surface: "posture",
    reads: "whether all four public-access blocks are still set on a bucket",
  },
  "s3:GetBucketEncryption": {
    // The API is GetBucketEncryption; the IAM action is
    // `s3:GetEncryptionConfiguration`. A policy naming the API name grants
    // nothing and denies quietly.
    iamActions: ["s3:GetEncryptionConfiguration"],
    resource: "arn:*:s3:::*",
    refreshMs: S3_POSTURE_TTL_MS,
    surface: "posture",
    reads: "the default encryption on a bucket, and whether it uses a customer-managed key",
  },
  "s3:GetBucketVersioning": {
    iamActions: ["s3:GetBucketVersioning"],
    resource: "arn:*:s3:::*",
    refreshMs: S3_POSTURE_TTL_MS,
    surface: "posture",
    reads: "whether versioning and MFA-delete are on — versioning is what makes a deletion recoverable",
  },
  "s3:GetBucketLifecycleConfiguration": {
    // IAM action: `s3:GetLifecycleConfiguration`, not the API's name.
    iamActions: ["s3:GetLifecycleConfiguration"],
    resource: "arn:*:s3:::*",
    refreshMs: S3_POSTURE_TTL_MS,
    surface: "retention",
    reads: "the expiry and transition rules that decide how long a tenant's objects keep billing",
  },
  "s3:GetBucketPolicyStatus": {
    // Deliberately NOT `s3:GetBucketPolicy`. The status is a boolean — "is
    // this bucket public" — and the policy document itself can name tenant
    // principals and prefixes this console has no reason to hold.
    iamActions: ["s3:GetBucketPolicyStatus"],
    resource: "arn:*:s3:::*",
    refreshMs: S3_POSTURE_TTL_MS,
    surface: "posture",
    reads: "whether S3 considers a bucket public, without reading the policy that made it so",
  },
  "s3:GetBucketTagging": {
    iamActions: ["s3:GetBucketTagging"],
    resource: "arn:*:s3:::*",
    refreshMs: S3_POSTURE_TTL_MS,
    surface: "estate",
    reads: "a bucket's tags, which is how storage cost is attributed to a tenant",
  },
  "s3:GetBucketCors": {
    // IAM action: `s3:GetBucketCORS`, capitalised as the reference spells it.
    iamActions: ["s3:GetBucketCORS"],
    resource: "arn:*:s3:::*",
    refreshMs: S3_POSTURE_TTL_MS,
    surface: "posture",
    reads: "which origins may call this bucket from a browser — a `*` here is an upload endpoint for anyone",
  },

  /* ----------------------------------------------------- Secrets Manager --
   * `DescribeSecret` answers "does this one reference resolve". It cannot
   * answer "what secrets exist and is any of them rotating", because it needs
   * the name first. `ListSecrets` is the inventory half.
   *
   * Still metadata, still never a value: `GetSecretValue` is absent, is denied
   * on the role, and its NAME appearing anywhere under
   * `apps/system-studio/src` fails the build.
   */
  "secretsmanager:ListSecrets": {
    iamActions: ["secretsmanager:ListSecrets"],
    // ListSecrets enumerates and therefore has no ARN to scope to. The
    // per-secret read above stays scoped to `tenure/*`.
    resource: "*",
    refreshMs: SECRET_INVENTORY_TTL_MS,
    surface: "posture",
    reads: "which secrets exist, when each was last changed and whether rotation is on — never a value",
  },

  /* ----------------------------------------------------------------- KMS --
   * `kms:ListKeys` said which keys exist. Neither of these says whether a key
   * is still enabled, whether it is scheduled for deletion, or whether the
   * annual rotation an auditor asks about is actually switched on.
   */
  "kms:DescribeKey": {
    iamActions: ["kms:DescribeKey"],
    resource: "arn:*:kms:*:*:key/*",
    refreshMs: KMS_KEY_TTL_MS,
    surface: "posture",
    reads: "a key's state, its manager, and whether it is pending deletion with data still encrypted under it",
  },
  "kms:GetKeyRotationStatus": {
    iamActions: ["kms:GetKeyRotationStatus"],
    resource: "arn:*:kms:*:*:key/*",
    refreshMs: KMS_KEY_TTL_MS,
    surface: "posture",
    reads: "whether automatic annual rotation is enabled on a customer-managed key",
  },

  /* ---------------------------------------------------------- CloudTrail --
   * `DescribeTrails` says a trail EXISTS. Only `GetTrailStatus` says it is
   * running: a trail that was created correctly and then stopped describes
   * identically to one that is logging, and the difference is the entire audit.
   */
  "cloudtrail:GetTrailStatus": {
    iamActions: ["cloudtrail:GetTrailStatus"],
    resource: "arn:*:cloudtrail:*:*:trail/*",
    refreshMs: TRAIL_STATUS_TTL_MS,
    surface: "posture",
    reads: "whether a trail is logging right now and when it last delivered a file",
  },
  "cloudtrail:LookupEvents": {
    iamActions: ["cloudtrail:LookupEvents"],
    resource: "*",
    refreshMs: TRAIL_EVENTS_TTL_MS,
    surface: "security",
    reads: "recent management events — who changed a security group, and from which principal",
  },

  /* --------------------------------------------------------------- Config --
   * The aggregator read says whether configuration state is collected. These
   * two say whether anything is being CHECKED, and what failed.
   */
  "config:DescribeConfigRules": {
    iamActions: ["config:DescribeConfigRules"],
    resource: "*",
    refreshMs: CONFIG_RULES_TTL_MS,
    surface: "posture",
    reads: "which Config rules exist — an account with an aggregator and no rules checks nothing",
  },
  "config:DescribeComplianceByConfigRule": {
    iamActions: ["config:DescribeComplianceByConfigRule"],
    resource: "*",
    refreshMs: CONFIG_COMPLIANCE_TTL_MS,
    surface: "posture",
    reads: "each rule's compliance verdict and how many resources are failing it",
  },

  /* -------------------------------------------------------------- Route 53 --
   * The zone list said a zone exists. Only the record sets say where the
   * pilot's domain actually points, which is the reading that catches a
   * CloudFront distribution that was replaced and a record that was not.
   */
  "route53:ListResourceRecordSets": {
    iamActions: ["route53:ListResourceRecordSets"],
    resource: "arn:*:route53:::hostedzone/*",
    refreshMs: ROUTE53_RECORDS_TTL_MS,
    surface: "estate",
    reads: "the records in a zone, including the alias that decides where a tenant's domain resolves",
  },

  /* ------------------------------------------------------------ CloudFront --
   * `ListDistributions` returns a summary. The config carries the origins,
   * the cache behaviours and the viewer TLS policy — and `edge-access.tf`'s
   * whole purpose is that origins are reachable only through the edge.
   */
  "cloudfront:GetDistributionConfig": {
    iamActions: ["cloudfront:GetDistributionConfig"],
    resource: "arn:*:cloudfront::*:distribution/*",
    refreshMs: CLOUDFRONT_CONFIG_TTL_MS,
    surface: "estate",
    reads: "a distribution's origins, cache behaviours, attached functions and minimum TLS version",
  },
  "cloudfront:ListInvalidations": {
    iamActions: ["cloudfront:ListInvalidations"],
    resource: "arn:*:cloudfront::*:distribution/*",
    refreshMs: CLOUDFRONT_INVALIDATION_TTL_MS,
    surface: "health",
    reads: "in-flight and recent invalidations — whether a deploy's cache purge has actually completed",
  },

  /* ------------------------------------------------------------------- RDS --
   * The instance description says what the database IS. These say what is
   * about to happen to it and what already did.
   */
  "rds:DescribePendingMaintenanceActions": {
    iamActions: ["rds:DescribePendingMaintenanceActions"],
    resource: "*",
    refreshMs: RDS_MAINTENANCE_TTL_MS,
    surface: "health",
    reads: "forced upgrades and reboots AWS has scheduled, and the date they stop being optional",
  },
  "rds:DescribeEvents": {
    iamActions: ["rds:DescribeEvents"],
    resource: "*",
    refreshMs: RDS_EVENTS_TTL_MS,
    surface: "health",
    reads: "failovers, restarts and storage-autoscaling events on the database, with their times",
  },
  "rds:DescribeDBParameterGroups": {
    iamActions: ["rds:DescribeDBParameterGroups"],
    resource: "*",
    refreshMs: RDS_PARAMETER_GROUP_TTL_MS,
    surface: "estate",
    reads: "parameter groups and whether a change is pending a reboot to take effect",
  },

  /* ------------------------------------------------------------------- ECS --
   * `ecs:DescribeServices` reported desired and running counts. It could not
   * say WHICH task definition is deployed, what image that revision names, or
   * why an individual task stopped — which is the whole of a failed rollout.
   */
  "ecs:DescribeClusters": {
    iamActions: ["ecs:DescribeClusters"],
    resource: "arn:*:ecs:*:*:cluster/*",
    refreshMs: ECS_TTL_MS,
    surface: "estate",
    reads: "a cluster's capacity providers, registered container instances and running-task totals",
  },
  "ecs:ListTasks": {
    iamActions: ["ecs:ListTasks"],
    resource: "*",
    refreshMs: ECS_TTL_MS,
    surface: "estate",
    reads: "the task ARNs in a cluster or service, which is the input to describing them",
  },
  "ecs:DescribeTasks": {
    iamActions: ["ecs:DescribeTasks"],
    resource: "arn:*:ecs:*:*:task/*",
    refreshMs: ECS_TTL_MS,
    surface: "estate",
    reads: "each task's last status, health, stopped reason and container exit codes",
  },
  "ecs:DescribeTaskDefinition": {
    iamActions: ["ecs:DescribeTaskDefinition"],
    // No resource-level permissions on this action; a task-definition ARN in
    // the Resource would deny every call.
    resource: "*",
    refreshMs: ECS_TASK_DEFINITION_TTL_MS,
    surface: "estate",
    reads: "the image, CPU, memory and environment of a revision — which build is actually deployed",
  },

  /* ------------------------------------------------------------------- ACM --
   * The certificate list carries a status. It does not carry the expiry date,
   * the validation records, or the resources the certificate is in use by —
   * and a certificate that fails to renew because its CNAME was removed is
   * still `ISSUED` right up until it is not.
   */
  "acm:DescribeCertificate": {
    iamActions: ["acm:DescribeCertificate"],
    resource: "arn:*:acm:*:*:certificate/*",
    refreshMs: ACM_TTL_MS,
    surface: "estate",
    reads: "one certificate's expiry, renewal eligibility, validation records and what it is attached to",
  },

  /* --------------------------------------------------------- Service Quotas --
   * A quota is an outage with a date on it. ECS tasks per service, ELB rules
   * per listener, Lambda concurrency and VPC security groups per interface all
   * have ceilings this estate can reach without anything appearing to be wrong.
   *
   * The IAM prefix is `servicequotas`, one word — not `service-quotas`, which
   * is only how the SDK package is spelled.
   */
  "servicequotas:ListServiceQuotas": {
    iamActions: ["servicequotas:ListServiceQuotas"],
    resource: "*",
    refreshMs: QUOTA_TTL_MS,
    surface: "health",
    reads: "the applied quotas for one service, which is the ceiling a growing estate runs into",
  },
  "servicequotas:GetServiceQuota": {
    iamActions: ["servicequotas:GetServiceQuota"],
    resource: "*",
    refreshMs: QUOTA_TTL_MS,
    surface: "health",
    reads: "one quota's applied value, and whether it has been raised from the AWS default",
  },

  /* -------------------------------------------------------- Access Analyzer --
   * Security Hub aggregates findings only if it is enabled. Access Analyzer is
   * the direct read of the question that matters most here — is any resource
   * in this account shared outside it — and an account with no analyzer
   * returns EMPTY from that question forever without ever saying so.
   *
   * The IAM prefix is `access-analyzer`, hyphenated, although the SDK package
   * is `client-accessanalyzer`.
   */
  "access-analyzer:ListAnalyzers": {
    iamActions: ["access-analyzer:ListAnalyzers"],
    resource: "*",
    refreshMs: ACCESS_ANALYZER_TTL_MS,
    surface: "security",
    reads: "whether an analyzer exists at all — no analyzer means external access is unchecked, not absent",
  },
  "access-analyzer:ListFindingsV2": {
    iamActions: ["access-analyzer:ListFindingsV2"],
    resource: "arn:*:access-analyzer:*:*:analyzer/*",
    refreshMs: ACCESS_ANALYZER_TTL_MS,
    surface: "security",
    reads: "resources this account shares with another account, an organization or the public",
  },

  /* ---------------------------------------------------------------- GuardDuty --
   * The same shape of question one level down. `ListDetectors` returning
   * nothing is the finding: threat detection is off.
   */
  "guardduty:ListDetectors": {
    iamActions: ["guardduty:ListDetectors"],
    resource: "*",
    refreshMs: GUARDDUTY_DETECTOR_TTL_MS,
    surface: "security",
    reads: "whether GuardDuty is enabled in this region — an empty answer means nothing is watching",
  },
  "guardduty:ListFindings": {
    iamActions: ["guardduty:ListFindings"],
    resource: "arn:*:guardduty:*:*:detector/*",
    refreshMs: GUARDDUTY_FINDINGS_TTL_MS,
    surface: "security",
    reads: "the finding ids a detector currently holds, which is the input to reading them",
  },
  "guardduty:GetFindings": {
    iamActions: ["guardduty:GetFindings"],
    resource: "arn:*:guardduty:*:*:detector/*",
    refreshMs: GUARDDUTY_FINDINGS_TTL_MS,
    surface: "security",
    reads: "each finding's type, severity, resource and first and last seen times",
  },

  /* ------------------------------------------------------------------ Pricing --
   * List prices, so a proposed cell can be costed BEFORE it is provisioned.
   * Cost Explorer answers what was spent; only this answers what a change
   * would cost.
   *
   * REGIONAL CONSTRAINT, and a real one: the Price List API is served from a
   * small set of regions rather than from every region. That is a property of
   * the API, not a residency decision, and `client.ts` handles it by reading
   * the region from the environment — never by compiling one in. If the
   * environment does not name one, the read returns UNCONFIGURED saying so,
   * which is the honest answer and not an empty price list.
   */
  "pricing:ListPriceLists": {
    iamActions: ["pricing:ListPriceLists"],
    resource: "*",
    refreshMs: PRICING_TTL_MS,
    surface: "cost",
    reads: "the published price lists for a service, region and currency",
  },
  "pricing:GetProducts": {
    iamActions: ["pricing:GetProducts"],
    resource: "*",
    refreshMs: PRICING_TTL_MS,
    surface: "cost",
    reads: "the list price of one SKU — what a proposed instance class or node type would cost",
  },

  /* -------------------------------------------------------------------- WAF --
   * `GetWebACLForResource` against the load balancer answers the question that
   * matters: is there a web ACL in front of the pilot, or is the ALB taking
   * requests directly. An empty answer is "unprotected", and this console
   * should be able to say so out loud.
   */
  "wafv2:ListWebACLs": {
    iamActions: ["wafv2:ListWebACLs"],
    resource: "*",
    refreshMs: WAF_TTL_MS,
    surface: "security",
    reads: "the web ACLs defined in this scope — an empty answer means no WAF exists to attach",
  },
  "wafv2:GetWebACLForResource": {
    iamActions: ["wafv2:GetWebACLForResource"],
    // Authorizes on both the web ACL and the protected resource; there is no
    // single ARN that scopes it, so it is honestly a star.
    resource: "*",
    refreshMs: WAF_TTL_MS,
    surface: "security",
    reads: "which web ACL is actually associated with a load balancer — or that none is",
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
