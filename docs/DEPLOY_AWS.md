# Deploy su AWS (App Runner + Terraform)

Guida al deploy di produzione su AWS, regione **Irlanda (eu-west-1)**, con la
generazione immagini (Bedrock Stability) in **us-east-1**. Il frontend è
**statico** (S3 + CloudFront), l'API gira su **AWS App Runner**, il database è
**RDS Postgres + pgvector**, lo storage **S3**, il login utenti **Cognito**,
deploy continuo via **GitHub Actions**.

Tutta l'infrastruttura è in `infra/` (Terraform). Il `terraform apply` lo esegui
tu con le tue credenziali: niente è applicato automaticamente.

## Architettura

```
                 Route53 (knowkube.com)
               /                        \
   architect.knowkube.com         api.architect.knowkube.com
          │                              │
     CloudFront                     App Runner API
          │                         (egress pubblico)
     S3 (frontend statico)               │
                                          ├──► Bedrock eu-west-1 (LLM/embeddings)
                                          ├──► Bedrock us-east-1 (immagini)
                                          ├──► Polly / Transcribe / Unsplash
                                          ├──► S3 (pacchetti/media)
                                          └──► RDS Postgres + pgvector
                                               (endpoint pubblico, SG+SSL)
```

Scelte di costo:
- **Frontend statico** su S3+CloudFront: niente server per il web, scala a costo
  ~zero, performance da CDN.
- **Un solo App Runner** (l'API). Niente ALB (App Runner gestisce HTTPS).
- **Niente NAT Gateway, niente VPC connector**: l'API ha egress pubblico e
  raggiunge Bedrock (entrambe le regioni), Unsplash e i servizi AWS direttamente.
- **RDS pubblico ma blindato**: security group ristretto + SSL forzato + password
  forte + utente app non-superuser. È il compromesso che evita il NAT (vedi
  sezione Sicurezza).

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

RDS ha un endpoint pubblico (blindato da SG + SSL): puoi eseguire questi comandi
dalla tua macchina, a patto che il tuo IP rientri in `db_allowed_cidrs`. Servono
l'URL admin e la password del ruolo app.

```bash
# recupera i segreti
ADMIN_URL=$(aws secretsmanager get-secret-value --secret-id scorm/DATABASE_URL_ADMIN --query SecretString --output text --region eu-west-1)
APP_PWD=$(terraform output -raw db_app_password)

# crea estensione pgvector + ruolo applicativo non-superuser
psql "$ADMIN_URL" -v app_password="'$APP_PWD'" -f infra/db-bootstrap.sql
```

Le **migrazioni dello schema** NON si lanciano a mano: le applica la CI tramite
CodeBuild (passo 4).

## 4. Configura e lancia la CI

Nel repo GitHub, imposta le **Repository variables** (Settings → Secrets and
variables → Actions → Variables) con gli output Terraform:

| Variabile | Valore (output tf) |
| --- | --- |
| `AWS_REGION` | `eu-west-1` |
| `AWS_DEPLOY_ROLE_ARN` | `github_deploy_role_arn` |
| `ECR_API` | `ecr_api_url` |
| `APPRUNNER_API_ARN` | `apprunner_api_service_arn` |
| `MIGRATE_PROJECT` | `migrate_codebuild_project` |
| `WEB_BUCKET` | `web_bucket` |
| `CLOUDFRONT_ID` | `cloudfront_distribution_id` |
| `WEB_DOMAIN` | `architect.knowkube.com` |
| `API_DOMAIN` | `api.architect.knowkube.com` |
| `COGNITO_ISSUER` | `cognito_issuer` |
| `COGNITO_CLIENT_ID` | `cognito_web_client_id` |

Imposta anche `github_repo` in `terraform.tfvars` (es. `sturo82/scorm-generator`)
e riapplica se non l'hai fatto.

Poi fai un push su `main` (o lancia il workflow a mano). La pipeline:
1. test (build + vitest + lint in container);
2. build & push immagine API (+ stage `migrate`) su ECR;
3. migrazioni DB via CodeBuild;
4. `StartDeployment` del servizio App Runner API;
5. build statico del web → `s3 sync` sul bucket + invalidazione CloudFront.

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
| RDS db.t4g.micro + 20GB gp3 | ~$15–18 |
| CloudFront + S3 (frontend statico) | ~$1–3 |
| S3 assets / Secrets / Route53 / ECR | pochi $ |

Niente NAT Gateway, niente secondo App Runner, niente ALB: la voce dominante
resta RDS + l'App Runner dell'API.

Per ridurre ulteriormente: abbassa `apprunner_memory`/`cpu` o valuta un
`min_size` più aggressivo sull'autoscaling.

## Sicurezza — database su endpoint pubblico

Per evitare NAT Gateway e VPC connector, RDS ha un **endpoint pubblico**. Non è
"aperto a tutti": la protezione è a più livelli:
- **Security group** `db_allowed_cidrs` (porta 5432). App Runner con egress
  pubblico non ha IP statici pinnabili, quindi il default è `0.0.0.0/0`: in quel
  caso la difesa è data dai punti sotto. Se disponi di un egress a IP fisso,
  restringi le CIDR.
- **SSL forzato** (`rds.force_ssl=1`): nessuna connessione in chiaro.
- **Password forte** generata e conservata in Secrets Manager (mai nel codice).
- **Utente applicativo non-superuser** (`scorm_app`): privilegi minimi.

Chi preferisce RDS totalmente privato può reintrodurre VPC connector + interface
endpoint (accettando il costo e i limiti su us-east-1/Unsplash) o un NAT Gateway.

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
