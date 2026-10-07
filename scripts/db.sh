#!/usr/bin/env bash
# Helper per i comandi Prisma dentro un container Node collegato al DB di compose.
# Uso: scripts/db.sh <deploy|generate|reset|psql|studio> [args...]
# Richiede l'infra avviata: docker compose up -d db localstack
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NETWORK="scorm-generator_default"
DB_URL="postgresql://scorm:scorm_dev_password@db:5432/scorm"
IMAGE="node:20.11.0-bookworm"
SCHEMA="apps/api/prisma/schema.prisma"
UID_GID="$(id -u):$(id -g)"

run_node() {
  docker run --rm -v "$ROOT":/app -w /app \
    --network "$NETWORK" \
    -e DATABASE_URL="$DB_URL" \
    "$IMAGE" bash -lc "$1 && chown -R $UID_GID /app"
}

cmd="${1:-}"; shift || true
case "$cmd" in
  deploy)
    run_node "npx prisma generate --schema $SCHEMA && \
              npx prisma migrate deploy --schema $SCHEMA"
    ;;
  generate)
    run_node "npx prisma generate --schema $SCHEMA"
    ;;
  reset)
    run_node "npx prisma migrate reset --force --skip-generate --schema $SCHEMA"
    ;;
  psql)
    docker compose exec db psql -U scorm -d scorm "$@"
    ;;
  studio)
    docker run --rm -v "$ROOT":/app -w /app \
      --network "$NETWORK" -e DATABASE_URL="$DB_URL" -p 5555:5555 \
      "$IMAGE" bash -lc "npx prisma studio --schema $SCHEMA --port 5555 --browser none"
    ;;
  *)
    echo "Uso: scripts/db.sh <deploy|generate|reset|psql|studio>" >&2
    exit 1
    ;;
esac
