import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import type { Clock } from "@bbn/domain";
import { IdentityError, type IdentityProvider, type IdentityUser } from "./identity";

const CODE_TTL_MS = 15 * 60 * 1000;

interface Account {
  user: IdentityUser;
  salt: Buffer;
  hash: Buffer;
  verifyCodeHash: string | null;
  recovery: { codeHash: string; expiresAt: number } | null;
}

const h = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Identité simulée (AUTH_MODE=fake), interdite en production par @bbn/config.
 * Codes déterministes exposés via `outbox` pour les tests et la boîte email locale.
 */
export class FakeIdentityProvider implements IdentityProvider {
  private readonly accounts = new Map<string, Account>();
  private n = 0;
  /** Codes émis (ce qu'un vrai fournisseur enverrait par email). */
  readonly outbox: { email: string; kind: "verify" | "recovery"; code: string }[] = [];

  constructor(private readonly clock: Clock) {}

  async signUp(email: string, password: string) {
    const key = email.trim().toLowerCase();
    if (this.accounts.has(key)) throw new IdentityError("email_taken");
    if (password.length < 12) throw new IdentityError("weak_password");
    this.n += 1;
    const salt = randomBytes(16);
    const code = this.code();
    const user: IdentityUser = { subject: `fake-sub-${String(this.n).padStart(4, "0")}`, email: key, emailVerified: false };
    this.accounts.set(key, { user, salt, hash: scryptSync(password, salt, 32), verifyCodeHash: h(code), recovery: null });
    this.outbox.push({ email: key, kind: "verify", code });
    return { user: { ...user }, verificationCode: code };
  }

  async verifyEmail(email: string, code: string) {
    const a = this.accounts.get(email.trim().toLowerCase());
    if (!a || a.verifyCodeHash === null || a.verifyCodeHash !== h(code)) throw new IdentityError("invalid_code");
    a.verifyCodeHash = null;
    a.user.emailVerified = true;
    return { ...a.user };
  }

  async signIn(email: string, password: string) {
    const a = this.accounts.get(email.trim().toLowerCase());
    if (!a || !timingSafeEqual(scryptSync(password, a.salt, 32), a.hash)) throw new IdentityError("invalid_credentials");
    return { ...a.user };
  }

  async startRecovery(email: string) {
    const key = email.trim().toLowerCase();
    const a = this.accounts.get(key);
    if (!a) return;
    const code = this.code();
    a.recovery = { codeHash: h(code), expiresAt: this.clock.now().getTime() + CODE_TTL_MS };
    this.outbox.push({ email: key, kind: "recovery", code });
  }

  async completeRecovery(email: string, code: string, newPassword: string) {
    const a = this.accounts.get(email.trim().toLowerCase());
    if (!a || !a.recovery || a.recovery.codeHash !== h(code)) throw new IdentityError("invalid_code");
    if (this.clock.now().getTime() >= a.recovery.expiresAt) {
      a.recovery = null;
      throw new IdentityError("code_expired");
    }
    if (newPassword.length < 12) throw new IdentityError("weak_password");
    a.recovery = null; // usage unique
    a.salt = randomBytes(16);
    a.hash = scryptSync(newPassword, a.salt, 32);
  }

  private code(): string {
    // Déterministe pour les tests ; jamais utilisé hors AUTH_MODE=fake.
    this.n += 1;
    return String(100000 + ((this.n * 7919) % 900000));
  }
}
