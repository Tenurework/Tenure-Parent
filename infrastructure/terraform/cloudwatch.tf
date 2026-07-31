# ── ECS: alert on task failures / low running task count ─────────────────────
resource "aws_cloudwatch_metric_alarm" "ecs_running_tasks" {
  alarm_name          = "${local.name_prefix}-ecs-no-running-tasks"
  alarm_description   = "ECS service has zero running tasks"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  metric_name         = "RunningTaskCount"
  namespace           = "ECS/ContainerInsights"
  period              = 60
  statistic           = "Average"
  threshold           = 1
  treat_missing_data  = "breaching"

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.app.name
  }
}

# ── ALB: alert on elevated 5xx error rate ────────────────────────────────────
resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "${local.name_prefix}-alb-5xx"
  alarm_description   = "ALB 5xx error rate > 5% for 5 minutes"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 5
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Sum"
  threshold           = 10
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = aws_lb.main.arn_suffix
  }
}

# ── RDS: alert on high CPU ────────────────────────────────────────────────────
resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "${local.name_prefix}-rds-cpu-high"
  alarm_description   = "RDS CPU > 80% for 10 minutes"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.postgres.identifier
  }
}

# ── SQS: alert on DLQ messages (failed jobs need attention) ──────────────────
resource "aws_cloudwatch_metric_alarm" "dlq_messages" {
  alarm_name          = "${local.name_prefix}-dlq-messages"
  alarm_description   = "Messages in DLQ — worker failures need investigation"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.default_dlq.name
  }
}

# ── Dashboard: pilot operational overview ────────────────────────────────────
resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "${local.name_prefix}-ops"

  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric"
        properties = {
          title  = "ECS Running Tasks"
          region = var.aws_region
          period = 60
          metrics = [["ECS/ContainerInsights", "RunningTaskCount",
            "ClusterName", aws_ecs_cluster.main.name,
            "ServiceName", aws_ecs_service.app.name]]
        }
      },
      {
        type = "metric"
        properties = {
          title  = "ALB Request Count + 5xx"
          region = var.aws_region
          period = 60
          metrics = [
            ["AWS/ApplicationELB", "RequestCount",     "LoadBalancer", aws_lb.main.arn_suffix],
            ["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", "LoadBalancer", aws_lb.main.arn_suffix],
          ]
        }
      },
      {
        type = "metric"
        properties = {
          title  = "RDS CPU"
          region = var.aws_region
          period = 60
          metrics = [["AWS/RDS", "CPUUtilization",
            "DBInstanceIdentifier", aws_db_instance.postgres.identifier]]
        }
      },
      {
        type = "log"
        properties = {
          title   = "App Errors (last 1h)"
          query   = "SOURCE '${aws_cloudwatch_log_group.app.name}' | filter @message like /ERROR/ | sort @timestamp desc | limit 50"
          region  = var.aws_region
          view    = "table"
        }
      },
    ]
  })
}
