-- Learning Loop: structured learning per ad set / creative + the Meta Ads Log.
ALTER TABLE "adset_owners" ADD COLUMN IF NOT EXISTS "learning" jsonb;
--> statement-breakpoint
ALTER TABLE "ad_owners" ADD COLUMN IF NOT EXISTS "learning" jsonb;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "loop_journal" (
	"id" text PRIMARY KEY NOT NULL,
	"ad_account_id" text,
	"entry_date" date NOT NULL,
	"kind" text DEFAULT 'note' NOT NULL,
	"title" text,
	"body" text NOT NULL,
	"author_id" text,
	"author_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loop_journal_date_idx" ON "loop_journal" USING btree ("entry_date");
