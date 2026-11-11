/**
 * Validation indépendante du prompt (§12) : on ne fait pas confiance au modèle.
 * Une sortie est refusée si elle n'est pas du JSON conforme, n'est pas dans la langue demandée, cite des faits
 * non fournis, ou contient une affirmation précise (prix, pourcentage, heure, contact, lien) absente des faits utilisés,
 * une valeur d'un fait expiré, une promesse de résultat ou une expression à éviter.
 */
import { z } from "zod";
import type { Fact } from "@bbn/domain";
import { CAPTION_LIMITS, type Locale, type Provider } from "./prompts";

export const outputSchema = z.object({
  topic: z.string().max(500),
  locale: z.enum(["fr-CA", "en-CA"]),
  caption: z.string().min(1),
  callToAction: z.string().max(200),
  visualBrief: z.string().max(500),
  usedFactIds: z.array(z.string()).max(100),
  warnings: z.array(z.string().max(300)).max(20),
  requiresHumanReview: z.boolean(),
});
export type AiOutput = z.infer<typeof outputSchema>;

export type Violation =
  | "invalid_json"
  | "schema"
  | "wrong_locale"
  | "too_long"
  | "unknown_fact"
  | "unsupported_price"
  | "unsupported_percentage"
  | "unsupported_time"
  | "unsupported_contact"
  | "unsupported_link"
  | "expired_fact"
  | "guarantee_claim"
  | "avoided_expression";

export interface ValidationContext {
  locale: Locale;
  provider: Provider;
  facts: readonly Fact[];
  expiredFacts: readonly Fact[];
  avoid: readonly string[];
}

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\u00a0|\u202f/g, " ").replace(/\s+/g, " ");
const digits = (s: string) => s.replace(/[^0-9]/g, "");

const PRICE = /(\d[\d\s.,]*\s?\$|\$\s?\d[\d\s.,]*|\b\d[\d\s.,]*\s?(cad|dollars?)\b)/gi;
const PERCENT = /\d[\d\s.,]*\s?%/g;
const TIME = /\b(\d{1,2}\s?h\s?\d{0,2}|\d{1,2}:\d{2}\s?(am|pm)?|\d{1,2}\s?(am|pm))\b/gi;
const PHONE = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const LINK = /\b(https?:\/\/\S+|www\.\S+|\b[a-z0-9-]+\.(com|ca|net|org|io|co)\b\S*)/gi;
const GUARANTEE = /\b(garanti(e|es|s)?|guarantee(d|s)?|100\s?%\s?(de\s)?(r[ée]sultats?|results?)|num[ée]ro\s?1|#\s?1|meilleur(e)?s? (r[ée]sultats?|ventes?)|best results?)\b/i;

/** Un jeton précis n'est admis que s'il figure (chiffres identiques) dans la valeur d'un fait réellement utilisé. */
function supported(token: string, facts: readonly Fact[]): boolean {
  const d = digits(token);
  return facts.some((f) => (d ? digits(f.value).includes(d) : norm(f.value).includes(norm(token))));
}

export type ValidationResult = { ok: true; output: AiOutput } | { ok: false; violations: Violation[] };

export function validateOutput(raw: string, ctx: ValidationContext): ValidationResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, violations: ["invalid_json"] };
  }
  const p = outputSchema.safeParse(json);
  if (!p.success) return { ok: false, violations: ["schema"] };
  const out = p.data;
  const v = new Set<Violation>();
  if (out.locale !== ctx.locale) v.add("wrong_locale");
  if (out.caption.length > CAPTION_LIMITS[ctx.provider]) v.add("too_long");

  const byId = new Map(ctx.facts.map((f) => [f.id, f]));
  if (out.usedFactIds.some((id) => !byId.has(id))) v.add("unknown_fact");
  const used = out.usedFactIds.map((id) => byId.get(id)).filter((f): f is Fact => !!f);

  const text = `${out.caption}\n${out.callToAction}`;
  const check = (re: RegExp, violation: Violation) => {
    for (const m of text.matchAll(re)) if (!supported(m[0], used)) v.add(violation);
  };
  check(PRICE, "unsupported_price");
  check(PERCENT, "unsupported_percentage");
  check(TIME, "unsupported_time");
  check(PHONE, "unsupported_contact");
  check(EMAIL, "unsupported_contact");
  check(LINK, "unsupported_link");

  const t = norm(text);
  for (const f of ctx.expiredFacts) if (norm(f.value).length >= 4 && t.includes(norm(f.value))) v.add("expired_fact");
  if (GUARANTEE.test(text)) v.add("guarantee_claim");
  for (const a of ctx.avoid) if (a.trim().length >= 3 && t.includes(norm(a.trim()))) v.add("avoided_expression");

  return v.size === 0 ? { ok: true, output: out } : { ok: false, violations: [...v] };
}
