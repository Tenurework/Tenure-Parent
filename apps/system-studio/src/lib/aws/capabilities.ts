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
