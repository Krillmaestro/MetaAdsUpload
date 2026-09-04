-- Learning Loop: manual "origin ad set" override per ad (creative).
-- Copies inside CBO scaling containers credit their result to the ABO ad set
-- they were tested in; this column overrides the name/video-id resolution.
ALTER TABLE "ad_owners" ADD COLUMN IF NOT EXISTS "origin_adset_id" text;
--> statement-breakpoint
ALTER TABLE "ad_owners" ADD COLUMN IF NOT EXISTS "origin_source" text;
