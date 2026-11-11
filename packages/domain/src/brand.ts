/**
 * Profil de marque (SPECIFICATION §5, BRAND-01) — validation pure, indépendante de l'interface.
 * Requis : nom, secteur, description, cible, zone, services, ton, langue, fuseau et source de faits confirmée.
 * Horaires, prix et promotions portent des dates de validité ; une promotion expirée n'est jamais utilisée.
 */
import { z } from "zod";

export const SECTORS = ["local_retail", "salon", "restaurant", "home_services", "b2b_consulting", "studio", "creative_services", "other"] as const;
export const VOICES = ["warm", "professional", "playful", "expert", "minimal"] as const;
export const FACT_KINDS = ["hours", "price", "promotion", "service", "address", "contact", "other"] as const;
/** Faits dont la validité doit être datée. */
export const DATED_FACT_KINDS = new Set<string>(["hours", "price", "promotion"]);

let ianaZones: Set<string> | null = null;
export function isIanaTimeZone(tz: string): boolean {
  ianaZones ??= new Set(Intl.supportedValuesOf("timeZone"));
  return ianaZones.has(tz) || tz === "UTC";
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const shortText = (max: number) => z.string().trim().max(max);

export const factSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,40}$/),
    kind: z.enum(FACT_KINDS),
    value: shortText(500).min(1),
    validFrom: isoDate.nullable().optional(),
    validUntil: isoDate.nullable().optional(),
    confirmed: z.boolean(),
  })
  .refine((f) => !f.validFrom || !f.validUntil || f.validFrom <= f.validUntil, { message: "valid_range", path: ["validUntil"] });
export type Fact = z.infer<typeof factSchema>;

/** Brouillon : tout est facultatif (reprise à n'importe quelle étape), mais typé et borné. */
export const brandDraftSchema = z.object({
  name: shortText(200).optional(),
  sector: z.enum(SECTORS).optional(),
  description: shortText(1000).optional(),
  audience: shortText(500).optional(),
  area: shortText(300).optional(),
  services: z.array(shortText(200).min(1)).max(30).optional(),
  tone: z.object({ voice: z.enum(VOICES).optional(), avoid: z.array(shortText(100).min(1)).max(20).optional() }).optional(),
  defaultContentLocale: z.enum(["fr-CA", "en-CA"]).optional(),
  timezone: z.string().max(64).refine(isIanaTimeZone, { message: "invalid_timezone" }).optional(),
  facts: z.array(factSchema).max(100).optional(),
  factsSourceConfirmed: z.boolean().optional(),
});
export type BrandDraft = z.infer<typeof brandDraftSchema>;

export const REQUIRED_FIELDS = ["name", "sector", "description", "audience", "area", "services", "tone", "defaultContentLocale", "timezone", "factsSourceConfirmed"] as const;
export type RequiredField = (typeof REQUIRED_FIELDS)[number];

export interface FactProblem {
  factId: string;
  problem: "missing_validity" | "unconfirmed";
}

/** Champs requis manquants pour publier le profil (et donc pour générer). */
export function missingRequiredFields(d: BrandDraft): RequiredField[] {
  const missing: RequiredField[] = [];
  if (!d.name) missing.push("name");
  if (!d.sector) missing.push("sector");
  if (!d.description) missing.push("description");
  if (!d.audience) missing.push("audience");
  if (!d.area) missing.push("area");
  if (!d.services?.length) missing.push("services");
  if (!d.tone?.voice) missing.push("tone");
  if (!d.defaultContentLocale) missing.push("defaultContentLocale");
  if (!d.timezone) missing.push("timezone");
  if (d.factsSourceConfirmed !== true) missing.push("factsSourceConfirmed");
  return missing;
}

/** Faits datables sans date de validité : refusés à la publication. */
export function factProblems(facts: readonly Fact[]): FactProblem[] {
  return facts.filter((f) => DATED_FACT_KINDS.has(f.kind) && (f.kind === "promotion" ? !f.validUntil : !f.validFrom)).map((f) => ({ factId: f.id, problem: "missing_validity" as const }));
}

/** Date civile du jour dans le fuseau de la marque (les validités sont des dates locales). */
export function localDate(now: Date, timeZone: string): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Faits utilisables à une date : confirmés et dans leur période de validité (bornes incluses).
 * Une promotion expirée ou future est exclue (jamais transmise à l'IA).
 */
export function usableFacts(facts: readonly Fact[], now: Date, timeZone: string): { usable: Fact[]; expired: Fact[]; notYetValid: Fact[]; unconfirmed: Fact[] } {
  const today = localDate(now, timeZone);
  const out = { usable: [] as Fact[], expired: [] as Fact[], notYetValid: [] as Fact[], unconfirmed: [] as Fact[] };
  for (const f of facts) {
    if (!f.confirmed) out.unconfirmed.push(f);
    else if (f.validUntil && f.validUntil < today) out.expired.push(f);
    else if (f.validFrom && f.validFrom > today) out.notYetValid.push(f);
    else out.usable.push(f);
  }
  return out;
}
