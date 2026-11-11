import { getTranslations } from "next-intl/server";
import { listBrands } from "@bbn/brands";
import { ServiceError } from "@bbn/domain";
import { listMedia, mediaViewUrl } from "@bbn/media";
import { MediaManager } from "../../../../components/media";
import { ScreenState } from "../../../../components/ui";
import { titled } from "../../../../lib/metadata";
import { currentOrganization, requireSession } from "../../../../lib/server-session";
import { apiDeps } from "../../../../server/container";

export const generateMetadata = titled("brand.media.title");

export default async function MediaPage() {
  const t = await getTranslations();
  const session = await requireSession();
  const { current } = await currentOrganization(session);
  if (!current) return <ScreenState kind="empty" title={t("onboarding.noOrg.title")} description={t("onboarding.noOrg.lead")} />;
  try {
    const deps = apiDeps();
    const items = await listMedia(deps, session, current.id);
    const urls: Record<string, string> = {};
    for (const m of items.filter((x) => x.status === "ready")) urls[m.id] = (await mediaViewUrl(deps, session, current.id, m.id)).url;
    const brand = (await listBrands(deps, session, current.id))[0] ?? null;
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold">{t("brand.media.title")}</h1>
          <p className="text-muted">{t("brand.media.lead")}</p>
        </div>
        <MediaManager organizationId={current.id} brandId={brand?.id ?? null} items={items} urls={urls} canUpload={current.role !== "reviewer"} />
      </div>
    );
  } catch (e) {
    if (e instanceof ServiceError) return <ScreenState kind="forbidden" title={t("common.states.forbidden")} />;
    throw e;
  }
}
