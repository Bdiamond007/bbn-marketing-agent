import { cookies } from "next/headers";
import { getLocale } from "next-intl/server";
import { redirect } from "../i18n/navigation";
import { listMyOrganizations, resolveSession, type SessionInfo } from "@bbn/auth";
import { apiDeps } from "../server/container";
import { cookieName } from "../server/http";

export async function currentSession(): Promise<SessionInfo | null> {
  const deps = apiDeps();
  const jar = await cookies();
  return resolveSession(deps, jar.get(cookieName(deps.appBaseUrl))?.value);
}

export type OrgSummary = { id: string; name: string; role: "owner" | "admin" | "editor" | "reviewer" };

/** Organisation courante : préférence du cookie si l'utilisateur en est membre, sinon la première. */
export async function currentOrganization(session: SessionInfo): Promise<{ current: OrgSummary | null; all: OrgSummary[] }> {
  const all = await listMyOrganizations(apiDeps(), session);
  const pref = (await cookies()).get("bbn_org")?.value;
  return { current: all.find((o) => o.id === pref) ?? all[0] ?? null, all };
}

/**
 * Session obligatoire pour une page de l'application. Les pages sont rendues en parallèle du layout :
 * chacune doit donc vérifier elle-même et rediriger, sans dépendre de la redirection du layout.
 */
export async function requireSession(): Promise<SessionInfo> {
  const session = await currentSession();
  const locale = await getLocale();
  if (!session) return redirect({ href: "/sign-in", locale });
  if (session.privileged && !session.mfaVerified) return redirect({ href: "/mfa", locale });
  return session;
}
