-- Admin Team Tasks: lightweight admin-to-admin task board (/tasks)
CREATE TABLE IF NOT EXISTS "admin_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"assigned_to_id" text NOT NULL,
	"created_by_id" text NOT NULL,
	"status" text DEFAULT 'todo' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"due_date" timestamp,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_tasks_assigned_to_id_idx" ON "admin_tasks" USING btree ("assigned_to_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_tasks_status_idx" ON "admin_tasks" USING btree ("status");
