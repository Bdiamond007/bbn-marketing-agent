import { describe, expect, it } from "vitest";
import { ACTIONS, assignableRoles, authorize, canManageMember, type Action, type MemberRole, type Principal } from "./authz";

const now = new Date("2026-11-11T12:00:00Z");
const res = { organizationId: "org-a", brandId: "brand-a" };
const base: Principal = { userId: "u", emailVerified: true, membershipRole: null, platformRole: null, mfaVerified: false, staffAssignments: [], supportGrants: [] };
const member = (role: MemberRole, extra: Partial<Principal> = {}): Principal => ({ ...base, membershipRole: role, ...extra });
const allowed = (p: Principal, a: Action, r = res) => authorize(p, a, r, now).allowed;

describe("matrice des rôles client (§4)", () => {
  it("propriétaire : toutes les actions", () => {
    for (const a of ACTIONS) expect(allowed(member("owner"), a), a).toBe(true);
  });

  it("administrateur : équipe, marque, approbation, programmation ; ni facturation, ni suppression, ni transfert", () => {
    const p = member("admin");
    for (const a of ["team.invite", "brand.edit", "content.approve", "publication.schedule", "connection.manage"] as const) expect(allowed(p, a), a).toBe(true);
    for (const a of ["billing.manage", "org.delete", "org.transfer", "privacy.delete", "privacy.export"] as const) expect(allowed(p, a), a).toBe(false);
  });

  it("éditeur : crée et modifie, n'approuve ni ne programme", () => {
    const p = member("editor");
    expect(allowed(p, "content.edit")).toBe(true);
    for (const a of ["content.approve", "publication.schedule", "team.invite", "connection.manage"] as const) expect(allowed(p, a), a).toBe(false);
  });

  it("relecteur : lit, commente, approuve ; ne programme pas et ne modifie pas", () => {
    const p = member("reviewer");
    for (const a of ["content.read", "content.comment", "content.approve"] as const) expect(allowed(p, a), a).toBe(true);
    for (const a of ["publication.schedule", "content.edit"] as const) expect(allowed(p, a), a).toBe(false);
  });

  it("non membre sans rôle interne : refus", () => {
    expect(authorize(base, "content.read", res, now)).toEqual({ allowed: false, reason: "not_member" });
  });

  it("courriel non vérifié : connexion de réseau et programmation refusées, même propriétaire", () => {
    const p = member("owner", { emailVerified: false });
    expect(authorize(p, "connection.manage", res, now)).toEqual({ allowed: false, reason: "unverified_email" });
    expect(allowed(p, "publication.schedule")).toBe(false);
    expect(allowed(p, "content.edit")).toBe(true);
  });
});

describe("rôles internes", () => {
  const assignment = { organizationId: "org-a", brandId: "brand-a", role: "producer" as const, validFrom: new Date("2026-11-01T00:00:00Z"), validUntil: new Date("2026-12-01T00:00:00Z") };
  const producer: Principal = { ...base, platformRole: "producer", mfaVerified: true, staffAssignments: [assignment] };

  it("producteur : marque affectée seulement, sans approbation client", () => {
    expect(authorize(producer, "content.internal_review", res, now)).toEqual({ allowed: true, via: "staff_assignment" });
    expect(allowed(producer, "content.approve")).toBe(false);
    expect(allowed(producer, "publication.schedule")).toBe(false);
    expect(allowed(producer, "content.edit", { organizationId: "org-a", brandId: "brand-b" })).toBe(false);
    expect(allowed(producer, "content.edit", { organizationId: "org-b", brandId: "brand-a" })).toBe(false);
  });

  it("producteur : affectation expirée refusée ; MFA exigée", () => {
    expect(authorize(producer, "content.edit", res, new Date("2026-12-01T00:00:00Z"))).toEqual({ allowed: false, reason: "assignment_missing" });
    expect(authorize({ ...producer, mfaVerified: false }, "content.edit", res, now)).toEqual({ allowed: false, reason: "mfa_required" });
  });

  it("support : métadonnées avec accès valide ; contenu seulement avec portée content ; accès expiré ou révoqué refusé", () => {
    const grant = { organizationId: "org-a", scope: "metadata" as const, expiresAt: new Date("2026-11-11T13:00:00Z"), revokedAt: null };
    const support: Principal = { ...base, platformRole: "support", mfaVerified: true, supportGrants: [grant] };
    expect(allowed(support, "team.read")).toBe(true);
    expect(allowed(support, "content.read")).toBe(false);
    expect(allowed({ ...support, supportGrants: [{ ...grant, scope: "content" }] }, "content.read")).toBe(true);
    expect(allowed({ ...support, supportGrants: [{ ...grant, scope: "content" }] }, "content.edit")).toBe(false);
    expect(authorize(support, "team.read", res, new Date("2026-11-11T13:00:00Z"))).toEqual({ allowed: false, reason: "grant_missing" });
    expect(allowed({ ...support, supportGrants: [{ ...grant, revokedAt: now }] }, "team.read")).toBe(false);
  });

  it("administrateur et super administrateur plateforme : aucun droit client implicite", () => {
    for (const r of ["platform_admin", "super_admin"] as const) {
      expect(allowed({ ...base, platformRole: r, mfaVerified: true }, "content.read")).toBe(false);
    }
  });
});

describe("gestion des membres", () => {
  it("le rôle propriétaire ne s'attribue que par transfert", () => {
    expect(assignableRoles("owner")).not.toContain("owner");
    expect(assignableRoles("admin")).toEqual(["editor", "reviewer"]);
    expect(assignableRoles("editor")).toEqual([]);
  });
  it("un admin ne gère ni propriétaire ni autre admin", () => {
    expect(canManageMember("admin", "owner")).toBe(false);
    expect(canManageMember("admin", "admin")).toBe(false);
    expect(canManageMember("admin", "editor")).toBe(true);
    expect(canManageMember("owner", "admin")).toBe(true);
    expect(canManageMember("reviewer", "editor")).toBe(false);
  });
});
