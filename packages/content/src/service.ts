/**
 * Contenus et révisions (EDIT-01, E11).
 * - Révisions immuables, numérotées par variante, empreinte canonique (texte, langue, réseau, médias).
 * - Concurrence optimiste : expectedVersion obligatoire, 409 stale_version sinon.
 * - Transaction critique « révision + invalidation + blocage » : une nouvelle révision invalide les approbations
 *   actives de la variante et la ramène au brouillon (les envois seront bloqués au dispatch, E18).
 * - Crédit de contenu : réservé et consommé à la première révision persistée du sujet (idempotent par sujet).
 */
import type pg from "pg";
import { asMember, type AuthDeps, type RequestMeta, type SessionInfo } from "@bbn/auth";
import { consume, reserve } from "@bbn/billing";
import {
  computeRevisionHash,
  InvalidTransition,
  ServiceError,
  summarizeItem,
  transition,
  type EditorialEvent,
  type EditorialState,
} from "@bbn/domain";
import { assertMediaPublishable } from "@bbn/media";

export type Provider = "facebook_page" | "instagram_business" | "linkedin_page";
export type ContentLocale = "fr-CA" | "en-CA";
export const MAX_CAPTION = 5000;

export interface RevisionView {
  id: string;
  number: number;
  caption: string;
  media: { mediaAssetId: string; sha256: string }[];
  hash: string;
  authorId: string | null;
  origin: "manual" | "ai" | "import";
  createdAt: string;
}
export interface VariantView {
  id: string;
  provider: Provider;
  locale: ContentLocale;
  status: EditorialState;
  version: number;
  current: RevisionView | null;
  revisionCount: number;
}
export interface ItemView {
  id: string;
  planId: string;
  brandId: string;
  topic: string;
  summaryStatus: EditorialState;
  version: number;
  sourceFactIds: string[];
  variants: VariantView[];
}

async function audit(client: pg.PoolClient, orgId: string, actorId: string, action: string, target: { type: string; id: string }, meta: RequestMeta, safe: Record<string, unknown> = {}) {
  await client.query("INSERT INTO audit_events (organization_id, actor_id, actor_kind, action, target_type, target_id, safe_metadata, request_id) VALUES ($1, $2, 'user', $3, $4, $5, $6, $7)", [
    orgId, actorId, action, target.type, target.id, JSON.stringify(safe), meta.requestId,
  ]);
}

/** Revue interne activée par le plan (Accompagné). */
async function internalReviewEnabled(client: pg.PoolClient, orgId: string): Promise<boolean> {
  const r = await client.query<{ e: Record<string, unknown> }>(
    `SELECT p.entitlements_json AS e FROM subscriptions s JOIN plans p ON p.code = s.plan_code AND p.version = s.plan_version
      WHERE s.organization_id = $1 AND s.status IN ('active', 'past_due') ORDER BY s.created_at DESC LIMIT 1`,
    [orgId],
  );
  return r.rows[0]?.e.internal_review === true;
}

async function refreshSummary(client: pg.PoolClient, itemId: string, now: Date) {
  const states = (await client.query<{ editorial_status: EditorialState }>("SELECT editorial_status FROM content_variants WHERE content_item_id = $1", [itemId])).rows.map((r) => r.editorial_status);
  await client.query("UPDATE content_items SET summary_status = $2, updated_at = $3 WHERE id = $1", [itemId, summarizeItem(states), now]);
}

// ── Plans et sujets ───────────────────────────────────────────────────────

export async function createPlan(deps: AuthDeps, session: SessionInfo, orgId: string, brandId: string, input: { periodStart: string; periodEnd: string }, meta: RequestMeta): Promise<{ planId: string }> {
  const date = /^\d{4}-\d{2}-\d{2}$/;
  if (!date.test(input.periodStart) || !date.test(input.periodEnd) || input.periodEnd <= input.periodStart) throw new ServiceError("validation_failed", { fields: ["periodStart", "periodEnd"] });
  return asMember(deps, session, orgId, "content.edit", async ({ client }) => {
    if (!(await client.query("SELECT 1 FROM brands WHERE id = $1", [brandId])).rowCount) throw new ServiceError("not_found");
    const r = await client.query<{ id: string }>("INSERT INTO content_plans (organization_id, brand_id, period_start, period_end, status) VALUES ($1, $2, $3, $4, 'active') RETURNING id", [orgId, brandId, input.periodStart, input.periodEnd]);
    await audit(client, orgId, session.userId, "content_plan.created", { type: "content_plan", id: r.rows[0]!.id }, meta);
    return { planId: r.rows[0]!.id };
  });
}

export async function listPlans(deps: AuthDeps, session: SessionInfo, orgId: string, brandId: string) {
  return asMember(deps, session, orgId, "content.read", async ({ client }) =>
    (await client.query<{ id: string; period_start: string; period_end: string; status: string }>("SELECT id, to_char(period_start, 'YYYY-MM-DD') AS period_start, to_char(period_end, 'YYYY-MM-DD') AS period_end, status FROM content_plans WHERE brand_id = $1 ORDER BY period_start DESC", [brandId])).rows.map((r) => ({ id: r.id, periodStart: r.period_start, periodEnd: r.period_end, status: r.status })),
  );
}

export async function createItem(deps: AuthDeps, session: SessionInfo, orgId: string, planId: string, input: { topic: string; sourceFactIds?: string[] }, meta: RequestMeta): Promise<{ itemId: string }> {
  const topic = input.topic.trim();
  if (!topic || topic.length > 500) throw new ServiceError("validation_failed", { fields: ["topic"] });
  return asMember(deps, session, orgId, "content.edit", async ({ client }) => {
    if (!(await client.query("SELECT 1 FROM content_plans WHERE id = $1", [planId])).rowCount) throw new ServiceError("not_found");
    const r = await client.query<{ id: string }>("INSERT INTO content_items (organization_id, plan_id, topic, source_fact_ids) VALUES ($1, $2, $3, $4) RETURNING id", [orgId, planId, topic, input.sourceFactIds ?? []]);
    await audit(client, orgId, session.userId, "content_item.created", { type: "content_item", id: r.rows[0]!.id }, meta);
    return { itemId: r.rows[0]!.id };
  });
}

export async function updateItemTopic(deps: AuthDeps, session: SessionInfo, orgId: string, itemId: string, topic: string, expectedVersion: number, meta: RequestMeta): Promise<{ version: number }> {
  const t = topic.trim();
  if (!t || t.length > 500) throw new ServiceError("validation_failed", { fields: ["topic"] });
  return asMember(deps, session, orgId, "content.edit", async ({ client }) => {
    const r = await client.query<{ version: number }>("UPDATE content_items SET topic = $3, version = version + 1, updated_at = $4 WHERE id = $1 AND version = $2 RETURNING version", [itemId, expectedVersion, t, deps.clock.now()]);
    if (!r.rowCount) throw new ServiceError((await client.query("SELECT 1 FROM content_items WHERE id = $1", [itemId])).rowCount ? "stale_version" : "not_found");
    await audit(client, orgId, session.userId, "content_item.topic_changed", { type: "content_item", id: itemId }, meta);
    return { version: r.rows[0]!.version };
  });
}

// ── Lecture ───────────────────────────────────────────────────────────────

interface RevRow {
  id: string;
  number: number;
  caption: string;
  media_manifest: { mediaAssetId: string; sha256: string }[];
  hash: string;
  author_id: string | null;
  origin: RevisionView["origin"];
  created_at: Date;
}
const toRevision = (r: RevRow): RevisionView => ({ id: r.id, number: r.number, caption: r.caption, media: r.media_manifest, hash: r.hash, authorId: r.author_id, origin: r.origin, createdAt: r.created_at.toISOString() });

async function loadItem(client: pg.PoolClient, itemId: string): Promise<ItemView> {
  const i = (await client.query<{ id: string; plan_id: string; brand_id: string; topic: string; summary_status: EditorialState; version: number; source_fact_ids: string[] }>(
    "SELECT i.id, i.plan_id, p.brand_id, i.topic, i.summary_status, i.version, i.source_fact_ids FROM content_items i JOIN content_plans p ON p.id = i.plan_id WHERE i.id = $1",
    [itemId],
  )).rows[0];
  if (!i) throw new ServiceError("not_found");
  const variants = (await client.query<{ id: string; provider: Provider; locale: ContentLocale; editorial_status: EditorialState; version: number; current_revision_id: string | null; n: number }>(
    "SELECT v.id, v.provider, v.locale, v.editorial_status, v.version, v.current_revision_id, (SELECT count(*)::int FROM revisions r WHERE r.variant_id = v.id) AS n FROM content_variants v WHERE v.content_item_id = $1 ORDER BY v.locale, v.provider",
    [itemId],
  )).rows;
  const out: VariantView[] = [];
  for (const v of variants) {
    const cur = v.current_revision_id ? (await client.query<RevRow>("SELECT id, number, caption, media_manifest, hash, author_id, origin, created_at FROM revisions WHERE id = $1", [v.current_revision_id])).rows[0] : undefined;
    out.push({ id: v.id, provider: v.provider, locale: v.locale, status: v.editorial_status, version: v.version, current: cur ? toRevision(cur) : null, revisionCount: v.n });
  }
  return { id: i.id, planId: i.plan_id, brandId: i.brand_id, topic: i.topic, summaryStatus: i.summary_status, version: i.version, sourceFactIds: i.source_fact_ids, variants: out };
}

export async function getItem(deps: AuthDeps, session: SessionInfo, orgId: string, itemId: string): Promise<ItemView> {
  return asMember(deps, session, orgId, "content.read", ({ client }) => loadItem(client, itemId));
}

export async function listItems(deps: AuthDeps, session: SessionInfo, orgId: string, brandId: string): Promise<{ id: string; topic: string; summaryStatus: EditorialState; variants: number; updatedAt: string }[]> {
  return asMember(deps, session, orgId, "content.read", async ({ client }) =>
    (
      await client.query<{ id: string; topic: string; summary_status: EditorialState; n: number; updated_at: Date }>(
        `SELECT i.id, i.topic, i.summary_status, (SELECT count(*)::int FROM content_variants v WHERE v.content_item_id = i.id) AS n, i.updated_at
           FROM content_items i JOIN content_plans p ON p.id = i.plan_id WHERE p.brand_id = $1 ORDER BY i.updated_at DESC LIMIT 200`,
        [brandId],
      )
    ).rows.map((r) => ({ id: r.id, topic: r.topic, summaryStatus: r.summary_status, variants: r.n, updatedAt: r.updated_at.toISOString() })),
  );
}

export async function listRevisions(deps: AuthDeps, session: SessionInfo, orgId: string, variantId: string): Promise<RevisionView[]> {
  return asMember(deps, session, orgId, "content.read", async ({ client }) => {
    if (!(await client.query("SELECT 1 FROM content_variants WHERE id = $1", [variantId])).rowCount) throw new ServiceError("not_found");
    return (await client.query<RevRow>("SELECT id, number, caption, media_manifest, hash, author_id, origin, created_at FROM revisions WHERE variant_id = $1 ORDER BY number DESC", [variantId])).rows.map(toRevision);
  });
}

// ── Variantes et révisions ────────────────────────────────────────────────

export async function addVariant(deps: AuthDeps, session: SessionInfo, orgId: string, itemId: string, input: { provider: Provider; locale: ContentLocale }, meta: RequestMeta): Promise<{ variantId: string }> {
  return asMember(deps, session, orgId, "content.edit", async ({ client }) => {
    if (!(await client.query("SELECT 1 FROM content_items WHERE id = $1 FOR UPDATE", [itemId])).rowCount) throw new ServiceError("not_found");
    const exists = await client.query("SELECT 1 FROM content_variants WHERE content_item_id = $1 AND provider = $2 AND locale = $3", [itemId, input.provider, input.locale]);
    if (exists.rowCount) throw new ServiceError("conflict", { reason: "variant_exists" });
    const r = await client.query<{ id: string }>("INSERT INTO content_variants (organization_id, content_item_id, provider, locale) VALUES ($1, $2, $3, $4) RETURNING id", [orgId, itemId, input.provider, input.locale]);
    await refreshSummary(client, itemId, deps.clock.now());
    await audit(client, orgId, session.userId, "content_variant.created", { type: "content_variant", id: r.rows[0]!.id }, meta, input);
    return { variantId: r.rows[0]!.id };
  });
}

/**
 * Nouvelle révision immuable. Révision + invalidation des approbations + retour au brouillon + crédit, atomiquement.
 * `origin = "ai"` est réservé au pipeline de génération (E13), qui gère sa propre réservation.
 */
export async function createRevision(
  deps: AuthDeps,
  session: SessionInfo,
  orgId: string,
  variantId: string,
  input: { caption: string; mediaAssetIds: string[]; expectedVersion: number },
  meta: RequestMeta,
): Promise<{ revisionId: string; number: number; version: number; hash: string }> {
  const caption = input.caption.normalize("NFC");
  if (caption.trim().length === 0 || caption.length > MAX_CAPTION) throw new ServiceError("validation_failed", { fields: ["caption"] });
  if (new Set(input.mediaAssetIds).size !== input.mediaAssetIds.length || input.mediaAssetIds.length > 10) throw new ServiceError("validation_failed", { fields: ["mediaAssetIds"] });
  return asMember(deps, session, orgId, "content.edit", async ({ client }) => {
    const now = deps.clock.now();
    const v = (await client.query<{ id: string; content_item_id: string; provider: Provider; locale: ContentLocale; editorial_status: EditorialState; version: number }>(
      "SELECT id, content_item_id, provider, locale, editorial_status, version FROM content_variants WHERE id = $1 FOR UPDATE",
      [variantId],
    )).rows[0];
    if (!v) throw new ServiceError("not_found");
    if (v.version !== input.expectedVersion) throw new ServiceError("stale_version", { currentVersion: v.version });
    let next: EditorialState;
    try {
      next = transition(v.editorial_status, { type: "new_revision" });
    } catch (e) {
      if (e instanceof InvalidTransition) throw new ServiceError("business_rule", { reason: "invalid_transition", from: v.editorial_status });
      throw e;
    }
    await assertMediaPublishable(client, input.mediaAssetIds);
    const shas = new Map((await client.query<{ id: string; sha256: string }>("SELECT id, sha256 FROM media_assets WHERE id = ANY($1::uuid[])", [input.mediaAssetIds])).rows.map((r) => [r.id, r.sha256]));
    const media = input.mediaAssetIds.map((id) => ({ mediaAssetId: id, sha256: shas.get(id)! }));
    const hash = computeRevisionHash({ caption, locale: v.locale, provider: v.provider, media });
    const number = (await client.query<{ n: number }>("SELECT coalesce(max(number), 0)::int + 1 AS n FROM revisions WHERE variant_id = $1", [variantId])).rows[0]!.n;

    // Crédit de contenu : première révision persistée du sujet (idempotent par sujet).
    await reserve(client, { organizationId: orgId, type: "content_item", resourceId: v.content_item_id, now });
    await consume(client, "content_item", v.content_item_id, now);

    const rev = (await client.query<{ id: string }>(
      "INSERT INTO revisions (organization_id, variant_id, number, caption, media_manifest, hash, author_id, origin, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual', $8) RETURNING id",
      [orgId, variantId, number, caption, JSON.stringify(media), hash, session.userId, now],
    )).rows[0]!;
    const invalidated = await client.query(
      "UPDATE approvals SET invalidated_at = $2, invalidated_reason = 'revision_superseded' WHERE invalidated_at IS NULL AND revision_id IN (SELECT id FROM revisions WHERE variant_id = $1 AND id <> $3)",
      [variantId, now, rev.id],
    );
    const upd = await client.query<{ version: number }>("UPDATE content_variants SET current_revision_id = $2, editorial_status = $3, version = version + 1, updated_at = $4 WHERE id = $1 RETURNING version", [variantId, rev.id, next, now]);
    await refreshSummary(client, v.content_item_id, now);
    await audit(client, orgId, session.userId, "revision.created", { type: "revision", id: rev.id }, meta, { number, approvalsInvalidated: invalidated.rowCount ?? 0 });
    return { revisionId: rev.id, number, version: upd.rows[0]!.version, hash };
  });
}

const USER_EVENTS = ["submit", "archive", "restore"] as const;
export type UserEditorialEvent = (typeof USER_EVENTS)[number];

/** Transitions déclenchées par l'éditeur. L'approbation et les demandes de correction relèvent d'E15. */
export async function applyVariantEvent(deps: AuthDeps, session: SessionInfo, orgId: string, variantId: string, event: UserEditorialEvent, expectedVersion: number, meta: RequestMeta): Promise<{ status: EditorialState; version: number }> {
  if (!(USER_EVENTS as readonly string[]).includes(event)) throw new ServiceError("validation_failed", { fields: ["event"] });
  return asMember(deps, session, orgId, "content.edit", async ({ client }) => {
    const v = (await client.query<{ content_item_id: string; editorial_status: EditorialState; version: number; current_revision_id: string | null }>("SELECT content_item_id, editorial_status, version, current_revision_id FROM content_variants WHERE id = $1 FOR UPDATE", [variantId])).rows[0];
    if (!v) throw new ServiceError("not_found");
    if (v.version !== expectedVersion) throw new ServiceError("stale_version", { currentVersion: v.version });
    if (event === "submit" && !v.current_revision_id) throw new ServiceError("business_rule", { reason: "no_revision" });
    const ev: EditorialEvent = event === "submit" ? { type: "submit", internalReview: await internalReviewEnabled(client, orgId) } : { type: event };
    let next: EditorialState;
    try {
      next = transition(v.editorial_status, ev);
    } catch (e) {
      if (e instanceof InvalidTransition) throw new ServiceError("business_rule", { reason: "invalid_transition", from: v.editorial_status });
      throw e;
    }
    const r = await client.query<{ version: number }>("UPDATE content_variants SET editorial_status = $2, version = version + 1, updated_at = $3 WHERE id = $1 RETURNING version", [variantId, next, deps.clock.now()]);
    await refreshSummary(client, v.content_item_id, deps.clock.now());
    await audit(client, orgId, session.userId, `content_variant.${event}`, { type: "content_variant", id: variantId }, meta, { from: v.editorial_status, to: next });
    return { status: next, version: r.rows[0]!.version };
  });
}

// ── Commentaires ──────────────────────────────────────────────────────────

export async function addComment(deps: AuthDeps, session: SessionInfo, orgId: string, itemId: string, input: { body: string; revisionId?: string }, meta: RequestMeta): Promise<{ commentId: string }> {
  const body = input.body.trim();
  if (!body || body.length > 5000) throw new ServiceError("validation_failed", { fields: ["body"] });
  return asMember(deps, session, orgId, "content.comment", async ({ client }) => {
    if (!(await client.query("SELECT 1 FROM content_items WHERE id = $1", [itemId])).rowCount) throw new ServiceError("not_found");
    if (input.revisionId) {
      const ok = await client.query("SELECT 1 FROM revisions r JOIN content_variants v ON v.id = r.variant_id WHERE r.id = $1 AND v.content_item_id = $2", [input.revisionId, itemId]);
      if (!ok.rowCount) throw new ServiceError("not_found");
    }
    const r = await client.query<{ id: string }>("INSERT INTO comments (organization_id, content_item_id, revision_id, body, author_id, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id", [orgId, itemId, input.revisionId ?? null, body, session.userId, deps.clock.now()]);
    await audit(client, orgId, session.userId, "comment.created", { type: "comment", id: r.rows[0]!.id }, meta);
    return { commentId: r.rows[0]!.id };
  });
}

export async function listComments(deps: AuthDeps, session: SessionInfo, orgId: string, itemId: string): Promise<{ id: string; body: string; authorEmail: string | null; revisionId: string | null; createdAt: string }[]> {
  return asMember(deps, session, orgId, "content.read", async ({ client }) => {
    if (!(await client.query("SELECT 1 FROM content_items WHERE id = $1", [itemId])).rowCount) throw new ServiceError("not_found");
    return (
      await client.query<{ id: string; body: string; email: string | null; revision_id: string | null; created_at: Date }>(
        "SELECT c.id, c.body, u.email, c.revision_id, c.created_at FROM comments c LEFT JOIN users u ON u.id = c.author_id WHERE c.content_item_id = $1 ORDER BY c.created_at",
        [itemId],
      )
    ).rows.map((r) => ({ id: r.id, body: r.body, authorEmail: r.email, revisionId: r.revision_id, createdAt: r.created_at.toISOString() }));
  });
}

/** Création rapide depuis l'interface : rattache le sujet au plan éditorial couvrant aujourd'hui (créé au besoin pour le mois). */
export async function createItemForBrand(deps: AuthDeps, session: SessionInfo, orgId: string, brandId: string, topic: string, meta: RequestMeta): Promise<{ itemId: string }> {
  const planId = await asMember(deps, session, orgId, "content.edit", async ({ client }) => {
    if (!(await client.query("SELECT 1 FROM brands WHERE id = $1", [brandId])).rowCount) throw new ServiceError("not_found");
    const today = deps.clock.now().toISOString().slice(0, 10);
    const found = (await client.query<{ id: string }>("SELECT id FROM content_plans WHERE brand_id = $1 AND status = 'active' AND period_start <= $2 AND period_end > $2 ORDER BY period_start DESC LIMIT 1", [brandId, today])).rows[0];
    if (found) return found.id;
    const d = deps.clock.now();
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
    return (await client.query<{ id: string }>("INSERT INTO content_plans (organization_id, brand_id, period_start, period_end, status) VALUES ($1, $2, $3, $4, 'active') RETURNING id", [orgId, brandId, start, end])).rows[0]!.id;
  });
  return createItem(deps, session, orgId, planId, { topic }, meta);
}
