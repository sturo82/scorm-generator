# Rete minimale. L'API gira su App Runner con egress PUBBLICO (nessun VPC
# connector): raggiunge Bedrock (eu-west-1 e us-east-1), Polly, Transcribe, S3,
# Secrets e Internet senza NAT né VPC endpoint. Il database RDS è reso
# raggiungibile pubblicamente ma BLINDATO da security group + SSL + password
# forte: è l'unico componente che richiede connettività di rete dall'esterno.
#
# Niente NAT Gateway, niente VPC connector, niente interface endpoint: è la
# topologia più semplice ed economica per questo carico.

resource "aws_vpc" "main" {
  cidr_block           = "10.42.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "${var.project}-vpc" }
}

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.project}-igw" }
}

# Subnet pubbliche (2 AZ) per il subnet group di RDS. Pubbliche perché il DB è
# publicly_accessible; l'accesso effettivo è comunque filtrato dal security group.
resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true
  tags                    = { Name = "${var.project}-public-${count.index}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = { Name = "${var.project}-public" }
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# Security group di RDS. Di default NON apre a tutto il mondo: l'ingress è
# ristretto alle CIDR indicate in var.db_allowed_cidrs (es. l'uscita di App
# Runner o un IP di amministrazione). Combinato con SSL forzato e password forte.
resource "aws_security_group" "rds" {
  name        = "${var.project}-rds"
  description = "SG di RDS Postgres (accesso ristretto + SSL)"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "Postgres dalle CIDR consentite"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = var.db_allowed_cidrs
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project}-rds" }
}
