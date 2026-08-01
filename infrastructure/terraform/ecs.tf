# ── ECS cluster ───────────────────────────────────────────────────────────────
resource "aws_ecs_cluster" "main" {
  name = local.name_prefix

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

# ── IAM: task execution role (pulls ECR image, writes logs, reads secrets) ────
resource "aws_iam_role" "ecs_execution" {
  name = "${local.name_prefix}-ecs-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution_managed" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy_attachment" "ecs_execution_secrets" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = aws_iam_policy.ecs_secrets.arn
}

# ── IAM: task role (runtime AWS SDK calls: S3, SQS, SES) ────────────────────
resource "aws_iam_role" "ecs_task" {
  name = "${local.name_prefix}-ecs-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "ecs_task_inline" {
  name = "${local.name_prefix}-ecs-task-inline"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # ECS Exec (execute-command) channel
        Effect = "Allow"
        Action = [
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel",
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:GetObjectAttributes"]
        Resource = [
          "${aws_s3_bucket.documents.arn}/*",
          "${aws_s3_bucket.exports.arn}/*",
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [aws_s3_bucket.documents.arn, aws_s3_bucket.exports.arn]
      },
      {
        Effect = "Allow"
        Action = [
          "sqs:SendMessage", "sqs:ReceiveMessage",
          "sqs:DeleteMessage", "sqs:GetQueueAttributes",
        ]
        Resource = [
          aws_sqs_queue.default.arn,
          aws_sqs_queue.email.arn,
          aws_sqs_queue.notifications.arn,
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["ses:SendEmail", "ses:SendRawEmail"]
        Resource = "*"
        Condition = {
          StringEquals = {
            "ses:FromAddress" = var.ses_from_email
          }
        }
      },
    ]
  })
}

# ── CloudWatch log group ──────────────────────────────────────────────────────
resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${local.name_prefix}"
  retention_in_days = 30
}

# ── ECS task definition ───────────────────────────────────────────────────────
resource "aws_ecs_task_definition" "app" {
  family                   = "${local.name_prefix}-app"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.ecs_cpu
  memory                   = var.ecs_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "app"
      image     = "${aws_ecr_repository.app.repository_url}:${var.image_tag}"
      essential = true

      portMappings = [{ containerPort = 3000, protocol = "tcp" }]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = "3000" },
        { name = "NEXTAUTH_URL", value = var.attach_custom_domain ? "https://${var.custom_domain}" : "https://${aws_cloudfront_distribution.main.domain_name}" },
        { name = "REDIS_URL", value = "redis://${aws_elasticache_cluster.redis.cache_nodes[0].address}:6379" },
        { name = "SQS_DEFAULT_URL", value = aws_sqs_queue.default.url },
        { name = "SQS_EMAIL_URL", value = aws_sqs_queue.email.url },
        { name = "SQS_NOTIFICATIONS_URL", value = aws_sqs_queue.notifications.url },
        { name = "S3_DOCUMENTS_BUCKET", value = aws_s3_bucket.documents.bucket },
        { name = "S3_EXPORTS_BUCKET", value = aws_s3_bucket.exports.bucket },
        { name = "AWS_REGION", value = var.aws_region },
        { name = "SES_FROM_EMAIL", value = var.ses_from_email },
        # DATABASE_URL is composed in the entrypoint from DB_CREDS + these:
        { name = "DB_HOST", value = aws_db_instance.postgres.address },
        { name = "DB_PORT", value = "5432" },
        { name = "DB_NAME", value = var.rds_db_name },
        # Pilot sign-in without Okta (seeded users, email-based).
        #
        # PILOT ONLY. `dev-login` signs in any seeded email with no password,
        # and the seeded set includes an OSE_DIRECTOR — so while this is on,
        # anyone who can reach the site is one click from the highest role in
        # the system. src/lib/env.ts refuses to boot with this enabled in
        # production unless the line below says so explicitly, so that a copied
        # task definition cannot inherit the posture silently.
        #
        # To close it: configure Okta in Secrets Manager (tenure-pilot/app),
        # set AUTH_DEV_LOGIN to "false" and delete the acknowledgement.
        { name = "AUTH_DEV_LOGIN", value = "true" },
        { name = "ALLOW_DEV_LOGIN_IN_PRODUCTION", value = "true" },

        # SEED_ON_BOOT is deliberately NOT set. scripts/seed.mjs is a
        # development and e2e fixture, not a data pipeline: it issues unscoped
        # deletes to reset test state (e.g. `approvalDelegation.deleteMany({})`
        # at seed.mjs:361, whose own comment says it clears prior e2e runs).
        # Running that on every task start, scale-out and health-check restart
        # was destroying live rows on a schedule.
        #
        # Reference data already lives in the database. To publish an update,
        # run the "Seed reference data" workflow, which executes it once as a
        # one-off ECS task instead of on every boot.

        # Tenant isolation is enforced, not observed. With this unset the query
        # layer applies the tenant filter wherever a scope is open and merely
        # records where none is; with it set, a tenant-scoped query without a
        # scope throws instead. See ADR-0002.
        #
        # Switched on once the recording reached zero and stayed there: 132/132
        # e2e with enforcement on, no TenantContextError, plus a manual sweep of
        # every page, parameterised route and API handler the suite does not
        # reach by URL. Removing this line silently downgrades isolation to a
        # log line, so it is a deliberate value rather than a default.
        { name = "TENANCY_ENFORCE", value = "true" },

        # Surfaced by /api/health so CI can verify which build is serving
        { name = "IMAGE_TAG", value = var.image_tag },
        # Optional: enables AI answer synthesis on /search when non-empty
        { name = "ANTHROPIC_API_KEY", value = var.anthropic_api_key },
      ]

      secrets = [
        {
          name      = "AUTH_SECRET"
          valueFrom = "${aws_secretsmanager_secret.app.arn}:AUTH_SECRET::"
        },
        {
          name      = "OKTA_CLIENT_ID"
          valueFrom = "${aws_secretsmanager_secret.app.arn}:OKTA_CLIENT_ID::"
        },
        {
          name      = "OKTA_CLIENT_SECRET"
          valueFrom = "${aws_secretsmanager_secret.app.arn}:OKTA_CLIENT_SECRET::"
        },
        {
          name      = "OKTA_ISSUER"
          valueFrom = "${aws_secretsmanager_secret.app.arn}:OKTA_ISSUER::"
        },
        {
          # Bearer token the scheduler presents to /api/jobs/*
          name      = "JOB_SECRET"
          valueFrom = "${aws_secretsmanager_secret.job.arn}:JOB_SECRET::"
        },
        {
          # Interim gate in front of passwordless sign-in. Remove together with
          # AUTH_DEV_LOGIN when Okta is live. See dev-login-gate.tf.
          name      = "DEV_LOGIN_PASSPHRASE"
          valueFrom = "${aws_secretsmanager_secret.dev_login.arn}:DEV_LOGIN_PASSPHRASE::"
        },
        {
          # RDS-managed secret value is JSON {"username","password"} — the
          # entrypoint parses it and exports a proper DATABASE_URL.
          name      = "DB_CREDS"
          valueFrom = "${aws_db_instance.postgres.master_user_secret[0].secret_arn}"
        },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.app.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "app"
        }
      }

      # No container-level health probe: the ALB target-group check guards
      # /api/health over the network (and demonstrably works), while the
      # in-container wget probe failed persistently on Fargate despite the
      # identical image passing it under plain Docker — it churned healthy
      # tasks every ~7 minutes. One health authority: the load balancer.
    }
  ])

  lifecycle {
    create_before_destroy = true
  }
}

# ── ECS service ───────────────────────────────────────────────────────────────
resource "aws_ecs_service" "app" {
  name            = "${local.name_prefix}-app"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.ecs_desired_count
  launch_type     = "FARGATE"

  # Zero-downtime rollovers: keep the old task serving until the new one
  # is healthy (the 0% bootstrap-era setting caused brief 503 windows)
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  # Don't block Terraform while ECS stabilizes (handled by CI wait step)
  wait_for_steady_state = false

  # The entrypoint runs prisma db push + seed before the server listens —
  # without this grace period the ALB marks new tasks unhealthy during
  # bootstrap and ECS kills them before they ever serve.
  health_check_grace_period_seconds = 300

  # Shell access into live containers (aws ecs execute-command) for forensics
  enable_execute_command = true

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = true # Required for ECR pull without NAT gateway
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "app"
    container_port   = 3000
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [aws_lb_listener.http]

  # NOTE: no ignore_changes on task_definition — Terraform must roll the
  # service to each new revision (CI's force-new-deployment does not pass
  # a task definition, so ignoring it pinned the service to revision 1).
}
