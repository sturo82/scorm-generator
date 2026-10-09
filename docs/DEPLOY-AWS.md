# Deploy in produzione — AWS ECS Fargate + RDS (eu-west-1)

Guida al deploy dello SCORM Course Generator su AWS con Terraform. Architettura
"Scenario B": container gestiti su ECS Fargate, Postgres gestito su RDS, ALB,
S3, ECR, Secrets Manager, IAM task role.

## Scelte di architettura

- **Regione primaria: `eu-west-1` (Irlanda, UE)** per GDPR: compute, RDS,
  S3, Claude (Bedrock), Polly, Transcribe sono tutti in UE.
- **Eccezione immagini**: la generazione immagini (Bedrock Stable Image) **non
  è disponibile in UE** → gira in `us-west-2` (`media_region`). È un
  trasferimento extra-UE: va coperto da base giuridica (SCC) e documentato,
  oppure sostituito con un provider text-to-image UE (TODO futuro).
- **Rete a basso costo**: niente NAT Gateway. I task Fargate stanno in subnet
  pubbliche con IP pubblico; la sicurezza è nei security group (ingress solo
  dall'ALB). S3 passa dal gateway endpoint (gratuito).
- **ARM/Graviton** su Fargate e RDS per ridurre i costi.
- **API = anche worker**: il consumer della coda gira nello stesso processo
  dell'API (coda `in-memory`: i job in corso si perdono a un restart; per
  durabilità passare a SQS in futuro).

## Costo indicativo (ordine di grandezza, verifica su calculator.aws)

Fisso ~$60–75/mese: Fargate API+Web ~$27, RDS t4g.micro ~$15–18, ALB ~$18,
S3+transfer ~$5. Variabile (dominante): consumo Bedrock/Polly/Transcribe per
corso generato — tracciato dal metering dell'app.

## Prerequisiti

- AWS CLI configurata con un profilo che può creare VPC/ECS/RDS/IAM/ECR/Secrets.
- Terraform >= 1.6 e Docker.
- Modelli Bedrock abilitati sull'account: Claude in `eu-west-1`, Stable Image in
  `us-west-2` (Console Bedrock → Model access).
- (Produzione) un dominio + certificato ACM in `eu-west-1` per HTTPS.

## 1. Provisioning infrastruttura (Terraform)

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # adatta i valori
terraform init
terraform apply
```

Al termine annota gli output: `ecr_api_repository_url`, `ecr_web_repository_url`,
`alb_dns_name`, `ecs_cluster_name`, `service_subnets`, `service_security_group`,
`s3_assets_bucket`.

> RDS ha `deletion_protection = true`: `terraform destroy` fallirà sul DB finché
> non la disattivi (protezione anti-cancellazione accidentale dei dati).

## 2. Build & push delle immagini (ECR)

Login a ECR e build multi-arch ARM64 (coerente con Fargate ARM):

```bash
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGION=eu-west-1
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ACCOUNT.dkr.ecr.$REGION.amazonaws.com

API_REPO=$(terraform -chdir=infra/terraform output -raw ecr_api_repository_url)
WEB_REPO=$(terraform -chdir=infra/terraform output -raw ecr_web_repository_url)
TAG=$(git rev-parse --short HEAD)

# API (runtime) + immagine migrazioni (stesso Dockerfile, target migrate)
docker buildx build --platform linux/arm64 -f Dockerfile          -t $API_REPO:$TAG            --push .
docker buildx build --platform linux/arm64 -f Dockerfile --target migrate -t $API_REPO:migrate-$TAG --push .

# Valori Cognito dagli output Terraform (per i build-arg del Web).
COGNITO_ISSUER=$(terraform -chdir=infra/terraform output -raw cognito_issuer)
COGNITO_CLIENT=$(terraform -chdir=infra/terraform output -raw cognito_client_id)

# Web (NEXT_PUBLIC_* inlined al build: passali come build-arg!)
docker buildx build --platform linux/arm64 -f Dockerfile.web \
  --build-arg NEXT_PUBLIC_API_MODE=real \
  --build-arg NEXT_PUBLIC_API_URL=https://api.example.com \
  --build-arg NEXT_PUBLIC_AUTH_MODE=oidc \
  --build-arg NEXT_PUBLIC_OIDC_ISSUER=$COGNITO_ISSUER \
  --build-arg NEXT_PUBLIC_OIDC_CLIENT_ID=$COGNITO_CLIENT \
  --build-arg NEXT_PUBLIC_OIDC_REDIRECT_URI=https://app.example.com/auth/callback \
  --build-arg NEXT_PUBLIC_OIDC_SCOPE="openid email profile" \
  -t $WEB_REPO:$TAG --push .
```

Poi applica i tag a Terraform (così le task definition puntano alle nuove image):

```bash
terraform -chdir=infra/terraform apply -var="api_image_tag=$TAG" -var="web_image_tag=$TAG"
```

## 3. Migrazioni del database (one-off, PRIMA di esporre l'API)

Esegui la task definition `migrate` (immagine `migrate-$TAG`) una volta:

```bash
CLUSTER=$(terraform -chdir=infra/terraform output -raw ecs_cluster_name)
SUBNETS=$(terraform -chdir=infra/terraform output -json service_subnets | jq -r 'join(",")')
SG=$(terraform -chdir=infra/terraform output -raw service_security_group)

aws ecs run-task --cluster $CLUSTER \
  --launch-type FARGATE \
  --task-definition scorm-prod-migrate \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG],assignPublicIp=ENABLED}" \
  --region eu-west-1
```

Controlla i log in CloudWatch (`/ecs/scorm-prod/migrate`). Deve stampare le
migrazioni applicate e uscire con codice 0.

### Abilitare pgvector

La prima migrazione crea l'estensione pgvector (`CREATE EXTENSION IF NOT EXISTS
vector`). Se il tuo utente RDS non ha i permessi, abilitala una volta come master:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

## 4. Forzare il deploy dei servizi

Dopo push immagini + migrazioni, forza il redeploy per prendere le nuove image:

```bash
aws ecs update-service --cluster $CLUSTER --service scorm-prod-api --force-new-deployment --region eu-west-1
aws ecs update-service --cluster $CLUSTER --service scorm-prod-web --force-new-deployment --region eu-west-1
```

## 4-bis. Primo utente OWNER (Cognito + seed DB)

Gli utenti devono esistere sia in **Cognito** sia nel **DB** (il record `User`
collega il `sub` Cognito al tenant e al ruolo). Il primo OWNER si crea a mano una
volta; da lì in poi usi il pannello **Utenti** nell'app per invitare gli altri.

Scegli un `TENANT_ID` (es. `tenant-prod`): è il valore che va in
`custom:tenant_id` e che userà il seed. Deve restare coerente.

1) Crea l'utente OWNER in Cognito con l'attributo tenant:

```bash
POOL=$(terraform -chdir=infra/terraform output -raw cognito_user_pool_id)
TENANT_ID=tenant-prod
OWNER_EMAIL=owner@tuazienda.com

aws cognito-idp admin-create-user \
  --user-pool-id "$POOL" \
  --username "$OWNER_EMAIL" \
  --user-attributes Name=email,Value="$OWNER_EMAIL" Name=email_verified,Value=true "Name=custom:tenant_id,Value=$TENANT_ID" \
  --desired-delivery-mediums EMAIL \
  --region eu-west-1
```

2) Ricava il `sub` (externalId) generato da Cognito:

```bash
OWNER_SUB=$(aws cognito-idp admin-get-user --user-pool-id "$POOL" --username "$OWNER_EMAIL" \
  --region eu-west-1 --query "UserAttributes[?Name=='sub'].Value" --output text)
echo "$OWNER_SUB"
```

3) Esegui il seed come task one-off (immagine `migrate`, che include Prisma +
   client; ha già `DATABASE_URL` dal segreto). Passa le variabili con
   `--overrides` del container `migrate`, sostituendo il comando:

```bash
aws ecs run-task --cluster $CLUSTER --launch-type FARGATE \
  --task-definition scorm-prod-migrate \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG],assignPublicIp=ENABLED}" \
  --overrides '{"containerOverrides":[{"name":"migrate","command":["node","apps/api/scripts/seed-owner.mjs"],"environment":[{"name":"TENANT_ID","value":"'"$TENANT_ID"'"},{"name":"TENANT_NAME","value":"La tua org"},{"name":"OWNER_SUB","value":"'"$OWNER_SUB"'"},{"name":"OWNER_EMAIL","value":"'"$OWNER_EMAIL"'"},{"name":"OWNER_NAME","value":"Owner"}]}]}' \
  --region eu-west-1
```

Controlla i log (`/ecs/scorm-prod/migrate`): deve stampare "OWNER pronto". Ora
l'OWNER può loggare (riceve l'email d'invito di Cognito con password temporanea)
e invitare altri utenti dal pannello **Utenti** → che crea in automatico sia
l'utente Cognito (con `custom:tenant_id`) sia il record DB.

> **Nota GDPR**: tutto resta in `eu-west-1` tranne la generazione IMMAGINI
> (Bedrock Stable Image non disponibile in UE → `media_region=us-west-2`),
> trasferimento extra-UE da coprire con SCC o da sostituire con un provider
> text-to-image europeo in futuro.

## 5. DNS e TLS

- Crea un certificato ACM in `eu-west-1` per `app.example.com` e
  `api.example.com`, passa l'ARN in `acm_certificate_arn` e riapplica.
- Punta i record DNS (CNAME/ALIAS) di `app` e `api` al valore di
  `alb_dns_name`.
- Imposta `cors_origins = "https://app.example.com"` e ri-builda il Web con il
  giusto `NEXT_PUBLIC_API_URL`.

## 6. Verifica

- `https://api.example.com/health` → `{ "status": "ok" }`.
- `https://api.example.com/health/ready` → verifica anche il DB.
- `https://app.example.com` → frontend.

## Note operative

- **Segreti**: `DATABASE_URL` e `AUTH_JWT_SECRET` sono in Secrets Manager e
  iniettati nel task; non compaiono mai in chiaro. Le credenziali AWS NON sono
  variabili: le fornisce il task role (IAM) via default credential chain.
- **Scaling**: con `in-memory` job queue resta su 1 task API (ogni istanza
  drena solo la propria coda). Per scalare orizzontalmente l'API passa a SQS.
- **Backup DB**: RDS con 7 giorni di retention automatica.
- **Rollback**: ri-tagga l'immagine precedente e `update-service`.
- **Gestione utenti**: pannello **Utenti** (`/settings/users`) visibile ad
  ADMIN/OWNER. L'invito crea l'utente in Cognito (email con password temporanea)
  e il record DB. Un ADMIN non può creare un OWNER. Senza `COGNITO_USER_POOL_ID`
  l'endpoint risponde 501 (ambienti senza Cognito).
