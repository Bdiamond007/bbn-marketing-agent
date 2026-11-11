# Runbook — Outbox, files et messages en échec (DLQ)

Portée : relais d'outbox (`packages/jobs`), files SQS (simulées en local), consommateurs du worker.

## Signaux à surveiller

| Signal | Source | Seuil d'alerte proposé |
|---|---|---|
| `pending` (événements non envoyés) | log `outbox_stats` / `outbox_stats()` | croissance continue sur 10 min |
| `oldest_pending_seconds` | idem | > 120 s (objectif : 99 % des dispatchs sous 2 min, §14) |
| `dead` (envois abandonnés après 10 tentatives) | idem | > 0 |
| `outbox_lease_lost` | logs du worker | répété : relais trop lent ou bail trop court |
| Profondeur de la DLQ par file | SQS (live) | > 0 |

## Diagnostiquer

1. Vérifier que le worker tourne (log `worker_started`, puis `outbox_relay` périodiques).
2. Événements « morts » : consulter `last_error` (code expurgé, jamais de secret) avec le rôle opérateur. Causes typiques : file indisponible, permissions IAM, quota SQS.
3. DLQ d'une file : lire le message (enveloppe `messageId`, `type`, `organizationId`, `correlationId`), retrouver la requête d'origine grâce au `correlationId` dans les logs web, puis lire l'erreur du handler (`handler_failed`).

## Corriger et rejouer

- Rejouer un message de la DLQ est **sûr** : les consommateurs sont idempotents (`consumer_inbox`, clé `messageId`). Un message déjà traité est acquitté sans effet.
- Événement d'outbox « mort » :
  - corriger la cause ;
  - remettre `dead_at = NULL`, `attempts = 0`, `available_at = now()` avec le rôle propriétaire (procédure tracée en audit) ;
  - le relais le reprend au cycle suivant.
- Ne jamais supprimer un événement d'outbox ni un message de DLQ sans analyse : ils prouvent qu'un effet n'a pas été appliqué.

## Garanties et non-garanties

- Garanti : un événement d'outbox existe si et seulement si la transaction métier est validée ; aucun événement n'est perdu si le relais tombe (bail expirant) ; un effet métier n'est appliqué qu'une fois par consommateur.
- Non garanti : l'unicité de livraison. Les doublons sont attendus et absorbés. Aucun « exactly once » n'est promis (§11).
