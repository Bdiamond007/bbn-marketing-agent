import { describe, expect, it } from "vitest";
import { billingAccess, countedEntitlements, graceUntilFor, upgradeDelta, type SubscriptionFacts } from "./billing";

const d = (s: string) => new Date(s);
const base: SubscriptionFacts = { status: "active", currentPeriodStart: d("2026-11-01T00:00:00Z"), currentPeriodEnd: d("2026-12-01T00:00:00Z"), graceUntil: null, cancelAtPeriodEnd: false };

describe("billingAccess", () => {
  it("actif : tout est permis", () => {
    expect(billingAccess(base, d("2026-11-15T00:00:00Z"))).toMatchObject({ canGenerate: true, canSchedule: true, canDispatchApproved: true, reason: "active" });
  });

  it("annulation à échéance : accès complet jusqu'à la fin, puis lecture/export 30 jours, puis rien", () => {
    const s = { ...base, cancelAtPeriodEnd: true };
    expect(billingAccess(s, d("2026-11-30T23:59:59Z")).canGenerate).toBe(true);
    expect(billingAccess({ ...s, status: "canceled" }, d("2026-12-02T00:00:00Z"))).toMatchObject({ canGenerate: false, canRead: true, reason: "ended_read_only" });
    expect(billingAccess({ ...s, status: "canceled" }, d("2026-12-31T00:00:00Z"))).toMatchObject({ canRead: false, reason: "ended" });
  });

  it("impayé : pendant la grâce, ni génération ni programmation, mais les contenus approuvés peuvent partir", () => {
    const s: SubscriptionFacts = { ...base, status: "past_due", graceUntil: d("2026-12-08T00:00:00Z") };
    expect(billingAccess(s, d("2026-12-03T00:00:00Z"))).toEqual({ canGenerate: false, canSchedule: false, canDispatchApproved: true, canRead: true, reason: "grace" });
    expect(billingAccess(s, d("2026-12-08T00:00:00Z"))).toMatchObject({ canDispatchApproved: false, reason: "grace_over" });
  });

  it("suspendu, incomplet ou sans abonnement : aucune action, lecture seulement", () => {
    for (const status of ["suspended", "incomplete"] as const) expect(billingAccess({ ...base, status }, d("2026-11-15T00:00:00Z"))).toMatchObject({ canGenerate: false, canDispatchApproved: false, canRead: true });
    expect(billingAccess(null, d("2026-11-15T00:00:00Z"))).toMatchObject({ canGenerate: false, reason: "none" });
  });
});

describe("graceUntilFor", () => {
  it("7 jours après l'échéance initiale, jamais prolongée par une nouvelle tentative", () => {
    const first = graceUntilFor({ graceDueAt: null, graceUntil: null }, d("2026-12-01T00:00:00Z"));
    expect(first.graceUntil.toISOString()).toBe("2026-12-08T00:00:00.000Z");
    expect(graceUntilFor(first, d("2026-12-01T00:00:00Z"))).toEqual(first);
  });
  it("une nouvelle échéance ouvre une nouvelle grâce", () => {
    const first = graceUntilFor({ graceDueAt: null, graceUntil: null }, d("2026-12-01T00:00:00Z"));
    expect(graceUntilFor(first, d("2027-01-01T00:00:00Z")).graceUntil.toISOString()).toBe("2027-01-08T00:00:00.000Z");
  });
});

describe("upgradeDelta et countedEntitlements", () => {
  it("crédite seulement les deltas positifs", () => {
    expect(upgradeDelta({ content_items: 15, publications: 45, users: 2 }, { content_items: 30, publications: 90, users: 5, social_accounts: 3 })).toEqual({ content_items: 15, publications: 45, users: 3, social_accounts: 3 });
    expect(upgradeDelta({ content_items: 30 }, { content_items: 15 })).toEqual({});
  });
  it("ignore les clés non numériques du plan", () => {
    expect(countedEntitlements({ content_items: 15, internal_review: true, ops_minutes_target: 120, publications: 45 })).toEqual({ content_items: 15, publications: 45 });
  });
});
