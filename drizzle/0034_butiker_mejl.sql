-- Butiker (B2B): mejlmallar och exakt logg över varje mejl till en butik.
CREATE TABLE IF NOT EXISTS "retail_email_templates" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "subject" text NOT NULL,
  "body" text NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "state" text DEFAULT 'utkast' NOT NULL,
  "notes" text,
  "updated_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "retail_lead_emails" (
  "id" text PRIMARY KEY NOT NULL,
  "lead_id" text NOT NULL,
  "direction" text DEFAULT 'ut' NOT NULL,
  "from_address" text,
  "to_address" text,
  "subject" text NOT NULL,
  "body" text NOT NULL,
  "template_id" text,
  "template_name" text,
  "template_version" integer,
  "sent_at" timestamp DEFAULT now() NOT NULL,
  "by_name" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retail_lead_emails_lead_idx" ON "retail_lead_emails" ("lead_id", "sent_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retail_lead_emails_template_idx" ON "retail_lead_emails" ("template_id");
