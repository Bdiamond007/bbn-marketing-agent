/**
 * Opérations d'administration (amorçage des rôles, création de base, migrations).
 * Jamais importé par le runtime web/worker.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(here, "..", "migrations");
const BOOTSTRAP_DIR = join(here, "..", "bootstrap");

function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Identifiant SQL refusé : ${name}`);
  return `"${name}"`;
}
function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export interface BootstrapOptions {
  adminUrl: string;
  databaseName: string;
  migratorPassword: string;
  appPassword: string;
  /** Supprime puis recrée la base : réservé aux bases de test jetables. */
  recreate?: boolean;
}

/** Crée rôles et base (idempotent). */
export async function bootstrapDatabase(o: BootstrapOptions): Promise<void> {
  if (o.recreate && !o.databaseName.startsWith("bbn_test")) {
    throw new Error("recreate n'est autorisé que pour une base de test (préfixe bbn_test)");
  }
  const admin = new pg.Client({ connectionString: o.adminUrl });
  await admin.connect();
  try {
    await admin.query(readFileSync(join(BOOTSTRAP_DIR, "roles.sql"), "utf8"));
    await admin.query(`ALTER ROLE bbn_migrator PASSWORD ${literal(o.migratorPassword)}`);
    await admin.query(`ALTER ROLE bbn_app PASSWORD ${literal(o.appPassword)}`);
    if (o.recreate) await admin.query(`DROP DATABASE IF EXISTS ${ident(o.databaseName)} WITH (FORCE)`);
    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [o.databaseName]);
    if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${ident(o.databaseName)} OWNER bbn_migrator`);
    await admin.query(`REVOKE ALL ON DATABASE ${ident(o.databaseName)} FROM PUBLIC`);
    await admin.query(`GRANT CONNECT ON DATABASE ${ident(o.databaseName)} TO bbn_app, bbn_migrator`);
  } finally {
    await admin.end();
  }
  const url = new URL(o.adminUrl);
  url.pathname = `/${o.databaseName}`;
  const db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  try {
    await db.query(readFileSync(join(BOOTSTRAP_DIR, "database.sql"), "utf8"));
  } finally {
    await db.end();
  }
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/**
 * Applique les migrations SQL dans l'ordre, chacune dans sa transaction, sous verrou consultatif.
 * Une migration déjà appliquée dont le contenu a changé fait échouer l'exécution (migrations immuables).
 */
export async function runMigrations(migrationUrl: string, dir: string = MIGRATIONS_DIR): Promise<MigrationResult> {
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort();
  const client = new pg.Client({ connectionString: migrationUrl });
  await client.connect();
  const result: MigrationResult = { applied: [], skipped: [] };
  try {
    await client.query("SELECT pg_advisory_lock(727001)");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const rows = (await client.query<{ version: string; checksum: string }>("SELECT version, checksum FROM schema_migrations")).rows;
    const done = new Map(rows.map((r) => [r.version, r.checksum]));
    for (const f of files) {
      const sql = readFileSync(join(dir, f), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const version = f.replace(/\.sql$/, "");
      const prior = done.get(version);
      if (prior !== undefined) {
        if (prior !== checksum) throw new Error(`Migration ${version} modifiée après application (checksum différent)`);
        result.skipped.push(version);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)", [version, checksum]);
        await client.query("COMMIT");
        result.applied.push(version);
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`Échec de la migration ${version} : ${(e as Error).message}`, { cause: e });
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(727001)").catch(() => undefined);
    await client.end();
  }
  return result;
}
