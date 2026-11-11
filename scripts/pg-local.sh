#!/usr/bin/env bash
# Démarre un PostgreSQL 16 local (sans Docker) dans ./.pg-local, pour les tests SQL réels.
# Usage : pnpm pg:local [start|stop|status]   — port : PG_LOCAL_PORT (défaut 5432)
# Mot de passe superutilisateur local : "postgres" (développement uniquement).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/.pg-local/data"
LOG="$ROOT/.pg-local/postgres.log"
PORT="${PG_LOCAL_PORT:-5432}"
BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"

if [ -z "$BIN" ] || [ ! -x "$BIN/pg_ctl" ]; then
  echo "pg_ctl introuvable. Installez PostgreSQL 16 ou utilisez 'pnpm dev:infra' (Docker)." >&2
  exit 1
fi

# PostgreSQL refuse de tourner en root : on délègue à l'utilisateur 'postgres' si nécessaire.
run() {
  if [ "$(id -u)" = "0" ]; then
    su postgres -s /bin/bash -c "$*"
  else
    bash -c "$*"
  fi
}

cmd="${1:-start}"
case "$cmd" in
  start)
    mkdir -p "$ROOT/.pg-local"
    if [ "$(id -u)" = "0" ]; then chown -R postgres:postgres "$ROOT/.pg-local"; fi
    if [ ! -f "$DATA/PG_VERSION" ]; then
      PWFILE="$ROOT/.pg-local/pwfile"
      echo "postgres" > "$PWFILE"
      if [ "$(id -u)" = "0" ]; then chown postgres:postgres "$PWFILE"; fi
      run "'$BIN/initdb' -D '$DATA' -U postgres --pwfile='$PWFILE' --auth=scram-sha-256 --encoding=UTF8 --locale=C.UTF-8 >/dev/null"
    fi
    if run "'$BIN/pg_ctl' -D '$DATA' status" >/dev/null 2>&1; then
      echo "PostgreSQL déjà démarré (port $PORT)."
    else
      run "'$BIN/pg_ctl' -D '$DATA' -l '$LOG' -o '-p $PORT -k /tmp -c listen_addresses=localhost' -w start" >/dev/null
      echo "PostgreSQL démarré sur localhost:$PORT (données : .pg-local/)."
    fi
    echo "DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:$PORT/postgres"
    ;;
  stop)
    run "'$BIN/pg_ctl' -D '$DATA' -m fast stop" || true
    ;;
  status)
    run "'$BIN/pg_ctl' -D '$DATA' status"
    ;;
  *)
    echo "Usage: $0 [start|stop|status]" >&2
    exit 2
    ;;
esac
