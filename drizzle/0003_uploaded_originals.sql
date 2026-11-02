CREATE TABLE "uploaded_originals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"extension" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"storage_root_id" uuid NOT NULL,
	"relative_path" text NOT NULL,
	"archive_name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "uploaded_originals_status_ck" CHECK ("uploaded_originals"."status" in ('active','deleted'))
);
--> statement-breakpoint
ALTER TABLE "task_sources" ALTER COLUMN "grant_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "source_snapshots" ADD COLUMN "upload_id" uuid;--> statement-breakpoint
ALTER TABLE "task_sources" ADD COLUMN "upload_id" uuid;--> statement-breakpoint
ALTER TABLE "uploaded_originals" ADD CONSTRAINT "uploaded_originals_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploaded_originals" ADD CONSTRAINT "uploaded_originals_storage_root_id_storage_roots_id_fk" FOREIGN KEY ("storage_root_id") REFERENCES "public"."storage_roots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "uploaded_originals_owner_idx" ON "uploaded_originals" USING btree ("owner_id","status");--> statement-breakpoint
ALTER TABLE "source_snapshots" ADD CONSTRAINT "source_snapshots_upload_id_uploaded_originals_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploaded_originals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_sources" ADD CONSTRAINT "task_sources_upload_id_uploaded_originals_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploaded_originals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_sources_upload_idx" ON "task_sources" USING btree ("upload_id");--> statement-breakpoint
ALTER TABLE "task_sources" ADD CONSTRAINT "task_sources_one_source_ck" CHECK (num_nonnulls("task_sources"."grant_id", "task_sources"."upload_id") = 1);