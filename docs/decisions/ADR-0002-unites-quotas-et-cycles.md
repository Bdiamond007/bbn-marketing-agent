# ADR-0002 — Unités de quota, cycles et ledger

- Date : 2026-11-11
- Propriétaire : propriétaire du produit (règles commerciales) ; lead technique (mise en œuvre)
- Statut : **Proposé** — règles reprises telles quelles de SPECIFICATION §3 ; prix et volumes à valider commercialement (H01, H02)

## Contexte

Les quotas sont une décision « structurante » (§1) : toute modification exige un ADR approuvé (§17). Cet ADR fixe la traduction technique des règles du §3, sans en changer le fond.

## Décision

**Unités** (`usage_reservations.type`, `usage_ledger.type`) :

- `content_item` : un sujet source (ContentItem), quel que soit le nombre de langues/réseaux.
- `publication` : l'envoi d'une révision vers un compte. 1 sujet FR × 3 réseaux = 1 contenu + 3 publications ; FR+EN séparés × 3 réseaux = 1 contenu + 6 publications. Les deux plafonds s'appliquent indépendamment.
- `regeneration` : nouvelle proposition IA réussie ; 3 par contenu (`regenerations_per_item`). Erreurs techniques non décomptées ; modifications manuelles illimitées.

**Cycle de vie d'une réservation** :

| Événement | Contenu | Publication |
|---|---|---|
| Réserver | avant le job de génération | à la programmation |
| Consommer | première proposition structurée et éditable persistée | succès confirmé (`confirmed`, ou confirmation manuelle identifiée) |
| Libérer | échec technique sans résultat exploitable | annulation certaine, ou échec terminal réconcilié |
| Conserver | — | `unknown` : réservation conservée sur le cycle initial, sans double consommation |

Retry : aucun débit supplémentaire. Lots partiels : réservation/consommation par sujet.

**Cycles** : `billing_cycles` en intervalles `[starts_at, ends_at)` UTC, sans chevauchement par organisation (contrainte d'exclusion GiST). MVP : programmation limitée à la période de droits courante connue ; brouillons futurs autorisés.

**Upgrade** : droits supplémentaires seulement après paiement confirmé (webhook), par écriture d'entitlements `source = 'upgrade_delta'` (crédit du delta, pas de réinitialisation). **Downgrade** au renouvellement. Aucun report ni dépassement payant automatique.

**Impayé** : grâce de 7 jours depuis l'échéance initiale (`grace_until` fixé une fois, jamais prolongé par une nouvelle tentative) ; pas de nouvelle génération ; seuls les contenus déjà approuvés peuvent partir si les droits le permettent.

**Ledger** : `usage_ledger` append-only (trigger anti-UPDATE ; ni UPDATE ni DELETE accordés au runtime), `dedupe_key` unique (ex. `reserve:publication:{publicationId}`), allocations verrouillées (`SELECT … FOR UPDATE` sur le cycle) avant calcul de capacité — implémentation et test « 50 demandes concurrentes sur le dernier crédit » en E08.

## Conséquences

- Schéma posé en E04 (tables, contraintes, dédoublonnage testé) ; logique transactionnelle en E08.
- Plans en base (`plans`) avec `price_minor` (centimes CAD) et `entitlements_json` ; versions immuables : un changement de prix = nouvelle version.
- Les codes de prix Checkout autorisés côté serveur sont listés dans `ALLOWED_PRICE_CODES` (provisoires).
