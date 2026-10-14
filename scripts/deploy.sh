#!/usr/bin/env bash
# Helper per lanciare e monitorare il deploy (GitHub Actions "deploy.yml").
# Uso: scripts/deploy.sh <trigger|status|watch|wait-api|logs|logs-failed|open> [RUN_ID]
# - i comandi su GitHub richiedono la GitHub CLI (`gh`) autenticata;
# - `wait-api` richiede AWS CLI + credenziali (lette da .env se presenti).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

WORKFLOW="deploy.yml"
BRANCH="main"
# Servizio App Runner dell'API (stesso ARN usato in produzione).
API_ARN="arn:aws:apprunner:eu-west-1:781748773767:service/scorm-api/684950f998de485b9d3ad558c28eb417"
AWS_REGION_DEFAULT="eu-west-1"

cmd="${1:-status}"
shift || true

# gh serve a tutti i comandi tranne wait-api.
if [ "$cmd" != "wait-api" ] && ! command -v gh >/dev/null 2>&1; then
  echo "gh (GitHub CLI) non trovato. Installa: https://cli.github.com/" >&2
  exit 1
fi

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

  # Attende che l'API su App Runner torni RUNNING dopo un deploy. GitHub segna
  # il job "finito" appena AVVIA il deploy (start-deployment è asincrono): App
  # Runner impiega altri minuti a tirare l'immagine e passare l'health check.
  # Questo comando fa polling finché il deployment non è terminato davvero.
  wait-api)
    if ! command -v aws >/dev/null 2>&1; then
      echo "aws CLI non trovato." >&2
      exit 1
    fi
    # Credenziali: usa quelle dell'ambiente, altrimenti le legge da .env.
    if [ -z "${AWS_ACCESS_KEY_ID:-}" ] && [ -f "$ROOT/.env" ]; then
      set -a
      AWS_ACCESS_KEY_ID=$(grep -E '^AWS_ACCESS_KEY_ID=' "$ROOT/.env" | head -1 | cut -d= -f2-)
      AWS_SECRET_ACCESS_KEY=$(grep -E '^AWS_SECRET_ACCESS_KEY=' "$ROOT/.env" | head -1 | cut -d= -f2-)
      set +a
    fi
    export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-$AWS_REGION_DEFAULT}"

    # Timeout: ~12 min (36 × 20s), oltre la durata tipica di un deploy App Runner.
    max="${1:-36}"
    echo "Attendo che l'API torni RUNNING…"
    for i in $(seq 1 "$max"); do
      s=$(aws apprunner describe-service --service-arn "$API_ARN" \
            --query 'Service.Status' --output text 2>/dev/null || echo "UNKNOWN")
      printf '[%s] %s\n' "$(date +%H:%M:%S)" "$s"
      case "$s" in
        RUNNING)
          # Esito dell'ultima operazione (deployment), per confermare il successo.
          op=$(aws apprunner list-operations --service-arn "$API_ARN" --max-results 1 \
                --query 'OperationSummaryList[0].Status' --output text 2>/dev/null || echo "?")
          echo "API RUNNING (ultima operazione: $op)."
          exit 0
          ;;
        CREATE_FAILED|DELETE_FAILED|PAUSED)
          echo "Stato inatteso: $s" >&2
          exit 1
          ;;
      esac
      sleep 20
    done
    echo "Timeout: l'API non è tornata RUNNING entro l'attesa." >&2
    exit 1
    ;;

  *)
    echo "Uso: scripts/deploy.sh <trigger|status|watch|wait-api|logs|logs-failed|open> [RUN_ID]" >&2
    exit 1
    ;;
esac
