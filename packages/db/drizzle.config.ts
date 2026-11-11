import { defineConfig } from "drizzle-kit";

// Le SQL versionné (migrations/) est la source de vérité (ADR-0004).
// drizzle-kit sert uniquement à régénérer src/schema.ts par introspection : `pnpm --filter @bbn/db db:introspect`.
export default defineConfig({
  dialect: "postgresql",
  out: "./.drizzle-introspect",
  dbCredentials: { url: process.env.DATABASE_MIGRATION_URL ?? "postgres://bbn_migrator:bbn_migrator_dev@localhost:5432/bbn" },
  tablesFilter: ["!schema_migrations"],
  introspect: { casing: "camel" },
});
