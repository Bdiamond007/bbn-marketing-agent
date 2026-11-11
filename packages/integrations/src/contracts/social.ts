import { describe, expect, it } from "vitest";
import type { PublishRequest, SocialPublisher } from "../social";

const media = { signedUrl: "fake-storage://b/k", descriptor: { mime: "image/jpeg", bytes: 200_000, width: 1080, height: 1080 } };

export function req(requestKey: string, overrides: Partial<PublishRequest> = {}): PublishRequest {
  return { connectionRef: { externalAccountId: "acct_1", secretRef: "secret://x" }, requestKey, caption: "Bonjour", media: [media], ...overrides };
}

export function socialPublisherContract(name: string, make: () => { publisher: SocialPublisher }) {
  describe(`SocialPublisher contract — ${name}`, () => {
    it("expose un manifeste de capacités versionné avec sa source", () => {
      const m = make().publisher.getCapabilities();
      expect(m.manifestVersion).toBeTruthy();
      expect(m.source).toBeTruthy();
    });

    it("rejette un média non conforme avant tout appel", async () => {
      const { publisher } = make();
      const out = await publisher.publish(req("k-media", { media: [{ ...media, descriptor: { ...media.descriptor, mime: "image/svg+xml" } }] }));
      expect(out).toMatchObject({ kind: "rejected", rejection: "media" });
    });

    it("publie et permet la réconciliation par requestKey", async () => {
      const { publisher } = make();
      const out = await publisher.publish(req("k-ok"));
      expect(out.kind === "confirmed" || out.kind === "processing").toBe(true);
      const rec = await publisher.reconcile({ connectionRef: req("k-ok").connectionRef, requestKey: "k-ok", externalRef: null });
      expect(rec.kind === "confirmed" || rec.kind === "processing").toBe(true);
    });

    it("après déconnexion, la publication est refusée pour permission", async () => {
      const { publisher } = make();
      await publisher.disconnect(req("x").connectionRef);
      expect(await publisher.publish(req("k-after-disconnect"))).toMatchObject({ kind: "rejected", rejection: "permission" });
    });
  });
}
