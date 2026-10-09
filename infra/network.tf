# Rete per far raggiungere ai servizi App Runner il database (in-VPC) e, tramite
# un singolo NAT Gateway, i servizi fuori dalla VPC che l'API usa: Bedrock in
# us-east-1 (immagini), i provider stock pubblici (Unsplash/Pexels), oltre a
# Bedrock/Polly/Transcribe/Secrets/ECR in regione.
#
# Perché un NAT e non tanti interface endpoint: quando App Runner ha un VPC
# connector, TUTTO l'egress passa dalla VPC (confermato da AWS). L'API chiama
# servizi in DUE regioni + Internet pubblico: coprirli con interface endpoint
# richiederebbe ~7 endpoint in-regione (~$50/mese) e comunque NON risolverebbe
# us-east-1 né il traffico pubblico. Un solo NAT Gateway (~$32/mese) copre tutto
# ed è più semplice. Lo S3 resta su gateway endpoint (gratuito).

resource "aws_vpc" "main" {
  cidr_block           = "10.42.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "${var.project}-vpc" }
}

data "aws_availability_zones" "available" {
  state = "available"
}

# Subnet private (RDS + endpoint VPC connector). Due AZ per il subnet group RDS.
resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
  availability_zone = data.aws_availability_zones.available.names[count.index]
  tags              = { Name = "${var.project}-private-${count.index}" }
}

# Subnet pubblica per il NAT Gateway (una sola, per contenere i costi).
resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(aws_vpc.main.cidr_block, 8, 100)
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = true
  tags                    = { Name = "${var.project}-public" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.project}-igw" }
}

resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = { Name = "${var.project}-nat" }
}

resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public.id
  tags          = { Name = "${var.project}-nat" }
  depends_on    = [aws_internet_gateway.main]
}

# Routing: pubblica -> IGW; private -> NAT.
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = { Name = "${var.project}-public" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main.id
  }
  tags = { Name = "${var.project}-private" }
}

resource "aws_route_table_association" "private" {
  count          = length(aws_subnet.private)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# S3 via gateway endpoint (gratuito): pacchetti/media senza passare dal NAT.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private.id]
  tags              = { Name = "${var.project}-s3" }
}

# Security group del VPC Connector di App Runner (sorgente verso RDS e Internet).
resource "aws_security_group" "apprunner_connector" {
  name        = "${var.project}-apprunner-connector"
  description = "SG del VPC connector App Runner"
  vpc_id      = aws_vpc.main.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project}-apprunner-connector" }
}

# Security group di RDS: accetta Postgres SOLO dal SG del connector.
resource "aws_security_group" "rds" {
  name        = "${var.project}-rds"
  description = "SG di RDS Postgres"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Postgres dal VPC connector App Runner"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.apprunner_connector.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project}-rds" }
}

# VPC Connector condiviso dai servizi App Runner che devono raggiungere RDS.
resource "aws_apprunner_vpc_connector" "main" {
  vpc_connector_name = "${var.project}-connector"
  subnets            = aws_subnet.private[*].id
  security_groups    = [aws_security_group.apprunner_connector.id]
}
