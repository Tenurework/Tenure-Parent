output "studio_url" {
  description = "The System Studio. This is the platform engine, not a tenant."
  value       = "https://${aws_cloudfront_distribution.studio.domain_name}"
}

output "cloudfront_domain" {
  value = aws_cloudfront_distribution.studio.domain_name
}

output "ecr_repository_url" {
  value = aws_ecr_repository.studio.repository_url
}

output "operator_secret_command" {
  description = "How to read the operator secret out. Deliberately not an output value — an output lands in the state file in plaintext and in every plan anyone runs."
  value       = "aws secretsmanager get-secret-value --secret-id ${aws_secretsmanager_secret.studio.name} --query SecretString --output text"
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
