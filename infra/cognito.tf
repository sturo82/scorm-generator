# Cognito user pool per il login UTENTI standard della web app (flusso OIDC
# Authorization Code + PKCE, validato dall'OidcAuthProvider via JWKS). Il tenant
# è un custom attribute (custom:tenant_id), coerente con il resto del sistema.
#
# NB: l'SSO da OnDemand (Scenario 2) NON usa Cognito: è il ticket basato su API
# key. Cognito serve per gli utenti che accedono direttamente alla web app.

resource "aws_cognito_user_pool" "main" {
  name = "${var.project}-users"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  schema {
    name                     = "tenant_id"
    attribute_data_type      = "String"
    mutable                  = true
    developer_only_attribute = false
    string_attribute_constraints {
      min_length = 1
      max_length = 64
    }
  }

  schema {
    name                     = "role"
    attribute_data_type      = "String"
    mutable                  = true
    developer_only_attribute = false
    string_attribute_constraints {
      min_length = 1
      max_length = 16
    }
  }

  admin_create_user_config {
    allow_admin_create_user_only = true # utenti creati via invito (AdminCreateUser)
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
}

# App client SPA: PKCE, nessun secret (il frontend è pubblico).
resource "aws_cognito_user_pool_client" "web" {
  name         = "${var.project}-web"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret                      = false
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]

  callback_urls = ["https://${var.web_domain}/auth/callback"]
  logout_urls   = ["https://${var.web_domain}/login"]

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 30
  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }
}

# Dominio hosted UI di Cognito (per il login).
resource "aws_cognito_user_pool_domain" "main" {
  domain       = "${var.project}-${data.aws_caller_identity.current.account_id}"
  user_pool_id = aws_cognito_user_pool.main.id
}

# Branding della Hosted UI (classic): CSS + logo K Scorm (ecosistema Knowkube).
# CSS <= 3 KB e logo PNG <= 100 KB (vincoli AWS). Il logo è centrato sopra i
# campi; il CSS applica l'identità verde di piattaforma e gli accenti neutri.
resource "aws_cognito_user_pool_ui_customization" "main" {
  user_pool_id = aws_cognito_user_pool_domain.main.user_pool_id

  css        = file("${path.module}/cognito-ui.css")
  image_file = filebase64("${path.module}/cognito-logo.png")
}

locals {
  # Issuer OIDC del user pool (per OIDC_ISSUER lato API e NEXT_PUBLIC_OIDC_ISSUER).
  cognito_issuer = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.main.id
}
output "cognito_web_client_id" {
  value = aws_cognito_user_pool_client.web.id
}
output "cognito_issuer" {
  value = local.cognito_issuer
}
output "cognito_hosted_ui_domain" {
  value = "${aws_cognito_user_pool_domain.main.domain}.auth.${var.region}.amazoncognito.com"
}
