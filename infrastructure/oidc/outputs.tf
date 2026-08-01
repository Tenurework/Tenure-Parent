output "oidc_provider_arn" {
  description = "The GitHub Actions OIDC provider. One per account."
  value       = aws_iam_openid_connect_provider.github.arn
}

output "read_role_arn" {
  description = "Assumed by the AWS inventory workflow. Metadata only — cannot read object content."
  value       = aws_iam_role.read.arn
}

output "plan_role_arn" {
  description = "Assumed by terraform plan. Reads state, changes nothing."
  value       = aws_iam_role.plan.arn
}

output "deploy_engine_role_arn" {
  description = "Assumed by the System Studio deploy, from the protected engine-production environment only."
  value       = aws_iam_role.deploy_engine.arn
}

output "next_steps" {
  description = "What an operator does with these ARNs."
  value       = <<-EOT
    Set the role ARNs as repository variables (not secrets — an ARN is not
    sensitive, and a variable is visible in logs where a secret would be masked
    into uselessness for debugging):

      gh variable set AWS_READ_ROLE_ARN          --body "${aws_iam_role.read.arn}"
      gh variable set AWS_PLAN_ROLE_ARN          --body "${aws_iam_role.plan.arn}"
      gh variable set AWS_DEPLOY_ENGINE_ROLE_ARN --body "${aws_iam_role.deploy_engine.arn}"

    The deploy role additionally requires a GitHub environment named
    engine-production to exist, because its trust policy names it. Until it
    does, that role cannot be assumed by anything — which is the intended
    failure direction.
  EOT
}
