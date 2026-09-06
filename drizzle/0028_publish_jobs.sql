-- Upload-to-Meta as a resumable, idempotent job.
CREATE TABLE IF NOT EXISTS "publish_jobs" (
  "id" text PRIMARY KEY NOT NULL,
  "assignment_id" text NOT NULL,
  "created_by_id" text,
  "status" text DEFAULT 'queued' NOT NULL,
  "step" text DEFAULT 'preflight' NOT NULL,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "state" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "next_run_at" timestamp DEFAULT now(),
  "locked_at" timestamp,
  "lock_token" text,
  "total_ads" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "finished_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "publish_jobs_assignment_idx" ON "publish_jobs" ("assignment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "publish_jobs_status_idx" ON "publish_jobs" ("status");
