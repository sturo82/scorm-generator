# Servizio App Runner: SOLO l'API (il web è statico su S3+CloudFront). Egress
# pubblico di default (nessun VPC connector): l'API raggiunge RDS sull'endpoint
# pubblico blindato e i servizi AWS/Internet senza NAT.

resource "aws_apprunner_auto_scaling_configuration_version" "main" {
  auto_scaling_configuration_name = "${var.project}-asc"
  max_concurrency                 = 100
  min_size                        = 1
  max_size                        = 3
}

resource "aws_apprunner_service" "api" {
  service_name = "${var.project}-api"

  source_configuration {
    authentication_configuration {
      access_role_arn = aws_iam_role.apprunner_access.arn
    }
    image_repository {
      image_identifier      = "${aws_ecr_repository.api.repository_url}:${var.api_image_tag}"
      image_repository_type = "ECR"
      image_configuration {
        port = "3000"

        runtime_environment_variables = {
          NODE_ENV      = "production"
          PORT          = "3000"
          AUTH_PROVIDER = "oidc"
          OIDC_ISSUER   = local.cognito_issuer
          OIDC_AUDIENCE = var.ecosystem_oidc_client_id
          # Il web usa l'ID token come Bearer: l'access token di Cognito non
          # include i custom attribute (`custom:tenant_id`), l'ID token sì.
          OIDC_TOKEN_USE            = "id"
          OIDC_TENANT_CLAIM         = "custom:tenant_id,tenant_id"
          CORS_ORIGINS              = var.cors_origins != "" ? var.cors_origins : "https://${var.web_domain}"
          WEB_APP_URL               = "https://${var.web_domain}"
          INTEGRATION_JWT_ISSUER    = "scorm-generator"
          INTEGRATION_JWT_AUDIENCE  = "scorm-integration"
          INTEGRATION_TOKEN_TTL_SEC = "3600"
          SSO_JWT_ISSUER            = "scorm-generator"
          SSO_JWT_AUDIENCE          = "scorm-webapp"
          SSO_USER_TOKEN_TTL_SEC    = "28800"
          SSO_TICKET_TTL_SEC        = "60"
          SSO_MAX_ROLE              = "ADMIN"
          PROVIDER_LLM              = "bedrock"
          PROVIDER_EMBEDDINGS       = "bedrock"
          PROVIDER_VECTOR_STORE     = "pgvector"
          PROVIDER_OBJECT_STORAGE   = "s3"
          PROVIDER_IMAGE            = "bedrock"
          PROVIDER_SPEECH           = "polly"
          PROVIDER_TRANSCRIPTION    = "transcribe"
          # Generazione video avatar (HeyGen). Attiva solo con HEYGEN_API_KEY
          # presente (secret sotto). L'engine è scelto dal server per tipo di
          # avatar; HEYGEN_ENGINE resta solo come eventuale override operativo.
          PROVIDER_VIDEO              = "heygen"
          HEYGEN_MONTHLY_QUOTA        = var.heygen_monthly_quota
          AWS_REGION                  = var.region
          BEDROCK_REGION              = var.region
          BEDROCK_LLM_MODEL_ID        = var.bedrock_llm_model_id
          BEDROCK_EMBEDDINGS_MODEL_ID = var.bedrock_embeddings_model_id
          # Dimensione vettori embeddings. Titan v2 accetta SOLO 256|512|1024.
          # Senza questa, il default dell'app è 64 (valore da test) -> Bedrock
          # risponde ValidationException e l'ingestion knowledge va in errore.
          EMBEDDINGS_DIMENSIONS = "1024"
          MEDIA_REGION          = var.media_region
          IMAGE_MODEL_ID        = var.image_model_id
          TRANSCRIBE_REGION     = var.region
          SPEECH_DEFAULT_VOICE  = var.speech_default_voice
          S3_BUCKET             = aws_s3_bucket.assets.bucket
          S3_REGION             = var.region
          COGNITO_USER_POOL_ID  = var.ecosystem_cognito_user_pool_id
          COGNITO_REGION        = var.region
          STOCK_IMAGE_PROVIDER  = var.stock_image_provider
          # --- Ecosistema Knowkube (consumer: K Scorm -> Manager), ONBOARDING ZERO-TOUCH ---
          # Al primo avvio l'app si auto-provisiona (self-register firmato SigV4)
          # e riceve il provisioning kit: client web OIDC (audience), credenziali
          # M2M (secret in Secrets Manager), enforce/wallet. Quindi NON servono a
          # mano: OIDC client id, M2M client id/secret, enforce. I valori sotto
          # sono solo fallback per la modalità manuale (vuoti = zero-touch puro).
          MANAGER_URL             = var.manager_url
          ECOSYSTEM_TOKEN_URL     = var.ecosystem_token_url
          ECOSYSTEM_SCOPES        = "ecosystem/entitlements.read ecosystem/wallet.read ecosystem/wallet.write"
          MANAGER_M2M_CLIENT_ID   = var.manager_m2m_client_id # vuoto in zero-touch
          PRODUCT_KEY             = "kscorm"
          INSTALLATION_ID         = "kscorm"
          INSTALLATION_REGION     = var.region
          INSTALLATION_DOMAINS    = var.web_domain
          ECOSYSTEM_SELF_REGISTER = "true"
          ENTITLEMENT_ENFORCE     = var.entitlement_enforce_fallback
          WALLET_ENABLED          = "false"
        }

        runtime_environment_secrets = {
          DATABASE_URL           = aws_secretsmanager_secret.database_url.arn
          AUTH_JWT_SECRET        = aws_secretsmanager_secret.jwt_auth.arn
          INTEGRATION_JWT_SECRET = aws_secretsmanager_secret.jwt_integration.arn
          SSO_USER_JWT_SECRET    = aws_secretsmanager_secret.jwt_sso_user.arn
          UNSPLASH_ACCESS_KEY    = aws_secretsmanager_secret.unsplash.arn
          HEYGEN_API_KEY         = aws_secretsmanager_secret.heygen.arn
          # NB: MANAGER_M2M_CLIENT_SECRET NON è iniettato come env: nell'onboarding
          # zero-touch l'app lo PERSISTE e lo LEGGE da Secrets Manager (per ARN) a
          # runtime, dal provisioning kit. Non è noto al deploy.
        }
      }
    }
    auto_deployments_enabled = false # deploy pilotato dalla CI (StartDeployment)
  }

  instance_configuration {
    cpu               = var.apprunner_cpu
    memory            = var.apprunner_memory
    instance_role_arn = aws_iam_role.api_instance.arn
  }

  # Nessun network_configuration: egress pubblico gestito da App Runner.

  health_check_configuration {
    protocol = "HTTP"
    path     = "/health"
    interval = 10
    timeout  = 5
  }

  auto_scaling_configuration_arn = aws_apprunner_auto_scaling_configuration_version.main.arn

  depends_on = [aws_db_instance.main]
}

output "apprunner_api_url" {
  value = "https://${aws_apprunner_service.api.service_url}"
}
