-- Exécuté par l'administrateur, connecté à la base cible.
CREATE EXTENSION IF NOT EXISTS btree_gist;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM bbn_app;
GRANT USAGE, CREATE ON SCHEMA public TO bbn_migrator;
GRANT USAGE ON SCHEMA public TO bbn_app;
