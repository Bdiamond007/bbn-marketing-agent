/**
 * Consommation idempotente : l'enregistrement « message traité » est inséré dans la même transaction tenant
 * que l'effet du handler. Une relivraison (doublon de file, bail expiré, crash après effet) est ignorée.
 */
import type pg from "pg";
import { isUuid, withTenant, type Tx } from "@bbn/db";
import type { MessageQueue, QueueName } from "@bbn/integrations";
import type { Logger } from "@bbn/observability";
import type { Envelope } from "./outbox";

export type Handler = (tx: Tx, envelope: Envelope) => Promise<void>;

export interface ConsumeReport {
  processed: number;
  duplicates: number;
  failed: number;
  rejected: number;
}

/** Exécute `fn` une seule fois par (consommateur, message) ; renvoie false si déjà traité. */
export async function runOnce(pool: pg.Pool, consumer: string, env: Envelope, fn: Handler): Promise<boolean> {
  return withTenant(pool, { organizationId: env.organizationId, userId: null }, async (tx) => {
    const r = await tx.client.query("INSERT INTO consumer_inbox (organization_id, consumer, message_key) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [env.organizationId, consumer, env.messageId]);
    if (r.rowCount === 0) return false; // déjà traité
    await fn(tx, env);
    return true;
  });
}

/**
 * Consomme un lot d'une file. Échec du handler ⇒ pas d'acquittement (transaction annulée, inbox comprise) :
 * le message revient après le délai de visibilité, puis part en DLQ au-delà du seuil de la file.
 */
export async function consumeBatch(
  deps: { pool: pg.Pool; queue: MessageQueue; logger: Logger },
  queue: QueueName,
  handlers: Readonly<Record<string, { consumer: string; handle: Handler }>>,
  opts = { maxMessages: 10, visibilityTimeoutSeconds: 60 },
): Promise<ConsumeReport> {
  const report: ConsumeReport = { processed: 0, duplicates: 0, failed: 0, rejected: 0 };
  for (const m of await deps.queue.receive<Envelope>(queue, opts)) {
    const env = m.body;
    const log = deps.logger.child({ queue, messageId: env?.messageId, correlationId: env?.correlationId, organizationId: env?.organizationId, receiveCount: m.receiveCount });
    const h = env && typeof env.type === "string" ? handlers[env.type] : undefined;
    if (!env || !isUuid(env.organizationId) || typeof env.messageId !== "string" || !h) {
      // Message invalide : jamais traité sans organisation explicite ; laissé partir en DLQ.
      report.rejected += 1;
      log.error("message_rejected", { reason: !h ? "unknown_type" : "invalid_envelope", type: env?.type });
      continue;
    }
    try {
      const done = await runOnce(deps.pool, h.consumer, env, h.handle);
      await deps.queue.ack(queue, m.receiptHandle);
      if (done) report.processed += 1;
      else {
        report.duplicates += 1;
        log.info("duplicate_ignored", { type: env.type });
      }
    } catch (e) {
      report.failed += 1;
      log.warn("handler_failed", { type: env.type, error: e instanceof Error ? e.name : "unknown" });
    }
  }
  return report;
}
