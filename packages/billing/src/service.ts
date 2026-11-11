/**
 * Services de facturation exposés à l'API. Aucun droit n'est accordé ici : seuls les webhooks
 * signés (projection) et la réconciliation modifient l'abonnement local (§13 : la redirection
 * Checkout n'est jamais une preuve de paiement).
 */
import type pg from "pg";
import { asMember, requireRecentReauth, type AuthDeps, type RequestMeta, type SessionInfo } from "@bbn/auth";
import { billingAccess, ServiceError, type BillingAccess, type SubscriptionStatus } from "@bbn/domain";
import { segmentFromLocale, type Locale } from "@bbn/i18n";
import { WebhookSignatureError, type PaymentsProvider } from "@bbn/integrations";
import { priceCodeForPlan } from "./projection";

export interface BillingDeps extends AuthDeps {
  payments: PaymentsProvider;
  /** Mode simulation : le Checkout renvoie vers une page locale de paiement simulé. */
  simulation: boolean;
}

export interface BillingOverview {
  subscription: {
    status: SubscriptionStatus;
    planCode: string;
    planVersion: number;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    graceUntil: string | null;
    cancelAtPeriodEnd: boolean;
    scheduledPlanCode: string | null;
  } | null;
  access: BillingAccess;
  /** Droits du cycle courant (plan + crédits de mise à niveau), sans aucune valeur inventée. */
  entitlements: Record<string, number>;
  cycle: { startsAt: string; endsAt: string } | null;
  plans: { code: string; version: number; priceMinor: number; currency: string; entitlements: Record<string, unknown> }[];
}

interface SubRow {
  status: SubscriptionStatus;
  plan_code: string;
  plan_version: number;
  current_period_start: Date | null;
  current_period_end: Date | null;
  grace_until: Date | null;
  cancel_at_period_end: boolean;
  scheduled_plan_code: string | null;
  external_id: string | null;
  provider_customer_ref: string | null;
}

async function latestSubscription(client: pg.PoolClient, orgId: string): Promise<SubRow | null> {
  return (
    (
      await client.query<SubRow>(
        `SELECT status, plan_code, plan_version, current_period_start, current_period_end, grace_until, cancel_at_period_end,
                scheduled_plan_code, external_id, provider_customer_ref
           FROM subscriptions WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [orgId],
      )
    ).rows[0] ?? null
  );
}

/** Accès de facturation calculé côté serveur (utilisé par les lots suivants : génération, programmation, dispatch). */
export async function loadBillingAccess(client: pg.PoolClient, orgId: string, now: Date): Promise<BillingAccess> {
  const s = await latestSubscription(client, orgId);
  return billingAccess(
    s && { status: s.status, currentPeriodStart: s.current_period_start, currentPeriodEnd: s.current_period_end, graceUntil: s.grace_until, cancelAtPeriodEnd: s.cancel_at_period_end },
    now,
  );
}

export async function getBillingOverview(deps: BillingDeps, session: SessionInfo, orgId: string): Promise<BillingOverview> {
  return asMember(deps, session, orgId, "billing.read", async ({ client }) => {
    const now = deps.clock.now();
    const s = await latestSubscription(client, orgId);
    const cycle = (await client.query<{ id: string; starts_at: Date; ends_at: Date }>("SELECT id, starts_at, ends_at FROM billing_cycles WHERE organization_id = $1 AND starts_at <= $2 AND ends_at > $2", [orgId, now])).rows[0];
    const entitlements: Record<string, number> = {};
    if (cycle) {
      for (const r of (await client.query<{ key: string; total: number }>("SELECT key, sum(limit_value)::int AS total FROM entitlements WHERE cycle_id = $1 AND effective_from <= $2 AND effective_to > $2 GROUP BY key", [cycle.id, now])).rows) {
        entitlements[r.key] = r.total;
      }
    }
    const plans = (await client.query<{ code: string; version: number; price_minor: number; currency: string; entitlements_json: Record<string, unknown> }>("SELECT code, version, price_minor, currency, entitlements_json FROM plans WHERE active ORDER BY price_minor")).rows;
    return {
      subscription: s && {
        status: s.status,
        planCode: s.plan_code,
        planVersion: s.plan_version,
        currentPeriodStart: s.current_period_start?.toISOString() ?? null,
        currentPeriodEnd: s.current_period_end?.toISOString() ?? null,
        graceUntil: s.grace_until?.toISOString() ?? null,
        cancelAtPeriodEnd: s.cancel_at_period_end,
        scheduledPlanCode: s.scheduled_plan_code,
      },
      access: billingAccess(s && { status: s.status, currentPeriodStart: s.current_period_start, currentPeriodEnd: s.current_period_end, graceUntil: s.grace_until, cancelAtPeriodEnd: s.cancel_at_period_end }, now),
      entitlements,
      cycle: cycle ? { startsAt: cycle.starts_at.toISOString(), endsAt: cycle.ends_at.toISOString() } : null,
      plans: plans.map((p) => ({ code: p.code, version: p.version, priceMinor: p.price_minor, currency: p.currency, entitlements: p.entitlements_json })),
    };
  });
}

const LIVE = new Set(["incomplete", "active", "past_due", "suspended"]);

export async function startCheckout(deps: BillingDeps, session: SessionInfo, orgId: string, planCode: string, locale: Locale, meta: RequestMeta): Promise<{ url: string }> {
  const { priceCode } = await asMember(deps, session, orgId, "billing.manage", async ({ client }) => {
    const plan = (await client.query<{ version: number }>("SELECT version FROM plans WHERE code = $1 AND active ORDER BY version DESC LIMIT 1", [planCode])).rows[0];
    if (!plan) throw new ServiceError("validation_failed", { field: "planCode" });
    const s = await latestSubscription(client, orgId);
    if (s && LIVE.has(s.status)) throw new ServiceError("conflict", { reason: "subscription_exists" });
    await client.query("INSERT INTO audit_events (organization_id, actor_id, actor_kind, action, target_type, target_id, request_id) VALUES ($1, $2, 'user', 'billing.checkout_started', 'plan', $3, $4)", [orgId, session.userId, planCode, meta.requestId]);
    return { priceCode: priceCodeForPlan(planCode, plan.version) };
  });
  const seg = segmentFromLocale(locale);
  const day = deps.clock.now().toISOString().slice(0, 10);
  const r = await deps.payments.createCheckoutSession({
    organizationId: orgId,
    priceCode,
    successUrl: `${deps.appBaseUrl}/${seg}/app/billing/success`,
    cancelUrl: `${deps.appBaseUrl}/${seg}/app/billing`,
    idempotencyKey: `checkout:${orgId}:${priceCode}:${day}`,
  });
  return { url: deps.simulation ? `${deps.appBaseUrl}/${seg}/app/billing/simulated-checkout?session=${encodeURIComponent(r.sessionId)}` : r.url };
}

export async function openPortal(deps: BillingDeps, session: SessionInfo, orgId: string, locale: Locale): Promise<{ url: string }> {
  const customer = await asMember(deps, session, orgId, "billing.manage", async ({ client }) => (await latestSubscription(client, orgId))?.provider_customer_ref ?? null);
  if (!customer) throw new ServiceError("business_rule", { reason: "no_subscription" });
  return deps.payments.createPortalSession({ organizationId: orgId, customerRef: customer, returnUrl: `${deps.appBaseUrl}/${segmentFromLocale(locale)}/app/billing` });
}

/**
 * Annulation à échéance (action normale) ou suspension immédiate (action séparée, réauthentification exigée).
 * L'état local ne change qu'à la réception du webhook correspondant.
 */
export async function cancelSubscription(deps: BillingDeps, session: SessionInfo, orgId: string, mode: "at_period_end" | "immediately", meta: RequestMeta): Promise<void> {
  if (mode === "immediately") requireRecentReauth(session, deps.clock.now());
  const external = await asMember(deps, session, orgId, "billing.manage", async ({ client }) => {
    const s = await latestSubscription(client, orgId);
    if (!s?.external_id || !LIVE.has(s.status)) throw new ServiceError("business_rule", { reason: "no_live_subscription" });
    await client.query("INSERT INTO audit_events (organization_id, actor_id, actor_kind, action, target_type, target_id, safe_metadata, request_id) VALUES ($1, $2, 'user', 'billing.cancel_requested', 'subscription', $3, $4, $5)", [orgId, session.userId, s.external_id, JSON.stringify({ mode }), meta.requestId]);
    return s.external_id;
  });
  await deps.payments.cancelSubscription(external, mode);
}

/** Changement de plan : mise à niveau immédiate après paiement confirmé, rétrogradation au renouvellement. */
export async function changePlan(deps: BillingDeps, session: SessionInfo, orgId: string, planCode: string, meta: RequestMeta): Promise<{ effective: "immediate" | "at_renewal" }> {
  const { external, priceCode } = await asMember(deps, session, orgId, "billing.manage", async ({ client }) => {
    const s = await latestSubscription(client, orgId);
    if (!s?.external_id || s.status !== "active") throw new ServiceError("business_rule", { reason: "no_active_subscription" });
    const plan = (await client.query<{ version: number }>("SELECT version FROM plans WHERE code = $1 AND active ORDER BY version DESC LIMIT 1", [planCode])).rows[0];
    if (!plan || planCode === s.plan_code) throw new ServiceError("validation_failed", { field: "planCode" });
    await client.query("INSERT INTO audit_events (organization_id, actor_id, actor_kind, action, target_type, target_id, safe_metadata, request_id) VALUES ($1, $2, 'user', 'billing.plan_change_requested', 'subscription', $3, $4, $5)", [orgId, session.userId, s.external_id, JSON.stringify({ to: planCode }), meta.requestId]);
    return { external: s.external_id, priceCode: priceCodeForPlan(planCode, plan.version) };
  });
  return deps.payments.changePlan(external, priceCode);
}

/**
 * Webhook : signature vérifiée sur le corps brut, puis persistance durable AVANT acquittement.
 * Le traitement est asynchrone (projection). Doublon ⇒ acquitté sans retraitement.
 */
export async function ingestWebhook(deps: { pool: pg.Pool; payments: PaymentsProvider }, rawBody: string, signature: string | null): Promise<{ duplicate: boolean }> {
  let event;
  try {
    event = deps.payments.verifyWebhook(rawBody, signature);
  } catch (e) {
    if (e instanceof WebhookSignatureError || (e instanceof Error && e.name === "WebhookSignatureError")) throw new ServiceError("validation_failed", { reason: "invalid_signature" });
    throw e;
  }
  const r = await deps.pool.query<{ inserted: boolean }>("SELECT billing_record_webhook('stripe', $1, $2, $3) AS inserted", [event.id, event.type, JSON.stringify({ createdAt: event.createdAt, data: event.data })]);
  return { duplicate: !r.rows[0]?.inserted };
}

/** Usage du cycle courant pour l'affichage (tout membre). Aucune valeur inventée : null sans cycle. */
export async function getUsage(deps: BillingDeps, session: SessionInfo, orgId: string) {
  const { usageSummary } = await import("./quota");
  return asMember(deps, session, orgId, "report.read", ({ client }) => usageSummary(client, orgId, deps.clock.now()));
}
