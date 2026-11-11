/**
 * Seed de démonstration — DONNÉES ENTIÈREMENT FICTIVES (aucune donnée client réelle, §17).
 * Couvre : organisations A/B, rôles différents, marque FR/EN, média autorisé, connexion valide/expirée,
 * impayé (B), approbation obsolète, publication au résultat inconnu.
 * Écrit via le rôle runtime (bbn_app) sous RLS, organisation par organisation, sauf les plans
 * (données de référence globales, écrites par le rôle de migration).
 */
import { computeRevisionHash } from "@bbn/domain";
import pg from "pg";
import { createOrganizationWithOwner, withTenant, withUser } from "./tenant";

export const SEED = {
  orgA: "0a000000-0000-4000-8000-00000000000a",
  orgB: "0b000000-0000-4000-8000-00000000000b",
  users: {
    ownerA: "a1000000-0000-4000-8000-000000000001",
    editorA: "a1000000-0000-4000-8000-000000000002",
    reviewerA: "a1000000-0000-4000-8000-000000000003",
    ownerB: "b1000000-0000-4000-8000-000000000001",
  },
  brandA: "a2000000-0000-4000-8000-000000000001",
  brandB: "b2000000-0000-4000-8000-000000000001",
  mediaA: "a3000000-0000-4000-8000-000000000001",
  connFacebookA: "a4000000-0000-4000-8000-000000000001",
  connInstagramExpiredA: "a4000000-0000-4000-8000-000000000002",
  connFacebookB: "b4000000-0000-4000-8000-000000000001",
  subscriptionA: "a5000000-0000-4000-8000-000000000001",
  subscriptionB: "b5000000-0000-4000-8000-000000000001",
  cycleA: "a6000000-0000-4000-8000-000000000001",
  cycleB: "b6000000-0000-4000-8000-000000000001",
  planA: "a7000000-0000-4000-8000-000000000001",
  itemA: "a8000000-0000-4000-8000-000000000001",
  variantFbFrA: "a9000000-0000-4000-8000-000000000001",
  revision1A: "aa000000-0000-4000-8000-000000000001",
  revision2A: "aa000000-0000-4000-8000-000000000002",
  staleApprovalA: "ab000000-0000-4000-8000-000000000001",
  currentApprovalA: "ab000000-0000-4000-8000-000000000002",
  reservationA: "ac000000-0000-4000-8000-000000000001",
  publicationUnknownA: "ad000000-0000-4000-8000-000000000001",
  planB: "b7000000-0000-4000-8000-000000000001",
  itemB: "b8000000-0000-4000-8000-000000000001",
} as const;

/** Plans provisoires (ADR-0002) : hypothèses de conception, à valider commercialement. */
export const PROVISIONAL_PLANS = [
  { code: "essentiel", version: 1, priceMinor: 9900, entitlements: { brands: 1, users: 2, content_items: 15, publications: 45, social_accounts: 3, regenerations_per_item: 3 } },
  { code: "croissance", version: 1, priceMinor: 17900, entitlements: { brands: 1, users: 5, content_items: 30, publications: 90, social_accounts: 3, regenerations_per_item: 3 } },
  {
    code: "accompagne",
    version: 1,
    priceMinor: 39900,
    entitlements: { brands: 1, users: 5, content_items: 15, publications: 45, social_accounts: 3, regenerations_per_item: 3, internal_review: true, grouped_correction_rounds: 1, ops_minutes_target: 120 },
  },
] as const;

function monthBounds(now: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

export async function seedPlans(migrationUrl: string): Promise<void> {
  const c = new pg.Client({ connectionString: migrationUrl });
  await c.connect();
  try {
    for (const p of PROVISIONAL_PLANS) {
      await c.query(
        `INSERT INTO plans (code, version, price_minor, currency, entitlements_json) VALUES ($1, $2, $3, 'CAD', $4)
         ON CONFLICT (code, version) DO NOTHING`,
        [p.code, p.version, p.priceMinor, JSON.stringify(p.entitlements)],
      );
    }
  } finally {
    await c.end();
  }
}

export async function seedDemo(appPool: pg.Pool, migrationUrl: string, now: Date = new Date()): Promise<typeof SEED> {
  await seedPlans(migrationUrl);
  const S = SEED;
  const { start, end } = monthBounds(now);
  const sha = (n: string) => n.repeat(64).slice(0, 64);

  const users: [string, string, "fr-CA" | "en-CA"][] = [
    [S.users.ownerA, "proprietaire.a@example.test", "fr-CA"],
    [S.users.editorA, "editrice.a@example.test", "fr-CA"],
    [S.users.reviewerA, "reviewer.a@example.test", "en-CA"],
    [S.users.ownerB, "owner.b@example.test", "en-CA"],
  ];
  for (const [id, email, locale] of users) {
    await withUser(appPool, id, async ({ client }) => {
      await client.query(
        `INSERT INTO users (id, auth_subject, email, email_verified_at, ui_locale) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [id, `fake-sub-${id}`, email, now.toISOString(), locale],
      );
    });
  }

  const orgExists = async (orgId: string, userId: string) =>
    withUser(appPool, userId, async ({ client }) => ((await client.query("SELECT 1 FROM organizations WHERE id = $1", [orgId])).rowCount ?? 0) > 0);

  if (!(await orgExists(S.orgA, S.users.ownerA))) {
    await createOrganizationWithOwner(appPool, { organizationId: S.orgA, ownerUserId: S.users.ownerA, name: "Boulangerie Démo A (fictive)", defaultLocale: "fr-CA" });
  }
  if (!(await orgExists(S.orgB, S.users.ownerB))) {
    await createOrganizationWithOwner(appPool, { organizationId: S.orgB, ownerUserId: S.users.ownerB, name: "Demo Studio B (fictitious)", defaultLocale: "en-CA" });
  }

  // ── Organisation A ───────────────────────────────────────────────────────
  await withTenant(appPool, { organizationId: S.orgA, userId: S.users.ownerA }, async ({ client }) => {
    const already = await client.query("SELECT 1 FROM brands WHERE id = $1", [S.brandA]);
    if (already.rowCount) return;
    await client.query(
      `INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'editor'), ($1, $3, 'reviewer')`,
      [S.orgA, S.users.editorA, S.users.reviewerA],
    );
    await client.query(
      `INSERT INTO brands (id, organization_id, name, sector, timezone, default_content_locale, profile_version, status)
       VALUES ($1, $2, 'Boulangerie Démo A', 'restaurant', 'America/Toronto', 'fr-CA', 1, 'active')`,
      [S.brandA, S.orgA],
    );
    await client.query(
      `INSERT INTO brand_guidelines (organization_id, brand_id, version, facts_json, tone_json, created_by) VALUES ($1, $2, 1, $3, $4, $5)`,
      [
        S.orgA,
        S.brandA,
        JSON.stringify({
          facts: [
            { id: "fact-hours", kind: "hours", value: "Mar–sam 7 h–18 h (fictif)", validFrom: start.toISOString(), validUntil: end.toISOString(), confirmed: true },
            { id: "fact-service", kind: "service", value: "Pains au levain (fictif)", confirmed: true },
          ],
        }),
        JSON.stringify({ tone: "chaleureux", forbidden: ["promesses de résultats"] }),
        S.users.ownerA,
      ],
    );
    await client.query(
      `INSERT INTO media_assets (id, organization_id, storage_key, mime, bytes, sha256, width, height, rights_status, status, uploaded_by)
       VALUES ($1, $2, $3, 'image/jpeg', 245000, $4, 1080, 1080, 'declared_owned', 'ready', $5)`,
      [S.mediaA, S.orgA, `org/${S.orgA}/media/${S.mediaA}.jpg`, sha("1"), S.users.ownerA],
    );
    await client.query(`INSERT INTO brand_assets (organization_id, brand_id, media_asset_id, usage_role) VALUES ($1, $2, $3, 'photo')`, [S.orgA, S.brandA, S.mediaA]);
    await client.query(
      `INSERT INTO social_connections (id, organization_id, brand_id, provider, external_account_id, display_name, status, secret_ref, checked_at)
       VALUES ($1, $3, $4, 'facebook_page', 'acct_facebook_page_demo', 'Page simulée A', 'active', 'fake-secret://a/fb', $5),
              ($2, $3, $4, 'instagram_business', 'acct_instagram_business_demo', 'Compte simulé A', 'needs_reconnect', 'fake-secret://a/ig', $5)`,
      [S.connFacebookA, S.connInstagramExpiredA, S.orgA, S.brandA, now.toISOString()],
    );
    await client.query(
      `INSERT INTO subscriptions (id, organization_id, external_id, plan_code, plan_version, status, current_period_start, current_period_end)
       VALUES ($1, $2, 'sub_fake_a', 'essentiel', 1, 'active', $3, $4)`,
      [S.subscriptionA, S.orgA, start.toISOString(), end.toISOString()],
    );
    await client.query(`INSERT INTO billing_cycles (id, organization_id, subscription_id, starts_at, ends_at) VALUES ($1, $2, $3, $4, $5)`, [
      S.cycleA, S.orgA, S.subscriptionA, start.toISOString(), end.toISOString(),
    ]);
    for (const [key, limit] of Object.entries(PROVISIONAL_PLANS[0].entitlements)) {
      await client.query(
        `INSERT INTO entitlements (organization_id, cycle_id, key, limit_value, effective_from, effective_to) VALUES ($1, $2, $3, $4, $5, $6)`,
        [S.orgA, S.cycleA, key, limit, start.toISOString(), end.toISOString()],
      );
    }
    await client.query(`INSERT INTO content_plans (id, organization_id, brand_id, period_start, period_end, status) VALUES ($1, $2, $3, $4, $5, 'active')`, [
      S.planA, S.orgA, S.brandA, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10),
    ]);
    await client.query(
      `INSERT INTO content_items (id, organization_id, plan_id, topic, summary_status, source_fact_ids) VALUES ($1, $2, $3, 'Heures d''ouverture', 'approved', ARRAY['fact-hours'])`,
      [S.itemA, S.orgA, S.planA],
    );
    await client.query(
      `INSERT INTO content_variants (id, organization_id, content_item_id, provider, locale, editorial_status) VALUES ($1, $2, $3, 'facebook_page', 'fr-CA', 'approved')`,
      [S.variantFbFrA, S.orgA, S.itemA],
    );
    const media = [{ mediaAssetId: S.mediaA, sha256: sha("1") }];
    const rev = [
      { id: S.revision1A, n: 1, caption: "[SIMULATION] Nous sommes ouverts du mardi au samedi." },
      { id: S.revision2A, n: 2, caption: "[SIMULATION] Ouvert du mardi au samedi, de 7 h à 18 h." },
    ];
    for (const r of rev) {
      const hash = computeRevisionHash({ caption: r.caption, locale: "fr-CA", provider: "facebook_page", media });
      await client.query(
        `INSERT INTO revisions (id, organization_id, variant_id, number, caption, media_manifest, hash, author_id, origin) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'manual')`,
        [r.id, S.orgA, S.variantFbFrA, r.n, r.caption, JSON.stringify(media), hash, S.users.editorA],
      );
    }
    await client.query(`UPDATE content_variants SET current_revision_id = $1 WHERE id = $2`, [S.revision2A, S.variantFbFrA]);
    const h1 = (await client.query<{ hash: string }>("SELECT hash FROM revisions WHERE id = $1", [S.revision1A])).rows[0]!.hash;
    const h2 = (await client.query<{ hash: string }>("SELECT hash FROM revisions WHERE id = $1", [S.revision2A])).rows[0]!.hash;
    // Approbation obsolète : donnée sur la révision 1, invalidée lors de la création de la révision 2.
    await client.query(`INSERT INTO approvals (id, organization_id, revision_id, revision_hash, connection_id, actor_id) VALUES ($1, $2, $3, $4, $5, $6)`, [
      S.staleApprovalA, S.orgA, S.revision1A, h1, S.connFacebookA, S.users.reviewerA,
    ]);
    await client.query(`UPDATE approvals SET invalidated_at = $2, invalidated_reason = 'revision_superseded' WHERE id = $1`, [S.staleApprovalA, now.toISOString()]);
    await client.query(`INSERT INTO approvals (id, organization_id, revision_id, revision_hash, connection_id, actor_id) VALUES ($1, $2, $3, $4, $5, $6)`, [
      S.currentApprovalA, S.orgA, S.revision2A, h2, S.connFacebookA, S.users.reviewerA,
    ]);
    // Publication au résultat inconnu : réservation conservée, réconciliation attendue (§11).
    await client.query(`INSERT INTO usage_reservations (id, organization_id, cycle_id, type, quantity, resource_id, status) VALUES ($1, $2, $3, 'publication', 1, $4, 'reserved')`, [
      S.reservationA, S.orgA, S.cycleA, S.publicationUnknownA,
    ]);
    await client.query(`INSERT INTO usage_ledger (organization_id, cycle_id, type, entry_kind, delta, dedupe_key, reservation_id) VALUES ($1, $2, 'publication', 'reserve', 1, $3, $4)`, [
      S.orgA, S.cycleA, `reserve:publication:${S.publicationUnknownA}`, S.reservationA,
    ]);
    await client.query(
      `INSERT INTO publications (id, organization_id, revision_id, connection_id, scheduled_at, timezone, status, quota_reservation_id, attempt_count)
       VALUES ($1, $2, $3, $4, $5, 'America/Toronto', 'unknown', $6, 1)`,
      [S.publicationUnknownA, S.orgA, S.revision2A, S.connFacebookA, now.toISOString(), S.reservationA],
    );
    await client.query(
      `INSERT INTO publishing_attempts (organization_id, publication_id, attempt_number, request_key, finished_at, outcome, safe_error_code)
       VALUES ($1, $2, 1, $3, $4, 'unknown', 'timeout_after_send')`,
      [S.orgA, S.publicationUnknownA, `pub:${S.publicationUnknownA}:1`, now.toISOString()],
    );
    await client.query(`INSERT INTO audit_events (organization_id, actor_id, actor_kind, action, target_type, target_id) VALUES ($1, $2, 'system', 'seed.created', 'organization', $3)`, [
      S.orgA, null, S.orgA,
    ]);
  });

  // ── Organisation B : impayé (grâce de 7 jours depuis l'échéance) ─────────
  await withTenant(appPool, { organizationId: S.orgB, userId: S.users.ownerB }, async ({ client }) => {
    const already = await client.query("SELECT 1 FROM brands WHERE id = $1", [S.brandB]);
    if (already.rowCount) return;
    await client.query(
      `INSERT INTO brands (id, organization_id, name, sector, timezone, default_content_locale, profile_version, status)
       VALUES ($1, $2, 'Demo Studio B', 'creative_services', 'America/Vancouver', 'en-CA', 1, 'active')`,
      [S.brandB, S.orgB],
    );
    await client.query(
      `INSERT INTO social_connections (id, organization_id, brand_id, provider, external_account_id, display_name, status, secret_ref)
       VALUES ($1, $2, $3, 'facebook_page', 'acct_facebook_page_demo_b', 'Simulated page B', 'active', 'fake-secret://b/fb')`,
      [S.connFacebookB, S.orgB, S.brandB],
    );
    const dueAt = start;
    const grace = new Date(dueAt.getTime() + 7 * 24 * 3600 * 1000);
    await client.query(
      `INSERT INTO subscriptions (id, organization_id, external_id, plan_code, plan_version, status, current_period_start, current_period_end, grace_until)
       VALUES ($1, $2, 'sub_fake_b', 'croissance', 1, 'past_due', $3, $4, $5)`,
      [S.subscriptionB, S.orgB, start.toISOString(), end.toISOString(), grace.toISOString()],
    );
    await client.query(`INSERT INTO billing_cycles (id, organization_id, subscription_id, starts_at, ends_at) VALUES ($1, $2, $3, $4, $5)`, [
      S.cycleB, S.orgB, S.subscriptionB, start.toISOString(), end.toISOString(),
    ]);
    await client.query(`INSERT INTO content_plans (id, organization_id, brand_id, period_start, period_end) VALUES ($1, $2, $3, $4, $5)`, [
      S.planB, S.orgB, S.brandB, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10),
    ]);
    await client.query(`INSERT INTO content_items (id, organization_id, plan_id, topic) VALUES ($1, $2, $3, 'Studio open house (fictitious)')`, [S.itemB, S.orgB, S.planB]);
  });

  return S;
}
