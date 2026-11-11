export const LOCALES = ["fr-CA", "en-CA"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "fr-CA";

/** Segments d'URL publics (/fr, /en) ↔ locales complètes. */
export const URL_SEGMENTS = { fr: "fr-CA", en: "en-CA" } as const satisfies Record<string, Locale>;
export type UrlSegment = keyof typeof URL_SEGMENTS;

export function localeFromSegment(seg: string): Locale | null {
  return seg in URL_SEGMENTS ? URL_SEGMENTS[seg as UrlSegment] : null;
}
export function segmentFromLocale(locale: Locale): UrlSegment {
  return locale === "fr-CA" ? "fr" : "en";
}

export const NAMESPACES = [
  "common",
  "auth",
  "onboarding",
  "brand",
  "content",
  "calendar",
  "integrations",
  "billing",
  "notifications",
  "errors",
  "admin",
] as const;
export type Namespace = (typeof NAMESPACES)[number];

export { checkCatalogs, type CatalogIssue } from "./check";
