import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getItem, listComments, listRevisions, type RevisionView } from "@bbn/content";
import { isUuid } from "@bbn/db";
import { ServiceError } from "@bbn/domain";
import { listMedia, mediaViewUrl } from "@bbn/media";
import { ContentEditor, type ReadyMedia } from "../../../../../components/content";
import { ScreenState } from "../../../../../components/ui";
import { titled } from "../../../../../lib/metadata";
import { currentOrganization, requireSession } from "../../../../../lib/server-session";
import { apiDeps } from "../../../../../server/container";

export const generateMetadata = titled("content.title");

export default async function ContentItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  if (!isUuid(itemId)) notFound();
  const t = await getTranslations();
  const session = await requireSession();
  const { current } = await currentOrganization(session);
  if (!current) return <ScreenState kind="empty" title={t("onboarding.noOrg.title")} />;
  const deps = apiDeps();
  try {
    const item = await getItem(deps, session, current.id, itemId);
    const histories: Record<string, RevisionView[]> = {};
    for (const v of item.variants) histories[v.id] = await listRevisions(deps, session, current.id, v.id);
    const media: ReadyMedia[] = [];
    for (const m of (await listMedia(deps, session, current.id)).filter((x) => x.status === "ready")) media.push({ id: m.id, url: (await mediaViewUrl(deps, session, current.id, m.id)).url });
    const comments = await listComments(deps, session, current.id, itemId);
    return <ContentEditor organizationId={current.id} item={item} media={media} histories={histories} comments={comments} canEdit={current.role !== "reviewer"} canComment />;
  } catch (e) {
    if (e instanceof ServiceError && e.code === "not_found") notFound();
    if (e instanceof ServiceError) return <ScreenState kind="forbidden" title={t("common.states.forbidden")} />;
    throw e;
  }
}
