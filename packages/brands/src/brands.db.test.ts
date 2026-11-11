/** E09 — onboarding et profil de marque sur PostgreSQL réel. */
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "../../test-utils/src/context";
import { acceptInvitation, createOrganization, FakeIdentityProvider, inviteMember, signIn, signUp, verifyEmail, type AuthDeps, type SessionInfo } from "@bbn/auth";
import { createPool, withTenant } from "@bbn/db";
import { ManualClock, ServiceError, type BrandDraft } from "@bbn/domain";
import { FakeEmailSender } from "@bbn/integrations/fakes";
import { createBrand, getBrand, loadGenerationContext, publishProfile, saveDraft } from "./service";

const PW = "correct horse battery staple";
const meta = { requestId: "brand-test" };
let pool: pg.Pool;
let clock: ManualClock;
let email: FakeEmailSender;
let deps: AuthDeps;

async function err(p: Promise<unknown>): Promise<{ code: string; reason?: unknown; details?: Record<string, unknown> }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ServiceError) return { code: e.code, reason: e.details?.reason, details: e.details };
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
async function org() {
  const o = await user("brand-owner");
  const { organizationId } = await createOrganization(deps, o.session, { name: "Marque (fictive)", defaultLocale: "fr-CA" }, meta);
  return { owner: o.session, orgId: organizationId };
}
async function member(orgId: string, owner: SessionInfo, role: "editor" | "reviewer") {
  const u = await user(role);
  await inviteMember(deps, owner, orgId, { email: u.email, role }, meta);
  const token = decodeURIComponent(email.inboxOf(u.email).at(-1)!.text.match(/token=(\S+)/)![1]!);
  await acceptInvitation(deps, u.session, token, meta);
  return u.session;
}

const complete: BrandDraft = {
  name: "Studio Nord (fictif)",
  sector: "studio",
  description: "Photographie de produits",
  audience: "Commerces locaux",
  area: "Québec",
  services: ["Photo produit", "Retouche"],
  tone: { voice: "professional", avoid: ["promesses de résultats"] },
  defaultContentLocale: "en-CA",
  timezone: "America/Toronto",
  factsSourceConfirmed: true,
  facts: [
    { id: "hours", kind: "hours", value: "Lun–ven 9 h–17 h", validFrom: "2026-01-01", validUntil: null, confirmed: true },
    { id: "promo-old", kind: "promotion", value: "−10 % en octobre", validFrom: "2026-10-01", validUntil: "2026-10-31", confirmed: true },
    { id: "promo-now", kind: "promotion", value: "Séance offerte", validFrom: "2026-11-01", validUntil: "2026-11-30", confirmed: true },
    { id: "draft-fact", kind: "service", value: "Vidéo (à confirmer)", validFrom: null, validUntil: null, confirmed: false },
  ],
};

beforeAll(() => {
  clock = new ManualClock(new Date("2026-11-11T15:00:00Z"));
  pool = createPool(inject("dbUrls").appUrl, 4);
  email = new FakeEmailSender();
  deps = { pool, idp: new FakeIdentityProvider(clock), email, clock, appBaseUrl: "http://localhost:3000" };
});
afterAll(async () => {
  await pool?.end();
});

describe("onboarding reprenable (E09)", () => {
  it("brouillon partiel enregistré puis repris ; version obsolète ⇒ 409 sans écrasement", async () => {
    const { owner, orgId } = await org();
    const { brandId } = await createBrand(deps, owner, orgId, { name: "Studio Nord (fictif)", timezone: "America/Toronto", defaultContentLocale: "en-CA" }, meta);
    let v = await getBrand(deps, owner, orgId, brandId);
    expect(v.status).toBe("draft");
    const { draftVersion } = await saveDraft(deps, owner, orgId, brandId, { ...v.draft, sector: "studio", description: "Photographie" }, v.draftVersion, meta);
    expect((await err(saveDraft(deps, owner, orgId, brandId, { ...v.draft, description: "écrasement" }, v.draftVersion, meta))).code).toBe("stale_version");
    v = await getBrand(deps, owner, orgId, brandId);
    expect(v.draftVersion).toBe(draftVersion);
    expect(v.draft.description).toBe("Photographie");
    expect(v.missing).toEqual(["audience", "area", "services", "tone", "factsSourceConfirmed"]);
  });

  it("champs requis : publication refusée tant que le profil est incomplet ; puis version 1 immuable", async () => {
    const { owner, orgId } = await org();
    const { brandId } = await createBrand(deps, owner, orgId, { name: "X", timezone: "America/Toronto", defaultContentLocale: "fr-CA" }, meta);
    let v = await getBrand(deps, owner, orgId, brandId);
    const e = await err(publishProfile(deps, owner, orgId, brandId, v.draftVersion, meta));
    expect([e.code, e.reason]).toEqual(["business_rule", "brand_incomplete"]);
    await saveDraft(deps, owner, orgId, brandId, complete, v.draftVersion, meta);
    v = await getBrand(deps, owner, orgId, brandId);
    expect(v.missing).toEqual([]);
    expect(await publishProfile(deps, owner, orgId, brandId, v.draftVersion, meta)).toEqual({ profileVersion: 1 });
    v = await getBrand(deps, owner, orgId, brandId);
    expect(v).toMatchObject({ status: "active", profileVersion: 1, name: "Studio Nord (fictif)", defaultContentLocale: "en-CA" });
    expect(v.published?.version).toBe(1);
    await expect(withTenant(pool, { organizationId: orgId, userId: null }, ({ client }) => client.query("UPDATE brand_guidelines SET tone_json = '{}' WHERE brand_id = $1", [brandId]))).rejects.toMatchObject({ code: "42501" });
    // Nouvelle publication = nouvelle version ; l'ancienne reste.
    await saveDraft(deps, owner, orgId, brandId, { ...complete, description: "Photographie et vidéo" }, v.draftVersion, meta);
    v = await getBrand(deps, owner, orgId, brandId);
    expect(await publishProfile(deps, owner, orgId, brandId, v.draftVersion, meta)).toEqual({ profileVersion: 2 });
    const versions = await withTenant(pool, { organizationId: orgId, userId: null }, async ({ client }) => (await client.query("SELECT version FROM brand_guidelines WHERE brand_id = $1 ORDER BY version", [brandId])).rows.map((r) => r.version));
    expect(versions).toEqual([1, 2]);
  });

  it("faits datables sans date de validité : publication refusée", async () => {
    const { owner, orgId } = await org();
    const { brandId } = await createBrand(deps, owner, orgId, { name: "X", timezone: "America/Toronto", defaultContentLocale: "fr-CA" }, meta);
    const v = await getBrand(deps, owner, orgId, brandId);
    await saveDraft(deps, owner, orgId, brandId, { ...complete, facts: [{ id: "p", kind: "price", value: "25 $", confirmed: true, validFrom: null, validUntil: null }] }, v.draftVersion, meta);
    const e = await err(publishProfile(deps, owner, orgId, brandId, v.draftVersion + 1, meta));
    expect([e.reason, e.details?.facts]).toEqual(["facts_missing_validity", ["p"]]);
  });

  it("contexte de génération : profil publié requis ; promotion expirée et fait non confirmé exclus", async () => {
    const { owner, orgId } = await org();
    const { brandId } = await createBrand(deps, owner, orgId, { name: "X", timezone: "America/Toronto", defaultContentLocale: "fr-CA" }, meta);
    const notPublished = await err(withTenant(pool, { organizationId: orgId, userId: null }, ({ client }) => loadGenerationContext(client, brandId, clock.now())));
    expect(notPublished.reason).toBe("brand_incomplete");
    const v = await getBrand(deps, owner, orgId, brandId);
    await saveDraft(deps, owner, orgId, brandId, complete, v.draftVersion, meta);
    await publishProfile(deps, owner, orgId, brandId, v.draftVersion + 1, meta);
    const ctx = await withTenant(pool, { organizationId: orgId, userId: null }, ({ client }) => loadGenerationContext(client, brandId, clock.now()));
    expect(ctx.facts.map((f) => f.id)).toEqual(["hours", "promo-now"]);
    expect(ctx.excludedFacts).toEqual({ expired: ["promo-old"], notYetValid: [], unconfirmed: ["draft-fact"] });
  });

  it("une seule marque active au MVP (sans droit supérieur)", async () => {
    const { owner, orgId } = await org();
    await createBrand(deps, owner, orgId, { name: "A", timezone: "America/Toronto", defaultContentLocale: "fr-CA" }, meta);
    expect((await err(createBrand(deps, owner, orgId, { name: "B", timezone: "America/Toronto", defaultContentLocale: "fr-CA" }, meta))).reason).toBe("brand_limit_reached");
  });

  it("droits : relecteur sans modification ; éditeur autorisé ; autre organisation ⇒ not_found ; fuseau invalide refusé", async () => {
    const { owner, orgId } = await org();
    const { brandId } = await createBrand(deps, owner, orgId, { name: "X", timezone: "America/Halifax", defaultContentLocale: "fr-CA" }, meta);
    const reviewer = await member(orgId, owner, "reviewer");
    const editor = await member(orgId, owner, "editor");
    const v = await getBrand(deps, reviewer, orgId, brandId);
    expect((await err(saveDraft(deps, reviewer, orgId, brandId, { name: "Y" }, v.draftVersion, meta))).code).toBe("forbidden");
    await expect(saveDraft(deps, editor, orgId, brandId, { ...v.draft, area: "Halifax" }, v.draftVersion, meta)).resolves.toBeTruthy();
    const other = await org();
    expect((await err(getBrand(deps, other.owner, orgId, brandId))).code).toBe("not_found");
    expect((await err(saveDraft(deps, owner, orgId, brandId, { timezone: "Moon/Base" }, v.draftVersion + 1, meta))).code).toBe("validation_failed");
  });

  it("langue d'interface et langue de contenu indépendantes", async () => {
    const { owner, orgId } = await org(); // interface fr-CA
    const { brandId } = await createBrand(deps, owner, orgId, { name: "X", timezone: "America/Vancouver", defaultContentLocale: "en-CA" }, meta);
    const v = await getBrand(deps, owner, orgId, brandId);
    expect([owner.uiLocale, v.defaultContentLocale, v.timezone]).toEqual(["fr-CA", "en-CA", "America/Vancouver"]);
  });
});
