/**
 * E05 — tests de service sur PostgreSQL réel (rôle runtime bbn_app), identité simulée.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import type {} from "../../test-utils/src/context";
import { ManualClock, ServiceError } from "@bbn/domain";
import { createPool, withTenant, withUser } from "@bbn/db";
import { FakeEmailSender } from "@bbn/integrations/fakes";
import { fakeMfaCode, FakeIdentityProvider } from "./fake-identity";
import * as S from "./sessions";
import * as T from "./team";

const { appUrl, migrationUrl } = inject("dbUrls");
const meta = { requestId: "test-request" };
const PW = "correct horse battery staple";
let pool: pg.Pool;
let clock: ManualClock;
let idp: FakeIdentityProvider;
let email: FakeEmailSender;
let deps: S.AuthDeps;

const uniq = (p: string) => `${p}.${randomUUID().slice(0, 8)}@example.test`;
const lastCode = (to: string) => {
  const m = email.inboxOf(to).at(-1);
  const code = m?.text.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error(`aucun code pour ${to}`);
  return code;
};
const lastInviteToken = (to: string) => {
  const m = email.inboxOf(to).at(-1);
  const t = m?.text.match(/token=([A-Za-z0-9_\-%]+)/)?.[1];
  if (!t) throw new Error(`aucune invitation pour ${to}`);
  return decodeURIComponent(t);
};
async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ServiceError) return e.code;
    throw e;
  }
  throw new Error("ServiceError attendue");
}

/** Crée un compte vérifié et connecté. */
async function verifiedUser(prefix: string) {
  const addr = uniq(prefix);
  const { userId } = await S.signUp(deps, { email: addr, password: PW, uiLocale: "fr-CA" });
  await S.verifyEmail(deps, { email: addr, code: lastCode(addr) });
  const { token, session } = await S.signIn(deps, { email: addr, password: PW });
  return { email: addr, userId, token, session };
}

beforeAll(() => {
  pool = createPool(appUrl, 4);
  clock = new ManualClock(new Date());
  idp = new FakeIdentityProvider(clock);
  email = new FakeEmailSender();
  deps = { pool, idp, email, clock, appBaseUrl: "http://localhost:3000" };
});
afterAll(async () => {
  await pool?.end();
});

describe("inscription, vérification, connexion (AUTH-01)", () => {
  it("un compte non vérifié peut se connecter mais ni créer d'organisation ni connecter un réseau", async () => {
    const addr = uniq("unverified");
    await S.signUp(deps, { email: addr, password: PW, uiLocale: "en-CA" });
    expect(email.inboxOf(addr).at(-1)?.subject).toBe("Your verification code");
    const { session } = await S.signIn(deps, { email: addr, password: PW });
    expect(session.emailVerified).toBe(false);
    expect(await code(T.createOrganization(deps, session, { name: "X", defaultLocale: "en-CA" }, meta))).toBe("email_not_verified");
    expect(() => T.assertCanConnectSocial(session)).toThrow(ServiceError);
    await S.verifyEmail(deps, { email: addr, code: lastCode(addr) });
    const again = await S.signIn(deps, { email: addr, password: PW });
    expect(again.session.emailVerified).toBe(true);
    expect(() => T.assertCanConnectSocial(again.session)).not.toThrow();
  });

  it("mot de passe faux ou faible et courriel déjà pris : erreurs stables", async () => {
    const u = await verifiedUser("creds");
    expect(await code(S.signIn(deps, { email: u.email, password: "wrong password!!" }))).toBe("invalid_credentials");
    expect(await code(S.signIn(deps, { email: uniq("nobody"), password: PW }))).toBe("invalid_credentials");
    expect(await code(S.signUp(deps, { email: uniq("weak"), password: "short", uiLocale: "fr-CA" }))).toBe("validation_failed");
    expect(await code(S.signUp(deps, { email: u.email.toUpperCase(), password: PW, uiLocale: "fr-CA" }))).toBe("conflict");
  });
});

describe("sessions", () => {
  it("seule l'empreinte du jeton est stockée ; déconnexion effective", async () => {
    const u = await verifiedUser("session");
    const stored = await withUser(pool, u.userId, async ({ client }) => (await client.query("SELECT token_hash FROM sessions WHERE id = $1", [u.session.sessionId])).rows[0].token_hash);
    expect(stored).toBe(S.hashToken(u.token));
    expect(stored).not.toContain(u.token);
    expect((await S.resolveSession(deps, u.token))?.userId).toBe(u.userId);
    await S.signOut(deps, u.session);
    expect(await S.resolveSession(deps, u.token)).toBeNull();
  });

  it("expiration d'inactivité (7 j) et jeton malformé", async () => {
    const u = await verifiedUser("idle");
    clock.advanceMs(S.SESSION_POLICY.standard.idleMs + 1000);
    expect(await S.resolveSession(deps, u.token)).toBeNull();
    expect(await S.resolveSession(deps, "short")).toBeNull();
    expect(await S.resolveSession(deps, null)).toBeNull();
  });

  it("l'activité prolonge l'inactivité sans dépasser l'expiration absolue", async () => {
    const u = await verifiedUser("sliding");
    const day = 24 * 3600 * 1000;
    for (let i = 0; i < 4; i++) {
      clock.advanceMs(6 * day);
      expect(await S.resolveSession(deps, u.token), `jour ${(i + 1) * 6}`).not.toBeNull();
    }
    clock.advanceMs(5 * day); // jour 29 : encore valide
    expect(await S.resolveSession(deps, u.token)).not.toBeNull();
    clock.advanceMs(day); // jour 30 : expiration absolue atteinte
    expect(await S.resolveSession(deps, u.token)).toBeNull();
  });

  it("le runtime ne peut pas s'attribuer un rôle interne", async () => {
    const u = await verifiedUser("escalate");
    await expect(withUser(pool, u.userId, ({ client }) => client.query("UPDATE users SET platform_role = 'super_admin' WHERE id = $1", [u.userId]))).rejects.toMatchObject({ code: "42501" });
    await expect(withUser(pool, u.userId, ({ client }) => client.query("UPDATE users SET auth_subject = 'x' WHERE id = $1", [u.userId]))).rejects.toMatchObject({ code: "42501" });
  });

  it("session privilégiée : courte, et toute action refusée avant la MFA", async () => {
    const u = await verifiedUser("staff");
    const admin = new pg.Client({ connectionString: migrationUrl });
    await admin.connect();
    expect((await admin.query("UPDATE users SET platform_role = 'support' WHERE id = $1", [u.userId])).rowCount).toBe(1);
    await admin.end();
    const { token, session } = await S.signIn(deps, { email: u.email, password: PW });
    expect(session.privileged).toBe(true);
    expect(session.expiresAt.getTime() - clock.now().getTime()).toBe(S.SESSION_POLICY.privileged.absoluteMs);
    expect(await code(T.createOrganization(deps, session, { name: "Staff org", defaultLocale: "fr-CA" }, meta))).toBe("mfa_required");
    expect(await code(S.verifySessionMfa(deps, session, "000000"))).toBe("validation_failed");
    const subject = (await new FakeIdentityProvider(clock).signUp(uniq("tmp"), PW)).user.subject; // sujet différent
    expect(await code(S.verifySessionMfa(deps, session, fakeMfaCode(subject)))).toBe("validation_failed");
    const own = (await idp.signIn(u.email, PW)).subject;
    await S.verifySessionMfa(deps, session, fakeMfaCode(own));
    const after = await S.resolveSession(deps, token);
    expect(after?.mfaVerified).toBe(true);
    await expect(T.createOrganization(deps, after!, { name: "Staff org", defaultLocale: "fr-CA" }, meta)).resolves.toBeTruthy();
  });
});

describe("récupération d'accès", () => {
  it("aucune énumération ; usage unique ; toutes les sessions révoquées", async () => {
    const before = email.mailbox.length;
    await S.startRecovery(deps, { email: uniq("ghost"), uiLocale: "fr-CA" });
    expect(email.mailbox.length).toBe(before);
    const u = await verifiedUser("recover");
    await S.startRecovery(deps, { email: u.email, uiLocale: "fr-CA" });
    const c = lastCode(u.email);
    await S.completeRecovery(deps, { email: u.email, code: c, newPassword: "a whole new passphrase" });
    expect(await S.resolveSession(deps, u.token)).toBeNull();
    expect(await code(S.completeRecovery(deps, { email: u.email, code: c, newPassword: "yet another passphrase" }))).toBe("validation_failed");
    await expect(S.signIn(deps, { email: u.email, password: "a whole new passphrase" })).resolves.toBeTruthy();
  });
});

describe("organisations, invitations et équipe (ORG-01)", () => {
  async function orgWithOwner() {
    const owner = await verifiedUser("owner");
    const { organizationId } = await T.createOrganization(deps, owner.session, { name: `Org ${randomUUID().slice(0, 4)} (fictive)`, defaultLocale: "fr-CA" }, meta);
    return { owner, organizationId };
  }
  async function join(organizationId: string, inviter: S.SessionInfo, role: "admin" | "editor" | "reviewer", prefix = role) {
    const u = await verifiedUser(prefix);
    await T.inviteMember(deps, inviter, organizationId, { email: u.email, role }, meta);
    await T.acceptInvitation(deps, u.session, lastInviteToken(u.email), meta);
    return u;
  }

  it("parcours complet d'invitation ; le jeton n'est jamais renvoyé par le service", async () => {
    const { owner, organizationId } = await orgWithOwner();
    const invitee = await verifiedUser("invitee");
    const res = await T.inviteMember(deps, owner.session, organizationId, { email: invitee.email, role: "editor" }, meta);
    expect(Object.keys(res).sort()).toEqual(["expiresAt", "invitationId"]);
    const mail = email.inboxOf(invitee.email).at(-1)!;
    expect(mail.locale).toBe("fr-CA");
    expect(mail.subject).toContain("Invitation à rejoindre");
    const token = lastInviteToken(invitee.email);

    const stranger = await verifiedUser("stranger");
    expect(await code(T.acceptInvitation(deps, stranger.session, token, meta))).toBe("invitation_email_mismatch");
    expect(await T.acceptInvitation(deps, invitee.session, token, meta)).toEqual({ organizationId, role: "editor" });
    expect(await code(T.acceptInvitation(deps, invitee.session, token, meta))).toBe("invitation_invalid");
    expect((await T.listMembers(deps, invitee.session, organizationId)).map((m) => m.role).sort()).toEqual(["editor", "owner"]);
    expect((await T.listMyOrganizations(deps, invitee.session)).map((o) => o.id)).toEqual([organizationId]);
  });

  it("invitation expirée après 7 jours, révoquée, ou jeton inconnu : refusée", async () => {
    const { owner, organizationId } = await orgWithOwner();
    const a = await verifiedUser("late");
    await T.inviteMember(deps, owner.session, organizationId, { email: a.email, role: "reviewer" }, meta);
    const token = lastInviteToken(a.email);
    clock.advanceMs(T.INVITATION_TTL_MS);
    const fresh = (await S.signIn(deps, { email: a.email, password: PW })).session;
    expect(await code(T.acceptInvitation(deps, fresh, token, meta))).toBe("invitation_expired");

    const ownerNow = (await S.signIn(deps, { email: owner.email, password: PW })).session;
    const b = await verifiedUser("revoked");
    const { invitationId } = await T.inviteMember(deps, ownerNow, organizationId, { email: b.email, role: "reviewer" }, meta);
    await T.revokeInvitation(deps, ownerNow, organizationId, invitationId, meta);
    expect(await code(T.acceptInvitation(deps, b.session, lastInviteToken(b.email), meta))).toBe("invitation_invalid");
    expect(await code(T.acceptInvitation(deps, b.session, "x".repeat(43), meta))).toBe("invitation_invalid");
  });

  it("une nouvelle invitation remplace l'ancienne pour le même courriel", async () => {
    const { owner, organizationId } = await orgWithOwner();
    const u = await verifiedUser("reinvite");
    await T.inviteMember(deps, owner.session, organizationId, { email: u.email, role: "reviewer" }, meta);
    const first = lastInviteToken(u.email);
    await T.inviteMember(deps, owner.session, organizationId, { email: u.email, role: "editor" }, meta);
    expect(await code(T.acceptInvitation(deps, u.session, first, meta))).toBe("invitation_invalid");
    expect((await T.acceptInvitation(deps, u.session, lastInviteToken(u.email), meta)).role).toBe("editor");
    expect(await code(T.inviteMember(deps, owner.session, organizationId, { email: u.email, role: "editor" }, meta))).toBe("conflict");
  });

  it("droits : éditeur n'invite pas ; admin n'attribue ni admin ni owner ; propriétaire non attribuable", async () => {
    const { owner, organizationId } = await orgWithOwner();
    const editor = await join(organizationId, owner.session, "editor");
    const admin = await join(organizationId, owner.session, "admin");
    expect(await code(T.inviteMember(deps, editor.session, organizationId, { email: uniq("x"), role: "reviewer" }, meta))).toBe("forbidden");
    expect(await code(T.inviteMember(deps, admin.session, organizationId, { email: uniq("x"), role: "admin" }, meta))).toBe("forbidden");
    expect(await code(T.inviteMember(deps, owner.session, organizationId, { email: uniq("x"), role: "owner" }, meta))).toBe("forbidden");
    expect(await code(T.changeMemberRole(deps, admin.session, organizationId, owner.userId, "reviewer", meta))).toBe("forbidden");
    await T.changeMemberRole(deps, admin.session, organizationId, editor.userId, "reviewer", meta);
    expect((await T.listMembers(deps, owner.session, organizationId)).find((m) => m.userId === editor.userId)?.role).toBe("reviewer");
  });

  it("non-membre : réponse not_found, sans révéler l'existence de l'organisation", async () => {
    const { organizationId } = await orgWithOwner();
    const outsider = await verifiedUser("outsider");
    expect(await code(T.listMembers(deps, outsider.session, organizationId))).toBe("not_found");
    expect(await code(T.listMembers(deps, outsider.session, randomUUID()))).toBe("not_found");
  });

  it("dernier propriétaire protégé ; révocation d'un membre effective immédiatement", async () => {
    const { owner, organizationId } = await orgWithOwner();
    expect(await code(T.removeMember(deps, owner.session, organizationId, owner.userId, meta))).toBe("last_owner_protected");
    const editor = await join(organizationId, owner.session, "editor");
    expect(await T.listMembers(deps, editor.session, organizationId)).toHaveLength(2);
    await T.removeMember(deps, owner.session, organizationId, editor.userId, meta);
    // même session, requête suivante : refusée
    expect(await code(T.listMembers(deps, editor.session, organizationId))).toBe("not_found");
  });

  it("transfert de propriété : réauthentification exigée, rôles permutés, audit", async () => {
    const { owner, organizationId } = await orgWithOwner();
    const admin = await join(organizationId, owner.session, "admin");
    expect(await code(T.transferOwnership(deps, owner.session, organizationId, admin.userId, meta))).toBe("reauth_required");
    expect(await code(S.reauthenticate(deps, owner.session, "not my password!"))).toBe("invalid_credentials");
    await S.reauthenticate(deps, owner.session, PW);
    const fresh = (await S.resolveSession(deps, owner.token))!;
    clock.advanceMs(S.SESSION_POLICY.reauthWindowMs + 1);
    expect(await code(T.transferOwnership(deps, fresh, organizationId, admin.userId, meta))).toBe("reauth_required");
    await S.reauthenticate(deps, fresh, PW);
    await T.transferOwnership(deps, (await S.resolveSession(deps, owner.token))!, organizationId, admin.userId, meta);
    const roles = Object.fromEntries((await T.listMembers(deps, admin.session, organizationId)).map((m) => [m.userId, m.role]));
    expect(roles).toEqual({ [admin.userId]: "owner", [owner.userId]: "admin" });
    const actions = await withTenant(pool, { organizationId, userId: null }, async ({ client }) =>
      (await client.query<{ action: string }>("SELECT action FROM audit_events ORDER BY id")).rows.map((r) => r.action),
    );
    expect(actions).toEqual(expect.arrayContaining(["organization.created", "invitation.created", "invitation.accepted", "organization.ownership_transferred"]));
  });
});
