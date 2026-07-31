# ── SES domain identity ───────────────────────────────────────────────────────
# DNS verification records must be added to the domain registrar after apply.
# Run: terraform output ses_dkim_tokens to get the CNAME records.
resource "aws_ses_domain_identity" "main" {
  domain = "tenurework.com"
}

resource "aws_ses_domain_dkim" "main" {
  domain = aws_ses_domain_identity.main.domain
}

# ── Email address identity (for sandbox testing before domain is verified) ────
resource "aws_ses_email_identity" "from" {
  email = var.ses_from_email
}

# ── Configuration set: bounce/complaint tracking + TLS enforcement ────────────
resource "aws_ses_configuration_set" "main" {
  name = "${local.name_prefix}-mail"

  delivery_options {
    tls_policy = "Require"
  }

  reputation_metrics_enabled = true
  sending_enabled            = true
}

# ── Suppress bounces and complaints automatically ─────────────────────────────
resource "aws_sesv2_account_suppression_attributes" "suppression" {
  suppressed_reasons = ["BOUNCE", "COMPLAINT"]
}
