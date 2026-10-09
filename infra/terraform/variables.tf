variable "region" {
  description = "Regione AWS primaria (UE per GDPR). Compute, RDS, S3, Claude, Polly, Transcribe."
  type        = string
  default     = "eu-west-1"
}

variable "environment" {
  description = "Nome ambiente (tag e naming risorse)."
  type        = string
  default     = "prod"
}

variable "project" {
  description = "Prefisso di naming delle risorse."
  type        = string
  default     = "scorm"
}

variable "vpc_cidr" {
  description = "CIDR della VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "az_count" {
  description = "Numero di Availability Zone (subnet pubbliche)."
  type        = number
  default     = 2
}

# --- Container images (ECR) ---
variable "api_image_tag" {
  description = "Tag dell'immagine API in ECR (es. git SHA)."
  type        = string
  default     = "latest"
}

variable "web_image_tag" {
  description = "Tag dell'immagine Web in ECR."
  type        = string
  default     = "latest"
}

# --- Dimensionamento Fargate (ARM/Graviton per risparmio) ---
variable "api_cpu" {
  description = "CPU Fargate per l'API (1024 = 1 vCPU)."
  type        = number
  default     = 512
}

variable "api_memory" {
  description = "Memoria MB per l'API. >=2048 per i picchi di export (MiniLM + zip in RAM)."
  type        = number
  default     = 2048
}

variable "web_cpu" {
  description = "CPU Fargate per il Web."
  type        = number
  default     = 256
}

variable "web_memory" {
  description = "Memoria MB per il Web."
  type        = number
  default     = 1024
}

variable "api_desired_count" {
  description = "Numero di task API."
  type        = number
  default     = 1
}

variable "web_desired_count" {
  description = "Numero di task Web."
  type        = number
  default     = 1
}

# --- Database (RDS Postgres + pgvector) ---
variable "db_instance_class" {
  description = "Classe istanza RDS (t4g = Graviton, economica)."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "Storage RDS in GB."
  type        = number
  default     = 20
}

variable "db_name" {
  description = "Nome del database applicativo."
  type        = string
  default     = "scorm"
}

variable "db_username" {
  description = "Utente master del DB."
  type        = string
  default     = "scorm"
}

variable "db_multi_az" {
  description = "Multi-AZ per alta disponibilità (raddoppia il costo RDS)."
  type        = bool
  default     = false
}

# --- AI / Bedrock ---
variable "bedrock_region" {
  description = "Regione per Claude/embeddings (UE). Di norma = region."
  type        = string
  default     = "eu-west-1"
}

variable "media_region" {
  description = "Regione per la generazione IMMAGINI (Bedrock Stable Image). Oggi NON disponibile in UE → us-west-2. Trasferimento extra-UE da coprire con SCC."
  type        = string
  default     = "us-west-2"
}

variable "transcribe_region" {
  description = "Regione Amazon Transcribe (UE)."
  type        = string
  default     = "eu-west-1"
}

variable "bedrock_llm_model_id" {
  description = "Inference profile/model id del LLM su Bedrock (UE)."
  type        = string
  default     = "eu.anthropic.claude-sonnet-4-5-20250929-v1:0"
}

# --- Dominio / TLS ---
variable "domain_name" {
  description = "Dominio base (es. example.com). Vuoto = solo DNS ALB, HTTP."
  type        = string
  default     = ""
}

variable "api_subdomain" {
  description = "Sottodominio API."
  type        = string
  default     = "api"
}

variable "app_subdomain" {
  description = "Sottodominio frontend."
  type        = string
  default     = "app"
}

variable "acm_certificate_arn" {
  description = "ARN certificato ACM (eu-west-1) per HTTPS sull'ALB. Vuoto = listener solo HTTP :80."
  type        = string
  default     = ""
}

# --- Auth (OIDC/Cognito) — opzionale, iniettato nel task API ---
variable "auth_provider" {
  description = "Provider auth API: oidc | jwt | dev. In prod: oidc."
  type        = string
  default     = "oidc"
}

variable "cors_origins" {
  description = "Origini CORS consentite (CSV). Es. https://app.example.com"
  type        = string
  default     = ""
}

variable "cognito_domain_prefix" {
  description = "Prefisso del dominio Hosted UI di Cognito (globally unique nella regione). Es. scorm-prod-login."
  type        = string
  default     = "scorm-prod-login"
}
