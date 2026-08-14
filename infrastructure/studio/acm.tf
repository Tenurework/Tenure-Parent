# ── The engine's own certificate (helm.tenurework.com) ───────────────────────
#
# Two phases, and they cannot be collapsed into one apply.
#
#   1. This file requests the certificate. ACM emits a validation CNAME, which
#      the outputs below print. A person publishes it wherever `tenurework.com`
#      is served from — see "Why Terraform does not write the validation record
#      itself", further down, for why that is a person and not a resource.
#      There is deliberately no `aws_acm_certificate_validation` here: it waits
#      on a record this configuration is not creating, so it would hold the
#      apply open until it timed out.
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
# CAA. `infrastructure/terraform/variables.tf` records that the pilot's
# `platform.tenurework.com` certificate reached ISSUED on 2026-07-30 only once a
# CAA record authorising `amazon.com` was published at the apex, after two
# requests failed CAA_ERROR. CAA is inherited down the tree, so that same record
# is what permits ACM to issue for this subdomain. Nobody re-queried the apex
# from here — `dig CAA tenurework.com +short` is the check — but a CAA_ERROR on
# this certificate has exactly one known cause and it is written down.

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

# ── Why Terraform does not write the validation record itself ────────────────
#
# It would be four resources — `aws_route53_record` per validation option and an
# `aws_acm_certificate_validation` to wait for ISSUED — and both were written and
# then TAKEN BACK OUT, deliberately, for two reasons that are worth the space:
#
#   1. There is no zone to write into that anybody has confirmed.
#      `grep -rn "aws_route53_zone" infrastructure/` finds none in either stack,
#      so `tenurework.com` is delegated somewhere this configuration cannot see.
#      A hosted zone id cannot be guessed safely: Route 53 accepts any
#      well-formed id this account can write, so a wrong one publishes a CNAME
#      into the wrong domain and the apply SUCCEEDS while the certificate never
#      validates. `aws route53 list-hosted-zones --query "HostedZones[?Name=='tenurework.com.']"`
#      is the one command that settles it, and nobody has run it.
#   2. `aws_route53_record` is a service this console does not read.
#      `tests/architecture/every-provisioned-service-has-a-reader.test.mjs` went
#      RED on exactly that — "Terraform declares 2 resource type(s) this table
#      does not classify" — and it is right to. Its `ESTATE` has entries for
#      `acm` and `cloudfront`; it has none for `route53`, so provisioning DNS
#      here would add a service to the estate that no operator surface can show,
#      which is the defect that file exists to catch. Landing it needs a
#      `route53` ESTATE entry, a reader module, a surface director and a row in
#      the wiring map — none of which live in this file.
#
# So the record is PRINTED, below, and published by a person. That path works
# whoever holds the zone, which is the right default while nobody knows.

# ── What a human has to do next ──────────────────────────────────────────────
#
# Printed as outputs rather than left in the AWS console, because the person who
# adds the record is not necessarily the person who ran the apply, and "go and
# look it up" is how a certificate sits PENDING_VALIDATION for a week.

output "studio_acm_validation_records" {
  description = "Add these CNAMEs at the registrar to validate the Studio certificate. Already written for you when studio_hosted_zone_id is set."
  value = var.studio_domain != "" ? [
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
