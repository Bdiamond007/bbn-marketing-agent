/**
 * Dépendances du serveur web, créées une seule fois par processus.
 * Le simulateur d'identité est conservé sur globalThis pour survivre au rechargement à chaud en développement.
 */
import { appendFileSync } from "node:fs";
import { createIdentityProvider } from "@bbn/auth";
import { loadConfig } from "@bbn/config";
import { createPool } from "@bbn/db";
import { systemClock } from "@bbn/domain";
import { createAdapters, type EmailSender } from "@bbn/integrations";
import { createLimiters, type ApiDeps } from "./api";

const g = globalThis as unknown as { __bbnApiDeps?: ApiDeps };

export function apiDeps(): ApiDeps {
  if (g.__bbnApiDeps) return g.__bbnApiDeps;
  const cfg = loadConfig();
  if (!cfg.DATABASE_URL) throw new Error("DATABASE_URL requis pour l'API /api/v1");
  const adapters = createAdapters(cfg, systemClock);
  g.__bbnApiDeps = {
    pool: createPool(cfg.DATABASE_URL, 10),
    idp: createIdentityProvider(cfg, systemClock),
    email: adapters.mode === "fake" ? withSimulatedMailLog(adapters.email) : adapters.email,
    clock: systemClock,
    appBaseUrl: cfg.APP_BASE_URL.replace(/\/$/, ""),
    limiters: createLimiters(systemClock),
  };
  return g.__bbnApiDeps;
}

/**
 * Mode simulation uniquement (interdit en staging/production par @bbn/config) : les courriels simulés
 * sont journalisés pour que le développeur local puisse lire codes et liens d'invitation.
 */
function withSimulatedMailLog(inner: EmailSender): EmailSender {
  return {
    async send(m) {
      const r = await inner.send(m);
      if (!r.deduplicated) {
        const line = JSON.stringify({ level: "info", msg: "simulated_email", simulation: true, to: m.to, locale: m.locale, template: m.templateKey, subject: m.subject, text: m.text });
        console.info(line);
        // Boîte simulée sur fichier, lue par les tests E2E (mode fake uniquement).
        if (process.env.SIMULATED_MAILBOX_FILE) appendFileSync(process.env.SIMULATED_MAILBOX_FILE, line + "\n");
      }
      return r;
    },
  };
}
