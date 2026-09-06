-- Superadmin + per-person access to areas of the app.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_superadmin" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "permissions" jsonb;
--> statement-breakpoint
UPDATE "users" SET "is_superadmin" = true WHERE "email" = 'kristofferjakobsen21@gmail.com';
