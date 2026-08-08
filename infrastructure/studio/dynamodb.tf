# ── Tenant registry ─────────────────────────────────────────────────────────
#
# Where composed tenants and their lifecycle live.
#
# DynamoDB rather than RDS, and the reason is latency and blast radius rather
# than fashion:
#
#   * The Studio's task runs in a public subnet with no NAT gateway. Reaching
#     RDS would mean putting the task in a private subnet behind one (~$32/mo)
#     or opening the database's network. DynamoDB is reached over the AWS
#     network with IAM auth and needs neither.
#   * No connection pool. A Fargate task that scales to two holds two pools
#     against a db.t3.micro whose max_connections is ~85; DynamoDB has no
#     connections to exhaust.
#   * Single-digit-millisecond reads at operator volume, and nothing standing
#     to pay for between them.
#   * The engine must never share a database with a tenant. A separate table in
#     a separate stack makes that structural rather than a convention.
#
# Single table, because every access pattern here is "one tenant" or "all
# tenants" and a second table would only add a second thing to keep consistent.
#
#   PK = TENANT#<slug>    SK = MANIFEST | STATE | STEP#<iso8601>#<n>
#   PK = AUDIT#<subject>  SK = SEQ#<12-digit> | HOLD#<id> | HOLDRELEASE#<id>
#
# The AUDIT partitions hold the chained audit trail (STUDIO-110-005). They are
# in the same table because they are written by the same role in the same
# request, and a second table would be a second thing to keep consistent — but
# they are NOT protected the same way. See the policy below.
#
# Cost: on-demand, so nothing is paid when nobody is provisioning. At operator
# volume this is cents per month.

resource "aws_dynamodb_table" "tenants" {
  name         = "${local.name_prefix}-tenants"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  # A tenant registry is the record of what exists. Losing it means losing the
  # ability to say which systems were provisioned and who approved them, so it
  # is recoverable to any second in the last 35 days.
  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  # Refuse to delete the table by accident. Removing this line is a deliberate
  # act, which is the point.
  deletion_protection_enabled = true

  tags = merge(local.tags, { Name = "${local.name_prefix}-tenants" })
}

# ── What the Studio task may do with it ─────────────────────────────────────
#
# The task role was empty. It now holds exactly the six actions the registry
# uses, on exactly this table — not `dynamodb:*`, and not `Resource = "*"`.
# Scan is included because "show me every tenant" is a real access pattern at
# operator scale; it is bounded by the table being tenant-registry-sized.
#
# Two Denies follow the Allow, and an explicit Deny cannot be overridden by any
# Allow anywhere: deletion of anything, and UPDATE OR DELETE of an audit row.
resource "aws_iam_role_policy" "studio_tenants" {
  name = "tenant-registry"
  role = aws_iam_role.task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:TransactWriteItems",
        ]
        Resource = aws_dynamodb_table.tenants.arn
      },
      {
        # Deleting a tenant record is not how a tenant is removed — the
        # lifecycle has PURGING for that, behind two-person approval. An
        # explicit Deny means a stray DeleteItem cannot route around it.
        Effect   = "Deny"
        Action   = ["dynamodb:DeleteItem", "dynamodb:DeleteTable"]
        Resource = "*"
      },
      {
        # ── The audit trail cannot be rewritten by the process that writes it ──
        #
        # STUDIO-110-005. Until this existed, the Allow above granted this same
        # role both PutItem AND UpdateItem over every item in the table, and the
        # Deny covered only deletion. So an audit row written by the Studio could
        # be REWRITTEN IN PLACE by the Studio: the reason softened, the outcome
        # flipped from DENY to ALLOW, the actor changed. "Centralized protected
        # storage" was true of the table's encryption and of nothing else.
        #
        # The application-level defence is a hash chain — every row carries a
        # hash over its own content and its predecessor's, so an edit is
        # DETECTABLE (`verifyChain`, rendered at /platform/audit). This is the
        # other half: making the edit impossible rather than merely visible.
        #
        # Scoped by LEADING KEY rather than by removing UpdateItem outright,
        # because the registry genuinely updates two kinds of TENANT# row —
        # `completeOperation` and `settleIdempotency` in lib/registry.ts move a
        # long-running operation and a claim to their outcome. Blanket-denying
        # Update would break both. `dynamodb:LeadingKeys` is DynamoDB's
        # item-level condition key and carries the partition key of the item the
        # request names, so this denies exactly the audit partitions.
        #
        # `ForAnyValue:` and not `ForAllValues:` on purpose. `ForAllValues` is
        # vacuously TRUE when the condition key is absent from the request, which
        # in a Deny would refuse every request that does not name a key at all —
        # including Scan and DescribeTable. `ForAnyValue` is false when the key
        # is absent, so this Deny applies only to a request that names an
        # `AUDIT#…` item, which is precisely the intent.
        Effect   = "Deny"
        Action   = ["dynamodb:UpdateItem", "dynamodb:DeleteItem"]
        Resource = aws_dynamodb_table.tenants.arn
        Condition = {
          "ForAnyValue:StringLike" = {
            "dynamodb:LeadingKeys" = ["AUDIT#*"]
          }
        }
      },
    ]
  })
}

output "tenant_table" {
  value = aws_dynamodb_table.tenants.name
}
