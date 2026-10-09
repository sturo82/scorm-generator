# RDS Postgres 16 con estensione pgvector. Reso raggiungibile pubblicamente
# (publicly_accessible) perché l'API gira su App Runner con egress pubblico e
# non ha un IP statico per entrare in VPC. La sicurezza è a più livelli:
#  - security group ristretto (var.db_allowed_cidrs),
#  - SSL forzato (rds.force_ssl),
#  - password forte generata (Secrets Manager),
#  - utente applicativo non-superuser (creato dal runbook).

resource "aws_db_subnet_group" "main" {
  name       = "${var.project}-db"
  subnet_ids = aws_subnet.public[*].id
  tags       = { Name = "${var.project}-db" }
}

resource "aws_db_parameter_group" "pg" {
  name   = "${var.project}-pg16"
  family = "postgres16"

  # Impone connessioni cifrate: essenziale dato che il DB è su endpoint pubblico.
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
}

resource "random_password" "db_master" {
  length  = 24
  special = false
}

resource "aws_db_instance" "main" {
  identifier     = "${var.project}-db"
  engine         = "postgres"
  engine_version = "16"

  instance_class        = var.db_instance_class
  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_allocated_storage * 3
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = var.db_name
  username = var.db_master_username
  password = random_password.db_master.result

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  parameter_group_name   = aws_db_parameter_group.pg.name
  publicly_accessible    = true
  multi_az               = false

  backup_retention_period   = 7
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.project}-db-final"

  apply_immediately = true
}

output "db_endpoint" {
  value = aws_db_instance.main.address
}

output "db_master_username" {
  value = var.db_master_username
}
