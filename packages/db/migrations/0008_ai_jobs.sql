-- 0008_ai_jobs — génération IA asynchrone, idempotente et mesurée (E13).
ALTER TABLE ai_jobs
  ADD COLUMN mode text NOT NULL DEFAULT 'initial' CHECK (mode IN ('initial', 'regenerate')),
  ADD COLUMN targets jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN idempotency_key text,
  ADD COLUMN request_fingerprint text,
  ADD COLUMN correlation_id text,
  ADD COLUMN latency_ms integer,
  ADD COLUMN results jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN created_by uuid REFERENCES users (id) ON DELETE SET NULL;
CREATE UNIQUE INDEX ai_jobs_idempotency_uq ON ai_jobs (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Jobs « running » abandonnés (worker tombé pendant l'appel IA) : identifiants seulement, pour récupération.
CREATE POLICY ai_jobs_definer_read ON ai_jobs FOR SELECT TO bbn_migrator USING (true);
CREATE FUNCTION ai_stale_jobs(p_started_before timestamptz, p_limit integer)
RETURNS TABLE (id uuid, organization_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT id, organization_id FROM ai_jobs WHERE status = 'running' AND started_at < p_started_before
   ORDER BY started_at LIMIT least(greatest(p_limit, 1), 200)
$$;
REVOKE ALL ON FUNCTION ai_stale_jobs(timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_stale_jobs(timestamptz, integer) TO bbn_app;
