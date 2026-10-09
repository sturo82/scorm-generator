# Rete: VPC con SOLO subnet pubbliche (scelta a basso costo, nessun NAT Gateway).
# I task Fargate hanno IP pubblico per raggiungere Bedrock/Polly/Transcribe/ECR;
# la sicurezza è garantita dai security group (nessuna porta aperta se non
# dall'ALB). S3 passa dal gateway endpoint (gratuito), senza uscire su internet.

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name = "${var.project}-${var.environment}"
  azs  = slice(data.aws_availability_zones.available.names, 0, var.az_count)
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "${local.name}-vpc" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name}-igw" }
}

resource "aws_subnet" "public" {
  count                   = var.az_count
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, count.index)
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true
  tags                    = { Name = "${local.name}-public-${local.azs[count.index]}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = { Name = "${local.name}-public-rt" }
}

resource "aws_route_table_association" "public" {
  count          = var.az_count
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# Gateway endpoint S3: traffico S3 interno alla rete AWS, gratuito, niente egress
# internet per pacchetti/media.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.public.id]
  tags              = { Name = "${local.name}-s3-endpoint" }
}

# --- Security groups ---

# ALB: aperto a internet su 80/443.
resource "aws_security_group" "alb" {
  name_prefix = "${local.name}-alb-"
  description = "ALB: ingress HTTP/HTTPS da internet"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  lifecycle { create_before_destroy = true }
  tags = { Name = "${local.name}-alb-sg" }
}

# Task Fargate (API + Web): ingress SOLO dall'ALB sulle rispettive porte.
# Egress aperto (serve per Bedrock/Polly/Transcribe/ECR via internet).
resource "aws_security_group" "service" {
  name_prefix = "${local.name}-svc-"
  description = "Task Fargate: ingress solo dall'ALB"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "API da ALB"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  ingress {
    description     = "Web da ALB"
    from_port       = 3100
    to_port         = 3100
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  lifecycle { create_before_destroy = true }
  tags = { Name = "${local.name}-svc-sg" }
}

# RDS: ingress Postgres SOLO dai task Fargate.
resource "aws_security_group" "db" {
  name_prefix = "${local.name}-db-"
  description = "RDS: ingress 5432 solo dai task"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Postgres dai task"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.service.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  lifecycle { create_before_destroy = true }
  tags = { Name = "${local.name}-db-sg" }
}
