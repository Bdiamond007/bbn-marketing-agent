import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { segmentFromLocale, type Locale } from "@bbn/i18n";
import { LanguageSwitcher } from "../../components/team";
import { Link } from "../../i18n/navigation";
import { routing } from "../../i18n/routing";

type Props = { params: Promise<{ locale: string }> };
const baseUrl = () => process.env.APP_BASE_URL ?? "http://localhost:3000";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "common" });
  const languages = Object.fromEntries(routing.locales.map((l) => [l, `${baseUrl()}/${segmentFromLocale(l)}`]));
  return { title: t("appName"), description: t("home.metaDescription"), alternates: { canonical: `${baseUrl()}/${segmentFromLocale(locale as Locale)}`, languages } };
}

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });
  return (
    <div className="dark-surface min-h-screen bg-ink text-paper">
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
        <strong className="text-lg">{t("common.appName")}</strong>
        <LanguageSwitcher dark />
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 py-12">
        <h1 className="mb-6 max-w-3xl text-3xl font-bold leading-tight sm:text-5xl">{t("common.home.title")}</h1>
        <p className="max-w-2xl text-lg text-[#e6e6ea]">{t("common.home.lead")}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/sign-up" className="inline-flex min-h-11 items-center rounded-sm bg-gold px-5 font-semibold text-ink hover:bg-[#e2c35a]">{t("auth.links.createAccount")}</Link>
          <Link href="/sign-in" className="inline-flex min-h-11 items-center rounded-sm border border-gold px-5 font-semibold text-paper">{t("auth.signIn")}</Link>
        </div>
        <p className="mt-10 max-w-2xl rounded-md border border-gold p-4">{t("common.home.status")}</p>
      </main>
    </div>
  );
}
