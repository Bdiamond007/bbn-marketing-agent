import { titled } from "../../../../../lib/metadata";
import { getTranslations } from "next-intl/server";
import { CreateOrganizationForm } from "../../../../../components/team";
import { Notice } from "../../../../../components/ui";
import { requireSession } from "../../../../../lib/server-session";

export default async function NewOrganizationPage() {
  const t = await getTranslations();
  const session = await requireSession();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{t("onboarding.createOrg.title")}</h1>
      {session.emailVerified ? <CreateOrganizationForm /> : <Notice tone="info" title={t("common.dashboard.verifyEmailFirst")} />}
    </div>
  );
}

export const generateMetadata = titled("onboarding.createOrg.title");
