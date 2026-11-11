-- Amorçage exécuté par un administrateur PostgreSQL (jamais par l'application).
-- Paramètres psql/node : :migrator_password, :app_password (valeurs locales de dev uniquement).
-- En staging/production, ces rôles sont créés par l'infrastructure (Terraform) et les secrets
-- proviennent de Secrets Manager.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bbn_migrator') THEN
    CREATE ROLE bbn_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bbn_app') THEN
    CREATE ROLE bbn_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
  END IF;
END
$$;
-- Le runtime ne peut jamais endosser le rôle propriétaire.
REVOKE bbn_migrator FROM bbn_app;
