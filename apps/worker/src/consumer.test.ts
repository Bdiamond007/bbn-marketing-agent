import { ManualClock } from "@bbn/domain";
import { FakeMessageQueue } from "@bbn/integrations/fakes";
import { createLogger } from "@bbn/observability";
import { describe, expect, it } from "vitest";
import { processBatch, type Envelope } from "./consumer";

const silent = createLogger({}, () => undefined);
const env = (type: string, organizationId = "00000000-0000-4000-8000-000000000001"): Envelope => ({ type, organizationId, correlationId: "c1", payload: {} });

describe("processBatch", () => {
  it("acquitte après succès, ne rejoue pas", async () => {
    const q = new FakeMessageQueue(new ManualClock());
    await q.send("generation", env("noop"));
    const seen: string[] = [];
    const r = await processBatch(q, "generation", { noop: async (m) => void seen.push(m.type) }, silent);
    expect(r).toEqual({ acked: 1, failed: 0, unhandled: 0 });
    expect(q.depth("generation")).toBe(0);
  });

  it("n'acquitte pas en cas d'échec : relivraison puis DLQ", async () => {
    const clock = new ManualClock();
    const q = new FakeMessageQueue(clock, 2);
    await q.send("publishing", env("boom"));
    const handlers = { boom: async () => Promise.reject(new Error("x")) };
    for (let i = 0; i < 2; i++) {
      expect((await processBatch(q, "publishing", handlers, silent, { maxMessages: 1, visibilityTimeoutSeconds: 1 })).failed).toBe(1);
      clock.advanceSeconds(2);
    }
    await processBatch(q, "publishing", handlers, silent, { maxMessages: 1, visibilityTimeoutSeconds: 1 });
    expect(q.deadLetters("publishing")).toHaveLength(1);
  });

  it("refuse un message sans organisation explicite ou de type inconnu", async () => {
    const q = new FakeMessageQueue(new ManualClock());
    await q.send("generation", env("noop", ""));
    await q.send("generation", env("unknown"));
    const r = await processBatch(q, "generation", { noop: async () => undefined }, silent);
    expect(r).toEqual({ acked: 0, failed: 0, unhandled: 2 });
  });

  it("une double livraison appelle deux fois le handler (d'où l'exigence d'idempotence)", async () => {
    const q = new FakeMessageQueue(new ManualClock());
    await q.send("generation", env("count"));
    q.duplicateNext();
    let calls = 0;
    await processBatch(q, "generation", { count: async () => void (calls += 1) }, silent);
    expect(calls).toBe(2);
  });
});
