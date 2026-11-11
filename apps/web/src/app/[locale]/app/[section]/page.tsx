import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ScreenState } from "../../../../components/ui";

const SECTIONS = ["calendar", "content", "accounts", "reports", "preferences"] as const;

export async function generateMetadata({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const t = await getTranslations("common");
  return { title: (SECTIONS as readonly string[]).includes(section) ? t(`nav.${section as (typeof SECTIONS)[number]}`) : t("states.error") };
}

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!(SECTIONS as readonly string[]).includes(section)) notFound();
  const t = await getTranslations("common");
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">{t(`nav.${section as (typeof SECTIONS)[number]}`)}</h1>
      <ScreenState kind="empty" title={t("comingSoon.title")} description={t("comingSoon.description")} />
    </div>
  );
}
