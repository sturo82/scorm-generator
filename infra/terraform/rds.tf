# RDS Postgres 16 (Graviton t4g, economica) in subnet pubbliche ma NON pubblica
# (publicly_accessible=false): raggiungibile solo dai task via security group.
# pgvector si abilita con "CREATE EXTENSION vector" (vedi migrazione 0001/README).
# La password è generata e salvata in Secrets Manager; l'app riceve DATABASE_URL.

resource "random_password" "db" {
  length  = 24
  special = false # evita caratteri che romperebbero l'URL di connessione
}

resource "aws_db_subnet_group" "main" {
  name       = "${local.name}-db-subnets"
  subnet_ids = aws_subnet.public[*].id
  tags       = { Name = "${local.name}-db-subnets" }
}

resource "aws_db_instance" "main" {
  identifier     = "${local.name}-db"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_allocated_storage * 4 # autoscaling storage
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = var.db_name
  username = var.db_username
  password = random_password.db.result

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  multi_az               = var.db_multi_az

  backup_retention_period   = 7
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.name}-db-final"
  apply_immediately         = false

  tags = { Name = "${local.name}-db" }
}

# Stringa di connessione completa (con SSL) salvata come segreto.
locals {
  database_url = "postgresql://${var.db_username}:${random_password.db.result}@${aws_db_instance.main.address}:5432/${var.db_name}?sslmode=require"
}
