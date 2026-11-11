/**
 * E05 — API /api/v1 sur PostgreSQL réel : cookies, CSRF, format d'erreur, limites, parcours d'équipe.
 */
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "../../../../packages/test-utils/src/context";
import { FakeIdentityProvider } from "@bbn/auth";
import { createPool } from "@bbn/db";
import { ManualClock } from "@bbn/domain";
import { PRICE_CATALOG } from "@bbn/integrations";
import { FakeAiTextProvider, FakeEmailSender, FakeMalwareScanner, FakeObjectStorage, FakePaymentsProvider } from "@bbn/integrations/fakes";
import { createLimiters, dispatch, type ApiDeps, type HandlerName } from "./api";

const BASE = "http://localhost:3000";
const PW = "correct horse battery staple";
let pool: pg.Pool;
let deps: ApiDeps;
let email: FakeEmailSender;

interface Call {
  body?: unknown;
  cookie?: string | null;
  origin?: string | null;
  method?: string;
  params?: Record<string, string>;
  ip?: string;
}
async function call(name: HandlerName, c: Call = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": c.ip ?? "203.0.113.1" };
  if (c.origin !== null) headers.origin = c.origin ?? BASE;
  if (c.cookie) headers.cookie = c.cookie;
  const req = new Request(`${BASE}/api/v1/x`, { method: c.method ?? (c.body === undefined ? "GET" : "POST"), headers, body: c.body === undefined ? undefined : JSON.stringify(c.body) });
  const res = await dispatch(name, req, deps, c.params ?? {});
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, setCookie: res.headers.get("set-cookie"), headers: res.headers };
}
const uniq = (p: string) => `${p}.${randomUUID().slice(0, 8)}@example.test`;
const codeFor = (to: string) => email.inboxOf(to).at(-1)!.text.match(/\b(\d{6})\b/)![1]!;
const cookieFrom = (setCookie: string | null) => setCookie!.split(";")[0]!;

async function account(prefix: string, ip = randomUUID()) {
  const addr = uniq(prefix);
  expect((await call("auth.signUp", { body: { email: addr, password: PW, uiLocale: "fr-CA" }, ip })).status).toBe(201);
  expect((await call("auth.verifyEmail", { body: { email: addr, code: codeFor(addr) }, ip })).status).toBe(200);
  const r = await call("auth.signIn", { body: { email: addr, password: PW }, ip });
  expect(r.status).toBe(200);
  return { email: addr, cookie: cookieFrom(r.setCookie), userId: r.body.user.id as string };
}

beforeAll(() => {
  const clock = new ManualClock(new Date());
  pool = createPool(inject("dbUrls").appUrl, 4);
  email = new FakeEmailSender();
  deps = { pool, idp: new FakeIdentityProvider(clock), email, clock, appBaseUrl: BASE, limiters: createLimiters(clock), payments: new FakePaymentsProvider(clock, PRICE_CATALOG), storage: new FakeObjectStorage(clock), scanner: new FakeMalwareScanner(), ai: new FakeAiTextProvider(clock), aiModel: "fake-model", simulation: true };
});
afterAll(async () => {
  await pool?.end();
});

describe("authentification HTTP", () => {
  it("connexion : cookie HttpOnly SameSite=Lax, jeton jamais dans le corps", async () => {
    const addr = uniq("http");
    await call("auth.signUp", { body: { email: addr, password: PW, uiLocale: "en-CA" } });
    const r = await call("auth.signIn", { body: { email: addr, password: PW } });
    expect(r.status).toBe(200);
    expect(r.setCookie).toMatch(/^bbn_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+$/);
    expect(JSON.stringify(r.body)).not.toContain(cookieFrom(r.setCookie).split("=")[1]);
    expect(r.body.user.emailVerified).toBe(false);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const me = await call("me.get", { cookie: cookieFrom(r.setCookie) });
    expect(me.body.user.email).toBe(addr);
  });

  it("sans session : 401 au format d'erreur standard", async () => {
    const r = await call("me.get");
    expect(r.status).toBe(401);
    expect(r.body.error).toMatchObject({ code: "unauthenticated", messageKey: "errors.codes.unauthenticated" });
    expect(r.body.error.requestId).toBe(r.headers.get("x-request-id"));
  });

  it("CSRF : origine absente ou étrangère, ou corps non JSON, refusés", async () => {
    expect((await call("auth.signIn", { body: { email: "a@b.c", password: "x" }, origin: null })).status).toBe(403);
    expect((await call("auth.signIn", { body: { email: "a@b.c", password: "x" }, origin: "https://evil.example" })).body.error.code).toBe("origin_rejected");
    const req = new Request(`${BASE}/x`, { method: "POST", headers: { origin: BASE, "content-type": "application/x-www-form-urlencoded" }, body: "email=a" });
    expect((await dispatch("auth.signIn", req, deps)).status).toBe(403);
  });

  it("validation : JSON invalide ou champs manquants → 400 sans écho des valeurs", async () => {
    const r = await call("auth.signUp", { body: { email: "x@y.z", password: PW } });
    expect(r.status).toBe(400);
    expect(r.body.error.details.fields).toEqual(["uiLocale"]);
  });

  it("limite de débit : 5 tentatives par courriel puis 429", async () => {
    const addr = uniq("brute");
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await call("auth.signIn", { body: { email: addr, password: "wrong password" }, ip: randomUUID() })).status);
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it("récupération : réponse identique que le compte existe ou non", async () => {
    const known = await account("rec");
    const a = await call("auth.recoveryStart", { body: { email: known.email, uiLocale: "fr-CA" }, ip: randomUUID() });
    const b = await call("auth.recoveryStart", { body: { email: uniq("ghost"), uiLocale: "fr-CA" }, ip: randomUUID() });
    expect([a.status, b.status]).toEqual([202, 202]);
    expect(a.body).toEqual(b.body);
  });

  it("déconnexion : cookie effacé et session révoquée", async () => {
    const u = await account("logout");
    const r = await call("auth.signOut", { body: {}, cookie: u.cookie });
    expect(r.status).toBe(204);
    expect(r.setCookie).toContain("Max-Age=0");
    expect((await call("me.get", { cookie: u.cookie })).status).toBe(401);
  });
});

describe("organisations et équipe HTTP", () => {
  it("création, invitation, acceptation, liste ; tenant étranger → 404", async () => {
    const owner = await account("owner");
    const created = await call("organizations.create", { body: { name: "Démo HTTP (fictive)", defaultLocale: "fr-CA" }, cookie: owner.cookie });
    expect(created.status).toBe(201);
    const orgId = created.body.id as string;

    const invitee = await account("invitee");
    const inv = await call("invitations.create", { body: { email: invitee.email, role: "reviewer" }, cookie: owner.cookie, params: { id: orgId } });
    expect(inv.status).toBe(201);
    expect(Object.keys(inv.body).sort()).toEqual(["expiresAt", "id"]);
    const token = decodeURIComponent(email.inboxOf(invitee.email).at(-1)!.text.match(/token=([^\s]+)/)![1]!);
    expect((await call("invitations.accept", { body: { token }, cookie: invitee.cookie })).body).toEqual({ organizationId: orgId, role: "reviewer" });

    const members = await call("members.list", { cookie: invitee.cookie, params: { id: orgId } });
    expect(members.body.data.map((m: { role: string }) => m.role).sort()).toEqual(["owner", "reviewer"]);
    // Le relecteur ne peut pas inviter.
    expect((await call("invitations.create", { body: { email: uniq("x"), role: "editor" }, cookie: invitee.cookie, params: { id: orgId } })).status).toBe(403);

    const outsider = await account("outsider");
    expect((await call("members.list", { cookie: outsider.cookie, params: { id: orgId } })).status).toBe(404);
    expect((await call("members.list", { cookie: outsider.cookie, params: { id: "not-a-uuid" } })).status).toBe(404);

    // Retrait immédiat.
    expect((await call("members.remove", { method: "DELETE", cookie: owner.cookie, params: { id: orgId, userId: invitee.userId } })).status).toBe(204);
    expect((await call("members.list", { cookie: invitee.cookie, params: { id: orgId } })).status).toBe(404);
  });

  it("transfert : 401 reauth_required sans réauthentification, puis 204", async () => {
    const owner = await account("t-owner");
    const orgId = (await call("organizations.create", { body: { name: "Transfert (fictif)", defaultLocale: "en-CA" }, cookie: owner.cookie })).body.id;
    const admin = await account("t-admin");
    await call("invitations.create", { body: { email: admin.email, role: "admin" }, cookie: owner.cookie, params: { id: orgId } });
    const token = decodeURIComponent(email.inboxOf(admin.email).at(-1)!.text.match(/token=([^\s]+)/)![1]!);
    await call("invitations.accept", { body: { token }, cookie: admin.cookie });

    const t1 = await call("organizations.transfer", { body: { newOwnerUserId: admin.userId }, cookie: owner.cookie, params: { id: orgId } });
    expect([t1.status, t1.body.error.code]).toEqual([401, "reauth_required"]);
    expect((await call("auth.reauthenticate", { body: { password: PW }, cookie: owner.cookie })).status).toBe(200);
    expect((await call("organizations.transfer", { body: { newOwnerUserId: admin.userId }, cookie: owner.cookie, params: { id: orgId } })).status).toBe(204);
    // L'ancien propriétaire (désormais admin) ne peut plus transférer.
    expect((await call("organizations.transfer", { body: { newOwnerUserId: owner.userId }, cookie: owner.cookie, params: { id: orgId } })).status).toBe(403);
  });

  it("dernier propriétaire : 422 last_owner_protected", async () => {
    const owner = await account("last");
    const orgId = (await call("organizations.create", { body: { name: "Seul (fictif)", defaultLocale: "fr-CA" }, cookie: owner.cookie })).body.id;
    const r = await call("members.remove", { method: "DELETE", cookie: owner.cookie, params: { id: orgId, userId: owner.userId } });
    expect([r.status, r.body.error.code]).toEqual([422, "last_owner_protected"]);
  });
});

describe("webhook de paiement HTTP", () => {
  it("corps brut + signature : 400 si invalide, 200 puis doublon acquitté", async () => {
    const fake = deps.payments as FakePaymentsProvider;
    const e = fake.signEvent("subscription.updated", { probe: true });
    const post = (body: string, sig: string | null) =>
      dispatch("webhooks.stripe", new Request(`${BASE}/api/v1/webhooks/stripe`, { method: "POST", headers: sig ? { "stripe-signature": sig } : {}, body }), deps);
    expect((await post(e.rawBody, null)).status).toBe(400);
    expect((await post(e.rawBody + " ", e.signature)).status).toBe(400);
    const ok = await post(e.rawBody, e.signature);
    expect([ok.status, await ok.json()]).toEqual([200, { received: true, duplicate: false }]);
    expect(await (await post(e.rawBody, e.signature)).json()).toEqual({ received: true, duplicate: true });
  });

  it("paiement simulé : refusé hors mode simulation", async () => {
    const r = await dispatch("dev.simulatePayment", new Request(`${BASE}/x`, { method: "POST", headers: { origin: BASE, "content-type": "application/json" }, body: "{}" }), { ...deps, simulation: false });
    expect(r.status).toBe(404);
  });
});
