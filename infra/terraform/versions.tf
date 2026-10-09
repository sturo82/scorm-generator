terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Backend remoto consigliato per lo state (S3 + lock DynamoDB). Lasciato come
  # commento: alla prima inizializzazione lo state è locale. Per team/CI,
  # scommenta e crea prima il bucket+tabella (vedi README-DEPLOY.md).
  # backend "s3" {
  #   bucket         = "<tuo-bucket-tfstate>"
  #   key            = "scorm-generator/prod/terraform.tfstate"
  #   region         = "eu-west-1"
  #   dynamodb_table = "<tua-tabella-lock>"
  #   encrypt        = true
  # }
}

# Provider primario: tutto il carico (compute, dati, storage, Claude, Polly,
# Transcribe) vive in Irlanda (UE) per conformità GDPR.
provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project     = "scorm-generator"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
