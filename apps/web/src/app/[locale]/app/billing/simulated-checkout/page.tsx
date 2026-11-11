import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isSimulation } from "@bbn/config";
import { SimulatedCheckout } from "../../../../../components/billing";
import { titled } from "../../../../../lib/metadata";
import { requireSession } from "../../../../../lib/server-session";
import { serverConfig } from "../../../../../server-config";

export const generateMetadata = titled("billing.simulated.title");

/** Mode simulation uniquement : remplace la page de paiement du fournisseur pour la démonstration locale. */
export default async function SimulatedCheckoutPage({ searchParams }: { searchParams: Promise<{ session?: string }> }) {
  if (!isSimulation(serverConfig())) notFound();
  await requireSession();
  const { session } = await searchParams;
  const t = await getTranslations("billing.simulated");
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <SimulatedCheckout sessionId={session ?? null} />
    </div>
  );
}
