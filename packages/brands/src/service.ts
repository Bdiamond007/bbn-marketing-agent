/**
 * Marques et profil versionné (BRAND-01, E09).
 * - Brouillon reprenable en base, concurrence optimiste (expectedVersion ⇒ 409 si obsolète).
 * - Publication = nouvelle version immuable de brand_guidelines + mise à jour de la marque.
 * - Changer le fuseau de la marque ne déplace aucun envoi existant (les envois stockent leur propre fuseau).
 */
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { asMember, type AuthDeps, type RequestMeta, type SessionInfo } from "@bbn/auth";
import {
  brandDraftSchema,
  factProblems,
  isIanaTimeZone,
  missingRequiredFields,
  ServiceError,
  usableFacts,
  type BrandDraft,
  type Fact,
  type FactProblem,
  type RequiredField,
} from "@bbn/domain";

export interface BrandView {
  id: string;
  name: string;
  status: "draft" | "active" | "archived";
  timezone: string;
  defaultContentLocale: "fr-CA" | "en-CA";
  profileVersion: number;
  draft: BrandDraft;
  draftVersion: number;
  missing: RequiredField[];
  factProblems: FactProblem[];
  published: { version: number; profile: BrandDraft; createdAt: string } | null;
}

async function audit(client: pg.PoolClient, orgId: string, actorId: string, action: string, brandId: string, meta: RequestMeta, safe: Record<string, unknown> = {}) {
  await client.query(
    "INSERT INTO audit_events (organization_id, actor_id, actor_kind, action, target_type, target_id, safe_metadata, request_id) VALUES ($1, $2, 'user', $3, 'brand', $4, $5, $6)",
    [orgId, actorId, action, brandId, JSON.stringify(safe), meta.requestId],
  );
}

/** Nombre de marques actives permis : droit « brands » du cycle courant, à défaut 1 (MVP). */
async function brandLimit(client: pg.PoolClient, orgId: string, now: Date): Promise<number> {
  const r = await client.query<{ total: number | null }>(
    `SELECT sum(e.limit_value)::int AS total FROM entitlements e JOIN billing_cycles c ON c.id = e.cycle_id
      WHERE c.organization_id = $1 AND c.starts_at <= $2 AND c.ends_at > $2 AND e.key = 'brands' AND e.effective_from <= $2 AND e.effective_to > $2`,
    [orgId, now],
  );
  return r.rows[0]?.total ?? 1;
}

export async function createBrand(
  deps: AuthDeps,
  session: SessionInfo,
  orgId: string,
  input: { name: string; timezone: string; defaultContentLocale: "fr-CA" | "en-CA" },
  meta: RequestMeta,
): Promise<{ brandId: string }> {
  const name = input.name.trim();
  if (!name || name.length > 200) throw new ServiceError("validation_failed", { fields: ["name"] });
  if (!isIanaTimeZone(input.timezone)) throw new ServiceError("validation_failed", { fields: ["timezone"] });
  return asMember(deps, session, orgId, "brand.edit", async ({ client }) => {
    // Verrou par organisation : deux créations simultanées ne contournent pas la limite.
    await client.query("SELECT 1 FROM organizations WHERE id = $1 FOR UPDATE", [orgId]);
    const count = (await client.query<{ n: number }>("SELECT count(*)::int AS n FROM brands WHERE organization_id = $1 AND status <> 'archived'", [orgId])).rows[0]!.n;
    if (count >= (await brandLimit(client, orgId, deps.clock.now()))) throw new ServiceError("business_rule", { reason: "brand_limit_reached" });
    const brandId = randomUUID();
    await client.query("INSERT INTO brands (id, organization_id, name, timezone, default_content_locale, status) VALUES ($1, $2, $3, $4, $5, 'draft')", [brandId, orgId, name, input.timezone, input.defaultContentLocale]);
    const draft: BrandDraft = { name, timezone: input.timezone, defaultContentLocale: input.defaultContentLocale, facts: [] };
    await client.query("INSERT INTO brand_drafts (brand_id, organization_id, draft_json, updated_by) VALUES ($1, $2, $3, $4)", [brandId, orgId, JSON.stringify(draft), session.userId]);
    await audit(client, orgId, session.userId, "brand.created", brandId, meta);
    return { brandId };
  });
}

async function loadView(client: pg.PoolClient, brandId: string): Promise<BrandView> {
  const b = (await client.query<{ id: string; name: string; status: BrandView["status"]; timezone: string; default_content_locale: BrandView["defaultContentLocale"]; profile_version: number }>(
    "SELECT id, name, status, timezone, default_content_locale, profile_version FROM brands WHERE id = $1",
    [brandId],
  )).rows[0];
  if (!b) throw new ServiceError("not_found");
  const d = (await client.query<{ draft_json: unknown; version: number }>("SELECT draft_json, version FROM brand_drafts WHERE brand_id = $1", [brandId])).rows[0];
  const parsed = brandDraftSchema.safeParse(d?.draft_json ?? {});
  const draft = parsed.success ? parsed.data : {};
  const g = (await client.query<{ version: number; facts_json: { profile?: unknown }; created_at: Date }>("SELECT version, facts_json, created_at FROM brand_guidelines WHERE brand_id = $1 ORDER BY version DESC LIMIT 1", [brandId])).rows[0];
  const published = g ? brandDraftSchema.safeParse(g.facts_json.profile ?? {}) : null;
  return {
    id: b.id,
    name: b.name,
    status: b.status,
    timezone: b.timezone,
    defaultContentLocale: b.default_content_locale,
    profileVersion: b.profile_version,
    draft,
    draftVersion: d?.version ?? 0,
    missing: missingRequiredFields(draft),
    factProblems: factProblems(draft.facts ?? []),
    published: g && published?.success ? { version: g.version, profile: published.data, createdAt: g.created_at.toISOString() } : null,
  };
}

export async function listBrands(deps: AuthDeps, session: SessionInfo, orgId: string): Promise<{ id: string; name: string; status: string }[]> {
  return asMember(deps, session, orgId, "brand.read", async ({ client }) => (await client.query<{ id: string; name: string; status: string }>("SELECT id, name, status FROM brands WHERE organization_id = $1 AND status <> 'archived' ORDER BY created_at", [orgId])).rows);
}

export async function getBrand(deps: AuthDeps, session: SessionInfo, orgId: string, brandId: string): Promise<BrandView> {
  return asMember(deps, session, orgId, "brand.read", ({ client }) => loadView(client, brandId));
}

/** Enregistre le brouillon (reprise). Une version obsolète renvoie 409 sans rien écraser. */
export async function saveDraft(deps: AuthDeps, session: SessionInfo, orgId: string, brandId: string, draftInput: unknown, expectedVersion: number, meta: RequestMeta): Promise<{ draftVersion: number }> {
  const parsed = brandDraftSchema.safeParse(draftInput);
  if (!parsed.success) throw new ServiceError("validation_failed", { fields: [...new Set(parsed.error.issues.map((i) => i.path.join(".")))] });
  return asMember(deps, session, orgId, "brand.edit", async ({ client }) => {
    const r = await client.query<{ version: number }>(
      "UPDATE brand_drafts SET draft_json = $3, version = version + 1, updated_by = $4, updated_at = $5 WHERE brand_id = $1 AND version = $2 RETURNING version",
      [brandId, expectedVersion, JSON.stringify(parsed.data), session.userId, deps.clock.now()],
    );
    if (!r.rowCount) {
      const exists = await client.query("SELECT 1 FROM brand_drafts WHERE brand_id = $1", [brandId]);
      throw new ServiceError(exists.rowCount ? "stale_version" : "not_found");
    }
    await audit(client, orgId, session.userId, "brand.draft_saved", brandId, meta);
    return { draftVersion: r.rows[0]!.version };
  });
}

/** Publie le brouillon en nouvelle version immuable ; refuse un profil incomplet ou des faits non datés. */
export async function publishProfile(deps: AuthDeps, session: SessionInfo, orgId: string, brandId: string, expectedDraftVersion: number, meta: RequestMeta): Promise<{ profileVersion: number }> {
  return asMember(deps, session, orgId, "brand.edit", async ({ client }) => {
    await client.query("SELECT 1 FROM brands WHERE id = $1 FOR UPDATE", [brandId]);
    const view = await loadView(client, brandId);
    if (view.draftVersion !== expectedDraftVersion) throw new ServiceError("stale_version");
    if (view.missing.length > 0) throw new ServiceError("business_rule", { reason: "brand_incomplete", missing: view.missing });
    if (view.factProblems.length > 0) throw new ServiceError("business_rule", { reason: "facts_missing_validity", facts: view.factProblems.map((p) => p.factId) });
    const d = view.draft;
    const version = view.profileVersion + 1;
    await client.query("INSERT INTO brand_guidelines (organization_id, brand_id, version, facts_json, tone_json, created_by) VALUES ($1, $2, $3, $4, $5, $6)", [
      orgId, brandId, version, JSON.stringify({ profile: d, facts: d.facts ?? [] }), JSON.stringify(d.tone ?? {}), session.userId,
    ]);
    await client.query(
      "UPDATE brands SET name = $2, sector = $3, timezone = $4, default_content_locale = $5, profile_version = $6, status = 'active', version = version + 1, updated_at = $7 WHERE id = $1",
      [brandId, d.name, d.sector, d.timezone, d.defaultContentLocale, version, deps.clock.now()],
    );
    await audit(client, orgId, session.userId, "brand.profile_published", brandId, meta, { version, timezoneChanged: d.timezone !== view.timezone });
    return { profileVersion: version };
  });
}

export interface GenerationContext {
  brandId: string;
  profileVersion: number;
  profile: BrandDraft;
  facts: Fact[];
  excludedFacts: { expired: string[]; notYetValid: string[]; unconfirmed: string[] };
}

/**
 * Contexte de génération (consommé par E13) : profil publié requis, seuls les faits confirmés et
 * valides à la date du jour (fuseau de la marque) sont transmis. Sinon 422 brand_incomplete.
 */
export async function loadGenerationContext(client: pg.PoolClient, brandId: string, now: Date): Promise<GenerationContext> {
  const view = await loadView(client, brandId);
  if (!view.published || view.status !== "active") throw new ServiceError("business_rule", { reason: "brand_incomplete", missing: view.missing.length ? view.missing : ["published_profile"] });
  const p = view.published.profile;
  const missing = missingRequiredFields(p);
  if (missing.length > 0) throw new ServiceError("business_rule", { reason: "brand_incomplete", missing });
  const split = usableFacts(p.facts ?? [], now, p.timezone!);
  return {
    brandId,
    profileVersion: view.published.version,
    profile: p,
    facts: split.usable,
    excludedFacts: { expired: split.expired.map((f) => f.id), notYetValid: split.notYetValid.map((f) => f.id), unconfirmed: split.unconfirmed.map((f) => f.id) },
  };
}
