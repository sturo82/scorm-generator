# Dominio custom per i servizi App Runner, con validazione via Route53 nella zona
# esistente (es. knowkube.com). App Runner emette e rinnova il certificato TLS da
# solo; qui creiamo i record di validazione e il record che punta al servizio.

data "aws_route53_zone" "main" {
  name         = var.route53_zone_name
  private_zone = false
}

# --- Web (scorm.knowkube.com) ----------------------------------------------
resource "aws_apprunner_custom_domain_association" "web" {
  domain_name = var.web_domain
  service_arn = aws_apprunner_service.web.arn
  # Non gestiamo il www; un solo host.
  enable_www_subdomain = false
}

# Record di validazione del certificato (App Runner ne pubblica alcuni).
resource "aws_route53_record" "web_validation" {
  for_each = {
    for r in aws_apprunner_custom_domain_association.web.certificate_validation_records :
    r.name => r
  }
  zone_id = data.aws_route53_zone.main.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 300
  records = [each.value.value]
}

# Record che punta il dominio al target App Runner (CNAME).
resource "aws_route53_record" "web" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.web_domain
  type    = "CNAME"
  ttl     = 300
  records = [aws_apprunner_custom_domain_association.web.dns_target]
}

# --- API (api.scorm.knowkube.com) ------------------------------------------
resource "aws_apprunner_custom_domain_association" "api" {
  domain_name          = var.api_domain
  service_arn          = aws_apprunner_service.api.arn
  enable_www_subdomain = false
}

resource "aws_route53_record" "api_validation" {
  for_each = {
    for r in aws_apprunner_custom_domain_association.api.certificate_validation_records :
    r.name => r
  }
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
