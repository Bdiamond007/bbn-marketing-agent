#!/usr/bin/env bash
# Test de fumée du worker CONSTRUIT (dist/) : démarre, effectue au moins un cycle, s'arrête proprement sur SIGINT.
# Détecte les dépendances externes non résolubles et les erreurs de démarrage que les tests unitaires ne voient pas.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f dist/main.js ] || { echo "dist/main.js absent : lancer 'pnpm build' d'abord" >&2; exit 1; }
LOG="$(mktemp)"
APP_ENV=test APP_BASE_URL=http://localhost:3000 ADAPTER_MODE=fake AUTH_MODE=fake \
DATABASE_URL="${SMOKE_DATABASE_URL:-${DATABASE_URL:-postgres://bbn_app:bbn_app_dev@localhost:5432/bbn_test}}" \
  timeout -s INT 6 node dist/main.js > "$LOG" 2>&1 || true
grep -q '"msg":"worker_started"' "$LOG" || { echo "ÉCHEC : le worker n'a pas démarré" >&2; cat "$LOG" >&2; exit 1; }
grep -q '"msg":"outbox_stats"' "$LOG" || { echo "ÉCHEC : aucun cycle (base injoignable ?)" >&2; cat "$LOG" >&2; exit 1; }
grep -q '"msg":"worker_stopped"' "$LOG" || { echo "ÉCHEC : arrêt non propre" >&2; cat "$LOG" >&2; exit 1; }
if grep -q '"level":"error"' "$LOG"; then echo "ÉCHEC : erreurs pendant le cycle" >&2; grep '"level":"error"' "$LOG" >&2; exit 1; fi
echo "worker smoke OK — démarrage, cycle (relais, projection, nettoyage) et arrêt propre"
