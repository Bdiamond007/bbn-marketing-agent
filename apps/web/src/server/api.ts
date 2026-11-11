/**
 * Handlers de l'API /api/v1 (identité, organisations, équipe — E05).
 * Chaque handler : contexte de requête → (CSRF) → limite de débit → session → validation Zod → service.
 * Le contrôle d'autorisation est fait dans les services (moteur de droits), jamais par l'interface.
 */
import { z } from "zod";
import * as Auth from "@bbn/auth";
import * as Billing from "@bbn/billing";
import { isSimulatedPayments } from "@bbn/integrations/fakes";
import { ServiceError, type Clock } from "@bbn/domain";
import { assertSameOrigin, clearSessionCookie, cookieName, errorResponse, json, locale, memberRole, parseBody, readCookie, requestContext, sessionCookie, uuid, type RequestContext } from "./http";

export interface ApiDeps extends Billing.BillingDeps {
  clock: Clock;
  limiters: {
    signInIp: Auth.FixedWindowLimiter;
    signInEmail: Auth.FixedWindowLimiter;
    signUpIp: Auth.FixedWindowLimiter;
    recoveryIp: Auth.FixedWindowLimiter;
  };
}

export function createLimiters(clock: Clock): ApiDeps["limiters"] {
  return {
    signInIp: new Auth.FixedWindowLimiter(clock, 30, 60_000),
    signInEmail: new Auth.FixedWindowLimiter(clock, 5, 15 * 60_000),
    signUpIp: new Auth.FixedWindowLimiter(clock, 10, 3600_000),
    recoveryIp: new Auth.FixedWindowLimiter(clock, 10, 3600_000),
  };
}

type Params = Record<string, string>;
type Handler = (req: Request, deps: ApiDeps, ctx: RequestContext, params: Params) => Promise<Response>;

const credentials = z.object({ email: z.string().max(320), password: z.string().min(1).max(256) });

function limit(l: Auth.FixedWindowLimiter, key: string): void {
  if (!l.take(key)) throw new ServiceError("rate_limited");
}

async function requireSession(req: Request, deps: ApiDeps): Promise<Auth.SessionInfo> {
  const s = await Auth.resolveSession(deps, readCookie(req, cookieName(deps.appBaseUrl)));
  if (!s) throw new ServiceError("unauthenticated");
  return s;
}

function param(params: Params, name: string): string {
  const v = uuid.safeParse(params[name]);
  // Identifiant malformé : même réponse qu'un objet inexistant.
  if (!v.success) throw new ServiceError("not_found");
  return v.data;
}

const handlers = {
  "auth.signUp": async (req, deps, ctx) => {
    assertSameOrigin(req, deps.appBaseUrl);
    limit(deps.limiters.signUpIp, ctx.ip);
    const b = await parseBody(req, credentials.extend({ uiLocale: locale }));
    await Auth.signUp(deps, { email: b.email, password: b.password, uiLocale: b.uiLocale });
    return json({ status: "verification_required" }, 201, ctx);
  },
  "auth.verifyEmail": async (req, deps, ctx) => {
    assertSameOrigin(req, deps.appBaseUrl);
    limit(deps.limiters.signUpIp, ctx.ip);
    const b = await parseBody(req, z.object({ email: z.string().max(320), code: z.string().regex(/^\d{6}$/) }));
    await Auth.verifyEmail(deps, b);
    return json({ status: "verified" }, 200, ctx);
  },
  "auth.signIn": async (req, deps, ctx) => {
    assertSameOrigin(req, deps.appBaseUrl);
    const b = await parseBody(req, credentials);
    limit(deps.limiters.signInIp, ctx.ip);
    limit(deps.limiters.signInEmail, b.email.trim().toLowerCase());
    const { token, session } = await Auth.signIn(deps, b);
    return json(
      { user: { id: session.userId, email: session.email, emailVerified: session.emailVerified, uiLocale: session.uiLocale }, mfaRequired: session.privileged && !session.mfaVerified },
      200,
      ctx,
      { "set-cookie": sessionCookie(deps.appBaseUrl, token, session.expiresAt, deps.clock.now()) },
    );
  },
  "auth.signOut": async (req, deps, ctx) => {
    assertSameOrigin(req, deps.appBaseUrl);
    const s = await Auth.resolveSession(deps, readCookie(req, cookieName(deps.appBaseUrl)));
    if (s) await Auth.signOut(deps, s);
    return json(null, 204, ctx, { "set-cookie": clearSessionCookie(deps.appBaseUrl) });
  },
  "auth.recoveryStart": async (req, deps, ctx) => {
    assertSameOrigin(req, deps.appBaseUrl);
    limit(deps.limiters.recoveryIp, ctx.ip);
    const b = await parseBody(req, z.object({ email: z.string().max(320), uiLocale: locale }));
    await Auth.startRecovery(deps, b);
    return json({ status: "accepted" }, 202, ctx);
  },
  "auth.recoveryComplete": async (req, deps, ctx) => {
    assertSameOrigin(req, deps.appBaseUrl);
    limit(deps.limiters.recoveryIp, ctx.ip);
    const b = await parseBody(req, z.object({ email: z.string().max(320), code: z.string().regex(/^\d{6}$/), newPassword: z.string().min(1).max(256) }));
    await Auth.completeRecovery(deps, b);
    return json({ status: "password_updated" }, 200, ctx, { "set-cookie": clearSessionCookie(deps.appBaseUrl) });
  },
  "auth.reauthenticate": async (req, deps, ctx) => {
    assertSameOrigin(req, deps.appBaseUrl);
    const s = await requireSession(req, deps);
    limit(deps.limiters.signInEmail, s.email);
    const b = await parseBody(req, z.object({ password: z.string().min(1).max(256) }));
    await Auth.reauthenticate(deps, s, b.password);
    return json({ status: "reauthenticated" }, 200, ctx);
  },
  "auth.mfa": async (req, deps, ctx) => {
    assertSameOrigin(req, deps.appBaseUrl);
    const s = await requireSession(req, deps);
    limit(deps.limiters.signInEmail, `mfa:${s.userId}`);
    const b = await parseBody(req, z.object({ code: z.string().regex(/^\d{6}$/) }));
    await Auth.verifySessionMfa(deps, s, b.code);
    return json({ status: "mfa_verified" }, 200, ctx);
  },
  "me.get": async (req, deps, ctx) => {
    const s = await requireSession(req, deps);
    const organizations = s.privileged && !s.mfaVerified ? [] : await Auth.listMyOrganizations(deps, s);
    return json(
      { user: { id: s.userId, email: s.email, emailVerified: s.emailVerified, uiLocale: s.uiLocale, mfaRequired: s.privileged && !s.mfaVerified }, organizations },
      200,
      ctx,
    );
  },
  "organizations.list": async (req, deps, ctx) => {
    const s = await requireSession(req, deps);
    Auth.requireMfaIfPrivileged(s);
    return json({ data: await Auth.listMyOrganizations(deps, s) }, 200, ctx);
  },
  "organizations.create": async (req, deps, ctx) => {
    assertSameOrigin(req, deps.appBaseUrl);
    const s = await requireSession(req, deps);
    const b = await parseBody(req, z.object({ name: z.string().min(1).max(200), defaultLocale: locale }));
    const r = await Auth.createOrganization(deps, s, b, ctx);
    return json({ id: r.organizationId }, 201, ctx);
  },
  "members.list": async (req, deps, ctx, p) => {
    const s = await requireSession(req, deps);
    return json({ data: await Auth.listMembers(deps, s, param(p, "id")) }, 200, ctx);
  },
  "members.update": async (req, deps, ctx, p) => {
    assertSameOrigin(req, deps.appBaseUrl);
    const s = await requireSession(req, deps);
    const b = await parseBody(req, z.object({ role: memberRole }));
    await Auth.changeMemberRole(deps, s, param(p, "id"), param(p, "userId"), b.role, ctx);
    return json(null, 204, ctx);
  },
  "members.remove": async (req, deps, ctx, p) => {
    assertSameOrigin(req, deps.appBaseUrl);
    const s = await requireSession(req, deps);
    await Auth.removeMember(deps, s, param(p, "id"), param(p, "userId"), ctx);
    return json(null, 204, ctx);
  },
  "invitations.create": async (req, deps, ctx, p) => {
    assertSameOrigin(req, deps.appBaseUrl);
    const s = await requireSession(req, deps);
    const b = await parseBody(req, z.object({ email: z.string().max(320), role: memberRole }));
    const r = await Auth.inviteMember(deps, s, param(p, "id"), b, ctx);
    return json({ id: r.invitationId, expiresAt: r.expiresAt.toISOString() }, 201, ctx);
  },
  "invitations.revoke": async (req, deps, ctx, p) => {
    assertSameOrigin(req, deps.appBaseUrl);
    const s = await requireSession(req, deps);
    await Auth.revokeInvitation(deps, s, param(p, "id"), param(p, "invitationId"), ctx);
    return json(null, 204, ctx);
  },
  "invitations.accept": async (req, deps, ctx) => {
    assertSameOrigin(req, deps.appBaseUrl);
    const s = await requireSession(req, deps);
    const b = await parseBody(req, z.object({ token: z.string().min(32).max(128) }));
    const r = await Auth.acceptInvitation(deps, s, b.token, ctx);
    return json(r, 200, ctx);
  },
  "organizations.transfer": async (req, deps, ctx, p) => {
    assertSameOrigin(req, deps.appBaseUrl);
    const s = await requireSession(req, deps);
    const b = await parseBody(req, z.object({ newOwnerUserId: uuid }));
    await Auth.transferOwnership(deps, s, param(p, "id"), b.newOwnerUserId, ctx);
    return json(null, 204, ctx);
  },
  "billing.overview": async (req, deps, ctx, p) => {
    const s = await requireSession(req, deps);
    return json(await Billing.getBillingOverview(deps, s, param(p, "id")), 200, ctx);
  },
  "billing.checkout": async (req, deps, ctx, p) => {
    assertSameOrigin(req, deps.appBaseUrl);
    const s = await requireSession(req, deps);
    const b = await parseBody(req, z.object({ planCode: z.string().min(1).max(40) }));
    return json(await Billing.startCheckout(deps, s, param(p, "id"), b.planCode, s.uiLocale, ctx), 200, ctx);
  },
  "billing.portal": async (req, deps, ctx, p) => {
    assertSameOrigin(req, deps.appBaseUrl);
    const s = await requireSession(req, deps);
    return json(await Billing.openPortal(deps, s, param(p, "id"), s.uiLocale), 200, ctx);
  },
  "billing.cancel": async (req, deps, ctx, p) => {
    assertSameOrigin(req, deps.appBaseUrl);
    const s = await requireSession(req, deps);
    const b = await parseBody(req, z.object({ mode: z.enum(["at_period_end", "immediately"]) }));
    await Billing.cancelSubscription(deps, s, param(p, "id"), b.mode, ctx);
    return json({ status: "requested" }, 202, ctx);
  },
  "billing.changePlan": async (req, deps, ctx, p) => {
    assertSameOrigin(req, deps.appBaseUrl);
    const s = await requireSession(req, deps);
    const b = await parseBody(req, z.object({ planCode: z.string().min(1).max(40) }));
    return json(await Billing.changePlan(deps, s, param(p, "id"), b.planCode, ctx), 202, ctx);
  },
  /** Webhook fournisseur : pas de session ni de contrôle d'origine ; signature sur le corps brut. */
  "webhooks.stripe": async (req, deps, ctx) => {
    const raw = await req.text();
    if (raw.length > 512 * 1024) throw new ServiceError("validation_failed", { reason: "too_large" });
    const r = await Billing.ingestWebhook(deps, raw, req.headers.get("stripe-signature"));
    return json({ received: true, duplicate: r.duplicate }, 200, ctx);
  },
  /** Mode simulation uniquement : simule le paiement d'une session Checkout (démonstration locale). */
  "dev.simulatePayment": async (req, deps, ctx) => {
    if (!deps.simulation || !isSimulatedPayments(deps.payments)) throw new ServiceError("not_found");
    assertSameOrigin(req, deps.appBaseUrl);
    const s = await requireSession(req, deps);
    const b = await parseBody(req, z.object({ sessionId: z.string().min(1).max(100) }));
    const checkout = deps.payments.checkouts.find((c) => c.sessionId === b.sessionId);
    if (!checkout) throw new ServiceError("not_found");
    // Le simulateur ne paie que pour une organisation dont l'utilisateur gère la facturation.
    await Billing.getBillingOverview(deps, s, checkout.organizationId);
    for (const e of deps.payments.completeCheckout(b.sessionId)) await Billing.ingestWebhook(deps, e.rawBody, e.signature);
    await Billing.projectPending(deps);
    return json({ status: "simulated_payment_recorded" }, 200, ctx);
  },
} satisfies Record<string, Handler>;

export type HandlerName = keyof typeof handlers;

export async function dispatch(name: HandlerName, req: Request, deps: ApiDeps, params: Params = {}): Promise<Response> {
  const ctx = requestContext(req);
  try {
    return await handlers[name](req, deps, ctx, params);
  } catch (e) {
    return errorResponse(e, ctx);
  }
}
