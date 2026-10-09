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

# --- Bedrock / media --------------------------------------------------------

variable "media_region" {
  description = "Regione per la generazione immagini (Bedrock Stability): solo us-east-1."
  type        = string
  default     = "us-east-1"
}

variable "bedrock_llm_model_id" {
  description = "Inference profile LLM in EU (es. eu.anthropic.claude-sonnet-4-...)."
  type        = string
  default     = "eu.anthropic.claude-3-5-sonnet-20240620-v1:0"
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
  description = "CPU dei servizi App Runner (es. 1024 = 1 vCPU)."
  type        = string
  default     = "1024"
}

variable "apprunner_memory" {
  description = "Memoria dei servizi App Runner (es. 2048 = 2 GB)."
  type        = string
  default     = "2048"
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
