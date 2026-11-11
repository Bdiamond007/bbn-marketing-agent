import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function hmacHex(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
}

/** Générateur d'identifiants déterministe (préfixe + compteur). */
export class SequentialIds {
  private n = 0;
  constructor(private readonly prefix: string) {}
  next(): string {
    this.n += 1;
    return `${this.prefix}_${String(this.n).padStart(6, "0")}`;
  }
}
