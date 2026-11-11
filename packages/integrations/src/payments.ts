export interface CheckoutRequest {
  organizationId: string;
  /** Code de prix autorisé côté serveur : jamais un montant fourni par le navigateur. */
  priceCode: string;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
}

export interface PaymentEvent {
  id: string;
  type: string;
  createdAt: number;
  data: Record<string, unknown>;
}

export class WebhookSignatureError extends Error {
  constructor(reason: string) {
    super(`Webhook signature rejected: ${reason}`);
    this.name = "WebhookSignatureError";
  }
}

/** Abonnement tel que normalisé par l'adaptateur (le format natif du fournisseur ne sort pas de l'adaptateur). */
export interface ProviderSubscription {
  id: string;
  customerRef: string;
  organizationId: string;
  status: "incomplete" | "active" | "past_due" | "canceled";
  priceCode: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  scheduledPriceCode: string | null;
}

export interface ProviderInvoice {
  id: string;
  subscriptionId: string;
  status: "paid" | "open";
  dueAt: string;
  amountMinor: number;
  periodStart: string;
  periodEnd: string;
  reason: "subscription_create" | "subscription_cycle" | "subscription_update";
}

/** Types d'événements normalisés consommés par la projection. */
export type PaymentEventType = "subscription.updated" | "invoice.paid" | "invoice.payment_failed";

export interface PaymentsProvider {
  /** La redirection Checkout ne prouve jamais un paiement (§13). */
  createCheckoutSession(req: CheckoutRequest): Promise<{ sessionId: string; url: string }>;
  createPortalSession(req: { organizationId: string; customerRef: string; returnUrl: string }): Promise<{ url: string }>;
  /** Vérifie la signature sur le corps brut, avec tolérance temporelle. */
  verifyWebhook(rawBody: string, signatureHeader: string | null): PaymentEvent;
  /** Lecture de l'état courant (réconciliation périodique). */
  retrieveSubscription(externalId: string): Promise<ProviderSubscription | null>;
  cancelSubscription(externalId: string, mode: "at_period_end" | "immediately"): Promise<void>;
  /** Mise à niveau immédiate (avec paiement du prorata) ou rétrogradation au renouvellement. */
  changePlan(externalId: string, priceCode: string): Promise<{ effective: "immediate" | "at_renewal" }>;
}
