/** E08 — quotas et ledger sur PostgreSQL réel. */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "../../test-utils/src/context";
import { createOrganization, FakeIdentityProvider, signIn, signUp, verifyEmail } from "@bbn/auth";
import { createPool, withTenant } from "@bbn/db";
import { ManualClock, ServiceError } from "@bbn/domain";
import { PRICE_CATALOG } from "@bbn/integrations";
import { FakeEmailSender, FakePaymentsProvider, type SignedEvent } from "@bbn/integrations/fakes";
import { projectPending } from "./projection";
import { assertBillingAllows, consume, release, reserve, usageSummary, type UsageType } from "./quota";
import { ingestWebhook, startCheckout, type BillingDeps } from "./service";

const PW = "correct horse battery staple";
const DAY = 24 * 3600 * 1000;
let pool: pg.Pool;
let clock: ManualClock;
let email: FakeEmailSender;
let payments: FakePaymentsProvider;
let deps: BillingDeps;

async function reason(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ServiceError) return String(e.details?.reason ?? e.code);
    throw e;
  }
  throw new Error("ServiceError attendue");
}
const deliver = async (events: SignedEvent[]) => {
  for (const e of events) await ingestWebhook(deps, e.rawBody, e.signature);
  await projectPending({ pool, payments, clock });
};

/** Organisation abonnée au plan Essentiel (15 contenus, 45 publications, 3 régénérations par contenu). */
async function subscribedOrg() {
  const addr = `quota.${randomUUID().slice(0, 8)}@example.test`;
  await signUp(deps, { email: addr, password: PW, uiLocale: "fr-CA" });
  await verifyEmail(deps, { email: addr, code: email.inboxOf(addr).at(-1)!.text.match(/\d{6}/)![0] });
  const { session } = await signIn(deps, { email: addr, password: PW });
  const { organizationId } = await createOrganization(deps, session, { name: "Quotas (fictive)", defaultLocale: "fr-CA" }, { requestId: "q" });
  await startCheckout(deps, session, organizationId, "essentiel", "fr-CA", { requestId: "q" });
  const events = payments.completeCheckout(payments.checkouts.filter((c) => c.organizationId === organizationId).at(-1)!.sessionId);
  await deliver(events);
  return { orgId: organizationId, subId: JSON.parse(events[0]!.rawBody).data.subscription.id as string };
}
const tx = <T>(orgId: string, fn: (c: pg.PoolClient) => Promise<T>) => withTenant(pool, { organizationId: orgId, userId: null }, ({ client }) => fn(client));
const res = (orgId: string, type: UsageType, resourceId = randomUUID(), extra: { at?: Date; parentResourceId?: string } = {}) =>
  tx(orgId, (c) => reserve(c, { organizationId: orgId, type, resourceId, now: clock.now(), ...extra }));

beforeAll(() => {
  clock = new ManualClock(new Date());
  pool = createPool(inject("dbUrls").appUrl, 25);
  email = new FakeEmailSender();
  payments = new FakePaymentsProvider(clock, PRICE_CATALOG);
  deps = { pool, idp: new FakeIdentityProvider(clock), email, clock, appBaseUrl: "http://localhost:3000", payments, simulation: true };
});
afterAll(async () => {
  await pool?.end();
});

describe("concurrence (critère E08)", () => {
  it("50 demandes concurrentes sur le dernier crédit : une seule réussit, aucun double débit", async () => {
    const { orgId } = await subscribedOrg();
    for (let i = 0; i < 44; i++) await res(orgId, "publication");
    // Élargit la fenêtre de course (base de test uniquement, le temps du test) : sans verrou d'allocation,
    // plusieurs transactions compteraient le même usage avant que les autres ne valident (vérifié par mutation).
    const admin = new pg.Client({ connectionString: inject("dbUrls").migrationUrl });
    await admin.connect();
    await admin.query("CREATE OR REPLACE FUNCTION test_slow_reservation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.02); RETURN NEW; END $$");
    await admin.query("CREATE TRIGGER test_slow_reservation BEFORE INSERT ON usage_reservations FOR EACH ROW EXECUTE FUNCTION test_slow_reservation()");
    let outcomes: PromiseSettledResult<unknown>[];
    try {
      outcomes = await Promise.allSettled(Array.from({ length: 50 }, () => res(orgId, "publication")));
    } finally {
      await admin.query("DROP TRIGGER test_slow_reservation ON usage_reservations");
      await admin.query("DROP FUNCTION test_slow_reservation()");
      await admin.end();
    }
    const ok = outcomes.filter((o) => o.status === "fulfilled");
    const refused = outcomes.filter((o) => o.status === "rejected" && o.reason instanceof ServiceError && o.reason.details?.reason === "quota_exhausted");
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(49);
    const totals = await tx(orgId, async (c) => (await c.query("SELECT (SELECT sum(delta)::int FROM usage_ledger WHERE type = 'publication') AS ledger, (SELECT count(*)::int FROM usage_reservations WHERE type = 'publication' AND status <> 'released') AS reservations")).rows[0]);
    expect(totals).toEqual({ ledger: 45, reservations: 45 });
  });

  it("la même ressource demandée en parallèle n'est réservée qu'une fois", async () => {
    const { orgId } = await subscribedOrg();
    const id = randomUUID();
    const rs = await Promise.all(Array.from({ length: 10 }, () => res(orgId, "content_item", id)));
    expect(new Set(rs.map((r) => r.id)).size).toBe(1);
    const n = await tx(orgId, async (c) => (await c.query("SELECT count(*)::int AS n FROM usage_ledger WHERE dedupe_key = $1", [`reserve:content_item:${id}`])).rows[0].n);
    expect(n).toBe(1);
  });
});

describe("cycle de vie d'une réservation", () => {
  it("consommation et libération idempotentes ; consommé non libérable ; libéré non consommable", async () => {
    const { orgId } = await subscribedOrg();
    const a = randomUUID();
    const b = randomUUID();
    await res(orgId, "publication", a);
    await res(orgId, "publication", b);
    await tx(orgId, (c) => consume(c, "publication", a, clock.now()));
    await tx(orgId, (c) => consume(c, "publication", a, clock.now())); // retry : pas de débit supplémentaire
    expect(await reason(tx(orgId, (c) => release(c, "publication", a, clock.now())))).toBe("reservation_consumed");
    await tx(orgId, (c) => release(c, "publication", b, clock.now()));
    await tx(orgId, (c) => release(c, "publication", b, clock.now()));
    expect(await reason(tx(orgId, (c) => consume(c, "publication", b, clock.now())))).toBe("reservation_released");
    const u = await tx(orgId, (c) => usageSummary(c, orgId, clock.now()));
    expect(u.publications).toEqual({ limit: 45, reserved: 0, consumed: 1, remaining: 44 });
    const ledger = await tx(orgId, async (c) => (await c.query("SELECT entry_kind, delta FROM usage_ledger WHERE type = 'publication' ORDER BY id")).rows);
    expect(ledger).toEqual([
      { entry_kind: "reserve", delta: 1 },
      { entry_kind: "reserve", delta: 1 },
      { entry_kind: "consume", delta: 0 },
      { entry_kind: "release", delta: -1 },
    ]);
  });

  it("lot partiel : réservation et consommation par sujet, les échecs techniques libérés", async () => {
    const { orgId } = await subscribedOrg();
    const items = Array.from({ length: 5 }, () => randomUUID());
    for (const id of items) await res(orgId, "content_item", id);
    for (const [i, id] of items.entries()) await tx(orgId, (c) => (i < 3 ? consume(c, "content_item", id, clock.now()) : release(c, "content_item", id, clock.now())));
    expect((await tx(orgId, (c) => usageSummary(c, orgId, clock.now()))).contentItems).toEqual({ limit: 15, reserved: 0, consumed: 3, remaining: 12 });
  });

  it("régénérations : 3 par contenu, indépendantes entre contenus ; une erreur technique libérée ne compte pas", async () => {
    const { orgId } = await subscribedOrg();
    const item = randomUUID();
    const jobs = [randomUUID(), randomUUID(), randomUUID()];
    for (const j of jobs) await res(orgId, "regeneration", j, { parentResourceId: item });
    expect(await reason(res(orgId, "regeneration", randomUUID(), { parentResourceId: item }))).toBe("quota_exhausted");
    await tx(orgId, (c) => release(c, "regeneration", jobs[0]!, clock.now()));
    await expect(res(orgId, "regeneration", randomUUID(), { parentResourceId: item })).resolves.toBeTruthy();
    await expect(res(orgId, "regeneration", randomUUID(), { parentResourceId: randomUUID() })).resolves.toBeTruthy();
  });
});

describe("périodes et cycles", () => {
  it("période future refusée au MVP ; sans cycle courant, aucune réservation", async () => {
    const { orgId } = await subscribedOrg();
    const u = await tx(orgId, (c) => usageSummary(c, orgId, clock.now()));
    const after = new Date(new Date(u.cycle!.endsAt).getTime() + DAY);
    expect(await reason(res(orgId, "publication", randomUUID(), { at: after }))).toBe("outside_entitlement_period");
    expect(await reason(res(orgId, "publication", randomUUID(), { at: new Date(new Date(u.cycle!.startsAt).getTime() - 1) }))).toBe("outside_entitlement_period");
    const addr = `nocycle.${randomUUID().slice(0, 8)}@example.test`;
    await signUp(deps, { email: addr, password: PW, uiLocale: "fr-CA" });
    await verifyEmail(deps, { email: addr, code: email.inboxOf(addr).at(-1)!.text.match(/\d{6}/)![0] });
    const { session } = await signIn(deps, { email: addr, password: PW });
    const { organizationId } = await createOrganization(deps, session, { name: "Sans abonnement (fictive)", defaultLocale: "fr-CA" }, { requestId: "q" });
    expect(await reason(res(organizationId, "content_item"))).toBe("no_current_entitlement_period");
    expect((await tx(organizationId, (c) => usageSummary(c, organizationId, clock.now()))).contentItems).toBeNull();
  });

  it("résultat inconnu : la réservation reste attachée au cycle initial, consommée une seule fois", async () => {
    const { orgId, subId } = await subscribedOrg();
    const pub = randomUUID();
    const r1 = await res(orgId, "publication", pub);
    const cycle1 = (await tx(orgId, (c) => usageSummary(c, orgId, clock.now()))).cycle!;
    clock.set(new Date(new Date(cycle1.endsAt).getTime() + 1000));
    await deliver(payments.renew(subId, "paid"));
    const cycle2 = (await tx(orgId, (c) => usageSummary(c, orgId, clock.now()))).cycle!;
    expect(cycle2.id).not.toBe(cycle1.id);
    const c1 = await tx(orgId, (c) => consume(c, "publication", pub, clock.now()));
    const c2 = await tx(orgId, (c) => consume(c, "publication", pub, clock.now()));
    expect([c1.cycleId, c2.cycleId]).toEqual([r1.cycleId, r1.cycleId]);
    expect(r1.cycleId).toBe(cycle1.id);
    expect((await tx(orgId, (c) => usageSummary(c, orgId, clock.now()))).publications).toMatchObject({ reserved: 0, consumed: 0, remaining: 45 });
  });

  it("garde de facturation : impayé ⇒ génération refusée, envoi des contenus approuvés permis pendant la grâce", async () => {
    const { orgId, subId } = await subscribedOrg();
    await tx(orgId, (c) => assertBillingAllows(c, orgId, clock.now(), "generate"));
    const end = (await tx(orgId, (c) => usageSummary(c, orgId, clock.now()))).cycle!.endsAt;
    clock.set(new Date(new Date(end).getTime() + 1000));
    await deliver(payments.renew(subId, "failed"));
    expect(await reason(tx(orgId, (c) => assertBillingAllows(c, orgId, clock.now(), "generate")))).toBe("billing_access_denied");
    expect(await reason(tx(orgId, (c) => assertBillingAllows(c, orgId, clock.now(), "schedule")))).toBe("billing_access_denied");
    await tx(orgId, (c) => assertBillingAllows(c, orgId, clock.now(), "dispatch"));
  });

  it("ledger et réservations : append-only et non supprimables par le runtime", async () => {
    const { orgId } = await subscribedOrg();
    await res(orgId, "content_item");
    await expect(tx(orgId, (c) => c.query("UPDATE usage_ledger SET delta = 0"))).rejects.toMatchObject({ code: "42501" });
    await expect(tx(orgId, (c) => c.query("DELETE FROM usage_reservations"))).rejects.toMatchObject({ code: "42501" });
  });
});
