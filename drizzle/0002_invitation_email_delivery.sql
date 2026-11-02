ALTER TABLE "invitations" ADD COLUMN "email_status" text DEFAULT 'not_requested' NOT NULL;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "email_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "email_attempted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "email_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "email_last_error" text;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_email_status_ck" CHECK ("invitations"."email_status" in ('not_requested','sending','sent','failed'));--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_email_attempts_ck" CHECK ("invitations"."email_attempts" >= 0);