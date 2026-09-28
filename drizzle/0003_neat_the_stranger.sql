ALTER TABLE "job" ADD COLUMN "status" text DEFAULT 'not_applied' NOT NULL;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "status_at" timestamp;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "applied_at" timestamp;