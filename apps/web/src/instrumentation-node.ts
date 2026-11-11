import { ConfigError, loadConfig } from "@bbn/config";

/**
 * Validation de la configuration au démarrage du serveur (runtime Node uniquement).
 * Configuration invalide (dont mode fake en production) ⇒ arrêt du processus avec code 1.
 */
try {
  loadConfig();
} catch (e) {
  if (e instanceof ConfigError) {
    console.error(JSON.stringify({ level: "fatal", msg: "invalid_configuration", problems: e.problems }));
    process.exit(1);
  }
  throw e;
}
