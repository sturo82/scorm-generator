# DNS nella zona Route53 esistente (es. knowkube.com):
#  - web  -> CloudFront (alias) per il frontend statico;
#  - api  -> App Runner custom domain.

data "aws_route53_zone" "main" {
  name         = var.route53_zone_name
  private_zone = false
}

# --- Web (architect.knowkube.com) -> CloudFront ----------------------------
resource "aws_route53_record" "web" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.web_domain
  type    = "A"
  alias {
    name                   = aws_cloudfront_distribution.web.domain_name
    zone_id                = aws_cloudfront_distribution.web.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "web_aaaa" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.web_domain
  type    = "AAAA"
  alias {
    name                   = aws_cloudfront_distribution.web.domain_name
    zone_id                = aws_cloudfront_distribution.web.hosted_zone_id
    evaluate_target_health = false
  }
}

# --- API (api.architect.knowkube.com) -> App Runner ------------------------
resource "aws_apprunner_custom_domain_association" "api" {
  domain_name          = var.api_domain
  service_arn          = aws_apprunner_service.api.arn
  enable_www_subdomain = false
}

resource "aws_route53_record" "api_validation" {
  # Creati solo al SECONDO apply (var.enable_api_dns_validation = true), quando i
  # record di validazione dell'associazione dominio App Runner sono già noti.
  # Al primo apply (false) il set è vuoto e il blocco è pianificabile.
  for_each = var.enable_api_dns_validation ? {
    for i, r in tolist(aws_apprunner_custom_domain_association.api.certificate_validation_records) :
    tostring(i) => r
  } : {}
  zone_id = data.aws_route53_zone.main.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 300
  records = [each.value.value]
}

resource "aws_route53_record" "api" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.api_domain
  type    = "CNAME"
  ttl     = 300
  records = [aws_apprunner_custom_domain_association.api.dns_target]
}
