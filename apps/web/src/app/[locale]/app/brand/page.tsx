import { getTranslations } from "next-intl/server";
import { getBrand, listBrands } from "@bbn/brands";
import { ServiceError } from "@bbn/domain";
import { BrandEditor, CreateBrandForm } from "../../../../components/brand";
import { ScreenState } from "../../../../components/ui";
import { titled } from "../../../../lib/metadata";
import { currentOrganization, requireSession } from "../../../../lib/server-session";
import { apiDeps } from "../../../../server/container";

export const generateMetadata = titled("brand.title");

export default async function BrandPage() {
  const t = await getTranslations();
  const session = await requireSession();
  const { current } = await currentOrganization(session);
  if (!current) return <ScreenState kind="empty" title={t("onboarding.noOrg.title")} description={t("onboarding.noOrg.lead")} />;
  const canEdit = current.role !== "reviewer";
  try {
    const brands = await listBrands(apiDeps(), session, current.id);
    const first = brands[0];
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold">{t("brand.title")}</h1>
          <p className="text-muted">{t("brand.lead")}</p>
        </div>
        {first ? (
          <BrandEditor organizationId={current.id} brand={await getBrand(apiDeps(), session, current.id, first.id)} canEdit={canEdit} />
        ) : canEdit ? (
          <>
            <h2 className="text-lg font-semibold">{t("brand.create.title")}</h2>
            <CreateBrandForm organizationId={current.id} />
          </>
        ) : (
          <ScreenState kind="readonly" title={t("common.states.readonly")} />
        )}
      </div>
    );
  } catch (e) {
    if (e instanceof ServiceError) return <ScreenState kind="forbidden" title={t("common.states.forbidden")} />;
    throw e;
  }
}
