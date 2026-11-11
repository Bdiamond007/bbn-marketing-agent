#!/usr/bin/env bash
# Régénère src/schema.ts depuis une base migrée (SQL = source de vérité, ADR-0004).
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm exec drizzle-kit pull
pnpm exec tsx scripts/postprocess-schema.ts .drizzle-introspect/schema.ts src/schema.ts
echo "src/schema.ts régénéré."
