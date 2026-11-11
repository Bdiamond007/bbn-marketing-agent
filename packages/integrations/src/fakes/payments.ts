import type { Clock } from "@bbn/domain";
import { WebhookSignatureError, type CheckoutRequest, type PaymentEvent, type PaymentsProvider } from "../payments";
import { hmacHex, safeEqualHex, SequentialIds } from "./util";

export const FAKE_WEBHOOK_SECRET = "whsec_fake_local_only";
const TOLERANCE_SECONDS = 300;

/**
 * Paiements simulés. Le schéma de signature reproduit le principe documenté par Stripe
 * (HMAC-SHA256 sur `${t}.${corps brut}`, en-tête `t=…,v1=…`, tolérance de 5 min),
 * sans prétendre à une compatibilité de format complète : le contrat live sera vérifié en E07.
 */
export class FakePaymentsProvider implements PaymentsProvider {
  readonly checkouts: (CheckoutRequest & { sessionId: string })[] = [];
  private readonly byIdem = new Map<string, { sessionId: string; url: string }>();
  private readonly ids = new SequentialIds("cs_fake");
  private readonly evIds = new SequentialIds("evt_fake");

  constructor(private readonly clock: Clock, private readonly allowedPriceCodes: readonly string[], private readonly secret = FAKE_WEBHOOK_SECRET) {}

  async createCheckoutSession(req: CheckoutRequest) {
    if (!this.allowedPriceCodes.includes(req.priceCode)) throw new Error("price_code_not_allowed");
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

  /** Produit un événement signé (corps brut + en-tête) pour les tests. */
  signEvent(type: string, data: Record<string, unknown>, opts?: { id?: string; at?: Date }): { rawBody: string; signature: string; id: string } {
    const t = Math.floor((opts?.at ?? this.clock.now()).getTime() / 1000);
    const id = opts?.id ?? this.evIds.next();
    const rawBody = JSON.stringify({ id, type, createdAt: t, data });
    return { rawBody, signature: `t=${t},v1=${hmacHex(this.secret, `${t}.${rawBody}`)}`, id };
  }
}
