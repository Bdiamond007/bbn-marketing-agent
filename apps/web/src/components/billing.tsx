"use client";
import { useFormatter, useLocale } from "next-intl";
import { useState } from "react";
import type { BillingOverview } from "@bbn/billing";
import { useRouter } from "../i18n/navigation";
import { api } from "../lib/api-client";
import { useForm } from "../lib/use-form";
import { Badge, Button, Card, Notice } from "./ui";

const ENTITLEMENT_KEYS = ["content_items", "publications", "users", "social_accounts", "brands", "regenerations_per_item"] as const;
type PlanName = "essentiel" | "croissance" | "accompagne";
const isPlanName = (c: string): c is PlanName => c === "essentiel" || c === "croissance" || c === "accompagne";

export function BillingPanel({ organizationId, overview, canManage }: { organizationId: string; overview: BillingOverview; canManage: boolean }) {
  const f = useForm();
  const format = useFormatter();
  const locale = useLocale();
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const sub = overview.subscription;
  const live = sub && ["incomplete", "active", "past_due", "suspended"].includes(sub.status);
  const planName = (code: string) => (isPlanName(code) ? f.t(`billing.planNames.${code}`) : code);
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "long" });
  const money = (minor: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "CAD" }).format(minor / 100);

  async function checkout(planCode: string) {
    const r = await f.run<{ url: string }>({}, () => api(`/organizations/${organizationId}/billing/checkout`, { body: { planCode } }));
    if (r) window.location.assign(r.url);
  }
  async function change(planCode: string) {
    const r = await f.run({}, () => api(`/organizations/${organizationId}/billing/plan`, { body: { planCode } }));
    if (r) setNotice(f.t("billing.changeRequested"));
  }
  async function cancelAtRenewal() {
    const r = await f.run({}, () => api(`/organizations/${organizationId}/billing/cancel`, { body: { mode: "at_period_end" } }));
    if (r) {
      setNotice(f.t("billing.changeRequested"));
      router.refresh();
    }
  }
  async function portal() {
    const r = await f.run<{ url: string }>({}, () => api(`/organizations/${organizationId}/billing/portal`, { body: {} }));
    if (r) window.location.assign(r.url);
  }

  return (
    <div className="flex flex-col gap-6">
      {notice ? <Notice tone="success" title={notice} /> : null}
      {f.error ? <Notice tone="error" title={f.error} focusRef={f.summaryRef} /> : null}
      {!canManage ? <Notice tone="info" title={f.t("billing.ownerOnly")} /> : null}

      <Card title={sub ? f.t("billing.currentPlan", { plan: planName(sub.planCode) }) : f.t("billing.noSubscription")}>
        {sub ? (
          <div className="flex flex-col gap-3">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{f.t("billing.status.label")}</span>
              <Badge tone={sub.status === "active" ? "success" : sub.status === "past_due" ? "error" : "neutral"}>{f.t(`billing.status.${sub.status}`)}</Badge>
            </p>
            {sub.currentPeriodStart && sub.currentPeriodEnd ? <p>{f.t("billing.period", { start: date(sub.currentPeriodStart), end: date(sub.currentPeriodEnd) })}</p> : null}
            {overview.access.reason === "grace" && sub.graceUntil ? <Notice tone="error" title={f.t("billing.grace", { date: date(sub.graceUntil) })} /> : null}
            {overview.access.reason === "grace_over" ? <Notice tone="error" title={f.t("billing.graceOver")} /> : null}
            {overview.access.reason === "ended_read_only" ? <Notice tone="info" title={f.t("billing.readOnly")} /> : null}
            {sub.cancelAtPeriodEnd && sub.currentPeriodEnd ? <Notice tone="info" title={f.t("billing.cancelScheduled", { date: date(sub.currentPeriodEnd) })} /> : null}
            {sub.scheduledPlanCode ? <Notice tone="info" title={f.t("billing.scheduledPlan", { plan: planName(sub.scheduledPlanCode) })} /> : null}
            {canManage && live ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={portal} busy={f.busy}>{f.t("billing.portal")}</Button>
                {sub.status === "active" && !sub.cancelAtPeriodEnd ? <Button variant="secondary" onClick={cancelAtRenewal} busy={f.busy}>{f.t("billing.cancelAtRenewal")}</Button> : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card title={f.t("billing.entitlementsTitle")}>
        {overview.cycle ? (
          <ul className="flex flex-col gap-1">
            {ENTITLEMENT_KEYS.filter((k) => overview.entitlements[k] !== undefined).map((k) => (
              <li key={k}>{f.t(`billing.entitlements.${k}`, { count: overview.entitlements[k]! })}</li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">{f.t("billing.noCycle")}</p>
        )}
      </Card>

      <section aria-labelledby="plans-heading" className="flex flex-col gap-4">
        <h2 id="plans-heading" className="text-lg font-semibold">{f.t("billing.plans")}</h2>
        <p className="text-sm text-muted">{f.t("billing.taxesNote")}</p>
        <div className="grid gap-4 md:grid-cols-3">
          {overview.plans.map((p) => {
            const isCurrent = sub?.planCode === p.code && live;
            return (
              <Card key={p.code} title={planName(p.code)} headingLevel={3}>
                <p className="mb-3 text-lg font-semibold">{f.t("billing.perMonth", { price: money(p.priceMinor) })}</p>
                <ul className="mb-4 flex flex-col gap-1 text-sm">
                  {ENTITLEMENT_KEYS.filter((k) => typeof p.entitlements[k] === "number").map((k) => (
                    <li key={k}>{f.t(`billing.entitlements.${k}`, { count: p.entitlements[k] as number })}</li>
                  ))}
                </ul>
                {isCurrent ? (
                  <Badge tone="success">{f.t("billing.current")}</Badge>
                ) : canManage ? (
                  sub?.status === "active" ? (
                    <Button variant="secondary" onClick={() => change(p.code)} busy={f.busy}>{f.t("billing.switchTo")}</Button>
                  ) : !live ? (
                    <Button onClick={() => checkout(p.code)} busy={f.busy}>{f.t("billing.choose")}</Button>
                  ) : null
                ) : null}
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export function SimulatedCheckout({ sessionId }: { sessionId: string | null }) {
  const f = useForm();
  const router = useRouter();
  const [done, setDone] = useState(false);
  async function pay() {
    const r = await f.run({}, () => api("/dev/simulated-payments", { body: { sessionId } }));
    if (r) {
      setDone(true);
      router.push("/app/billing");
      router.refresh();
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <Notice tone="info" title={f.t("billing.simulated.body")} />
      {f.error ? <Notice tone="error" title={f.error} focusRef={f.summaryRef} /> : null}
      {done ? <Notice tone="success" title={f.t("billing.simulated.done")} /> : <Button onClick={pay} busy={f.busy} disabled={!sessionId}>{f.t("billing.simulated.pay")}</Button>}
    </div>
  );
}
