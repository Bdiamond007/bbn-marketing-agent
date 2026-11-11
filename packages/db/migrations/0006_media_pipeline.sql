-- 0006_media_pipeline — quarantaine, validation et nettoyage des médias (E10).
-- En quarantaine, l'empreinte et les dimensions ne sont pas encore connues.
ALTER TABLE media_assets ALTER COLUMN sha256 DROP NOT NULL;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_sha256_when_processed CHECK (status IN ('quarantined', 'validating', 'rejected', 'deleted') OR sha256 IS NOT NULL);
ALTER TABLE media_assets
  ADD COLUMN declared_mime text,
  ADD COLUMN quarantine_key text,
  ADD COLUMN rejected_reason text,
  ADD COLUMN processed_at timestamptz;

-- Nettoyage des téléversements abandonnés (inter-tenant) : identifiants et clés seulement.
CREATE POLICY media_assets_definer_read ON media_assets FOR SELECT TO bbn_migrator USING (true);
CREATE FUNCTION media_stale_quarantine(p_older_than timestamptz, p_limit integer)
RETURNS TABLE (id uuid, organization_id uuid, quarantine_key text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT id, organization_id, quarantine_key FROM media_assets
   WHERE status = 'quarantined' AND created_at < p_older_than
   ORDER BY created_at LIMIT least(greatest(p_limit, 1), 500)
$$;
REVOKE ALL ON FUNCTION media_stale_quarantine(timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION media_stale_quarantine(timestamptz, integer) TO bbn_app;
