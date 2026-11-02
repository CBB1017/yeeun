DROP INDEX "push_subscriptions_endpoint_uq";--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_owner_endpoint_uq" ON "push_subscriptions" USING btree ("owner_id","endpoint_hash");