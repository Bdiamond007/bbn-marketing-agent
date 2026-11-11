import { describe, expect, it } from "vitest";
import { WebhookSignatureError, type PaymentsProvider } from "../payments";

export interface PaymentsHarness {
  payments: PaymentsProvider;
  sign: (type: string, data: Record<string, unknown>, opts?: { id?: string; at?: Date }) => { rawBody: string; signature: string; id: string };
  advanceSeconds: (s: number) => void;
}

export function paymentsContract(name: string, make: () => PaymentsHarness) {
  describe(`PaymentsProvider contract — ${name}`, () => {
    it("refuse un code de prix non autorisé côté serveur", async () => {
      const { payments } = make();
      await expect(
        payments.createCheckoutSession({ organizationId: "o", priceCode: "free_lunch", successUrl: "https://x/s", cancelUrl: "https://x/c", idempotencyKey: "k" }),
      ).rejects.toThrow();
    });

    it("rend la même session pour la même clé d'idempotence", async () => {
      const { payments } = make();
      const req = { organizationId: "o", priceCode: "essentiel_monthly_cad_v1", successUrl: "https://x/s", cancelUrl: "https://x/c", idempotencyKey: "k1" };
      expect((await payments.createCheckoutSession(req)).sessionId).toBe((await payments.createCheckoutSession(req)).sessionId);
    });

    it("accepte un webhook correctement signé", () => {
      const { payments, sign } = make();
      const s = sign("invoice.paid", { subscription: "sub_1" });
      expect(payments.verifyWebhook(s.rawBody, s.signature)).toMatchObject({ id: s.id, type: "invoice.paid" });
    });

    it("refuse en-tête absent, corps altéré et horodatage hors tolérance", () => {
      const { payments, sign, advanceSeconds } = make();
      const s = sign("invoice.paid", { amount: 9900 });
      expect(() => payments.verifyWebhook(s.rawBody, null)).toThrow(WebhookSignatureError);
      expect(() => payments.verifyWebhook(s.rawBody.replace("9900", "1"), s.signature)).toThrow(WebhookSignatureError);
      advanceSeconds(301);
      expect(() => payments.verifyWebhook(s.rawBody, s.signature)).toThrow(WebhookSignatureError);
    });
  });
}
