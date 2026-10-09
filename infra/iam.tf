# Ruoli IAM per App Runner:
#  - access role: permette ad App Runner di tirare le immagini da ECR;
#  - instance role (solo API): permessi applicativi runtime (Bedrock in eu-west-1
#    E us-east-1 per le immagini, S3, Polly, Transcribe, Cognito admin, lettura
#    dei segreti). Least privilege: azioni mirate, risorse specifiche dove possibile.

data "aws_caller_identity" "current" {}

# --- Access role (ECR pull) -------------------------------------------------
data "aws_iam_policy_document" "apprunner_build_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["build.apprunner.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "apprunner_access" {
  name               = "${var.project}-apprunner-access"
  assume_role_policy = data.aws_iam_policy_document.apprunner_build_assume.json
}

resource "aws_iam_role_policy_attachment" "apprunner_ecr" {
  role       = aws_iam_role.apprunner_access.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess"
}

# --- Instance role (runtime API) --------------------------------------------
data "aws_iam_policy_document" "apprunner_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["tasks.apprunner.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "api_instance" {
  name               = "${var.project}-api-instance"
  assume_role_policy = data.aws_iam_policy_document.apprunner_tasks_assume.json
}

data "aws_iam_policy_document" "api_permissions" {
  # Bedrock: InvokeModel in regione (LLM/embeddings) e in us-east-1 (immagini).
  statement {
    sid     = "Bedrock"
    actions = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
    resources = [
      "arn:aws:bedrock:${var.region}::foundation-model/*",
      "arn:aws:bedrock:${var.media_region}::foundation-model/*",
      "arn:aws:bedrock:${var.region}:${data.aws_caller_identity.current.account_id}:inference-profile/*",
      "arn:aws:bedrock:${var.media_region}:${data.aws_caller_identity.current.account_id}:inference-profile/*",
    ]
  }

  # S3: oggetti del solo bucket assets.
  statement {
    sid       = "S3Assets"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.assets.arn}/*"]
  }
  statement {
    sid       = "S3List"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.assets.arn]
  }

  # Polly (sintesi vocale) e Transcribe (ASR).
  statement {
    sid       = "Polly"
    actions   = ["polly:SynthesizeSpeech"]
    resources = ["*"]
  }
  statement {
    sid = "Transcribe"
    actions = [
      "transcribe:StartTranscriptionJob",
      "transcribe:GetTranscriptionJob",
    ]
    resources = ["*"]
  }

  # Cognito: gestione utenti (inviti) nel solo user pool dell'app.
  statement {
    sid       = "CognitoAdmin"
    actions   = ["cognito-idp:AdminCreateUser", "cognito-idp:AdminDeleteUser"]
    resources = [aws_cognito_user_pool.main.arn]
  }

  # Lettura dei soli segreti del progetto.
  statement {
    sid       = "Secrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = ["arn:aws:secretsmanager:${var.region}:${data.aws_caller_identity.current.account_id}:secret:${var.project}/*"]
  }
}

resource "aws_iam_role_policy" "api_permissions" {
  name   = "${var.project}-api-permissions"
  role   = aws_iam_role.api_instance.id
  policy = data.aws_iam_policy_document.api_permissions.json
}
