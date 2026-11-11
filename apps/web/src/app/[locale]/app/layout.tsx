import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { SignOutButton } from "../../../components/auth-forms";
import { LanguageSwitcher, OrganizationSwitcher } from "../../../components/team";
import { Link } from "../../../i18n/navigation";
import { currentOrganization, requireSession } from "../../../lib/server-session";

/** Tableau de bord : jamais indexé (§7). */
export const metadata = { robots: { index: false, follow: false } };

const NAV_SECTIONS = ["calendar", "content", "brand", "media", "accounts", "reports", "team", "billing", "preferences"] as const;

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const t = await getTranslations("common");
  const { current, all } = await currentOrganization(session);
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href="/app" className="text-lg font-bold text-ink">{t("appName")}</Link>
          <div className="flex flex-wrap items-center gap-3">
            <span className="hidden text-sm text-muted md:inline">{t("shell.signedInAs", { email: session.email })}</span>
            <OrganizationSwitcher organizations={all} currentId={current?.id ?? null} />
            <LanguageSwitcher />
            <SignOutButton />
          </div>
        </div>
        <nav aria-label={t("shell.mainNav")} className="mx-auto max-w-6xl px-4 pb-2">
          <ul className="flex flex-wrap gap-1">
            <li><Link href="/app" className="inline-flex min-h-11 items-center rounded-sm px-3 font-semibold text-ink hover:bg-canvas">{t("nav.home")}</Link></li>
            {NAV_SECTIONS.map((s) => (
              <li key={s}>
                <Link href={`/app/${s}`} className="inline-flex min-h-11 items-center rounded-sm px-3 text-ink hover:bg-canvas">
                  {t(`nav.${s}`)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
