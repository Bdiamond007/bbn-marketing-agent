# Décisions d'architecture (ADR)

Format (§19) : contexte, options, décision, conséquences, date, propriétaire, statut.

| ADR | Sujet | Statut | Lot |
|---|---|---|---|
| [ADR-0001](ADR-0001-stack-et-versions.md) | Stack et versions figées | Accepté (local) | E00/E01 |
| [ADR-0002](ADR-0002-unites-quotas-et-cycles.md) | Unités de quota, cycles, ledger | Accepté (propriétaire, 2026-11-11) | E00/E08 |
| [ADR-0003](ADR-0003-isolation-rls-et-contexte.md) | Isolation : RLS forcée, FK composites, contexte transactionnel | Accepté | E04 |
| [ADR-0004](ADR-0004-migrations-sql-source-de-verite.md) | Migrations SQL source de vérité, Drizzle pour le typage | Accepté | E04 |
| [ADR-0005](ADR-0005-sessions-et-authentification.md) | Sessions serveur et authentification | Accepté (local ; Cognito à prouver) | E05 |
| [ADR-0006](ADR-0006-outbox-et-baux.md) | Outbox transactionnelle, baux, consommateurs idempotents | Accepté (local) | E12 |

## ADR requis restant à rédiger (§19)

| Sujet | Lot de rédaction |
|---|---|
| Hash d'approbation (version du hash, invalidation, déplacement horaire) | E15 |
| Période acquise et programmation (DST, fuseaux) | E16 |
| Parcours Meta prouvé | E03/E17 (après spike réel) |
| LinkedIn (accès, flag) | E03/E19 |
| Régions et sous-traitants | E23 |
| Rétention et suppression | E21 |
| Prix et économie | E07/E24 (propriétaire) |
| Kill switch global et par réseau | E18 |
