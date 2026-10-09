# Bucket S3 per i pacchetti SCORM esportati e i media generati. Privato: l'accesso
# avviene SOLO tramite URL firmati generati dall'API. CORS consente il GET dagli
# origin della web app (per copertine/anteprime via presigned).

resource "aws_s3_bucket" "assets" {
  bucket = "${var.project}-assets-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket                  = aws_s3_bucket.assets.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id
  cors_rule {
    allowed_methods = ["GET"]
    allowed_origins = [
      "https://${var.web_domain}",
      "https://${var.api_domain}",
    ]
    allowed_headers = ["*"]
    max_age_seconds = 3600
  }
}

output "assets_bucket" {
  value = aws_s3_bucket.assets.bucket
}
