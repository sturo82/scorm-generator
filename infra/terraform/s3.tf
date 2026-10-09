# Bucket S3 per pacchetti SCORM, media (immagini, audio, video) e upload della
# knowledge base. Privato: l'accesso avviene solo via URL firmati generati
# dall'API. CORS per permettere al browser upload/download diretti.

resource "aws_s3_bucket" "assets" {
  bucket        = "${local.name}-assets-${data.aws_caller_identity.current.account_id}"
  force_destroy = false
  tags          = { Name = "${local.name}-assets" }
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket                  = aws_s3_bucket.assets.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "assets" {
  bucket = aws_s3_bucket.assets.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

# CORS: il browser carica video/documenti e scarica pacchetti via URL firmati.
# Restringi gli origin al dominio reale del frontend in produzione.
resource "aws_s3_bucket_cors_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id
  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "HEAD"]
    allowed_origins = var.domain_name != "" ? ["https://${var.app_subdomain}.${var.domain_name}"] : ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

data "aws_caller_identity" "current" {}
