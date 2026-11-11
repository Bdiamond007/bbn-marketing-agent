import { localDbEnv } from "../src/env";
import { seedDemo } from "../src/seed";
import { createPool } from "../src/tenant";

if (process.env.APP_ENV === "production" || process.env.APP_ENV === "staging") {
  console.error("db:seed est réservé au développement local (données fictives).");
  process.exit(1);
}
const env = localDbEnv();
const pool = createPool(process.env.DATABASE_URL ?? env.appUrl, 2);
try {
  const s = await seedDemo(pool, process.env.DATABASE_MIGRATION_URL ?? env.migrationUrl);
  console.log(`db:seed OK — données FICTIVES : organisations A (${s.orgA}) et B (${s.orgB}).`);
} finally {
  await pool.end();
}
