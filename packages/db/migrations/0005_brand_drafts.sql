-- 0005_brand_drafts — brouillon de profil reprenable, stocké côté serveur (E09).
-- Jamais de localStorage comme base métier (§17) ; concurrence optimiste par version.
CREATE TABLE brand_drafts (
  brand_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  draft_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, brand_id) REFERENCES brands (organization_id, id) ON DELETE CASCADE
);
ALTER TABLE brand_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_drafts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON brand_drafts USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
GRANT SELECT, INSERT, UPDATE ON brand_drafts TO bbn_app;
