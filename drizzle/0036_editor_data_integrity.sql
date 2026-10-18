-- Editor data integrity (18 okt 2026).
-- 1) One row per (entity, day): remove duplicates (keep the newest), then
--    enforce it so syncs can upsert instead of delete+insert.
DELETE FROM insights a USING insights b
WHERE a.entity_type = b.entity_type AND a.entity_id = b.entity_id AND a.date_start = b.date_start
  AND a.breakdown_key IS NULL AND b.breakdown_key IS NULL AND a.id < b.id;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS insights_entity_day_uq ON insights (entity_type, entity_id, date_start) WHERE breakdown_key IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS insights_acct_type_date_idx ON insights (ad_account_id, entity_type, date_start);
--> statement-breakpoint
-- 2) Duplicate of the unique index on ad_bonuses.ad_id.
DROP INDEX IF EXISTS ad_bonuses_status_idx;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS assignments_meta_adset_id_idx ON assignments (meta_adset_id);
--> statement-breakpoint
-- 3) One sync at a time (cron + manual button can no longer overlap).
CREATE TABLE IF NOT EXISTS sync_locks (
  name text PRIMARY KEY,
  locked_until timestamp NOT NULL,
  holder text
);
