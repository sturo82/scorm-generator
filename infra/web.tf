# Frontend STATICO: build Next `output: export` (cartella out/) servita da S3
# dietro CloudFront. Il bucket è privato; CloudFront vi accede via Origin Access
# Control (OAC). La CI sincronizza out/ sul bucket e invalida la cache.

resource "aws_s3_bucket" "web" {
  bucket = "${var.project}-web-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Certificato per il dominio web: ACM in us-east-1 (obbligatorio per CloudFront).
resource "aws_acm_certificate" "web" {
  provider          = aws.us_east_1
  domain_name       = var.web_domain
  validation_method = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "web_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.web.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  }
  zone_id = data.aws_route53_zone.main.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 300
  records = [each.value.record]
}

resource "aws_acm_certificate_validation" "web" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.web.arn
  validation_record_fqdns = [for r in aws_route53_record.web_cert_validation : r.fqdn]
}

# Origin Access Control: CloudFront firma le richieste verso S3 (bucket privato).
resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${var.project}-web-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Rewrite degli URI "a directory" verso l'index.html corrispondente. Necessaria
# perché S3 via OAC non risolve l'index document come il website endpoint.
resource "aws_cloudfront_function" "rewrite" {
  name    = "${var.project}-web-rewrite"
  runtime = "cloudfront-js-2.0"
  comment = "Mappa /path -> /path/index.html per l'export statico Next.js"
  publish = true
  code    = file("${path.module}/cf-rewrite.js")
}

resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  default_root_object = "index.html"
  aliases             = [var.web_domain]
  price_class         = "PriceClass_100" # Europa + Nord America (budget)

  origin {
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_id                = "web-s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  default_cache_behavior {
    target_origin_id       = "web-s3"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    # Managed-CachingOptimized.
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"

    # Rewrite /path -> /path/index.html (viewer-request).
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.rewrite.arn
    }
  }

  # Le route dinamiche senza HTML dedicato (/courses/<id>, /brands/<id>) usano la
  # pagina segnaposto generata da generateStaticParams: la function riscrive
  # l'URI a /<route>/index.html. Per i path realmente inesistenti serviamo la
  # pagina 404 statica di Next (403 da S3 sul bucket privato) con codice 404.
  custom_error_response {
    error_code            = 403
    response_code         = 404
    response_page_path    = "/404.html"
    error_caching_min_ttl = 10
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.web.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

# Policy del bucket: consente SOLO a questa distribuzione CloudFront di leggere.
data "aws_iam_policy_document" "web_bucket" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.web.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.web.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = data.aws_iam_policy_document.web_bucket.json
}

output "web_bucket" {
  value = aws_s3_bucket.web.bucket
}
output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.web.id
}
output "cloudfront_domain" {
  value = aws_cloudfront_distribution.web.domain_name
}
