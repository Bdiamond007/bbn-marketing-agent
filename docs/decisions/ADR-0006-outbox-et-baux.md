# ADR-0006 — Outbox transactionnelle, baux et consommateurs idempotents

- Date : 2026-11-11
- Propriétaire : lead technique
- Statut : **Accepté (local)**

## Contexte

§9 et §11 imposent une outbox transactionnelle, une file livrée au moins une fois, des consommateurs idempotents, un dispatcher à la minute avec sélection `SKIP LOCKED` et des baux expirants. Aucun « exactly once » ne doit être promis. L'isolation (ADR-0003) interdit au runtime de lire plusieurs tenants directement.

## Décision

- **Outbox** : `outbox_events` est écrite par `INSERT` dans la transaction métier, avec une clé de déduplication facultative par organisation. Le runtime n'a ni `UPDATE` ni `DELETE` sur cette table.
- **Relais inter-tenant** : des fonctions `SECURITY DEFINER` minimales.
  - `outbox_claim` : `FOR UPDATE SKIP LOCKED`, bail `locked_until`, compteur de tentatives.
  - `outbox_mark_dispatched` : n'aboutit que si le relais détient encore le bail.
  - `outbox_mark_failed` : backoff exponentiel avec aléa ; état « mort » après 10 tentatives.
  - L'heure est fournie par l'application (`p_now`), ce qui la rend testable et cohérente avec l'horloge injectée.
- **Envoi** : la clé de déduplication de la file est l'id d'outbox.
- **Consommation** : `consumer_inbox(consumer, message_key)` est insérée dans la même transaction tenant que l'effet ; un doublon est acquitté sans effet. Un handler en échec annule la transaction (inbox comprise) et laisse la file relivrer, puis passer en DLQ.
- **Organisation explicite** : chaque enveloppe porte `organizationId`, revalidé ; une enveloppe invalide est rejetée.

## Conséquences

- Pas de perte : un crash du relais n'aboutit qu'à un renvoi après expiration du bail.
- Doublons attendus et absorbés par l'inbox.
- Les fonctions de relais sont le seul accès inter-tenant aux événements ; elles ne renvoient que l'enveloppe nécessaire.
- Exploitation : runbook `docs/runbooks/outbox-et-dlq.md`, métriques `outbox_stats`.
