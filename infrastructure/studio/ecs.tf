resource "aws_cloudwatch_log_group" "studio" {
  name              = "/ecs/${local.name_prefix}"
  retention_in_days = 30
  tags              = local.tags
}

resource "aws_ecs_cluster" "studio" {
  name = local.name_prefix

  setting {
    name  = "containerInsights"
    value = "disabled"
  }

  tags = local.tags
}

resource "aws_ecs_cluster_capacity_providers" "studio" {
  cluster_name       = aws_ecs_cluster.studio.name
  capacity_providers = ["FARGATE"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

resource "aws_ecs_task_definition" "studio" {
  family                   = local.name_prefix
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = "studio"
      image     = "${aws_ecr_repository.studio.repository_url}:${var.image_tag}"
      essential = true

      portMappings = [{ containerPort = 3100, protocol = "tcp" }]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = "3100" },
        { name = "HOSTNAME", value = "0.0.0.0" },
        # Behind an ALB behind CloudFront, so the process cannot know its own
        # public hostname.
        { name = "AUTH_TRUST_HOST", value = "true" },
        { name = "PLATFORM_OPERATORS", value = var.platform_operators },
        # The tenant registry. Passed by name rather than hardcoded in the app
        # so the same image runs against a different table in a different cell.
        { name = "TENANT_TABLE", value = aws_dynamodb_table.tenants.name },
        { name = "AWS_REGION", value = var.aws_region },
        # Stamped into every deployment manifest the engine signs. Without it a
        # cell cannot tell which schema an artifact was built against, and the
        # console renders "unpinned" — honest, and useless.
        { name = "SCHEMA_VERSION", value = var.schema_version },
        # Where to deliver a signed artifact. Empty means "publish only", which
        # the console reports rather than hides.
        { name = "CELL_RECONCILE_URL", value = var.cell_reconcile_url },
      ]

      secrets = [
        { name = "AUTH_SECRET", valueFrom = "${aws_secretsmanager_secret.studio.arn}:AUTH_SECRET::" },
        { name = "PLATFORM_OPERATOR_SECRET", valueFrom = "${aws_secretsmanager_secret.studio.arn}:PLATFORM_OPERATOR_SECRET::" },
        { name = "PLATFORM_RECONCILE_SECRET", valueFrom = "${aws_secretsmanager_secret.studio.arn}:PLATFORM_RECONCILE_SECRET::" },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.studio.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "studio"
        }
      }
    }
  ])

  tags = local.tags
}

resource "aws_ecs_service" "studio" {
  name            = local.name_prefix
  cluster         = aws_ecs_cluster.studio.id
  task_definition = aws_ecs_task_definition.studio.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  # Roll back automatically rather than sitting in a failing loop. An internal
  # console nobody is watching is exactly where a bad task would go unnoticed.
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = data.aws_subnets.public.ids
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = true # required to pull from ECR without a NAT gateway
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.studio.arn
    container_name   = "studio"
    container_port   = 3100
  }

  depends_on = [aws_lb_listener.http]

  tags = local.tags
}
