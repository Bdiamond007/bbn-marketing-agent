import type { AppConfig } from "@bbn/config";
import type { Clock } from "@bbn/domain";
import { FakeIdentityProvider } from "./fake-identity";
import type { IdentityProvider } from "./identity";

export class CognitoNotImplementedError extends Error {
  constructor() {
    super("Adaptateur Cognito non implémenté : nécessite un compte AWS autorisé (E05 → BLOCKED_EXTERNAL pour la partie live). Utiliser AUTH_MODE=fake en local.");
    this.name = "CognitoNotImplementedError";
  }
}

export function createIdentityProvider(cfg: Pick<AppConfig, "AUTH_MODE" | "APP_ENV">, clock: Clock): IdentityProvider {
  if (cfg.AUTH_MODE === "fake") {
    if (cfg.APP_ENV === "production" || cfg.APP_ENV === "staging") throw new Error("AUTH_MODE=fake interdit hors développement/test");
    return new FakeIdentityProvider(clock);
  }
  throw new CognitoNotImplementedError();
}
