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
  default     = false
}
