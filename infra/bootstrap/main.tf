# Bootstrap del backend remoto di Terraform: bucket S3 (state versionato) +
# tabella DynamoDB (lock). Si applica UNA TANTUM, prima di tutto il resto, con
# backend locale. Dopodiché gli altri stack usano questo bucket come backend.
#
#   cd infra/bootstrap
#   terraform init
#   terraform apply -var="project=scorm" -var="region=eu-west-1"
#
# Gli output (nomi di bucket e tabella) vanno poi nel backend di infra/ (vedi
# infra/backend.tf.example).

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

variable "project" {
  description = "Prefisso delle risorse (es. scorm)."
  type        = string
  default     = "scorm"
}

variable "region" {
  description = "Regione AWS del backend di stato."
  type        = string
  default     = "eu-west-1"
}

# Bucket dello stato: versionato e cifrato, accesso pubblico bloccato.
resource "aws_s3_bucket" "tf_state" {
  bucket = "${var.project}-tfstate-${data.aws_caller_identity.current.account_id}"

  # Protezione contro cancellazioni accidentali dello stato.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tf_state" {
  bucket                  = aws_s3_bucket.tf_state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Tabella di lock per evitare apply concorrenti.
resource "aws_dynamodb_table" "tf_lock" {
  name         = "${var.project}-tflock"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}

data "aws_caller_identity" "current" {}

output "state_bucket" {
  value = aws_s3_bucket.tf_state.bucket
}

output "lock_table" {
  value = aws_dynamodb_table.tf_lock.name
}
