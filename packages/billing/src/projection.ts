/**
 * Projection des événements de paiement vers l'état local (abonnement, cycles, droits).
 * Idempotente : rejouer un événement, ou le recevoir en double, ne change rien.
 * Robuste au désordre : un instantané plus ancien que le dernier appliqué n'écrase pas l'état.
 */
import type pg from "pg";
import { z } from "zod";
import { countedEntitlements, graceUntilFor, upgradeDelta, type Clock } from "@bbn/domain";
import { isUuid, withTenant } from "@bbn/db";
import type { PaymentsProvider, ProviderSubscription } from "@bbn/integrations";

export interface ProjectionDeps {
  pool: pg.Pool;
  payments: PaymentsProvider;
  clock: Clock;
}

const iso = z.string().datetime({ offset: true });
const subscriptionSchema = z.object({
  id: z.string().min(1),
  customerRef: z.string().min(1),
  organizationId: z.string().refine(isUuid),
  status: z.enum(["incomplete", "active", "past_due", "canceled"]),
  priceCode: z.string().min(1),
  currentPeriodStart: iso,
  currentPeriodEnd: iso,
  cancelAtPeriodEnd: z.boolean(),
  scheduledPriceCode: z.string().nullable(),
});
const invoiceSchema = z.object({
  id: z.string(),
  subscriptionId: z.string(),
  status: z.enum(["paid", "open"]),
  dueAt: iso,
  amountMinor: z.number().int().nonnegative(),
  periodStart: iso,
  periodEnd: iso,
  reason: z.enum(["subscription_create", "subscription_cycle", "subscription_update"]),
});
const eventSchema = z.object({
  type: z.string(),
  createdAt: z.number(),
  data: z.object({ subscription: subscriptionSchema, invoice: invoiceSchema.optional() }),
});

export class ProjectionIgnored extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ProjectionIgnored";
  }
}

/** Code de prix ↔ plan versionné (ex. « essentiel_monthly_cad_v1 » ↔ essentiel v1). */
export function planFromPriceCode(priceCode: string): { code: string; version: number } {
  const m = /^([a-z]+)_monthly_cad_v(\d+)$/.exec(priceCode);
  if (!m) throw new ProjectionIgnored("unknown_price_code");
  return { code: m[1]!, version: Number(m[2]) };
}
export const priceCodeForPlan = (code: string, version = 1) => `${code}_monthly_cad_v${version}`;

async function planEntitlements(client: pg.PoolClient, code: string, version: number): Promise<Record<string, number>> {
  const r = await client.query<{ entitlements_json: Record<string, unknown> }>("SELECT entitlements_json FROM plans WHERE code = $1 AND version = $2", [code, version]);
  if (!r.rows[0]) throw new ProjectionIgnored("unknown_plan");
  return countedEntitlements(r.rows[0].entitlements_json);
}

interface LocalSub {
  id: string;
  provider_updated_at: Date | null;
  status: string;
  grace_due_at: Date | null;
  grace_until: Date | null;
  plan_code: string;
  plan_version: number;
}

/** Applique un instantané d'abonnement si et seulement s'il n'est pas plus ancien que l'état local. */
async function applySnapshot(client: pg.PoolClient, s: ProviderSubscription, at: Date): Promise<LocalSub> {
  const plan = planFromPriceCode(s.priceCode);
  const scheduled = s.scheduledPriceCode ? planFromPriceCode(s.scheduledPriceCode) : null;
  const existing = (await client.query<LocalSub>("SELECT id, provider_updated_at, status, grace_due_at, grace_until, plan_code, plan_version FROM subscriptions WHERE external_id = $1 FOR UPDATE", [s.id])).rows[0];
  if (existing && existing.provider_updated_at && existing.provider_updated_at.getTime() > at.getTime()) return existing; // désordre : instantané périmé
  const status = s.status; // incomplete | active | past_due | canceled
  const values = [s.organizationId, s.id, plan.code, plan.version, status, s.currentPeriodStart, s.currentPeriodEnd, s.cancelAtPeriodEnd, s.customerRef, at, scheduled?.code ?? null, scheduled?.version ?? null];
  if (!existing) {
    const r = await client.query<LocalSub>(
      `INSERT INTO subscriptions (organization_id, external_id, plan_code, plan_version, status, current_period_start, current_period_end,
         cancel_at_period_end, provider_customer_ref, provider_updated_at, scheduled_plan_code, scheduled_plan_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, provider_updated_at, status, grace_due_at, grace_until, plan_code, plan_version`,
      values,
    );
    return r.rows[0]!;
  }
  const r = await client.query<LocalSub>(
    `UPDATE subscriptions SET plan_code = $3, plan_version = $4, status = $5, current_period_start = $6, current_period_end = $7,
       cancel_at_period_end = $8, provider_customer_ref = $9, provider_updated_at = $10, scheduled_plan_code = $11, scheduled_plan_version = $12,
       grace_until = CASE WHEN $5 = 'active' THEN NULL ELSE grace_until END,
       grace_due_at = CASE WHEN $5 = 'active' THEN NULL ELSE grace_due_at END,
       version = version + 1, updated_at = now()
     WHERE organization_id = $1 AND external_id = $2
     RETURNING id, provider_updated_at, status, grace_due_at, grace_until, plan_code, plan_version`,
    values,
  );
  return r.rows[0]!;
}

/** Cycle [start, end) et droits du plan, créés une seule fois. */
async function ensureCycle(client: pg.PoolClient, orgId: string, subId: string, start: string, end: string, plan: { code: string; version: number }): Promise<string | null> {
  let cycleId = (await client.query<{ id: string }>("SELECT id FROM billing_cycles WHERE organization_id = $1 AND starts_at = $2", [orgId, start])).rows[0]?.id;
  if (!cycleId) {
    const overlap = await client.query("SELECT 1 FROM billing_cycles WHERE organization_id = $1 AND tstzrange(starts_at, ends_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')", [orgId, start, end]);
    if (overlap.rowCount) return null; // jamais de chevauchement (contrainte d'exclusion) : on n'invente pas de cycle
    cycleId = (await client.query<{ id: string }>("INSERT INTO billing_cycles (organization_id, subscription_id, starts_at, ends_at) VALUES ($1, $2, $3, $4) RETURNING id", [orgId, subId, start, end])).rows[0]!.id;
  }
  const ent = await planEntitlements(client, plan.code, plan.version);
  for (const [key, limit] of Object.entries(ent)) {
    await client.query(
      `INSERT INTO entitlements (organization_id, cycle_id, key, limit_value, source, effective_from, effective_to)
       VALUES ($1, $2, $3, $4, 'plan', $5, $6) ON CONFLICT (cycle_id, key, source) DO NOTHING`,
      [orgId, cycleId, key, limit, start, end],
    );
  }
  return cycleId;
}

/** Mise à niveau payée : delta crédité sur le cycle courant, à partir de la date de paiement. */
async function creditUpgrade(client: pg.PoolClient, orgId: string, at: Date, plan: { code: string; version: number }): Promise<void> {
  const cycle = (await client.query<{ id: string; ends_at: Date }>("SELECT id, ends_at FROM billing_cycles WHERE organization_id = $1 AND starts_at <= $2 AND ends_at > $2", [orgId, at])).rows[0];
  if (!cycle) return;
  const base = Object.fromEntries((await client.query<{ key: string; limit_value: number }>("SELECT key, limit_value FROM entitlements WHERE cycle_id = $1 AND source = 'plan'", [cycle.id])).rows.map((r) => [r.key, r.limit_value]));
  const delta = upgradeDelta(base, await planEntitlements(client, plan.code, plan.version));
  for (const [key, value] of Object.entries(delta)) {
    await client.query(
      `INSERT INTO entitlements (organization_id, cycle_id, key, limit_value, source, effective_from, effective_to)
       VALUES ($1, $2, $3, $4, 'upgrade_delta', $5, $6)
       ON CONFLICT (cycle_id, key, source) DO UPDATE SET limit_value = greatest(entitlements.limit_value, EXCLUDED.limit_value)`,
      [orgId, cycle.id, key, value, at, cycle.ends_at],
    );
  }
}

/** Applique un événement normalisé. Renvoie l'organisation concernée. */
export async function applyEvent(deps: ProjectionDeps, raw: unknown): Promise<string> {
  const parsed = eventSchema.safeParse(raw);
  if (!parsed.success) throw new ProjectionIgnored("invalid_event_shape");
  const { type, createdAt, data } = parsed.data;
  const s = data.subscription as ProviderSubscription;
  // L'organisation vient des métadonnées posées par notre serveur au Checkout (événement signé) ;
  // si l'abonnement est déjà connu, elle doit correspondre.
  const known = (await deps.pool.query<{ org: string | null }>("SELECT billing_org_by_subscription($1) AS org", [s.id])).rows[0]?.org ?? null;
  if (known && known !== s.organizationId) throw new ProjectionIgnored("organization_mismatch");
  const at = new Date(createdAt * 1000);
  await withTenant(deps.pool, { organizationId: s.organizationId, userId: null }, async ({ client }) => {
    const exists = await client.query("SELECT 1 FROM organizations WHERE id = $1", [s.organizationId]);
    if (!exists.rowCount) throw new ProjectionIgnored("unknown_organization");
    const local = await applySnapshot(client, s, at);
    const inv = data.invoice;
    if (type === "invoice.paid" && inv) {
      const plan = planFromPriceCode(s.priceCode);
      if (inv.reason === "subscription_update") await creditUpgrade(client, s.organizationId, new Date(inv.dueAt), plan);
      else await ensureCycle(client, s.organizationId, local.id, inv.periodStart, inv.periodEnd, plan);
    }
    if (type === "invoice.payment_failed" && inv) {
      const current = (await client.query<LocalSub>("SELECT id, provider_updated_at, status, grace_due_at, grace_until, plan_code, plan_version FROM subscriptions WHERE id = $1", [local.id])).rows[0]!;
      if (current.status === "past_due") {
        const g = graceUntilFor({ graceDueAt: current.grace_due_at, graceUntil: current.grace_until }, new Date(inv.dueAt));
        await client.query("UPDATE subscriptions SET grace_due_at = $2, grace_until = $3 WHERE id = $1", [local.id, g.graceDueAt, g.graceUntil]);
      }
    }
    await client.query(
      `INSERT INTO audit_events (organization_id, actor_kind, action, target_type, target_id, safe_metadata) VALUES ($1, 'system', $2, 'subscription', $3, $4)`,
      [s.organizationId, `billing.${type}`, s.id, JSON.stringify({ status: s.status, plan: s.priceCode })],
    );
  });
  return s.organizationId;
}

export interface ProjectionReport {
  processed: number;
  ignored: number;
  failed: number;
}

/** Traite les événements en attente ; appelé par le worker (et en mode simulation, juste après ingestion). */
export async function projectPending(deps: ProjectionDeps, limit = 50): Promise<ProjectionReport> {
  const report: ProjectionReport = { processed: 0, ignored: 0, failed: 0 };
  const rows = (await deps.pool.query<{ id: string; event_type: string; payload: Record<string, unknown>; attempts: number }>("SELECT * FROM billing_pending_webhooks($1)", [limit])).rows;
  for (const row of rows) {
    try {
      const org = await applyEvent(deps, { type: row.event_type, ...(row.payload as object) });
      await deps.pool.query("SELECT billing_mark_webhook($1, 'processed', NULL, $2)", [row.id, org]);
      report.processed += 1;
    } catch (e) {
      if (e instanceof ProjectionIgnored) {
        await deps.pool.query("SELECT billing_mark_webhook($1, 'ignored', $2, NULL)", [row.id, e.message]);
        report.ignored += 1;
      } else {
        const code = e instanceof Error ? e.name : "unknown";
        await deps.pool.query("SELECT billing_mark_webhook($1, $2, $3, NULL)", [row.id, row.attempts + 1 >= 10 ? "failed" : "received", code]);
        report.failed += 1;
      }
    }
  }
  return report;
}

/**
 * Réconciliation périodique : l'état du fournisseur fait foi ; rattrape un webhook perdu
 * (instantané d'abonnement + cycle courant si l'abonnement est actif).
 */
export async function reconcileSubscriptions(deps: ProjectionDeps, limit = 100): Promise<{ checked: number; updated: number }> {
  const rows = (await deps.pool.query<{ organization_id: string; external_id: string }>("SELECT * FROM billing_subscriptions_to_reconcile($1)", [limit])).rows;
  let updated = 0;
  for (const r of rows) {
    const s = await deps.payments.retrieveSubscription(r.external_id);
    if (!s || s.organizationId !== r.organization_id) continue;
    await withTenant(deps.pool, { organizationId: r.organization_id, userId: null }, async ({ client }) => {
      const local = await applySnapshot(client, s, deps.clock.now());
      if (s.status === "active") await ensureCycle(client, r.organization_id, local.id, s.currentPeriodStart, s.currentPeriodEnd, planFromPriceCode(s.priceCode));
    });
    updated += 1;
  }
  return { checked: rows.length, updated };
}
