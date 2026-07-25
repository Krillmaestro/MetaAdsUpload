-- Founder time tracker: work_categories, work_brands, work_sessions + users.is_founder
-- Deliberately separate from `time_entries` (editor scorecards/bonuses) so founder
-- hours never leak into editor stats.

CREATE TABLE IF NOT EXISTS "work_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#38bdf8' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_brands" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#a78bfa' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_brands_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"category_id" text NOT NULL,
	"brand_id" text,
	"task" text,
	"note" text,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"segment_started_at" timestamp,
	"accumulated_seconds" integer DEFAULT 0 NOT NULL,
	"duration_seconds" integer,
	"status" text DEFAULT 'running' NOT NULL,
	"source" text DEFAULT 'timer' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_founder" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_sessions_user_id_idx" ON "work_sessions" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_sessions_started_at_idx" ON "work_sessions" ("started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_sessions_category_id_idx" ON "work_sessions" ("category_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_sessions_status_idx" ON "work_sessions" ("status");--> statement-breakpoint
-- Hard guarantee: at most one open (running/paused) session per person.
CREATE UNIQUE INDEX IF NOT EXISTS "work_sessions_one_open_per_user" ON "work_sessions" ("user_id") WHERE "status" <> 'done';
