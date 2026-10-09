# infra/ — Infrastruttura come codice (Terraform)

Deploy di produzione su AWS App Runner (eu-west-1). Guida passo-passo:
[`../docs/DEPLOY_AWS.md`](../docs/DEPLOY_AWS.md).

## Struttura

| File | Contenuto |
| --- | --- |
| `bootstrap/` | Backend state: bucket S3 + DynamoDB lock (apply una tantum, separato) |
| `versions.tf` | Provider AWS + required_version |
| `backend.tf.example` | Modello del backend S3 remoto (copia in `backend.tf`) |
| `variables.tf` | Variabili (dominio, regione, modelli Bedrock, sizing) |
| `terraform.tfvars.example` | Valori d'esempio per knowkube.com |
| `network.tf` | VPC, subnet, NAT Gateway, S3 gateway endpoint, VPC connector |
| `rds.tf` | RDS Postgres 16 + parameter group |
| `s3.tf` | Bucket assets (pacchetti/media) |
| `secrets.tf` | Secrets Manager: DATABASE_URL, chiavi JWT, stock |
| `cognito.tf` | User pool + app client (login utenti) |
| `ecr.tf` | Repository immagini api/web |
| `iam.tf` | Access role (ECR) + instance role API (Bedrock/S3/Polly/…) |
| `apprunner.tf` | Servizi App Runner API + Web, autoscaling |
| `dns.tf` | Dominio custom + validazione + record Route53 |
| `migrate-codebuild.tf` | CodeBuild in-VPC per `prisma migrate deploy` |
| `github-oidc.tf` | Trust OIDC + ruolo deploy per GitHub Actions |
| `db-bootstrap.sql` | Estensione pgvector + ruolo app non-superuser (una tantum) |

## Ordine

1. `bootstrap/` → `terraform apply`
2. copia `backend.tf.example` → `backend.tf`, `terraform.tfvars.example` → `terraform.tfvars`
3. `terraform init -reconfigure && terraform apply`
4. `infra/db-bootstrap.sql` (pgvector + ruolo app)
5. configura le variabili CI (vedi DEPLOY_AWS.md) e fai push su `main`

Nulla viene applicato automaticamente: ogni `apply` è manuale.
