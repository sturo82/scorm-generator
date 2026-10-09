# Amazon Cognito: identità degli utenti (OIDC) in UE. Email/password, inviti
# SOLO da admin (self-signup disabilitato), custom attribute tenant_id nei token.
# Il ruolo (OWNER/ADMIN/EDITOR/VIEWER) NON è in Cognito: vive nel DB applicativo.

resource "aws_cognito_user_pool" "main" {
  name = "${local.name}-users"

  # Login via email.
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  # Solo gli admin creano utenti: niente registrazione pubblica (Fase 1).
  admin_create_user_config {
    allow_admin_create_user_only = true
    invite_message_template {
      email_subject = "Invito a SCORM Course Generator"
      email_message = "Ciao, sei stato invitato. Utente: {username} — password temporanea: {####}. Accedi e imposta una nuova password."
      sms_message   = "Utente: {username} password: {####}"
    }
  }

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }

  # Custom attribute: tenant di appartenenza, incluso nei token come
  # "custom:tenant_id" (letto dall'OidcAuthProvider dell'API).
  schema {
    name                = "tenant_id"
    attribute_data_type = "String"
    mutable             = true
    required            = false
    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  tags = { Name = "${local.name}-users" }
}

# App client pubblico (SPA): Authorization Code + PKCE, nessun client secret.
resource "aws_cognito_user_pool_client" "web" {
  name         = "${local.name}-web-client"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret = false

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]

  # Callback/logout del frontend. Senza dominio, placeholder localhost (per il
  # primo provisioning); aggiorna domain_name e riapplica per la produzione.
  callback_urls = [
    local.has_domain ? "https://${var.app_subdomain}.${var.domain_name}/auth/callback" : "http://localhost:3100/auth/callback",
  ]
  logout_urls = [
    local.has_domain ? "https://${var.app_subdomain}.${var.domain_name}" : "http://localhost:3100",
  ]

  # L'API valida l'ACCESS token (token_use=access): durate ragionevoli.
  access_token_validity  = 60 # minuti
  id_token_validity      = 60 # minuti
  refresh_token_validity = 30 # giorni
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  # Evita user-enumeration sui tentativi di login.
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true
}

# Hosted UI domain (pagine di login gestite da Cognito).
resource "aws_cognito_user_pool_domain" "main" {
  domain       = var.cognito_domain_prefix
  user_pool_id = aws_cognito_user_pool.main.id
}

# Issuer OIDC dello user pool (per OIDC_ISSUER / NEXT_PUBLIC_OIDC_ISSUER).
locals {
  cognito_issuer = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
}
