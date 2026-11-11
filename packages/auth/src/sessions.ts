import { createHash, randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import { ServiceError, type Clock, type PlatformRole } from "@bbn/domain";
import { withUser } from "@bbn/db";
import type { EmailSender } from "@bbn/integrations";
import { renderEmail } from "./emails";
import { IdentityError, type IdentityProvider } from "./identity";

export interface AuthDeps {
  pool: pg.Pool;
  idp: IdentityProvider;
  email: EmailSender;
  clock: Clock;
  appBaseUrl: string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Durées de session (ADR-0005). Les sessions privilégiées sont courtes et exigent la MFA. */
export const SESSION_POLICY = {
  standard: { absoluteMs: 30 * DAY, idleMs: 7 * DAY },
  privileged: { absoluteMs: 12 * HOUR, idleMs: 2 * HOUR },
  reauthWindowMs: 10 * MINUTE,
  touchIntervalMs: MINUTE,
} as const;

export interface SessionInfo {
  sessionId: string;
  userId: string;
  email: string;
  emailVerified: boolean;
  uiLocale: "fr-CA" | "en-CA";
  platformRole: PlatformRole | null;
  privileged: boolean;
  mfaVerified: boolean;
  reauthenticatedAt: Date | null;
  expiresAt: Date;
}

export const hashToken = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");
const normalizeEmail = (e: string): string => e.trim().toLowerCase();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function mapIdentity(e: unknown): never {
  if (e instanceof IdentityError) {
    switch (e.code) {
      case "invalid_credentials":
        throw new ServiceError("invalid_credentials");
      case "email_taken":
        throw new ServiceError("conflict", { field: "email" });
      case "weak_password":
        throw new ServiceError("validation_failed", { field: "password", rule: "min_length_12" });
      case "invalid_code":
      case "code_expired":
        throw new ServiceError("validation_failed", { field: "code" });
    }
  }
  throw e;
}

async function userIdBySubject(pool: pg.Pool, subject: string): Promise<string | null> {
  const r = await pool.query<{ id: string | null }>("SELECT auth_user_by_subject($1) AS id", [subject]);
  return r.rows[0]?.id ?? null;
}

export async function signUp(deps: AuthDeps, input: { email: string; password: string; uiLocale: "fr-CA" | "en-CA" }): Promise<{ userId: string }> {
  const email = normalizeEmail(input.email);
  if (!EMAIL.test(email)) throw new ServiceError("validation_failed", { field: "email" });
  const { user, verificationCode } = await deps.idp.signUp(email, input.password).catch(mapIdentity);
  const userId = randomUUID();
  await withUser(deps.pool, userId, ({ client }) =>
    client.query("INSERT INTO users (id, auth_subject, email, ui_locale) VALUES ($1, $2, $3, $4)", [userId, user.subject, email, input.uiLocale]),
  );
  if (verificationCode) {
    const m = renderEmail(input.uiLocale, "verifyEmail", { code: verificationCode });
    await deps.email.send({ to: email, locale: input.uiLocale, templateKey: "auth.verify_email", templateVersion: 1, ...m, idempotencyKey: `verify:${user.subject}:${hashToken(verificationCode).slice(0, 16)}` });
  }
  return { userId };
}

export async function verifyEmail(deps: AuthDeps, input: { email: string; code: string }): Promise<void> {
  const user = await deps.idp.verifyEmail(normalizeEmail(input.email), input.code).catch(mapIdentity);
  const userId = await userIdBySubject(deps.pool, user.subject);
  if (!userId) throw new ServiceError("validation_failed", { field: "code" });
  await withUser(deps.pool, userId, ({ client }) =>
    client.query("UPDATE users SET email_verified_at = COALESCE(email_verified_at, $2), updated_at = $2 WHERE id = $1", [userId, deps.clock.now()]),
  );
}

export async function signIn(deps: AuthDeps, input: { email: string; password: string }): Promise<{ token: string; session: SessionInfo }> {
  const identity = await deps.idp.signIn(normalizeEmail(input.email), input.password).catch(mapIdentity);
  const userId = await userIdBySubject(deps.pool, identity.subject);
  if (!userId) throw new ServiceError("invalid_credentials");
  const token = randomBytes(32).toString("base64url");
  const now = deps.clock.now();
  const ok = await withUser(deps.pool, userId, async ({ client }) => {
    const u = (await client.query<{ status: string; platform_role: PlatformRole | null }>("SELECT status, platform_role FROM users WHERE id = $1", [userId])).rows[0];
    if (!u || u.status !== "active") return false;
    const privileged = u.platform_role !== null;
    const policy = privileged ? SESSION_POLICY.privileged : SESSION_POLICY.standard;
    await client.query(
      `INSERT INTO sessions (token_hash, user_id, privileged, created_at, last_seen_at, idle_expires_at, expires_at)
       VALUES ($1, $2, $3, $4, $4, $5, $6)`,
      [hashToken(token), userId, privileged, now, new Date(now.getTime() + policy.idleMs), new Date(now.getTime() + policy.absoluteMs)],
    );
    return true;
  });
  if (!ok) throw new ServiceError("invalid_credentials");
  const session = await resolveSession(deps, token);
  if (!session) throw new ServiceError("session_invalid");
  return { token, session };
}

interface LookupRow {
  session_id: string;
  user_id: string;
  privileged: boolean;
  idle_expires_at: Date;
  expires_at: Date;
  mfa_verified_at: Date | null;
  reauthenticated_at: Date | null;
  revoked_at: Date | null;
  user_status: string;
  email_verified: boolean;
  platform_role: PlatformRole | null;
  ui_locale: "fr-CA" | "en-CA";
  email: string;
}

/** Résout un jeton de session ; renvoie null si absent, révoqué, expiré ou utilisateur inactif. */
export async function resolveSession(deps: AuthDeps, token: string | null | undefined): Promise<SessionInfo | null> {
  if (!token || token.length < 32 || token.length > 128) return null;
  const row = (await deps.pool.query<LookupRow>("SELECT * FROM auth_session_lookup($1)", [hashToken(token)])).rows[0];
  const now = deps.clock.now();
  if (!row || row.revoked_at || row.user_status !== "active" || now >= row.expires_at || now >= row.idle_expires_at) return null;
  const policy = row.privileged ? SESSION_POLICY.privileged : SESSION_POLICY.standard;
  const nextIdle = new Date(Math.min(now.getTime() + policy.idleMs, row.expires_at.getTime()));
  if (nextIdle.getTime() - row.idle_expires_at.getTime() >= SESSION_POLICY.touchIntervalMs) {
    await withUser(deps.pool, row.user_id, ({ client }) =>
      client.query("UPDATE sessions SET last_seen_at = $2, idle_expires_at = $3 WHERE id = $1 AND revoked_at IS NULL", [row.session_id, now, nextIdle]),
    );
  }
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    email: row.email,
    emailVerified: row.email_verified,
    uiLocale: row.ui_locale,
    platformRole: row.platform_role,
    privileged: row.privileged,
    mfaVerified: row.mfa_verified_at !== null,
    reauthenticatedAt: row.reauthenticated_at,
    expiresAt: row.expires_at,
  };
}

export async function signOut(deps: AuthDeps, session: SessionInfo): Promise<void> {
  await withUser(deps.pool, session.userId, ({ client }) =>
    client.query("UPDATE sessions SET revoked_at = $2, revoked_reason = 'sign_out' WHERE id = $1 AND revoked_at IS NULL", [session.sessionId, deps.clock.now()]),
  );
}

export async function revokeAllSessions(deps: AuthDeps, userId: string, reason: string): Promise<number> {
  return withUser(deps.pool, userId, async ({ client }) => {
    const r = await client.query("UPDATE sessions SET revoked_at = $2, revoked_reason = $3 WHERE user_id = $1 AND revoked_at IS NULL", [userId, deps.clock.now(), reason]);
    return r.rowCount ?? 0;
  });
}

/** Réauthentification pour les actions sensibles (transfert, suppression). */
export async function reauthenticate(deps: AuthDeps, session: SessionInfo, password: string): Promise<void> {
  await deps.idp.signIn(session.email, password).catch(mapIdentity);
  await withUser(deps.pool, session.userId, ({ client }) =>
    client.query("UPDATE sessions SET reauthenticated_at = $2 WHERE id = $1", [session.sessionId, deps.clock.now()]),
  );
}

export function requireRecentReauth(session: SessionInfo, now: Date): void {
  if (!session.reauthenticatedAt || now.getTime() - session.reauthenticatedAt.getTime() > SESSION_POLICY.reauthWindowMs) {
    throw new ServiceError("reauth_required");
  }
}

export async function verifySessionMfa(deps: AuthDeps, session: SessionInfo, code: string): Promise<void> {
  const subject = await withUser(deps.pool, session.userId, async ({ client }) => (await client.query<{ auth_subject: string }>("SELECT auth_subject FROM users WHERE id = $1", [session.userId])).rows[0]?.auth_subject);
  if (!subject || !(await deps.idp.verifyMfa(subject, code))) throw new ServiceError("validation_failed", { field: "code" });
  await withUser(deps.pool, session.userId, ({ client }) => client.query("UPDATE sessions SET mfa_verified_at = $2 WHERE id = $1", [session.sessionId, deps.clock.now()]));
}

/** Session privilégiée sans MFA validée : toute action est refusée (§4). */
export function requireMfaIfPrivileged(session: SessionInfo): void {
  if (session.privileged && !session.mfaVerified) throw new ServiceError("mfa_required");
}

export async function startRecovery(deps: AuthDeps, input: { email: string; uiLocale: "fr-CA" | "en-CA" }): Promise<void> {
  const email = normalizeEmail(input.email);
  if (!EMAIL.test(email)) return; // même réponse visible : pas d'énumération
  const { deliveryCode } = await deps.idp.startRecovery(email);
  if (deliveryCode) {
    const m = renderEmail(input.uiLocale, "recovery", { code: deliveryCode });
    await deps.email.send({ to: email, locale: input.uiLocale, templateKey: "auth.recovery", templateVersion: 1, ...m, idempotencyKey: `recovery:${hashToken(email + deliveryCode).slice(0, 24)}` });
  }
}

/** Récupération à usage unique ; toutes les sessions existantes sont révoquées. */
export async function completeRecovery(deps: AuthDeps, input: { email: string; code: string; newPassword: string }): Promise<void> {
  const { subject } = await deps.idp.completeRecovery(normalizeEmail(input.email), input.code, input.newPassword).catch(mapIdentity);
  const userId = await userIdBySubject(deps.pool, subject);
  if (userId) await revokeAllSessions(deps, userId, "password_recovery");
}
