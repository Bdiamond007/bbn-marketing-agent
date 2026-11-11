import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;

export interface TenantContext {
  /** Organisation résolue côté serveur (jamais une valeur du navigateur acceptée comme permission). */
  organizationId: string;
  /** Utilisateur authentifié ; null pour un job système portant une organisation explicite. */
  userId: string | null;
}

export interface Tx {
  client: pg.PoolClient;
  db: Db;
  ctx: TenantContext;
}

export class TenantContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantContextError";
  }
}

/** Refus volontairement indistinct : ne révèle pas si l'organisation existe (§11 politique 403/404). */
export class TenantAccessDenied extends Error {
  constructor() {
    super("tenant_access_denied");
    this.name = "TenantAccessDenied";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export function createPool(connectionString: string, max = 10): pg.Pool {
  return new pg.Pool({ connectionString, max, application_name: "bbn-runtime" });
}

export type Isolation = "read committed" | "repeatable read" | "serializable";

async function inTransaction<T>(
  pool: pg.Pool,
  settings: Record<string, string>,
  isolation: Isolation,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(`BEGIN ISOLATION LEVEL ${isolation.toUpperCase()}`);
    const keys = Object.keys(settings);
    if (keys.length > 0) {
      // set_config(..., true) == SET LOCAL : le contexte disparaît à la fin de la transaction,
      // jamais d'état durable sur une connexion du pool.
      const exprs = keys.map((k, i) => `set_config('${k}', $${i + 1}, true)`).join(", ");
      await client.query(`SELECT ${exprs}`, keys.map((k) => settings[k]));
    }
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Exécute `fn` dans une transaction portant le contexte tenant.
 * Si un utilisateur est fourni, son appartenance à l'organisation est vérifiée dans la même transaction.
 */
export async function withTenant<T>(
  pool: pg.Pool,
  ctx: TenantContext,
  fn: (tx: Tx) => Promise<T>,
  opts: { isolation?: Isolation } = {},
): Promise<T> {
  if (!isUuid(ctx.organizationId)) throw new TenantContextError("organizationId invalide ou absent");
  if (ctx.userId !== null && !isUuid(ctx.userId)) throw new TenantContextError("userId invalide");
  const settings = { "app.organization_id": ctx.organizationId, "app.user_id": ctx.userId ?? "" };
  return inTransaction(pool, settings, opts.isolation ?? "read committed", async (client) => {
    if (ctx.userId !== null) {
      const m = await client.query("SELECT 1 FROM memberships WHERE organization_id = $1 AND user_id = $2", [ctx.organizationId, ctx.userId]);
      if (m.rowCount === 0) throw new TenantAccessDenied();
    }
    return fn({ client, db: drizzle(client, { schema }), ctx });
  });
}

/** Transaction sans organisation : accès limité au profil de l'utilisateur et à ses appartenances. */
export async function withUser<T>(pool: pg.Pool, userId: string, fn: (tx: { client: pg.PoolClient; db: Db }) => Promise<T>): Promise<T> {
  if (!isUuid(userId)) throw new TenantContextError("userId invalide");
  return inTransaction(pool, { "app.user_id": userId }, "read committed", async (client) => fn({ client, db: drizzle(client, { schema }) }));
}

/**
 * Création d'organisation : l'identifiant est généré côté serveur, le contexte est posé sur cette
 * nouvelle organisation, puis le créateur devient propriétaire — le tout atomiquement.
 */
export async function createOrganizationWithOwner(
  pool: pg.Pool,
  input: { organizationId: string; ownerUserId: string; name: string; defaultLocale: "fr-CA" | "en-CA" },
): Promise<void> {
  if (!isUuid(input.organizationId) || !isUuid(input.ownerUserId)) throw new TenantContextError("identifiants invalides");
  const settings = { "app.organization_id": input.organizationId, "app.user_id": input.ownerUserId };
  await inTransaction(pool, settings, "read committed", async (client) => {
    await client.query("INSERT INTO organizations (id, name, default_locale) VALUES ($1, $2, $3)", [input.organizationId, input.name, input.defaultLocale]);
    await client.query("INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner')", [input.organizationId, input.ownerUserId]);
  });
}
