import { describe, expect, it } from "vitest";
import type { MessageQueue } from "../queue";

export function messageQueueContract(name: string, make: () => { queue: MessageQueue; advanceSeconds: (s: number) => void }) {
  describe(`MessageQueue contract — ${name}`, () => {
    it("livre puis supprime à l'acquittement", async () => {
      const { queue } = make();
      await queue.send("generation", { jobId: "j1" });
      const [m] = await queue.receive<{ jobId: string }>("generation", { maxMessages: 10, visibilityTimeoutSeconds: 30 });
      expect(m?.body.jobId).toBe("j1");
      await queue.ack("generation", m!.receiptHandle);
      expect(await queue.receive("generation", { maxMessages: 10, visibilityTimeoutSeconds: 30 })).toHaveLength(0);
    });

    it("relivre un message non acquitté après expiration de visibilité (au moins une fois)", async () => {
      const { queue, advanceSeconds } = make();
      await queue.send("publishing", { id: 1 });
      const first = await queue.receive("publishing", { maxMessages: 1, visibilityTimeoutSeconds: 30 });
      expect(first).toHaveLength(1);
      expect(await queue.receive("publishing", { maxMessages: 1, visibilityTimeoutSeconds: 30 })).toHaveLength(0);
      advanceSeconds(31);
      const again = await queue.receive("publishing", { maxMessages: 1, visibilityTimeoutSeconds: 30 });
      expect(again[0]?.receiveCount).toBe(2);
    });

    it("respecte un délai d'envoi", async () => {
      const { queue, advanceSeconds } = make();
      await queue.send("notifications", { n: 1 }, { delaySeconds: 10 });
      expect(await queue.receive("notifications", { maxMessages: 1, visibilityTimeoutSeconds: 5 })).toHaveLength(0);
      advanceSeconds(10);
      expect(await queue.receive("notifications", { maxMessages: 1, visibilityTimeoutSeconds: 5 })).toHaveLength(1);
    });

    it("déduplique sur deduplicationId", async () => {
      const { queue } = make();
      const a = await queue.send("projections", { e: 1 }, { deduplicationId: "evt_1" });
      const b = await queue.send("projections", { e: 1 }, { deduplicationId: "evt_1" });
      expect(a.id).toBe(b.id);
      expect(await queue.receive("projections", { maxMessages: 10, visibilityTimeoutSeconds: 5 })).toHaveLength(1);
    });

    it("un acquittement avec un handle périmé ne supprime pas la relivraison", async () => {
      const { queue, advanceSeconds } = make();
      await queue.send("generation", { id: "x" });
      const [first] = await queue.receive("generation", { maxMessages: 1, visibilityTimeoutSeconds: 5 });
      advanceSeconds(6);
      const [second] = await queue.receive("generation", { maxMessages: 1, visibilityTimeoutSeconds: 5 });
      await queue.ack("generation", first!.receiptHandle);
      advanceSeconds(6);
      const third = await queue.receive("generation", { maxMessages: 1, visibilityTimeoutSeconds: 5 });
      expect(third).toHaveLength(1);
      await queue.ack("generation", third[0]!.receiptHandle);
      expect(second).toBeDefined();
    });
  });
}
