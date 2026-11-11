import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

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

/**
 * Générateur d'identifiants (préfixe + compteur). Avec `globallyUnique`, un segment aléatoire par instance
 * garantit l'unicité entre instances et redémarrages, comme les identifiants d'un vrai fournisseur
 * (obligatoire pour tout identifiant persisté en base : événements, abonnements, clients…).
 */
export class SequentialIds {
  private n = 0;
  private readonly instance: string;
  constructor(private readonly prefix: string, globallyUnique = false) {
    this.instance = globallyUnique ? `${randomBytes(4).toString("hex")}_` : "";
  }
  next(): string {
    this.n += 1;
    return `${this.prefix}_${this.instance}${String(this.n).padStart(6, "0")}`;
  }
}
