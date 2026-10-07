CREATE TABLE "job_event" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_event" ADD CONSTRAINT "job_event_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_event" ADD CONSTRAINT "job_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_event_user_at_idx" ON "job_event" USING btree ("user_id","at");--> statement-breakpoint
-- Backfill what the job rows already know: when each was applied to, and when it reached its current status.
INSERT INTO "job_event" ("id", "job_id", "user_id", "status", "at")
SELECT gen_random_uuid()::text, "id", "user_id", 'applied', "applied_at" FROM "job" WHERE "applied_at" IS NOT NULL;--> statement-breakpoint
INSERT INTO "job_event" ("id", "job_id", "user_id", "status", "at")
SELECT gen_random_uuid()::text, "id", "user_id", "status", "status_at" FROM "job"
WHERE "status_at" IS NOT NULL AND "status" NOT IN ('not_applied', 'applied');
