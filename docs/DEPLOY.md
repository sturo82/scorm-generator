# K Scorm — Deploy (come funziona, cosa viene usato)

> Guida al deploy di produzione di K Scorm. Descrive l'architettura di deploy,
> gli strumenti usati, la pipeline automatica e la procedura manuale (incl. il
> Terraform). Basata sulla configurazione reale del repo.
>
> Correlati: `docs/OPERATIONS.md` (dev & env), `infra/README.md` (dettagli infra).

---

## 1. Topologia di deploy

K Scorm è un monorepo con due artefatti distribuiti in modo diverso:

```
                 ┌─────────────────────────────────────────────┐
   utenti ──────▶│ CloudFront  (CDN)                            │
                 │   ├── /            → S3 (web statico Next.js) │
                 │   └── /api/*? NO: l'API ha dominio proprio    │
                 └─────────────────────────────────────────────┘
   browser ─────▶  architect.knowkube.com         (web, S3+CloudFront)
   web/API  ─────▶ api.architect.knowkube.com      (API, App Runner)
                        │
                        ├── RDS PostgreSQL (privato/blindato)
                        ├── Secrets Manager (segreti)
                        ├── Bedrock / Polly / Transcribe (AI)
                        └── Cognito d'ecosistema (login utenti, via Manager)
```

- **API** (`apps/api`, NestJS): immagine Docker su **AWS App Runner**, dominio
  `api.architect.knowkube.com`.
- **Web** (`apps/web`, Next.js static export): file statici su **S3**, serviti da
  **CloudFront**, dominio `architect.knowkube.com`.
- **DB**: **RDS PostgreSQL** (endpoint pubblico ma blindato; le migrazioni girano
  via CodeBuild).
- **Segreti**: **AWS Secrets Manager** (DB url, JWT, M2M ecosistema, ecc.).

Tutto l'infra è gestito con **Terraform** nella cartella `infra/` (stack attivo).
`infra/terraform/` è un vecchio stack ECS **non usato**.

---

## 2. Strumenti usati

| Scopo | Strumento |
|---|---|
| IaC / provisioning | Terraform (`infra/`), provider AWS |
| Build immagine API | Docker multi-stage (`Dockerfile`) |
| Registry immagini | Amazon ECR (`scorm-api`) |
| Runtime API | AWS App Runner (`scorm-api`) |
| Migrazioni DB | AWS CodeBuild (`scorm-migrate`) con immagine `:migrate` |
| Hosting web | S3 (`scorm-web-…`) + CloudFront |
| CI/CD | GitHub Actions (`.github/workflows/deploy.yml`), auth AWS via OIDC |
| Segreti | AWS Secrets Manager |
| DNS/TLS | Route53 + ACM |

Build/test SEMPRE in container `node:20.11.0-bookworm` (nessun Node sull'host).

---

## 3. Il Dockerfile (multi-stage)

Un solo `Dockerfile` con più target (stage):

- **`base`** → Node 20.11.0 slim, `NODE_ENV=production`.
- **`deps`** → `npm ci` dell'INTERO workspace (incl. devDeps, servono a `tsc`).
- **`build`** → `prisma generate` + build dei package in **ordine di dipendenza**
  (`contracts → domain → adapters → scorm → api`). Il web NON è compilato qui.
- **`runtime`** (target dell'immagine API) → solo dipendenze di produzione
  (`npm ci --omit=dev`) + i `dist/` + client Prisma; utente non-root; porta 3000;
  `CMD node apps/api/dist/main.js`.
- **`migrate`** → immagine separata con Prisma CLI + schema/migrazioni;
  `CMD prisma migrate deploy`. Usata da CodeBuild, non da App Runner.

Build locale di esempio:
```bash
docker build --target runtime -t <ecr>/scorm-api:latest .
docker build --target migrate -t <ecr>/scorm-api:migrate .
```

---

## 4. Deploy automatico (CI/CD — il modo normale)

**Trigger:** ogni `push` su `main` (o `workflow_dispatch`) avvia
`.github/workflows/deploy.yml`. L'auth verso AWS è via **OIDC** (nessuna chiave
statica); assume il ruolo `scorm-github-deploy`.

Sequenza del workflow:
1. **test**: `npm ci` → `prisma generate` → `npm run build` → `vitest run` →
   `lint`. Se fallisce, niente deploy.
2. **Build & push API**: builda `:<<sha>>`, `:latest` (target runtime) e
   `:migrate`, li pusha su ECR.
3. **Migrazioni DB**: avvia il progetto CodeBuild `scorm-migrate` e ne attende
   l'esito (`prisma migrate deploy` dentro, con `DATABASE_URL` admin da Secrets
   Manager). Se fallisce, il deploy si ferma.
4. **Deploy API**: `aws apprunner start-deployment` sul servizio `scorm-api`
   (App Runner prende l'immagine `:latest` da ECR).
5. **Build & deploy web**: build statico Next.js con le `NEXT_PUBLIC_*` (da repo
   variables), `aws s3 sync` su bucket web (+ cache policy), invalidazione
   CloudFront.

> **Prerequisito importante:** il workflow assume che **l'infra Terraform sia
> già applicata**. La CI NON esegue `terraform apply`. Se hai cambiato qualcosa
> in `infra/` (env del servizio, IAM, secret, ecc.), devi fare l'apply **prima**
> (o subito dopo) — vedi §5. Altrimenti l'immagine nuova gira con la config
> vecchia.

### Repo variables usate dal workflow (GitHub → Settings → Variables)
`AWS_REGION`, `AWS_DEPLOY_ROLE_ARN`, `ECR_API`, `APPRUNNER_API_ARN`,
`MIGRATE_PROJECT`, `WEB_BUCKET`, `CLOUDFRONT_ID`, `WEB_DOMAIN`, `API_DOMAIN`,
`COGNITO_ISSUER`, `COGNITO_CLIENT_ID`, `AUTH_DOMAIN`. I valori provengono dagli
**output Terraform**.

---

## 5. Deploy / modifiche infra manuali (Terraform)

Quando cambi l'infra (es. env del servizio API, IAM, nuovi secret), si applica a
mano. Pattern usato (WSL2/host senza profilo AWS persistente):

```bash
cd infra
# credenziali dal .env del repo (chiavi dell'utente di deploy)
set -a
AWS_ACCESS_KEY_ID=$(grep -E '^AWS_ACCESS_KEY_ID=' ../.env | head -1 | cut -d= -f2-)
AWS_SECRET_ACCESS_KEY=$(grep -E '^AWS_SECRET_ACCESS_KEY=' ../.env | head -1 | cut -d= -f2-)
set +a
export AWS_DEFAULT_REGION=eu-west-1
export PATH="$HOME/.local/bin:$PATH"      # aws-cli + terraform installati qui

terraform plan  -var=enable_api_dns_validation=true -out=tfplan
terraform show  tfplan | grep -E "will be|Plan:"   # verifica: 0 destroy atteso
terraform apply tfplan
```

Note:
- Un `apply` che cambia le env di App Runner **fa ripartire** il servizio da solo
  con la nuova config (non serve `start-deployment` separato per le sole env).
- `terraform.tfvars` è **gitignored** (contiene valori reali/segreti); versiona
  solo `terraform.tfvars.example`.
- Diff benigni noti/perpetui (non allarmarti): `aws_db_parameter_group.pg`
  (apply_method), re-render di alcune policy IAM.

---

## 6. Migrazioni del database

- Le migrazioni Prisma stanno in `apps/api/prisma/migrations/NNNN_nome/`.
- In produzione RDS è raggiungibile ma le migrazioni girano via **CodeBuild**
  (`scorm-migrate`): usa l'immagine `:migrate`, legge la `DATABASE_URL` admin da
  Secrets Manager, esegue `prisma migrate deploy` (idempotente, non interattivo).
- La CI avvia CodeBuild automaticamente (step 3). Per lanciarla a mano:
  ```bash
  BUILD_ID=$(aws codebuild start-build --project-name scorm-migrate --query 'build.id' --output text)
  aws codebuild batch-get-builds --ids "$BUILD_ID" --query 'builds[0].buildStatus'
  ```
- **Ordine corretto** quando una modifica tocca schema + codice: build immagine
  (incl. `:migrate`) → **migrazione** → deploy API. La CI lo fa già in
  quest'ordine.

---

## 7. Variabili d'ambiente del servizio API

Definite in Terraform (`infra/apprunner.tf`), due blocchi:
- `runtime_environment_variables`: valori in chiaro (provider AI, OIDC issuer,
  config ecosistema, ecc.).
- `runtime_environment_secrets`: riferimenti ad ARN di Secrets Manager
  (`DATABASE_URL`, `AUTH_JWT_SECRET`, `INTEGRATION_JWT_SECRET`,
  `SSO_USER_JWT_SECRET`, `UNSPLASH_ACCESS_KEY`).

Riferimento completo dei nomi e significati: `.env.example` + `docs/OPERATIONS.md`.

> Ecosistema (onboarding zero-touch): il secret M2M **non** è iniettato come env;
> l'app lo persiste e lo legge da Secrets Manager a runtime
> (`scorm/MANAGER_M2M_CLIENT_SECRET`), ricevuto nel provisioning kit. Vedi
> `docs/ECOSYSTEM-ZEROTOUCH-ONBOARDING.md`.

---

## 8. Deploy del solo web

Il web è static export: non c'è un server. Deploy = sync su S3 + invalidazione.
Lo fa la CI (step 5). A mano:
```bash
# build in container, poi:
aws s3 sync apps/web/out "s3://<web-bucket>" --delete \
  --cache-control "public,max-age=31536000,immutable" --exclude "*.html"
aws s3 sync apps/web/out "s3://<web-bucket>" --delete \
  --cache-control "no-cache" --exclude "*" --include "*.html"
aws cloudfront create-invalidation --distribution-id <cf-id> --paths "/*"
```
Ordine (atomico): prima gli asset con hash (cache lunga), poi gli HTML
(`no-cache`), infine l'invalidazione. Evita il mismatch HTML/asset.

---

## 9. Rollback

- **API**: ridistribuisci un'immagine ECR precedente (tag `:<sha>` del commit
  buono) aggiornando il tag puntato o rifacendo `start-deployment` sulla vecchia.
  Le migrazioni **non** si auto-rollbackano: valuta compatibilità schema.
- **Web**: `s3 sync` dell'output di un build precedente + invalidazione.
- **Infra**: `git revert` del cambiamento Terraform + `apply`.

---

## 10. Osservabilità rapida

- **Stato servizio API**:
  `aws apprunner describe-service --service-arn <arn> --query 'Service.Status'`
- **Log applicativi** (CloudWatch):
  log group `/aws/apprunner/scorm-api/<id>/application` — utile per verificare
  avvio Nest, self-register ecosistema, errori runtime.
- **Health**: `GET https://api.architect.knowkube.com/health`.
- **Config OIDC runtime** (ecosistema): `GET /ecosystem/oidc-config`.

---

## 11. Checklist di un deploy completo (riferimento)

1. `git push origin main` → parte la CI (test → immagine → migrazioni → API → web).
2. Se hai toccato `infra/`: `terraform apply` (vedi §5), verifica **0 destroy**.
3. Verifica health API + log applicativi.
4. Verifica il web su `architect.knowkube.com` (hard refresh / dopo invalidazione).
