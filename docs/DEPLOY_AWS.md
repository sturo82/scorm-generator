# Deploy su AWS (App Runner + Terraform)

Guida al deploy di produzione su AWS, regione **Irlanda (eu-west-1)**, con la
generazione immagini (Bedrock Stability) in **us-east-1**. Compute su **AWS App
Runner** (API + Web), database **RDS Postgres + pgvector**, storage **S3**, login
utenti **Cognito**, deploy continuo via **GitHub Actions**.

Tutta l'infrastruttura è in `infra/` (Terraform). Il `terraform apply` lo esegui
tu con le tue credenziali: niente è applicato automaticamente.

## Architettura

```
            Route53 (knowkube.com)
          /                        \
 architect.knowkube.com      api.architect.knowkube.com
      │                              │
 App Runner Web               App Runner API ──VPC connector──┐
 (egress pubblico)            (egress via VPC)                │
                                   │                          ▼
                                   │                     RDS Postgres (privato)
                                   │                     + pgvector
                                   ├── NAT GW ──► Internet / Bedrock us-east-1 (immagini) / Unsplash
                                   └── S3 gateway endpoint ──► S3 (pacchetti/media)
             Bedrock eu-west-1 (LLM/embeddings), Polly, Transcribe, Secrets, ECR  (via NAT)
```

Perché App Runner e non ECS/ALB: niente load balancer da pagare (~$20/mese) e
molta meno infra. L'unico costo di rete fisso è un NAT Gateway (~$32/mese), che
serve perché App Runner, quando è collegato a una VPC, instrada **tutto** l'egress
nella VPC: il NAT dà all'API l'accesso a Internet e a us-east-1.

## Prerequisiti

- Account AWS con accesso amministrativo per il primo apply.
- Terraform ≥ 1.6, AWS CLI, Docker.
- Hosted zone Route53 esistente per `knowkube.com`.
- Accesso ai modelli Bedrock abilitato nella console (Claude in eu-west-1,
  Stability in us-east-1): va richiesto una tantum da **Bedrock → Model access**.

## 1. Bootstrap dello stato Terraform (una tantum)

```bash
cd infra/bootstrap
terraform init
terraform apply -var="project=scorm" -var="region=eu-west-1"
# Annota gli output: state_bucket, lock_table
```

Poi configura il backend remoto per lo stack principale:

```bash
cd ../
cp backend.tf.example backend.tf
# sostituisci <ACCOUNT_ID> nel bucket (vedi output state_bucket)
```

## 2. Applica l'infrastruttura

```bash
cp terraform.tfvars.example terraform.tfvars
# verifica web_domain / api_domain / route53_zone_name / github_repo
terraform init -reconfigure
terraform apply
```

Al primo apply, App Runner creerà i servizi puntando a immagini ECR che **non
esistono ancora** (`:latest`): è normale che partano in stato *failed* finché la
CI non pubblica le prime immagini (passo 4). I record Route53 e la validazione
del certificato vengono creati automaticamente.

Annota gli output principali:

```bash
terraform output
# ecr_api_url, ecr_web_url, apprunner_api_service_arn, apprunner_web_service_arn,
# migrate_codebuild_project, github_deploy_role_arn, cognito_issuer,
# cognito_web_client_id, db_endpoint, db_app_password (sensitive)
```

## 3. Bootstrap del database (una tantum)

RDS è privato: esegui dalla tua rete solo se hai connettività alla VPC
(es. bastion/VPN). In alternativa, lancia questi comandi da una sessione dentro
la VPC. Servono l'URL admin e la password del ruolo app.

```bash
# recupera i segreti
ADMIN_URL=$(aws secretsmanager get-secret-value --secret-id scorm/DATABASE_URL_ADMIN --query SecretString --output text --region eu-west-1)
APP_PWD=$(terraform output -raw db_app_password)

# crea estensione pgvector + ruolo applicativo non-superuser
psql "$ADMIN_URL" -v app_password="'$APP_PWD'" -f infra/db-bootstrap.sql
```

Le **migrazioni dello schema** NON si lanciano a mano: le applica la CI tramite
CodeBuild dentro la VPC (passo 4).

## 4. Configura e lancia la CI

Nel repo GitHub, imposta le **Repository variables** (Settings → Secrets and
variables → Actions → Variables) con gli output Terraform:

| Variabile | Valore (output tf) |
| --- | --- |
| `AWS_REGION` | `eu-west-1` |
| `AWS_DEPLOY_ROLE_ARN` | `github_deploy_role_arn` |
| `ECR_API` | `ecr_api_url` |
| `ECR_WEB` | `ecr_web_url` |
| `APPRUNNER_API_ARN` | `apprunner_api_service_arn` |
| `APPRUNNER_WEB_ARN` | `apprunner_web_service_arn` |
| `MIGRATE_PROJECT` | `migrate_codebuild_project` |
| `WEB_DOMAIN` | `architect.knowkube.com` |
| `API_DOMAIN` | `api.architect.knowkube.com` |
| `COGNITO_ISSUER` | `cognito_issuer` |
| `COGNITO_CLIENT_ID` | `cognito_web_client_id` |

Imposta anche `github_repo` in `terraform.tfvars` (es. `sturo82/scorm-generator`)
e riapplica se non l'hai fatto.

Poi fai un push su `main` (o lancia il workflow a mano). La pipeline:
1. test (build + vitest + lint in container);
2. build & push immagini API (+ stage `migrate`) e Web su ECR;
3. migrazioni DB via CodeBuild nella VPC;
4. `StartDeployment` dei due servizi App Runner.

## 5. Primo tenant e primo utente OWNER

I tenant NON si auto-creano in produzione. Crea il primo tenant + OWNER con lo
script di seed (gira dove ha accesso al DB, es. CodeBuild/bastion):

```bash
OWNER_SUB=<sub Cognito del primo utente>   # da Cognito dopo la creazione utente
OWNER_EMAIL=owner@tuodominio.com \
TENANT_ID=tenant-prod TENANT_NAME="La tua org" \
DATABASE_URL="<DATABASE_URL_ADMIN>" \
node apps/api/scripts/seed-owner.mjs
```

L'utente va prima creato in Cognito (console o invito), con il custom attribute
`custom:tenant_id = tenant-prod`. Da lì gli altri utenti si invitano dal pannello
Utenti della web app.

## 6. Collegare OnDemand (integrazione B2B + SSO)

Vedi [`INTEGRATION_B2B.md`](./INTEGRATION_B2B.md). In sintesi: un ADMIN crea un
IntegrationClient (API key); OnDemand la usa per il catalogo/download e, con lo
scope `sso:issue`, per il single sign-on degli utenti.

## Costi indicativi (ordine di grandezza, eu-west-1)

| Voce | ~ /mese |
| --- | --- |
| App Runner API (1 vCPU/2GB, min 1) | ~$25–40 |
| App Runner Web (1 vCPU/2GB, min 1) | ~$25–40 |
| RDS db.t4g.micro + 20GB gp3 | ~$15–18 |
| NAT Gateway + traffico | ~$32+ |
| S3 / Secrets / Route53 / ECR | pochi $ |

Per ridurre: abbassa `apprunner_memory`/`cpu`, valuta `min_size` dinamico, o
sostituisci il NAT con interface endpoint se rinunci a us-east-1/stock pubblici.

## Sicurezza — isolamento multi-tenant e RLS

L'isolamento tra tenant è garantito dal **filtro `tenantId` esplicito** in ogni
query applicativa. Le migrazioni abilitano anche Row-Level Security su alcune
tabelle, ma la GUC `app.current_tenant` oggi è impostata solo in pochi percorsi
(`runInTenant`). Per questo, al lancio, il ruolo DB applicativo `scorm_app` ha
l'attributo **BYPASSRLS**: non è superuser (privilegi ridotti) ma non è bloccato
dalle policy, così il comportamento è identico a quello verificato in sviluppo.

Hardening futuro (non necessario per la correttezza dell'isolamento): passare
tutti i percorsi tenant a `runInTenant`, poi togliere `BYPASSRLS` da `scorm_app`
per rendere la RLS un secondo livello di difesa attivo.

## Rollback

App Runner conserva le revisioni: dalla console, o ridistribuendo un tag ECR
precedente (le immagini sono taggate con lo SHA del commit). Il DB va trattato a
parte: le migrazioni Prisma sono forward-only; per tornare indietro serve un
ripristino da snapshot RDS.
