-- 0004_quota_regenerations — régénérations comptées par contenu (E08, ADR-0002).
ALTER TABLE usage_reservations ADD COLUMN parent_resource_id uuid;
ALTER TABLE usage_reservations ADD CONSTRAINT usage_reservations_regeneration_parent_ck
  CHECK (type <> 'regeneration' OR parent_resource_id IS NOT NULL);
CREATE INDEX usage_reservations_parent_idx ON usage_reservations (parent_resource_id, type, status) WHERE parent_resource_id IS NOT NULL;
-- Les réservations ne sont jamais supprimées par le runtime : l'historique reste cohérent avec le ledger.
REVOKE DELETE ON usage_reservations FROM bbn_app;
