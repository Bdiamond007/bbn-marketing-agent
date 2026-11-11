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
| E06 | UI, traduction et navigation | NOT_STARTED | — | — | — | E01/E05 | Prochain lot éligible. Socle présent : catalogues fr-CA/en-CA + `i18n:check`, tokens + test de contraste, pages /fr /en |
| E07 | Abonnement et droits | NOT_STARTED | — | — | — | E04/E05/E06 | Schéma posé (E04) ; simulateur de paiements signé (E02) |
| E08 | Quotas et ledger | NOT_STARTED | — | — | — | E04/E07 | Schéma posé (E04) ; ADR-0002 accepté |
| E09 | Onboarding et profil | NOT_STARTED | — | — | — | E05/E06/E08 | |
| E10 | Médias privés | NOT_STARTED | — | — | — | E04/E06/E09 | |
| E11 | Contenus et révisions | NOT_STARTED | — | — | — | E04/E06/E09/E10 | |
| E12 | Outbox et workers | NOT_STARTED | — | — | — | E02/E04/E08 | Consommateur de file de base présent (E02) |
| E13 | IA et évaluations | NOT_STARTED | — | — | — | E08/E09/E11/E12 | |
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
