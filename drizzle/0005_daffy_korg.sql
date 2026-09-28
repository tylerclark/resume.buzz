ALTER TABLE "job" ADD COLUMN "tailored_score" integer;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "tailored_score_note" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "tailored_requirements" jsonb;