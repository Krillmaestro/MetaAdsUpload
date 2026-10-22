// Mirror of drizzle/0037_b2b_orders.sql, bundled so the superadmin endpoint
// /api/admin/migrate can apply it in production.
export const MIGRATION_0037 = {
  name: "0037_b2b_orders",
  /** Read-only check: does the table exist yet? */
  dryRun: `SELECT to_regclass('public.b2b_orders') IS NOT NULL AS exists`,
  statements: [
    `CREATE TABLE IF NOT EXISTS "b2b_orders" (
      "id" text PRIMARY KEY NOT NULL, "lead_id" text, "customer_name" text NOT NULL, "org_number" text,
      "contact_name" text, "contact_email" text, "invoice_email" text, "city" text, "seller" text,
      "kind" text DEFAULT 'order' NOT NULL, "order_date" date NOT NULL, "shopify_order" text, "fortnox_invoice" text,
      "invoice_status" text DEFAULT 'ej_fakturerad' NOT NULL, "paid_at" date, "lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
      "shipping_cost" real DEFAULT 0 NOT NULL, "commission_paid_at" date, "note" text, "created_by" text,
      "created_at" timestamp DEFAULT now() NOT NULL, "updated_at" timestamp DEFAULT now() NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS "b2b_orders_date_idx" ON "b2b_orders" ("order_date")`,
    `CREATE INDEX IF NOT EXISTS "b2b_orders_lead_idx" ON "b2b_orders" ("lead_id")`,
  ],
};
