import { catalogs } from "@bbn/i18n/messages";
import type { Locale } from "@bbn/i18n";

type EmailKey = "verifyEmail" | "recovery" | "invitation";

/** Rendu d'un courriel transactionnel dans la langue du destinataire ; clé absente = erreur explicite. */
export function renderEmail(locale: Locale, key: EmailKey, vars: Record<string, string>): { subject: string; text: string } {
  const emails = (catalogs[locale].notifications as { emails?: Record<string, { subject?: string; body?: string }> }).emails;
  const tpl = emails?.[key];
  if (!tpl?.subject || !tpl.body) throw new Error(`missing_translation: notifications.emails.${key} (${locale})`);
  const fill = (s: string) =>
    s.replace(/\{(\w+)\}/g, (_m, name: string) => {
      const v = vars[name];
      if (v === undefined) throw new Error(`missing_email_variable: ${name}`);
      return v;
    });
  return { subject: fill(tpl.subject), text: fill(tpl.body) };
}
