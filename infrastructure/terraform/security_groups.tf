# AWS publishes the address ranges its CloudFront edge locations use to reach
# origins. Referencing the managed list keeps the ALB reachable as AWS adds and
# retires edge capacity, without ever opening it to the internet.
data "aws_ec2_managed_prefix_list" "cloudfront_origin_facing" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

# ── ALB: reachable only from CloudFront ──────────────────────────────────────
#
# This rule used to be cidr_blocks = ["0.0.0.0/0"] under a comment claiming
# CloudFront-only access via a managed prefix list. The comment described a
# control that was not implemented: the listener is plain HTTP on port 80, so
# anyone who learned the ALB's DNS name could read and post session cookies in
# clear text, skip the edge entirely, and — once edge-access.tf existed — walk
# straight around the closed-pilot gate. An origin that answers the internet
# makes every edge control advisory.
resource "aws_security_group" "alb" {
  name        = "${local.name_prefix}-alb"
  description = "Application Load Balancer"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "HTTP from CloudFront edge locations only"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    prefix_list_ids = [data.aws_ec2_managed_prefix_list.cloudfront_origin_facing.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-alb" }
}

# ── ECS tasks: accept traffic only from the ALB ───────────────────────────────
resource "aws_security_group" "ecs" {
  name        = "${local.name_prefix}-ecs"
  description = "ECS Fargate tasks"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Next.js from ALB"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    description = "Allow all outbound (ECR pull, RDS, Redis, SQS, SES, Secrets Manager)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-ecs" }
}

# ── RDS: accept only from ECS tasks ──────────────────────────────────────────
resource "aws_security_group" "rds" {
  name        = "${local.name_prefix}-rds"
  description = "RDS PostgreSQL"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "PostgreSQL from ECS"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }

  tags = { Name = "${local.name_prefix}-rds" }
}

# ── ElastiCache Redis: accept only from ECS tasks ─────────────────────────────
resource "aws_security_group" "redis" {
  name        = "${local.name_prefix}-redis"
  description = "ElastiCache Redis"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Redis from ECS"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }

  tags = { Name = "${local.name_prefix}-redis" }
}
