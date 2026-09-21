-- Lager: stock tracking and reorder planning for ApotekHunden (4-6 week supplier lead time).
CREATE TABLE IF NOT EXISTS "inventory_products" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "code" text NOT NULL,
  "match_skus" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "match_titles" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "unit_label" text DEFAULT 'burkar' NOT NULL,
  "lead_time_min_days" integer DEFAULT 28 NOT NULL,
  "lead_time_max_days" integer DEFAULT 42 NOT NULL,
  "safety_days" integer DEFAULT 7 NOT NULL,
  "target_cover_days" integer DEFAULT 90 NOT NULL,
  "velocity_basis_days" integer DEFAULT 30 NOT NULL,
  "moq" integer DEFAULT 0 NOT NULL,
  "unit_cost" real,
  "is_active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_products_code_idx" ON "inventory_products" ("code");
--> statement-breakpoint
-- A physical stock count. The newest count per product is the anchor; sales after it are subtracted.
CREATE TABLE IF NOT EXISTS "inventory_counts" (
  "id" text PRIMARY KEY NOT NULL,
  "product_id" text NOT NULL,
  "counted_on" date NOT NULL,
  "units" integer NOT NULL,
  "source" text DEFAULT 'manual' NOT NULL,
  "note" text,
  "created_by_name" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_counts_product_idx" ON "inventory_counts" ("product_id","counted_on");
--> statement-breakpoint
-- Orders placed with the supplier. Units land in stock on received_on (or eta_on while in transit).
CREATE TABLE IF NOT EXISTS "inventory_purchase_orders" (
  "id" text PRIMARY KEY NOT NULL,
  "product_id" text NOT NULL,
  "units" integer NOT NULL,
  "ordered_on" date NOT NULL,
  "eta_on" date,
  "received_on" date,
  "status" text DEFAULT 'ordered' NOT NULL,
  "note" text,
  "created_by_name" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_po_product_idx" ON "inventory_purchase_orders" ("product_id","ordered_on");
--> statement-breakpoint
-- Units sold per product per day, cached from Shopify line items so the page never waits on the API.
CREATE TABLE IF NOT EXISTS "inventory_sales_daily" (
  "id" serial PRIMARY KEY NOT NULL,
  "product_id" text NOT NULL,
  "sold_on" date NOT NULL,
  "units" integer NOT NULL,
  "orders" integer DEFAULT 0 NOT NULL,
  "synced_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_sales_daily_key_idx" ON "inventory_sales_daily" ("product_id","sold_on");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_sales_daily_date_idx" ON "inventory_sales_daily" ("sold_on");
