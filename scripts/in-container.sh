#!/usr/bin/env bash
# Esegue build/test del monorepo in un container Node (quando Node non è sull'host).
# Uso: scripts/in-container.sh [comando npm...]   (default: install + build + test)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

IMAGE="node:20.11.0-bookworm-slim"
UID_GID="$(id -u):$(id -g)"
INNER="${*:-npm install && npm run build && npm test}"

docker run --rm -v "$ROOT":/app -w /app "$IMAGE" \
  bash -lc "$INNER && chown -R $UID_GID /app"
