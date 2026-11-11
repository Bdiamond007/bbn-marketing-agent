# [Brand Name] — SaaS social FR/EN

Application web multi-entreprises pour préparer, approuver, programmer et publier des contenus sociaux en français et en anglais (marché pilote canadien). Spécification contractuelle : [`SPECIFICATION.md`](SPECIFICATION.md). Avancement : [`docs/execution/status.md`](docs/execution/status.md).

> **État : en construction.** Lots réalisés localement : E00 (contrat/backlog), E01 (monorepo), E02 (simulateurs), E04 (base et isolation). Aucune intégration réelle (Meta, LinkedIn, Stripe, AWS, IA) n'est implémentée ni prouvée ; tout fonctionne avec des **simulateurs déterministes**, clairement étiquetés.

## Prérequis

- Node.js 22 LTS (`.nvmrc`) et pnpm 10.28 (`corepack enable` ou installation directe)
- PostgreSQL 16 pour `test:db` / `db:*` : soit `pnpm pg:local` (binaires PostgreSQL installés, sans Docker), soit `pnpm dev:infra` (Docker Compose)
- Aucun secret ni compte cloud n'est nécessaire en local

## Démarrage

```bash
pnpm install --frozen-lockfile
cp .env.example .env           # valeurs locales, aucune valeur réelle

pnpm pg:local                  # ou : pnpm dev:infra
pnpm db:bootstrap              # rôles bbn_migrator / bbn_app + base « bbn »
pnpm db:migrate
pnpm db:seed                   # données FICTIVES (organisations A et B)

pnpm dev                       # http://localhost:3000 → /fr ou /en
pnpm dev:worker                # worker (simulateurs)
```

Variables chargées depuis l'environnement du shell (exportez celles de `.env`, ou utilisez un outil comme `direnv`). Sans `APP_ENV`, `APP_BASE_URL`, `ADAPTER_MODE`, `AUTH_MODE`, le web et le worker refusent de démarrer.

## Commandes de qualité

| Commande | Rôle |
|---|---|
| `pnpm lint` | ESLint (0 avertissement toléré) |
| `pnpm typecheck` | TypeScript strict, tous les paquets |
| `pnpm test` | tests unitaires (Vitest) |
| `pnpm test:contracts` | contrats des adaptateurs fournisseurs (exécutés sur les simulateurs) |
| `pnpm test:db` | tests SQL réels : RLS, FK composites, invariants (base jetable `bbn_test`) |
| `pnpm i18n:check` | parité des catalogues fr-CA / en-CA (clés, placeholders, valeurs vides) |
| `pnpm build` | build Next.js + bundle du worker |
| `pnpm test:e2e` | Playwright (après `pnpm build`) : desktop et mobile 375 px |
| `pnpm check` | lint + types + unitaires + contrats + i18n |

`test:db` échoue (et ne se saute jamais) si PostgreSQL est injoignable : un test non exécuté n'est pas un succès.

## Structure

```
apps/web            Next.js (App Router, next-intl, /fr et /en)
apps/worker         consommateurs de files (au moins une fois, idempotents)
packages/config     validation d'environnement ; fake interdit en staging/production
packages/domain     règles métier pures (horloge, empreinte de révision…)
packages/db         migrations SQL, RLS, contexte tenant, seed fictif
packages/integrations  interfaces fournisseurs + simulateurs + contrats
packages/auth       fournisseur d'identité (simulateur ; Cognito en E05)
packages/i18n       catalogues fr-CA / en-CA et vérification de parité
packages/ui         tokens noir/blanc/or, contrôle de contraste
packages/observability  logger JSON expurgé
packages/test-utils base de test jetable pour test:db
docs/               ADR, exigences, traçabilité, rapports d'exécution
```

## Garde-fous

Pas de localStorage comme base métier, pas de secret `NEXT_PUBLIC_*`, pas d'approbation booléenne sans version, pas de publication depuis le navigateur, pas de renvoi aveugle après timeout, pas de tenant client accepté comme permission, pas de faux témoignages/compteurs, pas de données réelles dans les seeds (SPECIFICATION §17). Aucune dépense, publication, paiement ou déploiement réel sans autorisation explicite.

## Prototype existant

`index.html` (prototype statique antérieur) et `wrangler.jsonc` (déploiement Cloudflare Workers) sont conservés tels quels. `.assetsignore` limite les fichiers servis par Cloudflare à ce prototype.
