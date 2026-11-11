import { getTranslations } from "next-intl/server";
import { listBrands } from "@bbn/brands";
import { listItems } from "@bbn/content";
import { ServiceError } from "@bbn/domain";
import { NewContentForm, StateBadge } from "../../../../components/content";
import { Card, ScreenState } from "../../../../components/ui";
import { Link } from "../../../../i18n/navigation";
import { titled } from "../../../../lib/metadata";
import { currentOrganization, requireSession } from "../../../../lib/server-session";
import { apiDeps } from "../../../../server/container";

export const generateMetadata = titled("content.title");

export default async function ContentListPage() {
  const t = await getTranslations();
  const session = await requireSession();
  const { current } = await currentOrganization(session);
  if (!current) return <ScreenState kind="empty" title={t("onboarding.noOrg.title")} description={t("onboarding.noOrg.lead")} />;
  try {
    const brand = (await listBrands(apiDeps(), session, current.id))[0];
    if (!brand) return <ScreenState kind="empty" title={t("content.title")} description={t("content.noBrand")} action={<Link href="/app/brand" className="font-semibold underline">{t("brand.title")}</Link>} />;
    const items = await listItems(apiDeps(), session, current.id, brand.id);
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold">{t("content.title")}</h1>
          <p className="text-muted">{t("content.lead")}</p>
        </div>
        {current.role !== "reviewer" ? (
          <Card title={t("content.new.title")}>
            <NewContentForm organizationId={current.id} brandId={brand.id} />
          </Card>
        ) : null}
        {items.length === 0 ? (
          <ScreenState kind="empty" title={t("content.empty")} />
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-md border border-line bg-paper">
            {items.map((i) => (
              <li key={i.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <Link href={`/app/content/${i.id}`} className="font-semibold break-words underline-offset-4 hover:underline">{i.topic}</Link>
                <div className="flex flex-wrap items-center gap-2">
                  <StateBadge state={i.summaryStatus} />
                  <span className="text-sm text-muted">{t("content.list.variants", { count: i.variants })}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  } catch (e) {
    if (e instanceof ServiceError) return <ScreenState kind="forbidden" title={t("common.states.forbidden")} />;
    throw e;
  }
}
