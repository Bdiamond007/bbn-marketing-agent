/**
 * Quotas transactionnels (QUOTA-01, ADR-0002) : réservation, consommation, libération.
 * - Toujours appelé dans une transaction tenant (withTenant) du service appelant, avec le reste
 *   de l'opération (quota + job + outbox ; réservation + publication…).
 * - Verrou d'allocation : la ligne du cycle courant est verrouillée (FOR UPDATE) AVANT le calcul de capacité ;
 *   les réservations concurrentes d'une même organisation sont donc sérialisées.
 * - Idempotent : une ressource n'a qu'une réservation par type ; le ledger est dédupliqué par clé.
 * - MVP : uniquement dans la période de droits courante connue (pas de période future).
 */
import type pg from "pg";
import { ServiceError } from "@bbn/domain";
import { loadBillingAccess } from "./service";

export type UsageType = "content_item" | "publication" | "regeneration";

const CYCLE_KEY: Record<Exclude<UsageType, "regeneration">, string> = { content_item: "content_items", publication: "publications" };

export interface Reservation {
  id: string;
  cycleId: string;
  type: UsageType;
  resourceId: string;
  status: "reserved" | "consumed" | "released";
  quantity: number;
}

interface ReservationRow {
  id: string;
  cycle_id: string;
  type: UsageType;
  resource_id: string;
  status: Reservation["status"];
  quantity: number;
}
const toReservation = (r: ReservationRow): Reservation => ({ id: r.id, cycleId: r.cycle_id, type: r.type, resourceId: r.resource_id, status: r.status, quantity: r.quantity });

async function ledger(client: pg.PoolClient, orgId: string, cycleId: string, type: UsageType, kind: "reserve" | "consume" | "release", delta: number, dedupeKey: string, reservationId: string) {
  await client.query(
    `INSERT INTO usage_ledger (organization_id, cycle_id, type, entry_kind, delta, dedupe_key, reservation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (dedupe_key) DO NOTHING`,
    [orgId, cycleId, type, kind, delta, dedupeKey, reservationId],
  );
}

async function limitFor(client: pg.PoolClient, cycleId: string, key: string, now: Date): Promise<number> {
  const r = await client.query<{ total: number | null }>("SELECT sum(limit_value)::int AS total FROM entitlements WHERE cycle_id = $1 AND key = $2 AND effective_from <= $3 AND effective_to > $3", [cycleId, key, now]);
  return r.rows[0]?.total ?? 0;
}

export interface ReserveInput {
  organizationId: string;
  type: UsageType;
  /** Ressource unique débitée (contenu, publication, job de régénération). */
  resourceId: string;
  /** Pour une régénération : le contenu auquel elle s'applique. */
  parentResourceId?: string;
  /** Date d'usage (heure programmée pour une publication) ; défaut : maintenant. */
  at?: Date;
  now: Date;
  quantity?: number;
}

export async function reserve(client: pg.PoolClient, input: ReserveInput): Promise<Reservation> {
  const q = input.quantity ?? 1;
  if (!Number.isInteger(q) || q < 1) throw new ServiceError("validation_failed", { field: "quantity" });
  if (input.type === "regeneration" && !input.parentResourceId) throw new ServiceError("validation_failed", { field: "parentResourceId" });

  // Verrou d'allocation sur le cycle courant (contenant « maintenant »).
  const cycle = (
    await client.query<{ id: string; starts_at: Date; ends_at: Date }>(
      "SELECT id, starts_at, ends_at FROM billing_cycles WHERE organization_id = $1 AND starts_at <= $2 AND ends_at > $2 FOR UPDATE",
      [input.organizationId, input.now],
    )
  ).rows[0];
  if (!cycle) throw new ServiceError("business_rule", { reason: "no_current_entitlement_period" });
  const at = input.at ?? input.now;
  if (at.getTime() < cycle.starts_at.getTime() || at.getTime() >= cycle.ends_at.getTime()) {
    throw new ServiceError("business_rule", { reason: "outside_entitlement_period" });
  }

  // Idempotence : même ressource ⇒ même réservation.
  const existing = (await client.query<ReservationRow>("SELECT id, cycle_id, type, resource_id, status, quantity FROM usage_reservations WHERE type = $1 AND resource_id = $2", [input.type, input.resourceId])).rows[0];
  if (existing) {
    if (existing.status === "released") throw new ServiceError("conflict", { reason: "reservation_released" });
    return toReservation(existing);
  }

  let limit: number;
  let used: number;
  if (input.type === "regeneration") {
    limit = await limitFor(client, cycle.id, "regenerations_per_item", input.now);
    used = (await client.query<{ n: number }>("SELECT coalesce(sum(quantity), 0)::int AS n FROM usage_reservations WHERE type = 'regeneration' AND parent_resource_id = $1 AND status <> 'released'", [input.parentResourceId])).rows[0]!.n;
  } else {
    limit = await limitFor(client, cycle.id, CYCLE_KEY[input.type], input.now);
    used = (await client.query<{ n: number }>("SELECT coalesce(sum(quantity), 0)::int AS n FROM usage_reservations WHERE cycle_id = $1 AND type = $2 AND status <> 'released'", [cycle.id, input.type])).rows[0]!.n;
  }
  if (used + q > limit) throw new ServiceError("business_rule", { reason: "quota_exhausted", type: input.type, limit, used });

  const r = (
    await client.query<ReservationRow>(
      `INSERT INTO usage_reservations (organization_id, cycle_id, type, quantity, resource_id, parent_resource_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'reserved', $7, $7) RETURNING id, cycle_id, type, resource_id, status, quantity`,
      [input.organizationId, cycle.id, input.type, q, input.resourceId, input.parentResourceId ?? null, input.now],
    )
  ).rows[0]!;
  await ledger(client, input.organizationId, cycle.id, input.type, "reserve", q, `reserve:${input.type}:${input.resourceId}`, r.id);
  return toReservation(r);
}

async function lockReservation(client: pg.PoolClient, type: UsageType, resourceId: string): Promise<ReservationRow & { organization_id: string }> {
  const r = (await client.query<ReservationRow & { organization_id: string }>("SELECT id, cycle_id, type, resource_id, status, quantity, organization_id FROM usage_reservations WHERE type = $1 AND resource_id = $2 FOR UPDATE", [type, resourceId])).rows[0];
  if (!r) throw new ServiceError("not_found");
  return r;
}

/**
 * Consommation (succès confirmé, ou première proposition exploitable persistée). Idempotente.
 * Toujours imputée au cycle de la réservation initiale (même si un nouveau cycle a commencé).
 */
export async function consume(client: pg.PoolClient, type: UsageType, resourceId: string, now: Date): Promise<Reservation> {
  const r = await lockReservation(client, type, resourceId);
  if (r.status === "consumed") return toReservation(r);
  if (r.status === "released") throw new ServiceError("conflict", { reason: "reservation_released" });
  await client.query("UPDATE usage_reservations SET status = 'consumed', updated_at = $2 WHERE id = $1", [r.id, now]);
  await ledger(client, r.organization_id, r.cycle_id, type, "consume", 0, `consume:${r.id}`, r.id);
  return toReservation({ ...r, status: "consumed" });
}

/** Libération (échec technique sans résultat, annulation certaine, échec terminal réconcilié). Idempotente. */
export async function release(client: pg.PoolClient, type: UsageType, resourceId: string, now: Date): Promise<Reservation> {
  const r = await lockReservation(client, type, resourceId);
  if (r.status === "released") return toReservation(r);
  if (r.status === "consumed") throw new ServiceError("conflict", { reason: "reservation_consumed" });
  await client.query("UPDATE usage_reservations SET status = 'released', updated_at = $2 WHERE id = $1", [r.id, now]);
  await ledger(client, r.organization_id, r.cycle_id, type, "release", -r.quantity, `release:${r.id}`, r.id);
  return toReservation({ ...r, status: "released" });
}

export interface UsageLine {
  limit: number;
  reserved: number;
  consumed: number;
  remaining: number;
}
export interface UsageSummary {
  cycle: { id: string; startsAt: string; endsAt: string } | null;
  contentItems: UsageLine | null;
  publications: UsageLine | null;
}

/** Usage réel du cycle courant ; null quand aucun cycle n'existe (jamais de compteur inventé). */
export async function usageSummary(client: pg.PoolClient, orgId: string, now: Date): Promise<UsageSummary> {
  const cycle = (await client.query<{ id: string; starts_at: Date; ends_at: Date }>("SELECT id, starts_at, ends_at FROM billing_cycles WHERE organization_id = $1 AND starts_at <= $2 AND ends_at > $2", [orgId, now])).rows[0];
  if (!cycle) return { cycle: null, contentItems: null, publications: null };
  const line = async (type: "content_item" | "publication"): Promise<UsageLine> => {
    const limit = await limitFor(client, cycle.id, CYCLE_KEY[type], now);
    const r = (
      await client.query<{ reserved: number; consumed: number }>(
        "SELECT coalesce(sum(quantity) FILTER (WHERE status = 'reserved'), 0)::int AS reserved, coalesce(sum(quantity) FILTER (WHERE status = 'consumed'), 0)::int AS consumed FROM usage_reservations WHERE cycle_id = $1 AND type = $2",
        [cycle.id, type],
      )
    ).rows[0]!;
    return { limit, reserved: r.reserved, consumed: r.consumed, remaining: Math.max(0, limit - r.reserved - r.consumed) };
  };
  return { cycle: { id: cycle.id, startsAt: cycle.starts_at.toISOString(), endsAt: cycle.ends_at.toISOString() }, contentItems: await line("content_item"), publications: await line("publication") };
}

/** Garde de facturation pour les appelants (génération, programmation, envoi). */
export async function assertBillingAllows(client: pg.PoolClient, orgId: string, now: Date, capability: "generate" | "schedule" | "dispatch"): Promise<void> {
  const a = await loadBillingAccess(client, orgId, now);
  const ok = capability === "generate" ? a.canGenerate : capability === "schedule" ? a.canSchedule : a.canDispatchApproved;
  if (!ok) throw new ServiceError("business_rule", { reason: "billing_access_denied", access: a.reason });
}
