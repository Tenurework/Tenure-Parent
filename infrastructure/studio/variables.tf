variable "project" {
  type        = string
  default     = "tenure"
  description = "Used to find the shared VPC and to name this stack's resources."
}

variable "environment" {
  type        = string
  default     = "pilot"
  description = "Which environment's network to borrow. Not the Studio's own environment — the Studio is global."
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "image_tag" {
  type        = string
  default     = "latest"
  description = "Studio container tag to run."
}

variable "task_cpu" {
  type        = number
  default     = 256
  description = "0.25 vCPU. The console renders configuration held in code; it is not a workload."
}

variable "task_memory" {
  type    = number
  default = 512
}

variable "desired_count" {
  type        = number
  default     = 1
  description = "One task. An internal console with a handful of operators does not need two, and the second would double the cost of the whole stack."
}

variable "platform_operators" {
  type    = string
  default = ""

  description = <<-EOT
    Comma-separated `email:role` entries — NOT bare addresses.

    STUDIO-020-005 replaced the membership test with a role family, and
    `parseOperators` REFUSES an entry that names no role rather than defaulting
    one, because a default there makes everybody an administrator. So a value in
    the old bare-address form locks every operator out of the console; that is
    the intended direction of failure, but it is a surprise worth stating here.

    Production holds exactly one entry:
    `satvik@Tenurework.com:platform-super-admin`. The Tenure Global Deployment
    Engine is a single-operator console — it composes, provisions and advances
    every tenant in the estate, so the allowlist is the whole of who can do that
    and it is deliberately one person rather than a team address.

    Empty means nobody can sign in, which the application enforces by refusing
    to serve. The roles are declared in
    `apps/system-studio/src/lib/operators.ts` (`OPERATOR_ROLES`).
  EOT
}

variable "platform_operator_secret" {
  type      = string
  default   = ""
  sensitive = true

  description = <<-EOT
    The shared operator secret.

    Supplied rather than generated when it is set, because a generated one can
    only be read back out of Secrets Manager — and this repository is public, so
    there is no workflow output, log or artifact that could carry it to the
    person who needs it without also publishing it. Supplying it means the
    operator already knows the value and it never has to travel.

    Empty falls back to the generated one, so a deployment with no secret
    configured still comes up with a strong value rather than a blank.
  EOT
}

variable "schema_version" {
  description = <<-EOT
    The tenant schema version this engine builds artifacts against.

    Bumped when apps/web ships a migration that a provisioned tenant must be at.
    A cell compares this against its own before applying a deployment manifest,
    so an engine that is behind cannot publish an artifact claiming a schema it
    does not know about.
  EOT
  type        = string
  default     = "2026.07.31"
}

variable "platform_reconcile_secret" {
  description = <<-EOT
    Bearer token the engine presents when delivering a signed deployment
    manifest to a cell.

    The SAME value must be configured on the receiving cell. It authenticates
    the caller; the artifact's own digest authenticates the content, and neither
    substitutes for the other — a stolen token still cannot make a cell apply an
    altered manifest.

    Empty means the engine publishes artifacts and delivers none. That is
    reported on the tenant's page as a failed step rather than passed over: a
    hand-off nobody received is not a hand-off.
  EOT
  type        = string
  default     = ""
  sensitive   = true
}

# ── STUDIO-070-002 — the ownership facts the tag contract needs ─────────────
#
# Variables rather than literals in `local.tags`, because both of these are
# organisational facts that change without any code changing: a cost centre is
# renamed by finance, and an owning seat moves between teams. Baking either into
# the locals block means the estate's ownership is only correct until the next
# reorganisation, and nobody notices it went stale.
#
# Both are validated. An empty cost centre would be accepted by AWS, merged onto
# every resource in the stack, and then fail `tagProblems` at inventory time —
# after the apply, which is the expensive place to find out.

variable "owner_seat" {
  description = <<-EOT
    The named seat that answers for this stack — a role, never a person.

    A person's address here is an ownership record that expires the day they
    leave, which is the exact case WRK-120-005 exists for. `platform-engineering`
    is a seat somebody always holds.
  EOT
  type        = string
  default     = "platform-engineering"

  validation {
    condition     = trimspace(var.owner_seat) != ""
    error_message = "owner_seat must name a seat. An empty owner tag reads as \"nobody decided\", which is the state this tag exists to remove."
  }
}

variable "cost_center" {
  description = "Where this stack's spend lands. Tagged onto every resource so the CUR can group by it without a lookup table."
  type        = string
  default     = "platform-engine"

  validation {
    condition     = trimspace(var.cost_center) != ""
    error_message = "cost_center must be set. Untagged spend is reported unallocated, never spread."
  }
}

variable "release" {
  description = <<-EOT
    The release these resources were created for.

    Distinct from `schema_version`, which is what the ENGINE builds tenant
    artifacts against. This one answers "which deploy created this resource",
    which is the question asked during an incident.
  EOT
  type        = string
  default     = "unpinned"
}

variable "cell_reconcile_url" {
  description = <<-EOT
    Where a cell accepts deployment manifests. `{region}` is substituted with
    the tenant's placement region, so a second cell is configuration rather than
    a code change.

    One cell exists today, so this is one URL. It is a variable rather than a
    constant because the alternative — hardcoding a hostname in the engine —
    is what makes adding a region a deploy of the engine.
  EOT
  type        = string
  default     = ""
}

variable "studio_domain" {
  description = <<-EOT
    The hostname the System Studio answers on, or "" for the CloudFront default.

    `helm.tenurework.com` — the console an operator steers the fleet from, and
    this codebase already calls the tenants a fleet everywhere (`listFleet`,
    `observeFleet`, `fleetReadings`, "Fleet health").

    Setting this REQUESTS a certificate. It does not attach one: see
    `attach_studio_domain`, and `acm.tf` for why the two cannot be one apply.
  EOT
  type        = string
  default     = "helm.tenurework.com"
}

variable "attach_studio_domain" {
  description = <<-EOT
    Bind the certificate and the alias to the distribution.

    FALSE until ACM reports the certificate ISSUED. Attaching an unvalidated
    certificate fails the apply.

    Two applies, never one. No Route 53 hosted zone for `tenurework.com` is
    declared by either stack — `grep -rn "aws_route53_zone" infrastructure/`
    finds none — so the validation CNAME is published by a person, and Terraform
    cannot wait on a record it is not writing without blocking forever. `acm.tf`
    says what it would take to change that and why it has not been changed.

    Flipping this also moves the auth URLs: Cognito's callback and logout URLs
    and the task's AUTH_URL/NEXTAUTH_URL. All four move together or sign-in
    breaks, which is why they read from one place.

    TRUE since 2026-08-14. ACM reports the certificate ISSUED and the domain's
    validation status SUCCESS, read from the account rather than assumed:

      STUDIO_CERT_STATUS=ISSUED
      STUDIO_CERT_VALIDATION=SUCCESS helm.tenurework.com

    Run `Studio Domain Status` to re-check at any time; it reads without an
    apply. The CloudFront distribution keeps answering on its own hostname as
    well, because `studio_auth_hosts` deliberately keeps BOTH in Cognito while
    DNS propagates — nobody is locked out by the switch.
  EOT
  type        = bool
  default     = true
}
