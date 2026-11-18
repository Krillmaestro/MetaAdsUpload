// Mirror of drizzle/0039_lager_tracking.sql, bundled so the superadmin endpoint
// /api/admin/migrate can apply it in production.
export const MIGRATION_0039 = {
  name: "0039_lager_tracking",
  /** Read-only check: does the shipment ledger exist yet? */
  dryRun: `SELECT to_regclass('public.inventory_shipments') IS NOT NULL AS exists`,
  statements: [
    `ALTER TABLE "inventory_counts" ADD COLUMN IF NOT EXISTS "counted_at" timestamp with time zone`,
    `ALTER TABLE "inventory_products" ADD COLUMN IF NOT EXISTS "open_units" integer DEFAULT 0 NOT NULL`,
    `ALTER TABLE "inventory_products" ADD COLUMN IF NOT EXISTS "tracking_synced_at" timestamp with time zone`,
    `CREATE TABLE IF NOT EXISTS "inventory_shipments" (
      "id" serial PRIMARY KEY NOT NULL,
      "product_id" text NOT NULL,
      "shopify_order_id" text NOT NULL,
      "fulfillment_id" text NOT NULL,
      "line_item_id" text NOT NULL,
      "units" integer NOT NULL,
      "shipped_at" timestamp with time zone NOT NULL,
      "synced_at" timestamp with time zone DEFAULT now() NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "inventory_shipments_key_idx" ON "inventory_shipments" ("fulfillment_id","line_item_id","product_id")`,
    `CREATE INDEX IF NOT EXISTS "inventory_shipments_product_idx" ON "inventory_shipments" ("product_id","shipped_at")`,
  ],
};
