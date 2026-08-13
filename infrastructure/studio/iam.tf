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
# file and fails on an Allow whose action is not a read verb, on `Action = ["*"]`,
# on any action ending `:*`, and on an AdministratorAccess-style attachment. The
# six DynamoDB writes in dynamodb.tf are named in that guard explicitly, so
# adding a seventh mutation is a deliberate act on two files.
#
# Resource = "*" throughout, and that is the API rather than laziness: List and
# Describe calls on these services have no resource-level scoping — there is no
# ARN that means "the ECS services in this account" to put in a policy. The
# bound is the verb, which is why the guard checks verbs.
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
        Sid    = "EstateInventory"
        Effect = "Allow"
        Action = [
          "tag:GetResources",
          "ecs:ListClusters",
          "ecs:ListServices",
          "ecs:DescribeServices",
          "rds:DescribeDBInstances",
          "rds:DescribeDBSnapshots",
          "cloudfront:ListDistributions",
          "acm:ListCertificates",
          "logs:DescribeLogGroups",
          "route53:ListHostedZones",
          "kms:ListKeys",
          "kms:ListResourceTags",
          "backup:ListBackupVaults",
          "backup:ListRecoveryPointsByBackupVault",
        ]
        Resource = "*"
      },
      {
        Sid    = "EstatePosture"
        Effect = "Allow"
        Action = [
          "organizations:DescribeOrganization",
          "organizations:ListAccounts",
          "cloudtrail:DescribeTrails",
          "config:DescribeConfigurationAggregators",
          "securityhub:GetFindings",
          "cloudwatch:DescribeAlarms",
          "cur:DescribeReportDefinitions",
          "ce:GetCostAndUsageWithResources",
        ]
        Resource = "*"
      },
      {
        # Metadata about secrets and parameters, never their values.
        # secretsmanager:GetSecretValue and ssm:GetParameter are deliberately
        # absent, and the execution role — not this one — holds the single
        # GetSecretValue the container needs at start (see execution_secret
        # above). The console reports that a secret exists, when it was last
        # rotated and who owns it; reading it would put every tenant's
        # credentials one page render away.
        Sid    = "ConfigurationMetadata"
        Effect = "Allow"
        Action = [
          "secretsmanager:DescribeSecret",
          "ssm:DescribeParameters",
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
        Sid    = "MessagingAndSchedulingReads"
        Effect = "Allow"
        Action = [
          "ses:GetAccount",
          "ses:ListEmailIdentities",
          "ses:ListConfigurationSets",
          "ses:GetConfigurationSet",
          "ses:ListSuppressedDestinations",
          "sqs:ListQueues",
          "sqs:GetQueueAttributes",
          "lambda:ListFunctions",
          "lambda:GetFunctionConcurrency",
          "events:ListRules",
          "events:ListTargetsByRule",
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
        # returns no credential material — IAM has no API that does.
        Sid    = "AccountPostureReads"
        Effect = "Allow"
        Action = [
          "iam:GetAccountAuthorizationDetails",
          "iam:ListAccessKeys",
          "budgets:ViewBudget",
          "health:DescribeEvents",
          "health:DescribeAffectedEntities",
        ]
        Resource = "*"
      },
      {
        # Object VERSIONS only, and only for reading how much is retained.
        # s3:GetObject is deliberately absent: the console reports that a
        # tenant's objects still exist and their size, and has no business
        # reading their contents.
        Sid      = "RetainedObjectSizes"
        Effect   = "Allow"
        Action   = ["s3:ListBucketVersions"]
        Resource = "*"
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
        ]
        Resource = "*"
      },
    ]
  })
}
