# Segreti applicativi iniettati nei task ECS via "secrets" (mai in chiaro nella
# task definition). DATABASE_URL è derivata da RDS. Gli altri (JWT/OIDC) sono
# opzionali: qui creiamo i contenitori; valorizza i valori reali fuori da
# Terraform o via tfvars non committati.

resource "aws_secretsmanager_secret" "database_url" {
  name                    = "${local.name}/database-url"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = local.database_url
}

# Secret JWT (usato solo se AUTH_PROVIDER=jwt). Generato automaticamente.
resource "random_password" "jwt" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "jwt" {
  name                    = "${local.name}/auth-jwt-secret"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "jwt" {
  secret_id     = aws_secretsmanager_secret.jwt.id
  secret_string = random_password.jwt.result
}
