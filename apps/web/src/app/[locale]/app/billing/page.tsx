import { getTranslations } from "next-intl/server";
import { getBillingOverview } from "@bbn/billing";
import { ServiceError } from "@bbn/domain";
import { BillingPanel } from "../../../../components/billing";
import { ScreenState } from "../../../../components/ui";
import { titled } from "../../../../lib/metadata";
import { currentOrganization, requireSession } from "../../../../lib/server-session";
import { apiDeps } from "../../../../server/container";

export const generateMetadata = titled("billing.title");

export default async function BillingPage() {
  const t = await getTranslations();
  const session = await requireSession();
  const { current } = await currentOrganization(session);
  if (!current) return <ScreenState kind="empty" title={t("onboarding.noOrg.title")} description={t("onboarding.noOrg.lead")} />;
  try {
    const overview = await getBillingOverview(apiDeps(), session, current.id);
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold">{t("billing.title")}</h1>
          <p className="text-muted">{t("billing.lead")}</p>
        </div>
        <BillingPanel organizationId={current.id} overview={overview} canManage={current.role === "owner"} />
      </div>
    );
  } catch (e) {
    if (e instanceof ServiceError) return <ScreenState kind="forbidden" title={t("common.states.forbidden")} description={t("billing.ownerOnly")} />;
    throw e;
  }
}
