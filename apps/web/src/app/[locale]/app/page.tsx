import { titled } from "../../../lib/metadata";
import { getTranslations } from "next-intl/server";
import { getUsage, type UsageSummary } from "@bbn/billing";
import { listBrands } from "@bbn/brands";
import { listMedia } from "@bbn/media";
import { Badge } from "../../../components/ui";
import { apiDeps } from "../../../server/container";
import { Card, Notice, ScreenState } from "../../../components/ui";
import { Link } from "../../../i18n/navigation";
import { currentOrganization, requireSession } from "../../../lib/server-session";

export default async function DashboardPage() {
  const t = await getTranslations();
  const session = await requireSession();
  const { current } = await currentOrganization(session);
  const usage: UsageSummary | null = current ? await getUsage(apiDeps(), session, current.id) : null;
  const brands = current ? await listBrands(apiDeps(), session, current.id) : [];
  const media = current ? await listMedia(apiDeps(), session, current.id) : [];
  // Onboarding reprenable (§5) : chaque étape reflète l'état réel, les étapes non livrées sont signalées comme telles.
  const steps: { key: "verifyEmail" | "organization" | "subscription" | "brand" | "media" | "social" | "firstContent" | "approval" | "scheduling"; state: "done" | "todo" | "later" }[] = [
    { key: "verifyEmail", state: session.emailVerified ? "done" : "todo" },
    { key: "organization", state: current ? "done" : "todo" },
    { key: "subscription", state: usage?.cycle ? "done" : "todo" },
    { key: "brand", state: brands.some((b) => b.status === "active") ? "done" : "todo" },
    { key: "media", state: media.some((m) => m.status === "ready") ? "done" : "todo" },
    { key: "social", state: "later" },
    { key: "firstContent", state: "later" },
    { key: "approval", state: "later" },
    { key: "scheduling", state: "later" },
  ];
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">{t("common.dashboard.title")}</h1>
        <p className="text-muted">{current ? current.name : t("common.dashboard.lead")}</p>
      </div>
      {!session.emailVerified ? <Notice tone="info" title={t("common.dashboard.verifyEmailFirst")} /> : null}
      <Card title={t("onboarding.checklist.title")}>
        <ol className="flex flex-col gap-2">
          {steps.map((s) => (
            <li key={s.key} className="flex flex-wrap items-center justify-between gap-2">
              <span>{t(`onboarding.checklist.steps.${s.key}`)}</span>
              <Badge tone={s.state === "done" ? "success" : "neutral"}>{t(`onboarding.checklist.${s.state}`)}</Badge>
            </li>
          ))}
        </ol>
      </Card>
      {!current ? (
        <ScreenState
          kind="empty"
          title={t("onboarding.noOrg.title")}
          description={t("onboarding.noOrg.lead")}
          action={session.emailVerified ? <Link href="/app/organizations/new" className="inline-flex min-h-11 items-center rounded-sm bg-gold px-4 font-semibold text-ink">{t("common.shell.createOrganization")}</Link> : undefined}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title={t("common.dashboard.quotas")}>
            {usage?.contentItems && usage.publications ? (
              <ul className="flex flex-col gap-1">
                <li>{t("common.dashboard.usageContent", { used: usage.contentItems.consumed + usage.contentItems.reserved, limit: usage.contentItems.limit, remaining: usage.contentItems.remaining })}</li>
                <li>{t("common.dashboard.usagePublications", { used: usage.publications.consumed + usage.publications.reserved, limit: usage.publications.limit, remaining: usage.publications.remaining })}</li>
              </ul>
            ) : (
              <p className="text-muted">{t("common.dashboard.noCycle")}</p>
            )}
          </Card>
          {(["approvals", "upcoming", "reconnect"] as const).map((k) => (
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
