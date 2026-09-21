-- Koppling till Shopify: varje lagerprodukt pekar på den ENDA variant som bär saldot.
-- Dubblettlistningar (t.ex. flera Probiotika-sidor) säljer mot samma fysiska lager.
ALTER TABLE "inventory_products" ADD COLUMN IF NOT EXISTS "shopify_variant_id" text;
--> statement-breakpoint
ALTER TABLE "inventory_products" ADD COLUMN IF NOT EXISTS "shopify_inventory_item_id" text;
--> statement-breakpoint
ALTER TABLE "inventory_products" ADD COLUMN IF NOT EXISTS "shopify_location_id" text;
--> statement-breakpoint
ALTER TABLE "inventory_products" ADD COLUMN IF NOT EXISTS "shopify_synced_at" timestamp;
--> statement-breakpoint
ALTER TABLE "inventory_products" ADD COLUMN IF NOT EXISTS "shopify_last_pushed_units" integer;
--> statement-breakpoint
-- Logg över varje push/pull mot Shopify, så avvikelser går att felsöka i efterhand.
CREATE TABLE IF NOT EXISTS "inventory_shopify_log" (
  "id" serial PRIMARY KEY NOT NULL,
  "product_id" text NOT NULL,
  "direction" text NOT NULL,
  "units" integer,
  "previous_units" integer,
  "ok" boolean DEFAULT true NOT NULL,
  "message" text,
  "created_by_name" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_shopify_log_product_idx" ON "inventory_shopify_log" ("product_id","created_at");
