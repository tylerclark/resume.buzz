ALTER TABLE "job" ADD COLUMN "stage" text DEFAULT 'done' NOT NULL;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "cover_stage" text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "cover_error" text;