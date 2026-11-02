CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"run_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"storage_root_id" uuid NOT NULL,
	"relative_path" text NOT NULL,
	"mime_type" text NOT NULL,
	"filename" text NOT NULL,
	"format" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"validation" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"request_id" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authoring_calls" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"draft_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cli_executions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"run_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"provider" text NOT NULL,
	"role" text NOT NULL,
	"input_hash" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"result" jsonb,
	"error_code" text,
	"error_message" text,
	"exit_code" integer,
	"cli_version" text,
	"model" text,
	"usage" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "cli_executions_provider_ck" CHECK ("cli_executions"."provider" in ('claude','codex')),
	CONSTRAINT "cli_executions_role_ck" CHECK ("cli_executions"."role" in ('analysis','review')),
	CONSTRAINT "cli_executions_status_ck" CHECK ("cli_executions"."status" in ('running','succeeded','failed','cancelled','interrupted'))
);
--> statement-breakpoint
CREATE TABLE "comparisons" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"run_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"reviewer" text,
	"manifest_hash" text NOT NULL,
	"verdict" text NOT NULL,
	"checks" jsonb NOT NULL,
	"differences" jsonb NOT NULL,
	"final" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comparisons_verdict_ck" CHECK ("comparisons"."verdict" in ('agree','disagree'))
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"run_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"evidence_key" text NOT NULL,
	"kind" text NOT NULL,
	"location" jsonb NOT NULL,
	"excerpt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_actions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"artifact_id" uuid NOT NULL,
	"artifact_sha256" text NOT NULL,
	"action" text NOT NULL,
	"destination" jsonb NOT NULL,
	"destination_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"approval_revision" integer DEFAULT 0 NOT NULL,
	"approved_hash" text,
	"approved_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"result_ref" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_actions_status_ck" CHECK ("external_actions"."status" in ('pending','approved','executing','executed','rejected','failed','invalidated')),
	CONSTRAINT "external_actions_action_ck" CHECK ("external_actions"."action" in ('drive_upload_copy','email_attachment'))
);
--> statement-breakpoint
CREATE TABLE "file_grants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider_file_id" text NOT NULL,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"modified_at" timestamp with time zone,
	"folder_label" text,
	"web_view_link" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "file_grants_status_ck" CHECK ("file_grants"."status" in ('active','revoked','missing'))
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"owner_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"resource_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_owner_id_scope_key_pk" PRIMARY KEY("owner_id","scope","key")
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"invited_by" uuid,
	"bound_user_id" uuid,
	"role" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "invitations_status_ck" CHECK ("invitations"."status" in ('active','accepted','revoked')),
	CONSTRAINT "invitations_email_lower_ck" CHECK ("invitations"."email" = lower("invitations"."email")),
	CONSTRAINT "invitations_role_ck" CHECK ("invitations"."role" in ('admin','user'))
);
--> statement-breakpoint
CREATE TABLE "mute_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"mute_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"email_enabled" boolean DEFAULT false NOT NULL,
	"push_enabled" boolean DEFAULT false NOT NULL,
	"recipient_email" text,
	"recipient_verified_at" timestamp with time zone,
	"pending_recipient" text,
	"challenge_hash" text,
	"challenge_expires_at" timestamp with time zone,
	"smtp_profile_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_id" uuid NOT NULL,
	"run_id" uuid,
	"task_id" uuid,
	"event_key" text NOT NULL,
	"event" text NOT NULL,
	"severity" text NOT NULL,
	"channel" text NOT NULL,
	"destination_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "notifications_channel_ck" CHECK ("notifications"."channel" in ('email','push')),
	CONSTRAINT "notifications_severity_ck" CHECK ("notifications"."severity" in ('normal','error')),
	CONSTRAINT "notifications_status_ck" CHECK ("notifications"."status" in ('pending','sending','sent','suppressed','delivery_failed'))
);
--> statement-breakpoint
CREATE TABLE "oauth_connections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_id" uuid NOT NULL,
	"provider" text DEFAULT 'google_drive' NOT NULL,
	"subject" text NOT NULL,
	"email" text,
	"scopes" text[] NOT NULL,
	"encrypted_refresh_token" text,
	"encrypted_access_token" text,
	"access_expires_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_connections_status_ck" CHECK ("oauth_connections"."status" in ('active','reauth_required','revoked'))
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_id" uuid NOT NULL,
	"endpoint_hash" text NOT NULL,
	"encrypted_subscription" text NOT NULL,
	"device_label" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expired_at" timestamp with time zone,
	CONSTRAINT "push_subscriptions_status_ck" CHECK ("push_subscriptions"."status" in ('active','expired','revoked'))
);
--> statement-breakpoint
CREATE TABLE "results" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"run_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"answer" jsonb NOT NULL,
	"version_info" jsonb NOT NULL,
	"record_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retained_copies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"run_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"storage_root_id" uuid NOT NULL,
	"relative_path" text NOT NULL,
	"sha256" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviewer_state" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"next_provider" text DEFAULT 'claude' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"last_advanced_run_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviewer_state_provider_ck" CHECK ("reviewer_state"."next_provider" in ('claude','codex'))
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"occurrence_id" uuid,
	"parent_run_id" uuid,
	"state" text DEFAULT 'queued' NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"reviewer_provider" text,
	"plan_revision" integer NOT NULL,
	"plan" jsonb NOT NULL,
	"reference_date" date,
	"late" boolean DEFAULT false NOT NULL,
	"manifest_hash" text,
	"manifest" jsonb,
	"eligible_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" text,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"review_requested_at" timestamp with time zone,
	"error_code" text,
	"error_stage" text,
	"error_message" text,
	"retention_status" text DEFAULT 'none' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runs_state_ck" CHECK ("runs"."state" in ('queued','preparing','executing','comparing','finalizing','completed','awaiting_review','review_queued','disagreed','failed','cancelled','interrupted')),
	CONSTRAINT "runs_round_ck" CHECK ("runs"."round" in (1,2)),
	CONSTRAINT "runs_trigger_ck" CHECK ("runs"."trigger" in ('manual','schedule','catch_up')),
	CONSTRAINT "runs_reviewer_ck" CHECK ("runs"."reviewer_provider" is null or "runs"."reviewer_provider" in ('claude','codex'))
);
--> statement-breakpoint
CREATE TABLE "schedule_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"schedule_revision" integer NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"missed_from" timestamp with time zone,
	"missed_to" timestamp with time zone,
	"missed_count" integer DEFAULT 0 NOT NULL,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_occurrences_kind_ck" CHECK ("schedule_occurrences"."kind" in ('normal','catch_up'))
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"task_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"rule" jsonb NOT NULL,
	"timezone" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"next_due_at" timestamp with time zone,
	"watermark_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"csrf_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "smtp_profiles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_id" uuid,
	"shared" boolean DEFAULT false NOT NULL,
	"label" text NOT NULL,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"secure" boolean NOT NULL,
	"username" text NOT NULL,
	"encrypted_password" text NOT NULL,
	"from_address" text NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"run_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"grant_id" uuid,
	"provider_file_id" text NOT NULL,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"provider_revision" text,
	"provider_modified_at" timestamp with time zone,
	"captured_at" timestamp with time zone NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"export_format" text,
	"storage_root_id" uuid NOT NULL,
	"relative_path" text NOT NULL,
	"extraction_version" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "source_snapshots_status_ck" CHECK ("source_snapshots"."status" in ('active','deletion_pending','deleted'))
);
--> statement-breakpoint
CREATE TABLE "storage_roots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"label" text NOT NULL,
	"host_label" text NOT NULL,
	"container_path" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	CONSTRAINT "storage_roots_status_ck" CHECK ("storage_roots"."status" in ('active','pending_mount','retired'))
);
--> statement-breakpoint
CREATE TABLE "task_drafts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_id" uuid NOT NULL,
	"original_prompt" text NOT NULL,
	"plan" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"authoring_calls" integer DEFAULT 0 NOT NULL,
	"confirmed_task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_drafts_status_ck" CHECK ("task_drafts"."status" in ('draft','needs_input','ready','confirmed','discarded'))
);
--> statement-breakpoint
CREATE TABLE "task_sources" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"task_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL,
	"provider_file_id" text NOT NULL,
	"selector" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_id" uuid NOT NULL,
	"draft_id" uuid,
	"title" text NOT NULL,
	"plan" jsonb NOT NULL,
	"plan_revision" integer NOT NULL,
	"confirmed_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_status_ck" CHECK ("tasks"."status" in ('active','paused','archived'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"google_sub" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean NOT NULL,
	"name" text,
	"role" text DEFAULT 'user' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"timezone" text,
	"locale" text DEFAULT 'ko-KR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_role_ck" CHECK ("users"."role" in ('admin','user'))
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_storage_root_id_storage_roots_id_fk" FOREIGN KEY ("storage_root_id") REFERENCES "public"."storage_roots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authoring_calls" ADD CONSTRAINT "authoring_calls_draft_id_task_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."task_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_executions" ADD CONSTRAINT "cli_executions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_snapshot_id_source_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."source_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_actions" ADD CONSTRAINT "external_actions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_actions" ADD CONSTRAINT "external_actions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_actions" ADD CONSTRAINT "external_actions_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_grants" ADD CONSTRAINT "file_grants_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_grants" ADD CONSTRAINT "file_grants_connection_id_oauth_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."oauth_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_bound_user_id_users_id_fk" FOREIGN KEY ("bound_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mute_rules" ADD CONSTRAINT "mute_rules_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mute_rules" ADD CONSTRAINT "mute_rules_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_smtp_profile_id_smtp_profiles_id_fk" FOREIGN KEY ("smtp_profile_id") REFERENCES "public"."smtp_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_connections" ADD CONSTRAINT "oauth_connections_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retained_copies" ADD CONSTRAINT "retained_copies_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retained_copies" ADD CONSTRAINT "retained_copies_storage_root_id_storage_roots_id_fk" FOREIGN KEY ("storage_root_id") REFERENCES "public"."storage_roots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviewer_state" ADD CONSTRAINT "reviewer_state_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_occurrences" ADD CONSTRAINT "schedule_occurrences_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_occurrences" ADD CONSTRAINT "schedule_occurrences_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smtp_profiles" ADD CONSTRAINT "smtp_profiles_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_snapshots" ADD CONSTRAINT "source_snapshots_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_snapshots" ADD CONSTRAINT "source_snapshots_grant_id_file_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."file_grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_drafts" ADD CONSTRAINT "task_drafts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_sources" ADD CONSTRAINT "task_sources_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_sources" ADD CONSTRAINT "task_sources_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_sources" ADD CONSTRAINT "task_sources_grant_id_file_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."file_grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_draft_id_task_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."task_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifacts_run_idx" ON "artifacts" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "audit_events_created_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cli_executions_claim_uq" ON "cli_executions" USING btree ("run_id","round","provider","role");--> statement-breakpoint
CREATE UNIQUE INDEX "comparisons_run_round_uq" ON "comparisons" USING btree ("run_id","round");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_run_key_uq" ON "evidence" USING btree ("run_id","evidence_key");--> statement-breakpoint
CREATE UNIQUE INDEX "file_grants_owner_file_active_uq" ON "file_grants" USING btree ("owner_id","provider_file_id") WHERE "file_grants"."status" = 'active';--> statement-breakpoint
CREATE INDEX "file_grants_owner_idx" ON "file_grants" USING btree ("owner_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_email_live_uq" ON "invitations" USING btree ("email") WHERE "invitations"."status" <> 'revoked';--> statement-breakpoint
CREATE UNIQUE INDEX "mute_rules_owner_task_uq" ON "mute_rules" USING btree ("owner_id","task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_event_channel_dest_uq" ON "notifications" USING btree ("event_key","channel","destination_hash");--> statement-breakpoint
CREATE INDEX "notifications_pending_idx" ON "notifications" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_connections_owner_active_uq" ON "oauth_connections" USING btree ("owner_id","provider") WHERE "oauth_connections"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_uq" ON "push_subscriptions" USING btree ("endpoint_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "results_run_uq" ON "results" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "retained_copies_run_idx" ON "retained_copies" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_events_seq_uq" ON "run_events" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "runs_fifo_idx" ON "runs" USING btree ("state","eligible_at","created_at","id");--> statement-breakpoint
CREATE INDEX "runs_owner_idx" ON "runs" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_idem_uq" ON "runs" USING btree ("owner_id","idempotency_key") WHERE "runs"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "runs_occurrence_uq" ON "runs" USING btree ("occurrence_id") WHERE "runs"."occurrence_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_occurrences_uq" ON "schedule_occurrences" USING btree ("task_id","schedule_revision","scheduled_for");--> statement-breakpoint
CREATE UNIQUE INDEX "schedules_task_uq" ON "schedules" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "schedules_due_idx" ON "schedules" USING btree ("active","next_due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "source_snapshots_run_idx" ON "source_snapshots" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_roots_single_active_uq" ON "storage_roots" USING btree ("status") WHERE "storage_roots"."status" = 'active';--> statement-breakpoint
CREATE INDEX "task_drafts_owner_idx" ON "task_drafts" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_sources_task_pos_uq" ON "task_sources" USING btree ("task_id","position");--> statement-breakpoint
CREATE INDEX "tasks_owner_idx" ON "tasks" USING btree ("owner_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_google_sub_uq" ON "users" USING btree ("google_sub");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");