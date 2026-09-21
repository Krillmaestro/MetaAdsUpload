-- "Reason to buy" som valbart fält i Creative Brief, samma form som offer_types.
CREATE TABLE IF NOT EXISTS "reasons_to_buy" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL UNIQUE,
  "is_active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN IF NOT EXISTS "reason_to_buy_id" text;
--> statement-breakpoint
ALTER TABLE "brief_templates" ADD COLUMN IF NOT EXISTS "reason_to_buy_id" text;
--> statement-breakpoint
-- Avatar som fritext i Creative Brief (skiljt från de förvalda customer_avatars).
ALTER TABLE "assignments" ADD COLUMN IF NOT EXISTS "avatar_used" text;
--> statement-breakpoint
ALTER TABLE "brief_templates" ADD COLUMN IF NOT EXISTS "avatar_used" text;
