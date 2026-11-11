import type { Clock } from "@bbn/domain";
import {
  WebhookSignatureError,
  type CheckoutRequest,
  type PaymentEvent,
  type PaymentEventType,
  type PaymentsProvider,
  type ProviderInvoice,
  type ProviderSubscription,
} from "../payments";
import { hmacHex, safeEqualHex, SequentialIds } from "./util";

export const FAKE_WEBHOOK_SECRET = "whsec_fake_local_only";
const TOLERANCE_SECONDS = 300;
const PERIOD_MS = 30 * 24 * 3600 * 1000;

export interface SignedEvent {
  id: string;
  type: string;
  rawBody: string;
  signature: string;
}

/**
 * Paiements simulés, avec cycle de vie d'abonnement (création, renouvellement, échec, mise à niveau,
 * rétrogradation, annulation). Chaque transition renvoie les événements signés que le fournisseur enverrait ;
 * les tests les rejouent (y compris en double ou dans le désordre) contre le webhook.
 * Signature : principe documenté par Stripe (HMAC-SHA256 sur `${t}.${corps}`, tolérance 5 min),
 * sans prétendre à une compatibilité de format complète (contrat live à vérifier).
 */
export class FakePaymentsProvider implements PaymentsProvider {
  readonly checkouts: (CheckoutRequest & { sessionId: string })[] = [];
  private readonly byIdem = new Map<string, { sessionId: string; url: string }>();
  private readonly subs = new Map<string, ProviderSubscription>();
  private readonly ids = new SequentialIds("cs_fake", true);
  private readonly subIds = new SequentialIds("sub_fake", true);
  private readonly cusIds = new SequentialIds("cus_fake", true);
  private readonly invIds = new SequentialIds("in_fake", true);
  private readonly evIds = new SequentialIds("evt_fake", true);

  constructor(
    private readonly clock: Clock,
    /** Catalogue de prix autorisés côté serveur : code → montant en cents. */
    private readonly prices: Readonly<Record<string, number>>,
    private readonly secret = FAKE_WEBHOOK_SECRET,
  ) {}

  async createCheckoutSession(req: CheckoutRequest) {
    if (!(req.priceCode in this.prices)) throw new Error("price_code_not_allowed");
    const existing = this.byIdem.get(req.idempotencyKey);
    if (existing) return existing;
    const sessionId = this.ids.next();
    const res = { sessionId, url: `https://checkout.fake.invalid/session/${sessionId}` };
    this.byIdem.set(req.idempotencyKey, res);
    this.checkouts.push({ ...req, sessionId });
    return res;
  }

  async createPortalSession(req: { organizationId: string; customerRef: string; returnUrl: string }) {
    return { url: `https://billing.fake.invalid/portal/${encodeURIComponent(req.customerRef)}` };
  }

  verifyWebhook(rawBody: string, signatureHeader: string | null): PaymentEvent {
    if (!signatureHeader) throw new WebhookSignatureError("missing_header");
    const parts = Object.fromEntries(
      signatureHeader.split(",").map((p) => {
        const i = p.indexOf("=");
        return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
      }),
    );
    const t = Number(parts.t);
    const v1 = parts.v1 ?? "";
    if (!Number.isFinite(t)) throw new WebhookSignatureError("malformed_header");
    if (!safeEqualHex(v1, hmacHex(this.secret, `${t}.${rawBody}`))) throw new WebhookSignatureError("bad_signature");
    const nowS = Math.floor(this.clock.now().getTime() / 1000);
    if (Math.abs(nowS - t) > TOLERANCE_SECONDS) throw new WebhookSignatureError("timestamp_out_of_tolerance");
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new WebhookSignatureError("invalid_json");
    }
    const ev = parsed as Partial<PaymentEvent>;
    if (typeof ev.id !== "string" || typeof ev.type !== "string") throw new WebhookSignatureError("invalid_event");
    return { id: ev.id, type: ev.type, createdAt: Number(ev.createdAt ?? t), data: (ev.data ?? {}) as Record<string, unknown> };
  }

  async retrieveSubscription(externalId: string) {
    const s = this.subs.get(externalId);
    return s ? { ...s } : null;
  }

  async cancelSubscription(externalId: string, mode: "at_period_end" | "immediately") {
    this.cancel(externalId, mode);
  }

  async changePlan(externalId: string, priceCode: string): Promise<{ effective: "immediate" | "at_renewal" }> {
    return { effective: this.change(externalId, priceCode).effective };
  }

  // ── Transitions simulées (renvoient les événements signés) ─────────────────

  /** Paiement Checkout réussi : abonnement actif, facture payée. */
  completeCheckout(sessionId: string): SignedEvent[] {
    const c = this.checkouts.find((x) => x.sessionId === sessionId);
    if (!c) throw new Error("unknown_session");
    const now = this.clock.now();
    const sub: ProviderSubscription = {
      id: this.subIds.next(),
      customerRef: this.cusIds.next(),
      organizationId: c.organizationId,
      status: "active",
      priceCode: c.priceCode,
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: new Date(now.getTime() + PERIOD_MS).toISOString(),
      cancelAtPeriodEnd: false,
      scheduledPriceCode: null,
    };
    this.subs.set(sub.id, sub);
    return [this.subEvent(sub), this.invoiceEvent("invoice.paid", sub, "paid", "subscription_create", this.prices[sub.priceCode]!)];
  }

  /** Échéance de renouvellement : la période avance ; paiement réussi ou échoué. */
  renew(subId: string, outcome: "paid" | "failed"): SignedEvent[] {
    const s = this.mustGet(subId);
    const start = new Date(s.currentPeriodEnd);
    s.currentPeriodStart = start.toISOString();
    s.currentPeriodEnd = new Date(start.getTime() + PERIOD_MS).toISOString();
    if (s.scheduledPriceCode) {
      s.priceCode = s.scheduledPriceCode;
      s.scheduledPriceCode = null;
    }
    s.status = outcome === "paid" ? "active" : "past_due";
    const inv = this.invoiceEvent(outcome === "paid" ? "invoice.paid" : "invoice.payment_failed", s, outcome === "paid" ? "paid" : "open", "subscription_cycle", this.prices[s.priceCode]!, start);
    return [inv, this.subEvent(s)];
  }

  /** Nouvelle tentative de paiement sur la même échéance. */
  retryPayment(subId: string, outcome: "paid" | "failed"): SignedEvent[] {
    const s = this.mustGet(subId);
    const due = new Date(s.currentPeriodStart);
    s.status = outcome === "paid" ? "active" : "past_due";
    return [this.invoiceEvent(outcome === "paid" ? "invoice.paid" : "invoice.payment_failed", s, outcome === "paid" ? "paid" : "open", "subscription_cycle", this.prices[s.priceCode]!, due), this.subEvent(s)];
  }

  change(subId: string, priceCode: string): { effective: "immediate" | "at_renewal"; events: SignedEvent[] } {
    if (!(priceCode in this.prices)) throw new Error("price_code_not_allowed");
    const s = this.mustGet(subId);
    const up = this.prices[priceCode]! > this.prices[s.priceCode]!;
    if (up) {
      const delta = this.prices[priceCode]! - this.prices[s.priceCode]!;
      s.priceCode = priceCode;
      s.scheduledPriceCode = null;
      return { effective: "immediate", events: [this.invoiceEvent("invoice.paid", s, "paid", "subscription_update", delta), this.subEvent(s)] };
    }
    s.scheduledPriceCode = priceCode;
    return { effective: "at_renewal", events: [this.subEvent(s)] };
  }

  cancel(subId: string, mode: "at_period_end" | "immediately"): SignedEvent[] {
    const s = this.mustGet(subId);
    if (mode === "at_period_end") s.cancelAtPeriodEnd = true;
    else {
      s.status = "canceled";
      s.currentPeriodEnd = this.clock.now().toISOString();
    }
    return [this.subEvent(s)];
  }

  /** Fin de période d'un abonnement annulé à échéance. */
  endPeriod(subId: string): SignedEvent[] {
    const s = this.mustGet(subId);
    s.status = "canceled";
    return [this.subEvent(s)];
  }

  /** Produit un événement signé arbitraire (tests de signature). */
  signEvent(type: string, data: Record<string, unknown>, opts?: { id?: string; at?: Date }): SignedEvent {
    const t = Math.floor((opts?.at ?? this.clock.now()).getTime() / 1000);
    const id = opts?.id ?? this.evIds.next();
    const rawBody = JSON.stringify({ id, type, createdAt: t, data });
    return { id, type, rawBody, signature: `t=${t},v1=${hmacHex(this.secret, `${t}.${rawBody}`)}` };
  }

  private subEvent(s: ProviderSubscription): SignedEvent {
    return this.signEvent("subscription.updated" satisfies PaymentEventType, { subscription: { ...s } });
  }

  private invoiceEvent(type: PaymentEventType, s: ProviderSubscription, status: ProviderInvoice["status"], reason: ProviderInvoice["reason"], amountMinor: number, dueAt?: Date): SignedEvent {
    const invoice: ProviderInvoice = {
      id: this.invIds.next(),
      subscriptionId: s.id,
      status,
      dueAt: (dueAt ?? this.clock.now()).toISOString(),
      amountMinor,
      periodStart: s.currentPeriodStart,
      periodEnd: s.currentPeriodEnd,
      reason,
    };
    return this.signEvent(type, { subscription: { ...s }, invoice });
  }

  private mustGet(id: string): ProviderSubscription {
    const s = this.subs.get(id);
    if (!s) throw new Error("unknown_subscription");
    return s;
  }
}

/**
 * Détection structurelle du simulateur : `instanceof` n'est pas fiable entre bundles serveur
 * (Next.js produit un bundle par route, chacun avec sa propre copie des classes).
 */
export function isSimulatedPayments(p: PaymentsProvider): p is FakePaymentsProvider {
  const c = p as Partial<FakePaymentsProvider>;
  return typeof c.completeCheckout === "function" && Array.isArray(c.checkouts);
}
