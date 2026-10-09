# Segreti in Secrets Manager. Terraform CREA i segreti e il loro valore iniziale
# dove è esso stesso la fonte (es. DATABASE_URL derivato da RDS, chiavi JWT
# generate). Le chiavi di terze parti (stock) sono placeholder da impostare a
# mano o via CI: non vanno nello stato Terraform in chiaro.

# Chiavi JWT generate: una per canale (auth utente, integrazione M2M, SSO).
resource "random_password" "jwt_auth" {
  length  = 48
  special = false
}
resource "random_password" "jwt_integration" {
  length  = 48
  special = false
}
resource "random_password" "jwt_sso_user" {
  length  = 48
  special = false
}

# L'utente applicativo del DB (non-superuser) ha una password dedicata: NON è
# l'utente master. Il runbook crea il ruolo nel DB con questa password.
resource "random_password" "db_app" {
  length  = 24
  special = false
}

locals {
  # DATABASE_URL per l'applicazione: usa l'utente app non-superuser, SSL on.
  database_url = "postgresql://${var.project}_app:${random_password.db_app.result}@${aws_db_instance.main.address}:5432/${var.db_name}?schema=public&sslmode=require"
}

resource "aws_secretsmanager_secret" "database_url" {
  name = "${var.project}/DATABASE_URL"
}
resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = local.database_url
}

# URL amministrativo (utente master) per migrazioni e creazione del ruolo app.
resource "aws_secretsmanager_secret" "database_url_admin" {
  name = "${var.project}/DATABASE_URL_ADMIN"
}
resource "aws_secretsmanager_secret_version" "database_url_admin" {
  secret_id     = aws_secretsmanager_secret.database_url_admin.id
  secret_string = "postgresql://${var.db_master_username}:${random_password.db_master.result}@${aws_db_instance.main.address}:5432/${var.db_name}?schema=public&sslmode=require"
}

resource "aws_secretsmanager_secret" "jwt_auth" {
  name = "${var.project}/AUTH_JWT_SECRET"
}
resource "aws_secretsmanager_secret_version" "jwt_auth" {
  secret_id     = aws_secretsmanager_secret.jwt_auth.id
  secret_string = random_password.jwt_auth.result
}

resource "aws_secretsmanager_secret" "jwt_integration" {
  name = "${var.project}/INTEGRATION_JWT_SECRET"
}
resource "aws_secretsmanager_secret_version" "jwt_integration" {
  secret_id     = aws_secretsmanager_secret.jwt_integration.id
  secret_string = random_password.jwt_integration.result
}

resource "aws_secretsmanager_secret" "jwt_sso_user" {
  name = "${var.project}/SSO_USER_JWT_SECRET"
}
resource "aws_secretsmanager_secret_version" "jwt_sso_user" {
  secret_id     = aws_secretsmanager_secret.jwt_sso_user.id
  secret_string = random_password.jwt_sso_user.result
}

# Chiave Unsplash (stock): placeholder, da popolare fuori Terraform. ignore_changes
# evita che un apply la riazzeri dopo che l'hai impostata manualmente.
resource "aws_secretsmanager_secret" "unsplash" {
  name = "${var.project}/UNSPLASH_ACCESS_KEY"
}
resource "aws_secretsmanager_secret_version" "unsplash" {
  secret_id     = aws_secretsmanager_secret.unsplash.id
  secret_string = "REPLACE_ME"
  lifecycle {
    ignore_changes = [secret_string]
  }
}

output "db_app_password" {
  value     = random_password.db_app.result
  sensitive = true
}
