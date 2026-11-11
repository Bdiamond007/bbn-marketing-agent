/**
 * Moteur de droits serveur (SPECIFICATION §4) — module pur, sans E/S.
 * Appelé sur chaque requête serveur et chaque job ; aucun contrôle masqué côté client ne le remplace.
 * Refus par défaut : toute action non listée explicitement pour un rôle est refusée.
 */

export const MEMBER_ROLES = ["owner", "admin", "editor", "reviewer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const PLATFORM_ROLES = ["producer", "account_manager", "support", "platform_admin", "super_admin"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const ACTIONS = [
  "org.read",
  "org.update",
  "org.delete",
  "org.transfer",
  "team.read",
  "team.invite",
  "team.change_role",
  "team.remove",
  "billing.read",
  "billing.manage",
  "brand.read",
  "brand.edit",
  "media.upload",
  "content.read",
  "content.edit",
  "content.comment",
  "content.internal_review",
  "content.approve",
  "publication.schedule",
  "publication.cancel",
  "connection.manage",
  "report.read",
  "privacy.export",
  "privacy.delete",
] as const;
export type Action = (typeof ACTIONS)[number];

const READ: Action[] = ["org.read", "team.read", "brand.read", "content.read", "report.read"];

const MEMBER_MATRIX: Record<MemberRole, ReadonlySet<Action>> = {
  owner: new Set<Action>([...ACTIONS]),
  admin: new Set<Action>([
    ...READ,
    "org.update",
    "team.invite",
    "team.change_role",
    "team.remove",
    "billing.read",
    "brand.edit",
    "media.upload",
    "content.edit",
    "content.comment",
    "content.approve",
    "publication.schedule",
    "publication.cancel",
    "connection.manage",
  ]),
  editor: new Set<Action>([...READ, "brand.edit", "media.upload", "content.edit", "content.comment"]),
  reviewer: new Set<Action>([...READ, "content.comment", "content.approve"]),
};

/** Producteur interne : marques affectées seulement ; jamais l'approbation client. */
const PRODUCER_ACTIONS = new Set<Action>(["brand.read", "content.read", "content.edit", "content.comment", "content.internal_review", "report.read"]);
/** Gestionnaire de compte : suivi des affectations, lecture. */
const ACCOUNT_MANAGER_ACTIONS = new Set<Action>(["brand.read", "content.read", "report.read"]);
/** Support : métadonnées par défaut ; contenu seulement avec un accès de portée « content ». */
const SUPPORT_METADATA_ACTIONS = new Set<Action>(["org.read", "team.read", "report.read"]);
const SUPPORT_CONTENT_ACTIONS = new Set<Action>([...SUPPORT_METADATA_ACTIONS, "brand.read", "content.read"]);

export interface StaffAssignmentFact {
  organizationId: string;
  brandId: string;
  role: "producer" | "account_manager";
  validFrom: Date;
  validUntil: Date;
}

export interface SupportGrantFact {
  organizationId: string;
  scope: "metadata" | "content";
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface Principal {
  userId: string;
  emailVerified: boolean;
  /** Rôle dans l'organisation de la ressource (null si non membre). */
  membershipRole: MemberRole | null;
  platformRole: PlatformRole | null;
  /** MFA validée sur la session courante. */
  mfaVerified: boolean;
  staffAssignments: readonly StaffAssignmentFact[];
  supportGrants: readonly SupportGrantFact[];
}

export interface Resource {
  organizationId: string;
  brandId?: string;
}

export type Decision =
  | { allowed: true; via: "membership" | "staff_assignment" | "support_grant" }
  | { allowed: false; reason: "not_member" | "role_forbidden" | "mfa_required" | "assignment_missing" | "grant_missing" | "unverified_email" };

/** Actions exigeant une adresse courriel vérifiée (§5 : un compte non vérifié ne connecte pas de réseau réel). */
const REQUIRES_VERIFIED_EMAIL = new Set<Action>(["connection.manage", "publication.schedule", "billing.manage", "team.invite", "org.transfer"]);

export function authorize(p: Principal, action: Action, resource: Resource, now: Date): Decision {
  if (REQUIRES_VERIFIED_EMAIL.has(action) && !p.emailVerified) return { allowed: false, reason: "unverified_email" };

  if (p.membershipRole !== null) {
    return MEMBER_MATRIX[p.membershipRole].has(action) ? { allowed: true, via: "membership" } : { allowed: false, reason: "role_forbidden" };
  }

  // Accès interne : jamais implicite, toujours MFA, toujours borné dans le temps.
  if (p.platformRole === null) return { allowed: false, reason: "not_member" };
  if (!p.mfaVerified) return { allowed: false, reason: "mfa_required" };

  if (p.platformRole === "producer" || p.platformRole === "account_manager") {
    const allowedActions = p.platformRole === "producer" ? PRODUCER_ACTIONS : ACCOUNT_MANAGER_ACTIONS;
    if (!allowedActions.has(action)) return { allowed: false, reason: "role_forbidden" };
    if (resource.brandId === undefined) return { allowed: false, reason: "assignment_missing" };
    const ok = p.staffAssignments.some(
      (a) =>
        a.role === p.platformRole &&
        a.organizationId === resource.organizationId &&
        a.brandId === resource.brandId &&
        a.validFrom.getTime() <= now.getTime() &&
        now.getTime() < a.validUntil.getTime(),
    );
    return ok ? { allowed: true, via: "staff_assignment" } : { allowed: false, reason: "assignment_missing" };
  }

  if (p.platformRole === "support") {
    const grants = p.supportGrants.filter((g) => g.organizationId === resource.organizationId && g.revokedAt === null && now.getTime() < g.expiresAt.getTime());
    if (grants.length === 0) return { allowed: false, reason: "grant_missing" };
    const content = grants.some((g) => g.scope === "content");
    const set = content ? SUPPORT_CONTENT_ACTIONS : SUPPORT_METADATA_ACTIONS;
    return set.has(action) ? { allowed: true, via: "support_grant" } : { allowed: false, reason: "role_forbidden" };
  }

  // platform_admin / super_admin : exploitation et configuration, aucun droit client implicite.
  return { allowed: false, reason: "not_member" };
}

/** Rôles qu'un acteur peut attribuer. Le rôle propriétaire ne s'obtient que par transfert. */
export function assignableRoles(actor: MemberRole): readonly MemberRole[] {
  if (actor === "owner") return ["admin", "editor", "reviewer"];
  if (actor === "admin") return ["editor", "reviewer"];
  return [];
}

/** Un acteur peut-il modifier/retirer le membre cible ? Un admin ne touche ni aux propriétaires ni aux autres admins. */
export function canManageMember(actor: MemberRole, target: MemberRole): boolean {
  if (actor === "owner") return target !== "owner";
  if (actor === "admin") return target === "editor" || target === "reviewer";
  return false;
}
