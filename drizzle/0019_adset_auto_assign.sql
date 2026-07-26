-- Auto-assignment from ad set names.
--
-- adset_owners already carries videoEditorId / problem / angle, all filled by
-- hand. These columns add what the name parser can also read, plus a record of
-- WHICH fields the parser set — so a later manual edit is never silently
-- overwritten on the next run. Anything a human touched stays a human's.

ALTER TABLE "adset_owners" ADD COLUMN IF NOT EXISTS "format" text;
--> statement-breakpoint
ALTER TABLE "adset_owners" ADD COLUMN IF NOT EXISTS "landing" text;
--> statement-breakpoint
ALTER TABLE "adset_owners" ADD COLUMN IF NOT EXISTS "country" text;
--> statement-breakpoint
ALTER TABLE "adset_owners" ADD COLUMN IF NOT EXISTS "batch" text;
--> statement-breakpoint
-- Field names the parser last wrote, e.g. ["videoEditorId","format","problem"].
ALTER TABLE "adset_owners" ADD COLUMN IF NOT EXISTS "auto_fields" jsonb DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE "adset_owners" ADD COLUMN IF NOT EXISTS "auto_assigned_at" timestamp;
