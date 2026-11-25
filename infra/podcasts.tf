# Podcast: area pubblica dei file (feed RSS, audio e copertine) su un sottodominio dedicato.
#
# Il bucket degli asset resta privato. Una distribuzione CloudFront legge, tramite Origin Access
# Control, SOLO il prefisso `public-podcasts/`; l'applicazione scrive lì feed, MP3 e copertine quando
# l'utente pubblica una puntata. Il dominio non dipende dal nome del prodotto (architect/coach): un
# feed registrato su Spotify o Apple non deve cambiare indirizzo con il rebrand.
#
# Inerte finché `podcast_domain` è vuoto (nessuna risorsa creata, nessuna variabile all'app).
variable "podcast_domain" {
  description = "FQDN pubblico dei podcast (es. podcast.knowkube.com). Vuoto = pubblicazione podcast non configurata."
  type        = string
  default     = ""
}

variable "speech_region" {
  description = "Regione Polly per le voci dei podcast. Il motore generativo (e la clonazione vocale) è disponibile a Francoforte, non a Irlanda."
  type        = string
  default     = "eu-central-1"
}

locals {
  podcast_enabled = var.podcast_domain != ""
  # Deve coincidere con PODCAST_PUBLIC_PREFIX dell'app (con la barra finale).
  podcast_prefix = "public-podcasts"
  # Variabili d'ambiente dell'API legate ai podcast (unite a quelle di apprunner.tf).
  podcast_env = merge(
    { SPEECH_REGION = var.speech_region },
    local.podcast_enabled ? {
      PODCAST_PUBLIC_BASE_URL = "https://${var.podcast_domain}"
      PODCAST_PUBLIC_PREFIX   = "${local.podcast_prefix}/"
    } : {},
  )
}

# Certificato per il sottodominio: ACM in us-east-1 (obbligatorio per CloudFront).
resource "aws_acm_certificate" "podcast" {
  count             = local.podcast_enabled ? 1 : 0
  provider          = aws.us_east_1
  domain_name       = var.podcast_domain
  validation_method = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "podcast_cert_validation" {
  for_each = local.podcast_enabled ? {
    for dvo in aws_acm_certificate.podcast[0].domain_validation_options : dvo.domain_name => {
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

resource "aws_acm_certificate_validation" "podcast" {
  count                   = local.podcast_enabled ? 1 : 0
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.podcast[0].arn
  validation_record_fqdns = [for r in aws_route53_record.podcast_cert_validation : r.fqdn]
}

resource "aws_cloudfront_origin_access_control" "podcast" {
  count                             = local.podcast_enabled ? 1 : 0
  name                              = "${var.project}-podcast-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "podcast" {
  count       = local.podcast_enabled ? 1 : 0
  enabled     = true
  aliases     = [var.podcast_domain]
  price_class = "PriceClass_100" # Europa + Nord America
  comment     = "Podcast: feed RSS, audio e copertine"

  origin {
    domain_name = aws_s3_bucket.assets.bucket_regional_domain_name
    origin_id   = "podcast-s3"
    # L'indirizzo /<publicId>/feed.xml corrisponde alla chiave public-podcasts/<publicId>/feed.xml.
    origin_path              = "/${local.podcast_prefix}"
    origin_access_control_id = aws_cloudfront_origin_access_control.podcast[0].id
  }

  default_cache_behavior {
    target_origin_id       = "podcast-s3"
    viewer_protocol_policy = "redirect-to-https"
    # HEAD e richieste parziali (Range) sono richieste da Apple Podcasts: S3 e CloudFront le gestiscono.
    allowed_methods = ["GET", "HEAD", "OPTIONS"]
    cached_methods  = ["GET", "HEAD"]
    # Managed-CachingOptimized: rispetta il Cache-Control che l'app imposta (feed 5 min, audio 1 giorno).
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  }

  # S3 risponde 403 per gli oggetti inesistenti (il bucket è privato): per i client è un 404.
  custom_error_response {
    error_code            = 403
    response_code         = 404
    response_page_path    = ""
    error_caching_min_ttl = 30
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.podcast[0].certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

# Il bucket degli asset può essere letto da CloudFront solo in questo prefisso.
data "aws_iam_policy_document" "assets_bucket" {
  count = local.podcast_enabled ? 1 : 0
  statement {
    sid       = "PodcastPublicRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.assets.arn}/${local.podcast_prefix}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.podcast[0].arn]
    }
  }
}

resource "aws_s3_bucket_policy" "assets" {
  count  = local.podcast_enabled ? 1 : 0
  bucket = aws_s3_bucket.assets.id
  policy = data.aws_iam_policy_document.assets_bucket[0].json
}

resource "aws_route53_record" "podcast" {
  count   = local.podcast_enabled ? 1 : 0
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.podcast_domain
  type    = "A"
  alias {
    name                   = aws_cloudfront_distribution.podcast[0].domain_name
    zone_id                = aws_cloudfront_distribution.podcast[0].hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "podcast_aaaa" {
  count   = local.podcast_enabled ? 1 : 0
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.podcast_domain
  type    = "AAAA"
  alias {
    name                   = aws_cloudfront_distribution.podcast[0].domain_name
    zone_id                = aws_cloudfront_distribution.podcast[0].hosted_zone_id
    evaluate_target_health = false
  }
}

output "podcast_url" {
  description = "Indirizzo pubblico dei podcast (vuoto se non configurato)."
  value       = local.podcast_enabled ? "https://${var.podcast_domain}" : ""
}
