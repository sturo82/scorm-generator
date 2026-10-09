# Migrazioni DB dentro la VPC. RDS è privato (raggiungibile solo dalla VPC),
# quindi i runner GitHub NON possono applicarle direttamente. Un piccolo progetto
# CodeBuild gira NELLA VPC, usa l'immagine `migrate` (stage del Dockerfile API)
# già in ECR ed esegue `prisma migrate deploy`. La CI lo avvia e ne attende l'esito.
#
# Perché CodeBuild e non un task ECS one-off: niente cluster/servizi ECS da
# gestire (coerente con la scelta App Runner), si paga solo al minuto di build.

data "aws_iam_policy_document" "codebuild_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["codebuild.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "migrate" {
  name               = "${var.project}-migrate"
  assume_role_policy = data.aws_iam_policy_document.codebuild_assume.json
}

data "aws_iam_policy_document" "migrate" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["*"]
  }
  statement {
    sid       = "EcrPull"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    sid = "EcrPullRepo"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = [aws_ecr_repository.api.arn]
  }
  statement {
    sid       = "ReadAdminSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.database_url_admin.arn]
  }
  # ENI nella VPC per raggiungere RDS.
  statement {
    sid = "Vpc"
    actions = [
      "ec2:CreateNetworkInterface",
      "ec2:DescribeNetworkInterfaces",
      "ec2:DeleteNetworkInterface",
      "ec2:DescribeSubnets",
      "ec2:DescribeSecurityGroups",
      "ec2:DescribeVpcs",
      "ec2:DescribeDhcpOptions",
      "ec2:CreateNetworkInterfacePermission",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "migrate" {
  name   = "${var.project}-migrate"
  role   = aws_iam_role.migrate.id
  policy = data.aws_iam_policy_document.migrate.json
}

resource "aws_codebuild_project" "migrate" {
  name         = "${var.project}-migrate"
  service_role = aws_iam_role.migrate.arn

  artifacts {
    type = "NO_ARTIFACTS"
  }

  environment {
    compute_type    = "BUILD_GENERAL1_SMALL"
    image           = "aws/codebuild/amazonlinux2-x86_64-standard:5.0"
    type            = "LINUX_CONTAINER"
    privileged_mode = true

    environment_variable {
      name  = "MIGRATE_IMAGE"
      value = "${aws_ecr_repository.api.repository_url}:migrate"
    }
    environment_variable {
      name  = "DB_SECRET_ARN"
      value = aws_secretsmanager_secret.database_url_admin.arn
    }
    environment_variable {
      name  = "AWS_REGION_NAME"
      value = var.region
    }
  }

  # Esecuzione nella VPC per raggiungere RDS privato.
  vpc_config {
    vpc_id             = aws_vpc.main.id
    subnets            = aws_subnet.private[*].id
    security_group_ids = [aws_security_group.apprunner_connector.id]
  }

  source {
    type = "NO_SOURCE"
    buildspec = yamlencode({
      version = "0.2"
      phases = {
        build = {
          commands = [
            "aws ecr get-login-password --region $AWS_REGION_NAME | docker login --username AWS --password-stdin $(echo $MIGRATE_IMAGE | cut -d/ -f1)",
            "export DATABASE_URL=$(aws secretsmanager get-secret-value --secret-id $DB_SECRET_ARN --query SecretString --output text --region $AWS_REGION_NAME)",
            "docker pull $MIGRATE_IMAGE",
            "docker run --rm -e DATABASE_URL=\"$DATABASE_URL\" $MIGRATE_IMAGE",
          ]
        }
      }
    })
  }
}

output "migrate_codebuild_project" {
  value = aws_codebuild_project.migrate.name
}
