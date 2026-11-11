import { defineRouting } from "next-intl/routing";
import { DEFAULT_LOCALE, LOCALES } from "@bbn/i18n";

/** URLs publiques /fr et /en ; locales complètes fr-CA / en-CA pour le formatage. */
export const routing = defineRouting({
  locales: [...LOCALES],
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: { mode: "always", prefixes: { "fr-CA": "/fr", "en-CA": "/en" } },
});
