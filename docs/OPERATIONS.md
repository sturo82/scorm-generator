# Guida operativa — Dev & Prod

Guida pratica per: (1) compilare le variabili d'ambiente in sviluppo e in
produzione, (2) gestire lo stack locale (start/stop), (3) gestire il database
(migrazioni, reset/clean). Riferimento ai valori: [`.env.example`](../.env.example).

> **Prerequisito host:** solo Docker. Node 20.11.0 serve unicamente se sviluppi
> fuori dal Dev Container. Tutti i comandi `npm`/`prisma` qui sotto hanno una
> variante "senza Node sull'host" che gira in un container.

---

## 0. Comandi brevi (scorciatoie npm)

Scorciatoie definite in `package.json` per non digitare i `docker ...` lunghi.
Gli helper stanno in `scripts/` (`db.sh`, `in-container.sh`).

| Comando | Cosa fa |
|---------|---------|
| `npm run infra:up` | Avvia solo l'infra: Postgres + LocalStack |
| `npm run infra:down` | Ferma e rimuove i container infra (dati preservati) |
| `npm run infra:logs` | Segue i log di db + localstack |
| `npm run dev:up` | Avvia lo stack completo (infra + API + Web) |
| `npm run dev:down` | Ferma lo stack completo |
| `npm run dev:logs` | Segue i log di API + Web |
| `npm run db:deploy` | Applica le migrazioni (prisma migrate deploy) |
| `npm run db:generate` | Rigenera il Prisma Client |
| `npm run db:reset` | **Reset DB dev** (droppa e riapplica, distruttivo) |
| `npm run db:psql` | Apre `psql` sul DB (`-- -c "\dt"` per query) |
| `npm run db:studio` | Prisma Studio su <http://localhost:5555> |
| `npm run ci` | install + build + test in container (host senza Node) |

> I comandi `db:*` richiedono l'infra su (`npm run infra:up`). Esempio query:
> `npm run db:psql -- -c "\dt"`.

Flusso tipico primo avvio:

```bash
npm install
npm run build
npm run infra:up
npm run db:deploy
npm run dev:up        # oppure avvia API/Web a mano
```

---

## 1. Concetti chiave sulle variabili d'ambiente

Il progetto ha **tre tipi** di variabili, con regole diverse:

| Tipo | Dove vivono | Visibilità | Esempi |
|------|-------------|------------|--------|
| **API (server-side)** | `.env` letto da `apps/api` | Mai esposte al browser | `DATABASE_URL`, `AUTH_JWT_SECRET`, `OIDC_*`, credenziali AWS |
| **Web pubbliche** | `NEXT_PUBLIC_*` | **Inlined nel bundle al BUILD time**, visibili nel browser | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_OIDC_*` |
| **Infra (compose)** | `docker-compose*.yml` | Solo per i container locali | `POSTGRES_PASSWORD`, `S3_ACCESS_KEY=test` |

Due regole d'oro:

1. **Mai segreti in `NEXT_PUBLIC_*`.** Finiscono nel JavaScript scaricato dal
   browser. Il client OIDC usa PKCE proprio per non avere un client secret.
2. **`NEXT_PUBLIC_*` sono fissate quando compili il frontend**, non a runtime.
   Se cambi un valore devi **ri-buildare** `apps/web`.

---

## 2. Variabili per ambiente DEV

In sviluppo l'obiettivo è "zero dipendenze cloud": provider mock/in-memory e,
quando vuoi testare l'integrazione AWS, LocalStack (S3 emulato in locale).

### 2a. Setup rapido (il più semplice: tutto mock)

```bash
cp .env.example .env
```

Lascia i default. In questa configurazione:

- `PROVIDER_LLM=mock`, `PROVIDER_EMBEDDINGS=mock` → nessuna chiamata a Bedrock.
- `PROVIDER_OBJECT_STORAGE=local`, `PROVIDER_JOB_QUEUE=in-memory` → nessun AWS.
- `PROVIDER_VECTOR_STORE=in-memory` → nessun pgvector necessario per i test unit.
- `AUTH_PROVIDER=jwt` con un secret di sviluppo.

Il frontend, senza `NEXT_PUBLIC_*`, usa il **mock client in-memory** e il **login
mock** → la UI gira anche senza backend.

### 2b. Dev con stack reale (API + Postgres + LocalStack)

Per far parlare web e API davvero, usa queste variabili (già impostate in
`docker-compose.dev.yml`, qui per riferimento se avvii i processi a mano):

```dotenv
# API
DATABASE_URL=postgresql://scorm:scorm_dev_password@db:5432/scorm   # host "db" dentro compose, "localhost" fuori
AUTH_PROVIDER=dev            # accetta il token statico "dev-token" e auto-provisiona tenant/utente
CORS_ORIGINS=http://localhost:3100
PROVIDER_OBJECT_STORAGE=s3   # usa l'adapter S3 reale puntato a LocalStack
PROVIDER_VECTOR_STORE=pgvector
S3_ENDPOINT=http://localstack:4566   # "localhost:4566" se avvii l'API fuori da compose
S3_REGION=us-east-1
S3_ACCESS_KEY=test           # credenziali finte: LocalStack le accetta
S3_SECRET_KEY=test
S3_BUCKET=scorm-dev
```

```dotenv
# Web (ri-build necessario se cambi questi valori)
NEXT_PUBLIC_API_MODE=real
NEXT_PUBLIC_API_URL=http://localhost:3000
```

> **`AUTH_PROVIDER=dev`** è solo per sviluppo: accetta il Bearer `dev-token` e
> crea al volo tenant/utente OWNER. Non usarlo mai in produzione.

### 2c. Dev con OIDC/Cognito reale (opzionale)

Se vuoi provare il login reale già in dev, vedi la sezione Prod (§3c): le
variabili sono identiche, cambia solo il `REDIRECT_URI` (es. `http://localhost:3100/auth/callback`),
che va registrato nell'app client dell'IdP.

---

## 3. Variabili per ambiente PROD

In produzione: niente mock, niente credenziali statiche, segreti iniettati dal
gestore segreti della piattaforma (AWS Secrets Manager, SSM, variabili del
servizio di hosting), **mai** committati.

### 3a. API — core

```dotenv
PORT=3000
DATABASE_URL=postgresql://<user>:<password>@<host>:5432/<db>?sslmode=require

PROVIDER_LLM=bedrock
PROVIDER_EMBEDDINGS=bedrock
PROVIDER_VECTOR_STORE=pgvector
PROVIDER_OBJECT_STORAGE=s3
PROVIDER_JOB_QUEUE=sqs

CORS_ORIGINS=https://app.tuodominio.com   # dominio reale del frontend, niente localhost
```

### 3b. API — AWS (Bedrock, S3, SQS)

**Non** impostare `AWS_ACCESS_KEY_ID`/`SECRET` come variabili: in produzione usa
un **ruolo IAM** (task role ECS, IRSA su EKS, instance profile EC2). La default
credential chain di AWS li raccoglie da sola. Lascia quindi quei campi vuoti.

```dotenv
# Bedrock
BEDROCK_REGION=eu-west-1
BEDROCK_LLM_MODEL_ID=anthropic.claude-3-5-sonnet-20240620-v1:0
BEDROCK_EMBEDDINGS_MODEL_ID=amazon.titan-embed-text-v2:0
EMBEDDINGS_DIMENSIONS=1024    # DEVE combaciare col modello embeddings (titan v2 = 1024)

# S3 reale: NESSUN S3_ENDPOINT (usa l'endpoint AWS vero), NESSUNA access key statica
S3_REGION=eu-west-1
S3_BUCKET=scorm-prod-<account>

# SQS reale
SQS_QUEUE_URL=https://sqs.eu-west-1.amazonaws.com/<account-id>/scorm-jobs
SQS_REGION=eu-west-1
```

> **Attenzione a `EMBEDDINGS_DIMENSIONS`:** se passi da mock (64) a Bedrock
> (es. 1024) cambia lo schema pgvector. Allinea il valore e **rigenera gli
> embeddings esistenti**, altrimenti la ricerca vettoriale fallisce.

### 3b-bis. API — Generazione media (immagini e audio)

Le immagini (Stability Stable Image Core su Bedrock) e l'audio di narrazione
(Amazon Polly) sostituiscono i placeholder dei contenuti. Default: `mock` (nessun
costo). Attivazione dei provider reali:

```dotenv
PROVIDER_IMAGE=bedrock        # immagini via Stability Stable Image Core
PROVIDER_SPEECH=polly         # narrazione via Amazon Polly
MEDIA_REGION=us-west-2        # regione dei modelli media (Stable Image + Polly)
IMAGE_FORMAT=jpeg             # jpeg = pacchetti SCORM piu leggeri (png ~10x)
SPEECH_DEFAULT_VOICE=Bianca   # voce italiana neurale
```

Endpoint (ruolo EDITOR):
- `POST /courses/:id/generate/lessons/:lessonId/images` — genera le immagini
  mancanti nei block della lezione (idempotente; salta quelle già presenti).
  Restituisce `{generated, skipped, failed, warnings[]}`: un fallimento sulla
  singola immagine (es. filtro contenuti) non interrompe le altre.
- `POST /courses/:id/generate/lessons/:lessonId/narration` — genera l'MP3 di
  narrazione dal testo della lezione.

> **Prompt in inglese obbligatorio:** Stable Image filtra i prompt non in
> inglese (anche innocui). L'app traduce automaticamente i prompt immagine in
> inglese via LLM prima della generazione.
>
> **Limite Polly:** `SynthesizeSpeech` sincrono accetta ~3000 caratteri. Per
> lezioni molto lunghe serve chunking o l'API asincrona (non ancora implementata).
>
> **Regioni:** Stable Image Core/Ultra e Nova Canvas non sono disponibili in
> tutte le regioni. `us-west-2` ospita insieme Claude, Stable Image e Polly.

### 3b-ter. API — Immagini stock royalty-free (Pexels / Unsplash)

Terza fonte immagini oltre a generazione AI e upload: ricerca di foto
royalty-free da una libreria stock. Il provider è astratto (si sceglie Pexels
**oppure** Unsplash via env); l'immagine scelta viene **scaricata e salvata su
S3** (`storageKey`) così finisce nel pacchetto SCORM offline, con
l'**attribuzione obbligatoria** (credito autore + fonte) salvata nel MediaRef e
mostrata sia in anteprima sia nell'export. Default: `none` (endpoint 501).

```dotenv
STOCK_IMAGE_PROVIDER=pexels   # none | pexels | unsplash
PEXELS_API_KEY=...            # se provider=pexels (chiave gratuita da pexels.com/api)
UNSPLASH_ACCESS_KEY=...       # se provider=unsplash (unsplash.com/developers)
```

Endpoint (ruolo EDITOR, prefisso `/courses/:courseId/stock-images`):
- `GET /search?q=` — cerca immagini stock per query testuale. Risponde
  `{provider, results[]}` (solo metadati + thumbnail, nessun byte scaricato);
  `501` se il provider non è configurato.
- `POST /lessons/:lessonId/attach` `{blockId, photoId, provider, mediaIndex?, alt?}`
  — scarica l'immagine a piena risoluzione, la salva su S3 e scrive
  `storageKey` + `attribution` nel MediaRef immagine del block indicato.

> **Attribuzione:** Unsplash richiede il credito all'autore e il tracking del
> download (gestito automaticamente dall'adapter); Pexels raccomanda il credito.
> Il credito è reso come didascalia accanto all'immagine in anteprima ed export.
>
> **GDPR:** verso il provider viene inviata solo la query testuale; l'immagine
> selezionata è scaricata e archiviata su S3 (UE).

### 3c. API — Autenticazione OIDC (Amazon Cognito)

```dotenv
AUTH_PROVIDER=oidc
OIDC_ISSUER=https://cognito-idp.<region>.amazonaws.com/<userPoolId>
OIDC_AUDIENCE=<app-client-id>
OIDC_TOKEN_USE=access         # l'access token di Cognito non ha "aud" ma "client_id"
OIDC_TENANT_CLAIM=custom:tenant_id
# OIDC_JWKS_URI opzionale: se omesso è derivato da OIDC_ISSUER (/.well-known/jwks.json)
```

Come ottenere questi valori da Cognito:

1. **User pool** → la pagina riporta `Pool Id` (es. `eu-west-1_abc123`) e la
   region. `OIDC_ISSUER = https://cognito-idp.<region>.amazonaws.com/<poolId>`.
2. **App client** (tipo *public client*, senza secret) → copia il `Client ID`
   → è `OIDC_AUDIENCE` e `NEXT_PUBLIC_OIDC_CLIENT_ID`.
3. Nell'app client abilita **Authorization code grant** + **PKCE**, scope
   `openid email profile`, e registra la **callback URL** di produzione
   (`https://app.tuodominio.com/auth/callback`).
4. Aggiungi al user pool un **custom attribute** `tenant_id` e popolalo per ogni
   utente (è il claim `custom:tenant_id` che l'API legge come tenant).

### 3d. Web — build di produzione

```dotenv
NEXT_PUBLIC_API_MODE=real
NEXT_PUBLIC_API_URL=https://api.tuodominio.com
NEXT_PUBLIC_AUTH_MODE=oidc
NEXT_PUBLIC_OIDC_ISSUER=https://cognito-idp.<region>.amazonaws.com/<userPoolId>
NEXT_PUBLIC_OIDC_CLIENT_ID=<app-client-id>
NEXT_PUBLIC_OIDC_REDIRECT_URI=https://app.tuodominio.com/auth/callback
NEXT_PUBLIC_OIDC_SCOPE=openid email profile
```

> Ricorda: questi valori vengono "congelati" nel bundle durante
> `npm run build --workspace @scorm/web`. Builda **dopo** averli impostati.

### 3e. Checklist segreti prod (da NON committare)

- `DATABASE_URL` (contiene la password del DB).
- `AUTH_JWT_SECRET` (se usi ancora `AUTH_PROVIDER=jwt` da qualche parte).
- Credenziali AWS: **non** come env — usa ruoli IAM.
- Il file `.env` di produzione: tenerlo nel secret manager, non nel repo
  (`.env` è già in `.gitignore`).

---

## 4. Gestione dello stack locale (start / stop)

Due file compose:

- `docker-compose.yml` → **infra**: Postgres+pgvector (`:5432`) e LocalStack (`:4566`).
- `docker-compose.dev.yml` → **app**: API (`:3000`) e Web (`:3100`), sopra l'infra.

### Solo infrastruttura (consigliato se sviluppi l'app a mano / nel Dev Container)

```bash
# START infra
docker compose up -d db localstack

# STATO
docker compose ps

# LOG (segui in tempo reale)
docker compose logs -f db
docker compose logs -f localstack

# STOP (mantiene i dati)
docker compose stop

# STOP + rimozione container (mantiene i volumi/dati)
docker compose down
```

### Stack completo (infra + API + Web)

> Prerequisito: dipendenze installate (`npm install`) e package buildati
> (`npm run build`), perché i container montano il workspace ed eseguono i dist.

```bash
# START tutto
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# LOG dell'API
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f api

# STOP tutto
docker compose -f docker-compose.yml -f docker-compose.dev.yml down
```

Endpoint una volta su:

- API: <http://localhost:3000> (health: `/health`)
- Web: <http://localhost:3100>
- Postgres: `localhost:5432` (db `scorm`, utente `scorm`, pwd `scorm_dev_password`)
- LocalStack S3: <http://localhost:4566>

> **Nota SQS in locale:** il `docker-compose.yml` avvia LocalStack con
> `SERVICES: s3` soltanto. Per usare SQS emulato aggiungi `sqs` a quella lista.
> In dev la coda di default è comunque `in-memory`.

### Verifica rapida S3 su LocalStack

```bash
# Crea il bucket di sviluppo e verifica
docker run --rm --network scorm-generator_default \
  -e AWS_ACCESS_KEY_ID=test -e AWS_SECRET_ACCESS_KEY=test -e AWS_DEFAULT_REGION=us-east-1 \
  amazon/aws-cli --endpoint-url http://localstack:4566 s3 mb s3://scorm-dev

docker run --rm --network scorm-generator_default \
  -e AWS_ACCESS_KEY_ID=test -e AWS_SECRET_ACCESS_KEY=test -e AWS_DEFAULT_REGION=us-east-1 \
  amazon/aws-cli --endpoint-url http://localstack:4566 s3 ls
```

---

## 5. Gestione del database (migrazioni e reset)

Schema: `apps/api/prisma/schema.prisma`. Migrazioni versionate in
`apps/api/prisma/migrations/` (`0001_init`, `0002_rls`, `0003_knowledge_chunk`).

> `prisma migrate dev` è **interattivo** e non va usato in automazione. In questo
> progetto si applicano le migrazioni con `migrate deploy` (idempotente, non
> interattivo).

Tutti i comandi assumono l'infra avviata (`docker compose up -d db localstack`)
e girano in un container Node sulla stessa rete del DB.

### Applicare le migrazioni (deploy)

```bash
docker run --rm -v "$PWD":/app -w /app \
  --network scorm-generator_default \
  -e DATABASE_URL=postgresql://scorm:scorm_dev_password@db:5432/scorm \
  node:20.11.0-bookworm bash -lc "\
    npx --workspace @scorm/api prisma generate --schema apps/api/prisma/schema.prisma && \
    npx --workspace @scorm/api prisma migrate deploy --schema apps/api/prisma/schema.prisma && \
    chown -R $(id -u):$(id -g) /app"
```

### Generare solo il Prisma Client

```bash
docker run --rm -v "$PWD":/app -w /app node:20.11.0-bookworm \
  bash -lc "npx --workspace @scorm/api prisma generate --schema apps/api/prisma/schema.prisma && chown -R $(id -u):$(id -g) /app"
```

### Ispezionare il DB (psql)

```bash
docker compose exec db psql -U scorm -d scorm

# one-liner, es. elenco tabelle
docker compose exec db psql -U scorm -d scorm -c "\dt"
```

### Reset / clean del database (SOLO DEV — distrugge i dati)

> ⚠️ Operazione distruttiva e irreversibile. Non eseguire mai contro un DB di
> produzione. Cancella tutti i dati locali.

**Opzione A — reset completo del volume (più pulito):**

```bash
docker compose down                 # ferma i container
docker volume rm scorm-generator_db_data   # elimina il volume dati di Postgres
docker compose up -d db localstack  # ricrea il DB vuoto (riesegue infra/db/init)
# poi riapplica le migrazioni (vedi sopra "Applicare le migrazioni")
```

**Opzione B — reset dello schema via Prisma (mantiene il container):**

```bash
docker run --rm -v "$PWD":/app -w /app \
  --network scorm-generator_default \
  -e DATABASE_URL=postgresql://scorm:scorm_dev_password@db:5432/scorm \
  node:20.11.0-bookworm bash -lc "\
    npx --workspace @scorm/api prisma migrate reset --force --skip-generate --schema apps/api/prisma/schema.prisma && \
    chown -R $(id -u):$(id -g) /app"
```

`migrate reset --force` droppa lo schema, riapplica tutte le migrazioni e **non**
chiede conferma (adatto all'automazione; `--force` è obbligatorio fuori da TTY).

### Pulire anche LocalStack (bucket/oggetti S3)

```bash
docker compose down
docker volume rm scorm-generator_localstack_data
docker compose up -d localstack
```

---

## 6. Build & test (riferimento rapido)

Con Node sull'host:

```bash
npm install
npm run build
npm test            # unit (DB-free)
npm run test:e2e    # E2E backend (richiede DB su)
```

Senza Node sull'host (container):

```bash
docker run --rm -v "$PWD":/app -w /app node:20.11.0-bookworm-slim \
  bash -lc "npm install && npm run build && npm test && chown -R $(id -u):$(id -g) /app"
```

> Per operazioni che richiedono Prisma/pg/AWS/OpenSSL usa l'immagine completa
> `node:20.11.0-bookworm` (non la `-slim`). Il `chown` finale ripristina la
> proprietà dei file creati dal container (girano come root).

### E2E frontend (Playwright)

```bash
npm run build --workspace @scorm/web   # builda prima la UI
docker run --rm -v "$PWD":/app -w /app/apps/web \
  mcr.microsoft.com/playwright:v1.44.0-jammy \
  bash -lc "npx playwright test"
```

---

## 7. Risoluzione problemi comuni

- **Il frontend non vede le nuove `NEXT_PUBLIC_*`** → sono inlined al build:
  ri-esegui `npm run build --workspace @scorm/web`.
- **401 dall'API in dev** → verifica `AUTH_PROVIDER=dev` e che il web usi
  `NEXT_PUBLIC_API_MODE=real` con `NEXT_PUBLIC_API_URL` corretto.
- **CORS bloccato** → `CORS_ORIGINS` deve includere l'origine esatta del web
  (schema+host+porta), es. `http://localhost:3100`.
- **OIDC/Cognito: token rifiutato** → controlla `OIDC_TOKEN_USE=access`,
  `OIDC_AUDIENCE` = Client ID, e che l'utente abbia `custom:tenant_id` valorizzato.
- **Ricerca vettoriale incoerente dopo switch a Bedrock** → `EMBEDDINGS_DIMENSIONS`
  non allineato al modello: correggi e rigenera gli embeddings.
- **`scorm-generator_default` network non trovata** → è creata al primo
  `docker compose up`; avvia prima l'infra. Verifica il nome con `docker network ls`.
