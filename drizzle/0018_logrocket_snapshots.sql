-- LogRocket snapshots: one row per pull, never overwritten.
-- The /logrocket page renders the newest row and diffs it against the previous
-- one, so every historical version stays readable.

CREATE TABLE IF NOT EXISTS "logrocket_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"window_start" text NOT NULL,
	"window_end" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_by" text,
	"created_by_name" text,
	"captured_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "logrocket_snapshots_captured_at_idx" ON "logrocket_snapshots" USING btree ("captured_at");
--> statement-breakpoint
-- Exactly one seed row, so the auto-seed on an empty table is idempotent even
-- if two requests race it.
CREATE UNIQUE INDEX IF NOT EXISTS "logrocket_snapshots_single_seed_idx" ON "logrocket_snapshots" ("source") WHERE "source" = 'seed';
