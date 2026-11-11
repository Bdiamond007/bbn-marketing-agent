/**
 * Outbox transactionnelle et relais (E12, §9/§11).
 * 1. `enqueue` est appelé DANS la transaction métier : l'événement existe si et seulement si le changement est validé.
 * 2. Le relais réclame des événements (SKIP LOCKED, bail expirant), les envoie à la file (déduplication par id d'outbox),
 *    puis les marque envoyés — seulement s'il détient encore le bail.
 * Crash avant envoi ou après envoi mais avant marquage : le bail expire, l'événement est renvoyé. Livraison
 * « au moins une fois » : les consommateurs sont idempotents (consumer_inbox). Aucun « exactly once » n'est promis.
 */
import type pg from "pg";
import type { Clock } from "@bbn/domain";
import type { MessageQueue, QueueName } from "@bbn/integrations";
import type { Logger } from "@bbn/observability";

export interface Envelope<P = unknown> {
  /** Identifiant de l'événement d'outbox : clé d'idempotence des consommateurs. */
  messageId: string;
  type: string;
  organizationId: string;
  correlationId: string;
  payload: P;
}

export interface EnqueueInput {
  organizationId: string;
  type: string;
  queue: QueueName;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  correlationId: string;
  /** Évite d'émettre deux fois le même événement logique (ex. « generate:{itemId}:{jobId} »). */
  dedupeKey?: string;
  availableAt?: Date;
}

/** À appeler dans la transaction tenant de l'opération métier. Renvoie l'id (existant si dédupliqué). */
export async function enqueue(client: pg.PoolClient, e: EnqueueInput): Promise<string> {
  const r = await client.query<{ id: string }>(
    `INSERT INTO outbox_events (organization_id, type, queue, aggregate_type, aggregate_id, payload, correlation_id, dedupe_key, available_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, coalesce($9, now()))
     ON CONFLICT (organization_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
     RETURNING id`,
    [e.organizationId, e.type, e.queue, e.aggregateType, e.aggregateId, JSON.stringify(e.payload), e.correlationId, e.dedupeKey ?? null, e.availableAt ?? null],
  );
  if (r.rows[0]) return r.rows[0].id;
  return (await client.query<{ id: string }>("SELECT id FROM outbox_events WHERE organization_id = $1 AND dedupe_key = $2", [e.organizationId, e.dedupeKey])).rows[0]!.id;
}

export interface RelayDeps {
  pool: pg.Pool;
  queue: MessageQueue;
  clock: Clock;
  logger?: Logger;
}

export interface RelayOptions {
  workerId: string;
  limit?: number;
  leaseSeconds?: number;
  maxAttempts?: number;
}

export interface RelayReport {
  claimed: number;
  dispatched: number;
  failed: number;
  lostLease: number;
}

/** Délai exponentiel avec plafond (5 s, 10 s, 20 s… ≤ 15 min) et aléa borné. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(15 * 60_000, 5_000 * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.8 + 0.4 * random()));
}

interface Claimed {
  id: string;
  organization_id: string;
  type: string;
  queue: QueueName;
  payload: unknown;
  correlation_id: string | null;
  attempts: number;
}

export async function relayOutbox(deps: RelayDeps, o: RelayOptions): Promise<RelayReport> {
  const now = deps.clock.now();
  const rows = (await deps.pool.query<Claimed>("SELECT * FROM outbox_claim($1, $2, $3, $4)", [o.workerId, o.limit ?? 50, o.leaseSeconds ?? 60, now])).rows;
  const report: RelayReport = { claimed: rows.length, dispatched: 0, failed: 0, lostLease: 0 };
  for (const r of rows) {
    const envelope: Envelope = { messageId: r.id, type: r.type, organizationId: r.organization_id, correlationId: r.correlation_id ?? r.id, payload: r.payload };
    try {
      await deps.queue.send(r.queue, envelope, { deduplicationId: r.id });
    } catch (e) {
      report.failed += 1;
      const retryAt = new Date(deps.clock.now().getTime() + backoffMs(r.attempts));
      await deps.pool.query("SELECT outbox_mark_failed($1, $2, $3, $4, $5)", [r.id, o.workerId, e instanceof Error ? e.name : "send_failed", retryAt, o.maxAttempts ?? 10]);
      deps.logger?.warn("outbox_send_failed", { outboxId: r.id, correlationId: envelope.correlationId, attempts: r.attempts });
      continue;
    }
    const ok = (await deps.pool.query<{ ok: boolean }>("SELECT outbox_mark_dispatched($1, $2, $3) AS ok", [r.id, o.workerId, deps.clock.now()])).rows[0]?.ok;
    if (ok) report.dispatched += 1;
    else {
      // Bail perdu (expiré et repris) : le message a pu être envoyé deux fois ; les consommateurs sont idempotents.
      report.lostLease += 1;
      deps.logger?.warn("outbox_lease_lost", { outboxId: r.id, correlationId: envelope.correlationId });
    }
  }
  return report;
}

export async function outboxStats(pool: pg.Pool, now: Date): Promise<{ pending: number; dead: number; oldestPendingSeconds: number }> {
  const r = (await pool.query<{ pending: string; dead: string; oldest_pending_seconds: number }>("SELECT * FROM outbox_stats($1)", [now])).rows[0]!;
  return { pending: Number(r.pending), dead: Number(r.dead), oldestPendingSeconds: Number(r.oldest_pending_seconds) };
}
