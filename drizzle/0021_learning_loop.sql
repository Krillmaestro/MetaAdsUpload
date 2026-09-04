-- Learning Loop: brief (assignment) → ad set(s) → result → learning.
--
-- assignments gains the "test" fields from the Evolve roadmap (hypothesis,
-- variable tested, ideation/iteration, awareness level) plus a problem tag and
-- the uploader template it publishes with. brief_templates gains everything a
-- template needs to fill the WHOLE form. adset_owners becomes the join to the
-- brief and carries verdict + learnings per ad set. adsets_cache gets
-- created_time so "days live" is cheap.

ALTER TABLE "assignments" ADD COLUMN IF NOT EXISTS "problem_id" text;
--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN IF NOT EXISTS "hypothesis" text;
--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN IF NOT EXISTS "variable_tested" text;
--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN IF NOT EXISTS "ad_type" text;
--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN IF NOT EXISTS "iteration_of_id" text;
--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN IF NOT EXISTS "awareness_level" text;
--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN IF NOT EXISTS "publish_template_id" integer;
--> statement-breakpoint

ALTER TABLE "brief_templates" ADD COLUMN IF NOT EXISTS "problem_id" text;
--> statement-breakpoint
ALTER TABLE "brief_templates" ADD COLUMN IF NOT EXISTS "landing_page" text;
--> statement-breakpoint
ALTER TABLE "brief_templates" ADD COLUMN IF NOT EXISTS "assigned_to_id" text;
--> statement-breakpoint
ALTER TABLE "brief_templates" ADD COLUMN IF NOT EXISTS "creative_strategist_id" text;
--> statement-breakpoint
ALTER TABLE "brief_templates" ADD COLUMN IF NOT EXISTS "creative_strategist_name" text;
--> statement-breakpoint
ALTER TABLE "brief_templates" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "brief_templates" ADD COLUMN IF NOT EXISTS "hypothesis" text;
--> statement-breakpoint
ALTER TABLE "brief_templates" ADD COLUMN IF NOT EXISTS "variable_tested" text;
--> statement-breakpoint
ALTER TABLE "brief_templates" ADD COLUMN IF NOT EXISTS "ad_type" text;
--> statement-breakpoint
ALTER TABLE "brief_templates" ADD COLUMN IF NOT EXISTS "awareness_level" text;
--> statement-breakpoint
ALTER TABLE "brief_templates" ADD COLUMN IF NOT EXISTS "publish_template_id" integer;
--> statement-breakpoint
ALTER TABLE "brief_templates" ADD COLUMN IF NOT EXISTS "use_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "brief_templates" ADD COLUMN IF NOT EXISTS "last_used_at" timestamp;
--> statement-breakpoint

ALTER TABLE "adset_owners" ADD COLUMN IF NOT EXISTS "assignment_id" text;
--> statement-breakpoint
ALTER TABLE "adset_owners" ADD COLUMN IF NOT EXISTS "link_source" text;
--> statement-breakpoint
ALTER TABLE "adset_owners" ADD COLUMN IF NOT EXISTS "linked_at" timestamp;
--> statement-breakpoint
ALTER TABLE "adset_owners" ADD COLUMN IF NOT EXISTS "learnings" text;
--> statement-breakpoint
ALTER TABLE "adset_owners" ADD COLUMN IF NOT EXISTS "learnings_at" timestamp;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "adset_owners_assignment_idx" ON "adset_owners" USING btree ("assignment_id");
--> statement-breakpoint

ALTER TABLE "adsets_cache" ADD COLUMN IF NOT EXISTS "created_time" timestamp;
--> statement-breakpoint
ALTER TABLE "adsets_cache" ADD COLUMN IF NOT EXISTS "effective_status" text;
