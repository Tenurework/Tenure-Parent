# ── Security groups ─────────────────────────────────────────────────────────

resource "aws_security_group" "alb" {
  name        = "${local.name_prefix}-alb"
  description = "Studio ALB. Ingress from CloudFront only."
  vpc_id      = data.aws_vpc.shared.id
  tags        = local.tags
}

# CloudFront's origin-facing ranges, not 0.0.0.0/0. The console is reachable
# through the distribution or not at all, so the ALB's own hostname is not a way
# around the distribution's TLS and headers.
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_vpc_security_group_ingress_rule" "alb_from_cloudfront" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTP from CloudFront origin-facing ranges"
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
}

resource "aws_vpc_security_group_egress_rule" "alb_all" {
  security_group_id = aws_security_group.alb.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_security_group" "task" {
  name        = "${local.name_prefix}-task"
  description = "Studio task. Ingress from its own ALB only."
  vpc_id      = data.aws_vpc.shared.id
  tags        = local.tags
}

resource "aws_vpc_security_group_ingress_rule" "task_from_alb" {
  security_group_id            = aws_security_group.task.id
  description                  = "App port from the Studio ALB"
  from_port                    = 3100
  to_port                      = 3100
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.alb.id
}

resource "aws_vpc_security_group_egress_rule" "task_all" {
  security_group_id = aws_security_group.task.id
  description       = "Outbound for the ECR pull and the CloudWatch logs"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

# ── Load balancer ───────────────────────────────────────────────────────────

resource "aws_lb" "studio" {
  name               = "${local.name_prefix}-alb"
  load_balancer_type = "application"
  internal           = false
  security_groups    = [aws_security_group.alb.id]
  subnets            = data.aws_subnets.public.ids

  # A console with a handful of operators does not need the extra minute a
  # longer drain buys, and a short one makes a rollback quick.
  idle_timeout = 60

  tags = local.tags
}

resource "aws_lb_target_group" "studio" {
  name        = "${local.name_prefix}-tg"
  port        = 3100
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = data.aws_vpc.shared.id

  health_check {
    path = "/signin"
    # /signin, not /: the root redirects when unauthenticated, and a 307 is not
    # a health signal. /signin renders for anyone and proves the app is serving.
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  deregistration_delay = 15

  tags = local.tags
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.studio.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.studio.arn
  }
}
