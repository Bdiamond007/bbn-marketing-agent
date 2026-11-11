/**
 * Règles d'accès liées à l'abonnement (SPECIFICATION §3, ADR-0002) — module pur.
 */

export type SubscriptionStatus = "incomplete" | "active" | "past_due" | "canceled" | "expired" | "suspended";

export interface SubscriptionFacts {
  status: SubscriptionStatus;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  graceUntil: Date | null;
  cancelAtPeriodEnd: boolean;
}

export interface BillingAccess {
  /** Nouvelles générations IA autorisées. */
  canGenerate: boolean;
  /** Nouvelles programmations autorisées. */
  canSchedule: boolean;
  /** Envoi des contenus déjà approuvés et programmés (si les droits le permettent). */
  canDispatchApproved: boolean;
  /** Consultation et export. */
  canRead: boolean;
  reason: "active" | "grace" | "grace_over" | "ended_read_only" | "ended" | "suspended" | "incomplete" | "none";
}

export const GRACE_DAYS = 7;
export const READ_ONLY_DAYS_AFTER_END = 30;
const DAY = 24 * 3600 * 1000;

const deny = (reason: BillingAccess["reason"], canRead: boolean): BillingAccess => ({ canGenerate: false, canSchedule: false, canDispatchApproved: false, canRead, reason });

export function billingAccess(sub: SubscriptionFacts | null, now: Date): BillingAccess {
  if (!sub) return deny("none", true);
  const t = now.getTime();
  const end = sub.currentPeriodEnd?.getTime() ?? null;
  switch (sub.status) {
    case "active":
      // Annulation à échéance : accès complet jusqu'à la fin de la période.
      if (end !== null && t >= end) return endedAccess(end, t);
      return { canGenerate: true, canSchedule: true, canDispatchApproved: true, canRead: true, reason: "active" };
    case "past_due": {
      const grace = sub.graceUntil?.getTime() ?? null;
      if (grace !== null && t < grace) return { canGenerate: false, canSchedule: false, canDispatchApproved: true, canRead: true, reason: "grace" };
      return deny("grace_over", true);
    }
    case "canceled":
    case "expired":
      return end === null ? deny("ended", false) : endedAccess(end, t);
    case "suspended":
      return deny("suspended", true);
    case "incomplete":
      return deny("incomplete", true);
  }
}

function endedAccess(end: number, t: number): BillingAccess {
  return t < end + READ_ONLY_DAYS_AFTER_END * DAY ? deny("ended_read_only", true) : deny("ended", false);
}

/**
 * Date de fin de grâce : 7 jours après l'échéance initiale, fixée une seule fois par échéance.
 * Une nouvelle tentative de paiement sur la même échéance ne prolonge jamais la grâce.
 */
export function graceUntilFor(existing: { graceDueAt: Date | null; graceUntil: Date | null }, dueAt: Date): { graceDueAt: Date; graceUntil: Date } {
  if (existing.graceDueAt && existing.graceUntil && existing.graceDueAt.getTime() === dueAt.getTime()) {
    return { graceDueAt: existing.graceDueAt, graceUntil: existing.graceUntil };
  }
  return { graceDueAt: dueAt, graceUntil: new Date(dueAt.getTime() + GRACE_DAYS * DAY) };
}

export type EntitlementMap = Partial<Record<string, number>>;

/** Mise à niveau en cours de cycle : seul le delta positif est crédité, sans réinitialiser l'usage. */
export function upgradeDelta(from: EntitlementMap, to: EntitlementMap): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(to)) {
    if (typeof v !== "number") continue;
    const d = v - (typeof from[k] === "number" ? (from[k] as number) : 0);
    if (d > 0) out[k] = d;
  }
  return out;
}

/** Seules les clés numériques du plan deviennent des droits comptés. */
export const COUNTED_ENTITLEMENTS = ["content_items", "publications", "regenerations_per_item", "users", "social_accounts", "brands"] as const;
export function countedEntitlements(planEntitlements: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of COUNTED_ENTITLEMENTS) {
    const v = planEntitlements[k];
    if (typeof v === "number" && Number.isInteger(v) && v >= 0) out[k] = v;
  }
  return out;
}
