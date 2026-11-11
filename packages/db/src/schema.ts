// GÉNÉRÉ par scripts/introspect.sh (drizzle-kit pull + postprocess-schema) — ne pas éditer à la main.
import { pgTable, index, unique, uuid, text, integer, timestamp, uniqueIndex, boolean, jsonb, date, bigint, numeric, primaryKey } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const usageReservations = pgTable("usage_reservations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	cycleId: uuid("cycle_id").notNull(),
	type: text().notNull(),
	quantity: integer().notNull(),
	resourceId: uuid("resource_id").notNull(),
	status: text().default('reserved').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	parentResourceId: uuid("parent_resource_id"),
}, (table) => [
	index("usage_reservations_cycle_idx").using("btree", table.cycleId.asc().nullsLast().op("text_ops"), table.type.asc().nullsLast().op("uuid_ops"), table.status.asc().nullsLast().op("uuid_ops")),
	index("usage_reservations_parent_idx").using("btree", table.parentResourceId.asc().nullsLast().op("text_ops"), table.type.asc().nullsLast().op("uuid_ops"), table.status.asc().nullsLast().op("uuid_ops")).where(sql`(parent_resource_id IS NOT NULL)`),
	unique("usage_reservations_organization_id_id_key").on(table.id, table.organizationId),
	unique("usage_reservations_type_resource_id_key").on(table.type, table.resourceId),
]);

export const subscriptions = pgTable("subscriptions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	externalId: text("external_id"),
	planCode: text("plan_code").notNull(),
	planVersion: integer("plan_version").notNull(),
	status: text().notNull(),
	currentPeriodStart: timestamp("current_period_start", { withTimezone: true, mode: 'string' }),
	currentPeriodEnd: timestamp("current_period_end", { withTimezone: true, mode: 'string' }),
	graceUntil: timestamp("grace_until", { withTimezone: true, mode: 'string' }),
	cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
	version: integer().default(1).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	providerCustomerRef: text("provider_customer_ref"),
	providerUpdatedAt: timestamp("provider_updated_at", { withTimezone: true, mode: 'string' }),
	graceDueAt: timestamp("grace_due_at", { withTimezone: true, mode: 'string' }),
	scheduledPlanCode: text("scheduled_plan_code"),
	scheduledPlanVersion: integer("scheduled_plan_version"),
}, (table) => [
	uniqueIndex("subscriptions_one_live_per_org").using("btree", table.organizationId.asc().nullsLast().op("uuid_ops")).where(sql`(status = ANY (ARRAY['incomplete'::text, 'active'::text, 'past_due'::text, 'suspended'::text]))`),
	unique("subscriptions_organization_id_id_key").on(table.id, table.organizationId),
	unique("subscriptions_external_id_key").on(table.externalId),
]);

export const organizations = pgTable("organizations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	defaultLocale: text("default_locale").notNull(),
	status: text().default('active').notNull(),
	version: integer().default(1).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, );

export const invitations = pgTable("invitations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	email: text().notNull(),
	role: text().notNull(),
	tokenHash: text("token_hash").notNull(),
	invitedBy: uuid("invited_by").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: 'string' }),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("invitations_org_idx").using("btree", table.organizationId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	uniqueIndex("invitations_pending_uq").using("btree", table.organizationId.asc().nullsLast().op("text_ops"), table.email.asc().nullsLast().op("uuid_ops")).where(sql`((accepted_at IS NULL) AND (revoked_at IS NULL))`),
	unique("invitations_token_hash_key").on(table.tokenHash),
]);

export const brands = pgTable("brands", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	name: text().notNull(),
	sector: text(),
	timezone: text().notNull(),
	defaultContentLocale: text("default_content_locale").notNull(),
	profileVersion: integer("profile_version").default(0).notNull(),
	status: text().default('draft').notNull(),
	version: integer().default(1).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("brands_organization_id_id_key").on(table.id, table.organizationId),
]);

export const mediaAssets = pgTable("media_assets", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	storageKey: text("storage_key").notNull(),
	mime: text().notNull(),
	bytes: integer().notNull(),
	sha256: text().notNull(),
	width: integer(),
	height: integer(),
	rightsStatus: text("rights_status").default('undeclared').notNull(),
	status: text().default('quarantined').notNull(),
	uploadedBy: uuid("uploaded_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("media_assets_organization_id_id_key").on(table.id, table.organizationId),
	unique("media_assets_storage_key_key").on(table.storageKey),
]);

export const socialConnections = pgTable("social_connections", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	brandId: uuid("brand_id").notNull(),
	provider: text().notNull(),
	externalAccountId: text("external_account_id").notNull(),
	displayName: text("display_name"),
	status: text().default('active').notNull(),
	secretRef: text("secret_ref"),
	capabilitiesSnapshot: jsonb("capabilities_snapshot"),
	checkedAt: timestamp("checked_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("social_connections_organization_id_id_key").on(table.id, table.organizationId),
	unique("social_connections_brand_id_provider_external_account_id_key").on(table.brandId, table.provider, table.externalAccountId),
]);

export const contentPlans = pgTable("content_plans", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	brandId: uuid("brand_id").notNull(),
	periodStart: date("period_start").notNull(),
	periodEnd: date("period_end").notNull(),
	status: text().default('draft').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("content_plans_organization_id_id_key").on(table.id, table.organizationId),
]);

export const contentItems = pgTable("content_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	planId: uuid("plan_id").notNull(),
	topic: text().notNull(),
	summaryStatus: text("summary_status").default('draft').notNull(),
	sourceFactIds: text("source_fact_ids").array().default([""]).notNull(),
	version: integer().default(1).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("content_items_organization_id_id_key").on(table.id, table.organizationId),
]);

export const contentVariants = pgTable("content_variants", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	contentItemId: uuid("content_item_id").notNull(),
	provider: text().notNull(),
	locale: text().notNull(),
	editorialStatus: text("editorial_status").default('draft').notNull(),
	currentRevisionId: uuid("current_revision_id"),
	version: integer().default(1).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("content_variants_organization_id_id_key").on(table.id, table.organizationId),
	unique("content_variants_content_item_id_provider_locale_key").on(table.contentItemId, table.provider, table.locale),
]);

export const approvals = pgTable("approvals", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	revisionId: uuid("revision_id").notNull(),
	revisionHash: text("revision_hash").notNull(),
	connectionId: uuid("connection_id").notNull(),
	actorId: uuid("actor_id").notNull(),
	approvedAt: timestamp("approved_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	invalidatedAt: timestamp("invalidated_at", { withTimezone: true, mode: 'string' }),
	invalidatedReason: text("invalidated_reason"),
}, (table) => [
	uniqueIndex("approvals_active_uq").using("btree", table.revisionId.asc().nullsLast().op("uuid_ops"), table.connectionId.asc().nullsLast().op("uuid_ops")).where(sql`(invalidated_at IS NULL)`),
	unique("approvals_organization_id_id_key").on(table.id, table.organizationId),
]);

export const comments = pgTable("comments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	contentItemId: uuid("content_item_id").notNull(),
	revisionId: uuid("revision_id"),
	body: text().notNull(),
	authorId: uuid("author_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, );

export const billingCycles = pgTable("billing_cycles", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	subscriptionId: uuid("subscription_id").notNull(),
	startsAt: timestamp("starts_at", { withTimezone: true, mode: 'string' }).notNull(),
	endsAt: timestamp("ends_at", { withTimezone: true, mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("billing_cycles_organization_id_id_key").on(table.id, table.organizationId),
]);

export const entitlements = pgTable("entitlements", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	cycleId: uuid("cycle_id").notNull(),
	key: text().notNull(),
	limitValue: integer("limit_value").notNull(),
	source: text().default('plan').notNull(),
	effectiveFrom: timestamp("effective_from", { withTimezone: true, mode: 'string' }).notNull(),
	effectiveTo: timestamp("effective_to", { withTimezone: true, mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("entitlements_cycle_idx").using("btree", table.cycleId.asc().nullsLast().op("text_ops"), table.key.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("entitlements_cycle_key_source_uq").using("btree", table.cycleId.asc().nullsLast().op("uuid_ops"), table.key.asc().nullsLast().op("text_ops"), table.source.asc().nullsLast().op("uuid_ops")),
]);

export const invoiceReferences = pgTable("invoice_references", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	externalInvoiceId: text("external_invoice_id").notNull(),
	status: text().notNull(),
	amountMinor: integer("amount_minor"),
	currency: text().default('CAD').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("invoice_references_external_invoice_id_key").on(table.externalInvoiceId),
]);

export const publications = pgTable("publications", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	revisionId: uuid("revision_id").notNull(),
	connectionId: uuid("connection_id").notNull(),
	scheduledAt: timestamp("scheduled_at", { withTimezone: true, mode: 'string' }),
	timezone: text().notNull(),
	status: text().default('unscheduled').notNull(),
	externalId: text("external_id"),
	externalUrl: text("external_url"),
	quotaReservationId: uuid("quota_reservation_id"),
	leaseOwner: text("lease_owner"),
	leaseUntil: timestamp("lease_until", { withTimezone: true, mode: 'string' }),
	cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true, mode: 'string' }),
	nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true, mode: 'string' }),
	attemptCount: integer("attempt_count").default(0).notNull(),
	confirmationKind: text("confirmation_kind"),
	version: integer().default(1).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("publications_due_idx").using("btree", table.status.asc().nullsLast().op("text_ops"), table.nextAttemptAt.asc().nullsLast().op("timestamptz_ops")),
	index("publications_org_date_idx").using("btree", table.organizationId.asc().nullsLast().op("uuid_ops"), table.scheduledAt.asc().nullsLast().op("uuid_ops")),
	unique("publications_organization_id_id_key").on(table.id, table.organizationId),
]);

export const publishingAttempts = pgTable("publishing_attempts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	publicationId: uuid("publication_id").notNull(),
	attemptNumber: integer("attempt_number").notNull(),
	requestKey: text("request_key").notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	finishedAt: timestamp("finished_at", { withTimezone: true, mode: 'string' }),
	outcome: text().default('pending').notNull(),
	safeErrorCode: text("safe_error_code"),
}, (table) => [
	unique("publishing_attempts_publication_id_attempt_number_key").on(table.publicationId, table.attemptNumber),
	unique("publishing_attempts_request_key_key").on(table.requestKey),
]);

export const notifications = pgTable("notifications", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	userId: uuid("user_id").notNull(),
	locale: text().notNull(),
	type: text().notNull(),
	payload: jsonb().default({}).notNull(),
	deliveryKey: text("delivery_key").notNull(),
	readAt: timestamp("read_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("notifications_user_idx").using("btree", table.userId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	unique("notifications_delivery_key_key").on(table.deliveryKey),
]);

export const aiJobs = pgTable("ai_jobs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	brandId: uuid("brand_id").notNull(),
	contentItemId: uuid("content_item_id"),
	promptVersion: text("prompt_version").notNull(),
	model: text(),
	status: text().default('queued').notNull(),
	inputTokens: integer("input_tokens"),
	outputTokens: integer("output_tokens"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	costEstimateMicros: bigint("cost_estimate_micros", { mode: "number" }),
	safeErrorCode: text("safe_error_code"),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }),
	finishedAt: timestamp("finished_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ai_jobs_org_status_idx").using("btree", table.organizationId.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("text_ops")),
	unique("ai_jobs_organization_id_id_key").on(table.id, table.organizationId),
]);

export const analyticsSnapshots = pgTable("analytics_snapshots", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	connectionId: uuid("connection_id").notNull(),
	publicationId: uuid("publication_id"),
	metric: text().notNull(),
	value: numeric(),
	availability: text().notNull(),
	sourceDefinition: text("source_definition").notNull(),
	capturedAt: timestamp("captured_at", { withTimezone: true, mode: 'string' }).notNull(),
}, );

export const outboxEvents = pgTable("outbox_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	type: text().notNull(),
	aggregateType: text("aggregate_type").notNull(),
	aggregateId: uuid("aggregate_id").notNull(),
	payload: jsonb().notNull(),
	correlationId: text("correlation_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	dispatchedAt: timestamp("dispatched_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("outbox_pending_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(dispatched_at IS NULL)`),
]);

export const staffAssignments = pgTable("staff_assignments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	brandId: uuid("brand_id").notNull(),
	userId: uuid("user_id").notNull(),
	role: text().notNull(),
	validFrom: timestamp("valid_from", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	validUntil: timestamp("valid_until", { withTimezone: true, mode: 'string' }).notNull(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("staff_assignments_user_idx").using("btree", table.userId.asc().nullsLast().op("timestamptz_ops"), table.validUntil.asc().nullsLast().op("timestamptz_ops")),
]);

export const supportGrants = pgTable("support_grants", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	actorId: uuid("actor_id").notNull(),
	reason: text().notNull(),
	scope: text().default('metadata').notNull(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'string' }),
}, );

export const webhookEvents = pgTable("webhook_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	provider: text().notNull(),
	externalEventId: text("external_event_id").notNull(),
	eventType: text("event_type").notNull(),
	status: text().default('received').notNull(),
	payloadRef: text("payload_ref"),
	receivedAt: timestamp("received_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	processedAt: timestamp("processed_at", { withTimezone: true, mode: 'string' }),
	payload: jsonb(),
	attempts: integer().default(0).notNull(),
	lastError: text("last_error"),
	organizationId: uuid("organization_id"),
}, (table) => [
	index("webhook_events_pending_idx").using("btree", table.receivedAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = 'received'::text)`),
	unique("webhook_events_provider_external_event_id_key").on(table.provider, table.externalEventId),
]);

export const privacyRequests = pgTable("privacy_requests", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	type: text().notNull(),
	status: text().default('requested').notNull(),
	requestedBy: uuid("requested_by").notNull(),
	verifiedAt: timestamp("verified_at", { withTimezone: true, mode: 'string' }),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, );

export const revisions = pgTable("revisions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	variantId: uuid("variant_id").notNull(),
	number: integer().notNull(),
	caption: text().notNull(),
	mediaManifest: jsonb("media_manifest").default([]).notNull(),
	hash: text().notNull(),
	authorId: uuid("author_id"),
	origin: text().default('manual').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("revisions_organization_id_id_key").on(table.id, table.organizationId),
	unique("revisions_organization_id_variant_id_id_key").on(table.id, table.organizationId, table.variantId),
	unique("revisions_variant_id_number_key").on(table.variantId, table.number),
]);

export const brandGuidelines = pgTable("brand_guidelines", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	brandId: uuid("brand_id").notNull(),
	version: integer().notNull(),
	factsJson: jsonb("facts_json").notNull(),
	toneJson: jsonb("tone_json").notNull(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("brand_guidelines_brand_id_version_key").on(table.brandId, table.version),
]);

export const usageLedger = pgTable("usage_ledger", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "usage_ledger_id_seq", startWith: 1, increment: 1, minValue: 1, cache: 1 }),
	organizationId: uuid("organization_id").notNull(),
	cycleId: uuid("cycle_id").notNull(),
	type: text().notNull(),
	entryKind: text("entry_kind").notNull(),
	delta: integer().notNull(),
	dedupeKey: text("dedupe_key").notNull(),
	reservationId: uuid("reservation_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("usage_ledger_cycle_idx").using("btree", table.cycleId.asc().nullsLast().op("text_ops"), table.type.asc().nullsLast().op("text_ops")),
	unique("usage_ledger_dedupe_key_key").on(table.dedupeKey),
]);

export const auditEvents = pgTable("audit_events", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "audit_events_id_seq", startWith: 1, increment: 1, minValue: 1, cache: 1 }),
	organizationId: uuid("organization_id"),
	actorId: uuid("actor_id"),
	actorKind: text("actor_kind").notNull(),
	action: text().notNull(),
	targetType: text("target_type"),
	targetId: text("target_id"),
	safeMetadata: jsonb("safe_metadata").default({}).notNull(),
	requestId: text("request_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("audit_events_org_date_idx").using("btree", table.organizationId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.asc().nullsLast().op("timestamptz_ops")),
]);

export const users = pgTable("users", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	authSubject: text("auth_subject").notNull(),
	email: text().notNull(),
	emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true, mode: 'string' }),
	uiLocale: text("ui_locale").notNull(),
	status: text().default('active').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	platformRole: text("platform_role"),
}, (table) => [
	uniqueIndex("users_email_active_uq").using("btree", table.email.asc().nullsLast().op("text_ops")).where(sql`(status <> 'deleted'::text)`),
	unique("users_auth_subject_key").on(table.authSubject),
]);

export const sessions = pgTable("sessions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	tokenHash: text("token_hash").notNull(),
	userId: uuid("user_id").notNull(),
	privileged: boolean().default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	idleExpiresAt: timestamp("idle_expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	mfaVerifiedAt: timestamp("mfa_verified_at", { withTimezone: true, mode: 'string' }),
	reauthenticatedAt: timestamp("reauthenticated_at", { withTimezone: true, mode: 'string' }),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'string' }),
	revokedReason: text("revoked_reason"),
}, (table) => [
	index("sessions_user_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")).where(sql`(revoked_at IS NULL)`),
	unique("sessions_token_hash_key").on(table.tokenHash),
]);

export const brandDrafts = pgTable("brand_drafts", {
	brandId: uuid("brand_id").primaryKey().notNull(),
	organizationId: uuid("organization_id").notNull(),
	draftJson: jsonb("draft_json").default({}).notNull(),
	version: integer().default(1).notNull(),
	updatedBy: uuid("updated_by"),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, );

export const memberships = pgTable("memberships", {
	organizationId: uuid("organization_id").notNull(),
	userId: uuid("user_id").notNull(),
	role: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("memberships_user_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	primaryKey({ columns: [table.organizationId, table.userId], name: "memberships_pkey"}),
]);

export const brandAssets = pgTable("brand_assets", {
	organizationId: uuid("organization_id").notNull(),
	brandId: uuid("brand_id").notNull(),
	mediaAssetId: uuid("media_asset_id").notNull(),
	usageRole: text("usage_role").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	primaryKey({ columns: [table.brandId, table.mediaAssetId, table.usageRole], name: "brand_assets_pkey"}),
]);

export const plans = pgTable("plans", {
	code: text().notNull(),
	version: integer().notNull(),
	priceMinor: integer("price_minor").notNull(),
	currency: text().default('CAD').notNull(),
	entitlementsJson: jsonb("entitlements_json").notNull(),
	active: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	primaryKey({ columns: [table.code, table.version], name: "plans_pkey"}),
]);
