variable "project" {
  description = "Prefisso delle risorse."
  type        = string
  default     = "scorm"
}

variable "region" {
  description = "Regione AWS principale (Irlanda)."
  type        = string
  default     = "eu-west-1"
}

# --- Dominio (Route53, zona già esistente: knowkube.com) --------------------

variable "route53_zone_name" {
  description = "Nome della hosted zone Route53 esistente (es. knowkube.com)."
  type        = string
}

variable "web_domain" {
  description = "FQDN della web app (es. architect.knowkube.com)."
  type        = string
}

variable "api_domain" {
  description = "FQDN dell'API (es. api.architect.knowkube.com)."
  type        = string
}

# --- Branding email (ecosistema Knowkube) ----------------------------------
variable "product_display_name" {
  description = "Nome del prodotto mostrato nelle email (es. 'K Scorm')."
  type        = string
  default     = "K Scorm"
}

variable "product_accent_hex" {
  description = "Colore accento del prodotto per le email (es. verde K Scorm)."
  type        = string
  default     = "#22b573"
}

variable "email_logo_url" {
  description = "URL pubblico del logo (wordmark bianco) mostrato nelle email."
  type        = string
  default     = "https://architect.knowkube.com/brand/kscorm-wordmark-white-trim.png"
}

variable "ses_identity_arn" {
  description = <<-EOT
    ARN dell'identità SES verificata usata come mittente delle email Cognito
    (es. arn:aws:ses:eu-west-1:<acct>:identity/knowkube.com). Vuoto = Cognito usa
    l'invio di default (COGNITO_DEFAULT), senza mittente custom.
  EOT
  type        = string
  default     = ""
}

variable "email_from_address" {
  description = "Indirizzo mittente delle email (deve appartenere all'identità SES)."
  type        = string
  default     = "no-reply@knowkube.com"
}

variable "auth_domain" {
  description = <<-EOT
    FQDN del dominio custom per la login Cognito (es. auth.knowkube.com).
    Dominio d'ecosistema per l'accesso degli admin: la Hosted/Managed Login viene
    servita qui invece che sull'URL *.amazoncognito.com. Deve stare sotto la
    hosted zone di route53_zone_name. Lasciare vuoto per non creare il custom domain.
  EOT
  type        = string
  default     = ""
}

# --- Bedrock / media --------------------------------------------------------

variable "media_region" {
  description = "Regione per la generazione immagini (Bedrock Stability). Su questo account i modelli text-to-image sono in us-west-2 (Oregon)."
  type        = string
  default     = "us-west-2"
}

variable "bedrock_llm_model_id" {
  description = "Inference profile LLM in EU (verificato ACTIVE su eu-west-1)."
  type        = string
  default     = "eu.anthropic.claude-sonnet-4-6"
}

# Region verso cui il cross-region inference profile EU può instradare le
# invocazioni. Devono essere TUTTE autorizzate su foundation-model nella policy
# IAM, altrimenti Bedrock risponde AccessDenied quando instrada fuori eu-west-1.
# Ricavabile con: aws bedrock get-inference-profile --inference-profile-identifier <id>
variable "bedrock_inference_regions" {
  description = "Region del cross-region inference profile EU (per i permessi foundation-model)."
  type        = list(string)
  default     = ["eu-west-1", "eu-west-3", "eu-central-1", "eu-north-1", "eu-south-1", "eu-south-2"]
}

variable "bedrock_embeddings_model_id" {
  description = "Modello embeddings Bedrock (Titan)."
  type        = string
  default     = "amazon.titan-embed-text-v2:0"
}

variable "image_model_id" {
  description = "Modello immagini (Stability su Bedrock, us-east-1)."
  type        = string
  default     = "stability.stable-image-core-v1:1"
}

# --- Database ---------------------------------------------------------------

variable "db_instance_class" {
  description = "Classe istanza RDS (budget: db.t4g.micro)."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "Storage RDS in GB."
  type        = number
  default     = 20
}

variable "db_name" {
  description = "Nome del database."
  type        = string
  default     = "scorm"
}

variable "db_master_username" {
  description = "Utente master RDS (amministrativo; l'app usa un utente dedicato non-superuser)."
  type        = string
  default     = "scorm_admin"
}

variable "db_allowed_cidrs" {
  description = <<-EOT
    CIDR autorizzate a connettersi a RDS (porta 5432). App Runner con egress
    pubblico NON ha IP statici pinnabili, perciò per permettere all'API di
    connettersi il default è aperto (0.0.0.0/0): la protezione è data da SSL
    forzato + password forte in Secrets Manager + utente app non-superuser.
    Se in futuro si usa un egress a IP fisso (es. VPC connector + NAT con EIP,
    oppure un bastion), restringere qui alle sole CIDR note.
  EOT
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

# --- App Runner -------------------------------------------------------------

variable "apprunner_cpu" {
  description = "CPU dei servizi App Runner (es. 1024 = 1 vCPU, 2048 = 2 vCPU)."
  type        = string
  # 2 vCPU: l'API (Nest + Prisma) andava in OOM con 1 vCPU/2 GB (exit 137,
  # restart loop). App Runner richiede >=4 GB con 2 vCPU.
  default = "2048"
}

variable "apprunner_memory" {
  description = "Memoria dei servizi App Runner (es. 4096 = 4 GB)."
  type        = string
  # 4 GB: raddoppiata rispetto ai 2 GB che causavano OOM.
  default = "4096"
}

variable "api_image_tag" {
  description = "Tag dell'immagine API in ECR da distribuire."
  type        = string
  default     = "latest"
}

variable "web_image_tag" {
  description = "Tag dell'immagine Web in ECR da distribuire."
  type        = string
  default     = "latest"
}

# --- Provider applicativi (allineati a configuration.ts) --------------------

variable "cors_origins" {
  description = "Origini CORS consentite (CSV). Tipicamente l'URL della web app."
  type        = string
  default     = ""
}

variable "speech_default_voice" {
  description = "Voce Polly di default."
  type        = string
  default     = "Bianca"
}

variable "stock_image_provider" {
  description = "Provider immagini stock: none|unsplash|pexels."
  type        = string
  default     = "none"
}

variable "cartoon_video_provider" {
  description = "Provider dei cartoon delle scene 'pillole'. 'none' = spento; 'luma' = Luma Ray 2 (Bedrock, us-west-2); 'nova' = Nova Reel (se disponibile); 'mock' = finto."
  type        = string
  # SPENTO in prod: Luma Ray 2 su Bedrock costa ~$1.50/s a 720p (~$52 a pillola
  # da 7 scene) — proibitivo. In attesa di un provider economico (fal.ai:
  # Seedance/Wan/LTX ~$0.02-0.08/s). Lasciare 'none' finché non è pronto.
  default = "none"
}

variable "cartoon_video_model_id" {
  description = "Model id del modello video Bedrock (Luma Ray 2 sul nostro account)."
  type        = string
  default     = "luma.ray-v2:0"
}

variable "cartoon_video_region" {
  description = "Region Bedrock del modello video. Luma Ray 2 è in us-west-2 (come la generazione immagini)."
  type        = string
  default     = "us-west-2"
}

variable "cartoon_video_output_bucket" {
  description = "Bucket S3 (nella region del modello) dove il modello video scrive l'output grezzo. Creato fuori Terraform: scorm-video-gen-<account> in us-west-2."
  type        = string
  default     = "scorm-video-gen-781748773767"
}

variable "cartoon_video_output_s3_uri" {
  description = "URI S3 base dell'output video (es. s3://<bucket>/luma-output). Richiesto quando cartoon_video_provider != 'none'."
  type        = string
  default     = "s3://scorm-video-gen-781748773767/luma-output"
}

variable "cartoon_video_monthly_quota" {
  description = "Numero massimo di cartoon-scena generabili per tenant al mese."
  type        = string
  default     = "20"
}

# --- Rendering code-to-video su AWS Lambda (@remotion/lambda) ---------------
variable "cartoon_render_lambda_enabled" {
  description = <<-EOT
    Abilita i permessi IAM del ruolo API per il rendering code-to-video su AWS
    Lambda (invoke della function Remotion + lettura del bucket Remotion). Tieni
    false finché non hai eseguito lo script di deploy (scripts/remotion-lambda.mjs)
    e impostato CARTOON_RENDER_MODE=lambda sull'API. Nessun effetto sul provider.
  EOT
  type        = bool
  default     = false
}

variable "cartoon_render_lambda_region" {
  description = "Region della function/bucket Remotion Lambda (consigliata: eu-west-1, stessa dell'app)."
  type        = string
  default     = "eu-west-1"
}

variable "heygen_monthly_quota" {
  description = "Numero massimo di video avatar HeyGen generabili per tenant al mese."
  type        = string
  default     = "30"
}

# --- Ecosistema Knowkube (consumer K Scorm -> Manager) ---------------------

variable "manager_url" {
  description = "URL base dell'API ecosistema di Manager (senza slash finale)."
  type        = string
  default     = "https://manager.knowkube.com/api/ecosystem"
}

variable "ecosystem_token_url" {
  description = "Token endpoint OAuth2 (Cognito) per il client-credentials M2M."
  type        = string
  default     = "https://auth.knowkube.com/oauth2/token"
}

variable "manager_m2m_client_id" {
  description = "OPZIONALE. client_id M2M di fallback (modalità manuale). Nell'onboarding zero-touch le credenziali M2M arrivano dal provisioning kit (secret in Secrets Manager scritto dall'app): lasciare vuoto."
  type        = string
  default     = ""
}

variable "entitlement_enforce_fallback" {
  description = "Fallback di ENTITLEMENT_ENFORCE se Manager non risponde al self-register (opzione b: Manager comanda). off|soft|hard."
  type        = string
  default     = "soft"
}

# --- OIDC d'ecosistema (ricevuto da Manager; K Scorm NON gestisce Cognito) ----
# Un prodotto nuovo riceve questi parametri da Manager e li LEGGE: pool, client
# web OIDC e dominio di login sono risorse d'ecosistema di proprietà di Manager.

variable "ecosystem_cognito_user_pool_id" {
  description = "ID del user pool d'ecosistema (es. eu-west-1_jvwWWna9i). Da Manager."
  type        = string
}

variable "ecosystem_oidc_client_id" {
  description = "OPZIONALE. Audience OIDC di fallback (modalità manuale). Nell'onboarding zero-touch il client web OIDC è creato da Manager e scoperto a runtime dal provisioning kit: lasciare vuoto."
  type        = string
  default     = ""
}

variable "ecosystem_auth_domain" {
  description = "Dominio custom della login d'ecosistema (es. auth.knowkube.com). Da Manager."
  type        = string
  default     = "auth.knowkube.com"
}
