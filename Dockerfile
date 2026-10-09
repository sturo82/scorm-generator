# Dockerfile multi-stage per build di produzione dell'API.
# Immagini pinnate, utente non-root nello stage finale.

# ---- Base ----
FROM node:20.11.0-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# ---- Dependencies (incluse dev, per build) ----
FROM base AS deps
ENV NODE_ENV=development
COPY package.json package-lock.json* ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/domain/package.json packages/domain/
COPY packages/adapters/package.json packages/adapters/
COPY packages/scorm/package.json packages/scorm/
COPY apps/api/package.json apps/api/
RUN npm ci

# ---- Build ----
FROM deps AS build
COPY . .
# Genera il client Prisma prima della compilazione TypeScript.
RUN npx --workspace @scorm/api prisma generate --schema apps/api/prisma/schema.prisma
RUN npm run build

# ---- Runtime (solo dipendenze di produzione) ----
FROM base AS runtime
ENV NODE_ENV=production
# Prisma richiede OpenSSL a runtime.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
# Utente non-root
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs appuser
COPY package.json package-lock.json* ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/domain/package.json packages/domain/
COPY packages/adapters/package.json packages/adapters/
COPY packages/scorm/package.json packages/scorm/
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/packages/domain/dist packages/domain/dist
COPY --from=build /app/packages/adapters/dist packages/adapters/dist
COPY --from=build /app/packages/scorm/dist packages/scorm/dist
COPY --from=build /app/apps/api/dist apps/api/dist
# Client Prisma generato (engine + client).
COPY --from=build /app/node_modules/.prisma node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/client node_modules/@prisma/client
USER appuser
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]

# ---- Migrate (task one-off per le migrazioni Prisma) ----
# Immagine separata con TUTTE le dipendenze (incluso il Prisma CLI, dev-dep) e
# lo schema+migrazioni, da eseguire come ECS task one-off PRIMA del deploy
# dell'API: applica le migrazioni in modo idempotente e non interattivo.
# Build: docker build --target migrate -t <repo>/scorm-migrate .
# Run:   prisma migrate deploy (vedi CMD).
FROM build AS migrate
ENV NODE_ENV=production
# Richiede DATABASE_URL a runtime (iniettata da Secrets Manager nel task ECS).
CMD ["npx", "--workspace", "@scorm/api", "prisma", "migrate", "deploy", "--schema", "apps/api/prisma/schema.prisma"]
