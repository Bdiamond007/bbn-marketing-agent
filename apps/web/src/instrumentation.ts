/**
 * Validation de la configuration au démarrage du serveur.
 * Configuration invalide (dont mode fake en production) ⇒ arrêt du processus avec code 1,
 * pour qu'aucune requête ne soit servie et que l'orchestrateur voie l'échec immédiatement.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { loadConfig, ConfigError } = await import("@bbn/config");
  try {
    loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(JSON.stringify({ level: "fatal", msg: "invalid_configuration", problems: e.problems }));
      process.exit(1);
    }
    throw e;
  }
}
