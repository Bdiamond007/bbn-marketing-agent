/** Résolution des URLs locales (développement/test). En staging/production, fournies par l'infrastructure. */
export interface LocalDbEnv {
  adminUrl: string;
  databaseName: string;
  migratorPassword: string;
  appPassword: string;
  migrationUrl: string;
  appUrl: string;
}

export function localDbEnv(env: Record<string, string | undefined> = process.env, databaseName?: string): LocalDbEnv {
  const adminUrl = env.DATABASE_ADMIN_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
  const appUrl0 = new URL(env.DATABASE_URL ?? "postgres://bbn_app:bbn_app_dev@localhost:5432/bbn");
  const migUrl0 = new URL(env.DATABASE_MIGRATION_URL ?? "postgres://bbn_migrator:bbn_migrator_dev@localhost:5432/bbn");
  const name = databaseName ?? appUrl0.pathname.replace(/^\//, "");
  appUrl0.pathname = `/${name}`;
  migUrl0.pathname = `/${name}`;
  return {
    adminUrl,
    databaseName: name,
    appPassword: decodeURIComponent(appUrl0.password),
    migratorPassword: decodeURIComponent(migUrl0.password),
    appUrl: appUrl0.toString(),
    migrationUrl: migUrl0.toString(),
  };
}
