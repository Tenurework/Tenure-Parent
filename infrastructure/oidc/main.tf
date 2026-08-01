/**
 * GitHub Actions OIDC deployment identity.
 *
 * GE-011. Replaces the long-lived access keys that both `satvikOS/Tenure` and
 * `satvikOS/Tenure-Parent` currently hold, with short-lived credentials minted
 * per job and scoped to an exact repository, branch and audience.
 *
 * ── Why this is worth doing before the AWS Organization exists ──────────────
 *
 * ADR-0007 decides the Organization's shape and stops short of creating it,
 * because that is a billing and ownership decision. This stack does not wait on
 * it. Today one static key pair, with no expiry and no repository binding, can
 * do everything in the account, and it sits in two repositories' secret stores.
 * Any exposure of it is total and permanent until someone notices.
 *
 * An OIDC token is minted per job, expires in an hour, cannot be exported to
 * anywhere useful, and — the part that matters most — is bound by a `sub` claim
 * GitHub signs. A leaked workflow file cannot assume these roles from another
 * repository, because the claim would not match.
 *
 * When the Organization arrives the roles move; nothing here is wasted.
 *
 * ── Separate state, for the reason the studio stack documents at length ─────
 *
 * Backend key `oidc/terraform.tfstate`. Three stacks now write this account —
 * pilot, studio, oidc — and each must be incapable of destroying the others'
 * resources. A shared state file makes that destruction the DEFAULT behaviour,
 * not an accident.
 *
 * ── Cost ────────────────────────────────────────────────────────────────────
 *
 * An OIDC provider and IAM roles are free. This stack costs nothing to run and
 * removes a standing credential; there is no trade-off to weigh.
 */

terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }

  backend "s3" {
    # bucket / key / region supplied by -backend-config.
  }
}

provider "aws" {
  region = var.aws_region
}

data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id

  tags = {
    Project   = var.project
    Component = "github-oidc"
    ManagedBy = "terraform"
    StateKey  = "oidc/terraform.tfstate"
  }

  # The exact repositories permitted to assume anything here, in the form
  # GitHub actually signs.
  #
  # This is NOT `satvikOS/Tenure-Parent`. GitHub issues this repository an
  # immutable-ID-qualified subject:
  #
  #   repo:satvikOS@228056784/Tenure-Parent@1316219596:ref:refs/heads/main
  #
  # A trust policy naming the plain path never matches, and the failure is
  # "Not authorized to perform sts:AssumeRoleWithWebIdentity" — which says only
  # that the policy did not match, never what was received. It cost a debug step
  # printing the claim to find; that step is kept for the next role.
  #
  # The ID form is stricter, not a workaround: the numbers are immutable, so
  # renaming or recreating a repository at the same path does not inherit this
  # trust. The names are kept alongside for readability.
  engine_repo = "satvikOS@228056784/Tenure-Parent@1316219596"
  pilot_repo  = "satvikOS/Tenure"
}

# ── The provider ────────────────────────────────────────────────────────────
#
# One per account. `data` first would be nicer, but an account can hold only one
# provider for a given URL, and this account has none — confirmed by the
# inventory of 2026-07-31 (`iam.oidcProviders: []`).
#
# On thumbprints: since mid-2023 AWS validates GitHub's OIDC certificate against
# its own trust store and the thumbprint is not used for github.com. It is still
# a required argument, so the value below is GitHub's well-known intermediate.
# Leaving it stale would not weaken the trust; pinning it wrongly and *believing*
# it is what secures the connection would.
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]

  tags = merge(local.tags, { Name = "github-actions" })
}
