-- 0002_auth_sessions — sessions serveur, rôles internes, recherches inter-tenant minimales (E05).

-- ─────────────────────────────────────────────────────────────────────────────
-- Rôles internes (producteur, gestionnaire, support, admin plateforme, super admin).
-- Jamais modifiable par le runtime : privilèges UPDATE limités par colonne.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN platform_role text
  CHECK (platform_role IN ('producer', 'account_manager', 'support', 'platform_admin', 'super_admin'));

REVOKE UPDATE ON users FROM bbn_app;
GRANT UPDATE (email_verified_at, ui_locale, status, updated_at) ON users TO bbn_app;

-- ─────────────────────────────────────────────────────────────────────────────
-- Sessions : jeton opaque côté client (cookie HttpOnly), seule son empreinte SHA-256 est stockée.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  privileged boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  idle_expires_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  mfa_verified_at timestamptz,
  reauthenticated_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  CHECK (expires_at > created_at AND idle_expires_at <= expires_at),
  CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY sessions_own ON sessions
  USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
GRANT SELECT, INSERT, UPDATE ON sessions TO bbn_app;

-- Une seule invitation en attente par (organisation, courriel).
CREATE UNIQUE INDEX invitations_pending_uq ON invitations (organization_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Recherches inter-tenant minimales (SECURITY DEFINER, propriétaire bbn_migrator).
-- La RLS étant forcée y compris pour le propriétaire, des politiques de lecture explicites
-- sont accordées au seul rôle propriétaire ; le runtime n'accède qu'à ces fonctions,
-- qui ne renvoient que les colonnes strictement nécessaires.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY sessions_definer_read ON sessions FOR SELECT TO bbn_migrator USING (true);
CREATE POLICY users_definer_read ON users FOR SELECT TO bbn_migrator USING (true);
-- Attribution des rôles internes : procédure opérateur exécutée avec le rôle propriétaire uniquement.
CREATE POLICY users_operator_update ON users FOR UPDATE TO bbn_migrator USING (true) WITH CHECK (true);
CREATE POLICY invitations_definer_read ON invitations FOR SELECT TO bbn_migrator USING (true);

CREATE FUNCTION auth_session_lookup(p_token_hash text)
RETURNS TABLE (
  session_id uuid, user_id uuid, privileged boolean, idle_expires_at timestamptz, expires_at timestamptz,
  mfa_verified_at timestamptz, reauthenticated_at timestamptz, revoked_at timestamptz,
  user_status text, email_verified boolean, platform_role text, ui_locale text, email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT s.id, s.user_id, s.privileged, s.idle_expires_at, s.expires_at, s.mfa_verified_at, s.reauthenticated_at,
         s.revoked_at, u.status, u.email_verified_at IS NOT NULL, u.platform_role, u.ui_locale, u.email
    FROM sessions s JOIN users u ON u.id = s.user_id
   WHERE s.token_hash = p_token_hash
$$;

CREATE FUNCTION auth_user_by_subject(p_subject text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT id FROM users WHERE auth_subject = p_subject AND status <> 'deleted' $$;

CREATE FUNCTION auth_invitation_by_token(p_token_hash text)
RETURNS TABLE (
  invitation_id uuid, organization_id uuid, email text, role text,
  expires_at timestamptz, accepted_at timestamptz, revoked_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT id, organization_id, email, role, expires_at, accepted_at, revoked_at
    FROM invitations WHERE token_hash = p_token_hash
$$;

REVOKE ALL ON FUNCTION auth_session_lookup(text), auth_user_by_subject(text), auth_invitation_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_session_lookup(text), auth_user_by_subject(text), auth_invitation_by_token(text) TO bbn_app;
