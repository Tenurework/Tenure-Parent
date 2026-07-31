# ── Scheduled jobs ────────────────────────────────────────────────────────────
#
# Deliverable reminders must fire whether or not anyone opens the app: missing
# an audit or an evaluation deadline freezes a club's budget. EventBridge
# Scheduler calls the job endpoint directly through the ALB.
#
# The endpoint is idempotent (one DeliverableReminder row per person per
# deliverable), so a retry or an overlapping invocation cannot double-notify.

# Shared secret the scheduler presents as a bearer token.
resource "random_password" "job_secret" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "job" {
  name                    = "${local.name_prefix}/job"
  description             = "Bearer token for scheduled job endpoints"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "job" {
  secret_id     = aws_secretsmanager_secret.job.id
  secret_string = jsonencode({ JOB_SECRET = random_password.job_secret.result })
}

# ── IAM: let the scheduler invoke the endpoint via an API destination ─────────
resource "aws_iam_role" "scheduler" {
  name = "${local.name_prefix}-scheduler"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "events.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }
      }
    }]
  })
}

resource "aws_iam_role_policy" "scheduler_invoke" {
  name = "${local.name_prefix}-scheduler-invoke"
  role = aws_iam_role.scheduler.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["events:InvokeApiDestination"]
        Resource = [aws_cloudwatch_event_api_destination.reminders.arn]
      },
    ]
  })
}

# ── Connection + destination ─────────────────────────────────────────────────
resource "aws_cloudwatch_event_connection" "job" {
  name               = "${local.name_prefix}-job"
  authorization_type = "API_KEY"

  auth_parameters {
    api_key {
      key   = "Authorization"
      value = "Bearer ${random_password.job_secret.result}"
    }
  }
}

resource "aws_cloudwatch_event_api_destination" "reminders" {
  name = "${local.name_prefix}-reminders"

  # Must be HTTPS: EventBridge rejects plain HTTP endpoints outright. The ALB
  # only listens on :80 (TLS terminates at CloudFront) and no public ACM cert
  # can be issued for an *.elb.amazonaws.com name, so the call goes through
  # CloudFront. The default cache behavior already allows POST and forwards
  # all headers, so the bearer token reaches the origin intact.
  invocation_endpoint = "https://${
    var.attach_custom_domain ? var.custom_domain : aws_cloudfront_distribution.main.domain_name
  }/api/jobs/reminders"

  http_method                      = "POST"
  invocation_rate_limit_per_second = 1
  connection_arn                   = aws_cloudwatch_event_connection.job.arn
}

# ── Schedule ─────────────────────────────────────────────────────────────────
#
# An EventBridge *Rule*, not EventBridge Scheduler. Scheduler rejects an API
# destination target outright — it returns "Provided Arn is not in correct
# format" for the ARN both with and without its trailing UUID, so the format
# is not the issue: it does not accept this target type. API destinations were
# introduced as Rule targets, which is the supported pairing.
#
# 13:00 UTC ≈ 8–9am Eastern. Deliverables are stored at noon UTC on their due
# date, so a run at 13:00 the day before sits inside the endpoint's 24-hour
# look-ahead window and gives boards a full working day of notice.
resource "aws_cloudwatch_event_rule" "deliverable_reminders" {
  name                = "${local.name_prefix}-deliverable-reminders"
  description         = "Daily 24-hour warning for club deliverables"
  schedule_expression = "cron(0 13 * * ? *)"
}

resource "aws_cloudwatch_event_target" "deliverable_reminders" {
  rule     = aws_cloudwatch_event_rule.deliverable_reminders.name
  arn      = aws_cloudwatch_event_api_destination.reminders.arn
  role_arn = aws_iam_role.scheduler.arn

  # The endpoint takes no input; an empty object keeps EventBridge from
  # forwarding its own event envelope as the request body.
  input = jsonencode({})

  retry_policy {
    maximum_retry_attempts       = 3
    maximum_event_age_in_seconds = 3600
  }
}
