/**
 * Gate d'isolation E04 — tests SQL réels (PostgreSQL), exécutés avec le rôle runtime bbn_app.
 * Couvre : contexte absent, pooling, FK inter-tenant, lecture B par A, rôles, invariants.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "../../test-utils/src/context";
import { computeRevisionHash } from "@bbn/domain";
import { seedDemo, SEED } from "./seed";
import { createPool, TenantAccessDenied, TenantContextError, withTenant, withUser } from "./tenant";

const { appUrl, migrationUrl } = inject("dbUrls");
let pool: pg.Pool;
let single: pg.Pool;

const A = { organizationId: SEED.orgA, userId: SEED.users.ownerA };
const B = { organizationId: SEED.orgB, userId: SEED.users.ownerB };
const systemA = { organizationId: SEED.orgA, userId: null };

async function pgError(p: Promise<unknown>): Promise<{ code?: string; message: string }> {
  try {
    await p;
  } catch (e) {
    return e as { code?: string; message: string };
  }
  throw new Error("une erreur était attendue");
}

beforeAll(async () => {
  pool = createPool(appUrl, 5);
  single = createPool(appUrl, 1);
  await seedDemo(pool, migrationUrl, new Date("2026-11-11T12:00:00Z"));
});

afterAll(async () => {
  await pool?.end();
  await single?.end();
});

describe("rôle runtime", () => {
  it("bbn_app n'est ni superutilisateur, ni BYPASSRLS, ni propriétaire des tables", async () => {
    const c = await pool.connect();
    try {
      const r = await c.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user");
      expect(current(r.rows)).toEqual({ rolsuper: false, rolbypassrls: false });
      const owned = await c.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user");
      expect(current(owned.rows).n).toBe(0);
      const noRls = await c.query(
        "SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname <> 'schema_migrations' AND NOT (relrowsecurity AND relforcerowsecurity)",
      );
      expect(noRls.rows).toEqual([]);
    } finally {
      c.release();
    }
  });

  it("ne peut pas endosser le rôle de migration", async () => {
    const c = await pool.connect();
    try {
      expect((await pgError(c.query("SET ROLE bbn_migrator"))).code).toBe("42501");
    } finally {
      c.release();
    }
  });

  it("aucun accès aux webhooks bruts ni à la table des migrations", async () => {
    const e1 = await pgError(withTenant(pool, systemA, ({ client }) => client.query("SELECT * FROM webhook_events")));
    expect(e1.code).toBe("42501");
    const e2 = await pgError(withTenant(pool, systemA, ({ client }) => client.query("SELECT * FROM schema_migrations")));
    expect(e2.code).toBe("42501");
  });
});

describe("contexte tenant", () => {
  it("sans contexte : aucune ligne visible et toute écriture refusée", async () => {
    const c = await pool.connect();
    try {
      for (const t of ["brands", "organizations", "memberships", "publications", "usage_ledger", "users"]) {
        expect((await c.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n, t).toBe(0);
      }
      const e = await pgError(c.query("INSERT INTO brands (organization_id, name, timezone, default_content_locale) VALUES ($1, 'x', 'UTC', 'fr-CA')", [SEED.orgA]));
      expect(e.code).toBe("42501");
    } finally {
      c.release();
    }
  });

  it("le contexte SET LOCAL ne survit pas à la transaction sur une connexion du pool", async () => {
    const seen = await withTenant(single, systemA, async ({ client }) => (await client.query("SELECT count(*)::int AS n FROM brands")).rows[0].n);
    expect(seen).toBe(1);
    const c = await single.connect(); // même connexion physique (pool de taille 1)
    try {
      const r = await c.query("SELECT current_setting('app.organization_id', true) AS org, (SELECT count(*)::int FROM brands) AS n");
      expect(r.rows[0]).toEqual({ org: "", n: 0 });
    } finally {
      c.release();
    }
  });

  it("un contexte invalide est refusé avant toute requête", async () => {
    await expect(withTenant(pool, { organizationId: "not-a-uuid", userId: null }, async () => 1)).rejects.toBeInstanceOf(TenantContextError);
    await expect(withTenant(pool, { organizationId: "", userId: null }, async () => 1)).rejects.toBeInstanceOf(TenantContextError);
  });

  it("un utilisateur non membre ne peut pas ouvrir le contexte d'une autre organisation", async () => {
    await expect(withTenant(pool, { organizationId: SEED.orgB, userId: SEED.users.ownerA }, async () => 1)).rejects.toBeInstanceOf(TenantAccessDenied);
  });
});

describe("lecture et écriture inter-tenant", () => {
  it("A ne lit aucune donnée de B, même par identifiant", async () => {
    await withTenant(pool, A, async ({ client }) => {
      expect((await client.query("SELECT id FROM brands")).rows.map((r) => r.id)).toEqual([SEED.brandA]);
      expect((await client.query("SELECT 1 FROM brands WHERE id = $1", [SEED.brandB])).rowCount).toBe(0);
      expect((await client.query("SELECT 1 FROM social_connections WHERE id = $1", [SEED.connFacebookB])).rowCount).toBe(0);
      expect((await client.query("SELECT 1 FROM content_items WHERE id = $1", [SEED.itemB])).rowCount).toBe(0);
      expect((await client.query("SELECT 1 FROM subscriptions WHERE id = $1", [SEED.subscriptionB])).rowCount).toBe(0);
      expect((await client.query("SELECT id FROM organizations ORDER BY id")).rows.map((r) => r.id)).toEqual([SEED.orgA]);
      expect((await client.query("SELECT 1 FROM users WHERE id = $1", [SEED.users.ownerB])).rowCount).toBe(0);
    });
  });

  it("A ne peut ni modifier ni supprimer une ligne de B (0 ligne affectée)", async () => {
    await withTenant(pool, A, async ({ client }) => {
      expect((await client.query("UPDATE brands SET name = 'pwned' WHERE id = $1", [SEED.brandB])).rowCount).toBe(0);
      expect((await client.query("DELETE FROM content_items WHERE id = $1", [SEED.itemB])).rowCount).toBe(0);
    });
    await withTenant(pool, B, async ({ client }) => {
      expect((await client.query("SELECT name FROM brands WHERE id = $1", [SEED.brandB])).rows[0].name).toBe("Demo Studio B");
    });
  });

  it("A ne peut pas écrire une ligne étiquetée B (WITH CHECK)", async () => {
    const e = await pgError(
      withTenant(pool, A, ({ client }) =>
        client.query("INSERT INTO content_plans (organization_id, brand_id, period_start, period_end) VALUES ($1, $2, '2026-11-01', '2026-12-01')", [SEED.orgB, SEED.brandB]),
      ),
    );
    expect(e.code).toBe("42501");
  });

  it("A ne peut pas déplacer une ligne vers B", async () => {
    const e = await pgError(withTenant(pool, A, ({ client }) => client.query("UPDATE brands SET organization_id = $1 WHERE id = $2", [SEED.orgB, SEED.brandA])));
    expect(e.code).toBe("42501");
  });

  it("FK composites : une ligne de A ne peut pas référencer un objet de B", async () => {
    const cases: [string, unknown[]][] = [
      ["INSERT INTO content_plans (organization_id, brand_id, period_start, period_end) VALUES ($1, $2, '2026-11-01', '2026-12-01')", [SEED.orgA, SEED.brandB]],
      ["INSERT INTO brand_assets (organization_id, brand_id, media_asset_id, usage_role) VALUES ($1, $2, $3, 'logo')", [SEED.orgA, SEED.brandB, SEED.mediaA]],
      [
        "INSERT INTO publications (organization_id, revision_id, connection_id, timezone) VALUES ($1, $2, $3, 'America/Toronto')",
        [SEED.orgA, SEED.revision2A, SEED.connFacebookB],
      ],
      ["INSERT INTO comments (organization_id, content_item_id, body, author_id) VALUES ($1, $2, 'hello', $3)", [SEED.orgA, SEED.itemB, SEED.users.ownerA]],
    ];
    for (const [sql, params] of cases) {
      const e = await pgError(withTenant(pool, A, ({ client }) => client.query(sql, params)));
      expect(e.code, sql).toBe("23503");
    }
  });

  it("une notification ne peut viser qu'un membre de l'organisation", async () => {
    const e = await pgError(
      withTenant(pool, A, ({ client }) =>
        client.query("INSERT INTO notifications (organization_id, user_id, locale, type, delivery_key) VALUES ($1, $2, 'en-CA', 't', $3)", [SEED.orgA, SEED.users.ownerB, randomUUID()]),
      ),
    );
    expect(e.code).toBe("23503");
  });

  it("un utilisateur voit la liste de ses organisations, pas les autres", async () => {
    const orgs = await withUser(pool, SEED.users.ownerA, async ({ client }) => (await client.query("SELECT id FROM organizations")).rows.map((r) => r.id));
    expect(orgs).toEqual([SEED.orgA]);
  });
});

describe("invariants métier portés par la base", () => {
  it("dernier propriétaire protégé ; transfert atomique accepté", async () => {
    const e = await pgError(withTenant(pool, A, ({ client }) => client.query("UPDATE memberships SET role = 'admin' WHERE organization_id = $1 AND user_id = $2", [SEED.orgA, SEED.users.ownerA])));
    expect(e.message).toContain("last_owner_protected");
    const e2 = await pgError(withTenant(pool, A, ({ client }) => client.query("DELETE FROM memberships WHERE organization_id = $1 AND user_id = $2", [SEED.orgA, SEED.users.ownerA])));
    expect(e2.message).toContain("last_owner_protected");
    // Transfert : le nouveau propriétaire est promu avant que l'ancien soit rétrogradé, dans la même transaction.
    await withTenant(pool, A, async ({ client }) => {
      await client.query("UPDATE memberships SET role = 'owner' WHERE organization_id = $1 AND user_id = $2", [SEED.orgA, SEED.users.editorA]);
      await client.query("UPDATE memberships SET role = 'admin' WHERE organization_id = $1 AND user_id = $2", [SEED.orgA, SEED.users.ownerA]);
    });
    await withTenant(pool, { organizationId: SEED.orgA, userId: SEED.users.editorA }, async ({ client }) => {
      await client.query("UPDATE memberships SET role = 'owner' WHERE organization_id = $1 AND user_id = $2", [SEED.orgA, SEED.users.ownerA]);
      await client.query("UPDATE memberships SET role = 'editor' WHERE organization_id = $1 AND user_id = $2", [SEED.orgA, SEED.users.editorA]);
    });
  });

  it("révisions immuables ; ledger et audit append-only pour le runtime", async () => {
    for (const sql of [
      ["UPDATE revisions SET caption = 'x' WHERE id = $1", SEED.revision1A],
      ["DELETE FROM revisions WHERE id = $1", SEED.revision1A],
      ["UPDATE usage_ledger SET delta = 0 WHERE reservation_id = $1", SEED.reservationA],
      ["DELETE FROM usage_ledger WHERE reservation_id = $1", SEED.reservationA],
      ["DELETE FROM audit_events WHERE organization_id = $1", SEED.orgA],
      ["UPDATE brand_guidelines SET tone_json = '{}' WHERE brand_id = $1", SEED.brandA],
    ] as const) {
      const e = await pgError(withTenant(pool, A, ({ client }) => client.query(sql[0], [sql[1]])));
      expect(e.code, sql[0]).toBe("42501");
    }
  });

  it("même le propriétaire des tables ne peut pas réécrire une révision", async () => {
    const c = new pg.Client({ connectionString: migrationUrl });
    await c.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.organization_id', $1, true)", [SEED.orgA]);
      const e = await pgError(c.query("UPDATE revisions SET caption = 'x' WHERE id = $1", [SEED.revision1A]));
      expect(e.message).toContain("immutable_row");
      await c.query("ROLLBACK");
    } finally {
      await c.end();
    }
  });

  it("approbation : empreinte obsolète ou destination incohérente refusées", async () => {
    const wrongHash = computeRevisionHash({ caption: "autre texte", locale: "fr-CA", provider: "facebook_page", media: [] });
    const e1 = await pgError(
      withTenant(pool, A, ({ client }) =>
        client.query("INSERT INTO approvals (organization_id, revision_id, revision_hash, connection_id, actor_id) VALUES ($1, $2, $3, $4, $5)", [
          SEED.orgA, SEED.revision1A, wrongHash, SEED.connFacebookA, SEED.users.reviewerA,
        ]),
      ),
    );
    expect(e1.message).toContain("approval_hash_mismatch");
    // Révision Facebook FR approuvée pour le compte Instagram : refusée (une approbation vaut pour une destination).
    const e2 = await pgError(
      withTenant(pool, A, async ({ client }) => {
        const h = (await client.query("SELECT hash FROM revisions WHERE id = $1", [SEED.revision2A])).rows[0].hash;
        await client.query("INSERT INTO approvals (organization_id, revision_id, revision_hash, connection_id, actor_id) VALUES ($1, $2, $3, $4, $5)", [
          SEED.orgA, SEED.revision2A, h, SEED.connInstagramExpiredA, SEED.users.reviewerA,
        ]);
      }),
    );
    expect(e2.message).toContain("approval_destination_mismatch");
  });

  it("une approbation invalidée ne peut pas être réactivée", async () => {
    const e = await pgError(withTenant(pool, A, ({ client }) => client.query("UPDATE approvals SET invalidated_at = NULL, invalidated_reason = NULL WHERE id = $1", [SEED.staleApprovalA])));
    expect(e.message).toContain("approval_immutable");
  });

  it("la révision courante doit appartenir à la même variante", async () => {
    const e = await pgError(
      withTenant(pool, A, async ({ client }) => {
        const v = randomUUID();
        await client.query("INSERT INTO content_variants (id, organization_id, content_item_id, provider, locale) VALUES ($1, $2, $3, 'facebook_page', 'en-CA')", [v, SEED.orgA, SEED.itemA]);
        await client.query("UPDATE content_variants SET current_revision_id = $1 WHERE id = $2", [SEED.revision2A, v]);
      }),
    );
    expect(e.code).toBe("23503");
  });

  it("unicité variante sujet/réseau/langue et numéro de révision", async () => {
    const e = await pgError(
      withTenant(pool, A, ({ client }) =>
        client.query("INSERT INTO content_variants (organization_id, content_item_id, provider, locale) VALUES ($1, $2, 'facebook_page', 'fr-CA')", [SEED.orgA, SEED.itemA]),
      ),
    );
    expect(e.code).toBe("23505");
  });

  it("cycles de facturation sans chevauchement ; dédoublonnage du ledger", async () => {
    const e1 = await pgError(
      withTenant(pool, A, ({ client }) =>
        client.query("INSERT INTO billing_cycles (organization_id, subscription_id, starts_at, ends_at) VALUES ($1, $2, '2026-11-15T00:00Z', '2026-12-15T00:00Z')", [
          SEED.orgA, SEED.subscriptionA,
        ]),
      ),
    );
    expect(e1.code).toBe("23P01");
    const e2 = await pgError(
      withTenant(pool, A, ({ client }) =>
        client.query("INSERT INTO usage_ledger (organization_id, cycle_id, type, entry_kind, delta, dedupe_key) VALUES ($1, $2, 'publication', 'reserve', 1, $3)", [
          SEED.orgA, SEED.cycleA, `reserve:publication:${SEED.publicationUnknownA}`,
        ]),
      ),
    );
    expect(e2.code).toBe("23505");
  });

  it("une invitation expire au plus tard après sept jours ; un support grant est borné et motivé", async () => {
    const e1 = await pgError(
      withTenant(pool, A, ({ client }) =>
        client.query("INSERT INTO invitations (organization_id, email, role, token_hash, invited_by, expires_at) VALUES ($1, 'x@example.test', 'editor', $2, $3, now() + interval '8 days')", [
          SEED.orgA, "f".repeat(64), SEED.users.ownerA,
        ]),
      ),
    );
    expect(e1.code).toBe("23514");
    const e2 = await pgError(
      withTenant(pool, A, ({ client }) =>
        client.query("INSERT INTO support_grants (organization_id, actor_id, reason, expires_at) VALUES ($1, $2, 'court', now() + interval '1 hour')", [SEED.orgA, SEED.users.ownerA]),
      ),
    );
    expect(e2.code).toBe("23514");
  });

  it("une statistique indisponible reste NULL, jamais zéro", async () => {
    const e = await pgError(
      withTenant(pool, A, ({ client }) =>
        client.query(
          "INSERT INTO analytics_snapshots (organization_id, connection_id, metric, value, availability, source_definition, captured_at) VALUES ($1, $2, 'reach', 0, 'unsupported', 'fake', now())",
          [SEED.orgA, SEED.connFacebookA],
        ),
      ),
    );
    expect(e.code).toBe("23514");
  });

  it("une publication ne peut être « published » sans type de confirmation", async () => {
    const e = await pgError(withTenant(pool, A, ({ client }) => client.query("UPDATE publications SET status = 'published' WHERE id = $1", [SEED.publicationUnknownA])));
    expect(e.code).toBe("23514");
  });
});

describe("seed de démonstration", () => {
  it("contient les cas exigés par la spécification (§14, §18)", async () => {
    const a = await withTenant(pool, systemA, async ({ client }) => {
      const q = async (sql: string) => (await client.query(sql)).rows;
      return {
        roles: (await q("SELECT role FROM memberships ORDER BY role")).map((r) => r.role),
        connections: (await q("SELECT provider, status FROM social_connections ORDER BY provider")).map((r) => `${r.provider}:${r.status}`),
        staleApprovals: (await q("SELECT count(*)::int AS n FROM approvals WHERE invalidated_at IS NOT NULL"))[0].n,
        unknown: (await q("SELECT count(*)::int AS n FROM publications WHERE status = 'unknown'"))[0].n,
        readyMedia: (await q("SELECT count(*)::int AS n FROM media_assets WHERE status = 'ready' AND rights_status <> 'undeclared'"))[0].n,
      };
    });
    expect(a.roles).toEqual(["editor", "owner", "reviewer"]);
    expect(a.connections).toEqual(["facebook_page:active", "instagram_business:needs_reconnect"]);
    expect(a.staleApprovals).toBe(1);
    expect(a.unknown).toBe(1);
    expect(a.readyMedia).toBe(1);
    const b = await withTenant(pool, { organizationId: SEED.orgB, userId: null }, async ({ client }) => (await client.query("SELECT status, grace_until FROM subscriptions")).rows[0]);
    expect(b.status).toBe("past_due");
    expect(b.grace_until).not.toBeNull();
  });
});

function current<T>(rows: T[]): T {
  if (rows.length !== 1) throw new Error(`une ligne attendue, ${rows.length} obtenues`);
  return rows[0]!;
}
