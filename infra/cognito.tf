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
  domain                = "${var.project}-${data.aws_caller_identity.current.account_id}"
  user_pool_id          = aws_cognito_user_pool.main.id
  managed_login_version = 2
}

# ── Dominio custom della login (ecosistema): auth.knowkube.com ──────────────
# Serve la login su un dominio Knowkube pulito invece che sull'URL AWS. Richiede
# un certificato ACM in us-east-1 (vincolo Cognito, come CloudFront) e un record
# A/alias verso la distribuzione CloudFront gestita da Cognito. Il parent domain
# (knowkube.com) deve già risolvere: ha un record A (requisito AWS), soddisfatto.
resource "aws_acm_certificate" "auth" {
  count             = var.auth_domain != "" ? 1 : 0
  provider          = aws.us_east_1
  domain_name       = var.auth_domain
  validation_method = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "auth_cert_validation" {
  for_each = var.auth_domain != "" ? {
    for dvo in aws_acm_certificate.auth[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  } : {}
  zone_id = data.aws_route53_zone.main.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 300
  records = [each.value.record]
}

resource "aws_acm_certificate_validation" "auth" {
  count                   = var.auth_domain != "" ? 1 : 0
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.auth[0].arn
  validation_record_fqdns = [for r in aws_route53_record.auth_cert_validation : r.fqdn]
}

resource "aws_cognito_user_pool_domain" "custom" {
  count                 = var.auth_domain != "" ? 1 : 0
  domain                = var.auth_domain
  user_pool_id          = aws_cognito_user_pool.main.id
  certificate_arn       = aws_acm_certificate_validation.auth[0].certificate_arn
  managed_login_version = 2
}

# Record A/alias verso la distribuzione CloudFront di Cognito per il custom domain.
resource "aws_route53_record" "auth" {
  count   = var.auth_domain != "" ? 1 : 0
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.auth_domain
  type    = "A"
  alias {
    name = aws_cognito_user_pool_domain.custom[0].cloudfront_distribution
    # Zone ID fisso delle distribuzioni CloudFront (costante globale AWS).
    zone_id                = "Z2FDTNDATAQYW2"
    evaluate_target_health = false
  }
}

# Branding Managed Login (v2) per l'app-client admin K Scorm. Lo stile è legato
# al CLIENT: ogni prodotto dell'ecosistema (K Scorm, K Manager, …) avrà il suo
# client con i propri accenti, mantenendo lo stesso layout premium Knowkube.
# Partiamo dai valori premium di default di Cognito e sovrascriviamo i colori
# chiave (verde di piattaforma) + logo via settings/asset.
resource "aws_cognito_managed_login_branding" "web" {
  user_pool_id = aws_cognito_user_pool.main.id
  client_id    = aws_cognito_user_pool_client.web.id

  # Settings = tema DARK coerente con la landing di architect (sfondo verde-nero
  # #0c1311 + velo verde), con il form brandizzato K Scorm. L'ecosistema è scuro;
  # ogni prodotto cambia solo il colore del velo/accenti (verde per K Scorm).
  # Esattamente uno tra settings e use_cognito_provided_values è ammesso.
  # NB: plan mostra un diff perpetuo benigno sui borderRadius (8 <-> 8.0): l'API
  # memorizza i float con ".0" mentre jsonencode di Terraform li normalizza a int.
  settings = file("${path.module}/managed-login-settings.json")

  # Logo del form in DARK mode: wordmark K Scorm bianco (visibile su card scura).
  asset {
    category   = "FORM_LOGO"
    color_mode = "DARK"
    extension  = "PNG"
    bytes      = filebase64("${path.module}/cognito-logo-dark.png")
  }

  # Sfondo pagina (DARK): replica fedele del body scuro della landing architect
  # (#0c1311 + velo verde radiale). Coerente con l'ecosistema, non piatto.
  asset {
    category   = "PAGE_BACKGROUND"
    color_mode = "DARK"
    extension  = "PNG"
    bytes      = filebase64("${path.module}/cognito-bg.png")
  }
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
output "cognito_auth_domain" {
  description = "Dominio custom della login (vuoto se non configurato)."
  value       = var.auth_domain != "" ? var.auth_domain : null
}
