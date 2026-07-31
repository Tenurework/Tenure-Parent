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
