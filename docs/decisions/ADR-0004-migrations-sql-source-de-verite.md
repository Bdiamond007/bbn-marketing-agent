# ADR-0004 — Migrations SQL versionnées, source de vérité ; Drizzle pour le typage

- Date : 2026-11-11
- Propriétaire : lead technique
- Statut : **Accepté**

## Contexte

Le schéma repose sur des éléments que les générateurs ORM gèrent mal : RLS forcée et politiques, FK composites, contraintes d'exclusion, triggers d'immuabilité, contraintes différées. Constat en E04 : `drizzle-kit pull` 0.31 réordonne mal les colonnes des FK composites et produit un cycle de types (`content_variants` ↔ `revisions`).

## Options

1. Schéma Drizzle comme source, migrations générées par drizzle-kit.
2. SQL écrit à la main comme source ; schéma Drizzle régénéré par introspection pour le typage.

## Décision

Option 2.

- `packages/db/migrations/NNNN_nom.sql`, appliquées dans l'ordre par `runMigrations()` (une transaction par fichier, verrou consultatif, table `schema_migrations` avec somme de contrôle). **Une migration appliquée est immuable** : modification ⇒ échec explicite.
- `src/schema.ts` est **généré** (`pnpm --filter @bbn/db db:introspect`) puis post-traité (suppression des FK/politiques/checks, qui restent dans le SQL et sont testées en base).
- Évolutions en **expand → migrate → contract** (§14) ; pas de migration destructive sans plan écrit et accord.
- Retour arrière : rollback applicatif sans restauration destructive ; une migration de contraction n'est livrée qu'après qu'aucune version déployée n'utilise plus l'ancien schéma.

## Conséquences

- Revue SQL obligatoire sur toute PR qui ajoute une migration.
- Après chaque nouvelle migration : régénérer `schema.ts` et relancer `pnpm test:db`.
- 0001 a été corrigée avant toute publication (politique d'écriture des plans pour le rôle de migration) ; à partir du premier commit, toute correction passe par une nouvelle migration.
