-- 0001_init — schéma initial, isolation multi-tenant (E04).
-- Exécuté par bbn_migrator (propriétaire). Le runtime bbn_app n'est jamais propriétaire et n'a pas BYPASSRLS.
-- Conventions : UUID, timestamptz, organization_id sur toute donnée locataire,
-- FK composites (organization_id, id) empêchant tout lien inter-tenant, montants en unités mineures.

-- ─────────────────────────────────────────────────────────────────────────────
-- Contexte transactionnel (SET LOCAL via set_config(..., true)). Absent ⇒ NULL ⇒ refus.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION app_current_org() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.organization_id', true), '')::uuid $$;

CREATE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE FUNCTION forbid_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'immutable_row: % est immuable', TG_TABLE_NAME USING ERRCODE = 'P0001';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Identité et organisations
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  default_locale text NOT NULL CHECK (default_locale IN ('fr-CA', 'en-CA')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'pending_deletion')),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_subject text NOT NULL UNIQUE,
  email text NOT NULL CHECK (email = lower(email) AND position('@' IN email) > 1),
  email_verified_at timestamptz,
  ui_locale text NOT NULL CHECK (ui_locale IN ('fr-CA', 'en-CA')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_active_uq ON users (email) WHERE status <> 'deleted';

CREATE TABLE memberships (
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'reviewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id);

-- Dernier propriétaire protégé : vérifié en fin de transaction (permet un transfert atomique).
CREATE FUNCTION enforce_last_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org uuid := OLD.organization_id;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = org) THEN
    RETURN NULL; -- organisation supprimée : rien à protéger
  END IF;
  IF NOT EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = org AND m.role = 'owner') THEN
    RAISE EXCEPTION 'last_owner_protected' USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER memberships_last_owner
  AFTER UPDATE OR DELETE ON memberships
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_last_owner();

CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(email)),
  role text NOT NULL CHECK (role IN ('admin', 'editor', 'reviewer')),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '7 days')
);
CREATE INDEX invitations_org_idx ON invitations (organization_id, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- Marques et médias
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  sector text,
  timezone text NOT NULL,
  default_content_locale text NOT NULL CHECK (default_content_locale IN ('fr-CA', 'en-CA')),
  profile_version integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);

CREATE TABLE brand_guidelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  facts_json jsonb NOT NULL,
  tone_json jsonb NOT NULL,
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, version),
  FOREIGN KEY (organization_id, brand_id) REFERENCES brands (organization_id, id) ON DELETE CASCADE
);
CREATE TRIGGER brand_guidelines_immutable BEFORE UPDATE ON brand_guidelines FOR EACH ROW EXECUTE FUNCTION forbid_update();

CREATE TABLE media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  storage_key text NOT NULL UNIQUE,
  mime text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  bytes integer NOT NULL CHECK (bytes > 0 AND bytes <= 20 * 1024 * 1024),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  width integer CHECK (width > 0),
  height integer CHECK (height > 0),
  rights_status text NOT NULL DEFAULT 'undeclared' CHECK (rights_status IN ('undeclared', 'declared_owned', 'declared_licensed')),
  status text NOT NULL DEFAULT 'quarantined' CHECK (status IN ('quarantined', 'validating', 'ready', 'rejected', 'deleted')),
  uploaded_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  -- un média prêt a des dimensions connues et des droits déclarés
  CHECK (status <> 'ready' OR (width IS NOT NULL AND height IS NOT NULL AND rights_status <> 'undeclared'))
);

CREATE TABLE brand_assets (
  organization_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  media_asset_id uuid NOT NULL,
  usage_role text NOT NULL CHECK (usage_role IN ('logo', 'photo')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (brand_id, media_asset_id, usage_role),
  FOREIGN KEY (organization_id, brand_id) REFERENCES brands (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, media_asset_id) REFERENCES media_assets (organization_id, id) ON DELETE CASCADE
);

CREATE TABLE social_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('facebook_page', 'instagram_business', 'linkedin_page')),
  external_account_id text NOT NULL,
  display_name text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'needs_reconnect', 'revoked', 'disabled')),
  -- Référence vers le gestionnaire de secrets (jeton chiffré KMS) ; jamais le jeton lui-même.
  secret_ref text,
  capabilities_snapshot jsonb,
  checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (brand_id, provider, external_account_id),
  FOREIGN KEY (organization_id, brand_id) REFERENCES brands (organization_id, id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Contenus, variantes, révisions immuables, approbations
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE content_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  CHECK (period_end > period_start),
  FOREIGN KEY (organization_id, brand_id) REFERENCES brands (organization_id, id) ON DELETE CASCADE
);

CREATE TABLE content_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  topic text NOT NULL CHECK (length(btrim(topic)) BETWEEN 1 AND 500),
  summary_status text NOT NULL DEFAULT 'draft'
    CHECK (summary_status IN ('draft', 'generating', 'internal_review', 'pending_customer_review', 'changes_requested', 'approved', 'archived')),
  source_fact_ids text[] NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, plan_id) REFERENCES content_plans (organization_id, id) ON DELETE CASCADE
);

CREATE TABLE content_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  content_item_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('facebook_page', 'instagram_business', 'linkedin_page')),
  locale text NOT NULL CHECK (locale IN ('fr-CA', 'en-CA')),
  editorial_status text NOT NULL DEFAULT 'draft'
    CHECK (editorial_status IN ('draft', 'generating', 'internal_review', 'pending_customer_review', 'changes_requested', 'approved', 'archived')),
  current_revision_id uuid,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (content_item_id, provider, locale),
  FOREIGN KEY (organization_id, content_item_id) REFERENCES content_items (organization_id, id) ON DELETE CASCADE
);

CREATE TABLE revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  number integer NOT NULL CHECK (number >= 1),
  caption text NOT NULL,
  media_manifest jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Empreinte du contenu (texte, langue, réseau, médias). La destination exacte est liée par l'approbation.
  hash text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  author_id uuid REFERENCES users (id),
  origin text NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'ai', 'import')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, variant_id, id),
  UNIQUE (variant_id, number),
  FOREIGN KEY (organization_id, variant_id) REFERENCES content_variants (organization_id, id) ON DELETE CASCADE
);
CREATE TRIGGER revisions_immutable BEFORE UPDATE ON revisions FOR EACH ROW EXECUTE FUNCTION forbid_update();

-- La révision courante appartient forcément à la même variante et au même tenant.
ALTER TABLE content_variants
  ADD CONSTRAINT content_variants_current_revision_fk
  FOREIGN KEY (organization_id, id, current_revision_id) REFERENCES revisions (organization_id, variant_id, id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  revision_hash text NOT NULL CHECK (revision_hash ~ '^[0-9a-f]{64}$'),
  connection_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users (id),
  approved_at timestamptz NOT NULL DEFAULT now(),
  invalidated_at timestamptz,
  invalidated_reason text,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, revision_id) REFERENCES revisions (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, connection_id) REFERENCES social_connections (organization_id, id) ON DELETE CASCADE,
  CHECK ((invalidated_at IS NULL) = (invalidated_reason IS NULL))
);
CREATE UNIQUE INDEX approvals_active_uq ON approvals (revision_id, connection_id) WHERE invalidated_at IS NULL;

-- Défense en profondeur : l'empreinte approuvée est celle de la révision, le réseau de la
-- connexion est celui de la variante, et la connexion appartient à la marque du contenu.
-- Une approbation ne peut ensuite qu'être invalidée, une seule fois.
CREATE FUNCTION check_approval() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r_hash text; v_provider text; v_brand uuid; c_provider text; c_brand uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.invalidated_at IS NOT NULL
       OR NEW.revision_id <> OLD.revision_id OR NEW.revision_hash <> OLD.revision_hash
       OR NEW.connection_id <> OLD.connection_id OR NEW.actor_id <> OLD.actor_id
       OR NEW.approved_at <> OLD.approved_at OR NEW.organization_id <> OLD.organization_id THEN
      RAISE EXCEPTION 'approval_immutable' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  SELECT r.hash, v.provider, p.brand_id INTO r_hash, v_provider, v_brand
    FROM revisions r
    JOIN content_variants v ON v.id = r.variant_id
    JOIN content_items i ON i.id = v.content_item_id
    JOIN content_plans p ON p.id = i.plan_id
   WHERE r.id = NEW.revision_id;
  SELECT c.provider, c.brand_id INTO c_provider, c_brand FROM social_connections c WHERE c.id = NEW.connection_id;
  IF r_hash IS DISTINCT FROM NEW.revision_hash THEN
    RAISE EXCEPTION 'approval_hash_mismatch' USING ERRCODE = 'P0001';
  END IF;
  IF c_provider IS DISTINCT FROM v_provider OR c_brand IS DISTINCT FROM v_brand THEN
    RAISE EXCEPTION 'approval_destination_mismatch' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER approvals_check BEFORE INSERT OR UPDATE ON approvals FOR EACH ROW EXECUTE FUNCTION check_approval();

CREATE TABLE comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  content_item_id uuid NOT NULL,
  revision_id uuid,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 5000),
  author_id uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, content_item_id) REFERENCES content_items (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, revision_id) REFERENCES revisions (organization_id, id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Abonnements, cycles, droits, réservations, ledger append-only
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE plans (
  code text NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  price_minor integer NOT NULL CHECK (price_minor >= 0),
  currency text NOT NULL DEFAULT 'CAD' CHECK (currency = 'CAD'),
  entitlements_json jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (code, version)
);

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  external_id text UNIQUE,
  plan_code text NOT NULL,
  plan_version integer NOT NULL,
  status text NOT NULL CHECK (status IN ('incomplete', 'active', 'past_due', 'canceled', 'expired', 'suspended')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  grace_until timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (plan_code, plan_version) REFERENCES plans (code, version),
  CHECK (current_period_end IS NULL OR current_period_end > current_period_start)
);
CREATE UNIQUE INDEX subscriptions_one_live_per_org ON subscriptions (organization_id)
  WHERE status IN ('incomplete', 'active', 'past_due', 'suspended');

CREATE TABLE billing_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  CHECK (ends_at > starts_at),
  FOREIGN KEY (organization_id, subscription_id) REFERENCES subscriptions (organization_id, id) ON DELETE CASCADE,
  -- Cycles [start, end) sans chevauchement par organisation.
  EXCLUDE USING gist (organization_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
);

CREATE TABLE entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  cycle_id uuid NOT NULL,
  key text NOT NULL CHECK (key IN ('content_items', 'publications', 'regenerations_per_item', 'users', 'social_accounts', 'brands')),
  limit_value integer NOT NULL CHECK (limit_value >= 0),
  source text NOT NULL DEFAULT 'plan' CHECK (source IN ('plan', 'upgrade_delta')),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to > effective_from),
  FOREIGN KEY (organization_id, cycle_id) REFERENCES billing_cycles (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX entitlements_cycle_idx ON entitlements (cycle_id, key);

CREATE TABLE usage_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  cycle_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('content_item', 'publication', 'regeneration')),
  quantity integer NOT NULL CHECK (quantity > 0),
  resource_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'consumed', 'released')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (type, resource_id),
  FOREIGN KEY (organization_id, cycle_id) REFERENCES billing_cycles (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX usage_reservations_cycle_idx ON usage_reservations (cycle_id, type, status);

CREATE TABLE usage_ledger (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL,
  cycle_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('content_item', 'publication', 'regeneration')),
  entry_kind text NOT NULL CHECK (entry_kind IN ('reserve', 'consume', 'release', 'grant', 'adjust')),
  delta integer NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  reservation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, cycle_id) REFERENCES billing_cycles (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, reservation_id) REFERENCES usage_reservations (organization_id, id)
);
CREATE INDEX usage_ledger_cycle_idx ON usage_ledger (cycle_id, type);
CREATE TRIGGER usage_ledger_append_only BEFORE UPDATE ON usage_ledger FOR EACH ROW EXECUTE FUNCTION forbid_update();

CREATE TABLE invoice_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  external_invoice_id text NOT NULL UNIQUE,
  status text NOT NULL,
  amount_minor integer CHECK (amount_minor >= 0),
  currency text NOT NULL DEFAULT 'CAD',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Publication
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  scheduled_at timestamptz,
  timezone text NOT NULL,
  status text NOT NULL DEFAULT 'unscheduled' CHECK (status IN (
    'unscheduled', 'scheduled', 'blocked_approval', 'dispatching', 'processing', 'retry_wait',
    'unknown', 'published', 'failed', 'cancelled', 'expired')),
  external_id text,
  external_url text,
  quota_reservation_id uuid,
  lease_owner text,
  lease_until timestamptz,
  cancel_requested_at timestamptz,
  next_attempt_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  confirmation_kind text CHECK (confirmation_kind IN ('api', 'manual')),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, revision_id) REFERENCES revisions (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, connection_id) REFERENCES social_connections (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, quota_reservation_id) REFERENCES usage_reservations (organization_id, id),
  CHECK (status = 'unscheduled' OR scheduled_at IS NOT NULL),
  CHECK (status <> 'published' OR confirmation_kind IS NOT NULL)
);
CREATE INDEX publications_due_idx ON publications (status, next_attempt_at);
CREATE INDEX publications_org_date_idx ON publications (organization_id, scheduled_at);

CREATE TABLE publishing_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  publication_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number >= 1),
  request_key text NOT NULL UNIQUE,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  outcome text NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending', 'confirmed', 'processing', 'rejected', 'unknown')),
  safe_error_code text,
  UNIQUE (publication_id, attempt_number),
  FOREIGN KEY (organization_id, publication_id) REFERENCES publications (organization_id, id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Notifications, audit, IA, statistiques
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  locale text NOT NULL CHECK (locale IN ('fr-CA', 'en-CA')),
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  delivery_key text NOT NULL UNIQUE,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- destinataire obligatoirement membre de l'organisation
  FOREIGN KEY (organization_id, user_id) REFERENCES memberships (organization_id, user_id) ON DELETE CASCADE
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid REFERENCES organizations (id) ON DELETE SET NULL,
  actor_id uuid,
  actor_kind text NOT NULL CHECK (actor_kind IN ('user', 'staff', 'support', 'system')),
  action text NOT NULL,
  target_type text,
  target_id text,
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_org_date_idx ON audit_events (organization_id, created_at);
CREATE TRIGGER audit_events_append_only BEFORE UPDATE ON audit_events FOR EACH ROW
  WHEN (OLD.organization_id IS NOT DISTINCT FROM NEW.organization_id)
  EXECUTE FUNCTION forbid_update();

CREATE TABLE ai_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  content_item_id uuid,
  prompt_version text NOT NULL,
  model text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  input_tokens integer,
  output_tokens integer,
  cost_estimate_micros bigint,
  safe_error_code text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, brand_id) REFERENCES brands (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, content_item_id) REFERENCES content_items (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX ai_jobs_org_status_idx ON ai_jobs (organization_id, status);

CREATE TABLE analytics_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  publication_id uuid,
  metric text NOT NULL,
  -- NULL = non disponible / non supporté ; jamais remplacé par zéro.
  value numeric,
  availability text NOT NULL CHECK (availability IN ('available', 'unsupported', 'unavailable')),
  source_definition text NOT NULL,
  captured_at timestamptz NOT NULL,
  FOREIGN KEY (organization_id, connection_id) REFERENCES social_connections (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, publication_id) REFERENCES publications (organization_id, id) ON DELETE CASCADE,
  CHECK ((availability = 'available') = (value IS NOT NULL))
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Outbox, webhooks, exploitation interne, vie privée
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz
);
CREATE INDEX outbox_pending_idx ON outbox_events (created_at) WHERE dispatched_at IS NULL;

-- Table système : aucun accès direct du runtime (ingestion via fonction dédiée en E07).
CREATE TABLE webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('stripe', 'meta', 'linkedin')),
  external_event_id text NOT NULL,
  event_type text NOT NULL,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'failed', 'ignored')),
  payload_ref text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (provider, external_event_id)
);

CREATE TABLE staff_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('producer', 'account_manager')),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz NOT NULL,
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_until > valid_from),
  FOREIGN KEY (organization_id, brand_id) REFERENCES brands (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX staff_assignments_user_idx ON staff_assignments (user_id, valid_until);

CREATE TABLE support_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 10),
  scope text NOT NULL DEFAULT 'metadata' CHECK (scope IN ('metadata', 'content')),
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '72 hours')
);

CREATE TABLE privacy_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('export', 'deletion')),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'verified', 'processing', 'completed', 'rejected')),
  requested_by uuid NOT NULL REFERENCES users (id),
  verified_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security (FORCE : s'applique aussi au propriétaire)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'invitations', 'brands', 'brand_guidelines', 'media_assets', 'brand_assets', 'social_connections',
    'content_plans', 'content_items', 'content_variants', 'revisions', 'approvals', 'comments',
    'subscriptions', 'billing_cycles', 'entitlements', 'usage_reservations', 'usage_ledger', 'invoice_references',
    'publications', 'publishing_attempts', 'notifications', 'ai_jobs', 'analytics_snapshots', 'outbox_events',
    'staff_assignments', 'support_grants', 'privacy_requests'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org())', t);
  END LOOP;
END $$;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
-- Lecture : organisation du contexte, ou organisations dont l'utilisateur courant est membre (sélecteur).
CREATE POLICY organizations_select ON organizations FOR SELECT USING (
  id = app_current_org()
  OR EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = organizations.id AND m.user_id = app_current_user()));
CREATE POLICY organizations_insert ON organizations FOR INSERT WITH CHECK (id = app_current_org());
CREATE POLICY organizations_update ON organizations FOR UPDATE USING (id = app_current_org()) WITH CHECK (id = app_current_org());
CREATE POLICY organizations_delete ON organizations FOR DELETE USING (id = app_current_org());

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY memberships_select ON memberships FOR SELECT USING (
  organization_id = app_current_org() OR user_id = app_current_user());
CREATE POLICY memberships_write ON memberships FOR INSERT WITH CHECK (organization_id = app_current_org());
CREATE POLICY memberships_update ON memberships FOR UPDATE USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
CREATE POLICY memberships_delete ON memberships FOR DELETE USING (organization_id = app_current_org());

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
-- Un utilisateur voit son propre profil et les membres de l'organisation du contexte.
CREATE POLICY users_select ON users FOR SELECT USING (
  id = app_current_user()
  OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id AND m.organization_id = app_current_org()));
CREATE POLICY users_insert ON users FOR INSERT WITH CHECK (id = app_current_user());
CREATE POLICY users_update ON users FOR UPDATE USING (id = app_current_user()) WITH CHECK (id = app_current_user());

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans FORCE ROW LEVEL SECURITY;
CREATE POLICY plans_read ON plans FOR SELECT USING (true);
-- Données de référence : écrites uniquement par le rôle de migration (le runtime n'a que SELECT).
CREATE POLICY plans_reference_write ON plans FOR ALL TO bbn_migrator USING (true) WITH CHECK (true);

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_select ON audit_events FOR SELECT USING (organization_id = app_current_org());
CREATE POLICY audit_insert ON audit_events FOR INSERT WITH CHECK (organization_id = app_current_org());

ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events FORCE ROW LEVEL SECURITY;
-- Aucune politique : refus total pour tout rôle soumis à RLS.

-- ─────────────────────────────────────────────────────────────────────────────
-- Privilèges du runtime (moindre privilège)
-- ─────────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION app_current_org(), app_current_user() TO bbn_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  organizations, memberships, invitations, brands, media_assets, brand_assets, social_connections,
  content_plans, content_items, content_variants, approvals, comments,
  subscriptions, billing_cycles, entitlements, usage_reservations, invoice_references,
  publications, publishing_attempts, notifications, ai_jobs, analytics_snapshots, outbox_events,
  staff_assignments, support_grants, privacy_requests
TO bbn_app;
GRANT SELECT, INSERT, UPDATE ON users TO bbn_app;
-- Immuables / append-only : ni UPDATE ni DELETE pour le runtime.
GRANT SELECT, INSERT ON revisions, brand_guidelines, usage_ledger, audit_events TO bbn_app;
GRANT SELECT ON plans TO bbn_app;
-- webhook_events : aucun privilège.
