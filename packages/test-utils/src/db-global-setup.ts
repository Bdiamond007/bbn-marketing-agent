import type { TestProject } from "vitest/node";
import { bootstrapDatabase, runMigrations } from "../../db/src/admin";
import { localDbEnv } from "../../db/src/env";
import type {} from "./context";


/**
 * Prépare une base de test jetable (bbn_test) : rôles, base, migrations.
 * Pas de saut silencieux : si PostgreSQL est injoignable, la suite échoue avec une consigne.
 */
export default async function setup(project: TestProject): Promise<void> {
  const env = localDbEnv(process.env, "bbn_test");
  try {
    await bootstrapDatabase({ ...env, recreate: true });
  } catch (e) {
    throw new Error(
      `test:db — PostgreSQL injoignable via DATABASE_ADMIN_URL (${new URL(env.adminUrl).host}). ` +
        `Lancez 'pnpm pg:local' (sans Docker) ou 'pnpm dev:infra'. Cause : ${(e as Error).message}`,
      { cause: e },
    );
  }
  await runMigrations(env.migrationUrl);
  project.provide("dbUrls", { appUrl: env.appUrl, migrationUrl: env.migrationUrl, adminUrl: env.adminUrl });
}
