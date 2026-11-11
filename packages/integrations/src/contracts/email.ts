import { describe, expect, it } from "vitest";
import type { EmailMessage, EmailSender } from "../email";

const msg: EmailMessage = {
  to: "owner@example.test",
  locale: "fr-CA",
  templateKey: "approval_requested",
  templateVersion: 1,
  subject: "Contenu à approuver",
  text: "Un contenu attend votre approbation.",
  idempotencyKey: "notif:abc",
};

export function emailSenderContract(name: string, make: () => { email: EmailSender }) {
  describe(`EmailSender contract — ${name}`, () => {
    it("envoie et déduplique sur idempotencyKey", async () => {
      const { email } = make();
      const a = await email.send(msg);
      const b = await email.send(msg);
      expect(a.deduplicated).toBe(false);
      expect(b).toEqual({ messageId: a.messageId, deduplicated: true });
    });
  });
}
