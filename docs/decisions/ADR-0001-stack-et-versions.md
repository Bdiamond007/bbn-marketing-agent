# ADR-0001 — Stack et versions figées

- Date : 2026-11-11
- Propriétaire : lead technique (à nommer) ; validation : propriétaire du produit
- Statut : **Accepté (périmètre local E01–E04)** — à reconfirmer avant E23

## Contexte

La spécification (§9) impose la stack et exige des « versions stables supportées figées au démarrage ; pas de preview critique ». Le dépôt contenait seulement un prototype statique (`index.html`, déployé par Cloudflare Workers) que l'on conserve intact.

## Options

1. Dernières versions majeures publiées (TypeScript 7 natif, Vitest 5, ESLint 10).
2. Versions stables éprouvées compatibles entre elles, épinglées exactement (`save-exact`).

## Décision

Option 2, versions exactes figées dans les `package.json` et `pnpm-lock.yaml` :

| Composant | Version | Remarque |
|---|---|---|
| Node.js | 22 LTS (`.nvmrc`, engines `>=22.12 <23`) | |
| pnpm | 10.28.0 (`packageManager`) | |
| TypeScript | 5.9.3 | TS 7 (compilateur natif) écarté : outillage (typescript-eslint `<6.1`) non compatible |
| Next.js / React | 16.4.6 / 19.3.1 | App Router, `proxy.ts` (ex-middleware) |
| next-intl | 4.14.10 | locales `fr-CA`/`en-CA`, préfixes `/fr` `/en` |
| Zod | 4.6.7 | |
| PostgreSQL | 16 | local : `pnpm pg:local` ou Compose `postgres:16.4-alpine` |
| pg / drizzle-orm / drizzle-kit | 8.23.1 / 0.45.4 / 0.31.11 | voir ADR-0004 |
| Vitest | 4.1.12 | projets `unit`, `contracts`, `db` |
| Playwright | 1.63.0 | aligné sur le navigateur préinstallé de l'environnement de construction |
| ESLint / typescript-eslint | 10.14.0 / 8.72.2 | ESLint 9 n'est plus supporté |
| esbuild | 0.28.2 | bundle du worker |

Ajouts au découpage §9 : `packages/config` (validation d'environnement partagée web/worker). Tailwind et Radix arrivent avec E06 (design system) ; ils ne sont pas installés tant qu'ils ne sont pas utilisés.

Services cloud (Cognito, SQS, S3, SES, KMS, Secrets Manager, Stripe, OpenAI, Sentry) : uniquement derrière des interfaces (`packages/integrations`, `packages/auth`) ; aucun SDK installé avant le lot qui l'implémente.

## Conséquences

- Mises à jour par PR dédiée, avec suite complète.
- Le prototype `index.html` reste servi par Cloudflare ; `.assetsignore` empêche de publier le code source et la documentation du dépôt comme assets statiques.
- Next.js collecte de la télémétrie anonyme par défaut : `NEXT_TELEMETRY_DISABLED=1` en CI ; à désactiver aussi en staging/production (E23).
