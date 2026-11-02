import { sql } from 'drizzle-orm';
import {
	bigint,
	bigserial,
	boolean,
	check,
	date,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';

const id = () =>
	uuid('id')
		.primaryKey()
		.default(sql`uuidv7()`);
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () => ts('updated_at').notNull().defaultNow();

// ---------- identity ----------

export const users = pgTable(
	'users',
	{
		id: id(),
		googleSub: text('google_sub').notNull(),
		email: text('email').notNull(),
		emailVerified: boolean('email_verified').notNull(),
		name: text('name'),
		role: text('role').notNull().default('user'),
		active: boolean('active').notNull().default(true),
		timezone: text('timezone'),
		locale: text('locale').notNull().default('ko-KR'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('users_google_sub_uq').on(t.googleSub),
		index('users_email_idx').on(t.email),
		check('users_role_ck', sql`${t.role} in ('admin','user')`)
	]
);

export const invitations = pgTable(
	'invitations',
	{
		id: id(),
		email: text('email').notNull(),
		status: text('status').notNull().default('active'),
		invitedBy: uuid('invited_by').references(() => users.id),
		boundUserId: uuid('bound_user_id').references(() => users.id),
		role: text('role').notNull().default('user'),
		createdAt: createdAt(),
		acceptedAt: ts('accepted_at'),
		revokedAt: ts('revoked_at'),
		emailStatus: text('email_status').notNull().default('not_requested'),
		emailAttempts: integer('email_attempts').notNull().default(0),
		emailAttemptedAt: ts('email_attempted_at'),
		emailSentAt: ts('email_sent_at'),
		emailLastError: text('email_last_error')
	},
	(t) => [
		uniqueIndex('invitations_email_live_uq')
			.on(t.email)
			.where(sql`${t.status} <> 'revoked'`),
		check('invitations_status_ck', sql`${t.status} in ('active','accepted','revoked')`),
		check('invitations_email_lower_ck', sql`${t.email} = lower(${t.email})`),
		check('invitations_role_ck', sql`${t.role} in ('admin','user')`),
		check('invitations_email_status_ck', sql`${t.emailStatus} in ('not_requested','sending','sent','failed')`),
		check('invitations_email_attempts_ck', sql`${t.emailAttempts} >= 0`)
	]
);

export const sessions = pgTable(
	'sessions',
	{
		id: id(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		tokenHash: text('token_hash').notNull(),
		csrfToken: text('csrf_token').notNull(),
		expiresAt: ts('expires_at').notNull(),
		revokedAt: ts('revoked_at'),
		createdAt: createdAt(),
		lastSeenAt: ts('last_seen_at').notNull().defaultNow()
	},
	(t) => [uniqueIndex('sessions_token_hash_uq').on(t.tokenHash), index('sessions_user_idx').on(t.userId)]
);

// ---------- Drive ----------

export const oauthConnections = pgTable(
	'oauth_connections',
	{
		id: id(),
		ownerId: uuid('owner_id')
			.notNull()
			.references(() => users.id),
		provider: text('provider').notNull().default('google_drive'),
		subject: text('subject').notNull(),
		email: text('email'),
		scopes: text('scopes').array().notNull(),
		encryptedRefreshToken: text('encrypted_refresh_token'),
		encryptedAccessToken: text('encrypted_access_token'),
		accessExpiresAt: ts('access_expires_at'),
		status: text('status').notNull().default('active'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('oauth_connections_owner_active_uq')
			.on(t.ownerId, t.provider)
			.where(sql`${t.status} = 'active'`),
		check('oauth_connections_status_ck', sql`${t.status} in ('active','reauth_required','revoked')`)
	]
);

export const fileGrants = pgTable(
	'file_grants',
	{
		id: id(),
		ownerId: uuid('owner_id')
			.notNull()
			.references(() => users.id),
		connectionId: uuid('connection_id')
			.notNull()
			.references(() => oauthConnections.id),
		providerFileId: text('provider_file_id').notNull(),
		name: text('name').notNull(),
		mimeType: text('mime_type').notNull(),
		modifiedAt: ts('modified_at'),
		folderLabel: text('folder_label'),
		webViewLink: text('web_view_link'),
		status: text('status').notNull().default('active'),
		createdAt: createdAt(),
		revokedAt: ts('revoked_at')
	},
	(t) => [
		uniqueIndex('file_grants_owner_file_active_uq')
			.on(t.ownerId, t.providerFileId)
			.where(sql`${t.status} = 'active'`),
		index('file_grants_owner_idx').on(t.ownerId, t.status),
		check('file_grants_status_ck', sql`${t.status} in ('active','revoked','missing')`)
	]
);

// ---------- uploaded originals (files attached from the user's PC) ----------

export const uploadedOriginals = pgTable(
	'uploaded_originals',
	{
		id: id(),
		ownerId: uuid('owner_id')
			.notNull()
			.references(() => users.id),
		/** Display only (path inside the ZIP for unpacked files); never a path segment. */
		displayName: text('display_name').notNull(),
		mimeType: text('mime_type').notNull(),
		extension: text('extension').notNull(),
		sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
		sha256: text('sha256').notNull(),
		storageRootId: uuid('storage_root_id')
			.notNull()
			.references(() => storageRoots.id),
		relativePath: text('relative_path').notNull(),
		archiveName: text('archive_name'),
		status: text('status').notNull().default('active'),
		createdAt: createdAt(),
		deletedAt: ts('deleted_at')
	},
	(t) => [
		index('uploaded_originals_owner_idx').on(t.ownerId, t.status),
		check('uploaded_originals_status_ck', sql`${t.status} in ('active','deleted')`)
	]
);

// ---------- tasks & schedules ----------

export const taskDrafts = pgTable(
	'task_drafts',
	{
		id: id(),
		ownerId: uuid('owner_id')
			.notNull()
			.references(() => users.id),
		originalPrompt: text('original_prompt').notNull(),
		plan: jsonb('plan').notNull(),
		revision: integer('revision').notNull().default(1),
		status: text('status').notNull().default('draft'),
		authoringCalls: integer('authoring_calls').notNull().default(0),
		confirmedTaskId: uuid('confirmed_task_id'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('task_drafts_owner_idx').on(t.ownerId),
		check('task_drafts_status_ck', sql`${t.status} in ('draft','needs_input','ready','confirmed','discarded')`)
	]
);

export const tasks = pgTable(
	'tasks',
	{
		id: id(),
		ownerId: uuid('owner_id')
			.notNull()
			.references(() => users.id),
		draftId: uuid('draft_id').references(() => taskDrafts.id),
		title: text('title').notNull(),
		plan: jsonb('plan').notNull(),
		planRevision: integer('plan_revision').notNull(),
		confirmedAt: ts('confirmed_at').notNull(),
		status: text('status').notNull().default('active'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [index('tasks_owner_idx').on(t.ownerId, t.status), check('tasks_status_ck', sql`${t.status} in ('active','paused','archived')`)]
);

export const taskSources = pgTable(
	'task_sources',
	{
		id: id(),
		taskId: uuid('task_id')
			.notNull()
			.references(() => tasks.id),
		ownerId: uuid('owner_id')
			.notNull()
			.references(() => users.id),
		grantId: uuid('grant_id').references(() => fileGrants.id),
		uploadId: uuid('upload_id').references(() => uploadedOriginals.id),
		providerFileId: text('provider_file_id').notNull(),
		selector: jsonb('selector').notNull().default({}),
		position: integer('position').notNull().default(0)
	},
	(t) => [
		uniqueIndex('task_sources_task_pos_uq').on(t.taskId, t.position),
		index('task_sources_upload_idx').on(t.uploadId),
		check('task_sources_one_source_ck', sql`num_nonnulls(${t.grantId}, ${t.uploadId}) = 1`)
	]
);

export const schedules = pgTable(
	'schedules',
	{
		id: id(),
		taskId: uuid('task_id')
			.notNull()
			.references(() => tasks.id),
		ownerId: uuid('owner_id')
			.notNull()
			.references(() => users.id),
		revision: integer('revision').notNull(),
		rule: jsonb('rule').notNull(),
		timezone: text('timezone').notNull(),
		active: boolean('active').notNull().default(true),
		nextDueAt: ts('next_due_at'),
		watermarkAt: ts('watermark_at').notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [uniqueIndex('schedules_task_uq').on(t.taskId), index('schedules_due_idx').on(t.active, t.nextDueAt)]
);

export const scheduleOccurrences = pgTable(
	'schedule_occurrences',
	{
		id: id(),
		scheduleId: uuid('schedule_id')
			.notNull()
			.references(() => schedules.id),
		taskId: uuid('task_id')
			.notNull()
			.references(() => tasks.id),
		scheduleRevision: integer('schedule_revision').notNull(),
		scheduledFor: ts('scheduled_for').notNull(),
		kind: text('kind').notNull(),
		missedFrom: ts('missed_from'),
		missedTo: ts('missed_to'),
		missedCount: integer('missed_count').notNull().default(0),
		runId: uuid('run_id'),
		createdAt: createdAt()
	},
	(t) => [
		uniqueIndex('schedule_occurrences_uq').on(t.taskId, t.scheduleRevision, t.scheduledFor),
		check('schedule_occurrences_kind_ck', sql`${t.kind} in ('normal','catch_up')`)
	]
);

// ---------- runs ----------

export const RUN_STATES = [
	'queued',
	'preparing',
	'executing',
	'comparing',
	'finalizing',
	'completed',
	'awaiting_review',
	'review_queued',
	'disagreed',
	'failed',
	'cancelled',
	'interrupted'
] as const;
export type RunState = (typeof RUN_STATES)[number];
export const ACTIVE_STATES: RunState[] = ['preparing', 'executing', 'comparing', 'finalizing'];
export const TERMINAL_STATES: RunState[] = ['completed', 'disagreed', 'failed', 'cancelled', 'interrupted'];

export const runs = pgTable(
	'runs',
	{
		id: id(),
		ownerId: uuid('owner_id')
			.notNull()
			.references(() => users.id),
		taskId: uuid('task_id')
			.notNull()
			.references(() => tasks.id),
		trigger: text('trigger').notNull(),
		occurrenceId: uuid('occurrence_id'),
		parentRunId: uuid('parent_run_id'),
		state: text('state').notNull().default('queued'),
		round: integer('round').notNull().default(1),
		reviewerProvider: text('reviewer_provider'),
		planRevision: integer('plan_revision').notNull(),
		plan: jsonb('plan').notNull(),
		referenceDate: date('reference_date', { mode: 'string' }),
		late: boolean('late').notNull().default(false),
		manifestHash: text('manifest_hash'),
		manifest: jsonb('manifest'),
		eligibleAt: ts('eligible_at').notNull().defaultNow(),
		idempotencyKey: text('idempotency_key'),
		leaseOwner: text('lease_owner'),
		leaseExpiresAt: ts('lease_expires_at'),
		heartbeatAt: ts('heartbeat_at'),
		cancelRequestedAt: ts('cancel_requested_at'),
		reviewRequestedAt: ts('review_requested_at'),
		errorCode: text('error_code'),
		errorStage: text('error_stage'),
		errorMessage: text('error_message'),
		retentionStatus: text('retention_status').notNull().default('none'),
		startedAt: ts('started_at'),
		finishedAt: ts('finished_at'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('runs_fifo_idx').on(t.state, t.eligibleAt, t.createdAt, t.id),
		index('runs_owner_idx').on(t.ownerId, t.createdAt),
		uniqueIndex('runs_idem_uq')
			.on(t.ownerId, t.idempotencyKey)
			.where(sql`${t.idempotencyKey} is not null`),
		uniqueIndex('runs_occurrence_uq')
			.on(t.occurrenceId)
			.where(sql`${t.occurrenceId} is not null`),
		check(
			'runs_state_ck',
			sql`${t.state} in ('queued','preparing','executing','comparing','finalizing','completed','awaiting_review','review_queued','disagreed','failed','cancelled','interrupted')`
		),
		check('runs_round_ck', sql`${t.round} in (1,2)`),
		check('runs_trigger_ck', sql`${t.trigger} in ('manual','schedule','catch_up')`),
		check('runs_reviewer_ck', sql`${t.reviewerProvider} is null or ${t.reviewerProvider} in ('claude','codex')`)
	]
);

export const runEvents = pgTable(
	'run_events',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		runId: uuid('run_id')
			.notNull()
			.references(() => runs.id),
		ownerId: uuid('owner_id').notNull(),
		seq: integer('seq').notNull(),
		type: text('type').notNull(),
		data: jsonb('data').notNull().default({}),
		createdAt: createdAt()
	},
	(t) => [uniqueIndex('run_events_seq_uq').on(t.runId, t.seq)]
);

export const sourceSnapshots = pgTable(
	'source_snapshots',
	{
		id: id(),
		runId: uuid('run_id')
			.notNull()
			.references(() => runs.id),
		ownerId: uuid('owner_id').notNull(),
		grantId: uuid('grant_id').references(() => fileGrants.id),
		uploadId: uuid('upload_id').references(() => uploadedOriginals.id),
		providerFileId: text('provider_file_id').notNull(),
		name: text('name').notNull(),
		mimeType: text('mime_type').notNull(),
		providerRevision: text('provider_revision'),
		providerModifiedAt: ts('provider_modified_at'),
		capturedAt: ts('captured_at').notNull(),
		sha256: text('sha256').notNull(),
		sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
		exportFormat: text('export_format'),
		storageRootId: uuid('storage_root_id').notNull(),
		relativePath: text('relative_path').notNull(),
		extractionVersion: text('extraction_version').notNull(),
		status: text('status').notNull().default('active'),
		deletedAt: ts('deleted_at')
	},
	(t) => [
		index('source_snapshots_run_idx').on(t.runId),
		check('source_snapshots_status_ck', sql`${t.status} in ('active','deletion_pending','deleted')`)
	]
);

export const evidence = pgTable(
	'evidence',
	{
		id: id(),
		runId: uuid('run_id')
			.notNull()
			.references(() => runs.id),
		ownerId: uuid('owner_id').notNull(),
		snapshotId: uuid('snapshot_id')
			.notNull()
			.references(() => sourceSnapshots.id),
		evidenceKey: text('evidence_key').notNull(),
		kind: text('kind').notNull(),
		location: jsonb('location').notNull(),
		excerpt: text('excerpt').notNull()
	},
	(t) => [uniqueIndex('evidence_run_key_uq').on(t.runId, t.evidenceKey)]
);

export const cliExecutions = pgTable(
	'cli_executions',
	{
		id: id(),
		runId: uuid('run_id')
			.notNull()
			.references(() => runs.id),
		round: integer('round').notNull(),
		provider: text('provider').notNull(),
		role: text('role').notNull(),
		inputHash: text('input_hash').notNull(),
		status: text('status').notNull().default('running'),
		result: jsonb('result'),
		errorCode: text('error_code'),
		errorMessage: text('error_message'),
		exitCode: integer('exit_code'),
		cliVersion: text('cli_version'),
		model: text('model'),
		usage: jsonb('usage'),
		startedAt: ts('started_at').notNull().defaultNow(),
		finishedAt: ts('finished_at')
	},
	(t) => [
		uniqueIndex('cli_executions_claim_uq').on(t.runId, t.round, t.provider, t.role),
		check('cli_executions_provider_ck', sql`${t.provider} in ('claude','codex')`),
		check('cli_executions_role_ck', sql`${t.role} in ('analysis','review')`),
		check('cli_executions_status_ck', sql`${t.status} in ('running','succeeded','failed','cancelled','interrupted')`)
	]
);

export const authoringCalls = pgTable('authoring_calls', {
	id: id(),
	draftId: uuid('draft_id')
		.notNull()
		.references(() => taskDrafts.id),
	ownerId: uuid('owner_id').notNull(),
	provider: text('provider').notNull(),
	status: text('status').notNull(),
	errorCode: text('error_code'),
	createdAt: createdAt()
});

export const comparisons = pgTable(
	'comparisons',
	{
		id: id(),
		runId: uuid('run_id')
			.notNull()
			.references(() => runs.id),
		round: integer('round').notNull(),
		reviewer: text('reviewer'),
		manifestHash: text('manifest_hash').notNull(),
		verdict: text('verdict').notNull(),
		checks: jsonb('checks').notNull(),
		differences: jsonb('differences').notNull(),
		final: jsonb('final'),
		createdAt: createdAt()
	},
	(t) => [
		uniqueIndex('comparisons_run_round_uq').on(t.runId, t.round),
		check('comparisons_verdict_ck', sql`${t.verdict} in ('agree','disagree')`)
	]
);

export const results = pgTable(
	'results',
	{
		id: id(),
		runId: uuid('run_id')
			.notNull()
			.references(() => runs.id),
		ownerId: uuid('owner_id').notNull(),
		answer: jsonb('answer').notNull(),
		versionInfo: jsonb('version_info').notNull(),
		recordCount: integer('record_count').notNull().default(0),
		createdAt: createdAt()
	},
	(t) => [uniqueIndex('results_run_uq').on(t.runId)]
);

export const storageRoots = pgTable(
	'storage_roots',
	{
		id: id(),
		label: text('label').notNull(),
		hostLabel: text('host_label').notNull(),
		containerPath: text('container_path').notNull(),
		status: text('status').notNull(),
		createdAt: createdAt(),
		activatedAt: ts('activated_at')
	},
	(t) => [
		uniqueIndex('storage_roots_single_active_uq')
			.on(t.status)
			.where(sql`${t.status} = 'active'`),
		check('storage_roots_status_ck', sql`${t.status} in ('active','pending_mount','retired')`)
	]
);

export const artifacts = pgTable(
	'artifacts',
	{
		id: id(),
		runId: uuid('run_id')
			.notNull()
			.references(() => runs.id),
		ownerId: uuid('owner_id').notNull(),
		storageRootId: uuid('storage_root_id')
			.notNull()
			.references(() => storageRoots.id),
		relativePath: text('relative_path').notNull(),
		mimeType: text('mime_type').notNull(),
		filename: text('filename').notNull(),
		format: text('format').notNull(),
		sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
		sha256: text('sha256').notNull(),
		validation: jsonb('validation').notNull(),
		createdAt: createdAt()
	},
	(t) => [index('artifacts_run_idx').on(t.runId)]
);

export const retainedCopies = pgTable(
	'retained_copies',
	{
		id: id(),
		runId: uuid('run_id')
			.notNull()
			.references(() => runs.id),
		ownerId: uuid('owner_id').notNull(),
		kind: text('kind').notNull(),
		storageRootId: uuid('storage_root_id')
			.notNull()
			.references(() => storageRoots.id),
		relativePath: text('relative_path').notNull(),
		sha256: text('sha256').notNull(),
		data: jsonb('data'),
		createdAt: createdAt()
	},
	(t) => [index('retained_copies_run_idx').on(t.runId)]
);

export const reviewerState = pgTable(
	'reviewer_state',
	{
		ownerId: uuid('owner_id')
			.primaryKey()
			.references(() => users.id),
		nextProvider: text('next_provider').notNull().default('claude'),
		revision: integer('revision').notNull().default(0),
		lastAdvancedRunId: uuid('last_advanced_run_id'),
		updatedAt: updatedAt()
	},
	(t) => [check('reviewer_state_provider_ck', sql`${t.nextProvider} in ('claude','codex')`)]
);

// ---------- notifications ----------

export const smtpProfiles = pgTable('smtp_profiles', {
	id: id(),
	ownerId: uuid('owner_id').references(() => users.id),
	shared: boolean('shared').notNull().default(false),
	label: text('label').notNull(),
	host: text('host').notNull(),
	port: integer('port').notNull(),
	secure: boolean('secure').notNull(),
	username: text('username').notNull(),
	encryptedPassword: text('encrypted_password').notNull(),
	fromAddress: text('from_address').notNull(),
	verifiedAt: ts('verified_at'),
	createdAt: createdAt()
});

export const notificationSettings = pgTable('notification_settings', {
	ownerId: uuid('owner_id')
		.primaryKey()
		.references(() => users.id),
	emailEnabled: boolean('email_enabled').notNull().default(false),
	pushEnabled: boolean('push_enabled').notNull().default(false),
	recipientEmail: text('recipient_email'),
	recipientVerifiedAt: ts('recipient_verified_at'),
	pendingRecipient: text('pending_recipient'),
	challengeHash: text('challenge_hash'),
	challengeExpiresAt: ts('challenge_expires_at'),
	smtpProfileId: uuid('smtp_profile_id').references(() => smtpProfiles.id),
	updatedAt: updatedAt()
});

export const notifications = pgTable(
	'notifications',
	{
		id: id(),
		ownerId: uuid('owner_id').notNull(),
		runId: uuid('run_id'),
		taskId: uuid('task_id'),
		eventKey: text('event_key').notNull(),
		event: text('event').notNull(),
		severity: text('severity').notNull(),
		channel: text('channel').notNull(),
		destinationHash: text('destination_hash').notNull(),
		payload: jsonb('payload').notNull(),
		status: text('status').notNull().default('pending'),
		attempts: integer('attempts').notNull().default(0),
		lastError: text('last_error'),
		claimedAt: ts('claimed_at'),
		createdAt: createdAt(),
		sentAt: ts('sent_at')
	},
	(t) => [
		uniqueIndex('notifications_event_channel_dest_uq').on(t.eventKey, t.channel, t.destinationHash),
		index('notifications_pending_idx').on(t.status, t.createdAt),
		check('notifications_channel_ck', sql`${t.channel} in ('email','push')`),
		check('notifications_severity_ck', sql`${t.severity} in ('normal','error')`),
		check('notifications_status_ck', sql`${t.status} in ('pending','sending','sent','suppressed','delivery_failed')`)
	]
);

export const pushSubscriptions = pgTable(
	'push_subscriptions',
	{
		id: id(),
		ownerId: uuid('owner_id')
			.notNull()
			.references(() => users.id),
		endpointHash: text('endpoint_hash').notNull(),
		encryptedSubscription: text('encrypted_subscription').notNull(),
		deviceLabel: text('device_label'),
		status: text('status').notNull().default('active'),
		createdAt: createdAt(),
		expiredAt: ts('expired_at')
	},
	(t) => [
		uniqueIndex('push_subscriptions_owner_endpoint_uq').on(t.ownerId, t.endpointHash),
		check('push_subscriptions_status_ck', sql`${t.status} in ('active','expired','revoked')`)
	]
);

export const muteRules = pgTable(
	'mute_rules',
	{
		id: id(),
		ownerId: uuid('owner_id')
			.notNull()
			.references(() => users.id),
		taskId: uuid('task_id')
			.notNull()
			.references(() => tasks.id),
		muteUntil: ts('mute_until').notNull(),
		createdAt: createdAt()
	},
	(t) => [uniqueIndex('mute_rules_owner_task_uq').on(t.ownerId, t.taskId)]
);

// ---------- external actions ----------

export const externalActions = pgTable(
	'external_actions',
	{
		id: id(),
		ownerId: uuid('owner_id')
			.notNull()
			.references(() => users.id),
		runId: uuid('run_id')
			.notNull()
			.references(() => runs.id),
		artifactId: uuid('artifact_id')
			.notNull()
			.references(() => artifacts.id),
		artifactSha256: text('artifact_sha256').notNull(),
		action: text('action').notNull(),
		destination: jsonb('destination').notNull(),
		destinationHash: text('destination_hash').notNull(),
		status: text('status').notNull().default('pending'),
		approvalRevision: integer('approval_revision').notNull().default(0),
		approvedHash: text('approved_hash'),
		approvedAt: ts('approved_at'),
		executedAt: ts('executed_at'),
		resultRef: text('result_ref'),
		lastError: text('last_error'),
		createdAt: createdAt()
	},
	(t) => [
		check(
			'external_actions_status_ck',
			sql`${t.status} in ('pending','approved','executing','executed','rejected','failed','invalidated')`
		),
		check('external_actions_action_ck', sql`${t.action} in ('drive_upload_copy','email_attachment')`)
	]
);

// ---------- misc ----------

export const auditEvents = pgTable(
	'audit_events',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		actorId: uuid('actor_id'),
		action: text('action').notNull(),
		resourceType: text('resource_type').notNull(),
		resourceId: text('resource_id'),
		requestId: text('request_id'),
		meta: jsonb('meta').notNull().default({}),
		createdAt: createdAt()
	},
	(t) => [index('audit_events_created_idx').on(t.createdAt)]
);

export const idempotencyKeys = pgTable(
	'idempotency_keys',
	{
		ownerId: uuid('owner_id').notNull(),
		scope: text('scope').notNull(),
		key: text('key').notNull(),
		resourceId: text('resource_id').notNull(),
		createdAt: createdAt()
	},
	(t) => [primaryKey({ columns: [t.ownerId, t.scope, t.key] })]
);

export const appSettings = pgTable('app_settings', {
	key: text('key').primaryKey(),
	value: jsonb('value').notNull(),
	updatedAt: updatedAt()
});
