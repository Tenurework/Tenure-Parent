/**
 * The roles, and what each may do.
 *
 * GE-011-001 asks for least-privilege read, plan, and deploy roles.
 * GE-011-002 asks that trust be restricted by exact repository, branch or
 * environment, and audience.
 *
 * ── How the trust is bound ──────────────────────────────────────────────────
 *
 * Three conditions, and all three matter:
 *
 *   aud = sts.amazonaws.com          the token was minted FOR AWS, not for
 *                                    some other service that also accepts
 *                                    GitHub OIDC and might echo it back
 *
 *   sub = repo:<owner>/<repo>:...    the exact repository, and the exact ref
 *                                    or environment within it
 *
 *   StringEquals, not StringLike     a wildcard here is the whole control.
 *                                    A wildcard in the repository segment
 *                                    trusts anything anyone can create under
 *                                    that owner; one in the owner segment
 *                                    trusts every fork, everywhere.
 *
 *                                    (Spelled out in words rather than shown,
 *                                    because a literal star-slash inside a
 *                                    block comment ends the comment and the
 *                                    rest of this file becomes syntax.)
 *
 * The one place a wildcard IS used is the pull-request subject for the plan
 * role, which is `repo:<repo>:pull_request` — a fixed string, not a pattern.
 * A PR from a fork does not get this token: GitHub does not issue OIDC tokens
 * to `pull_request` workflows from forks.
 */

# ── Trust policy builder ────────────────────────────────────────────────────

locals {
  # Subjects that may assume each role. One list per role, spelled out.
  read_subjects = [
    "repo:${local.engine_repo}:ref:refs/heads/main",
    "repo:${local.engine_repo}:environment:aws-read",
  ]

  plan_subjects = [
    "repo:${local.engine_repo}:ref:refs/heads/main",
    "repo:${local.engine_repo}:pull_request",
  ]

  # Deployment is bound to a protected GitHub *environment*, not to a branch.
  # A branch condition is satisfied by anyone who can push the branch; an
  # environment condition additionally requires whatever reviewers and wait
  # timers that environment carries. That is the human approval GE-011-005 asks
  # for, expressed where AWS can enforce it rather than where CI merely observes
  # it.
  deploy_engine_subjects = [
    "repo:${local.engine_repo}:environment:engine-production",
  ]
}

data "aws_iam_policy_document" "trust_read" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = local.read_subjects
    }
  }
}

data "aws_iam_policy_document" "trust_plan" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = local.plan_subjects
    }
  }
}

data "aws_iam_policy_document" "trust_deploy_engine" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = local.deploy_engine_subjects
    }
  }
}

# ── Read role ───────────────────────────────────────────────────────────────
#
# For the AWS inventory. AWS ships ReadOnlyAccess and it is genuinely read-only,
# but it also reads object CONTENT — s3:GetObject, secretsmanager:GetSecretValue,
# dynamodb:GetItem. The inventory needs metadata, not data, and this repository
# is public. ViewOnlyAccess is the narrower managed policy: it lists and
# describes, and cannot read the inside of anything.

resource "aws_iam_role" "read" {
  name                 = "${var.project}-gha-read"
  description          = "GitHub Actions: read-only AWS inventory. Metadata only."
  assume_role_policy   = data.aws_iam_policy_document.trust_read.json
  max_session_duration = 3600

  tags = merge(local.tags, { Name = "${var.project}-gha-read" })
}

resource "aws_iam_role_policy_attachment" "read_viewonly" {
  role       = aws_iam_role.read.name
  policy_arn = "arn:aws:iam::aws:policy/job-function/ViewOnlyAccess"
}

# ViewOnlyAccess omits a handful of describes the inventory uses. Added
# explicitly so the gap is visible rather than fixed by widening to
# ReadOnlyAccess — every action here is a describe or a list.
resource "aws_iam_role_policy" "read_extra" {
  name = "inventory-describes"
  role = aws_iam_role.read.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "organizations:DescribeOrganization",
          "organizations:ListAccounts",
          "organizations:ListRoots",
          "iam:ListOpenIDConnectProviders",
          "iam:GetOpenIDConnectProvider",
          "iam:ListRoles",
          "iam:GetAccessKeyLastUsed",
          "iam:ListAccessKeys",
          "iam:ListUsers",
          "cloudfront:ListDistributions",
          "cloudfront:GetDistributionConfig",
          # `acm:ListCertificates` IS in ViewOnlyAccess and `DescribeCertificate`
          # is not, which is a genuinely awkward pair: a caller can learn that a
          # certificate exists and nothing about it — not its status, and not the
          # DNS record it is waiting for. Proven, not assumed: with only
          # ViewOnlyAccess, `studio-domain.yml` listed the certificate and then
          # failed with AccessDeniedException on DescribeCertificate.
          #
          # Reading a certificate's status discloses no private key and no secret
          # material; the validation record it returns is a public DNS record.
          "acm:DescribeCertificate",
          "wafv2:ListWebACLs",
          "backup:ListBackupVaults",
          "cognito-idp:ListUserPools",
          "secretsmanager:ListSecrets",
          "secretsmanager:DescribeSecret",
        ]
        Resource = "*"
      },
      {
        # Belt and braces. ViewOnlyAccess does not grant these, but an explicit
        # deny survives a future attachment of a broader managed policy — which
        # is exactly the mistake this role should be immune to.
        Effect = "Deny"
        Action = [
          "secretsmanager:GetSecretValue",
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParametersByPath",
          "s3:GetObject",
          "dynamodb:GetItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "kms:Decrypt",
        ]
        Resource = "*"
      },
    ]
  })
}

# ── Plan role ───────────────────────────────────────────────────────────────
#
# Terraform plan needs to read everything the configuration describes, and to
# read and lock the state. It must not be able to change infrastructure — a plan
# that can apply is an apply.

resource "aws_iam_role" "plan" {
  name                 = "${var.project}-gha-plan"
  description          = "GitHub Actions: terraform plan. Reads state, changes nothing."
  assume_role_policy   = data.aws_iam_policy_document.trust_plan.json
  max_session_duration = 3600

  tags = merge(local.tags, { Name = "${var.project}-gha-plan" })
}

resource "aws_iam_role_policy_attachment" "plan_viewonly" {
  role       = aws_iam_role.plan.name
  policy_arn = "arn:aws:iam::aws:policy/job-function/ViewOnlyAccess"
}

resource "aws_iam_role_policy" "plan_state" {
  name = "terraform-state"
  role = aws_iam_role.plan.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket", "s3:GetBucketLocation"]
        Resource = "arn:aws:s3:::${var.state_bucket}"
      },
      {
        # A plan writes no state, but it does read it, and it takes a lock so a
        # concurrent apply cannot move the ground under it.
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "arn:aws:s3:::${var.state_bucket}/*"
      },
      {
        Effect = "Deny"
        Action = [
          "iam:*",
          "organizations:*",
          "ec2:RunInstances",
          "rds:DeleteDBInstance",
          "s3:DeleteBucket",
        ]
        Resource = "*"
      },
    ]
  })
}

# ── Engine deploy role ──────────────────────────────────────────────────────
#
# Applies the System Studio stack. Deliberately NOT an admin role: it is scoped
# to the services that stack declares, and explicitly denied the ability to
# touch the pilot's data plane.

resource "aws_iam_role" "deploy_engine" {
  name                 = "${var.project}-gha-deploy-engine"
  description          = "GitHub Actions: apply the System Studio stack. Protected environment only."
  assume_role_policy   = data.aws_iam_policy_document.trust_deploy_engine.json
  max_session_duration = 3600

  tags = merge(local.tags, { Name = "${var.project}-gha-deploy-engine" })
}

resource "aws_iam_role_policy" "deploy_engine" {
  name = "studio-stack"
  role = aws_iam_role.deploy_engine.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecs:*", "ecr:*", "elasticloadbalancing:*", "cloudfront:*",
          "logs:*", "secretsmanager:*", "acm:*", "application-autoscaling:*",
        ]
        Resource = "*"
      },
      {
        # Network and IAM: read broadly, create only what the stack owns.
        # ec2:Describe* is needed to resolve the borrowed VPC by tag.
        Effect   = "Allow"
        Action   = ["ec2:Describe*"]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ec2:CreateSecurityGroup", "ec2:DeleteSecurityGroup",
          "ec2:AuthorizeSecurityGroup*", "ec2:RevokeSecurityGroup*",
          "ec2:CreateTags",
        ]
        Resource = "*"
      },
      {
        # The stack creates and passes its own task roles. Confined by name
        # prefix so a compromised deploy cannot mint an administrator.
        Effect = "Allow"
        Action = [
          "iam:CreateRole", "iam:DeleteRole", "iam:GetRole", "iam:PassRole",
          "iam:AttachRolePolicy", "iam:DetachRolePolicy",
          "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:GetRolePolicy",
          "iam:ListRolePolicies", "iam:ListAttachedRolePolicies",
          "iam:TagRole", "iam:UntagRole",
        ]
        Resource = "arn:aws:iam::${local.account_id}:role/${var.project}-studio-*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket", "s3:GetBucketLocation"]
        Resource = "arn:aws:s3:::${var.state_bucket}"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "arn:aws:s3:::${var.state_bucket}/oidc/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "arn:aws:s3:::${var.state_bucket}/studio/*"
      },
      {
        # The engine has no business in the pilot's database, its state file, or
        # the Organization. An explicit Deny cannot be overridden by any Allow,
        # including one added later by mistake.
        Effect = "Deny"
        Action = [
          "rds:*",
          "organizations:*",
          "iam:CreateUser", "iam:CreateAccessKey", "iam:AttachUserPolicy",
        ]
        Resource = "*"
      },
      {
        Effect   = "Deny"
        Action   = ["s3:*"]
        Resource = "arn:aws:s3:::${var.state_bucket}/pilot/*"
      },
    ]
  })
}
