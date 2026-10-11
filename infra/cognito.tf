# ───────────────────────────────────────────────────────────────────────────
# OIDC d'ecosistema — K Scorm come PRODOTTO NUOVO (consumer, non owner).
#
# K Scorm NON gestisce più alcuna risorsa Cognito: pool, client web OIDC,
# dominio custom della login (auth.knowkube.com), certificato ACM, record DNS
# della login e Managed Login branding sono risorse D'ECOSISTEMA, di proprietà
# di MANAGER (control plane, Opzione 1). Qui il prodotto si limita a LEGGERE i
# parametri che Manager gli fornisce come input (vedi variables.tf):
#   - var.ecosystem_cognito_user_pool_id  (pool id)
#   - var.ecosystem_oidc_client_id        (client web OIDC = OIDC_AUDIENCE)
#   - var.ecosystem_auth_domain           (dominio login)
#
# Autenticazione: Cognito/OIDC dice solo "chi sei" (ID token). L'identità
# applicativa (utente nel DB, ruolo interno, permessi) è di K Scorm: l'utente è
# creato al primo accesso via JIT provisioning (vedi auth.guard.ts). K Scorm non
# crea utenti nel pool e non ha permessi diretti su Cognito.
# ───────────────────────────────────────────────────────────────────────────

locals {
  # Issuer OIDC derivato dal pool d'ecosistema (per OIDC_ISSUER lato API).
  cognito_issuer = "https://cognito-idp.${var.region}.amazonaws.com/${var.ecosystem_cognito_user_pool_id}"
}

output "cognito_user_pool_id" {
  description = "Pool id d'ecosistema (input da Manager)."
  value       = var.ecosystem_cognito_user_pool_id
}
output "cognito_web_client_id" {
  description = "Client web OIDC del prodotto (input da Manager)."
  value       = var.ecosystem_oidc_client_id
}
output "cognito_issuer" {
  value = local.cognito_issuer
}
output "cognito_auth_domain" {
  description = "Dominio custom della login d'ecosistema."
  value       = var.ecosystem_auth_domain
}
