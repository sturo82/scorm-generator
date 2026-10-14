#!/usr/bin/env bash
# Helper per lanciare e monitorare il deploy (GitHub Actions "deploy.yml").
# Uso: scripts/deploy.sh <trigger|status|watch|logs|logs-failed|open> [RUN_ID]
# Richiede la GitHub CLI (`gh`) autenticata: gh auth status
set -euo pipefail

WORKFLOW="deploy.yml"
BRANCH="main"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh (GitHub CLI) non trovato. Installa: https://cli.github.com/" >&2
  exit 1
fi

cmd="${1:-status}"
shift || true

case "$cmd" in
  # Lancia il deploy SENZA fare un commit (workflow_dispatch). Il deploy parte
  # comunque anche con un semplice `git push origin main`.
  trigger)
    echo "Avvio deploy manuale su $BRANCH…"
    gh workflow run "$WORKFLOW" --ref "$BRANCH"
    sleep 3
    gh run list --workflow "$WORKFLOW" --limit 1
    ;;

  # Elenco degli ultimi run (stato, durata, chi/che commit).
  status)
    gh run list --workflow "$WORKFLOW" --limit "${1:-5}"
    ;;

  # Segue in diretta l'ultimo run (log live finché non termina).
  watch)
    RID="${1:-$(gh run list --workflow "$WORKFLOW" --limit 1 --json databaseId --jq '.[0].databaseId')}"
    echo "Watch run $RID…"
    gh run watch "$RID" --exit-status
    ;;

  # Log completi di un run (default: l'ultimo).
  logs)
    RID="${1:-$(gh run list --workflow "$WORKFLOW" --limit 1 --json databaseId --jq '.[0].databaseId')}"
    gh run view "$RID" --log
    ;;

  # Solo gli step falliti (diagnosi rapida).
  logs-failed)
    RID="${1:-$(gh run list --workflow "$WORKFLOW" --limit 1 --json databaseId --jq '.[0].databaseId')}"
    gh run view "$RID" --log-failed
    ;;

  # Apre l'ultimo run nel browser.
  open)
    RID="${1:-$(gh run list --workflow "$WORKFLOW" --limit 1 --json databaseId --jq '.[0].databaseId')}"
    gh run view "$RID" --web
    ;;

  *)
    echo "Uso: scripts/deploy.sh <trigger|status|watch|logs|logs-failed|open> [RUN_ID]" >&2
    exit 1
    ;;
esac
