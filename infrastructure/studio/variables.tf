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
  type        = string
  default     = ""
  description = "Comma-separated Tenure staff addresses. Empty means nobody can sign in, which the application enforces by refusing to serve."
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
