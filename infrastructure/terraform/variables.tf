variable "project" {
  description = "Project name used in all resource names"
  type        = string
  default     = "tenure"
}

variable "environment" {
  description = "Deployment environment (pilot | staging | production)"
  type        = string
  default     = "pilot"
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

# ── App image ────────────────────────────────────────────────────────────────
variable "image_tag" {
  description = "Docker image tag to deploy (git SHA or 'latest')"
  type        = string
  default     = "latest"
}

# ── Networking ───────────────────────────────────────────────────────────────
variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}

variable "public_subnet_cidrs" {
  type    = list(string)
  default = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "private_subnet_cidrs" {
  type    = list(string)
  default = ["10.0.11.0/24", "10.0.12.0/24"]
}

variable "availability_zones" {
  type    = list(string)
  default = ["us-east-1a", "us-east-1b"]
}

# ── RDS ─────────────────────────────────────────────────────────────────────
variable "rds_instance_class" {
  type    = string
  default = "db.t3.micro"
}

variable "rds_allocated_storage" {
  type    = number
  default = 20
}

variable "rds_db_name" {
  type    = string
  default = "tenure"
}

variable "rds_username" {
  type    = string
  default = "tenure_admin"
}

# ── ElastiCache ──────────────────────────────────────────────────────────────
variable "redis_node_type" {
  type    = string
  default = "cache.t3.micro"
}

# ── ECS ──────────────────────────────────────────────────────────────────────
variable "ecs_cpu" {
  type    = number
  default = 512 # 0.5 vCPU — the app outgrew 256 (health probes starved)
}

variable "ecs_memory" {
  type    = number
  default = 1024
}

variable "ecs_desired_count" {
  type    = number
  default = 1
}

# ── Domain / Auth ─────────────────────────────────────────────────────────────
variable "auth_secret" {
  description = "NextAuth AUTH_SECRET — injected via Secrets Manager after initial deploy"
  type        = string
  default     = ""
  sensitive   = true
}

variable "okta_client_id" {
  type      = string
  default   = ""
  sensitive = true
}

variable "okta_client_secret" {
  type      = string
  default   = ""
  sensitive = true
}

variable "okta_issuer" {
  type    = string
  default = ""
}

variable "ses_from_email" {
  description = "Verified SES sender address"
  type        = string
  default     = "hello@tenurework.com"
}

variable "anthropic_api_key" {
  description = "Optional — enables AI answer synthesis on /search when set"
  type        = string
  default     = ""
  sensitive   = true
}

variable "custom_domain" {
  description = "Custom domain for the app (empty disables)"
  type        = string
  # `platform` rather than `app`: tenurework.com and www.tenurework.com serve the
  # marketing site from Vercel, and the product needed a subdomain that reads as
  # the place where the work happens. Changing this forces replacement of
  # aws_acm_certificate.custom — a certificate's domain_name cannot be edited in
  # place — so the previously requested, never-validated app.tenurework.com cert
  # is destroyed and a new one requested. create_before_destroy keeps the swap
  # safe if the domain is ever changed again while attached.
  default = "platform.tenurework.com"
}

variable "attach_custom_domain" {
  description = "Bind the custom domain to CloudFront — only after the ACM cert is ISSUED"
  type        = bool
  # Enabled 2026-07-30: the certificate for platform.tenurework.com reached
  # ISSUED (validation SUCCESS, SAN platform.tenurework.com, expires
  # 2027-02-12) once a CAA record authorising amazon.com was published. The two
  # earlier requests ended in CAA_ERROR because tenurework.com permitted only
  # letsencrypt.org, pki.goog and sectigo.com.
  #
  # This flips three things at once, by design: the CloudFront alias and viewer
  # certificate (cloudfront.tf), NEXTAUTH_URL (ecs.tf) and the EventBridge
  # reminder destination (scheduler.tf). Auth would break on the branded host if
  # the first moved without the second, so they must not be split.
  default = true
}

# ── STUDIO-070-002 — the ownership facts default_tags needs ─────────────────
#
# Variables rather than literals in the provider block, for the same reason the
# studio stack does it: a cost centre is renamed by finance and an owning seat
# moves between teams, and neither event is a code change anybody would think to
# make. Baked literals mean the estate's ownership is correct only until the
# next reorganisation, and nothing tells you it went stale.

variable "cell_id" {
  description = <<-EOT
    Which cell this stack IS.

    Matches CELL_ID in the Studio's fleet view (apps/system-studio/src/lib/cells.ts
    defaults it to `cell-<region>-a`), so a resource's tag and the cell record an
    operator reads name the same thing. They are the same fact; two spellings of
    it is a fleet view that cannot be joined to a bill.
  EOT
  type        = string
  default     = "cell-us-east-1-a"
}

variable "owner_seat" {
  description = "The named seat that answers for this cell — a role, never a person who can leave."
  type        = string
  default     = "platform-engineering"

  validation {
    condition     = trimspace(var.owner_seat) != ""
    error_message = "owner_seat must name a seat. An empty owner tag reads as \"nobody decided\", which is the state this tag exists to remove."
  }
}

variable "cost_center" {
  description = "Where this cell's spend lands. Tagged onto every resource so the CUR can group by it without a lookup table."
  type        = string
  default     = "tenant-cells"

  validation {
    condition     = trimspace(var.cost_center) != ""
    error_message = "cost_center must be set. Untagged spend is reported unallocated, never spread."
  }
}
