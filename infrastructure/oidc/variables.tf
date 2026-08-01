variable "aws_region" {
  description = "Region for the provider. IAM is global; this only decides where API calls go."
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Name prefix for every resource in this stack."
  type        = string
  default     = "tenure"
}

variable "state_bucket" {
  description = <<-EOT
    The Terraform state bucket, named in the plan and deploy role policies so
    they can read and lock state without being granted S3 broadly.

    Required, with no default: a wrong default here would silently produce a
    role that cannot read state, and the failure would surface as a confusing
    Terraform error rather than as a missing input.
  EOT
  type        = string

  validation {
    condition     = length(var.state_bucket) > 0
    error_message = "state_bucket is required — the plan and deploy roles are scoped to it by name."
  }
}
