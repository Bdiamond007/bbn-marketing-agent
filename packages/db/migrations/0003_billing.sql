-- 0003_billing — ingestion durable des webhooks de paiement et projection idempotente (E07).

ALTER TABLE subscriptions
  ADD COLUMN provider_customer_ref text,
  -- Horodatage fournisseur du dernier état appliqué : un événement plus ancien n'écrase jamais un plus récent.
  ADD COLUMN provider_updated_at timestamptz,
  ADD COLUMN grace_due_at timestamptz,
  ADD COLUMN scheduled_plan_code text,
  ADD COLUMN scheduled_plan_version integer,
  ADD CONSTRAINT subscriptions_scheduled_plan_fk FOREIGN KEY (scheduled_plan_code, scheduled_plan_version) REFERENCES plans (code, version);

-- Projection idempotente des droits : une seule ligne par (cycle, clé, origine).
CREATE UNIQUE INDEX entitlements_cycle_key_source_uq ON entitlements (cycle_id, key, source);

-- Corps de l'événement conservé pour la projection asynchrone (rétention à définir en E21).
ALTER TABLE webhook_events
  ADD COLUMN payload jsonb,
  ADD COLUMN attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN last_error text,
  ADD COLUMN organization_id uuid;
ALTER TABLE webhook_events ALTER COLUMN payload_ref DROP NOT NULL;
CREATE INDEX webhook_events_pending_idx ON webhook_events (received_at) WHERE status = 'received';

-- La RLS étant forcée y compris pour le propriétaire, accès explicite du seul rôle propriétaire
-- (utilisé par les fonctions SECURITY DEFINER ci-dessous). Le runtime n'a toujours aucun accès direct.
CREATE POLICY webhook_events_definer ON webhook_events FOR ALL TO bbn_migrator USING (true) WITH CHECK (true);

-- Enregistre un événement vérifié ; renvoie false s'il était déjà connu (doublon).
CREATE FUNCTION billing_record_webhook(p_provider text, p_event_id text, p_type text, p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE inserted integer;
BEGIN
  INSERT INTO webhook_events (provider, external_event_id, event_type, payload, payload_ref)
  VALUES (p_provider, p_event_id, p_type, p_payload, 'inline')
  ON CONFLICT (provider, external_event_id) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted = 1;
END $$;

-- Événements en attente de projection (traités dans l'ordre de réception ; la projection est idempotente).
CREATE FUNCTION billing_pending_webhooks(p_limit integer)
RETURNS TABLE (id uuid, event_type text, payload jsonb, attempts integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT id, event_type, payload, attempts FROM webhook_events
   WHERE provider = 'stripe' AND status = 'received' AND attempts < 10
   ORDER BY received_at LIMIT least(greatest(p_limit, 1), 100)
$$;

CREATE FUNCTION billing_mark_webhook(p_id uuid, p_status text, p_error text, p_organization_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  UPDATE webhook_events
     SET status = CASE WHEN p_status IN ('processed', 'ignored', 'failed', 'received') THEN p_status ELSE status END,
         processed_at = CASE WHEN p_status IN ('processed', 'ignored') THEN now() ELSE processed_at END,
         attempts = attempts + CASE WHEN p_status = 'received' THEN 1 ELSE 0 END,
         last_error = left(p_error, 200),
         organization_id = coalesce(p_organization_id, organization_id)
   WHERE id = p_id
$$;

-- Résolution abonnement fournisseur → organisation (avant de connaître le tenant).
CREATE POLICY subscriptions_definer_read ON subscriptions FOR SELECT TO bbn_migrator USING (true);
CREATE FUNCTION billing_org_by_subscription(p_external_id text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT organization_id FROM subscriptions WHERE external_id = p_external_id $$;

-- Abonnements à réconcilier périodiquement (identifiants seulement).
CREATE FUNCTION billing_subscriptions_to_reconcile(p_limit integer)
RETURNS TABLE (organization_id uuid, external_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT organization_id, external_id FROM subscriptions
   WHERE external_id IS NOT NULL AND status IN ('incomplete', 'active', 'past_due', 'suspended')
   ORDER BY coalesce(provider_updated_at, created_at) LIMIT least(greatest(p_limit, 1), 500)
$$;

REVOKE ALL ON FUNCTION billing_record_webhook(text, text, text, jsonb), billing_pending_webhooks(integer),
  billing_mark_webhook(uuid, text, text, uuid), billing_org_by_subscription(text), billing_subscriptions_to_reconcile(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION billing_record_webhook(text, text, text, jsonb), billing_pending_webhooks(integer),
  billing_mark_webhook(uuid, text, text, uuid), billing_org_by_subscription(text), billing_subscriptions_to_reconcile(integer) TO bbn_app;

-- Plans de référence v1 (ADR-0002 accepté ; montants provisoires à confirmer au pilote).
-- Toute évolution de prix ou de droits = nouvelle version, jamais une modification en place.
INSERT INTO plans (code, version, price_minor, currency, entitlements_json) VALUES
  ('essentiel', 1, 9900, 'CAD', '{"brands":1,"users":2,"content_items":15,"publications":45,"social_accounts":3,"regenerations_per_item":3}'),
  ('croissance', 1, 17900, 'CAD', '{"brands":1,"users":5,"content_items":30,"publications":90,"social_accounts":3,"regenerations_per_item":3}'),
  ('accompagne', 1, 39900, 'CAD', '{"brands":1,"users":5,"content_items":15,"publications":45,"social_accounts":3,"regenerations_per_item":3,"internal_review":true,"grouped_correction_rounds":1,"ops_minutes_target":120}')
ON CONFLICT (code, version) DO NOTHING;
