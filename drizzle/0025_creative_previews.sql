-- Web previews of the library masters (transcoded by the nightly job).
ALTER TABLE "creatives" ADD COLUMN IF NOT EXISTS "preview_url" text;
--> statement-breakpoint
ALTER TABLE "creatives" ADD COLUMN IF NOT EXISTS "preview_at" timestamp;
--> statement-breakpoint
ALTER TABLE "creatives" ADD COLUMN IF NOT EXISTS "preview_error" text;
