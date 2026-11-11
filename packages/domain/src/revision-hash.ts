import { createHash } from "node:crypto";

/**
 * Empreinte de contenu d'une révision (SPECIFICATION §5) : texte, langue, réseau et médias.
 * La destination exacte (connexion) est liée par l'approbation, qui stocke cette empreinte.
 * Sérialisation canonique (clés triées, NFC) : deux contenus identiques ⇒ même empreinte.
 * Version incluse pour permettre une évolution future sans collision (ADR à venir, E15).
 */
export interface RevisionContent {
  caption: string;
  locale: "fr-CA" | "en-CA";
  provider: "facebook_page" | "instagram_business" | "linkedin_page";
  media: readonly { mediaAssetId: string; sha256: string }[];
}

export const REVISION_HASH_VERSION = 1;

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(typeof value === "string" ? value.normalize("NFC") : value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

export function computeRevisionHash(content: RevisionContent): string {
  const payload = {
    v: REVISION_HASH_VERSION,
    caption: content.caption,
    locale: content.locale,
    provider: content.provider,
    media: content.media.map((m) => ({ mediaAssetId: m.mediaAssetId, sha256: m.sha256 })),
  };
  return createHash("sha256").update(canonical(payload)).digest("hex");
}
