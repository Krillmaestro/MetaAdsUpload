-- Learning Loop at CREATIVE level.
--
-- CBO scaling campaigns run one ad set with the winners from many briefs, so
-- the brief link, script, verdict and learnings must also live on the ad.
-- Mirrors the loop columns added to adset_owners in 0021.

ALTER TABLE "ad_owners" ADD COLUMN IF NOT EXISTS "assignment_id" text;
--> statement-breakpoint
ALTER TABLE "ad_owners" ADD COLUMN IF NOT EXISTS "link_source" text;
--> statement-breakpoint
ALTER TABLE "ad_owners" ADD COLUMN IF NOT EXISTS "linked_at" timestamp;
--> statement-breakpoint
ALTER TABLE "ad_owners" ADD COLUMN IF NOT EXISTS "hook_label" text;
--> statement-breakpoint
ALTER TABLE "ad_owners" ADD COLUMN IF NOT EXISTS "script" text;
--> statement-breakpoint
ALTER TABLE "ad_owners" ADD COLUMN IF NOT EXISTS "verdict" text;
--> statement-breakpoint
ALTER TABLE "ad_owners" ADD COLUMN IF NOT EXISTS "verdict_at" timestamp;
--> statement-breakpoint
ALTER TABLE "ad_owners" ADD COLUMN IF NOT EXISTS "learnings" text;
--> statement-breakpoint
ALTER TABLE "ad_owners" ADD COLUMN IF NOT EXISTS "learnings_at" timestamp;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_owners_assignment_idx" ON "ad_owners" USING btree ("assignment_id");
