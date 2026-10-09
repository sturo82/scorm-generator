# Ruoli IAM per ECS. Due ruoli distinti:
#  - execution role: usato da ECS per pullare l'immagine da ECR, scrivere i log
#    e leggere i segreti al lancio del task.
#  - task role: assunto dal CODICE in esecuzione; permessi minimi verso i
#    servizi AWS (Bedrock, Polly, Transcribe, S3). Niente access key statiche.

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# --- Execution role ---
resource "aws_iam_role" "execution" {
  name               = "${local.name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Lettura dei segreti (DATABASE_URL, JWT) al lancio del task.
data "aws_iam_policy_document" "execution_secrets" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.database_url.arn, aws_secretsmanager_secret.jwt.arn]
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "${local.name}-exec-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

# --- Task role (permessi runtime dell'app) ---
resource "aws_iam_role" "task" {
  name               = "${local.name}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

data "aws_iam_policy_document" "task" {
  # S3: solo sul bucket dell'app.
  statement {
    sid     = "S3Assets"
    actions = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
    resources = [
      aws_s3_bucket.assets.arn,
      "${aws_s3_bucket.assets.arn}/*",
    ]
  }

  # Bedrock: invocazione modelli (LLM in UE + immagini in us-west-2). Ristretto
  # alle azioni di inferenza; nessuna gestione dei modelli.
  statement {
    sid       = "BedrockInvoke"
    actions   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
    resources = ["*"] # i foundation model non supportano ARN per-risorsa granulari qui
  }

  # Polly: sintesi vocale.
  statement {
    sid       = "Polly"
    actions   = ["polly:SynthesizeSpeech"]
    resources = ["*"]
  }

  # Transcribe: avvio/lettura job di trascrizione.
  statement {
    sid = "Transcribe"
    actions = [
      "transcribe:StartTranscriptionJob",
      "transcribe:GetTranscriptionJob",
      "transcribe:DeleteTranscriptionJob",
    ]
    resources = ["*"]
  }

  # Segreti (in aggiunta all'iniezione via execution role, se il codice li legge).
  statement {
    sid       = "ReadSecrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.database_url.arn, aws_secretsmanager_secret.jwt.arn]
  }

  # Cognito: gestione utenti del SOLO user pool dell'app (inviti dall'admin).
  statement {
    sid = "CognitoAdminUsers"
    actions = [
      "cognito-idp:AdminCreateUser",
      "cognito-idp:AdminDeleteUser",
      "cognito-idp:ListUsers",
    ]
    resources = [aws_cognito_user_pool.main.arn]
  }
}

resource "aws_iam_role_policy" "task" {
  name   = "${local.name}-task-policy"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}
