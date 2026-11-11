/** E07 — abonnement et droits sur PostgreSQL réel, paiements simulés. */
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "../../test-utils/src/context";
import { createOrganization, FakeIdentityProvider, reauthenticate, resolveSession, signIn, signUp, verifyEmail, type SessionInfo } from "@bbn/auth";
import { createPool, withTenant } from "@bbn/db";
import { ManualClock, ServiceError } from "@bbn/domain";
import { PRICE_CATALOG } from "@bbn/integrations";
import { FakeEmailSender, FakePaymentsProvider, type SignedEvent } from "@bbn/integrations/fakes";
import { projectPending, reconcileSubscriptions } from "./projection";
import { cancelSubscription, changePlan, getBillingOverview, ingestWebhook, startCheckout, type BillingDeps } from "./service";

const PW = "correct horse battery staple";
const meta = { requestId: "billing-test" };
const DAY = 24 * 3600 * 1000;
let pool: pg.Pool;
let clock: ManualClock;
let email: FakeEmailSender;
let payments: FakePaymentsProvider;
let deps: BillingDeps;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ServiceError) return e.code;
    throw e;
  }
  throw new Error("ServiceError attendue");
}

async function owner(): Promise<{ session: SessionInfo; token: string; orgId: string; email: string }> {
  const addr = `billing.${randomUUID().slice(0, 8)}@example.test`;
  await signUp(deps, { email: addr, password: PW, uiLocale: "fr-CA" });
  await verifyEmail(deps, { email: addr, code: email.inboxOf(addr).at(-1)!.text.match(/\d{6}/)![0] });
  const { session, token } = await signIn(deps, { email: addr, password: PW });
  const { organizationId } = await createOrganization(deps, session, { name: "Facturation (fictive)", defaultLocale: "fr-CA" }, meta);
  return { session, token, orgId: organizationId, email: addr };
}

/** Nouvelle connexion (les sauts d'horloge de plus de 7 jours expirent volontairement la session). */
const relogin = async (o: { email: string }) => (await signIn(deps, { email: o.email, password: PW })).session;
const deliver = async (events: SignedEvent[]) => {
  for (const e of events) await ingestWebhook(deps, e.rawBody, e.signature);
};
const project = () => projectPending({ pool, payments, clock });
const sessionIdOf = (orgId: string) => payments.checkouts.filter((c) => c.organizationId === orgId).at(-1)!.sessionId;
async function subscribed(planCode = "essentiel") {
  const o = await owner();
  await startCheckout(deps, o.session, o.orgId, planCode, "fr-CA", meta);
  const events = payments.completeCheckout(sessionIdOf(o.orgId));
  await deliver(events);
  await project();
  const subId = JSON.parse(events[0]!.rawBody).data.subscription.id as string;
  return { ...o, subId };
}

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

describe("Checkout et webhook (BILL-01)", () => {
  it("la redirection Checkout n'accorde aucun droit ; seul le webhook projeté le fait", async () => {
    const o = await owner();
    const { url } = await startCheckout(deps, o.session, o.orgId, "essentiel", "fr-CA", meta);
    expect(url).toContain("/fr/app/billing/simulated-checkout?session=");
    const before = await getBillingOverview(deps, o.session, o.orgId);
    expect(before.subscription).toBeNull();
    expect(before.access.canGenerate).toBe(false);

    const events = payments.completeCheckout(sessionIdOf(o.orgId));
    await deliver(events);
    // Persisté mais pas encore projeté : toujours aucun droit.
    expect((await getBillingOverview(deps, o.session, o.orgId)).access.canGenerate).toBe(false);
    expect((await project()).processed).toBeGreaterThanOrEqual(2);
    const after = await getBillingOverview(deps, o.session, o.orgId);
    expect(after.subscription).toMatchObject({ status: "active", planCode: "essentiel" });
    expect(after.access.canGenerate).toBe(true);
    expect(after.entitlements).toEqual({ brands: 1, users: 2, content_items: 15, publications: 45, social_accounts: 3, regenerations_per_item: 3 });
  });

  it("webhook dupliqué : acquitté, jamais retraité, aucun droit doublé", async () => {
    const o = await owner();
    await startCheckout(deps, o.session, o.orgId, "essentiel", "fr-CA", meta);
    const events = payments.completeCheckout(sessionIdOf(o.orgId));
    for (const e of events) {
      expect(await ingestWebhook(deps, e.rawBody, e.signature)).toEqual({ duplicate: false });
      expect(await ingestWebhook(deps, e.rawBody, e.signature)).toEqual({ duplicate: true });
    }
    await project();
    await deliver(events);
    await project();
    const ov = await getBillingOverview(deps, o.session, o.orgId);
    expect(ov.entitlements.content_items).toBe(15);
    const rows = await withTenant(pool, { organizationId: o.orgId, userId: null }, async ({ client }) => (await client.query("SELECT count(*)::int AS n FROM entitlements WHERE key = 'content_items'")).rows[0].n);
    expect(rows).toBe(1);
  });

  it("signature absente, invalide ou corps altéré : refus, rien n'est enregistré", async () => {
    const e = payments.signEvent("subscription.updated", { hello: "world" });
    expect(await code(ingestWebhook(deps, e.rawBody, null))).toBe("validation_failed");
    expect(await code(ingestWebhook(deps, e.rawBody.replace("world", "earth"), e.signature))).toBe("validation_failed");
    expect(await code(ingestWebhook(deps, e.rawBody, "t=1,v1=00"))).toBe("validation_failed");
  });

  it("événements dans le désordre : l'instantané le plus récent l'emporte", async () => {
    const s = await subscribed();
    clock.advanceMs(1000);
    const failed = payments.renew(s.subId, "failed");
    clock.advanceMs(2000);
    const paid = payments.retryPayment(s.subId, "paid");
    await deliver([...paid, ...failed]); // le plus récent d'abord
    await project();
    const ov = await getBillingOverview(deps, s.session, s.orgId);
    expect(ov.subscription?.status).toBe("active");
    expect(ov.subscription?.graceUntil).toBeNull();
  });

  it("un événement visant un abonnement connu avec une autre organisation est ignoré", async () => {
    const a = await subscribed();
    const b = await owner();
    const forged = payments.signEvent("subscription.updated", {
      subscription: { id: a.subId, customerRef: "cus_x", organizationId: b.orgId, status: "active", priceCode: "accompagne_monthly_cad_v1", currentPeriodStart: new Date().toISOString(), currentPeriodEnd: new Date(Date.now() + DAY).toISOString(), cancelAtPeriodEnd: false, scheduledPriceCode: null },
    });
    await deliver([forged]);
    expect((await project()).ignored).toBe(1);
    expect((await getBillingOverview(deps, b.session, b.orgId)).subscription).toBeNull();
    expect((await getBillingOverview(deps, a.session, a.orgId)).subscription?.planCode).toBe("essentiel");
  });
});

describe("impayé et grâce", () => {
  it("grâce de 7 jours depuis l'échéance initiale, non prolongée par une nouvelle tentative", async () => {
    const s = await subscribed();
    const ov0 = await getBillingOverview(deps, s.session, s.orgId);
    const due = new Date(ov0.subscription!.currentPeriodEnd!);
    clock.set(new Date(due.getTime() + 1000));
    await deliver(payments.renew(s.subId, "failed"));
    await project();
    const fresh = async () => getBillingOverview(deps, await relogin(s), s.orgId);
    let ov = await fresh();
    expect(ov.subscription?.status).toBe("past_due");
    expect(ov.subscription?.graceUntil).toBe(new Date(due.getTime() + 7 * DAY).toISOString());
    expect(ov.access).toMatchObject({ canGenerate: false, canSchedule: false, canDispatchApproved: true, reason: "grace" });

    clock.advanceMs(3 * DAY);
    await deliver(payments.retryPayment(s.subId, "failed"));
    await project();
    ov = await fresh();
    expect(ov.subscription?.graceUntil).toBe(new Date(due.getTime() + 7 * DAY).toISOString());

    clock.set(new Date(due.getTime() + 7 * DAY));
    ov = await fresh();
    expect(ov.access).toMatchObject({ canDispatchApproved: false, reason: "grace_over" });
  });
});

describe("changement de plan", () => {
  it("mise à niveau : delta crédité après paiement, sans réinitialisation ; rejeu sans effet", async () => {
    const s = await subscribed("essentiel");
    clock.advanceMs(1000);
    const { events, effective } = payments.change(s.subId, "croissance_monthly_cad_v1");
    expect(effective).toBe("immediate");
    await deliver(events);
    await project();
    await deliver(events);
    await project();
    const ov = await getBillingOverview(deps, await relogin(s), s.orgId);
    expect(ov.subscription?.planCode).toBe("croissance");
    expect(ov.entitlements).toMatchObject({ content_items: 30, publications: 90, users: 5 });
  });

  it("rétrogradation : programmée, appliquée seulement au renouvellement", async () => {
    const s = await subscribed("croissance");
    clock.advanceMs(1000);
    const r = await changePlan(deps, await relogin(s), s.orgId, "essentiel", meta);
    expect(r.effective).toBe("at_renewal");
    // L'adaptateur a changé l'état fournisseur ; l'état local suit via l'événement.
    clock.advanceMs(1000);
    await deliver([payments.signEvent("subscription.updated", { subscription: await payments.retrieveSubscription(s.subId) })]);
    await project();
    let ov = await getBillingOverview(deps, await relogin(s), s.orgId);
    expect(ov.subscription).toMatchObject({ planCode: "croissance", scheduledPlanCode: "essentiel" });
    expect(ov.entitlements.content_items).toBe(30);

    clock.set(new Date(ov.subscription!.currentPeriodEnd!));
    clock.advanceMs(1000);
    await deliver(payments.renew(s.subId, "paid"));
    await project();
    ov = await getBillingOverview(deps, await relogin(s), s.orgId);
    expect(ov.subscription).toMatchObject({ planCode: "essentiel", scheduledPlanCode: null });
    expect(ov.entitlements.content_items).toBe(15);
  });
});

describe("annulation, droits et réconciliation", () => {
  it("annulation à échéance permise ; suspension immédiate exige une réauthentification", async () => {
    const s = await subscribed();
    const login = await signIn(deps, { email: s.email, password: PW });
    let session = login.session;
    expect(await code(cancelSubscription(deps, session, s.orgId, "immediately", meta))).toBe("reauth_required");
    await cancelSubscription(deps, session, s.orgId, "at_period_end", meta);
    clock.advanceMs(1000);
    await deliver([payments.signEvent("subscription.updated", { subscription: await payments.retrieveSubscription(s.subId) })]);
    await project();
    expect((await getBillingOverview(deps, session, s.orgId)).subscription).toMatchObject({ status: "active", cancelAtPeriodEnd: true });
    await reauthenticate(deps, session, PW);
    session = (await resolveSession(deps, login.token))!;
    await cancelSubscription(deps, session, s.orgId, "immediately", meta);
    clock.advanceMs(1000);
    await deliver([payments.signEvent("subscription.updated", { subscription: await payments.retrieveSubscription(s.subId) })]);
    await project();
    const ov = await getBillingOverview(deps, session, s.orgId);
    expect(ov.subscription?.status).toBe("canceled");
    expect(ov.access).toMatchObject({ canGenerate: false, canRead: true, reason: "ended_read_only" });
  });

  it("seul le propriétaire gère la facturation", async () => {
    const s = await subscribed();
    const outsider = await owner();
    expect(await code(startCheckout(deps, outsider.session, s.orgId, "essentiel", "fr-CA", meta))).toBe("not_found");
    expect(await code(startCheckout(deps, s.session, s.orgId, "essentiel", "fr-CA", meta))).toBe("conflict");
    expect(await code(startCheckout(deps, outsider.session, outsider.orgId, "gratuit", "fr-CA", meta))).toBe("validation_failed");
  });

  it("réconciliation : un webhook perdu est rattrapé depuis l'état du fournisseur", async () => {
    const s = await subscribed();
    const ov0 = await getBillingOverview(deps, s.session, s.orgId);
    clock.set(new Date(new Date(ov0.subscription!.currentPeriodEnd!).getTime() + 1000));
    await deliver(payments.renew(s.subId, "failed"));
    await project();
    clock.advanceMs(1000);
    payments.retryPayment(s.subId, "paid"); // événements jamais livrés
    const r = await reconcileSubscriptions({ pool, payments, clock });
    expect(r.updated).toBeGreaterThanOrEqual(1);
    const ov = await getBillingOverview(deps, await relogin(s), s.orgId);
    expect(ov.subscription).toMatchObject({ status: "active", graceUntil: null });
    expect(ov.cycle).not.toBeNull();
    expect(ov.entitlements.publications).toBe(45);
  });
});
