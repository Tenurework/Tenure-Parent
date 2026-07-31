# ── Secrets ─────────────────────────────────────────────────────────────────
#
# Generated here rather than supplied, so there is no value to paste into a CI
# variable and no copy sitting in anyone's history. The operator secret is read
# out once, deliberately, by whoever sets the console up.

resource "random_password" "auth_secret" {
  length  = 48
  special = false
}

resource "random_password" "operator_secret" {
  length  = 40
  special = false
}

resource "aws_secretsmanager_secret" "studio" {
  name                    = "${local.name_prefix}/app"
  description             = "Session signing key and the shared operator secret for the System Studio."
  recovery_window_in_days = 7

  tags = local.tags
}

resource "aws_secretsmanager_secret_version" "studio" {
  secret_id = aws_secretsmanager_secret.studio.id

  secret_string = jsonencode({
    AUTH_SECRET              = random_password.auth_secret.result
    PLATFORM_OPERATOR_SECRET = random_password.operator_secret.result
  })

  lifecycle {
    # Rotating the session key signs every operator out; rotating the operator
    # secret locks them out until they are told the new one. Neither should
    # happen because a plan decided the random resource needed replacing.
    ignore_changes = [secret_string]
  }
}
