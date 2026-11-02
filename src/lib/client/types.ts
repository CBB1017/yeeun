import type { TaskPlan, ScheduleRule, Predicate, Operation, SourceSelector, OutputFormat } from '#lib/shared/plan.ts';

export type { TaskPlan, ScheduleRule, Predicate, Operation, SourceSelector, OutputFormat };

/** Response shapes of the JSON API (dates arrive as ISO strings). */

export type RunState =
	| 'queued'
	| 'preparing'
	| 'executing'
	| 'comparing'
	| 'finalizing'
	| 'completed'
	| 'awaiting_review'
	| 'review_queued'
	| 'disagreed'
	| 'failed'
	| 'cancelled'
	| 'interrupted';

export interface Capabilities {
	checked_at: string | null;
	execution_available: boolean;
	message: string | null;
	runner?: string;
	forbidden_env?: string[];
	claude?: ProviderHealth | null;
	codex?: ProviderHealth | null;
	storage_writable?: boolean | null;
	google_oauth?: boolean;
	google_picker?: boolean;
	smtp_default?: boolean;
	web_push?: boolean;
}

export interface ProviderHealth {
	installed: boolean;
	logged_in: boolean;
	subscription: boolean;
	version: string | null;
	method: string | null;
}

export interface DriveConnection {
	id: string;
	email: string | null;
	status: 'active' | 'reauth_required' | 'revoked';
	createdAt: string;
}

export interface Me {
	user: { id: string; email: string; name: string | null; role: 'admin' | 'user'; timezone: string | null };
	csrfToken: string;
	features: { google: boolean; picker: boolean; push: boolean; vapidPublicKey: string | null };
	drive: DriveConnection | null;
	capabilities: Capabilities;
}

export interface Grant {
	id: string;
	name: string;
	mimeType: string;
	modifiedAt: string | null;
	folderLabel: string | null;
	webViewLink: string | null;
	providerFileId: string;
	createdAt: string;
}

export interface Draft {
	id: string;
	ownerId: string;
	originalPrompt: string;
	plan: TaskPlan;
	revision: number;
	status: 'draft' | 'needs_input' | 'ready' | 'confirmed' | 'discarded';
	confirmedTaskId: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface Schedule {
	id: string;
	taskId: string;
	revision: number;
	rule: ScheduleRule;
	timezone: string;
	active: boolean;
	nextDueAt: string | null;
	watermarkAt: string;
}

export interface Task {
	id: string;
	title: string;
	plan: TaskPlan;
	planRevision: number;
	confirmedAt: string;
	status: 'active' | 'paused' | 'archived';
	createdAt: string;
	updatedAt: string;
}

export interface TaskListItem extends Task {
	schedule: Schedule | null;
}

export interface TaskDetail {
	task: Task;
	schedule: Schedule | null;
	upcoming: string[];
}

export interface VersionFile {
	index: number;
	snapshot_id: string;
	provider_file_id: string;
	name: string;
	mime_type: string;
	provider_revision: string | null;
	provider_modified_at: string | null;
	captured_at: string;
	sha256: string;
	export_format: string | null;
	warnings: string[];
	tables: { label: string; rows: number; columns: number }[];
}

export interface VersionInfo {
	manifest_hash: string;
	files: VersionFile[];
}

export interface PublicRun {
	id: string;
	taskId: string;
	state: RunState;
	round: number;
	trigger: 'manual' | 'schedule' | 'catch_up';
	reviewer: 'claude' | 'codex' | null;
	referenceDate: string | null;
	late: boolean;
	manifestHash: string | null;
	version: VersionInfo | null;
	errorCode: string | null;
	errorStage: string | null;
	errorMessage: string | null;
	retentionStatus: string;
	cancelRequested: boolean;
	reviewRequested: boolean;
	createdAt: string;
	startedAt: string | null;
	finishedAt: string | null;
	title?: string;
}

export interface TypedValue {
	type: 'number' | 'date' | 'string' | 'boolean' | 'count';
	value: string;
}

export interface Claim {
	claim_key: string;
	value: TypedValue;
	unit: string | null;
	evidence_ids: string[];
}

export interface AnalysisResult {
	schema_version: 1;
	run_id: string;
	round: number;
	provider: 'claude' | 'codex';
	manifest_hash: string;
	status: 'ok' | 'unsupported' | 'needs_input';
	summary: string;
	claims: Claim[];
	records: { operation_index: number; source_record_id: string; evidence_ids: string[] }[];
	uncertainties: string[];
}

export interface ReviewOutput {
	verdict: 'agree' | 'disagree';
	differences: Difference[];
	final_summary: string | null;
	uncertainties: string[];
	reviewer: 'claude' | 'codex';
}

export interface Execution {
	round: number;
	provider: 'claude' | 'codex';
	role: 'analysis' | 'review';
	status: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
	errorCode: string | null;
	errorMessage: string | null;
	inputHash: string;
	cliVersion: string | null;
	model: string | null;
	usage: unknown;
	startedAt: string;
	finishedAt: string | null;
	result: AnalysisResult | ReviewOutput | null;
}

export interface Difference {
	field: string;
	claude_value: string | null;
	codex_value: string | null;
	reason: string;
}

export interface CheckFailure {
	provider?: 'claude' | 'codex';
	code: string;
	detail: string;
}

export interface Comparison {
	id: string;
	runId: string;
	round: number;
	reviewer: 'claude' | 'codex' | null;
	manifestHash: string;
	verdict: 'agree' | 'disagree';
	checks: {
		failures: CheckFailure[];
		warnings: string[];
		expected: { index: number; type: string; count: number | null; value: string | null; window: unknown }[];
	};
	differences: Difference[];
	final: { summary: string | null } | null;
	createdAt: string;
}

export interface RunEvent {
	seq: number;
	type: string;
	data: Record<string, unknown>;
	createdAt?: string;
	at?: string;
}

export interface SnapshotInfo {
	id: string;
	name: string;
	providerRevision: string | null;
	providerModifiedAt?: string | null;
	capturedAt: string;
	sha256: string;
	status: 'active' | 'deletion_pending' | 'deleted';
	deletedAt: string | null;
	providerFileId: string;
	driveLink?: string | null;
}

export interface RunNotification {
	id: string;
	event: string;
	channel: 'email' | 'push';
	status: 'pending' | 'sending' | 'sent' | 'suppressed' | 'delivery_failed';
	lastError: string | null;
	createdAt: string;
}

export interface WaitingReason {
	kind: 'lane_review' | 'lane' | 'global';
	blockingRunId: string | null;
	message: string;
}

export interface RunDetail {
	run: PublicRun;
	task: { id: string; title: string } | undefined;
	waiting: WaitingReason | null;
	executions: Execution[];
	comparisons: Comparison[];
	events: RunEvent[];
	snapshots: SnapshotInfo[];
	notifications: RunNotification[];
	retained: { id: string; kind: string; sha256: string; createdAt: string }[];
}

export interface CellValue {
	type: string;
	value: string | null;
	display: string | null;
}

export interface ResultTable {
	operation_index: number;
	window: { from?: string; to?: string; days?: number } | null;
	columns: { column_id: string; label: string }[];
	rows: { record_id: string; cells: Record<string, CellValue> }[];
}

export interface Answer {
	summary: string | null;
	claims: Claim[];
	tables: ResultTable[];
	warnings: string[];
	uncertainties: string[];
	reviewer: 'claude' | 'codex' | null;
	round: number;
	reference_date: string | null;
	late: boolean;
	zero_result: boolean;
}

export interface Artifact {
	id: string;
	filename: string;
	format: string;
	mimeType: string;
	sizeBytes: number;
	sha256: string;
	validation: { reopened?: boolean; checks?: string[]; rowCount?: number | null; formulaInjectionEscaped?: number; has_preview?: boolean };
	createdAt: string;
}

export interface ExternalAction {
	id: string;
	action: string;
	destination: { label?: string } & Record<string, unknown>;
	status: 'pending' | 'approved' | 'executing' | 'executed' | 'rejected' | 'failed' | 'invalidated';
	artifactId: string;
	artifactSha256: string;
	approvalHash: string;
	executedAt: string | null;
	lastError: string | null;
}

export interface RunResult {
	run: PublicRun;
	answer: Answer;
	version: VersionInfo;
	recordCount: number;
	artifacts: Artifact[];
	externalActions: ExternalAction[];
}

export interface EvidenceRow {
	key: string;
	kind: string;
	location: Record<string, string | number | boolean | null>;
	excerpt: string;
	snapshotId: string;
}

export interface RunEvidence {
	evidence: EvidenceRow[];
	snapshots: SnapshotInfo[];
	note: string;
}

export interface NotificationItem {
	id: string;
	runId: string | null;
	taskId: string | null;
	event: string;
	severity: 'normal' | 'error';
	channel: 'email' | 'push';
	status: RunNotification['status'];
	attempts: number;
	lastError: string | null;
	title: string;
	createdAt: string;
	sentAt: string | null;
}

export interface NotificationSettings {
	emailEnabled: boolean;
	pushEnabled: boolean;
	recipientEmail: string | null;
	recipientVerified: boolean;
	pendingRecipient: string | null;
	challengeExpiresAt: string | null;
	smtpProfileId: string | null;
	loginEmail: string | null;
	loginEmailVerified: boolean;
	pushConfigured: boolean;
	vapidPublicKey: string | null;
	pushSubscriptions: { id: string; deviceLabel: string | null; status: string; createdAt: string; expiredAt: string | null }[];
}

export interface SenderProfile {
	id: string;
	label: string;
	fromAddress: string;
	verified: boolean;
	verifiedAt: string | null;
	shared: boolean;
	own: boolean;
	host?: string;
	port?: number;
	secure?: boolean;
	username?: string;
}

export interface Invitation {
	id: string;
	email: string;
	status: 'active' | 'accepted' | 'revoked';
	role: 'admin' | 'user';
	invitedBy: string | null;
	boundUserId: string | null;
	createdAt: string;
	acceptedAt: string | null;
	revokedAt: string | null;
}

export interface StorageRoot {
	id: string;
	label: string;
	hostLabel: string;
	containerPath: string;
	status: 'active' | 'pending_mount' | 'retired';
	createdAt: string;
	activatedAt: string | null;
	references: number;
}
