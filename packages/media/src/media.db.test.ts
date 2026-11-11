/** E10 — médias privés sur PostgreSQL réel, stockage et antivirus simulés, vraies images (sharp). */
import { randomUUID } from "node:crypto";
import type pg from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "../../test-utils/src/context";
import { createOrganization, FakeIdentityProvider, signIn, signUp, verifyEmail, type SessionInfo } from "@bbn/auth";
import { createPool, withTenant } from "@bbn/db";
import { ManualClock, ServiceError } from "@bbn/domain";
import { EICAR_TEST_STRING, FakeEmailSender, FakeMalwareScanner, FakeObjectStorage } from "@bbn/integrations/fakes";
import { assertMediaPublishable, cleanupOrphanUploads, completeUpload, createUpload, listMedia, mediaViewUrl, type MediaDeps } from "./service";

const PW = "correct horse battery staple";
const meta = { requestId: "media-test" };
let pool: pg.Pool;
let clock: ManualClock;
let email: FakeEmailSender;
let storage: FakeObjectStorage;
let deps: MediaDeps;

async function reason(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ServiceError) return String(e.details?.reason ?? e.code);
    throw e;
  }
  throw new Error("ServiceError attendue");
}
async function org(): Promise<{ session: SessionInfo; orgId: string }> {
  const addr = `media.${randomUUID().slice(0, 8)}@example.test`;
  await signUp(deps, { email: addr, password: PW, uiLocale: "fr-CA" });
  await verifyEmail(deps, { email: addr, code: email.inboxOf(addr).at(-1)!.text.match(/\d{6}/)![0] });
  const { session } = await signIn(deps, { email: addr, password: PW });
  const { organizationId } = await createOrganization(deps, session, { name: "Médias (fictive)", defaultLocale: "fr-CA" }, meta);
  return { session, orgId: organizationId };
}
/** Simule l'envoi direct du navigateur vers l'URL signée. */
async function put(url: string, body: Uint8Array) {
  const v = storage.verifySignedUrl(url, "PUT");
  if (!v.ok) throw new Error(`url refusée: ${v.reason}`);
  await storage.putObject(v.key, body, v.contentType ?? "application/octet-stream");
}
async function upload(o: { session: SessionInfo; orgId: string }, body: Uint8Array, declared: string) {
  const u = await createUpload(deps, o.session, o.orgId, { contentType: declared, bytes: body.byteLength }, meta);
  await put(u.uploadUrl, body);
  return completeUpload(deps, o.session, o.orgId, u.assetId, { rightsStatus: "declared_owned" }, meta);
}
const img = (format: "jpeg" | "png" | "webp", w = 1200, h = 900) => sharp({ create: { width: w, height: h, channels: 3, background: "#d4af37" } })[format]().toBuffer();

beforeAll(() => {
  clock = new ManualClock(new Date());
  pool = createPool(inject("dbUrls").appUrl, 4);
  email = new FakeEmailSender();
  storage = new FakeObjectStorage(clock);
  deps = { pool, idp: new FakeIdentityProvider(clock), email, clock, appBaseUrl: "http://localhost:3000", storage, scanner: new FakeMalwareScanner(), simulation: false };
});
afterAll(async () => {
  await pool?.end();
});

describe("validation du contenu réel (MEDIA-01)", () => {
  it.each(["jpeg", "png", "webp"] as const)("vrai %s : accepté, réencodé, dimensions et empreinte enregistrées", async (format) => {
    const o = await org();
    const m = await upload(o, await img(format), `image/${format}`);
    expect(m).toMatchObject({ status: "ready", mime: `image/${format}`, width: 1200, height: 900, rightsStatus: "declared_owned" });
  });

  it("faux MIME (PNG déclaré JPEG), SVG et fichier non image : refusés et non publiables", async () => {
    const o = await org();
    expect((await upload(o, await img("png"), "image/jpeg")).rejectedReason).toBe("mime_mismatch");
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
    expect((await upload(o, svg, "image/png")).rejectedReason).toBe("unsupported_type");
    const bad = await upload(o, Buffer.from("not an image at all"), "image/jpeg");
    expect([bad.status, bad.rejectedReason]).toEqual(["rejected", "corrupt"]);
    expect(await reason(withTenant(pool, { organizationId: o.orgId, userId: null }, ({ client }) => assertMediaPublishable(client, [bad.id])))).toBe("media_not_publishable");
  });

  it("type déclaré non autorisé ou taille hors bornes : refusés avant tout envoi", async () => {
    const o = await org();
    expect(await reason(createUpload(deps, o.session, o.orgId, { contentType: "image/svg+xml", bytes: 100 }, meta))).toBe("unsupported_type");
    expect(await reason(createUpload(deps, o.session, o.orgId, { contentType: "image/png", bytes: 20 * 1024 * 1024 + 1 }, meta))).toBe("too_large");
  });

  it("trop de pixels (bombe de décompression) : refusé", async () => {
    const o = await org();
    const huge = await sharp({ create: { width: 9000, height: 9000, channels: 3, background: "#000" } }).png({ compressionLevel: 9 }).toBuffer();
    expect(huge.byteLength).toBeLessThan(20 * 1024 * 1024);
    expect((await upload(o, huge, "image/png")).rejectedReason).toBe("too_many_pixels");
  });

  it("antivirus : fichier de test EICAR refusé", async () => {
    const o = await org();
    const infected = Buffer.concat([await img("jpeg"), Buffer.from(EICAR_TEST_STRING)]);
    expect((await upload(o, infected, "image/jpeg")).rejectedReason).toBe("malware");
  });

  it("métadonnées supprimées au réencodage (EXIF) et orientation appliquée", async () => {
    const o = await org();
    const withExif = await sharp({ create: { width: 800, height: 400, channels: 3, background: "#fff" } }).jpeg().withMetadata({ orientation: 6, exif: { IFD0: { Copyright: "Secret GPS owner" } } }).toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const m = await upload(o, withExif, "image/jpeg");
    expect([m.width, m.height]).toEqual([400, 800]); // rotation EXIF appliquée
    const key = storage.verifySignedUrl((await mediaViewUrl(deps, o.session, o.orgId, m.id)).url, "GET");
    if (!key.ok) throw new Error("url");
    const stored = await storage.getObject(key.key);
    const meta2 = await sharp(stored!.body).metadata();
    expect(meta2.exif).toBeUndefined();
    expect(Buffer.from(stored!.body).includes("Secret GPS owner")).toBe(false);
  });
});

describe("droits, isolation, URL et cycle de vie", () => {
  it("déclaration de droits obligatoire ; média en quarantaine non publiable ; envoi manquant signalé", async () => {
    const o = await org();
    const u = await createUpload(deps, o.session, o.orgId, { contentType: "image/png", bytes: 1000 }, meta);
    expect(await reason(completeUpload(deps, o.session, o.orgId, u.assetId, { rightsStatus: "undeclared" as never }, meta))).toBe("validation_failed");
    expect(await reason(withTenant(pool, { organizationId: o.orgId, userId: null }, ({ client }) => assertMediaPublishable(client, [u.assetId])))).toBe("media_not_publishable");
    expect(await reason(completeUpload(deps, o.session, o.orgId, u.assetId, { rightsStatus: "declared_owned" }, meta))).toBe("upload_missing");
  });

  it("isolation : une autre organisation ne voit, ne finalise ni n'obtient d'URL, et ne peut pas publier ce média", async () => {
    const a = await org();
    const b = await org();
    const m = await upload(a, await img("jpeg"), "image/jpeg");
    expect(await reason(mediaViewUrl(deps, b.session, a.orgId, m.id))).toBe("not_found");
    expect(await reason(mediaViewUrl(deps, b.session, b.orgId, m.id))).toBe("not_found");
    expect((await listMedia(deps, b.session, b.orgId)).map((x) => x.id)).not.toContain(m.id);
    expect(await reason(withTenant(pool, { organizationId: b.orgId, userId: null }, ({ client }) => assertMediaPublishable(client, [m.id])))).toBe("media_not_publishable");
    await withTenant(pool, { organizationId: a.orgId, userId: null }, ({ client }) => assertMediaPublishable(client, [m.id]));
  });

  it("URL de consultation signée : valide 5 minutes puis expirée ; clé du tenant", async () => {
    const o = await org();
    const m = await upload(o, await img("webp"), "image/webp");
    const { url, expiresInSeconds } = await mediaViewUrl(deps, o.session, o.orgId, m.id);
    expect(expiresInSeconds).toBe(300);
    const v = storage.verifySignedUrl(url, "GET");
    expect(v.ok && v.key.startsWith(`org/${o.orgId}/media/`)).toBe(true);
    clock.advanceSeconds(301);
    expect(storage.verifySignedUrl(url, "GET")).toEqual({ ok: false, reason: "expired" });
  });

  it("orphelins : téléversement abandonné plus de 24 h ⇒ objet supprimé et ligne marquée", async () => {
    const o = await org();
    const u = await createUpload(deps, o.session, o.orgId, { contentType: "image/png", bytes: 500 }, meta);
    await put(u.uploadUrl, await img("png", 10, 10));
    const sizeBefore = storage.size;
    clock.advanceMs(25 * 3600 * 1000);
    expect(await cleanupOrphanUploads({ pool, storage, clock })).toBeGreaterThanOrEqual(1);
    expect(storage.size).toBeLessThan(sizeBefore);
    expect(await reason(completeUpload(deps, (await signIn(deps, { email: o.session.email, password: PW })).session, o.orgId, u.assetId, { rightsStatus: "declared_owned" }, meta))).toBe("media_not_in_quarantine");
  });
});
