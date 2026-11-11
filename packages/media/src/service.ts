/**
 * Médias privés (MEDIA-01, E10) : quarantaine → validation/réencodage → prêt, ou refusé.
 * Aucun média n'est publiable sans être « ready » avec une déclaration de droits.
 * Le traitement ne garde aucune transaction SQL ouverte pendant le décodage.
 */
import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import { asMember, type AuthDeps, type RequestMeta, type SessionInfo } from "@bbn/auth";
import { withTenant } from "@bbn/db";
import { ServiceError } from "@bbn/domain";
import type { MalwareScanner, ObjectStorage } from "@bbn/integrations";
import { inspectAndReencode, isAllowedMime, MAX_BYTES } from "./processing";

export interface MediaDeps extends AuthDeps {
  storage: ObjectStorage;
  scanner: MalwareScanner;
  /** Mode simulation : les URL signées passent par une route locale (le stockage simulé est en mémoire). */
  simulation: boolean;
}

export const UPLOAD_URL_TTL_SECONDS = 15 * 60;
export const VIEW_URL_TTL_SECONDS = 5 * 60;
export const ORPHAN_AFTER_MS = 24 * 3600 * 1000;

export interface MediaItem {
  id: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  status: "quarantined" | "validating" | "ready" | "rejected" | "deleted";
  rightsStatus: "undeclared" | "declared_owned" | "declared_licensed";
  rejectedReason: string | null;
  usageRoles: string[];
  createdAt: string;
}

const viaLocalRoute = (deps: MediaDeps, signed: string) => (deps.simulation ? `${deps.appBaseUrl}/api/v1/dev/storage?u=${encodeURIComponent(signed)}` : signed);

async function audit(client: pg.PoolClient, orgId: string, actorId: string, action: string, assetId: string, meta: RequestMeta, safe: Record<string, unknown> = {}) {
  await client.query("INSERT INTO audit_events (organization_id, actor_id, actor_kind, action, target_type, target_id, safe_metadata, request_id) VALUES ($1, $2, 'user', $3, 'media_asset', $4, $5, $6)", [
    orgId, actorId, action, assetId, JSON.stringify(safe), meta.requestId,
  ]);
}

export async function createUpload(deps: MediaDeps, session: SessionInfo, orgId: string, input: { contentType: string; bytes: number }, meta: RequestMeta): Promise<{ assetId: string; uploadUrl: string; expiresInSeconds: number }> {
  if (!isAllowedMime(input.contentType)) throw new ServiceError("validation_failed", { fields: ["contentType"], reason: "unsupported_type" });
  if (!Number.isInteger(input.bytes) || input.bytes <= 0 || input.bytes > MAX_BYTES) throw new ServiceError("validation_failed", { fields: ["bytes"], reason: "too_large" });
  const assetId = randomUUID();
  const quarantineKey = `org/${orgId}/quarantine/${assetId}`;
  await asMember(deps, session, orgId, "media.upload", async ({ client }) => {
    await client.query(
      `INSERT INTO media_assets (id, organization_id, storage_key, quarantine_key, mime, declared_mime, bytes, status, uploaded_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5, $6, 'quarantined', $7, $8, $8)`,
      [assetId, orgId, `org/${orgId}/media/${assetId}`, quarantineKey, input.contentType, input.bytes, session.userId, deps.clock.now()],
    );
    await audit(client, orgId, session.userId, "media.upload_started", assetId, meta);
  });
  const signed = await deps.storage.createSignedPutUrl(quarantineKey, { contentType: input.contentType, maxBytes: input.bytes, ttlSeconds: UPLOAD_URL_TTL_SECONDS });
  return { assetId, uploadUrl: viaLocalRoute(deps, signed), expiresInSeconds: UPLOAD_URL_TTL_SECONDS };
}

/**
 * Finalise un téléversement : déclaration de droits obligatoire, puis inspection et réencodage.
 * Résultat : « ready » (publiable) ou « rejected » (raison expurgée), jamais un état intermédiaire durable.
 */
export async function completeUpload(
  deps: MediaDeps,
  session: SessionInfo,
  orgId: string,
  assetId: string,
  input: { rightsStatus: "declared_owned" | "declared_licensed"; brandId?: string; usageRole?: "logo" | "photo" },
  meta: RequestMeta,
): Promise<MediaItem> {
  if (input.rightsStatus !== "declared_owned" && input.rightsStatus !== "declared_licensed") throw new ServiceError("validation_failed", { fields: ["rightsStatus"] });
  const row = await asMember(deps, session, orgId, "media.upload", async ({ client }) => {
    const r = (await client.query<{ quarantine_key: string; declared_mime: string; storage_key: string; status: string }>("SELECT quarantine_key, declared_mime, storage_key, status FROM media_assets WHERE id = $1 FOR UPDATE", [assetId])).rows[0];
    if (!r) throw new ServiceError("not_found");
    if (r.status !== "quarantined") throw new ServiceError("conflict", { reason: "media_not_in_quarantine" });
    if (input.brandId) {
      const b = await client.query("SELECT 1 FROM brands WHERE id = $1", [input.brandId]);
      if (!b.rowCount) throw new ServiceError("not_found");
    }
    await client.query("UPDATE media_assets SET status = 'validating', updated_at = $2 WHERE id = $1", [assetId, deps.clock.now()]);
    return r;
  });

  const obj = await deps.storage.getObject(row.quarantine_key);
  if (!obj) {
    await withTenant(deps.pool, { organizationId: orgId, userId: null }, ({ client }) => client.query("UPDATE media_assets SET status = 'quarantined' WHERE id = $1", [assetId]));
    throw new ServiceError("business_rule", { reason: "upload_missing" });
  }
  const result = await inspectAndReencode(obj.body, row.declared_mime, deps.scanner);
  if (result.ok) {
    const key = `${row.storage_key}.${result.ext}`;
    await deps.storage.putObject(key, result.output, result.mime);
    await deps.storage.deleteObject(row.quarantine_key);
    await withTenant(deps.pool, { organizationId: orgId, userId: null }, async ({ client }) => {
      await client.query(
        `UPDATE media_assets SET storage_key = $2, mime = $3, bytes = $4, sha256 = $5, width = $6, height = $7, rights_status = $8,
           status = 'ready', processed_at = $9, updated_at = $9 WHERE id = $1`,
        [assetId, key, result.mime, result.output.byteLength, createHash("sha256").update(result.output).digest("hex"), result.width, result.height, input.rightsStatus, deps.clock.now()],
      );
      if (input.brandId && input.usageRole) {
        await client.query("INSERT INTO brand_assets (organization_id, brand_id, media_asset_id, usage_role) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING", [orgId, input.brandId, assetId, input.usageRole]);
      }
      await audit(client, orgId, session.userId, "media.ready", assetId, meta, { rights: input.rightsStatus });
    });
  } else {
    await deps.storage.deleteObject(row.quarantine_key);
    await withTenant(deps.pool, { organizationId: orgId, userId: null }, async ({ client }) => {
      await client.query("UPDATE media_assets SET status = 'rejected', rejected_reason = $2, processed_at = $3, updated_at = $3 WHERE id = $1", [assetId, result.reason, deps.clock.now()]);
      await audit(client, orgId, session.userId, "media.rejected", assetId, meta, { reason: result.reason });
    });
  }
  return getMedia(deps, session, orgId, assetId);
}

const SELECT_MEDIA = `SELECT m.id, m.mime, m.bytes, m.width, m.height, m.status, m.rights_status, m.rejected_reason, m.created_at,
  coalesce(array_agg(ba.usage_role) FILTER (WHERE ba.usage_role IS NOT NULL), '{}') AS usage_roles
  FROM media_assets m LEFT JOIN brand_assets ba ON ba.media_asset_id = m.id`;
interface MediaRow {
  id: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  status: MediaItem["status"];
  rights_status: MediaItem["rightsStatus"];
  rejected_reason: string | null;
  created_at: Date;
  usage_roles: string[];
}
const toItem = (r: MediaRow): MediaItem => ({ id: r.id, mime: r.mime, bytes: r.bytes, width: r.width, height: r.height, status: r.status, rightsStatus: r.rights_status, rejectedReason: r.rejected_reason, usageRoles: r.usage_roles, createdAt: r.created_at.toISOString() });

export async function getMedia(deps: MediaDeps, session: SessionInfo, orgId: string, assetId: string): Promise<MediaItem> {
  return asMember(deps, session, orgId, "brand.read", async ({ client }) => {
    const r = (await client.query<MediaRow>(`${SELECT_MEDIA} WHERE m.id = $1 GROUP BY m.id`, [assetId])).rows[0];
    if (!r) throw new ServiceError("not_found");
    return toItem(r);
  });
}

export async function listMedia(deps: MediaDeps, session: SessionInfo, orgId: string): Promise<MediaItem[]> {
  return asMember(deps, session, orgId, "brand.read", async ({ client }) => (await client.query<MediaRow>(`${SELECT_MEDIA} WHERE m.status <> 'deleted' GROUP BY m.id ORDER BY m.created_at DESC LIMIT 200`)).rows.map(toItem));
}

/** URL de consultation signée et courte (5 min), seulement pour un média prêt du tenant. */
export async function mediaViewUrl(deps: MediaDeps, session: SessionInfo, orgId: string, assetId: string): Promise<{ url: string; expiresInSeconds: number }> {
  const key = await asMember(deps, session, orgId, "brand.read", async ({ client }) => {
    const r = (await client.query<{ storage_key: string; status: string }>("SELECT storage_key, status FROM media_assets WHERE id = $1", [assetId])).rows[0];
    if (!r || r.status !== "ready") throw new ServiceError("not_found");
    return r.storage_key;
  });
  return { url: viaLocalRoute(deps, await deps.storage.createSignedGetUrl(key, VIEW_URL_TTL_SECONDS)), expiresInSeconds: VIEW_URL_TTL_SECONDS };
}

/** Garde pour la programmation et l'envoi : médias du tenant, prêts et avec droits déclarés. */
export async function assertMediaPublishable(client: pg.PoolClient, mediaIds: readonly string[]): Promise<void> {
  if (mediaIds.length === 0) return;
  const r = await client.query<{ id: string }>("SELECT id FROM media_assets WHERE id = ANY($1::uuid[]) AND status = 'ready' AND rights_status <> 'undeclared'", [mediaIds]);
  const ok = new Set(r.rows.map((x) => x.id));
  const bad = mediaIds.filter((id) => !ok.has(id));
  if (bad.length > 0) throw new ServiceError("business_rule", { reason: "media_not_publishable", media: bad });
}

/** Nettoyage des téléversements abandonnés (> 24 h en quarantaine) : objet supprimé, ligne marquée « deleted ». */
export async function cleanupOrphanUploads(deps: { pool: pg.Pool; storage: ObjectStorage; clock: { now(): Date } }, limit = 200): Promise<number> {
  const cutoff = new Date(deps.clock.now().getTime() - ORPHAN_AFTER_MS);
  const rows = (await deps.pool.query<{ id: string; organization_id: string; quarantine_key: string | null }>("SELECT * FROM media_stale_quarantine($1, $2)", [cutoff, limit])).rows;
  let cleaned = 0;
  for (const r of rows) {
    if (r.quarantine_key) await deps.storage.deleteObject(r.quarantine_key);
    const u = await withTenant(deps.pool, { organizationId: r.organization_id, userId: null }, ({ client }) =>
      client.query("UPDATE media_assets SET status = 'deleted', rejected_reason = 'abandoned_upload', updated_at = $2 WHERE id = $1 AND status = 'quarantined'", [r.id, deps.clock.now()]),
    );
    cleaned += u.rowCount ?? 0;
  }
  return cleaned;
}
