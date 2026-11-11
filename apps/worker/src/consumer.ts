import type { MessageQueue, QueueName } from "@bbn/integrations";
import type { Logger } from "@bbn/observability";

export interface Envelope {
  type: string;
  organizationId: string;
  correlationId: string;
  payload: unknown;
}

export type Handler = (msg: Envelope, meta: { receiveCount: number }) => Promise<void>;

export interface BatchResult {
  acked: number;
  failed: number;
  unhandled: number;
}

/**
 * Consomme un lot. Livraison au moins une fois : chaque handler DOIT être idempotent.
 * Échec ⇒ pas d'acquittement : le message redevient visible, puis part en DLQ au-delà du seuil.
 * Un job ne porte jamais d'organisation implicite : enveloppe sans organizationId refusée.
 */
export async function processBatch(
  queue: MessageQueue,
  name: QueueName,
  handlers: Readonly<Record<string, Handler>>,
  logger: Logger,
  opts = { maxMessages: 10, visibilityTimeoutSeconds: 60 },
): Promise<BatchResult> {
  const res: BatchResult = { acked: 0, failed: 0, unhandled: 0 };
  const msgs = await queue.receive<Envelope>(name, opts);
  for (const m of msgs) {
    const env = m.body;
    const log = logger.child({ queue: name, messageId: m.id, correlationId: env?.correlationId, organizationId: env?.organizationId, receiveCount: m.receiveCount });
    const handler = env && typeof env.type === "string" ? handlers[env.type] : undefined;
    if (!env || typeof env.organizationId !== "string" || env.organizationId.length === 0 || !handler) {
      res.unhandled += 1;
      log.error("message_rejected", { reason: !handler ? "unknown_type" : "missing_organization", type: env?.type });
      continue;
    }
    try {
      await handler(env, { receiveCount: m.receiveCount });
      await queue.ack(name, m.receiptHandle);
      res.acked += 1;
    } catch (e) {
      res.failed += 1;
      log.warn("handler_failed", { type: env.type, error: e instanceof Error ? e.name : "unknown" });
    }
  }
  return res;
}
