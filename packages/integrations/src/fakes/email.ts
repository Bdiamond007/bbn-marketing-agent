import type { EmailMessage, EmailSender } from "../email";
import { ScenarioScript, SimulatedProviderError, SimulatedTimeoutError } from "../scenario";
import { SequentialIds } from "./util";

export type EmailScenario = "success" | "failure" | "timeout";

/** Boîte email simulée : messages consultables, déduplication par idempotencyKey. */
export class FakeEmailSender implements EmailSender {
  readonly scenarios = new ScenarioScript<EmailScenario>("success");
  readonly mailbox: (EmailMessage & { messageId: string })[] = [];
  private readonly byKey = new Map<string, string>();
  private readonly ids = new SequentialIds("email");

  async send(message: EmailMessage) {
    const existing = this.byKey.get(message.idempotencyKey);
    if (existing) return { messageId: existing, deduplicated: true };
    const s = this.scenarios.take();
    if (s === "failure") throw new SimulatedProviderError("email.send");
    if (s === "timeout") throw new SimulatedTimeoutError("email.send");
    const messageId = this.ids.next();
    this.byKey.set(message.idempotencyKey, messageId);
    this.mailbox.push({ ...message, messageId });
    return { messageId, deduplicated: false };
  }

  inboxOf(to: string) {
    return this.mailbox.filter((m) => m.to.toLowerCase() === to.toLowerCase());
  }
}
