data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Pulls the image and reads the secret at task start.
resource "aws_iam_role" "execution" {
  name               = "${local.name_prefix}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
  tags               = local.tags
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "read_secret" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.studio.arn]
  }
}

resource "aws_iam_role_policy" "execution_secret" {
  name   = "${local.name_prefix}-read-secret"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.read_secret.json
}

# The running task's own role.
#
# It was deliberately empty while the Studio read only configuration that shipped
# in its image. It is no longer: `dynamodb.tf` attaches the six tenant-registry
# actions, and `studio_estate_read` below attaches the estate READS the console
# now performs. Nothing mutating has been added and nothing may be —
# `tests/security/studio-task-role-is-narrow.test.mjs` fails the build on an
# Allow that is not a List/Describe/Get, on a wildcard action, and on an
# AdministratorAccess-style attachment.
resource "aws_iam_role" "task" {
  name               = "${local.name_prefix}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
  tags               = local.tags
}

# ── What the Studio task may READ of the estate ─────────────────────────────
#
# STUDIO-000-007 / STUDIO-GATE-010. The task role held six DynamoDB actions and
# nothing else, so every ECS, RDS, CloudFront, ACM, CloudWatch, Organizations,
# Security Hub, CloudTrail, Config, Cost Explorer and Tagging read the console
# now makes would return AccessDenied on the first deploy. That is precisely the
# case STUDIO-000-007 makes renderable — the console says "unknown" and prints
# the statement below — but a control plane whose default state is blind is not
# a control plane.
#
# A SEPARATE aws_iam_role_policy, not an addition to `tenant-registry`, so a
# partial grant is a visible diff rather than six lines lost inside a policy
# about something else.
#
# Every action is a List/Describe/Get verb. There is no mutation here and there
# must never be: `tests/security/studio-task-role-is-narrow.test.mjs` parses this
# file and fails on an Allow whose action is not a read verb, on an Allow spelled
# with Create/Put/Delete/Update/Terminate/Send/Invoke/Attach/Detach/Modify, on an
# Allow action containing `*` ANYWHERE — `ecs:*` and `ec2:Describe*` both — and on
# an AdministratorAccess-style attachment. The six DynamoDB writes in dynamodb.tf
# are named in that guard explicitly, so adding a seventh mutation is a
# deliberate act on two files.
#
# ── Why some statements are Resource = "*" and some are not ────────────────
#
# Both answers are in `capabilities.ts`. Every capability carries the ARN
# pattern its call needs, and the guard compares the two files in BOTH
# directions: an action granted that no capability names fails, a capability
# with no grant fails, and a capability that names an ARN pattern but is granted
# on "*" fails. So this policy is derived from the registry rather than
# transcribed alongside it, and the two cannot drift.
#
# Where a statement below says Resource = "*", that is the AWS API rather than
# laziness. Most List and Describe calls have NO RESOURCE-LEVEL PERMISSIONS at
# all — `ec2:Describe*`, `elasticloadbalancing:Describe*`, `cognito-idp:List*`,
# `ecs:ListClusters`, `organizations:ListAccounts` and the rest are authorized
# account-wide or not at all, and there is no ARN meaning "the ECS services in
# this account" to put in a policy. A later reader "tightening" one of those into
# an ARN does not narrow the role; they produce a statement that grants nothing,
# and the surface it feeds goes permanently AccessDenied. Each star statement
# says so at its own Sid.
#
# Where the API DOES scope — a secret, a queue, a function, a rule, a budget, an
# IAM user, an SES configuration set — it is scoped, in `ScopedReads` below.
resource "aws_iam_role_policy" "studio_estate_read" {
  name = "estate-read"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "WhoAmI"
        Effect = "Allow"
        Action = ["sts:GetCallerIdentity"]
        # sts:GetCallerIdentity takes no resource at all; "*" is the only value
        # AWS accepts for it.
        Resource = "*"
      },
      {
        # The enumerations. Every one of these is an account-wide or
        # region-wide LIST whose entire job is to return things whose ARNs are
        # not known yet — there is nothing to scope them to, and AWS authorizes
        # them on "*" or not at all. The per-resource DESCRIBE that follows each
        # of them IS scoped, in ScopedReads below: ecs:ListClusters is here and
        # ecs:DescribeClusters is scoped to a cluster ARN, acm:ListCertificates
        # is here and acm:DescribeCertificate is scoped to a certificate ARN.
        Sid    = "EstateInventory"
        Effect = "Allow"
        Action = [
          "tag:GetResources",
          "ecs:ListClusters",
          "ecs:ListServices",
          "ecs:DescribeServices",
          "ecs:ListTasks",
          # ecs:DescribeTaskDefinition is an AWS constraint: a task definition
          # revision has an ARN, but the action does not support resource-level
          # permissions and an ARN here grants nothing.
          "ecs:DescribeTaskDefinition",
          "cloudfront:ListDistributions",
          "acm:ListCertificates",
          "logs:DescribeLogGroups",
          "route53:ListHostedZones",
          "kms:ListKeys",
          "kms:ListResourceTags",
          "backup:ListBackupVaults",
          "backup:ListRecoveryPointsByBackupVault",
          "dynamodb:ListTables",
        ]
        Resource = "*"
      },
      {
        # ── Databases and caches ──────────────────────────────────────────
        #
        # RDS and ElastiCache Describe* are AWS-constraint stars. Both APIs
        # predate resource-level permissions for their describe calls: the
        # filtering is done in the REQUEST (DBInstanceIdentifier,
        # CacheClusterId), not in the policy, and an ARN in the Resource of a
        # `rds:DescribeDBInstances` statement produces a policy that denies
        # every call. Do not "tighten" these.
        #
        # `rds:DescribeEvents` and `rds:DescribePendingMaintenanceActions` are
        # the two that answer "why did the database restart" and "when is AWS
        # going to restart it", which are the questions asked during and before
        # an incident respectively.
        Sid    = "DataStoreInventory"
        Effect = "Allow"
        Action = [
          "rds:DescribeDBInstances",
          "rds:DescribeDBSnapshots",
          "rds:DescribeDBParameterGroups",
          "rds:DescribeEvents",
          "rds:DescribePendingMaintenanceActions",
          "elasticache:DescribeCacheClusters",
          "elasticache:DescribeReplicationGroups",
          "elasticache:DescribeCacheParameters",
        ]
        Resource = "*"
      },
      {
        # ── Network topology ───────────────────────────────────────────────
        #
        # AWS CONSTRAINT, and the most important one in this file to leave
        # alone: `ec2:Describe*` and `elasticloadbalancing:Describe*` DO NOT
        # SUPPORT RESOURCE-LEVEL PERMISSIONS. AWS documents this explicitly for
        # the EC2 describe family and for every ELBv2 describe. A reviewer who
        # replaces this "*" with `arn:*:ec2:*:*:vpc/*` has not narrowed the
        # role — they have written a statement that matches nothing, and the
        # network page goes permanently AccessDenied with no code change to
        # blame it on. The bound on these is the VERB, and every one of them is
        # a Describe.
        #
        # `DescribeTargetHealth` is the one that says whether the tasks behind a
        # load balancer are actually in service, which is the difference between
        # "the service is running" and "the service is serving".
        Sid    = "NetworkTopology"
        Effect = "Allow"
        Action = [
          "ec2:DescribeVpcs",
          "ec2:DescribeSubnets",
          "ec2:DescribeRouteTables",
          "ec2:DescribeInternetGateways",
          "ec2:DescribeNatGateways",
          "ec2:DescribeNetworkAcls",
          "ec2:DescribeSecurityGroups",
          "ec2:DescribeVpcEndpoints",
          "elasticloadbalancing:DescribeLoadBalancers",
          "elasticloadbalancing:DescribeListeners",
          "elasticloadbalancing:DescribeRules",
          "elasticloadbalancing:DescribeTargetGroups",
          "elasticloadbalancing:DescribeTargetHealth",
        ]
        Resource = "*"
      },
      {
        # AWS CONSTRAINT: `cognito-idp:ListUserPools` is the account-wide
        # enumeration and takes no resource. Everything that names ONE pool —
        # DescribeUserPool, ListUsers, GetUserPoolMfaConfig and the rest — is
        # scoped to a userpool ARN in ScopedReads below, because the operator
        # directory is the one place in this estate where a read returns people.
        Sid      = "OperatorDirectory"
        Effect   = "Allow"
        Action   = ["cognito-idp:ListUserPools"]
        Resource = "*"
      },
      {
        # ── Posture: what is watching, and what it has seen ────────────────
        #
        # All AWS-constraint stars. Organizations, Config, Security Hub,
        # GuardDuty's detector list, IAM Access Analyzer's analyzer list and
        # WAFv2's ACL list are account-scoped APIs with no resource-level
        # permissions on these actions. The per-FINDING and per-DETECTOR reads
        # that do scope are below.
        #
        # `cloudtrail:LookupEvents` is a read of the audit trail itself and is
        # how an operator answers "who changed this". It is a Lookup, not a Get,
        # and the guard's read-verb list names Lookup for exactly this action.
        Sid    = "EstatePosture"
        Effect = "Allow"
        Action = [
          "organizations:DescribeOrganization",
          "organizations:ListAccounts",
          "cloudtrail:DescribeTrails",
          "cloudtrail:LookupEvents",
          "config:DescribeConfigurationAggregators",
          "config:DescribeConfigRules",
          "config:DescribeComplianceByConfigRule",
          "securityhub:GetFindings",
          "guardduty:ListDetectors",
          "access-analyzer:ListAnalyzers",
          "wafv2:ListWebACLs",
          "wafv2:GetWebACLForResource",
        ]
        Resource = "*"
      },
      {
        # ── Metrics and AWS-side incidents ────────────────────────────────
        #
        # AWS CONSTRAINT: CloudWatch's metric and alarm reads have no
        # resource-level permissions — `cloudwatch:GetMetricData` is authorized
        # account-wide and filtered by the namespace/dimensions in the request.
        # AWS Health's two describes are likewise account-scoped.
        #
        # `GetMetricData` and not `GetMetricStatistics`: one call returns many
        # series, so a page that charts twelve metrics is one request rather
        # than twelve, which is the difference between a dashboard and a
        # throttle.
        Sid    = "HealthAndMetrics"
        Effect = "Allow"
        Action = [
          "cloudwatch:DescribeAlarms",
          "cloudwatch:GetMetricData",
          "cloudwatch:ListDashboards",
          "cloudwatch:GetDashboard",
          "health:DescribeEvents",
          "health:DescribeAffectedEntities",
        ]
        Resource = "*"
      },
      {
        # ── Cost, price and quota ─────────────────────────────────────────
        #
        # AWS CONSTRAINT throughout: Cost Explorer, the Cost and Usage Report
        # definitions, the Pricing API and Service Quotas are all account-level
        # APIs with no resource ARNs to scope to.
        #
        # `pricing:*` reads the PUBLIC price list — it returns no account data
        # at all — and is here so the console can say what a resource will cost
        # before it exists rather than only what it did cost. `servicequotas:*`
        # is the read that turns "the deploy failed" into "you are at the
        # account limit for that resource".
        Sid    = "CostAndQuotas"
        Effect = "Allow"
        Action = [
          "cur:DescribeReportDefinitions",
          "ce:GetCostAndUsageWithResources",
          "pricing:GetProducts",
          "pricing:ListPriceLists",
          "servicequotas:ListServiceQuotas",
          "servicequotas:GetServiceQuota",
        ]
        Resource = "*"
      },
      {
        # Metadata about parameters, never their values. `ssm:GetParameter` is
        # deliberately absent. The secrets half of this — which DOES scope to an
        # ARN — is `SecretExistence` under ScopedReads below.
        #
        # `ssm:DescribeParameters` and `secretsmanager:ListSecrets` are the
        # paginated account-wide LIST calls and AWS authorizes them on "*" only;
        # the per-resource ARN condition applies to `GetParameter` and
        # `GetSecretValue`, which this role does not hold, must not, and which
        # are explicitly DENIED below.
        Sid    = "ConfigurationMetadata"
        Effect = "Allow"
        Action = [
          "ssm:DescribeParameters",
          "secretsmanager:ListSecrets",
        ]
        Resource = "*"
      },
      {
        # ── The seven services the engine provisioned and could not see ────
        #
        # `infrastructure/terraform/ses.tf` creates a domain identity, an email
        # identity and a configuration set. `sqs.tf` creates five queues, two of
        # them dead-letter queues. `scheduler.tf` creates the EventBridge rule
        # that is the only thing making deliverable reminders fire. None of it
        # was readable from this role, so the console that provisions the estate
        # could not answer "did that work".
        #
        # `ses:SendEmail`, `sqs:SendMessage`, `sqs:PurgeQueue`,
        # `lambda:InvokeFunction` and `events:PutEvents` are absent here and
        # DENIED below. Reading a mail configuration and sending mail as that
        # configuration are different powers, and this role holds the first.
        #
        # Account-level and list calls only. The four per-resource reads that
        # pair with these — GetConfigurationSet, GetQueueAttributes,
        # GetFunctionConcurrency, ListTargetsByRule — DO take an ARN and are in
        # ScopedReads below. The calls here do not: `ses:GetAccount` describes
        # the account itself, and `ListQueues` / `ListFunctions` / `ListRules` /
        # `ListEmailIdentities` / `ListConfigurationSets` /
        # `ListSuppressedDestinations` are the enumerations whose whole job is to
        # return things whose ARNs are not known yet.
        Sid    = "MessagingAndSchedulingReads"
        Effect = "Allow"
        Action = [
          "ses:GetAccount",
          "ses:ListEmailIdentities",
          "ses:ListConfigurationSets",
          "ses:ListSuppressedDestinations",
          "sqs:ListQueues",
          "lambda:ListFunctions",
          "events:ListRules",
        ]
        Resource = "*"
      },
      {
        # ── Account posture: IAM, budgets, and AWS's own incidents ─────────
        #
        # `budgets:ViewBudget` is spelled the way AWS spells it and NOT
        # `budgets:DescribeBudgets`. AWS Budgets authorizes its classic budget
        # APIs with exactly two actions, ViewBudget and ModifyBudget; a policy
        # naming the API's own name grants nothing, and the failure is a quiet
        # AccessDenied that renders identically to an account with no budgets.
        # It is the one read verb in this policy not spelled Get/List/Describe,
        # and `studio-task-role-is-narrow` names it explicitly for that reason.
        #
        # `iam:GetAccountAuthorizationDetails` returns policy DOCUMENTS, which
        # is the point: a wildcard grant is only visible in the document. It
        # returns no credential material — IAM has no API that does. It is an
        # account-wide read with no resource-level permissions, so "*" is the
        # only value AWS accepts; `iam:ListAccessKeys` names a user and IS
        # scoped, in ScopedReads below.
        #
        # `budgets:ViewBudget` scopes to a budget ARN and is also below. AWS
        # Health's two describes are in `HealthAndMetrics` above and are NOT
        # repeated here: a duplicated action grants nothing extra and costs
        # characters against IAM's 10,240-byte inline-policy limit, which this
        # policy is now close enough to that the guard measures it.
        Sid      = "AccountPostureReads"
        Effect   = "Allow"
        Action   = ["iam:GetAccountAuthorizationDetails"]
        Resource = "*"
      },
      {
        # Object VERSIONS only, and only for reading how much is retained.
        # s3:GetObject is deliberately absent: the console reports that a
        # tenant's objects still exist and their size, and has no business
        # reading their contents.
        # `s3:ListAllMyBuckets` is the account-wide enumeration and is an AWS
        # CONSTRAINT star — it names no bucket, so there is no bucket ARN to
        # scope it to. `s3:ListBucketVersions` is left on "*" for the same
        # reason the registry does: it is called across buckets the console has
        # just discovered, and the seven per-bucket GetBucket* reads that DO
        # scope are in `BucketPosture` below.
        Sid    = "RetainedObjectSizes"
        Effect = "Allow"
        Action = [
          "s3:ListAllMyBuckets",
          "s3:ListBucketVersions",
        ]
        Resource = "*"
      },

      # ── ScopedReads: the calls whose API actually takes an ARN ────────────
      #
      # Seven statements rather than one, because each of these is a DIFFERENT
      # resource pattern and merging them would mean granting each action on the
      # union — `iam:ListAccessKeys` on a budget ARN grants nothing, but
      # `budgets:ViewBudget` on `arn:*:iam::*:user/*` alongside a star is how a
      # merged statement ends up back at "*".
      #
      # Every pattern here is copied from the `resource` field of the capability
      # that performs the call, and `studio-task-role-is-narrow` fails if a
      # capability declaring an ARN pattern is granted on "*". The partition
      # segment is a wildcard rather than the literal `aws` throughout: this
      # engine refuses to boot without AWS_PARTITION rather than assume one, and
      # in aws-us-gov an `arn:aws:` resource matches nothing and the grant
      # silently does not work. That is GE-010-007's failure shape.

      {
        # Existence and rotation state of THIS platform's secrets, never their
        # values. `secretsmanager:GetSecretValue` is deliberately absent, and the
        # execution role — not this one — holds the single GetSecretValue the
        # container needs at start (see execution_secret above).
        #
        # Scoped to the `tenure/` namespace rather than "*": a star here would
        # let the console confirm the existence of every secret in the account,
        # which is itself information worth withholding.
        Sid      = "SecretExistence"
        Effect   = "Allow"
        Action   = ["secretsmanager:DescribeSecret"]
        Resource = "arn:*:secretsmanager:*:*:secret:tenure/*"
      },
      {
        # One configuration set's TLS policy, reputation tracking and whether
        # sending is enabled on it. Reading a mail configuration and sending mail
        # as that configuration are different powers; `ses:SendEmail` is DENIED
        # below.
        Sid      = "MailConfigurationSet"
        Effect   = "Allow"
        Action   = ["ses:GetConfigurationSet"]
        Resource = "arn:*:ses:*:*:configuration-set/*"
      },
      {
        # Queue depth, in-flight and delayed counts, and the redrive policy that
        # says which dead-letter queue a failure lands in.
        #
        # The queue-name segment is a wildcard because the queues this reads are
        # created by `infrastructure/terraform/sqs.tf` in a different state file
        # under a name this stack cannot reference. It is still narrower than
        # "*": it is SQS queues in this partition and nothing else, and the only
        # SQS action granted is a Get. `sqs:SendMessage`, `sqs:DeleteMessage`,
        # `sqs:PurgeQueue` and `sqs:DeleteQueue` are DENIED below.
        Sid      = "QueueDepth"
        Effect   = "Allow"
        Action   = ["sqs:GetQueueAttributes"]
        Resource = "arn:*:sqs:*:*:*"
      },
      {
        # One function's reserved concurrency — absent means it shares the
        # account pool. `lambda:InvokeFunction` is DENIED below: a console that
        # can see a function must not be able to run it.
        Sid      = "FunctionConcurrency"
        Effect   = "Allow"
        Action   = ["lambda:GetFunctionConcurrency"]
        Resource = "arn:*:lambda:*:*:function:*"
      },
      {
        # What one rule actually invokes. A rule with no target is ENABLED and
        # inert, which is a scheduled job that stopped running silently.
        Sid      = "ScheduleTargets"
        Effect   = "Allow"
        Action   = ["events:ListTargetsByRule"]
        Resource = "arn:*:events:*:*:rule/*"
      },
      {
        # One user's access keys and their creation dates — a long-lived key is
        # an age, not a boolean. Scoped to user ARNs, which is the only resource
        # type this action accepts; every key-CREATING verb is DENIED below.
        Sid      = "AccessKeyAges"
        Effect   = "Allow"
        Action   = ["iam:ListAccessKeys"]
        Resource = "arn:*:iam::*:user/*"
      },
      {
        # Each budget's limit, actual and forecast, and the thresholds that are
        # supposed to notify somebody.
        #
        # `budgets:ViewBudget`, NOT `budgets:DescribeBudgets`. AWS Budgets
        # authorizes its classic budget APIs with exactly two actions, ViewBudget
        # and ModifyBudget; a policy naming the API's own name grants nothing and
        # fails as a quiet AccessDenied that renders identically to an account
        # with no budgets. It is the one read verb in this policy not spelled
        # Get/List/Describe, and `studio-task-role-is-narrow` names it explicitly
        # for that reason. The write half, `budgets:ModifyBudget`, is DENIED
        # below.
        Sid      = "BudgetAmounts"
        Effect   = "Allow"
        Action   = ["budgets:ViewBudget"]
        Resource = "arn:*:budgets::*:budget/*"
      },
      {
        # One certificate's expiry, validation state and the domains on it.
        # `acm:ListCertificates` above is the star; this is the per-certificate
        # read and ACM scopes it to a certificate ARN.
        Sid      = "CertificateDetail"
        Effect   = "Allow"
        Action   = ["acm:DescribeCertificate"]
        Resource = "arn:*:acm:*:*:certificate/*"
      },
      {
        # One distribution's origins, behaviours and cache policy, and whether
        # an invalidation is still running. `cloudfront:CreateInvalidation` is
        # absent and DENIED: reading which invalidations exist and issuing one
        # that bills per path are different powers.
        Sid    = "DistributionDetail"
        Effect = "Allow"
        Action = [
          "cloudfront:GetDistributionConfig",
          "cloudfront:ListInvalidations",
        ]
        Resource = "arn:*:cloudfront::*:distribution/*"
      },
      {
        # Whether a trail is actually LOGGING, as opposed to merely existing.
        # `DescribeTrails` above returns configuration and says nothing about
        # whether delivery is running; `cloudtrail:StopLogging` is the one-call
        # way to blind an account and is DENIED below.
        Sid      = "TrailStatus"
        Effect   = "Allow"
        Action   = ["cloudtrail:GetTrailStatus"]
        Resource = "arn:*:cloudtrail:*:*:trail/*"
      },
      {
        # ── The operator directory ────────────────────────────────────────
        #
        # The only reads in this policy that return PEOPLE, so the scoping
        # matters more here than anywhere else: a userpool ARN, not "*". A star
        # would let this role read every user pool in the account, including any
        # a tenant-facing application owns.
        #
        # `cognito-idp:ListUsers` returns the operators' email addresses and
        # their confirmation state — which is what the console needs to say who
        # can sign in — and nothing that authenticates as them. Every
        # `AdminCreate*`, `AdminSet*` and `AdminAddUserToGroup` verb is absent
        # and DENIED below: this console shows who the operators are and must
        # not be able to become one.
        Sid    = "UserPoolDetail"
        Effect = "Allow"
        Action = [
          "cognito-idp:DescribeUserPool",
          "cognito-idp:DescribeUserPoolClient",
          "cognito-idp:DescribeUserPoolDomain",
          "cognito-idp:GetUserPoolMfaConfig",
          "cognito-idp:ListUserPoolClients",
          "cognito-idp:ListUsers",
        ]
        Resource = "arn:*:cognito-idp:*:*:userpool/*"
      },
      {
        # Table configuration, point-in-time-recovery state and TTL. Reads
        # only: the six registry ITEM actions are in dynamodb.tf, scoped to the
        # one table this engine owns, and `dynamodb:DeleteTable` is denied
        # there.
        #
        # The table ARN is a wildcard rather than
        # `aws_dynamodb_table.tenants.arn` because these reads cover every table
        # in the estate, including the ones tenant stacks create in other state
        # files. It is still narrower than "*": DynamoDB tables in this
        # partition, and only the three describes.
        Sid    = "TableDetail"
        Effect = "Allow"
        Action = [
          "dynamodb:DescribeTable",
          "dynamodb:DescribeContinuousBackups",
          "dynamodb:DescribeTimeToLive",
        ]
        Resource = "arn:*:dynamodb:*:*:table/*"
      },
      {
        # ── Image provenance ──────────────────────────────────────────────
        #
        # Which image tag a task definition actually points at, when it was
        # pushed, and what the scanner found in it. `ecr:GetLifecyclePolicy` is
        # the read that says whether images are being expired at all, which is
        # a bill and a supply-chain answer at once.
        #
        # `ecr:GetAuthorizationToken` is deliberately absent. It is the call
        # that returns a docker-login credential for the registry, it is
        # account-scoped rather than repository-scoped, and a console that holds
        # it can pull every image in the estate from anywhere. `ecr:PutImage`
        # and `ecr:BatchDeleteImage` are DENIED below.
        Sid    = "ImageProvenance"
        Effect = "Allow"
        Action = [
          "ecr:DescribeRepositories",
          "ecr:DescribeImages",
          "ecr:DescribeImageScanFindings",
          "ecr:GetLifecyclePolicy",
        ]
        Resource = "arn:*:ecr:*:*:repository/*"
      },
      {
        # Capacity providers and registered instance counts for one cluster.
        Sid      = "ClusterDetail"
        Effect   = "Allow"
        Action   = ["ecs:DescribeClusters"]
        Resource = "arn:*:ecs:*:*:cluster/*"
      },
      {
        # One task's last status, stopped reason and container exit codes —
        # which is the difference between "the deployment is stuck" and "the
        # container is exiting 137 because it is out of memory".
        Sid      = "TaskDetail"
        Effect   = "Allow"
        Action   = ["ecs:DescribeTasks"]
        Resource = "arn:*:ecs:*:*:task/*"
      },
      {
        # GuardDuty findings, scoped to a detector. `ListDetectors` above is the
        # AWS-constraint star that finds the detector id; everything that reads
        # what it FOUND is scoped to it. `guardduty:ArchiveFindings` — the call
        # that makes a finding stop being reported — is DENIED below.
        Sid    = "ThreatFindings"
        Effect = "Allow"
        Action = [
          "guardduty:ListFindings",
          "guardduty:GetFindings",
        ]
        Resource = "arn:*:guardduty:*:*:detector/*"
      },
      {
        # Whether a customer-managed key rotates, and what it is for.
        # `kms:ListKeys` above returns ids and nothing else. Neither action here
        # can decrypt anything: `kms:Decrypt` is absent, and
        # `kms:DisableKeyRotation` and `kms:ScheduleKeyDeletion` are DENIED
        # below.
        Sid    = "KeyRotation"
        Effect = "Allow"
        Action = [
          "kms:DescribeKey",
          "kms:GetKeyRotationStatus",
        ]
        Resource = "arn:*:kms:*:*:key/*"
      },
      {
        # ── Log contents ──────────────────────────────────────────────────
        #
        # `logs:FilterLogEvents` reads APPLICATION LOG LINES, which is the most
        # sensitive read in this policy: a log line can carry whatever the
        # application put in it. It is scoped to a log-group ARN for that
        # reason, and the guard names it explicitly as a read that AWS does not
        # spell Get/List/Describe.
        #
        # `logs:DescribeMetricFilters` is the read that says whether anything is
        # WATCHING those logs — a metric filter with no alarm behind it is an
        # error pattern nobody is counting.
        Sid    = "LogContents"
        Effect = "Allow"
        Action = [
          "logs:FilterLogEvents",
          "logs:DescribeMetricFilters",
        ]
        Resource = "arn:*:logs:*:*:log-group:*"
      },
      {
        # The record sets in one hosted zone — how a DNS name resolves, and
        # whether it still points at a tenant that stopped serving.
        # `route53:ChangeResourceRecordSets` is the call that moves a domain and
        # is DENIED below.
        #
        # Route 53 is a global service: its ARNs carry no region and no account,
        # which is why this pattern has three colons rather than the usual two
        # segments. That is the ARN format, not a typo.
        Sid      = "RecordSets"
        Effect   = "Allow"
        Action   = ["route53:ListResourceRecordSets"]
        Resource = "arn:*:route53:::hostedzone/*"
      },
      {
        # ── Bucket posture, never bucket contents ─────────────────────────
        #
        # Encryption, versioning, lifecycle, CORS, tags and — the two that
        # answer "is this bucket public" — the public-access block and the
        # policy STATUS. `s3:GetBucketPolicyStatus` returns one boolean,
        # `IsPublic`; `s3:GetBucketPolicy`, which returns the policy DOCUMENT
        # and with it the account ids and principals a tenant shares data with,
        # is deliberately absent.
        #
        # `s3:GetObject` is absent and always will be. This console reports that
        # a tenant's objects exist, how many versions are retained and how many
        # bytes they hold; reading their contents is every student record in the
        # estate one page render away.
        #
        # `arn:*:s3:::*` is the bucket-level ARN form — S3 bucket ARNs carry no
        # region and no account id, which is why the two segments are empty.
        # It is a wildcard over buckets because the console reads buckets it has
        # just discovered through `ListAllMyBuckets`, but it is NOT `"*"`: it
        # matches buckets and not the `bucket/key` object ARNs that an
        # object-level action would need.
        Sid    = "BucketPosture"
        Effect = "Allow"
        Action = [
          "s3:GetEncryptionConfiguration",
          "s3:GetBucketVersioning",
          "s3:GetLifecycleConfiguration",
          "s3:GetBucketPublicAccessBlock",
          "s3:GetBucketPolicyStatus",
          "s3:GetBucketCORS",
          "s3:GetBucketTagging",
        ]
        Resource = "arn:*:s3:::*"
      },
      {
        # IAM Access Analyzer findings — every resource in the account that is
        # shared outside the trust zone. `ListAnalyzers` above is the star that
        # finds the analyzer; the findings are scoped to it.
        Sid      = "AnalyzerFindings"
        Effect   = "Allow"
        Action   = ["access-analyzer:ListFindingsV2"]
        Resource = "arn:*:access-analyzer:*:*:analyzer/*"
      },
      {
        # Belt and braces against a future edit. Even if somebody widens an
        # Allow above, an explicit Deny on the destructive verbs cannot be
        # routed around by a broader Allow in the same policy.
        #
        # ── Why `iam:*` is no longer here, and what replaced it ─────────────
        #
        # This list used to end `iam:*`. An explicit Deny beats every Allow, in
        # this policy and in any other attached to the same role, so that one
        # line would have refused `iam:GetAccountAuthorizationDetails` and
        # `iam:ListAccessKeys` above — the IAM posture reads would have shipped
        # permanently DENIED, correctly rendered as "unknown", and blind.
        #
        # It is replaced by the IAM actions that actually grant or escalate
        # privilege, named one by one. That list is longer and, unlike `iam:*`,
        # it is not exhaustive — so the primary control remains the Allow side,
        # where the only two IAM actions this role holds are a Get and a List.
        # If a future edit needs more IAM than that, this Deny is the second
        # place it has to be argued for.
        Sid    = "NeverWrite"
        Effect = "Deny"
        Action = [
          "ecs:UpdateService",
          "ecs:DeleteService",
          "rds:DeleteDBInstance",
          "rds:ModifyDBInstance",
          "cloudfront:DeleteDistribution",
          "s3:DeleteObject",
          "s3:DeleteObjectVersion",
          "kms:ScheduleKeyDeletion",
          "organizations:LeaveOrganization",
          # Privilege grant and escalation.
          "iam:CreateRole",
          "iam:UpdateRole",
          "iam:DeleteRole",
          "iam:CreateUser",
          "iam:DeleteUser",
          "iam:CreateGroup",
          "iam:AddUserToGroup",
          "iam:CreateAccessKey",
          "iam:UpdateAccessKey",
          "iam:CreateLoginProfile",
          "iam:UpdateLoginProfile",
          "iam:CreatePolicy",
          "iam:CreatePolicyVersion",
          "iam:SetDefaultPolicyVersion",
          "iam:AttachRolePolicy",
          "iam:AttachUserPolicy",
          "iam:AttachGroupPolicy",
          "iam:PutRolePolicy",
          "iam:PutUserPolicy",
          "iam:PutGroupPolicy",
          "iam:UpdateAssumeRolePolicy",
          "iam:PassRole",
          "iam:CreateServiceLinkedRole",
          "iam:CreateInstanceProfile",
          "iam:AddRoleToInstanceProfile",
          "iam:DeleteRolePermissionsBoundary",
          "iam:DeleteUserPermissionsBoundary",
          # The five writes behind the seven new reads. A console that can see
          # a queue must not be able to purge it, and one that can read a mail
          # configuration must not be able to send as it.
          "ses:SendEmail",
          "ses:SendBulkEmail",
          "ses:DeleteEmailIdentity",
          "ses:PutAccountSendingAttributes",
          "sqs:SendMessage",
          "sqs:DeleteMessage",
          "sqs:PurgeQueue",
          "sqs:DeleteQueue",
          "lambda:InvokeFunction",
          "lambda:UpdateFunctionCode",
          "lambda:UpdateFunctionConfiguration",
          "lambda:DeleteFunction",
          "events:PutEvents",
          "events:PutRule",
          "events:PutTargets",
          "events:DeleteRule",
          "events:DisableRule",
          "budgets:ModifyBudget",

          # ── The writes behind the reads added with the new services ──────
          #
          # Not exhaustive, and it cannot be — AWS adds actions faster than a
          # list is maintained, which is why the primary control stays the Allow
          # side and the guard that holds it to `capabilities.ts`. What is here
          # is the set where ONE call is catastrophic and the corresponding read
          # is now granted, grouped by what the call would cost.
          #
          # Reading a credential. This role holds DescribeSecret and
          # ListSecrets; the value is a different power and lives on the
          # EXECUTION role, for exactly one secret (see execution_secret above).
          "secretsmanager:GetSecretValue",
          "secretsmanager:PutSecretValue",
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParametersByPath",

          # Becoming an operator. The console reads the user pool to say who can
          # sign in; these are the calls that would let it add itself.
          "cognito-idp:AdminCreateUser",
          "cognito-idp:AdminSetUserPassword",
          "cognito-idp:AdminAddUserToGroup",
          "cognito-idp:AdminUpdateUserAttributes",
          "cognito-idp:AdminDeleteUser",
          "cognito-idp:UpdateUserPool",
          "cognito-idp:UpdateUserPoolClient",
          "cognito-idp:DeleteUserPool",

          # Opening the network it can now see.
          "ec2:AuthorizeSecurityGroupIngress",
          "ec2:RevokeSecurityGroupIngress",
          "ec2:ModifySecurityGroupRules",
          "ec2:TerminateInstances",
          "ec2:DeleteVpc",
          "elasticloadbalancing:ModifyListener",
          "elasticloadbalancing:SetSecurityGroups",
          "elasticloadbalancing:DeleteLoadBalancer",

          # Changing what runs. It can read image provenance; it must not be
          # able to publish an image the estate would then run.
          "ecr:PutImage",
          "ecr:BatchDeleteImage",
          "ecr:DeleteRepository",

          # Data at rest: making a bucket public, turning off encryption or
          # versioning, or stopping a key rotating.
          "s3:PutBucketPolicy",
          "s3:PutBucketPublicAccessBlock",
          "s3:PutEncryptionConfiguration",
          "s3:PutBucketVersioning",
          "s3:DeleteBucket",
          "kms:DisableKeyRotation",
          "kms:DisableKey",
          "kms:PutKeyPolicy",
          "elasticache:ModifyReplicationGroup",
          "elasticache:DeleteReplicationGroup",

          # Blinding the things that would report all of the above. These are
          # the first calls an attacker makes and the last ones a read-only
          # console needs.
          "cloudtrail:StopLogging",
          "cloudtrail:DeleteTrail",
          "cloudtrail:UpdateTrail",
          "guardduty:ArchiveFindings",
          "guardduty:DeleteDetector",
          "config:StopConfigurationRecorder",
          "config:DeleteConfigRule",
          "logs:DeleteLogGroup",
          "logs:PutRetentionPolicy",
          "wafv2:DeleteWebACL",
          "wafv2:DisassociateWebACL",

          # Moving a domain.
          "route53:ChangeResourceRecordSets",
          "route53:DeleteHostedZone",
          "cloudfront:CreateInvalidation",
          "acm:DeleteCertificate",
        ]
        Resource = "*"
      },
    ]
  })
}
