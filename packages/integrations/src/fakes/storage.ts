import type { Clock } from "@bbn/domain";
import { MAX_SIGNED_URL_TTL_SECONDS, type ObjectStorage, type StoredObjectHead } from "../storage";
import { hmacHex, safeEqualHex, sha256Hex } from "./util";

const SIGNING_SECRET = "fake-storage-local-signing-key";

/** Stockage objet privé simulé, en mémoire. URLs signées vérifiables et expirantes. */
export class FakeObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, { head: StoredObjectHead; body: Uint8Array }>();
  constructor(private readonly clock: Clock, private readonly bucket = "fake-private-bucket") {}

  async putObject(key: string, body: Uint8Array, contentType: string): Promise<StoredObjectHead> {
    assertKey(key);
    const head = { key, contentType, bytes: body.byteLength, sha256: sha256Hex(body) };
    this.objects.set(key, { head, body: new Uint8Array(body) });
    return head;
  }
  async getObject(key: string) {
    const o = this.objects.get(key);
    return o ? { head: { ...o.head }, body: new Uint8Array(o.body) } : null;
  }
  async headObject(key: string) {
    const o = this.objects.get(key);
    return o ? { ...o.head } : null;
  }
  async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
  }
  async createSignedGetUrl(key: string, ttlSeconds: number): Promise<string> {
    return this.sign("GET", key, ttlSeconds, {});
  }
  async createSignedPutUrl(key: string, opts: { contentType: string; maxBytes: number; ttlSeconds: number }): Promise<string> {
    return this.sign("PUT", key, opts.ttlSeconds, { ct: opts.contentType, max: String(opts.maxBytes) });
  }

  /** Vérifie une URL signée émise par ce simulateur (méthode, signature, expiration). */
  verifySignedUrl(url: string, method: "GET" | "PUT"): { ok: true; key: string } | { ok: false; reason: "expired" | "bad_signature" | "malformed" } {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return { ok: false, reason: "malformed" };
    }
    const key = decodeURIComponent(u.pathname.replace(/^\//, ""));
    const exp = Number(u.searchParams.get("exp"));
    const sig = u.searchParams.get("sig") ?? "";
    const extra = u.searchParams.get("x") ?? "";
    if (!Number.isFinite(exp) || u.host !== this.bucket) return { ok: false, reason: "malformed" };
    if (!safeEqualHex(sig, hmacHex(SIGNING_SECRET, `${method}\n${key}\n${exp}\n${extra}`))) return { ok: false, reason: "bad_signature" };
    if (this.clock.now().getTime() >= exp * 1000) return { ok: false, reason: "expired" };
    return { ok: true, key };
  }

  get size(): number {
    return this.objects.size;
  }

  private sign(method: "GET" | "PUT", key: string, ttlSeconds: number, extra: Record<string, string>): string {
    assertKey(key);
    if (!(ttlSeconds > 0 && ttlSeconds <= MAX_SIGNED_URL_TTL_SECONDS)) {
      throw new RangeError(`TTL d'URL signée hors bornes (1..${MAX_SIGNED_URL_TTL_SECONDS}s)`);
    }
    const exp = Math.floor(this.clock.now().getTime() / 1000) + ttlSeconds;
    const x = new URLSearchParams(extra).toString();
    const sig = hmacHex(SIGNING_SECRET, `${method}\n${key}\n${exp}\n${x}`);
    const q = new URLSearchParams({ exp: String(exp), sig, x });
    return `fake-storage://${this.bucket}/${encodeURIComponent(key)}?${q.toString()}`;
  }
}

function assertKey(key: string): void {
  if (key.length === 0 || key.startsWith("/") || key.includes("..")) throw new Error(`Clé de stockage invalide`);
}
