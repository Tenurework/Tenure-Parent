# ── Interim access gate for passwordless pilot sign-in ───────────────────────
#
# Temporary. Deleted when Okta is configured (see docs/RUNBOOK.md).
#
# `dev-login` signs in any seeded account with no password, and the sign-in page
# lists them as buttons — one of which holds OSE_DIRECTOR. On a public
# CloudFront URL that is one click from the highest role in the system. This
# puts a shared secret in front of it so the pilot is not open to the internet
# while the institution's SSO credentials are being obtained.
#
# It lives in its own secret rather than the `app` bundle deliberately:
# aws_secretsmanager_secret_version.app carries `ignore_changes = [secret_string]`
# so that manually-set values survive an apply — which also means a key added to
# that bundle would never appear on the already-created secret.

resource "random_password" "dev_login_passphrase" {
  length = 24
  # Lowercase and digits only: this gets read aloud and typed by pilot users,
  # so shift keys and ambiguous punctuation cost more than the entropy they add.
  # 24 chars over a 36-symbol alphabet is ~124 bits.
  special = false
  upper   = false
}

resource "aws_secretsmanager_secret" "dev_login" {
  name                    = "${local.name_prefix}/dev-login"
  description             = "Interim shared passphrase gating passwordless pilot sign-in. Delete when Okta is live."
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "dev_login" {
  secret_id     = aws_secretsmanager_secret.dev_login.id
  secret_string = jsonencode({ DEV_LOGIN_PASSPHRASE = random_password.dev_login_passphrase.result })
}

output "dev_login_passphrase" {
  description = "Share with pilot users. Also readable via: aws secretsmanager get-secret-value --secret-id tenure-pilot/dev-login"
  value       = random_password.dev_login_passphrase.result
  sensitive   = true
}
