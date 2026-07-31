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

# Set this and the pilot uses a passphrase you chose and already know. Leave it
# empty and Terraform generates one, which is safe but only readable from the AWS
# console — and hunting for it in the console is exactly what fails when someone
# is standing in front of a client waiting to be shown the product.
#
# It is a variable rather than a literal because this repository is public: the
# value arrives from the GitHub Actions secret DEV_LOGIN_PASSPHRASE via
# TF_VAR_dev_login_passphrase (see .github/workflows/deploy.yml), so the
# passphrase is known to you and to pilot users but never committed.
#
# Editing the secret directly in the AWS console will NOT stick — the next apply
# rewrites it from this variable. Change it here, in the GitHub secret.
variable "dev_login_passphrase" {
  description = "Shared pilot sign-in passphrase. Empty = generate one. Set via TF_VAR_dev_login_passphrase."
  type        = string
  default     = ""
  sensitive   = true

  validation {
    # src/lib/env.ts refuses to boot on a passphrase under 12 characters, since it
    # is the only thing standing in front of a passwordless OSE_DIRECTOR login.
    # Catching it at plan time beats discovering it when the container fails
    # closed and ECS rolls the deployment back.
    condition     = var.dev_login_passphrase == "" || length(var.dev_login_passphrase) >= 12
    error_message = "dev_login_passphrase must be at least 12 characters — the app refuses to boot below that."
  }
}

locals {
  # Chosen value wins; generated value is the fallback so the pilot is never
  # left with no gate at all.
  dev_login_passphrase = (
    var.dev_login_passphrase != ""
    ? var.dev_login_passphrase
    : random_password.dev_login_passphrase.result
  )
}

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
  secret_string = jsonencode({ DEV_LOGIN_PASSPHRASE = local.dev_login_passphrase })
}

output "dev_login_passphrase" {
  description = "Share with pilot users. Also readable via: aws secretsmanager get-secret-value --secret-id tenure-pilot/dev-login"
  value       = local.dev_login_passphrase
  sensitive   = true
}

output "dev_login_passphrase_is_chosen" {
  description = "true when the passphrase came from the DEV_LOGIN_PASSPHRASE secret rather than being generated."
  # Terraform propagates sensitivity through the comparison, which would make this
  # boolean unprintable. Whether a passphrase was chosen is not itself a secret —
  # only its value is, and that is not derivable from a yes/no.
  value = nonsensitive(var.dev_login_passphrase != "")
}
