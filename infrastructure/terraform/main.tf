terraform {
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
  }

  # Backend configured via -backend-config flags in CI (avoids hardcoding account ID)
  backend "s3" {}
}

provider "aws" {
  region = var.aws_region

  # ── STUDIO-070-002 — the twelve required tags, at the provider ────────────
  #
  # This stack has no `local.tags` to merge, and fourteen resources across
  # vpc.tf, rds.tf, security_groups.tf, cloudfront.tf and elasticache.tf set a
  # bare `tags = { Name = ... }`. Putting the contract in `default_tags` is what
  # reaches all of them: the provider merges these into every resource it
  # creates, and a resource-level `tags` block only overrides the keys it names.
  # `Name` is not one of these keys, so nothing here is displaced.
  #
  # Extending the locals of a stack that has none, or editing fourteen resource
  # blocks, would both have been more code and less coverage — the next resource
  # somebody adds with a bare `Name` tag is covered by this and would not have
  # been by either.
  #
  # `tenure:tenant = tenure:shared` because this is the POOLED cell: one VPC,
  # one database and one service carry every pooled tenant, so no single tenant
  # owns any of it. That is a decision recorded as a value, not an absence —
  # see packages/provisioning/src/resource-tags.ts for why the difference
  # matters more than anything else in the contract.
  default_tags {
    tags = {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"

      "tenure:tenant"          = "tenure:shared"
      "tenure:environment"     = var.environment
      "tenure:cell"            = var.cell_id
      "tenure:account-purpose" = "workload"
      "tenure:module"          = "tenant-cell"
      "tenure:release"         = var.image_tag
      "tenure:stack"           = "pilot/terraform.tfstate"
      # The cell holds identifiable student records. Nothing in this stack may
      # be tagged lower than the highest class of data it can reach, because the
      # tag is what decides who may read it.
      "tenure:data-class"  = "student-record"
      "tenure:owner-seat"  = var.owner_seat
      "tenure:cost-center" = var.cost_center
      "tenure:retention"   = "indefinite"
      "tenure:managed-by"  = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  name_prefix = "${var.project}-${var.environment}"
  account_id  = data.aws_caller_identity.current.account_id
  region      = data.aws_region.current.name
}
