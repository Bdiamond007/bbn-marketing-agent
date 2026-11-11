import { loadConfig } from "@bbn/config";
import { systemClock } from "@bbn/domain";
import { createAdapters, type QueueName } from "@bbn/integrations";
import { createLogger } from "@bbn/observability";
import { projectPending, reconcileSubscriptions } from "@bbn/billing";
import { createPool } from "@bbn/db";
import { cleanupOrphanUploads } from "@bbn/media";
import { randomUUID } from "node:crypto";
import { consumeBatch, relayOutbox, outboxStats, type Handler } from "@bbn/jobs";

// Validation au démarrage : configuration invalide (dont fake en production) ⇒ arrêt immédiat.
const config = loadConfig();
const logger = createLogger({ service: "worker", env: config.APP_ENV });
const adapters = createAdapters(config, systemClock);

/** Consommateurs idempotents par file (type d'événement → consommateur). Les handlers métier arrivent avec E13/E15/E18. */
const handlers: Record<QueueName, Record<string, { consumer: string; handle: Handler }>> = {
  generation: {},
  publishing: {},
  notifications: {},
  projections: {},
};

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stopping = true;
    logger.info("worker_stopping", { signal: sig });
  });
}

const pool = config.DATABASE_URL ? createPool(config.DATABASE_URL, 5) : null;
if (!pool) logger.warn("database_not_configured", { effect: "projection de facturation désactivée" });
const RECONCILE_EVERY_MS = 15 * 60 * 1000;
let lastReconcile = 0;
let lastMediaCleanup = 0;
let lastStats = 0;
const WORKER_ID = `worker-${randomUUID().slice(0, 8)}`;

logger.info("worker_started", { adapterMode: adapters.mode, simulation: adapters.mode === "fake" });
while (!stopping) {
  if (pool) {
    // Relais d'outbox : événements validés → files (bail expirant, au moins une fois).
    const relay = await relayOutbox({ pool, queue: adapters.queue, clock: systemClock, logger }, { workerId: WORKER_ID }).catch((e: unknown) => {
      logger.error("outbox_relay_failed", { error: e instanceof Error ? e.name : "unknown" });
      return null;
    });
    if (relay && relay.claimed > 0) logger.info("outbox_relay", { ...relay });
    if (Date.now() - lastStats >= 60_000) {
      lastStats = Date.now();
      await outboxStats(pool, systemClock.now()).then((st) => logger.info("outbox_stats", st), () => undefined);
    }
    // Projection des webhooks de paiement persistés (idempotente, au moins une fois).
    const r = await projectPending({ pool, payments: adapters.payments, clock: systemClock }).catch((e: unknown) => {
      logger.error("billing_projection_failed", { error: e instanceof Error ? e.name : "unknown" });
      return null;
    });
    if (r && r.processed + r.ignored + r.failed > 0) logger.info("billing_projection", { ...r });
    if (Date.now() - lastReconcile >= RECONCILE_EVERY_MS) {
      lastReconcile = Date.now();
      await reconcileSubscriptions({ pool, payments: adapters.payments, clock: systemClock }).then(
        (x) => logger.info("billing_reconciliation", x),
        (e: unknown) => logger.error("billing_reconciliation_failed", { error: e instanceof Error ? e.name : "unknown" }),
      );
    }
    if (Date.now() - lastMediaCleanup >= 60 * 60 * 1000) {
      lastMediaCleanup = Date.now();
      await cleanupOrphanUploads({ pool, storage: adapters.storage, clock: systemClock }).then(
        (n) => logger.info("media_orphan_cleanup", { cleaned: n }),
        (e: unknown) => logger.error("media_orphan_cleanup_failed", { error: e instanceof Error ? e.name : "unknown" }),
      );
    }
  }
  if (pool) {
    for (const q of Object.keys(handlers) as QueueName[]) {
      await consumeBatch({ pool, queue: adapters.queue, logger }, q, handlers[q]).catch((e: unknown) => logger.error("consume_failed", { queue: q, error: e instanceof Error ? e.name : "unknown" }));
    }
  }
  await new Promise((r) => setTimeout(r, 1000));
}
await pool?.end();
logger.info("worker_stopped");
