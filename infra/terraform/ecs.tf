# ECS Fargate (ARM64/Graviton): cluster, log group, task definition e service
# per API e Web. L'API fa anche da worker (consumer coda in-process), quindi un
# solo task tipo per processo. Container Insights off per contenere i costi.

resource "aws_ecs_cluster" "main" {
  name = "${local.name}-cluster"
  setting {
    name  = "containerInsights"
    value = "disabled"
  }
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${local.name}/api"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "web" {
  name              = "/ecs/${local.name}/web"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "migrate" {
  name              = "/ecs/${local.name}/migrate"
  retention_in_days = 30
}

locals {
  api_image     = "${aws_ecr_repository.api.repository_url}:${var.api_image_tag}"
  web_image     = "${aws_ecr_repository.web.repository_url}:${var.web_image_tag}"
  migrate_image = "${aws_ecr_repository.api.repository_url}:migrate-${var.api_image_tag}"

  # Variabili d'ambiente NON segrete dell'API. Le credenziali AWS NON ci sono:
  # il task role fornisce le autorizzazioni via default credential chain.
  api_environment = [
    { name = "PORT", value = "3000" },
    { name = "NODE_ENV", value = "production" },
    { name = "CORS_ORIGINS", value = var.cors_origins },
    { name = "AUTH_PROVIDER", value = var.auth_provider },

    { name = "PROVIDER_LLM", value = "bedrock" },
    { name = "PROVIDER_EMBEDDINGS", value = "mock" },
    { name = "PROVIDER_VECTOR_STORE", value = "pgvector" },
    { name = "PROVIDER_OBJECT_STORAGE", value = "s3" },
    { name = "PROVIDER_JOB_QUEUE", value = "in-memory" },

    # AI: testo/embeddings/trascrizione in UE; SOLO immagini in us-west-2.
    { name = "BEDROCK_REGION", value = var.bedrock_region },
    { name = "BEDROCK_LLM_MODEL_ID", value = var.bedrock_llm_model_id },
    { name = "PROVIDER_IMAGE", value = "bedrock" },
    { name = "PROVIDER_SPEECH", value = "polly" },
    { name = "PROVIDER_TRANSCRIPTION", value = "transcribe" },
    { name = "MEDIA_REGION", value = var.media_region },
    { name = "TRANSCRIBE_REGION", value = var.transcribe_region },

    # S3 reale (nessun endpoint custom in prod).
    { name = "S3_REGION", value = var.region },
    { name = "S3_BUCKET", value = aws_s3_bucket.assets.bucket },

    # Auth OIDC (Cognito) + gestione utenti admin.
    { name = "OIDC_ISSUER", value = local.cognito_issuer },
    { name = "OIDC_AUDIENCE", value = aws_cognito_user_pool_client.web.id },
    { name = "OIDC_TOKEN_USE", value = "access" },
    { name = "OIDC_TENANT_CLAIM", value = "custom:tenant_id" },
    { name = "COGNITO_USER_POOL_ID", value = aws_cognito_user_pool.main.id },
    { name = "COGNITO_REGION", value = var.region },
  ]
}

# --- Task definition API ---
resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.api_cpu
  memory                   = var.api_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([{
    name         = "api"
    image        = local.api_image
    essential    = true
    portMappings = [{ containerPort = 3000, protocol = "tcp" }]
    environment  = local.api_environment
    secrets = [
      { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn },
      { name = "AUTH_JWT_SECRET", valueFrom = aws_secretsmanager_secret.jwt.arn },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.api.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "api"
      }
    }
    healthCheck = {
      command     = ["CMD-SHELL", "node -e \"fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
  }])
}

resource "aws_ecs_service" "api" {
  name            = "${local.name}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.api_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.service.id]
    assign_public_ip = true # necessario senza NAT per raggiungere ECR/Bedrock
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3000
  }

  # Evita race: i listener devono esistere prima del service.
  depends_on = [aws_lb_listener.http]

  lifecycle {
    ignore_changes = [task_definition] # i deploy aggiornano la task def fuori da TF
  }
}

# --- Task definition Web ---
resource "aws_ecs_task_definition" "web" {
  family                   = "${local.name}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.web_cpu
  memory                   = var.web_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([{
    name         = "web"
    image        = local.web_image
    essential    = true
    portMappings = [{ containerPort = 3100, protocol = "tcp" }]
    environment  = [{ name = "NODE_ENV", value = "production" }, { name = "PORT", value = "3100" }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.web.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "web"
      }
    }
  }])
}

resource "aws_ecs_service" "web" {
  name            = "${local.name}-web"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = var.web_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.service.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3100
  }

  depends_on = [aws_lb_listener.http]

  lifecycle {
    ignore_changes = [task_definition]
  }
}

# --- Task definition migrazioni (one-off, lanciato manualmente/CI) ---
# Usa l'immagine --target migrate; esegue "prisma migrate deploy" e termina.
resource "aws_ecs_task_definition" "migrate" {
  family                   = "${local.name}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([{
    name      = "migrate"
    image     = local.migrate_image
    essential = true
    secrets   = [{ name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.migrate.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "migrate"
      }
    }
  }])
}
