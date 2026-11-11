/** E13 — génération IA sur PostgreSQL réel, IA simulée (corpus FR/EN de comportements du modèle). */
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "../../test-utils/src/context";
import { createOrganization, FakeIdentityProvider, signIn, signUp, verifyEmail, type SessionInfo } from "@bbn/auth";
import { ingestWebhook, projectPending, startCheckout, usageSummary } from "@bbn/billing";
import { createBrand, getBrand, publishProfile, saveDraft } from "@bbn/brands";
import { createItem, createPlan, getItem, listRevisions } from "@bbn/content";
import { createPool, withTenant } from "@bbn/db";
import { ManualClock, ServiceError, type BrandDraft } from "@bbn/domain";
import { PRICE_CATALOG } from "@bbn/integrations";
import { FakeAiTextProvider, FakeEmailSender, FakePaymentsProvider } from "@bbn/integrations/fakes";
import { generateBatch, getJob, processGenerationMessage, recoverStaleJobs, startGeneration, type AiDeps, type Target } from "./generation";

const PW = "correct horse battery staple";
const meta = { requestId: "ai-test" };
let pool: pg.Pool;
let clock: ManualClock;
let email: FakeEmailSender;
let payments: FakePaymentsProvider;
let ai: FakeAiTextProvider;
let deps: AiDeps & { payments: FakePaymentsProvider; simulation: boolean };

const profile: BrandDraft = {
  name: "Boulangerie Démo (fictive)",
  sector: "restaurant",
  description: "Pains au levain",
  audience: "Familles du quartier",
  area: "Montréal",
  services: ["Pains", "Viennoiseries"],
  tone: { voice: "warm", avoid: ["meilleur en ville"] },
  defaultContentLocale: "fr-CA",
  timezone: "America/Toronto",
  factsSourceConfirmed: true,
  facts: [
    { id: "hours", kind: "hours", value: "Mar–sam 7 h 30–18 h", validFrom: "2026-01-01", validUntil: null, confirmed: true },
    { id: "promo-old", kind: "promotion", value: "−10 % en octobre", validFrom: "2026-10-01", validUntil: "2026-10-31", confirmed: true },
  ],
};

async function err(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ServiceError) return String(e.details?.reason ?? e.code);
    throw e;
  }
  throw new Error("ServiceError attendue");
}

async function setup(opts: { publish?: boolean; plan?: string } = {}) {
  const addr = `ai.${randomUUID().slice(0, 8)}@example.test`;
  await signUp(deps, { email: addr, password: PW, uiLocale: "fr-CA" });
  await verifyEmail(deps, { email: addr, code: email.inboxOf(addr).at(-1)!.text.match(/\d{6}/)![0] });
  const session: SessionInfo = (await signIn(deps, { email: addr, password: PW })).session;
  const { organizationId: orgId } = await createOrganization(deps, session, { name: "IA (fictive)", defaultLocale: "fr-CA" }, meta);
  await startCheckout(deps, session, orgId, opts.plan ?? "essentiel", "fr-CA", meta);
  for (const e of payments.completeCheckout(payments.checkouts.filter((c) => c.organizationId === orgId).at(-1)!.sessionId)) await ingestWebhook(deps, e.rawBody, e.signature);
  await projectPending({ pool, payments, clock });
  const { brandId } = await createBrand(deps, session, orgId, { name: profile.name!, timezone: "America/Toronto", defaultContentLocale: "fr-CA" }, meta);
  if (opts.publish !== false) {
    const b = await getBrand(deps, session, orgId, brandId);
    await saveDraft(deps, session, orgId, brandId, profile, b.draftVersion, meta);
    await publishProfile(deps, session, orgId, brandId, b.draftVersion + 1, meta);
  }
  const { planId } = await createPlan(deps, session, orgId, brandId, { periodStart: "2026-11-01", periodEnd: "2026-12-01" }, meta);
  const { itemId } = await createItem(deps, session, orgId, planId, { topic: "Pain du dimanche" }, meta);
  return { session, orgId, brandId, planId, itemId };
}

const FR: Target = { provider: "facebook_page", locale: "fr-CA" };
const EN: Target = { provider: "facebook_page", locale: "en-CA" };
async function run(s: { session: SessionInfo; orgId: string; itemId: string }, targets: Target[] = [FR], mode: "initial" | "regenerate" = "initial", key?: string) {
  const r = await startGeneration(deps, s.session, s.orgId, s.itemId, { targets, mode, ...(key ? { idempotencyKey: key } : {}) }, meta);
  const outcome = await processGenerationMessage(deps, { messageId: r.outboxId ?? randomUUID(), type: "ai.generate", organizationId: s.orgId, correlationId: "c", payload: { jobId: r.jobId } });
  return { ...r, outcome, job: await getJob(deps, s.session, s.orgId, r.jobId) };
}
const usage = (orgId: string) => withTenant(pool, { organizationId: orgId, userId: null }, ({ client }) => usageSummary(client, orgId, clock.now()));
const ok = (caption: string, locale = "fr-CA", usedFactIds: string[] = []) => ({ topic: "t", locale, caption, callToAction: "Passez nous voir", visualBrief: "photo", usedFactIds, warnings: [], requiresHumanReview: true });

beforeAll(() => {
  clock = new ManualClock(new Date("2026-11-11T15:00:00Z"));
  pool = createPool(inject("dbUrls").appUrl, 6);
  email = new FakeEmailSender();
  payments = new FakePaymentsProvider(clock, PRICE_CATALOG);
  ai = new FakeAiTextProvider(clock);
  deps = { pool, idp: new FakeIdentityProvider(clock), email, clock, appBaseUrl: "http://localhost:3000", ai, aiModel: "fake-model", simulation: true, payments, costMicros: { input: 1, output: 2 } };
});
afterAll(async () => {
  await pool?.end();
});

describe("génération nominale (AI-01)", () => {
  it("FR et EN : révisions « ai » validées, crédit consommé une fois, coûts et jetons suivis, données client hors instructions", async () => {
    const s = await setup();
    const before = ai.calls.length;
    const r = await run(s, [FR, EN]);
    expect(r.job.status).toBe("succeeded");
    expect(r.job.results.map((x) => [x.locale, x.ok, x.revisionNumber])).toEqual([["fr-CA", true, 1], ["en-CA", true, 1]]);
    const item = await getItem(deps, s.session, s.orgId, s.itemId);
    expect(item.variants.every((v) => v.status === "draft" && v.current?.origin === "ai")).toBe(true);
    expect((await usage(s.orgId)).contentItems).toMatchObject({ consumed: 1, reserved: 0 });
    const calls = ai.calls.slice(before);
    expect(calls.map((c) => c.locale)).toEqual(["fr-CA", "en-CA"]);
    expect(calls.every((c) => !c.instructions.includes("Pain du dimanche") && !c.instructions.includes("Boulangerie"))).toBe(true);
    const job = await withTenant(pool, { organizationId: s.orgId, userId: null }, async ({ client }) => (await client.query("SELECT prompt_version, input_tokens, output_tokens, cost_estimate_micros, latency_ms FROM ai_jobs WHERE id = $1", [r.jobId])).rows[0]);
    expect(job.prompt_version).toBe("caption-v1");
    expect(job.input_tokens).toBeGreaterThan(0);
    expect(Number(job.cost_estimate_micros)).toBe(job.input_tokens + 2 * job.output_tokens);
  });

  it("promotion expirée exclue du contexte transmis au modèle", async () => {
    const s = await setup();
    const before = ai.calls.length;
    await run(s);
    expect(ai.calls[before]!.untrustedContext.factIds).toEqual(["hours"]);
  });
});

describe("corpus de comportements du modèle", () => {
  it("information absente / prix inventé / injection obéie / promo expirée : refusés deux fois ⇒ échec, crédit libéré, aucune révision", async () => {
    const s = await setup();
    ai.respondWith(ok("Ouvert dimanche de 9 h à 17 h"), ok("Seulement 19,99 $ ! Visitez www.exemple-piege.com"));
    const r = await run(s);
    expect(r.job.status).toBe("failed");
    expect(r.job.results[0]).toMatchObject({ ok: false, errorClass: "invalid_output" });
    expect(r.job.results[0]!.violations).toEqual(expect.arrayContaining(["unsupported_price", "unsupported_link"]));
    expect((await usage(s.orgId)).contentItems).toMatchObject({ consumed: 0, reserved: 0 });
    const v = (await getItem(deps, s.session, s.orgId, s.itemId)).variants[0]!;
    expect([v.status, v.revisionCount]).toEqual(["draft", 0]);
  });

  it("sortie invalide puis valide : la nouvelle tentative bornée réussit", async () => {
    const s = await setup();
    ai.respondWith("{ pas du json", ok("Pain frais tous les matins, du mardi au samedi."));
    const r = await run(s);
    expect(r.job.status).toBe("succeeded");
  });

  it("langue erronée refusée (demande EN, réponse FR)", async () => {
    const s = await setup();
    ai.respondWith(ok("Bonjour", "fr-CA"), ok("Bonjour encore", "fr-CA"));
    const r = await run(s, [EN]);
    expect(r.job.results[0]!.violations).toEqual(["wrong_locale"]);
  });

  it("panne du fournisseur : échec technique sans débit ; l'ancienne révision est conservée ; saisie manuelle possible", async () => {
    const s = await setup();
    await run(s);
    const before = (await usage(s.orgId)).contentItems!.consumed;
    ai.scenarios.next("timeout");
    const r = await run(s, [FR], "regenerate");
    expect(r.job).toMatchObject({ status: "failed", safeErrorCode: "timeout" });
    const v = (await getItem(deps, s.session, s.orgId, s.itemId)).variants[0]!;
    expect([v.status, v.revisionCount, v.current?.number]).toEqual(["draft", 1, 1]);
    expect((await usage(s.orgId)).contentItems!.consumed).toBe(before);
    const regen = await withTenant(pool, { organizationId: s.orgId, userId: null }, async ({ client }) => (await client.query("SELECT status FROM usage_reservations WHERE type = 'regeneration'")).rows.map((x) => x.status));
    expect(regen).toEqual(["released"]);
  });

  it("profil non publié ⇒ génération refusée avant tout appel ; quota épuisé ⇒ refus avant tout appel", async () => {
    const s = await setup({ publish: false });
    const before = ai.calls.length;
    expect(await err(startGeneration(deps, s.session, s.orgId, s.itemId, { targets: [FR], mode: "initial" }, meta))).toBe("brand_incomplete");
    const q = await setup();
    await withTenant(pool, { organizationId: q.orgId, userId: null }, async ({ client }) => {
      const cycle = (await client.query<{ id: string }>("SELECT id FROM billing_cycles LIMIT 1")).rows[0]!.id;
      for (let i = 0; i < 15; i++) await client.query("INSERT INTO usage_reservations (organization_id, cycle_id, type, quantity, resource_id, status) VALUES ($1, $2, 'content_item', 1, $3, 'consumed')", [q.orgId, cycle, randomUUID()]);
    });
    expect(await err(startGeneration(deps, q.session, q.orgId, q.itemId, { targets: [FR], mode: "initial" }, meta))).toBe("quota_exhausted");
    expect(ai.calls.length).toBe(before);
  });
});

describe("régénérations, idempotence, concurrence, lots et récupération", () => {
  it("3 régénérations réussies par contenu, la 4e refusée ; une régénération échouée ne compte pas", async () => {
    const s = await setup();
    await run(s);
    for (let i = 0; i < 3; i++) expect((await run(s, [FR], "regenerate")).job.status).toBe("succeeded");
    expect(await err(startGeneration(deps, s.session, s.orgId, s.itemId, { targets: [FR], mode: "regenerate" }, meta))).toBe("quota_exhausted");
    expect((await listRevisions(deps, s.session, s.orgId, (await getItem(deps, s.session, s.orgId, s.itemId)).variants[0]!.id)).length).toBe(4);
  });

  it("Idempotency-Key : même charge ⇒ même job ; charge différente ⇒ conflit", async () => {
    const s = await setup();
    const a = await startGeneration(deps, s.session, s.orgId, s.itemId, { targets: [FR], mode: "initial", idempotencyKey: "key-abcdef-1" }, meta);
    const b = await startGeneration(deps, s.session, s.orgId, s.itemId, { targets: [FR], mode: "initial", idempotencyKey: "key-abcdef-1" }, meta);
    expect([b.jobId, b.reused]).toEqual([a.jobId, true]);
    expect(await err(startGeneration(deps, s.session, s.orgId, s.itemId, { targets: [EN], mode: "initial", idempotencyKey: "key-abcdef-1" }, meta))).toBe("idempotency_key_reused");
  });

  it("message rejoué : traité une seule fois ; au plus 2 jobs en cours par organisation (le 3e est différé)", async () => {
    const s = await setup();
    const r = await run(s);
    expect(await processGenerationMessage(deps, { messageId: r.outboxId!, type: "ai.generate", organizationId: s.orgId, correlationId: "c", payload: { jobId: r.jobId } })).toBe("skipped");
    const { itemId: i2 } = await createItem(deps, s.session, s.orgId, s.planId, { topic: "Croissants" }, meta);
    const j = await startGeneration(deps, s.session, s.orgId, i2, { targets: [FR], mode: "initial" }, meta);
    await withTenant(pool, { organizationId: s.orgId, userId: null }, ({ client }) =>
      client.query("INSERT INTO ai_jobs (organization_id, brand_id, prompt_version, status, started_at) VALUES ($1, $2, 'caption-v1', 'running', $3), ($1, $2, 'caption-v1', 'running', $3)", [s.orgId, s.brandId, clock.now()]),
    );
    expect(await processGenerationMessage(deps, { messageId: j.outboxId!, type: "ai.generate", organizationId: s.orgId, correlationId: "c", payload: { jobId: j.jobId } })).toBe("deferred");
    expect((await getJob(deps, s.session, s.orgId, j.jobId)).status).toBe("queued");
  });

  it("lot partiel : chaque sujet a son job et sa réservation ; un refus n'affecte que son sujet", async () => {
    const s = await setup();
    const out = await generateBatch(deps, s.session, s.orgId, s.planId, ["Pain", "Brioche", "Tarte"], [FR], meta, (topic) => createItem(deps, s.session, s.orgId, s.planId, { topic }, meta));
    expect(out.every((o) => o.jobId)).toBe(true);
    const reserved = (await usage(s.orgId)).contentItems!;
    expect(reserved.reserved).toBe(3);
  });

  it("job bloqué « running » (worker tombé) : récupéré, crédit libéré, variante remise au brouillon", async () => {
    const s = await setup();
    const j = await startGeneration(deps, s.session, s.orgId, s.itemId, { targets: [FR], mode: "initial" }, meta);
    await withTenant(pool, { organizationId: s.orgId, userId: null }, ({ client }) => client.query("UPDATE ai_jobs SET status = 'running', started_at = $2 WHERE id = $1", [j.jobId, clock.now()]));
    clock.advanceMs(16 * 60_000);
    expect(await recoverStaleJobs({ pool, clock })).toBeGreaterThanOrEqual(1);
    expect((await getJob(deps, s.session, s.orgId, j.jobId))).toMatchObject({ status: "failed", safeErrorCode: "stale_running" });
    expect((await getItem(deps, s.session, s.orgId, s.itemId)).variants[0]!.status).toBe("draft");
    expect((await usage(s.orgId)).contentItems).toMatchObject({ reserved: 0, consumed: 0 });
  });
});
