# Vue d'architecture (état au 2026-11-11)

Monolithe modulaire TypeScript ; web et worker déployables séparément (§9).

```
navigateur ──► apps/web (Next.js) ──► PostgreSQL (RLS forcée) + outbox
                                         │
                                outbox ──► file (SQS / simulateur) ──► apps/worker
                                                                         ├─► IA (OpenAI / simulateur)
                                                                         ├─► rendu de modèles (E14)
                                                                         ├─► réseaux sociaux (Meta/LinkedIn / simulateur)
                                                                         └─► email (SES / simulateur)
Stripe ──► webhook signé ──► événement durable ──► worker de projection (E07)
```

## Implémenté

| Élément | Où | Preuve |
|---|---|---|
| Validation d'environnement, fake refusé en staging/production, live incomplet explicite | `packages/config` | tests unitaires ; démarrage réel web/worker refusé (rapport E02) |
| Interfaces fournisseurs : stockage, file, email, paiements, IA, réseaux, OAuth | `packages/integrations/src/*.ts` | contrats `src/contracts/` |
| Simulateurs déterministes (succès, échec, timeout, unknown, doublon, DLQ) | `packages/integrations/src/fakes/` | `fakes.test.ts`, `fakes.contract.test.ts` |
| Identité simulée (vérification, récupération à usage unique) | `packages/auth` | `fake-identity.test.ts` |
| Schéma complet §10, RLS forcée, FK composites, invariants SQL | `packages/db/migrations/0001_init.sql` | `isolation.db.test.ts` (26 tests SQL réels) |
| Contexte tenant transactionnel (`withTenant`, `withUser`) | `packages/db/src/tenant.ts` | idem |
| Empreinte de révision canonique | `packages/domain/src/revision-hash.ts` | tests unitaires + trigger SQL |
| Consommateur de file (au moins une fois, org explicite, DLQ) | `apps/worker/src/consumer.ts` | tests unitaires |
| Pages /fr et /en localisées, hreflang, bannière de simulation | `apps/web` | Playwright (desktop + 375 px) |

## Pas encore implémenté

Routes `/api/v1`, moteur de droits RBAC, sessions, quotas transactionnels, outbox/dispatcher, publication, IA réelle, rendu, facturation, notifications, console interne, export/suppression, Terraform. Voir `docs/execution/status.md`.

## Modules prévus (§9)

identity, organizations, brands, assets, content, approvals, publishing, integrations, billing, entitlements, notifications, production, reporting, audit, privacy — chacun ajouté avec son lot, ses migrations et ses tests.
