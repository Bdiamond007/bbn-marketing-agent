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

export interface PaymentsProvider {
  /** La redirection Checkout ne prouve jamais un paiement (§13). */
  createCheckoutSession(req: CheckoutRequest): Promise<{ sessionId: string; url: string }>;
  createPortalSession(req: { organizationId: string; customerRef: string; returnUrl: string }): Promise<{ url: string }>;
  /** Vérifie la signature sur le corps brut, avec tolérance temporelle. */
  verifyWebhook(rawBody: string, signatureHeader: string | null): PaymentEvent;
}
