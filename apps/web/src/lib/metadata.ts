import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

/** Titre de page traduit et unique (WCAG 2.4.2), complété par le modèle « · [Brand Name] » du layout. */
export function titled(key: string) {
  return async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations();
    return { title: t(key as never) };
  };
}
