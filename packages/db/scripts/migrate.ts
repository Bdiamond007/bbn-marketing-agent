import { runMigrations } from "../src/admin";
import { localDbEnv } from "../src/env";

const url = process.env.DATABASE_MIGRATION_URL ?? localDbEnv().migrationUrl;
const r = await runMigrations(url);
console.log(`db:migrate OK — appliquées : [${r.applied.join(", ")}] ; déjà présentes : ${r.skipped.length}`);
