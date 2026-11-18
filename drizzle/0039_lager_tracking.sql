-- Lager: own stock tracking from a timestamped 3PL report.
-- Physical stock = report units − units shipped after the report + deliveries booked after it.
ALTER TABLE "inventory_counts" ADD COLUMN IF NOT EXISTS "counted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "inventory_products" ADD COLUMN IF NOT EXISTS "open_units" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "inventory_products" ADD COLUMN IF NOT EXISTS "tracking_synced_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_shipments" (
  "id" serial PRIMARY KEY NOT NULL,
  "product_id" text NOT NULL,
  "shopify_order_id" text NOT NULL,
  "fulfillment_id" text NOT NULL,
  "line_item_id" text NOT NULL,
  "units" integer NOT NULL,
  "shipped_at" timestamp with time zone NOT NULL,
  "synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_shipments_key_idx" ON "inventory_shipments" ("fulfillment_id","line_item_id","product_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_shipments_product_idx" ON "inventory_shipments" ("product_id","shipped_at");
