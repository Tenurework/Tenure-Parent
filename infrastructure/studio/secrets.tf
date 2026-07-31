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
    AUTH_SECRET = random_password.auth_secret.result
    # Supplied wins over generated. See the variable's description for why a
    # generated secret is close to useless in a public repository.
    PLATFORM_OPERATOR_SECRET = (
      var.platform_operator_secret != ""
      ? var.platform_operator_secret
      : random_password.operator_secret.result
    )
  })

  # No ignore_changes on secret_string any more: with the operator secret now
  # supplied, changing the variable MUST reach Secrets Manager, and ignoring
  # changes would silently keep the old value while the plan reported success.
  #
  # The session key is still generated, and random_password keeps its value in
  # state across applies, so this does not sign everyone out on each deploy.
}
