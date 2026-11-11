/** E12 — outbox, relais et consommateurs idempotents sur PostgreSQL réel. */
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "../../test-utils/src/context";
import { reserve } from "../../billing/src/quota";
import { createOrganizationWithOwner, createPool, withTenant, withUser } from "@bbn/db";
import { ManualClock } from "@bbn/domain";
import type { MessageQueue } from "@bbn/integrations";
import { FakeMessageQueue } from "@bbn/integrations/fakes";
import { createLogger } from "@bbn/observability";
import { consumeBatch, type Handler } from "./consumer";
import { enqueue, outboxStats, relayOutbox, type Envelope } from "./outbox";

let pool: pg.Pool;
let clock: ManualClock;
const logger = createLogger({}, () => undefined);

/** Organisation avec un cycle de droits courant (5 publications). */
async function org(): Promise<string> {
  const userId = randomUUID();
  const orgId = randomUUID();
  await withUser(pool, userId, ({ client }) => client.query("INSERT INTO users (id, auth_subject, email, ui_locale) VALUES ($1, $2, $3, 'fr-CA')", [userId, `jobs-${userId}`, `jobs.${userId.slice(0, 8)}@example.test`]));
  await createOrganizationWithOwner(pool, { organizationId: orgId, ownerUserId: userId, name: "Jobs (fictive)", defaultLocale: "fr-CA" });
  await withTenant(pool, { organizationId: orgId, userId: null }, async ({ client }) => {
    const start = new Date(clock.now().getTime() - 3600_000);
    const end = new Date(clock.now().getTime() + 30 * 24 * 3600_000);
    const sub = (await client.query<{ id: string }>("INSERT INTO subscriptions (organization_id, plan_code, plan_version, status, current_period_start, current_period_end) VALUES ($1, 'essentiel', 1, 'active', $2, $3) RETURNING id", [orgId, start, end])).rows[0]!.id;
    const cycle = (await client.query<{ id: string }>("INSERT INTO billing_cycles (organization_id, subscription_id, starts_at, ends_at) VALUES ($1, $2, $3, $4) RETURNING id", [orgId, sub, start, end])).rows[0]!.id;
    await client.query("INSERT INTO entitlements (organization_id, cycle_id, key, limit_value, effective_from, effective_to) VALUES ($1, $2, 'publications', 5, $3, $4)", [orgId, cycle, start, end]);
  });
  return orgId;
}
const tx = <T>(orgId: string, fn: (c: pg.PoolClient) => Promise<T>) => withTenant(pool, { organizationId: orgId, userId: null }, ({ client }) => fn(client));
const event = (orgId: string, extra: Partial<Parameters<typeof enqueue>[1]> = {}) => ({
  organizationId: orgId,
  type: "test.charge",
  queue: "generation" as const,
  aggregateType: "test",
  aggregateId: randomUUID(),
  payload: { n: 1 },
  correlationId: `req-${randomUUID().slice(0, 8)}`,
  ...extra,
});
/** Effet NON idempotent par nature (réserve une publication pour une ressource nouvelle à chaque exécution) : seule l'inbox empêche le double débit. */
const charge: Handler = async ({ client }, env) => {
  await reserve(client, { organizationId: env.organizationId, type: "publication", resourceId: randomUUID(), now: clock.now() });
};
const handlers = { "test.charge": { consumer: "test-charge", handle: charge } };
const reservations = (orgId: string) => tx(orgId, async (c) => (await c.query<{ n: number }>("SELECT count(*)::int AS n FROM usage_reservations WHERE type = 'publication'")).rows[0]!.n);
const pendingFor = (orgId: string) => tx(orgId, async (c) => (await c.query<{ n: number }>("SELECT count(*)::int AS n FROM outbox_events WHERE dispatched_at IS NULL")).rows[0]!.n);

beforeAll(() => {
  pool = createPool(inject("dbUrls").appUrl, 8);
  clock = new ManualClock(new Date(Date.now() + 60_000)); // devant l'horloge de la base : événements immédiatement disponibles
});
afterAll(async () => {
  await pool?.end();
});

describe("outbox transactionnelle", () => {
  it("annulation de la transaction métier ⇒ aucun événement ; validation ⇒ un événement ; clé de déduplication respectée", async () => {
    const orgId = await org();
    await expect(
      tx(orgId, async (c) => {
        await enqueue(c, event(orgId));
        throw new Error("échec métier");
      }),
    ).rejects.toThrow("échec métier");
    expect(await pendingFor(orgId)).toBe(0);
    const a = await tx(orgId, (c) => enqueue(c, event(orgId, { dedupeKey: "generate:item-1" })));
    const b = await tx(orgId, (c) => enqueue(c, event(orgId, { dedupeKey: "generate:item-1" })));
    expect(a).toBe(b);
    expect(await pendingFor(orgId)).toBe(1);
    await expect(tx(orgId, (c) => c.query("UPDATE outbox_events SET dispatched_at = now()"))).rejects.toMatchObject({ code: "42501" });
  });
});

describe("relais et consommateurs", () => {
  it("parcours nominal : relais → file → consommateur ; corrélation conservée ; effet unique", async () => {
    const orgId = await org();
    const q = new FakeMessageQueue(clock);
    const e = event(orgId, { correlationId: "req-abc" });
    await tx(orgId, (c) => enqueue(c, e));
    const r = await relayOutbox({ pool, queue: q, clock }, { workerId: "relay-1" });
    expect(r.dispatched).toBeGreaterThanOrEqual(1);
    const seen: Envelope[] = [];
    const c = await consumeBatch({ pool, queue: q, logger }, "generation", { "test.charge": { consumer: "test-charge", handle: async (t, env) => { seen.push(env); await charge(t, env); } } }, { maxMessages: 100, visibilityTimeoutSeconds: 30 });
    expect(c.processed).toBeGreaterThanOrEqual(1);
    expect(seen.find((s) => s.organizationId === orgId)?.correlationId).toBe("req-abc");
    expect(await reservations(orgId)).toBe(1);
    expect(await pendingFor(orgId)).toBe(0);
  });

  it("crash AVANT envoi : le bail expire, l'événement est réclamé et envoyé — rien n'est perdu", async () => {
    const orgId = await org();
    await tx(orgId, (c) => enqueue(c, event(orgId)));
    const before = (await pool.query("SELECT * FROM outbox_claim('crashed-relay', 100, 30, $1)", [clock.now()])).rows.filter((x) => x.organization_id === orgId);
    expect(before).toHaveLength(1); // réclamé puis « crash » : ni envoi ni marquage
    const q = new FakeMessageQueue(clock);
    await relayOutbox({ pool, queue: q, clock }, { workerId: "relay-2", limit: 100 });
    expect(await pendingFor(orgId)).toBe(1); // bail encore valide : non repris
    clock.advanceSeconds(31);
    await relayOutbox({ pool, queue: q, clock }, { workerId: "relay-2", limit: 100 });
    await consumeBatch({ pool, queue: q, logger }, "generation", handlers, { maxMessages: 100, visibilityTimeoutSeconds: 30 });
    expect(await reservations(orgId)).toBe(1);
    expect(await pendingFor(orgId)).toBe(0);
  });

  it("crash APRÈS envoi, avant marquage : renvoyé après expiration du bail, effet appliqué une seule fois", async () => {
    const orgId = await org();
    await tx(orgId, (c) => enqueue(c, event(orgId)));
    // Relais 1 : envoie mais « crashe » avant de marquer (file sans déduplication : le pire cas).
    const sent: unknown[] = [];
    const noDedupe: MessageQueue = { ...new FakeMessageQueue(clock), send: async (_q: string, body: unknown) => { sent.push(body); return { id: randomUUID() }; } } as unknown as MessageQueue;
    const claimed = (await pool.query<{ id: string; organization_id: string; type: string; queue: string; payload: unknown; correlation_id: string }>("SELECT * FROM outbox_claim('relay-crash', 100, 30, $1)", [clock.now()])).rows.filter((x) => x.organization_id === orgId);
    for (const r of claimed) await noDedupe.send("generation", { messageId: r.id, type: r.type, organizationId: r.organization_id, correlationId: r.correlation_id, payload: r.payload });
    clock.advanceSeconds(31);
    const q = new FakeMessageQueue(clock);
    for (const b of sent) await q.send("generation", b); // premier envoi, arrivé dans la file
    await relayOutbox({ pool, queue: q, clock }, { workerId: "relay-2", limit: 100 }); // renvoi après expiration du bail
    expect(q.depth("generation")).toBeGreaterThanOrEqual(2);
    const c = await consumeBatch({ pool, queue: q, logger }, "generation", handlers, { maxMessages: 100, visibilityTimeoutSeconds: 30 });
    expect(c.duplicates).toBeGreaterThanOrEqual(1);
    expect(await reservations(orgId)).toBe(1);
  });

  it("livraison multiple par la file : un seul effet", async () => {
    const orgId = await org();
    const q = new FakeMessageQueue(clock);
    await tx(orgId, (c) => enqueue(c, event(orgId)));
    await relayOutbox({ pool, queue: q, clock }, { workerId: "relay-1", limit: 100 });
    q.duplicateNext(5);
    await consumeBatch({ pool, queue: q, logger }, "generation", handlers, { maxMessages: 100, visibilityTimeoutSeconds: 30 });
    expect(await reservations(orgId)).toBe(1);
  });

  it("bail expiré : le relais retardataire ne peut plus marquer ; deux relais concurrents réclament des lots disjoints", async () => {
    const orgId = await org();
    for (let i = 0; i < 6; i++) await tx(orgId, (c) => enqueue(c, event(orgId)));
    const [a, b] = await Promise.all([
      pool.query<{ id: string }>("SELECT id FROM outbox_claim('relay-A', 3, 30, $1)", [clock.now()]),
      pool.query<{ id: string }>("SELECT id FROM outbox_claim('relay-B', 3, 30, $1)", [clock.now()]),
    ]);
    const ids = [...a.rows, ...b.rows].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const late = a.rows[0]!.id;
    clock.advanceSeconds(31);
    const reclaimed = (await pool.query<{ id: string }>("SELECT id FROM outbox_claim('relay-C', 100, 30, $1)", [clock.now()])).rows.map((r) => r.id);
    expect(reclaimed).toContain(late);
    expect((await pool.query<{ ok: boolean }>("SELECT outbox_mark_dispatched($1, 'relay-A', $2) AS ok", [late, clock.now()])).rows[0]!.ok).toBe(false);
    expect((await pool.query<{ ok: boolean }>("SELECT outbox_mark_dispatched($1, 'relay-C', $2) AS ok", [late, clock.now()])).rows[0]!.ok).toBe(true);
  });

  it("échecs d'envoi : nouvelle tentative différée puis « mort » ; handler en échec ⇒ DLQ, sans effet partiel", async () => {
    const orgId = await org();
    await tx(orgId, (c) => enqueue(c, event(orgId)));
    const broken = { send: async () => Promise.reject(new Error("queue down")) } as unknown as MessageQueue;
    for (let i = 0; i < 3; i++) {
      await relayOutbox({ pool, queue: broken, clock }, { workerId: "relay-x", limit: 100, maxAttempts: 3 });
      clock.advanceSeconds(20 * 60);
    }
    const s = await outboxStats(pool, clock.now());
    expect(s.dead).toBeGreaterThanOrEqual(1);

    const org2 = await org();
    await tx(org2, (c) => enqueue(c, event(org2)));
    const q = new FakeMessageQueue(clock, 2);
    await relayOutbox({ pool, queue: q, clock }, { workerId: "relay-1", limit: 100 });
    const failing = { "test.charge": { consumer: "test-fail", handle: (async (t, env) => { await charge(t, env); throw new Error("boom"); }) as Handler } };
    for (let i = 0; i < 3; i++) {
      await consumeBatch({ pool, queue: q, logger }, "generation", failing, { maxMessages: 100, visibilityTimeoutSeconds: 1 });
      clock.advanceSeconds(2);
    }
    expect(q.deadLetters("generation").length).toBeGreaterThanOrEqual(1);
    expect(await reservations(org2)).toBe(0); // la transaction (effet + inbox) a été annulée à chaque échec
  });

  it("message sans organisation valide : rejeté, jamais traité", async () => {
    const q = new FakeMessageQueue(clock);
    await q.send("generation", { messageId: "m1", type: "test.charge", organizationId: "", correlationId: "c", payload: {} });
    expect((await consumeBatch({ pool, queue: q, logger }, "generation", handlers)).rejected).toBe(1);
  });
});
