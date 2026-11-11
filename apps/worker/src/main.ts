import { loadConfig } from "@bbn/config";
import { systemClock } from "@bbn/domain";
import { createAdapters, type QueueName } from "@bbn/integrations";
import { createLogger } from "@bbn/observability";
import { projectPending, reconcileSubscriptions } from "@bbn/billing";
import { createPool } from "@bbn/db";
import { processBatch, type Handler } from "./consumer";

// Validation au démarrage : configuration invalide (dont fake en production) ⇒ arrêt immédiat.
const config = loadConfig();
const logger = createLogger({ service: "worker", env: config.APP_ENV });
const adapters = createAdapters(config, systemClock);

/** Handlers par file. Vide en E02 : les consommateurs métier arrivent avec E12/E13/E18. */
const handlers: Record<QueueName, Record<string, Handler>> = {
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

logger.info("worker_started", { adapterMode: adapters.mode, simulation: adapters.mode === "fake" });
while (!stopping) {
  if (pool) {
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
  }
  for (const q of Object.keys(handlers) as QueueName[]) {
    await processBatch(adapters.queue, q, handlers[q], logger);
  }
  await new Promise((r) => setTimeout(r, 1000));
}
await pool?.end();
logger.info("worker_stopped");
