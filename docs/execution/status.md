# Journal de statut des lots

Statuts : NOT_STARTED, IN_PROGRESS, BLOCKED_EXTERNAL, READY_FOR_REVIEW, VERIFIED_LOCAL, VERIFIED_LIVE.
Le succès sur simulateur ne prouve pas une intégration réelle. Dernière mise à jour : 2026-11-11.

| Lot | Titre | Statut | Responsable | Dernier commit | Preuve | Dépendances | Blocages / remarques |
|---|---|---|---|---|---|---|---|
| E00 | Contrat, backlog et décisions | VERIFIED_LOCAL | agent de réalisation ; validé par le propriétaire | 2304bc7 | [rapport](reports/E00_2026-11-11.md) | — | ADR-0002 accepté et accès support 72 h validé (2026-11-11) |
| E01 | Monorepo et qualité de base | VERIFIED_LOCAL | agent de réalisation | 2304bc7 | [rapport](reports/E01_2026-11-11.md) | E00 | CI GitHub Actions écrite, non exécutée (NOT_RUN) |
| E02 | Local et simulateurs | READY_FOR_REVIEW | agent de réalisation | 2304bc7 | [rapport](reports/E02_2026-11-11.md) | E01 | Docker Compose NOT_RUN (pas de démon Docker) ; PostgreSQL validé via `pnpm pg:local` |
| E03 | Spikes sociaux et approbations | BLOCKED_EXTERNAL | propriétaire | — | — | E00/E02 | Aucune application développeur Meta/LinkedIn ni identifiant autorisé fourni |
| E04 | Base, migrations et isolation | VERIFIED_LOCAL | agent de réalisation | 2304bc7 | [rapport](reports/E04_2026-11-11.md) | E01/E02 | Gate isolation franchi localement ; CI non exécutée |
| E05 | Auth, équipe et RBAC | VERIFIED_LOCAL | agent de réalisation | 50293ec | [rapport](reports/E05_2026-11-11.md) | E04 | Cognito BLOCKED_EXTERNAL (aucun compte AWS) ; limites de débit en mémoire |
| E06 | UI, traduction et navigation | VERIFIED_LOCAL | agent de réalisation | 7fba1ba | [rapport](reports/E06_2026-11-11.md) | E01/E05 | Revue manuelle lecteur d'écran et appareils réels à faire (E22) |
| E07 | Abonnement et droits | VERIFIED_LOCAL | agent de réalisation | 73751d7 | [rapport](reports/E07_2026-11-11.md) | E04/E05/E06 | Stripe réel BLOCKED_EXTERNAL (aucun compte) ; taxes non traitées |
| E08 | Quotas et ledger | VERIFIED_LOCAL | agent de réalisation | edfbadf | [rapport](reports/E08_2026-11-11.md) | E04/E07 | Droits utilisateurs/comptes/marques appliqués en E09/E17 |
| E09 | Onboarding et profil | VERIFIED_LOCAL | agent de réalisation | 3c08f55 | [rapport](reports/E09_2026-11-11.md) | E05/E06/E08 | Logo associé en E10 |
| E10 | Médias privés | VERIFIED_LOCAL | agent de réalisation | bd8b57b | [rapport](reports/E10_2026-11-11.md) | E04/E06/E09 | S3 et antivirus réels non implémentés (E23) |
| E11 | Contenus et révisions | VERIFIED_LOCAL | agent de réalisation | 0e34b39 | [rapport](reports/E11_2026-11-11.md) | E04/E06/E09/E10 | Aperçu par modèle en E14 |
| E12 | Outbox et workers | VERIFIED_LOCAL | agent de réalisation | 4bdf565 | [rapport](reports/E12_2026-11-11.md) | E02/E04/E08 | SQS réel en E23 ; ADR-0006 |
| E13 | IA et évaluations | NOT_STARTED | — | — | — | E08/E09/E11/E12 | Prochain lot éligible |
| E14 | Templates et rendu | NOT_STARTED | — | — | — | E10/E11/E12 | |
| E15 | Approbation et production | NOT_STARTED | — | — | — | E05/E11/E13/E14 | Empreinte de révision + trigger SQL présents (E04) |
| E16 | Calendrier et programmation | NOT_STARTED | — | — | — | E08/E11/E15 | |
| E17 | Meta et reconnexion | NOT_STARTED | — | — | — | E03 Meta prouvé, E10/E12/E16 | Dépend d'E03 (BLOCKED_EXTERNAL) |
| E18 | Publication fiable | NOT_STARTED | — | — | — | E12/E15/E16/E17 | |
| E19 | LinkedIn et export manuel | NOT_STARTED | — | — | — | E18 ; E03 LinkedIn | |
| E20 | Rapports, support et administration | NOT_STARTED | — | — | — | E05/E15/E18 | |
| E21 | Export, suppression et rétention | NOT_STARTED | — | — | — | E10/E12/E18/E20 | |
| E22 | Durcissement et recette | NOT_STARTED | — | — | — | E06–E21 | |
| E23 | Staging, CI/CD et restauration | NOT_STARTED | — | — | — | E22, budget | Nécessite comptes et budget autorisés |
| E24 | Pilote et livraison | NOT_STARTED | — | — | — | E23, contrats | |

## Gates

| Gate | État |
|---|---|
| A — Local | Non atteint : isolation prouvée ; quotas, approbation de bout en bout, parcours FR/EN complet et export manuel restent à faire |
| B — Staging | Non commencé |
| C — Pilote | Non commencé |
| D — Public | Non commencé |
