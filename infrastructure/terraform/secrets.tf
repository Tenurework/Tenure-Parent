# ── App secrets bundle (injected into ECS task at runtime) ───────────────────
resource "aws_secretsmanager_secret" "app" {
  name                    = "${local.name_prefix}/app"
  description             = "Tenure app runtime secrets"
  recovery_window_in_days = 0 # Allow immediate deletion during pilot
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id

  # Populate with placeholder values; update via AWS console or CLI after deploy
  secret_string = jsonencode({
    AUTH_SECRET        = var.auth_secret != "" ? var.auth_secret : "REPLACE_ME_AFTER_DEPLOY"
    OKTA_CLIENT_ID     = var.okta_client_id
    OKTA_CLIENT_SECRET = var.okta_client_secret
    OKTA_ISSUER        = var.okta_issuer
  })

  lifecycle {
    # Don't overwrite secrets that have been set manually via console
    ignore_changes = [secret_string]
  }
}

# ── IAM policy allowing ECS to read the secret ───────────────────────────────
resource "aws_iam_policy" "ecs_secrets" {
  name = "${local.name_prefix}-ecs-secrets"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [
          aws_secretsmanager_secret.app.arn,
          # Bearer token for scheduled job endpoints
          aws_secretsmanager_secret.job.arn,
          # Interim gate in front of passwordless sign-in (dev-login-gate.tf)
          aws_secretsmanager_secret.dev_login.arn,
          # RDS managed password secret
          "${aws_db_instance.postgres.master_user_secret[0].secret_arn}",
        ]
      }
    ]
  })
}
