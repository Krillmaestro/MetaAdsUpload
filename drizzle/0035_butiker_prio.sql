-- Butiker (B2B): lokal efterfrågan per butik (våra kunder på orten) och prioritet.
ALTER TABLE "retail_leads" ADD COLUMN IF NOT EXISTS "local_customers" integer;
--> statement-breakpoint
ALTER TABLE "retail_leads" ADD COLUMN IF NOT EXISTS "local_population" integer;
--> statement-breakpoint
ALTER TABLE "retail_leads" ADD COLUMN IF NOT EXISTS "local_index" real;
--> statement-breakpoint
ALTER TABLE "retail_leads" ADD COLUMN IF NOT EXISTS "priority" integer;
--> statement-breakpoint
ALTER TABLE "retail_leads" ADD COLUMN IF NOT EXISTS "priority_note" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retail_leads_priority_idx" ON "retail_leads" ("priority");
