import { writeFileSync } from "node:fs";
import { bootstrapDatabase, runMigrations } from "../../../packages/db/src/admin";
import { localDbEnv } from "../../../packages/db/src/env";
import { E2E_DB, MAILBOX } from "./env";

/** Base jetable dédiée aux E2E et boîte courriel simulée vide. */
export default async function globalSetup(): Promise<void> {
  const env = localDbEnv(process.env, E2E_DB);
  await bootstrapDatabase({ ...env, recreate: true });
  await runMigrations(env.migrationUrl);
  writeFileSync(MAILBOX, "");
}
