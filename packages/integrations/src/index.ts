import type { AppConfig } from "@bbn/config";
import { systemClock, type Clock } from "@bbn/domain";
import type { AiTextProvider } from "./ai";
import type { EmailSender } from "./email";
import { FakeAiTextProvider, FakeEmailSender, FakeMessageQueue, FakeObjectStorage, FakePaymentsProvider, FakeSocialPublisher } from "./fakes";
import type { PaymentsProvider } from "./payments";
import type { MessageQueue } from "./queue";
import type { SocialProvider, SocialPublisher } from "./social";
import type { ObjectStorage } from "./storage";
import type { MalwareScanner } from "./scanner";
import { FakeMalwareScanner } from "./fakes/scanner";

export * from "./scenario";
export * from "./storage";
export * from "./queue";
export * from "./email";
export * from "./payments";
export * from "./ai";
export * from "./social";
export * from "./scanner";

export interface Adapters {
  mode: "fake" | "live";
  storage: ObjectStorage;
  scanner: MalwareScanner;
  queue: MessageQueue;
  email: EmailSender;
  payments: PaymentsProvider;
  ai: AiTextProvider;
  /** Seuls les réseaux activés sont présents. */
  social: Partial<Record<SocialProvider, SocialPublisher>>;
}

/** Catalogue des prix autorisés côté serveur : code de prix → montant en cents CAD (ADR-0002, provisoire). */
export const PRICE_CATALOG = {
  essentiel_monthly_cad_v1: 9900,
  croissance_monthly_cad_v1: 17900,
  accompagne_monthly_cad_v1: 39900,
} as const satisfies Record<string, number>;
export const ALLOWED_PRICE_CODES = Object.keys(PRICE_CATALOG) as (keyof typeof PRICE_CATALOG)[];

export class LiveAdapterNotImplementedError extends Error {
  constructor(what: string, lot: string) {
    super(`Adaptateur live non implémenté : ${what} (lot ${lot}). Utiliser ADAPTER_MODE=fake en local.`);
    this.name = "LiveAdapterNotImplementedError";
  }
}

export function createAdapters(cfg: Pick<AppConfig, "ADAPTER_MODE" | "APP_ENV">, clock: Clock = systemClock): Adapters {
  if (cfg.ADAPTER_MODE === "fake") {
    if (cfg.APP_ENV === "production" || cfg.APP_ENV === "staging") {
      // Double garde : loadConfig refuse déjà ce cas.
      throw new Error("Adaptateurs fake interdits hors développement/test");
    }
    return {
      mode: "fake",
      storage: new FakeObjectStorage(clock),
      scanner: new FakeMalwareScanner(),
      queue: new FakeMessageQueue(clock),
      email: new FakeEmailSender(),
      payments: new FakePaymentsProvider(clock, PRICE_CATALOG),
      ai: new FakeAiTextProvider(clock),
      social: {
        facebook_page: new FakeSocialPublisher("facebook_page"),
        instagram_business: new FakeSocialPublisher("instagram_business"),
        linkedin_page: new FakeSocialPublisher("linkedin_page"),
      },
    };
  }
  // Aucun adaptateur live n'est encore implémenté : échec explicite plutôt que succès inventé.
  throw new LiveAdapterNotImplementedError("S3/SQS/SES/Stripe/IA/réseaux", "E07, E10, E12, E13, E17");
}
