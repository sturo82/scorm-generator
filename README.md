# SCORM Course Generator

SaaS multi-tenant per generare corsi e-learning SCORM con l'ausilio di AI (Amazon
Bedrock dietro astrazioni provider-agnostiche), knowledge base RAG, lezioni e test
interattivi, branding multiplo e revisione human-in-the-loop.

La specifica completa (requisiti, design, piano) è in
[`.kiro/specs/scorm-course-generator/`](.kiro/specs/scorm-course-generator/).

## Struttura del monorepo

```
apps/
  api/        # Backend (NestJS) — API, dominio, orchestrazione job
  web/        # Frontend (Next.js) — editor HITL e gestione corsi
packages/
  contracts/  # Tipi condivisi e JSON Schema dei contenuti
  domain/     # Porte provider-agnostiche e logica di dominio
  scorm/      # Generazione manifest e packaging SCORM
infra/
  db/init/    # Script di init del database (estensione pgvector)
```

## Prerequisiti

- Docker (unico requisito obbligatorio sulla macchina host).
- Node.js 20.11.0 **solo** se si sviluppa senza Dev Container (vedi `.nvmrc`).

## Avvio ambiente di sviluppo

### Opzione consigliata: Dev Container

Apri il progetto nel Dev Container dall'editor (estensione Dev Containers). Il
container monta il workspace, installa le dipendenze e si collega a Postgres+pgvector
e MinIO definiti in `docker-compose.yml`.

### Infrastruttura (Postgres + LocalStack)

```bash
docker compose up -d db localstack
```

- Postgres (con pgvector): `localhost:5432` — db `scorm`, utente `scorm`.
- LocalStack (AWS emulato, S3): endpoint `localhost:4566`.

> Le credenziali in `docker-compose.yml` sono solo per lo sviluppo locale.

## Guida operativa (env, start/stop, database)

Per la configurazione delle variabili d'ambiente in **dev** e **prod** (incluso
Amazon Cognito), i comandi di **start/stop** dello stack e la **gestione del
database** (migrazioni e reset/clean), vedi [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

## Comandi (eseguiti in ambiente con Node)

```bash
npm install        # installa le dipendenze del monorepo
npm run build      # build di tutti i workspace
npm test           # esegue i test (Vitest)
npm run typecheck  # type-check dei project reference
npm run lint       # lint
npm run format     # formattazione
```

### Eseguire build/test senza Node installato sull'host

Finché non si usa il Dev Container, si può usare un container Node ufficiale:

```bash
docker run --rm -v "$PWD":/app -w /app node:20.11.0-bookworm-slim \
  bash -lc "npm install && npm run build && npm test"
```

## Stato

In sviluppo incrementale secondo
[`tasks.md`](.kiro/specs/scorm-course-generator/tasks.md). Fase corrente: fondamenta
del progetto (monorepo, toolchain, Docker/DevContainer).
