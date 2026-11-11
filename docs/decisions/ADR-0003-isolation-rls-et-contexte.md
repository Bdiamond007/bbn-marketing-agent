# ADR-0003 — Isolation multi-tenant : RLS forcée, FK composites, contexte transactionnel

- Date : 2026-11-11
- Propriétaire : lead technique
- Statut : **Accepté** — vérifié localement (E04, `packages/db/src/isolation.db.test.ts`)

## Contexte

L'isolation des entreprises prime en cas de conflit (§1). §10 exige : RLS en plus des contrôles applicatifs ; rôle runtime non propriétaire, sans BYPASSRLS ; `SET LOCAL` par transaction ; contexte absent = refus ; rôle de migration séparé.

## Décision

1. **Rôles** : `bbn_migrator` (propriétaire des objets, exécute les migrations) et `bbn_app` (runtime web + worker : `NOSUPERUSER NOBYPASSRLS NOINHERIT`, aucun objet possédé, ne peut pas `SET ROLE bbn_migrator`). Créés par l'administrateur (`packages/db/bootstrap/`) ; en cloud, par l'infrastructure.
2. **RLS activée et forcée** (`FORCE ROW LEVEL SECURITY`) sur toutes les tables, y compris pour le propriétaire. Politique locataire : `organization_id = app_current_org()` en lecture et en écriture (`WITH CHECK`).
3. **Contexte** : `app_current_org()` / `app_current_user()` lisent `current_setting(..., true)` ; posés uniquement via `set_config(..., true)` (équivalent `SET LOCAL`) au début de chaque transaction par `withTenant()` / `withUser()`. Valeur absente ou vide ⇒ `NULL` ⇒ aucune ligne. Un identifiant non UUID est refusé avant toute requête.
4. **Appartenance vérifiée** : `withTenant()` avec un utilisateur vérifie la membership dans la même transaction et lève `TenantAccessDenied` (refus indistinct, §11). Un `organization_id` venu du navigateur n'est jamais une preuve d'autorisation : c'est une demande, validée ici et par le moteur de droits (E05).
5. **FK composites** `(organization_id, id)` sur toutes les relations locataires : un objet de A ne peut pas référencer un objet de B, même si la RLS était contournée.
6. **Tables globales** : `users` (soi-même + membres de l'organisation du contexte), `plans` (lecture pour tous, écriture par le rôle de migration), `organizations` (contexte ou organisations dont on est membre), `webhook_events` (aucune politique ⇒ aucun accès runtime ; ingestion via fonction dédiée en E07).
7. **Jobs** : les workers ouvrent toujours un contexte d'organisation explicite (`userId: null`) ; une enveloppe de message sans `organizationId` est rejetée (`apps/worker/src/consumer.ts`). Les sélections inter-tenants nécessaires (dispatcher minute, outbox) passeront par des fonctions `SECURITY DEFINER` minimales renvoyant seulement `(id, organization_id)` — à décider en E12 (ADR outbox/leases).

## Conséquences

- Défense en profondeur : contrôle applicatif + RLS + FK composites + privilèges (révisions/ledger/audit sans UPDATE/DELETE pour le runtime).
- Les suppressions en cascade (suppression d'organisation) s'exécutent via les actions référentielles, qui ne sont pas soumises à la RLS du runtime.
- Toute nouvelle table locataire doit : porter `organization_id`, des FK composites, être ajoutée à la boucle RLS, et le test « aucune table sans RLS forcée » la vérifie automatiquement.
- Preuves : 26 tests SQL réels verts ; test de mutation (politique rendue permissive) ⇒ 5 échecs détectés (rapport E04).
