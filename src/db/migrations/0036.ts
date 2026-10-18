// Mirror of drizzle/0036_editor_data_integrity.sql, bundled so the superadmin
// endpoint /api/admin/migrate can apply it in production (no local DB access).
export const MIGRATION_0036 = {
  name: "0036_editor_data_integrity",
  /** Read-only check run before applying: how many duplicate insight rows exist. */
  dryRun: `SELECT count(*)::int AS duplicates FROM insights a JOIN insights b
    ON a.entity_type = b.entity_type AND a.entity_id = b.entity_id AND a.date_start = b.date_start
    AND a.breakdown_key IS NULL AND b.breakdown_key IS NULL AND a.id < b.id`,
  statements: [
    `DELETE FROM insights a USING insights b
      WHERE a.entity_type = b.entity_type AND a.entity_id = b.entity_id AND a.date_start = b.date_start
        AND a.breakdown_key IS NULL AND b.breakdown_key IS NULL AND a.id < b.id`,
    `CREATE UNIQUE INDEX IF NOT EXISTS insights_entity_day_uq ON insights (entity_type, entity_id, date_start) WHERE breakdown_key IS NULL`,
    `CREATE INDEX IF NOT EXISTS insights_acct_type_date_idx ON insights (ad_account_id, entity_type, date_start)`,
    `DROP INDEX IF EXISTS ad_bonuses_status_idx`,
    `CREATE INDEX IF NOT EXISTS assignments_meta_adset_id_idx ON assignments (meta_adset_id)`,
    `CREATE TABLE IF NOT EXISTS sync_locks (name text PRIMARY KEY, locked_until timestamp NOT NULL, holder text)`,
  ],
};
