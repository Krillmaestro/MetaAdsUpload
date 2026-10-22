// Mirror of drizzle/0038_template_page.sql, bundled so the superadmin endpoint
// /api/admin/migrate can apply it in production.
export const MIGRATION_0038 = {
  name: "0038_template_page",
  /** Read-only check: does the column exist yet? */
  dryRun: `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'templates' AND column_name = 'page_id') AS exists`,
  statements: [`ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "page_id" text`],
};
