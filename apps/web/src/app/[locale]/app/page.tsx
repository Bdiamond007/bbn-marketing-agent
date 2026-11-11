import { titled } from "../../../lib/metadata";
import { getTranslations } from "next-intl/server";
import { Card, Notice, ScreenState } from "../../../components/ui";
import { Link } from "../../../i18n/navigation";
import { currentOrganization, requireSession } from "../../../lib/server-session";

export default async function DashboardPage() {
  const t = await getTranslations();
  const session = await requireSession();
  const { current } = await currentOrganization(session);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">{t("common.dashboard.title")}</h1>
        <p className="text-muted">{current ? current.name : t("common.dashboard.lead")}</p>
      </div>
      {!session.emailVerified ? <Notice tone="info" title={t("common.dashboard.verifyEmailFirst")} /> : null}
      {!current ? (
        <ScreenState
          kind="empty"
          title={t("onboarding.noOrg.title")}
          description={t("onboarding.noOrg.lead")}
          action={session.emailVerified ? <Link href="/app/organizations/new" className="inline-flex min-h-11 items-center rounded-sm bg-gold px-4 font-semibold text-ink">{t("common.shell.createOrganization")}</Link> : undefined}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(["quotas", "approvals", "upcoming", "reconnect"] as const).map((k) => (
            <Card key={k} title={t(`common.dashboard.${k}`)}>
              {/* Aucun compteur inventé : affiché seulement lorsque les données réelles existent (E07+). */}
              <p className="text-muted">{t("common.dashboard.notConfigured")}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export const generateMetadata = titled("common.dashboard.title");
