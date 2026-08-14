output "studio_url" {
  description = "The System Studio. This is the platform engine, not a tenant."
  # , not the distribution hostname: the deploy workflow
  # reads this to prove the console serves, and after the custom domain is
  # attached the CloudFront name is no longer where an operator goes.
  value       = local.studio_origin
}

output "cloudfront_domain" {
  value = aws_cloudfront_distribution.studio.domain_name
}

output "ecr_repository_url" {
  value = aws_ecr_repository.studio.repository_url
}

output "operator_first_signin_command" {
  description = <<-EOT
    How to read the ONE-TIME temporary password for a first Cognito sign-in.

    Deliberately a command rather than a value: an output lands in the state
    file in plaintext and in every plan anyone runs.

    This is no longer a standing credential. `aws_cognito_user.operators` seeds
    it as `temporary_password`, so Cognito answers NEW_PASSWORD_REQUIRED on the
    first sign-in and the operator sets a password Terraform never sees; MFA
    enrolment happens in the same flow because the pool is `mfa_configuration =
    "ON"`. After that first sign-in this value authenticates nobody.
  EOT

  value = "aws secretsmanager get-secret-value --secret-id ${aws_secretsmanager_secret.studio.name} --query SecretString --output text"
}

output "cognito_user_pool_id" {
  description = "Cognito user pool backing System Studio authentication."
  value       = aws_cognito_user_pool.studio.id
}

output "cognito_hosted_ui_domain" {
  description = "Hosted UI domain used by the Cognito provider."
  value       = "${aws_cognito_user_pool_domain.studio.domain}.auth.${var.aws_region}.amazoncognito.com"
}

output "ecs_cluster" {
  value = aws_ecs_cluster.studio.name
}

output "ecs_service" {
  value = aws_ecs_service.studio.name
}
