-- Butiker (B2B): ringlista över återförsäljare med samtalslogg som alla ser.
CREATE TABLE IF NOT EXISTS "retail_leads" (
  "id" text PRIMARY KEY NOT NULL,
  "dedupe_key" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "type" text,
  "address" text,
  "postal_code" text,
  "city" text,
  "county" text,
  "phone" text,
  "email" text,
  "website" text,
  "brands" text,
  "company_form" text,
  "source" text,
  "status" text DEFAULT 'ny' NOT NULL,
  "owner_name" text,
  "next_action_on" date,
  "last_contact_at" timestamp,
  "call_count" integer DEFAULT 0 NOT NULL,
  "last_note" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retail_leads_status_idx" ON "retail_leads" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retail_leads_county_idx" ON "retail_leads" ("county");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "retail_lead_events" (
  "id" text PRIMARY KEY NOT NULL,
  "lead_id" text NOT NULL,
  "kind" text NOT NULL,
  "outcome" text,
  "note" text,
  "by_name" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retail_lead_events_lead_idx" ON "retail_lead_events" ("lead_id", "created_at");
