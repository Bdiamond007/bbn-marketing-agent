import { titled } from "../../../../lib/metadata";
import { getTranslations } from "next-intl/server";
import { listMembers } from "@bbn/auth";
import { ServiceError } from "@bbn/domain";
import { TeamPanel, type Member } from "../../../../components/team";
import { ScreenState } from "../../../../components/ui";
import { currentOrganization, requireSession } from "../../../../lib/server-session";
import { apiDeps } from "../../../../server/container";

export default async function TeamPage() {
  const t = await getTranslations();
  const session = await requireSession();
  const { current } = await currentOrganization(session);
  if (!current) return <ScreenState kind="empty" title={t("onboarding.noOrg.title")} description={t("onboarding.noOrg.lead")} />;
  let members: Member[];
  try {
    members = await listMembers(apiDeps(), session, current.id);
  } catch (e) {
    if (e instanceof ServiceError) return <ScreenState kind="forbidden" title={t("common.states.forbidden")} />;
    throw e;
  }
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">{t("common.team.title")}</h1>
      <TeamPanel organizationId={current.id} members={members} myUserId={session.userId} myRole={current.role} />
    </div>
  );
}

export const generateMetadata = titled("common.team.title");
