import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { segmentFromLocale, type Locale } from "@bbn/i18n";
import { routing } from "../../i18n/routing";

type Props = { params: Promise<{ locale: string }> };

function baseUrl(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:3000";
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "common" });
  const languages = Object.fromEntries(routing.locales.map((l) => [l, `${baseUrl()}/${segmentFromLocale(l)}`]));
  return {
    title: t("appName"),
    description: t("home.metaDescription"),
    alternates: { canonical: `${baseUrl()}/${segmentFromLocale(locale as Locale)}`, languages },
  };
}

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "common" });
  const other = routing.locales.find((l) => l !== locale) as Locale;
  return (
    <>
      <header className="header">
        <strong>{t("appName")}</strong>
        <nav aria-label={t("languageSwitcher.label")} className="lang">
          <a href={`/${segmentFromLocale(other)}`} hrefLang={other} lang={other}>
            {t(`languageSwitcher.${segmentFromLocale(other)}`)}
          </a>
        </nav>
      </header>
      <main className="container">
        <h1>{t("home.title")}</h1>
        <p className="lead">{t("home.lead")}</p>
        <p className="status">{t("home.status")}</p>
      </main>
    </>
  );
}
