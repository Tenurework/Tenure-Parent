# ── Dead-letter queues (poison messages, failed retries) ─────────────────────
resource "aws_sqs_queue" "default_dlq" {
  name                      = "${local.name_prefix}-default-dlq"
  message_retention_seconds = 1209600 # 14 days
}

resource "aws_sqs_queue" "email_dlq" {
  name                      = "${local.name_prefix}-email-dlq"
  message_retention_seconds = 1209600
}

# ── Main queues ───────────────────────────────────────────────────────────────

# General background jobs: search indexing, AI embeddings, analytics
resource "aws_sqs_queue" "default" {
  name                       = "${local.name_prefix}-default"
  visibility_timeout_seconds = 60
  message_retention_seconds  = 86400 # 1 day

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.default_dlq.arn
    maxReceiveCount     = 5
  })
}

# Email delivery jobs (transactional + digests)
resource "aws_sqs_queue" "email" {
  name                       = "${local.name_prefix}-email"
  visibility_timeout_seconds = 30
  message_retention_seconds  = 3600 # 1 hour — stale emails not useful

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.email_dlq.arn
    maxReceiveCount     = 3
  })
}

# Approval notifications (higher priority, short visibility timeout)
resource "aws_sqs_queue" "notifications" {
  name                       = "${local.name_prefix}-notifications"
  visibility_timeout_seconds = 30
  message_retention_seconds  = 86400

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.default_dlq.arn
    maxReceiveCount     = 3
  })
}
