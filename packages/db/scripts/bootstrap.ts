import { bootstrapDatabase } from "../src/admin";
import { localDbEnv } from "../src/env";

// Développement local uniquement : en staging/production les rôles viennent de l'infrastructure.
if (process.env.APP_ENV === "production" || process.env.APP_ENV === "staging") {
  console.error("db:bootstrap est réservé au développement local.");
  process.exit(1);
}
const env = localDbEnv();
await bootstrapDatabase(env);
console.log(`db:bootstrap OK — base ${env.databaseName}, rôles bbn_migrator / bbn_app`);
