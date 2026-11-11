import { getTranslations } from "next-intl/server";
import { Notice } from "../../../../../components/ui";
import { Link } from "../../../../../i18n/navigation";
import { titled } from "../../../../../lib/metadata";
import { requireSession } from "../../../../../lib/server-session";

export const generateMetadata = titled("billing.success.title");

/** Page de retour Checkout : n'accorde rien, n'affirme aucun paiement (§13). */
export default async function BillingSuccessPage() {
  await requireSession();
  const t = await getTranslations("billing.success");
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <Notice tone="info" title={t("body")} />
      <Link href="/app/billing" className="font-semibold underline">{t("back")}</Link>
    </div>
  );
}
