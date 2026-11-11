import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "../../../components/team";
import { Link } from "../../../i18n/navigation";

export const metadata = { robots: { index: false, follow: false } };

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("common");
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
        <Link href="/" className="text-lg font-bold text-ink">{t("appName")}</Link>
        <LanguageSwitcher />
      </header>
      <main id="main" className="px-4 py-8">{children}</main>
    </div>
  );
}
