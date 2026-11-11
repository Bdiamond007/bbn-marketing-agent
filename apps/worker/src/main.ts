import { loadConfig } from "@bbn/config";
import { systemClock } from "@bbn/domain";
import { createAdapters, type QueueName } from "@bbn/integrations";
import { createLogger } from "@bbn/observability";
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

logger.info("worker_started", { adapterMode: adapters.mode, simulation: adapters.mode === "fake" });
while (!stopping) {
  for (const q of Object.keys(handlers) as QueueName[]) {
    await processBatch(adapters.queue, q, handlers[q], logger);
  }
  await new Promise((r) => setTimeout(r, 1000));
}
logger.info("worker_stopped");
