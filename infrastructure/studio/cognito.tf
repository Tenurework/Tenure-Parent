# -- Cognito authentication --------------------------------------------------
#
# Cognito is the Studio's production authentication substrate. The application
# still reads PLATFORM_OPERATORS for authority; this pool only proves that the
# browser session belongs to the same email address named by the allowlist.

locals {
  operator_entries = [
    for raw in split(",", var.platform_operators) : trimspace(raw)
    if trimspace(raw) != ""
  ]

  operator_emails = toset([
    for raw in local.operator_entries : lower(trimspace(split(":", raw)[0]))
    if length(split(":", raw)) == 2 && trimspace(split(":", raw)[0]) != ""
  ])
}

resource "aws_cognito_user_pool" "studio" {
  name = "${local.name_prefix}-operators"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  # ON, not OPTIONAL. This pool guards the console that composes, provisions and
  # advances every tenant in the estate, and the whole allowlist is one person —
  # so a single stolen password is the entire estate. `OPTIONAL` means a second
  # factor nobody enrolled, which is the same protection as none while reading
  # like a choice somebody made. `software_token_mfa_configuration` below is
  # already enabled, so TOTP is the factor and enrolment happens at first
  # sign-in, alongside the forced password change.
  mfa_configuration = "ON"

  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  password_policy {
    minimum_length                   = 24
    require_lowercase                = false
    require_numbers                  = false
    require_symbols                  = false
    require_uppercase                = false
    temporary_password_validity_days = 7
  }

  schema {
    attribute_data_type = "String"
    mutable             = true
    name                = "email"
    required            = true

    string_attribute_constraints {
      min_length = 5
      max_length = 2048
    }
  }

  software_token_mfa_configuration {
    enabled = true
  }

  tags = local.tags
}

resource "aws_cognito_user_pool_domain" "studio" {
  domain       = "${local.name_prefix}-${data.aws_caller_identity.current.account_id}"
  user_pool_id = aws_cognito_user_pool.studio.id
}

resource "aws_cognito_user_pool_client" "studio" {
  name         = "${local.name_prefix}-nextauth"
  user_pool_id = aws_cognito_user_pool.studio.id

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["email", "openid", "profile"]
  callback_urls                        = ["https://${aws_cloudfront_distribution.studio.domain_name}/api/auth/callback/cognito"]
  logout_urls                          = ["https://${aws_cloudfront_distribution.studio.domain_name}/signin"]
  supported_identity_providers         = ["COGNITO"]

  enable_token_revocation       = true
  generate_secret               = true
  prevent_user_existence_errors = "ENABLED"
}

resource "aws_cognito_user" "operators" {
  for_each = local.operator_emails

  user_pool_id = aws_cognito_user_pool.studio.id
  username     = each.value

  # `temporary_password`, NOT `password`.
  #
  # `password` in this provider is the PERMANENT password. Combined with
  # `message_action = "SUPPRESS"` — no invite, so no reset is ever forced — the
  # migration to Cognito did not retire the shared secret; it reissued the same
  # value as a durable login password for every operator in the pool, all of
  # them identical. Anyone holding it (the repository secret, a Secrets Manager
  # read, or a copy from before the migration) could sign in through the hosted
  # UI as an allowlisted address and reach every operator surface: publish any
  # tenant's configuration, advance any lifecycle, purge. The deploy summary's
  # claim that "the Studio no longer accepts the shared-secret login" was true
  # of the code path and false of the credential.
  #
  # A temporary password is single-use: Cognito returns NEW_PASSWORD_REQUIRED at
  # first sign-in and the operator must set one Terraform never sees. The
  # seeded value stays readable exactly long enough to perform that one
  # sign-in, which is what makes this a migration rather than a lockout.
  temporary_password = var.platform_operator_secret != "" ? var.platform_operator_secret : random_password.operator_secret.result
  message_action     = "SUPPRESS"

  attributes = {
    email          = each.value
    email_verified = "true"
  }
}
