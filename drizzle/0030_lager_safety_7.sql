-- Kristoffer 21 sep 2026: med 6 veckor (42 dagar) som planeringsgrund räcker 7 dagars marginal.
ALTER TABLE "inventory_products" ALTER COLUMN "safety_days" SET DEFAULT 7;
--> statement-breakpoint
UPDATE "inventory_products" SET "safety_days" = 7, "updated_at" = now() WHERE "safety_days" = 14;
