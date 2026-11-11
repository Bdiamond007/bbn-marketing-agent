/**
 * Génération IA asynchrone (AI-01, E13).
 * Demande (transaction) : droits de facturation, profil publié, quota réservé AVANT le job, variantes « generating »,
 * job + événement d'outbox atomiques ; Idempotency-Key (même charge ⇒ même job, charge différente ⇒ conflit).
 * Exécution : réclamation (≤ 2 jobs en cours par organisation), appels IA HORS transaction, validation indépendante,
 * puis résultats en une transaction : révisions « ai », consommation si au moins une proposition exploitable,
 * libération sinon (erreur technique ou sorties invalides : aucun débit indu). Une ancienne révision n'est jamais supprimée.
 */
import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import { asMember, type AuthDeps, type RequestMeta, type SessionInfo } from "@bbn/auth";
import { assertBillingAllows, consume, release, reserve } from "@bbn/billing";
import { loadGenerationContext } from "@bbn/brands";
import { isUuid, withTenant } from "@bbn/db";
import { computeRevisionHash, InvalidTransition, ServiceError, summarizeItem, transition, type EditorialState } from "@bbn/domain";
import { AiProviderError, type AiTextProvider } from "@bbn/integrations";
import { enqueue, type Envelope } from "@bbn/jobs";
import { buildCaptionPrompt, type Locale, type Provider } from "./prompts";
import { validateOutput, type Violation } from "./validate";

export interface AiDeps extends AuthDeps {
  ai: AiTextProvider;
  aiModel: string;
  simulation: boolean;
  /** Coûts unitaires (micro-dollars par jeton) pour l'estimation ; 0 en simulation. */
  costMicros?: { input: number; output: number };
}

export const MAX_RUNNING_PER_ORG = 2;
export const MAX_ATTEMPTS_PER_TARGET = 2;
export const AI_TIMEOUT_MS = 60_000;
export const STALE_AFTER_MS = 15 * 60_000;

export interface Target {
  provider: Provider;
  locale: Locale;
}
export interface TargetResult extends Target {
  ok: boolean;
  revisionNumber?: number;
  violations?: Violation[];
  errorClass?: "timeout" | "rate_limited" | "provider_error" | "invalid_output";
}
export interface JobView {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  mode: "initial" | "regenerate";
  results: TargetResult[];
  safeErrorCode: string | null;
}

const fingerprint = (itemId: string, targets: Target[], mode: string) =>
  createHash("sha256").update(JSON.stringify({ itemId, mode, targets: [...targets].map((t) => `${t.provider}|${t.locale}`).sort() })).digest("hex");

async function audit(client: pg.PoolClient, orgId: string, actorId: string | null, action: string, jobId: string, safe: Record<string, unknown>, requestId: string | null) {
  await client.query("INSERT INTO audit_events (organization_id, actor_id, actor_kind, action, target_type, target_id, safe_metadata, request_id) VALUES ($1, $2, $3, $4, 'ai_job', $5, $6, $7)", [
    orgId, actorId, actorId ? "user" : "system", action, jobId, JSON.stringify(safe), requestId,
  ]);
}

async function refreshSummary(client: pg.PoolClient, itemId: string, now: Date) {
  const states = (await client.query<{ editorial_status: EditorialState }>("SELECT editorial_status FROM content_variants WHERE content_item_id = $1", [itemId])).rows.map((r) => r.editorial_status);
  await client.query("UPDATE content_items SET summary_status = $2, updated_at = $3 WHERE id = $1", [itemId, summarizeItem(states), now]);
}

export async function startGeneration(
  deps: AiDeps,
  session: SessionInfo,
  orgId: string,
  itemId: string,
  input: { targets: Target[]; mode: "initial" | "regenerate"; idempotencyKey?: string },
  meta: RequestMeta,
): Promise<{ jobId: string; outboxId: string | null; reused: boolean }> {
  const targets = input.targets;
  if (targets.length < 1 || targets.length > 6 || new Set(targets.map((t) => `${t.provider}|${t.locale}`)).size !== targets.length) throw new ServiceError("validation_failed", { fields: ["targets"] });
  if (input.idempotencyKey !== undefined && !/^[\w.:-]{8,100}$/.test(input.idempotencyKey)) throw new ServiceError("validation_failed", { fields: ["idempotencyKey"] });
  const fp = fingerprint(itemId, targets, input.mode);
  return asMember(deps, session, orgId, "content.edit", async ({ client }) => {
    const now = deps.clock.now();
    if (input.idempotencyKey) {
      const existing = (await client.query<{ id: string; request_fingerprint: string }>("SELECT id, request_fingerprint FROM ai_jobs WHERE idempotency_key = $1", [input.idempotencyKey])).rows[0];
      if (existing) {
        if (existing.request_fingerprint !== fp) throw new ServiceError("conflict", { reason: "idempotency_key_reused" });
        return { jobId: existing.id, outboxId: null, reused: true };
      }
    }
    await assertBillingAllows(client, orgId, now, "generate");
    const item = (await client.query<{ brand_id: string }>("SELECT p.brand_id FROM content_items i JOIN content_plans p ON p.id = i.plan_id WHERE i.id = $1 FOR UPDATE OF i", [itemId])).rows[0];
    if (!item) throw new ServiceError("not_found");
    await loadGenerationContext(client, item.brand_id, now); // 422 brand_incomplete si profil non publié/incomplet

    const jobId = randomUUID();
    if (input.mode === "initial") await reserve(client, { organizationId: orgId, type: "content_item", resourceId: itemId, now });
    else await reserve(client, { organizationId: orgId, type: "regeneration", resourceId: jobId, parentResourceId: itemId, now });

    for (const t of targets) {
      let v = (await client.query<{ id: string; editorial_status: EditorialState }>("SELECT id, editorial_status FROM content_variants WHERE content_item_id = $1 AND provider = $2 AND locale = $3 FOR UPDATE", [itemId, t.provider, t.locale])).rows[0];
      if (!v) v = (await client.query<{ id: string; editorial_status: EditorialState }>("INSERT INTO content_variants (organization_id, content_item_id, provider, locale) VALUES ($1, $2, $3, $4) RETURNING id, editorial_status", [orgId, itemId, t.provider, t.locale])).rows[0]!;
      let next: EditorialState;
      try {
        next = transition(v.editorial_status, { type: "start_generation" });
      } catch (e) {
        if (e instanceof InvalidTransition) throw new ServiceError("business_rule", { reason: "invalid_transition", from: v.editorial_status });
        throw e;
      }
      await client.query("UPDATE content_variants SET editorial_status = $2, version = version + 1, updated_at = $3 WHERE id = $1", [v.id, next, now]);
    }
    await refreshSummary(client, itemId, now);
    await client.query(
      `INSERT INTO ai_jobs (id, organization_id, brand_id, content_item_id, prompt_version, model, status, mode, targets, idempotency_key, request_fingerprint, correlation_id, created_by, created_at)
       VALUES ($1, $2, $3, $4, 'caption-v1', $5, 'queued', $6, $7, $8, $9, $10, $11, $12)`,
      [jobId, orgId, item.brand_id, itemId, deps.aiModel, input.mode, JSON.stringify(targets), input.idempotencyKey ?? null, fp, meta.requestId, session.userId, now],
    );
    const outboxId = await enqueue(client, { organizationId: orgId, type: "ai.generate", queue: "generation", aggregateType: "ai_job", aggregateId: jobId, payload: { jobId }, correlationId: meta.requestId, dedupeKey: `ai-job:${jobId}` });
    await audit(client, orgId, session.userId, "ai_job.queued", jobId, { mode: input.mode, targets: targets.length }, meta.requestId);
    return { jobId, outboxId, reused: false };
  });
}

interface JobRow {
  id: string;
  brand_id: string;
  content_item_id: string;
  status: JobView["status"];
  mode: JobView["mode"];
  targets: Target[];
  correlation_id: string | null;
}

/**
 * Traite le message « ai.generate ». Idempotent par l'état du job (seul un job « queued » est réclamé).
 * Renvoie "deferred" si l'organisation a déjà le maximum de jobs en cours (l'événement est replanifié).
 */
export async function processGenerationMessage(deps: AiDeps, env: Envelope<{ jobId?: string }>): Promise<"done" | "skipped" | "deferred"> {
  const jobId = env.payload?.jobId;
  if (!isUuid(jobId) || !isUuid(env.organizationId)) return "skipped";
  const orgId = env.organizationId;
  const now = deps.clock.now();

  // 1) Réclamation (transaction courte), avec limite de concurrence par organisation.
  const claim = await withTenant(deps.pool, { organizationId: orgId, userId: null }, async ({ client }) => {
    await client.query("SELECT 1 FROM organizations WHERE id = $1 FOR UPDATE", [orgId]);
    const job = (await client.query<JobRow>("SELECT id, brand_id, content_item_id, status, mode, targets, correlation_id FROM ai_jobs WHERE id = $1", [jobId])).rows[0];
    if (!job || job.status !== "queued") return { kind: "skipped" as const };
    const running = (await client.query<{ n: number }>("SELECT count(*)::int AS n FROM ai_jobs WHERE status = 'running'")).rows[0]!.n;
    if (running >= MAX_RUNNING_PER_ORG) {
      await enqueue(client, { organizationId: orgId, type: "ai.generate", queue: "generation", aggregateType: "ai_job", aggregateId: jobId, payload: { jobId }, correlationId: env.correlationId, dedupeKey: `ai-job:${jobId}:deferred:${now.getTime()}`, availableAt: new Date(now.getTime() + 30_000) });
      return { kind: "deferred" as const };
    }
    await client.query("UPDATE ai_jobs SET status = 'running', started_at = $2 WHERE id = $1", [jobId, now]);
    const ctx = await loadGenerationContext(client, job.brand_id, now).catch(() => null);
    const topic = (await client.query<{ topic: string }>("SELECT topic FROM content_items WHERE id = $1", [job.content_item_id])).rows[0]!.topic;
    const recent = (await client.query<{ topic: string }>("SELECT i.topic FROM content_items i JOIN content_plans p ON p.id = i.plan_id WHERE p.brand_id = $1 AND i.id <> $2 ORDER BY i.created_at DESC LIMIT 10", [job.brand_id, job.content_item_id])).rows.map((r) => r.topic);
    return { kind: "claimed" as const, job, ctx, topic, recent };
  });
  if (claim.kind !== "claimed") return claim.kind;
  const { job, ctx, topic, recent } = claim;

  // 2) Appels IA hors transaction.
  const results: TargetResult[] = [];
  const outputs = new Map<string, { caption: string }>();
  let inTok = 0;
  let outTok = 0;
  const t0 = Date.now();
  for (const t of job.targets) {
    if (!ctx) {
      results.push({ ...t, ok: false, errorClass: "invalid_output", violations: [] });
      continue;
    }
    const prompt = buildCaptionPrompt({ locale: t.locale, provider: t.provider, topic, profile: ctx.profile, facts: ctx.facts, recentTopics: recent });
    let done = false;
    let lastViolations: Violation[] = [];
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_TARGET && !done; attempt++) {
      try {
        const r = await deps.ai.generate({
          promptVersion: prompt.promptVersion,
          model: deps.aiModel,
          locale: t.locale,
          instructions: attempt === 1 ? prompt.instructions : `${prompt.instructions}\nYour previous answer was rejected for: ${lastViolations.join(", ")}. Follow the rules strictly.`,
          untrustedContext: prompt.untrustedContext,
          timeoutMs: AI_TIMEOUT_MS,
        });
        inTok += r.usage.inputTokens;
        outTok += r.usage.outputTokens;
        const v = validateOutput(r.outputText, { locale: t.locale, provider: t.provider, facts: ctx.facts, expiredFacts: ctx.expiredFacts, avoid: ctx.profile.tone?.avoid ?? [] });
        if (v.ok) {
          outputs.set(`${t.provider}|${t.locale}`, { caption: v.output.caption });
          results.push({ ...t, ok: true });
          done = true;
        } else lastViolations = v.violations;
      } catch (e) {
        const errorClass = e instanceof AiProviderError || (e instanceof Error && e.name === "AiProviderError") ? (e as AiProviderError).errorClass : "provider_error";
        results.push({ ...t, ok: false, errorClass });
        done = true; // erreur technique : pas de nouvel essai coûteux dans ce job
      }
    }
    if (!done) results.push({ ...t, ok: false, errorClass: "invalid_output", violations: lastViolations });
  }
  const latencyMs = Date.now() - t0;

  // 3) Résultats (transaction) : révisions, états, quota, job.
  await withTenant(deps.pool, { organizationId: orgId, userId: null }, async ({ client }) => {
    const still = (await client.query<{ status: string }>("SELECT status FROM ai_jobs WHERE id = $1 FOR UPDATE", [jobId])).rows[0];
    if (still?.status !== "running") return; // récupéré entre-temps (job déclaré bloqué)
    const at = deps.clock.now();
    for (const r of results) {
      const v = (await client.query<{ id: string; editorial_status: EditorialState }>("SELECT id, editorial_status FROM content_variants WHERE content_item_id = $1 AND provider = $2 AND locale = $3 FOR UPDATE", [job.content_item_id, r.provider, r.locale])).rows[0];
      if (!v) continue;
      const out = outputs.get(`${r.provider}|${r.locale}`);
      if (r.ok && out) {
        const hash = computeRevisionHash({ caption: out.caption.normalize("NFC"), locale: r.locale, provider: r.provider, media: [] });
        const number = (await client.query<{ n: number }>("SELECT coalesce(max(number), 0)::int + 1 AS n FROM revisions WHERE variant_id = $1", [v.id])).rows[0]!.n;
        const rev = (await client.query<{ id: string }>("INSERT INTO revisions (organization_id, variant_id, number, caption, media_manifest, hash, author_id, origin, created_at) VALUES ($1, $2, $3, $4, '[]', $5, NULL, 'ai', $6) RETURNING id", [orgId, v.id, number, out.caption.normalize("NFC"), hash, at])).rows[0]!;
        await client.query("UPDATE approvals SET invalidated_at = $2, invalidated_reason = 'revision_superseded' WHERE invalidated_at IS NULL AND revision_id IN (SELECT id FROM revisions WHERE variant_id = $1 AND id <> $3)", [v.id, at, rev.id]);
        const next = v.editorial_status === "generating" ? transition("generating", { type: "generation_finished" }) : v.editorial_status;
        await client.query("UPDATE content_variants SET current_revision_id = $2, editorial_status = $3, version = version + 1, updated_at = $4 WHERE id = $1", [v.id, rev.id, next, at]);
        r.revisionNumber = number;
      } else if (v.editorial_status === "generating") {
        await client.query("UPDATE content_variants SET editorial_status = $2, version = version + 1, updated_at = $3 WHERE id = $1", [v.id, transition("generating", { type: "generation_failed" }), at]);
      }
    }
    const anyOk = results.some((r) => r.ok);
    const [type, resource] = job.mode === "initial" ? (["content_item", job.content_item_id] as const) : (["regeneration", jobId] as const);
    const resv = (await client.query<{ status: string }>("SELECT status FROM usage_reservations WHERE type = $1 AND resource_id = $2", [type, resource])).rows[0];
    if (anyOk) await consume(client, type, resource, at);
    else if (resv?.status === "reserved") await release(client, type, resource, at); // aucun résultat exploitable : aucun débit
    const cost = Math.round(inTok * (deps.costMicros?.input ?? 0) + outTok * (deps.costMicros?.output ?? 0));
    const failureCode = anyOk ? null : (results.find((r) => r.errorClass)?.errorClass ?? "invalid_output");
    await client.query(
      "UPDATE ai_jobs SET status = $2, finished_at = $3, input_tokens = $4, output_tokens = $5, cost_estimate_micros = $6, latency_ms = $7, results = $8, safe_error_code = $9 WHERE id = $1",
      [jobId, anyOk ? "succeeded" : "failed", at, inTok, outTok, cost, latencyMs, JSON.stringify(results), failureCode],
    );
    await refreshSummary(client, job.content_item_id, at);
    await audit(client, orgId, null, anyOk ? "ai_job.succeeded" : "ai_job.failed", jobId, { ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, code: failureCode }, job.correlation_id);
  });
  return "done";
}

/** Jobs bloqués « running » (worker tombé) : échec technique, quota libéré, variantes remises au brouillon. */
export async function recoverStaleJobs(deps: Pick<AiDeps, "pool" | "clock">, limit = 50): Promise<number> {
  const cutoff = new Date(deps.clock.now().getTime() - STALE_AFTER_MS);
  const rows = (await deps.pool.query<{ id: string; organization_id: string }>("SELECT * FROM ai_stale_jobs($1, $2)", [cutoff, limit])).rows;
  let n = 0;
  for (const r of rows) {
    await withTenant(deps.pool, { organizationId: r.organization_id, userId: null }, async ({ client }) => {
      const job = (await client.query<JobRow>("SELECT id, brand_id, content_item_id, status, mode, targets, correlation_id FROM ai_jobs WHERE id = $1 AND status = 'running' FOR UPDATE", [r.id])).rows[0];
      if (!job) return;
      const at = deps.clock.now();
      await client.query("UPDATE content_variants SET editorial_status = 'draft', version = version + 1, updated_at = $2 WHERE content_item_id = $1 AND editorial_status = 'generating'", [job.content_item_id, at]);
      const [type, resource] = job.mode === "initial" ? (["content_item", job.content_item_id] as const) : (["regeneration", job.id] as const);
      const resv = (await client.query<{ status: string }>("SELECT status FROM usage_reservations WHERE type = $1 AND resource_id = $2", [type, resource])).rows[0];
      if (resv?.status === "reserved") await release(client, type, resource, at);
      await client.query("UPDATE ai_jobs SET status = 'failed', finished_at = $2, safe_error_code = 'stale_running' WHERE id = $1", [job.id, at]);
      await refreshSummary(client, job.content_item_id, at);
      await audit(client, r.organization_id, null, "ai_job.recovered", job.id, { reason: "stale_running" }, job.correlation_id);
      n += 1;
    });
  }
  return n;
}

export async function getJob(deps: AuthDeps, session: SessionInfo, orgId: string, jobId: string): Promise<JobView> {
  return asMember(deps, session, orgId, "content.read", async ({ client }) => {
    const r = (await client.query<{ id: string; status: JobView["status"]; mode: JobView["mode"]; results: TargetResult[]; safe_error_code: string | null }>("SELECT id, status, mode, results, safe_error_code FROM ai_jobs WHERE id = $1", [jobId])).rows[0];
    if (!r) throw new ServiceError("not_found");
    return { id: r.id, status: r.status, mode: r.mode, results: r.results, safeErrorCode: r.safe_error_code };
  });
}

/**
 * Lot partiel (plan) : chaque sujet a son propre job et sa propre réservation. Un refus (quota, profil)
 * n'affecte que son sujet ; aucun débit global.
 */
export async function generateBatch(
  deps: AiDeps,
  session: SessionInfo,
  orgId: string,
  planId: string,
  topics: string[],
  targets: Target[],
  meta: RequestMeta,
  createItem: (topic: string) => Promise<{ itemId: string }>,
): Promise<{ topic: string; itemId?: string; jobId?: string; error?: string }[]> {
  if (topics.length < 1 || topics.length > 20) throw new ServiceError("validation_failed", { fields: ["topics"] });
  void planId;
  const out: { topic: string; itemId?: string; jobId?: string; error?: string }[] = [];
  for (const topic of topics) {
    try {
      const { itemId } = await createItem(topic);
      const { jobId } = await startGeneration(deps, session, orgId, itemId, { targets, mode: "initial" }, meta);
      out.push({ topic, itemId, jobId });
    } catch (e) {
      if (e instanceof ServiceError) out.push({ topic, error: String(e.details?.reason ?? e.code) });
      else throw e;
    }
  }
  return out;
}
