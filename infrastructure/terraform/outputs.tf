output "cloudfront_domain" {
  description = "CloudFront domain — the live application URL"
  value       = aws_cloudfront_distribution.main.domain_name
}

output "cloudfront_url" {
  description = "Full HTTPS URL of the deployed application"
  value       = "https://${aws_cloudfront_distribution.main.domain_name}"
}

output "ecr_repository_url" {
  description = "ECR repository URL for pushing Docker images"
  value       = aws_ecr_repository.app.repository_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  value = aws_ecs_service.app.name
}

output "alb_dns_name" {
  description = "ALB DNS (CloudFront origin — not for direct use)"
  value       = aws_lb.main.dns_name
}

output "rds_endpoint" {
  description = "RDS host:port — use DATABASE_URL from Secrets Manager"
  value       = aws_db_instance.postgres.endpoint
  sensitive   = true
}

output "redis_endpoint" {
  value = "${aws_elasticache_cluster.redis.cache_nodes[0].address}:6379"
}

output "sqs_default_url"       { value = aws_sqs_queue.default.url }
output "sqs_email_url"         { value = aws_sqs_queue.email.url }
output "sqs_notifications_url" { value = aws_sqs_queue.notifications.url }

output "s3_documents_bucket" { value = aws_s3_bucket.documents.bucket }
output "s3_exports_bucket"   { value = aws_s3_bucket.exports.bucket }

output "app_secrets_arn" {
  value     = aws_secretsmanager_secret.app.arn
  sensitive = true
}

output "ses_dkim_tokens" {
  description = "Add these as CNAME records in DNS to verify the domain for SES"
  value       = aws_ses_domain_dkim.main.dkim_tokens
}
