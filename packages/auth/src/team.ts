import { randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import { assignableRoles, authorize, canManageMember, ServiceError, type Action, type MemberRole } from "@bbn/domain";
import { createOrganizationWithOwner, TenantAccessDenied, withTenant, withUser, type Tx } from "@bbn/db";
import { segmentFromLocale, type Locale } from "@bbn/i18n";
import { renderEmail } from "./emails";
import { hashToken, requireMfaIfPrivileged, requireRecentReauth, type AuthDeps, type SessionInfo } from "./sessions";

export const INVITATION_TTL_MS = 7 * 24 * 3600 * 1000;

export interface RequestMeta {
  requestId: string;
}

async function audit(client: pg.PoolClient, organizationId: string, actorId: string | null, action: string, target: { type: string; id: string }, meta: RequestMeta, safe: Record<string, unknown> = {}) {
  await client.query(
    `INSERT INTO audit_events (organization_id, actor_id, actor_kind, action, target_type, target_id, safe_metadata, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [organizationId, actorId, actorId ? "user" : "system", action, target.type, target.id, JSON.stringify(safe), meta.requestId],
  );
}

/**
 * Ouvre une transaction tenant pour un membre et vérifie l'action via le moteur de droits.
 * Non-membre ⇒ not_found (on ne révèle pas l'existence de l'organisation, §11).
 */
export async function asMember<T>(
  deps: AuthDeps,
  session: SessionInfo,
  organizationId: string,
  action: Action,
  fn: (tx: Tx, role: MemberRole) => Promise<T>,
): Promise<T> {
  requireMfaIfPrivileged(session);
  try {
    return await withTenant(deps.pool, { organizationId, userId: session.userId }, async (tx) => {
      const role = (await tx.client.query<{ role: MemberRole }>("SELECT role FROM memberships WHERE organization_id = $1 AND user_id = $2", [organizationId, session.userId])).rows[0]?.role;
      if (!role) throw new TenantAccessDenied();
      const d = authorize(
        { userId: session.userId, emailVerified: session.emailVerified, membershipRole: role, platformRole: session.platformRole, mfaVerified: session.mfaVerified, staffAssignments: [], supportGrants: [] },
        action,
        { organizationId },
        deps.clock.now(),
      );
      if (!d.allowed) throw new ServiceError(d.reason === "unverified_email" ? "email_not_verified" : "forbidden", { action });
      return fn(tx, role);
    });
  } catch (e) {
    if (e instanceof TenantAccessDenied) throw new ServiceError("not_found");
    if (typeof e === "object" && e && "message" in e && String((e as Error).message).includes("last_owner_protected")) throw new ServiceError("last_owner_protected");
    throw e;
  }
}

export async function createOrganization(deps: AuthDeps, session: SessionInfo, input: { name: string; defaultLocale: Locale }, meta: RequestMeta): Promise<{ organizationId: string }> {
  requireMfaIfPrivileged(session);
  if (!session.emailVerified) throw new ServiceError("email_not_verified");
  const name = input.name.trim();
  if (name.length < 1 || name.length > 200) throw new ServiceError("validation_failed", { field: "name" });
  const organizationId = randomUUID();
  await createOrganizationWithOwner(deps.pool, { organizationId, ownerUserId: session.userId, name, defaultLocale: input.defaultLocale });
  await withTenant(deps.pool, { organizationId, userId: session.userId }, ({ client }) =>
    audit(client, organizationId, session.userId, "organization.created", { type: "organization", id: organizationId }, meta),
  );
  return { organizationId };
}

export async function listMyOrganizations(deps: AuthDeps, session: SessionInfo): Promise<{ id: string; name: string; role: MemberRole }[]> {
  return withUser(deps.pool, session.userId, async ({ client }) =>
    (
      await client.query<{ id: string; name: string; role: MemberRole }>(
        "SELECT o.id, o.name, m.role FROM memberships m JOIN organizations o ON o.id = m.organization_id WHERE m.user_id = $1 ORDER BY o.name",
        [session.userId],
      )
    ).rows,
  );
}

export async function listMembers(deps: AuthDeps, session: SessionInfo, organizationId: string) {
  return asMember(deps, session, organizationId, "team.read", async ({ client }) =>
    (
      await client.query<{ user_id: string; email: string; role: MemberRole }>(
        "SELECT m.user_id, u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.organization_id = $1 ORDER BY u.email",
        [organizationId],
      )
    ).rows.map((r) => ({ userId: r.user_id, email: r.email, role: r.role })),
  );
}

export async function inviteMember(
  deps: AuthDeps,
  session: SessionInfo,
  organizationId: string,
  input: { email: string; role: MemberRole },
  meta: RequestMeta,
): Promise<{ invitationId: string; expiresAt: Date }> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ServiceError("validation_failed", { field: "email" });
  const token = randomBytes(32).toString("base64url");
  const now = deps.clock.now();
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
  const { invitationId, orgName, locale } = await asMember(deps, session, organizationId, "team.invite", async ({ client }, role) => {
    if (!assignableRoles(role).includes(input.role)) throw new ServiceError("forbidden", { role: input.role });
    const already = await client.query("SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.organization_id = $1 AND u.email = $2", [organizationId, email]);
    if (already.rowCount) throw new ServiceError("conflict", { reason: "already_member" });
    // Une seule invitation en attente : l'ancienne (même expirée) est révoquée.
    await client.query("UPDATE invitations SET revoked_at = $3 WHERE organization_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL", [organizationId, email, now]);
    const id = randomUUID();
    await client.query(
      "INSERT INTO invitations (id, organization_id, email, role, token_hash, invited_by, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [id, organizationId, email, input.role, hashToken(token), session.userId, now, expiresAt],
    );
    await audit(client, organizationId, session.userId, "invitation.created", { type: "invitation", id }, meta, { role: input.role });
    const org = (await client.query<{ name: string; default_locale: Locale }>("SELECT name, default_locale FROM organizations WHERE id = $1", [organizationId])).rows[0]!;
    return { invitationId: id, orgName: org.name, locale: org.default_locale };
  });
  const link = `${deps.appBaseUrl}/${segmentFromLocale(locale)}/invitations/accept?token=${encodeURIComponent(token)}`;
  const m = renderEmail(locale, "invitation", { organization: orgName, link });
  // Le jeton ne quitte le serveur que par ce courriel ; il n'est jamais renvoyé par l'API.
  await deps.email.send({ to: email, locale, templateKey: "team.invitation", templateVersion: 1, ...m, idempotencyKey: `invitation:${invitationId}` });
  return { invitationId, expiresAt };
}

interface InvitationRow {
  invitation_id: string;
  organization_id: string;
  email: string;
  role: MemberRole;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
}

export async function acceptInvitation(deps: AuthDeps, session: SessionInfo, token: string, meta: RequestMeta): Promise<{ organizationId: string; role: MemberRole }> {
  requireMfaIfPrivileged(session);
  if (!session.emailVerified) throw new ServiceError("email_not_verified");
  if (typeof token !== "string" || token.length < 32 || token.length > 128) throw new ServiceError("invitation_invalid");
  const inv = (await deps.pool.query<InvitationRow>("SELECT * FROM auth_invitation_by_token($1)", [hashToken(token)])).rows[0];
  if (!inv || inv.accepted_at || inv.revoked_at) throw new ServiceError("invitation_invalid");
  const now = deps.clock.now();
  if (now >= inv.expires_at) throw new ServiceError("invitation_expired");
  if (inv.email !== session.email.toLowerCase()) throw new ServiceError("invitation_email_mismatch");
  // Contexte système de l'organisation invitante (l'invité n'est pas encore membre), sous verrou.
  await withTenant(deps.pool, { organizationId: inv.organization_id, userId: null }, async ({ client }) => {
    const locked = await client.query(
      "SELECT 1 FROM invitations WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > $2 FOR UPDATE",
      [inv.invitation_id, now],
    );
    if (!locked.rowCount) throw new ServiceError("invitation_invalid");
    await client.query("INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (organization_id, user_id) DO NOTHING", [
      inv.organization_id, session.userId, inv.role,
    ]);
    await client.query("UPDATE invitations SET accepted_at = $2 WHERE id = $1", [inv.invitation_id, now]);
    await audit(client, inv.organization_id, session.userId, "invitation.accepted", { type: "invitation", id: inv.invitation_id }, meta, { role: inv.role });
  });
  return { organizationId: inv.organization_id, role: inv.role };
}

export async function revokeInvitation(deps: AuthDeps, session: SessionInfo, organizationId: string, invitationId: string, meta: RequestMeta): Promise<void> {
  await asMember(deps, session, organizationId, "team.invite", async ({ client }) => {
    const r = await client.query("UPDATE invitations SET revoked_at = $2 WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL", [invitationId, deps.clock.now()]);
    if (!r.rowCount) throw new ServiceError("not_found");
    await audit(client, organizationId, session.userId, "invitation.revoked", { type: "invitation", id: invitationId }, meta);
  });
}

async function targetRole(client: pg.PoolClient, organizationId: string, userId: string): Promise<MemberRole> {
  const r = (await client.query<{ role: MemberRole }>("SELECT role FROM memberships WHERE organization_id = $1 AND user_id = $2 FOR UPDATE", [organizationId, userId])).rows[0];
  if (!r) throw new ServiceError("not_found");
  return r.role;
}

export async function changeMemberRole(deps: AuthDeps, session: SessionInfo, organizationId: string, targetUserId: string, role: MemberRole, meta: RequestMeta): Promise<void> {
  await asMember(deps, session, organizationId, "team.change_role", async ({ client }, actorRole) => {
    if (targetUserId === session.userId) throw new ServiceError("business_rule", { reason: "use_transfer_or_leave" });
    const current = await targetRole(client, organizationId, targetUserId);
    if (!canManageMember(actorRole, current) || !assignableRoles(actorRole).includes(role)) throw new ServiceError("forbidden");
    await client.query("UPDATE memberships SET role = $3, updated_at = $4 WHERE organization_id = $1 AND user_id = $2", [organizationId, targetUserId, role, deps.clock.now()]);
    await audit(client, organizationId, session.userId, "member.role_changed", { type: "user", id: targetUserId }, meta, { from: current, to: role });
  });
}

/** Retrait (ou départ volontaire). Effet immédiat : la prochaine requête du membre retiré est refusée. */
export async function removeMember(deps: AuthDeps, session: SessionInfo, organizationId: string, targetUserId: string, meta: RequestMeta): Promise<void> {
  const self = targetUserId === session.userId;
  await asMember(deps, session, organizationId, self ? "org.read" : "team.remove", async ({ client }, actorRole) => {
    const current = await targetRole(client, organizationId, targetUserId);
    if (!self && !canManageMember(actorRole, current)) throw new ServiceError("forbidden");
    await client.query("DELETE FROM memberships WHERE organization_id = $1 AND user_id = $2", [organizationId, targetUserId]);
    await audit(client, organizationId, session.userId, self ? "member.left" : "member.removed", { type: "user", id: targetUserId }, meta, { role: current });
  });
}

/** Transfert de propriété : réauthentification récente exigée ; promotion et rétrogradation atomiques. */
export async function transferOwnership(deps: AuthDeps, session: SessionInfo, organizationId: string, newOwnerUserId: string, meta: RequestMeta): Promise<void> {
  requireRecentReauth(session, deps.clock.now());
  await asMember(deps, session, organizationId, "org.transfer", async ({ client }) => {
    if (newOwnerUserId === session.userId) throw new ServiceError("business_rule", { reason: "already_owner" });
    const current = await targetRole(client, organizationId, newOwnerUserId);
    const now = deps.clock.now();
    await client.query("UPDATE memberships SET role = 'owner', updated_at = $3 WHERE organization_id = $1 AND user_id = $2", [organizationId, newOwnerUserId, now]);
    await client.query("UPDATE memberships SET role = 'admin', updated_at = $3 WHERE organization_id = $1 AND user_id = $2", [organizationId, session.userId, now]);
    await audit(client, organizationId, session.userId, "organization.ownership_transferred", { type: "user", id: newOwnerUserId }, meta, { previousRole: current });
  });
}

/** Un compte au courriel non vérifié ne connecte pas de réseau réel (AUTH-01, §5). */
export function assertCanConnectSocial(session: SessionInfo): void {
  requireMfaIfPrivileged(session);
  if (!session.emailVerified) throw new ServiceError("email_not_verified");
}
