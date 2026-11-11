import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { isSimulation } from "@bbn/config";
import { routing } from "../../i18n/routing";
import { serverConfig } from "../../server-config";
import "@fontsource-variable/inter";
import "../globals.css";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "common" });
  return { title: { default: t("appName"), template: `%s · ${t("appName")}` } };
}

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "common" });
  const simulation = isSimulation(serverConfig());
  return (
    <html lang={locale}>
      <body className="min-h-screen bg-canvas text-text antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-sm focus:bg-paper focus:p-3 focus:text-ink">
          {t("skipToContent")}
        </a>
        {simulation ? (
          <div role="status" className="border-b border-line bg-gold-soft px-4 py-3 font-semibold text-ink" data-testid="simulation-banner">
            {t("simulationBanner")}
          </div>
        ) : null}
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
