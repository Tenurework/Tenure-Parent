# ── Subnet group (private subnets only) ──────────────────────────────────────
resource "aws_db_subnet_group" "main" {
  name       = "${local.name_prefix}-db"
  subnet_ids = aws_subnet.private[*].id
  tags       = { Name = "${local.name_prefix}-db-subnet-group" }
}

# ── Parameter group: PostgreSQL 16 with pgvector support ─────────────────────
resource "aws_db_parameter_group" "postgres" {
  name   = "${local.name_prefix}-pg16"
  family = "postgres16"

  parameter {
    name  = "shared_preload_libraries"
    value = "pg_stat_statements"
    # Static parameter — RDS only accepts it with pending-reboot
    apply_method = "pending-reboot"
  }

  parameter {
    name  = "log_statement"
    value = "ddl"
  }
}

# ── RDS PostgreSQL instance ───────────────────────────────────────────────────
resource "aws_db_instance" "postgres" {
  identifier = "${local.name_prefix}-db"

  engine               = "postgres"
  engine_version       = "16.3"
  instance_class       = var.rds_instance_class
  allocated_storage    = var.rds_allocated_storage
  storage_type         = "gp3"
  storage_encrypted    = true

  db_name  = var.rds_db_name
  username = var.rds_username
  # Password managed by Secrets Manager — RDS will use the secret ARN
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  parameter_group_name   = aws_db_parameter_group.postgres.name

  # Free-tier accounts cap automated backup retention at 1 day.
  # Raise to 7 after upgrading the account plan.
  backup_retention_period = 1
  backup_window           = "03:00-04:00"
  maintenance_window      = "sun:04:30-sun:05:30"

  # Hardening (Week 8): protect the system of record
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.name_prefix}-db-final"
  delete_automated_backups  = false

  # Not supported on db.t3.micro — enable when moving to a larger class
  performance_insights_enabled = false

  tags = { Name = "${local.name_prefix}-db" }
}
