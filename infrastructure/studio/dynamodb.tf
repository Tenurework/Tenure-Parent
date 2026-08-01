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
    ]
  })
}

output "tenant_table" {
  value = aws_dynamodb_table.tenants.name
}
