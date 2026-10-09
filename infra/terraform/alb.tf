# Application Load Balancer: unico ingresso HTTPS. Routing per host:
#   api.<dominio> → target group API (:3000)
#   app.<dominio> (default) → target group Web (:3100)
# Se acm_certificate_arn è vuoto, espone solo HTTP :80 (utile per il primo test;
# in produzione fornisci un certificato ACM in eu-west-1).

resource "aws_lb" "main" {
  name               = "${local.name}-alb"
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id
  tags               = { Name = "${local.name}-alb" }
}

resource "aws_lb_target_group" "api" {
  name        = "${local.name}-api-tg"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"
  health_check {
    path                = "/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 15
    timeout             = 5
    matcher             = "200"
  }
}

resource "aws_lb_target_group" "web" {
  name        = "${local.name}-web-tg"
  port        = 3100
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"
  health_check {
    path                = "/"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 15
    timeout             = 5
    matcher             = "200-399"
  }
}

locals {
  has_tls    = var.acm_certificate_arn != ""
  has_domain = var.domain_name != ""
  api_host   = local.has_domain ? "${var.api_subdomain}.${var.domain_name}" : null
}

# --- Listener HTTP ---
# Senza TLS: il :80 serve direttamente l'app. Con TLS: redirect a :443.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = local.has_tls ? "redirect" : "forward"

    dynamic "redirect" {
      for_each = local.has_tls ? [1] : []
      content {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }

    target_group_arn = local.has_tls ? null : aws_lb_target_group.web.arn
  }
}

# Routing API su HTTP quando non c'è TLS (per host se c'è dominio, altrimenti /api*).
resource "aws_lb_listener_rule" "http_api" {
  count        = local.has_tls ? 0 : 1
  listener_arn = aws_lb_listener.http.arn
  priority     = 10
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
  condition {
    dynamic "host_header" {
      for_each = local.has_domain ? [1] : []
      content { values = [local.api_host] }
    }
    dynamic "path_pattern" {
      for_each = local.has_domain ? [] : [1]
      content { values = ["/api", "/api/*"] }
    }
  }
}

# --- Listener HTTPS (solo con certificato ACM) ---
resource "aws_lb_listener" "https" {
  count             = local.has_tls ? 1 : 0
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

resource "aws_lb_listener_rule" "https_api" {
  count        = local.has_tls ? 1 : 0
  listener_arn = aws_lb_listener.https[0].arn
  priority     = 10
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
  condition {
    host_header { values = [local.api_host] }
  }
}
