import { titled } from "../../../../lib/metadata";
import { getTranslations } from "next-intl/server";
import { AcceptInvitation } from "../../../../components/auth-forms";
import { LanguageSwitcher } from "../../../../components/team";
import { Notice } from "../../../../components/ui";
import { Link } from "../../../../i18n/navigation";
import { currentSession } from "../../../../lib/server-session";


export default async function AcceptInvitationPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const t = await getTranslations();
  const session = await currentSession();
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
        <Link href="/" className="text-lg font-bold text-ink">{t("common.appName")}</Link>
        <LanguageSwitcher />
      </header>
      <main id="main" className="mx-auto flex max-w-md flex-col gap-4 px-4 py-8">
        <h1 className="text-2xl font-bold">{t("auth.invitation.title")}</h1>
        <p>{t("auth.invitation.lead")}</p>
        {session ? (
          <AcceptInvitation token={token ?? null} />
        ) : (
          <>
            <Notice tone="info" title={t("auth.invitation.signInFirst")} />
            <Link href="/sign-in" className="font-semibold underline">{t("auth.signIn")}</Link>
          </>
        )}
      </main>
    </div>
  );
}

const pageTitle = titled("auth.invitation.title");
export async function generateMetadata() {
  return { ...(await pageTitle()), robots: { index: false, follow: false } };
}
