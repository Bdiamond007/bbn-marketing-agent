import { hasLocale, IntlErrorCode } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { catalogs } from "@bbn/i18n/messages";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return {
    locale,
    messages: catalogs[locale],
    timeZone: "America/Toronto",
    // Traduction absente : signalée et rendue de façon déterministe, jamais remplacée par l'autre langue.
    onError(error) {
      if (error.code === IntlErrorCode.MISSING_MESSAGE) console.error(JSON.stringify({ level: "error", msg: "missing_translation", locale, detail: error.message }));
      else console.error(JSON.stringify({ level: "error", msg: "i18n_error", locale, code: error.code }));
    },
    getMessageFallback({ namespace, key }) {
      return `⟦${[namespace, key].filter(Boolean).join(".")}⟧`;
    },
  };
});
