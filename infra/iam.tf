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
  # Bedrock: InvokeModel in regione (LLM/embeddings) e in us-west-2 (immagini).
  #
  # IMPORTANTE: il LLM (var.bedrock_llm_model_id) è un *cross-region inference
  # profile* EU (es. eu.anthropic.claude-sonnet-4-6). Invocarlo richiede il
  # permesso InvokeModel SIA sull'ARN del profilo (in var.region) SIA sui
  # foundation-model in TUTTE le region verso cui il profilo può instradare —
  # non solo eu-west-1. Il profilo "EU Claude Sonnet 4.6" instrada su:
  # eu-west-1, eu-west-3, eu-central-1, eu-north-1, eu-south-1, eu-south-2.
  # Limitare i foundation-model alla sola var.region causa AccessDenied quando
  # Bedrock instrada verso un'altra region UE -> l'app vede ProviderUnavailable.
  statement {
    sid     = "Bedrock"
    actions = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
    resources = concat(
      # Foundation model in tutte le region del cross-region inference profile EU
      # + la region immagini (us-west-2).
      [for r in var.bedrock_inference_regions : "arn:aws:bedrock:${r}::foundation-model/*"],
      [
        "arn:aws:bedrock:${var.media_region}::foundation-model/*",
        # Il profilo di inferenza si invoca dalla region principale e da quella media.
        "arn:aws:bedrock:${var.region}:${data.aws_caller_identity.current.account_id}:inference-profile/*",
        "arn:aws:bedrock:${var.media_region}:${data.aws_caller_identity.current.account_id}:inference-profile/*",
      ],
    )
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

  # NB: nessun permesso diretto su Cognito. Come prodotto d'ecosistema, K Scorm
  # non crea/elimina utenti nel pool (è di Manager): l'identità applicativa è nel
  # suo DB (JIT provisioning al primo login). Il provisioning degli owner nel
  # pool lo fa Manager. La vecchia statement "CognitoAdmin" (AdminCreateUser/
  # AdminDeleteUser per gli inviti) è stata rimossa con l'onboarding ecosistema.

  # Lettura dei segreti del progetto + scrittura del solo secret M2M d'ecosistema
  # (onboarding zero-touch: l'app persiste il secret ricevuto nel provisioning
  # kit tramite Put/CreateSecret). Scope ristretto al prefisso del progetto.
  statement {
    sid = "Secrets"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:PutSecretValue",
      "secretsmanager:CreateSecret",
      "secretsmanager:DescribeSecret",
    ]
    resources = ["arn:aws:secretsmanager:${var.region}:${data.aws_caller_identity.current.account_id}:secret:${var.project}/*"]
  }
}

resource "aws_iam_role_policy" "api_permissions" {
  name   = "${var.project}-api-permissions"
  role   = aws_iam_role.api_instance.id
  policy = data.aws_iam_policy_document.api_permissions.json
}
