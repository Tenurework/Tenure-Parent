/**
 * The Tenure System Studio — the global platform engine.
 *
 * Standalone by design. This is not a tenant and does not resemble one: it runs
 * different code, different modules, and shows every tenant's configuration at
 * once. PD-007 requires it off any tenant's origin.
 *
 * ── The separate state file is the load-bearing decision ────────────────────
 *
 * Backend key `studio/terraform.tfstate`, NOT `pilot/terraform.tfstate`.
 *
 * Two repositories already apply Terraform against this AWS account:
 * Tenurework/Tenure owns the pilot, and this repository owns the engine. If both
 * wrote the same state file, whichever applied second would see the other's
 * resources as "not in my configuration" and DESTROY them. That is not a
 * theoretical hazard — it is the default behaviour of `terraform apply` against
 * a state containing resources the code does not declare, and it would take the
 * live pilot down.
 *
 * Separate state makes the two stacks incapable of touching each other.
 *
 * ── What is shared, and why that is safe ────────────────────────────────────
 *
 * The VPC and its public subnets are read through data sources. A data source
 * reads; it cannot create, modify or destroy. The pilot keeps ownership of the
 * network, this stack borrows it, and no `terraform destroy` here can remove
 * anything the pilot depends on.
 *
 * Everything else is its own: cluster, ALB, security groups, log group, ECR
 * repository, secret and CloudFront distribution.
 *
 * ── Cost ────────────────────────────────────────────────────────────────────
 *
 * ~$25/month: an ALB (~$16), one 0.25 vCPU / 0.5 GB Fargate task (~$9), and
 * CloudFront and ECR at effectively nothing for this traffic. A shared ALB with
 * a host-header rule would save the $16 and reintroduce exactly the cross-stack
 * coupling the separate state exists to prevent.
 */

terraform {
  required_version = ">= 1.9"

  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.0" }
    random = { source = "hashicorp/random", version = "~> 3.5" }
  }

  backend "s3" {
    # bucket / key / region / dynamodb_table supplied by -backend-config,
    # so the same code initialises against any account.
  }
}

provider "aws" {
  region = var.aws_region
}

locals {
  name_prefix = "${var.project}-studio"

  # ── STUDIO-070-002 — the twelve required tags ─────────────────────────────
  #
  # `local.tags` is merged into every resource in this stack, so extending it
  # here is what puts the contract on the estate rather than in a document. The
  # keys and the accepted values are declared in code at
  # packages/provisioning/src/resource-tags.ts; tests/architecture/resource-tags
  # .test.mjs reads THIS block and fails if a key goes missing or a `tags = {`
  # elsewhere in the stack stops merging it.
  #
  # `tenure:tenant = tenure:shared` is the load-bearing line. Every resource in
  # this stack genuinely belongs to no tenant — it is the control plane — and
  # saying so explicitly is different from leaving the key off. Absence reads as
  # "nobody looked at this" and the inventory reports it as unattributable;
  # spreading an untagged resource across every customer's bill by default is
  # exactly the failure the sentinel exists to prevent.
  #
  # The five original PascalCase keys are kept. They are what the pilot stack's
  # data sources and several AWS consoles filter on, and dropping them to tidy
  # the block would orphan `data.aws_vpc.shared`'s lookup.
  tags = {
    Project     = var.project
    Component   = "system-studio"
    ManagedBy   = "terraform"
    StateKey    = "studio/terraform.tfstate"
    Environment = var.environment

    "tenure:tenant"          = "tenure:shared"
    "tenure:environment"     = var.environment
    "tenure:cell"            = "tenure:shared"
    "tenure:account-purpose" = "control-plane"
    "tenure:module"          = "system-studio"
    "tenure:release"         = var.release
    "tenure:stack"           = "studio/terraform.tfstate"
    "tenure:data-class"      = "control-plane"
    "tenure:owner-seat"      = var.owner_seat
    "tenure:cost-center"     = var.cost_center
    "tenure:retention"       = "indefinite"
    "tenure:managed-by"      = "terraform"
  }
}

# ── Borrowed, read-only ─────────────────────────────────────────────────────
#
# Named by the tags the pilot stack applies. If the pilot's VPC is ever renamed
# these fail loudly at plan time, which is the right outcome: an engine silently
# landing in a different network is worse than one that refuses to plan.

data "aws_vpc" "shared" {
  filter {
    name   = "tag:Name"
    values = ["${var.project}-${var.environment}-vpc"]
  }
}

data "aws_subnets" "public" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.shared.id]
  }
  filter {
    name   = "tag:Name"
    values = ["${var.project}-${var.environment}-public-*"]
  }
}

data "aws_caller_identity" "current" {}
