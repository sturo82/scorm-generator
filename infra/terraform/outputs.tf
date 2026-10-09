output "alb_dns_name" {
  description = "DNS pubblico dell'ALB. Punta qui i record DNS app/api."
  value       = aws_lb.main.dns_name
}

output "ecr_api_repository_url" {
  description = "URL ECR dell'immagine API (push qui)."
  value       = aws_ecr_repository.api.repository_url
}

output "ecr_web_repository_url" {
  description = "URL ECR dell'immagine Web."
  value       = aws_ecr_repository.web.repository_url
}

output "s3_assets_bucket" {
  description = "Bucket S3 pacchetti/media."
  value       = aws_s3_bucket.assets.bucket
}

output "rds_endpoint" {
  description = "Endpoint RDS Postgres."
  value       = aws_db_instance.main.address
}

output "database_url_secret_arn" {
  description = "ARN del segreto DATABASE_URL in Secrets Manager."
  value       = aws_secretsmanager_secret.database_url.arn
}

output "ecs_cluster_name" {
  description = "Nome del cluster ECS (per lanciare il task migrazioni)."
  value       = aws_ecs_cluster.main.name
}

output "migrate_task_family" {
  description = "Family della task definition migrazioni."
  value       = aws_ecs_task_definition.migrate.family
}

output "service_subnets" {
  description = "Subnet dei task (per run-task delle migrazioni)."
  value       = aws_subnet.public[*].id
}

output "service_security_group" {
  description = "Security group dei task."
  value       = aws_security_group.service.id
}

# --- Cognito (per config API e build-arg Web) ---
output "cognito_user_pool_id" {
  description = "User Pool ID (COGNITO_USER_POOL_ID)."
  value       = aws_cognito_user_pool.main.id
}

output "cognito_issuer" {
  description = "OIDC issuer (OIDC_ISSUER / NEXT_PUBLIC_OIDC_ISSUER)."
  value       = local.cognito_issuer
}

output "cognito_client_id" {
  description = "App client ID (OIDC_AUDIENCE / NEXT_PUBLIC_OIDC_CLIENT_ID)."
  value       = aws_cognito_user_pool_client.web.id
}

output "cognito_hosted_domain" {
  description = "Dominio Hosted UI di Cognito (login)."
  value       = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${var.region}.amazoncognito.com"
}
