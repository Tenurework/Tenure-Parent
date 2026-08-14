# ── The engine's own certificate (helm.tenurework.com) ───────────────────────
#
# Two phases, and they cannot be collapsed into one apply.
#
#   1. This file requests the certificate. ACM emits a validation CNAME, which
#      the outputs below print. Somebody adds it at the registrar — Vercel holds
#      `tenurework.com`, not Route 53, so Terraform cannot write the record
#      itself and there is no `aws_acm_certificate_validation` resource here to
#      wait on one. It would block the apply forever.
#   2. Once ACM reports ISSUED, `attach_studio_domain = true` binds it to the
#      distribution in `cloudfront.tf` and moves the auth URLs onto the new name.
#
# Attaching an unvalidated certificate fails the apply, which is why the second
# phase is a separate variable and not a `depends_on`.
#
# REGION. CloudFront accepts a certificate only from us-east-1, whatever region
# the distribution serves. This stack's provider already defaults to us-east-1
# (`variables.tf`), so no aliased provider is needed — but that is a coincidence
# worth writing down, because moving this stack to another region would silently
# request the certificate somewhere CloudFront will not read it.
#
# CAA. `tenurework.com` already carries `0 issue "amazon.com"` at the apex, and
# CAA is inherited down the tree, so ACM is permitted to issue for this
# subdomain. Without it validation stays PENDING with no error anybody sees.

resource "aws_acm_certificate" "studio" {
  count             = var.studio_domain != "" ? 1 : 0
  domain_name       = var.studio_domain
  validation_method = "DNS"

  # Certificate Transparency is left at ACM's default (ENABLED). Declaring it
  # explicitly means adding an `options` block, which is ForceNew in some
  # provider versions — destroying a validated certificate to assert a value it
  # already holds is not a trade worth making. Pin it, if ever, while nothing is
  # attached to CloudFront.

  lifecycle {
    create_before_destroy = true
  }

  # `merge(local.tags, …)`, not a hand-written block. `resource-tags.test.mjs`
  # refuses a resource that writes its own, and it is right to: the stack's
  # contract carries `tenure:tenant = tenure:shared`, and a certificate tagged
  # by hand would have arrived in the estate inventory unattributable — spread
  # across every customer's bill by default, which is the failure that sentinel
  # exists to prevent. Caught by the guard before this shipped.
  tags = merge(local.tags, {
    Name    = "${local.name_prefix}-studio-domain"
    Purpose = "SystemStudioCustomDomain"
  })
}

# ── What a human has to do next ──────────────────────────────────────────────
#
# Printed as outputs rather than left in the AWS console, because the person who
# adds the record is not necessarily the person who ran the apply, and "go and
# look it up" is how a certificate sits PENDING_VALIDATION for a week.

output "studio_acm_validation_records" {
  description = "Add these CNAMEs at the registrar (Vercel) to validate the Studio certificate"
  value       = var.studio_domain != "" ? [
    for o in aws_acm_certificate.studio[0].domain_validation_options : {
      name  = o.resource_record_name
      type  = o.resource_record_type
      value = o.resource_record_value
    }
  ] : []
}

output "studio_acm_certificate_arn" {
  description = "The Studio certificate, so its status can be read without hunting for it"
  value       = var.studio_domain != "" ? aws_acm_certificate.studio[0].arn : ""
}

output "studio_domain_cname_target" {
  description = "Point the Studio subdomain CNAME at this"
  value       = aws_cloudfront_distribution.studio.domain_name
}

# ── One hostname, read from one place ────────────────────────────────────────
#
# The public hostname is threaded through auth in four places: Cognito's
# `callback_urls` and `logout_urls`, and the task's `AUTH_URL` and
# `NEXTAUTH_URL`. A rename that reaches three of them produces a console that
# loads and cannot sign anybody in, and the failure appears at the identity
# provider rather than in the diff. So they all read these.
locals {
  # What the console calls itself. One value, because NextAuth compares the
  # incoming Host against it and two answers means a redirect loop.
  studio_host   = var.attach_studio_domain ? var.studio_domain : aws_cloudfront_distribution.studio.domain_name
  studio_origin = "https://${local.studio_host}"

  # Cognito, deliberately, accepts BOTH while a custom domain is attached.
  # Flipping `attach_studio_domain` and the DNS are separate events minutes or
  # hours apart, and an operator arriving on the old hostname in between would
  # otherwise be redirected to a callback the app client does not allow — locked
  # out of the console by the change that was meant to improve it. Cognito
  # permits multiple callback URLs precisely for this.
  studio_auth_hosts = distinct(compact([
    local.studio_host,
    aws_cloudfront_distribution.studio.domain_name,
  ]))
}
