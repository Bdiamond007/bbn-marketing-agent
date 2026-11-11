import { describe, expect, it } from "vitest";
import type { ObjectStorage } from "../storage";

export function objectStorageContract(name: string, make: () => { storage: ObjectStorage; advanceSeconds: (s: number) => void; verifyGet?: (url: string) => { ok: boolean } }) {
  describe(`ObjectStorage contract — ${name}`, () => {
    it("stocke, relit et supprime un objet avec empreinte sha256", async () => {
      const { storage } = make();
      const body = new TextEncoder().encode("hello");
      const head = await storage.putObject("org/a/media/1.png", body, "image/png");
      expect(head.bytes).toBe(5);
      expect(head.sha256).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
      expect((await storage.getObject("org/a/media/1.png"))?.body).toEqual(body);
      await storage.deleteObject("org/a/media/1.png");
      expect(await storage.headObject("org/a/media/1.png")).toBeNull();
    });

    it("refuse les clés dangereuses", async () => {
      const { storage } = make();
      await expect(storage.putObject("../escape", new Uint8Array(), "image/png")).rejects.toThrow();
    });

    it("refuse une durée d'URL signée hors bornes", async () => {
      const { storage } = make();
      await expect(storage.createSignedGetUrl("k", 0)).rejects.toThrow(RangeError);
      await expect(storage.createSignedGetUrl("k", 24 * 3600)).rejects.toThrow(RangeError);
    });

    it("produit des URLs signées qui expirent", async () => {
      const { storage, advanceSeconds, verifyGet } = make();
      if (!verifyGet) return;
      const url = await storage.createSignedGetUrl("org/a/x.png", 60);
      expect(verifyGet(url).ok).toBe(true);
      advanceSeconds(61);
      expect(verifyGet(url).ok).toBe(false);
    });
  });
}
