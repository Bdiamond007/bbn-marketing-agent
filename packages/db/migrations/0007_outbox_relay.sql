-- 0007_outbox_relay — relais d'outbox à baux expirants et registre de consommation idempotente (E12).
ALTER TABLE outbox_events
  ADD COLUMN queue text NOT NULL DEFAULT 'generation' CHECK (queue IN ('generation', 'publishing', 'notifications', 'projections')),
  ADD COLUMN dedupe_key text,
  ADD COLUMN available_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN locked_by text,
  ADD COLUMN locked_until timestamptz,
  ADD COLUMN dead_at timestamptz,
  ADD COLUMN last_error text;
CREATE UNIQUE INDEX outbox_dedupe_uq ON outbox_events (organization_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
DROP INDEX IF EXISTS outbox_pending_idx;
CREATE INDEX outbox_pending_idx ON outbox_events (available_at) WHERE dispatched_at IS NULL AND dead_at IS NULL;

-- Registre des messages déjà traités par consommateur : inséré dans la MÊME transaction que l'effet.
CREATE TABLE consumer_inbox (
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  consumer text NOT NULL,
  message_key text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, message_key)
);
ALTER TABLE consumer_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumer_inbox FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON consumer_inbox USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
GRANT SELECT, INSERT ON consumer_inbox TO bbn_app;
-- Consultation de doublon inter-tenant impossible : la clé primaire inclut le consommateur, la RLS filtre le tenant.

-- Relais inter-tenant : seules ces fonctions voient toutes les organisations, et ne renvoient que le nécessaire.
CREATE POLICY outbox_definer ON outbox_events FOR ALL TO bbn_migrator USING (true) WITH CHECK (true);

CREATE FUNCTION outbox_claim(p_worker text, p_limit integer, p_lease_seconds integer, p_now timestamptz)
RETURNS TABLE (id uuid, organization_id uuid, type text, queue text, payload jsonb, correlation_id text, attempts integer)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  UPDATE outbox_events o
     SET locked_by = p_worker, locked_until = p_now + make_interval(secs => greatest(p_lease_seconds, 1)), attempts = o.attempts + 1
   WHERE o.id IN (
     SELECT x.id FROM outbox_events x
      WHERE x.dispatched_at IS NULL AND x.dead_at IS NULL AND x.available_at <= p_now
        AND (x.locked_until IS NULL OR x.locked_until <= p_now)
      ORDER BY x.created_at
      LIMIT least(greatest(p_limit, 1), 100)
      FOR UPDATE SKIP LOCKED)
  RETURNING o.id, o.organization_id, o.type, o.queue, o.payload, o.correlation_id, o.attempts
$$;

-- Ne marque envoyé que si le bail appartient encore à ce relais (un bail expiré repris par un autre relais l'emporte).
CREATE FUNCTION outbox_mark_dispatched(p_id uuid, p_worker text, p_now timestamptz)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE n integer;
BEGIN
  UPDATE outbox_events SET dispatched_at = p_now, locked_by = NULL, locked_until = NULL
   WHERE id = p_id AND locked_by = p_worker AND locked_until > p_now AND dispatched_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END $$;

-- Échec d'envoi : nouvelle tentative différée (backoff), ou « mort » après 10 tentatives (procédure opérateur).
CREATE FUNCTION outbox_mark_failed(p_id uuid, p_worker text, p_error text, p_retry_at timestamptz, p_max_attempts integer)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  UPDATE outbox_events
     SET locked_by = NULL, locked_until = NULL, last_error = left(p_error, 200), available_at = p_retry_at,
         dead_at = CASE WHEN attempts >= p_max_attempts THEN p_retry_at ELSE NULL END
   WHERE id = p_id AND locked_by = p_worker AND dispatched_at IS NULL
$$;

CREATE FUNCTION outbox_stats(p_now timestamptz)
RETURNS TABLE (pending bigint, dead bigint, oldest_pending_seconds double precision)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT count(*) FILTER (WHERE dispatched_at IS NULL AND dead_at IS NULL),
         count(*) FILTER (WHERE dead_at IS NOT NULL AND dispatched_at IS NULL),
         coalesce(extract(epoch FROM p_now - min(created_at) FILTER (WHERE dispatched_at IS NULL AND dead_at IS NULL)), 0)
    FROM outbox_events
$$;

REVOKE ALL ON FUNCTION outbox_claim(text, integer, integer, timestamptz), outbox_mark_dispatched(uuid, text, timestamptz),
  outbox_mark_failed(uuid, text, text, timestamptz, integer), outbox_stats(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION outbox_claim(text, integer, integer, timestamptz), outbox_mark_dispatched(uuid, text, timestamptz),
  outbox_mark_failed(uuid, text, text, timestamptz, integer), outbox_stats(timestamptz) TO bbn_app;
-- Le runtime n'écrit l'outbox que par INSERT dans ses transactions métier ; il ne la modifie ni ne la supprime.
REVOKE UPDATE, DELETE ON outbox_events FROM bbn_app;
