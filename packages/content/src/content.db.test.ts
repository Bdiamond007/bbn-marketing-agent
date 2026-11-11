/** E11 — contenus et révisions sur PostgreSQL réel. */
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "../../test-utils/src/context";
import { acceptInvitation, createOrganization, FakeIdentityProvider, inviteMember, signIn, signUp, verifyEmail, type SessionInfo } from "@bbn/auth";
import { ingestWebhook, projectPending, startCheckout, usageSummary, type BillingDeps } from "@bbn/billing";
import { createBrand } from "@bbn/brands";
import { createPool, withTenant } from "@bbn/db";
import { ManualClock, ServiceError } from "@bbn/domain";
import { PRICE_CATALOG } from "@bbn/integrations";
import { FakeEmailSender, FakePaymentsProvider } from "@bbn/integrations/fakes";
import { addComment, addVariant, applyVariantEvent, createItem, createPlan, createRevision, getItem, listComments, listRevisions } from "./service";

const PW = "correct horse battery staple";
const meta = { requestId: "content-test" };
let pool: pg.Pool;
let clock: ManualClock;
let email: FakeEmailSender;
let payments: FakePaymentsProvider;
let deps: BillingDeps;

async function err(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ServiceError) return String(e.details?.reason ?? e.code);
    throw e;
  }
  throw new Error("ServiceError attendue");
}
async function user(prefix: string) {
  const addr = `${prefix}.${randomUUID().slice(0, 8)}@example.test`;
  await signUp(deps, { email: addr, password: PW, uiLocale: "fr-CA" });
  await verifyEmail(deps, { email: addr, code: email.inboxOf(addr).at(-1)!.text.match(/\d{6}/)![0] });
  return { email: addr, session: (await signIn(deps, { email: addr, password: PW })).session };
}
/** Organisation abonnée (plan au choix), marque, plan éditorial et un sujet. */
async function setup(planCode = "essentiel", subscribe = true) {
  const o = await user("content-owner");
  const { organizationId: orgId } = await createOrganization(deps, o.session, { name: "Contenus (fictive)", defaultLocale: "fr-CA" }, meta);
  if (subscribe) {
    await startCheckout(deps, o.session, orgId, planCode, "fr-CA", meta);
    for (const e of payments.completeCheckout(payments.checkouts.filter((c) => c.organizationId === orgId).at(-1)!.sessionId)) await ingestWebhook(deps, e.rawBody, e.signature);
    await projectPending({ pool, payments, clock });
  }
  const { brandId } = await createBrand(deps, o.session, orgId, { name: "Marque (fictive)", timezone: "America/Toronto", defaultContentLocale: "fr-CA" }, meta);
  const today = clock.now().toISOString().slice(0, 10);
  const { planId } = await createPlan(deps, o.session, orgId, brandId, { periodStart: today, periodEnd: "2099-01-01" }, meta);
  const { itemId } = await createItem(deps, o.session, orgId, planId, { topic: "Heures d'ouverture des fêtes" }, meta);
  return { owner: o.session, orgId, brandId, planId, itemId };
}
async function member(orgId: string, owner: SessionInfo, role: "editor" | "reviewer") {
  const u = await user(role);
  await inviteMember(deps, owner, orgId, { email: u.email, role }, meta);
  await acceptInvitation(deps, u.session, decodeURIComponent(email.inboxOf(u.email).at(-1)!.text.match(/token=(\S+)/)![1]!), meta);
  return u.session;
}
const sys = <T>(orgId: string, fn: (c: pg.PoolClient) => Promise<T>) => withTenant(pool, { organizationId: orgId, userId: null }, ({ client }) => fn(client));

beforeAll(() => {
  clock = new ManualClock(new Date());
  pool = createPool(inject("dbUrls").appUrl, 4);
  email = new FakeEmailSender();
  payments = new FakePaymentsProvider(clock, PRICE_CATALOG);
  deps = { pool, idp: new FakeIdentityProvider(clock), email, clock, appBaseUrl: "http://localhost:3000", payments, simulation: true };
});
afterAll(async () => {
  await pool?.end();
});

describe("révisions immuables et concurrence (EDIT-01)", () => {
  it("historique conservé, numéros croissants, empreintes distinctes ; révision non modifiable", async () => {
    const s = await setup();
    const { variantId } = await addVariant(deps, s.owner, s.orgId, s.itemId, { provider: "facebook_page", locale: "fr-CA" }, meta);
    const r1 = await createRevision(deps, s.owner, s.orgId, variantId, { caption: "Ouvert le 24 décembre", mediaAssetIds: [], expectedVersion: 1 }, meta);
    const r2 = await createRevision(deps, s.owner, s.orgId, variantId, { caption: "Ouvert le 24 décembre jusqu'à midi", mediaAssetIds: [], expectedVersion: r1.version }, meta);
    const history = await listRevisions(deps, s.owner, s.orgId, variantId);
    expect(history.map((r) => r.number)).toEqual([2, 1]);
    expect(r1.hash).not.toBe(r2.hash);
    expect(history[1]!.caption).toBe("Ouvert le 24 décembre");
    await expect(sys(s.orgId, (c) => c.query("UPDATE revisions SET caption = 'x' WHERE id = $1", [r1.revisionId]))).rejects.toMatchObject({ code: "42501" });
  });

  it("deux éditions concurrentes sur la même version : la seconde reçoit 409, rien n'est écrasé", async () => {
    const s = await setup();
    const editor = await member(s.orgId, s.owner, "editor");
    const { variantId } = await addVariant(deps, s.owner, s.orgId, s.itemId, { provider: "facebook_page", locale: "fr-CA" }, meta);
    await createRevision(deps, s.owner, s.orgId, variantId, { caption: "Version A", mediaAssetIds: [], expectedVersion: 1 }, meta);
    expect(await err(createRevision(deps, editor, s.orgId, variantId, { caption: "Version B", mediaAssetIds: [], expectedVersion: 1 }, meta))).toBe("stale_version");
    const item = await getItem(deps, editor, s.orgId, s.itemId);
    expect(item.variants[0]!.current?.caption).toBe("Version A");
    expect(item.variants[0]!.revisionCount).toBe(1);
  });

  it("média non prêt refusé dans une révision", async () => {
    const s = await setup();
    const { variantId } = await addVariant(deps, s.owner, s.orgId, s.itemId, { provider: "instagram_business", locale: "fr-CA" }, meta);
    const mediaId = randomUUID();
    await sys(s.orgId, (c) => c.query("INSERT INTO media_assets (id, organization_id, storage_key, mime, bytes, status) VALUES ($1, $2, $3, 'image/png', 10, 'quarantined')", [mediaId, s.orgId, `org/${s.orgId}/q/${mediaId}`]));
    expect(await err(createRevision(deps, s.owner, s.orgId, variantId, { caption: "Photo", mediaAssetIds: [mediaId], expectedVersion: 1 }, meta))).toBe("media_not_publishable");
  });
});

describe("séparation FR/EN et approbations par variante", () => {
  it("variantes FR et EN indépendantes ; doublon refusé ; une révision FR n'invalide que l'approbation FR", async () => {
    const s = await setup();
    const fr = (await addVariant(deps, s.owner, s.orgId, s.itemId, { provider: "facebook_page", locale: "fr-CA" }, meta)).variantId;
    const en = (await addVariant(deps, s.owner, s.orgId, s.itemId, { provider: "facebook_page", locale: "en-CA" }, meta)).variantId;
    expect(await err(addVariant(deps, s.owner, s.orgId, s.itemId, { provider: "facebook_page", locale: "fr-CA" }, meta))).toBe("variant_exists");
    const rfr = await createRevision(deps, s.owner, s.orgId, fr, { caption: "Bonjour", mediaAssetIds: [], expectedVersion: 1 }, meta);
    const ren = await createRevision(deps, s.owner, s.orgId, en, { caption: "Hello", mediaAssetIds: [], expectedVersion: 1 }, meta);
    const conn = randomUUID();
    await sys(s.orgId, async (c) => {
      await c.query("INSERT INTO social_connections (id, organization_id, brand_id, provider, external_account_id, status) VALUES ($1, $2, $3, 'facebook_page', $4, 'active')", [conn, s.orgId, s.brandId, `acct_${conn}`]);
      for (const r of [rfr, ren]) await c.query("INSERT INTO approvals (organization_id, revision_id, revision_hash, connection_id, actor_id) VALUES ($1, $2, $3, $4, $5)", [s.orgId, r.revisionId, r.hash, conn, s.owner.userId]);
      await c.query("UPDATE content_variants SET editorial_status = 'approved' WHERE id IN ($1, $2)", [fr, en]);
    });
    await createRevision(deps, s.owner, s.orgId, fr, { caption: "Bonjour à tous", mediaAssetIds: [], expectedVersion: rfr.version }, meta);
    const approvals = await sys(s.orgId, async (c) => (await c.query("SELECT r.caption, a.invalidated_reason FROM approvals a JOIN revisions r ON r.id = a.revision_id ORDER BY r.caption")).rows);
    expect(approvals).toEqual([
      { caption: "Bonjour", invalidated_reason: "revision_superseded" },
      { caption: "Hello", invalidated_reason: null },
    ]);
    const item = await getItem(deps, s.owner, s.orgId, s.itemId);
    expect(Object.fromEntries(item.variants.map((v) => [v.locale, v.status]))).toEqual({ "fr-CA": "draft", "en-CA": "approved" });
    expect(item.summaryStatus).toBe("draft");
  });
});

describe("crédit de contenu", () => {
  it("consommé une seule fois par sujet, à la première révision ; sans période de droits, refus", async () => {
    const s = await setup();
    const v1 = (await addVariant(deps, s.owner, s.orgId, s.itemId, { provider: "facebook_page", locale: "fr-CA" }, meta)).variantId;
    const v2 = (await addVariant(deps, s.owner, s.orgId, s.itemId, { provider: "instagram_business", locale: "fr-CA" }, meta)).variantId;
    const a = await createRevision(deps, s.owner, s.orgId, v1, { caption: "A", mediaAssetIds: [], expectedVersion: 1 }, meta);
    await createRevision(deps, s.owner, s.orgId, v1, { caption: "A2", mediaAssetIds: [], expectedVersion: a.version }, meta);
    await createRevision(deps, s.owner, s.orgId, v2, { caption: "B", mediaAssetIds: [], expectedVersion: 1 }, meta);
    expect((await sys(s.orgId, (c) => usageSummary(c, s.orgId, clock.now()))).contentItems).toMatchObject({ consumed: 1, remaining: 14 });

    const n = await setup("essentiel", false);
    const v = (await addVariant(deps, n.owner, n.orgId, n.itemId, { provider: "facebook_page", locale: "fr-CA" }, meta)).variantId;
    expect(await err(createRevision(deps, n.owner, n.orgId, v, { caption: "X", mediaAssetIds: [], expectedVersion: 1 }, meta))).toBe("no_current_entitlement_period");
  });
});

describe("machine à états et droits", () => {
  it("soumission : sans révision refusée ; revue client (Essentiel) ou revue interne (Accompagné) ; transition invalide refusée", async () => {
    const s = await setup("essentiel");
    const v = (await addVariant(deps, s.owner, s.orgId, s.itemId, { provider: "facebook_page", locale: "fr-CA" }, meta)).variantId;
    expect(await err(applyVariantEvent(deps, s.owner, s.orgId, v, "submit", 1, meta))).toBe("no_revision");
    const r = await createRevision(deps, s.owner, s.orgId, v, { caption: "A", mediaAssetIds: [], expectedVersion: 1 }, meta);
    const sub = await applyVariantEvent(deps, s.owner, s.orgId, v, "submit", r.version, meta);
    expect(sub.status).toBe("pending_customer_review");
    expect(await err(applyVariantEvent(deps, s.owner, s.orgId, v, "submit", sub.version, meta))).toBe("invalid_transition");
    expect(await err(applyVariantEvent(deps, s.owner, s.orgId, v, "submit", 1, meta))).toBe("stale_version");
    const arch = await applyVariantEvent(deps, s.owner, s.orgId, v, "archive", sub.version, meta);
    expect((await getItem(deps, s.owner, s.orgId, s.itemId)).summaryStatus).toBe("archived");
    expect((await applyVariantEvent(deps, s.owner, s.orgId, v, "restore", arch.version, meta)).status).toBe("draft");

    const a = await setup("accompagne");
    const va = (await addVariant(deps, a.owner, a.orgId, a.itemId, { provider: "facebook_page", locale: "fr-CA" }, meta)).variantId;
    const ra = await createRevision(deps, a.owner, a.orgId, va, { caption: "A", mediaAssetIds: [], expectedVersion: 1 }, meta);
    expect((await applyVariantEvent(deps, a.owner, a.orgId, va, "submit", ra.version, meta)).status).toBe("internal_review");
  });

  it("relecteur : commente mais ne modifie pas", async () => {
    const s = await setup();
    const reviewer = await member(s.orgId, s.owner, "reviewer");
    const v = (await addVariant(deps, s.owner, s.orgId, s.itemId, { provider: "facebook_page", locale: "fr-CA" }, meta)).variantId;
    expect(await err(createRevision(deps, reviewer, s.orgId, v, { caption: "X", mediaAssetIds: [], expectedVersion: 1 }, meta))).toBe("forbidden");
    await expect(addComment(deps, reviewer, s.orgId, s.itemId, { body: "Ajouter l'adresse ?" }, meta)).resolves.toBeTruthy();
  });
});

describe("commentaires isolés", () => {
  it("liés au sujet et éventuellement à une révision du même sujet ; invisibles pour un autre tenant", async () => {
    const s = await setup();
    const v = (await addVariant(deps, s.owner, s.orgId, s.itemId, { provider: "facebook_page", locale: "fr-CA" }, meta)).variantId;
    const r = await createRevision(deps, s.owner, s.orgId, v, { caption: "A", mediaAssetIds: [], expectedVersion: 1 }, meta);
    await addComment(deps, s.owner, s.orgId, s.itemId, { body: "Vérifier l'heure", revisionId: r.revisionId }, meta);
    const list = await listComments(deps, s.owner, s.orgId, s.itemId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ body: "Vérifier l'heure", revisionId: r.revisionId, authorEmail: s.owner.email });

    const other = await setup();
    expect(await err(listComments(deps, other.owner, s.orgId, s.itemId))).toBe("not_found");
    expect(await err(listComments(deps, other.owner, other.orgId, s.itemId))).toBe("not_found");
    // Révision d'un autre sujet du même tenant : refusée.
    const { itemId: item2 } = await createItem(deps, s.owner, s.orgId, s.planId, { topic: "Autre sujet" }, meta);
    expect(await err(addComment(deps, s.owner, s.orgId, item2, { body: "x", revisionId: r.revisionId }, meta))).toBe("not_found");
  });
});
