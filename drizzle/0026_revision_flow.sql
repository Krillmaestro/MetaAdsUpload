-- Revision flow: one deliverable row per file (hook), revisions replace files.
ALTER TABLE "deliverable_versions" ADD COLUMN IF NOT EXISTS "hook_label" text;
--> statement-breakpoint
ALTER TABLE "deliverable_versions" ADD COLUMN IF NOT EXISTS "review_note" text;
--> statement-breakpoint
ALTER TABLE "deliverable_versions" ADD COLUMN IF NOT EXISTS "replaced_by_id" text;
--> statement-breakpoint
ALTER TABLE "deliverable_versions" ADD COLUMN IF NOT EXISTS "replaced_at" timestamp;
--> statement-breakpoint
ALTER TABLE "deliverable_versions" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
--> statement-breakpoint
ALTER TABLE "deliverable_versions" ADD COLUMN IF NOT EXISTS "meta_video_id" text;
--> statement-breakpoint
ALTER TABLE "deliverable_versions" ADD COLUMN IF NOT EXISTS "meta_image_hash" text;
--> statement-breakpoint
ALTER TABLE "deliverable_versions" ADD COLUMN IF NOT EXISTS "meta_ad_id" text;
--> statement-breakpoint
ALTER TABLE "deliverable_versions" ADD COLUMN IF NOT EXISTS "creative_id" integer;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "publish_defaults" (
  "id" serial PRIMARY KEY NOT NULL,
  "product_id" text,
  "country_id" text,
  "campaign_id" text,
  "campaign_name" text,
  "template_id" integer,
  "daily_budget" real,
  "landing_page" text,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "publish_defaults_product_country" UNIQUE("product_id","country_id")
);
--> statement-breakpoint
-- Existing rows: derive the hook label from the filename where it follows the convention.
UPDATE "deliverable_versions" SET "hook_label" = upper(substring("filename" from '^\s*([Hh]\d+)\M')) WHERE "hook_label" IS NULL AND "filename" ~* '^\s*H\d+\M';
