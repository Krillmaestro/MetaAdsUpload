import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { auth } from "@/auth";
import { MIGRATION_0036 } from "@/db/migrations/0036";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MIGRATIONS = { [MIGRATION_0036.name]: MIGRATION_0036 } as const;

/**
 * Superadmin-only: apply a bundled, idempotent migration in production.
 * Body: { name: "0036_editor_data_integrity", dryRun?: boolean }.
 * dryRun only runs the migration's read-only check.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.user.isSuperadmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { name, dryRun } = (await request.json().catch(() => ({}))) as { name?: string; dryRun?: boolean };
  const migration = name ? MIGRATIONS[name as keyof typeof MIGRATIONS] : undefined;
  if (!migration) return NextResponse.json({ error: `Unknown migration. Known: ${Object.keys(MIGRATIONS).join(", ")}` }, { status: 400 });

  const sql = neon(process.env.DATABASE_URL!.trim());
  const check = await sql.query(migration.dryRun);
  if (dryRun) return NextResponse.json({ name, dryRun: true, check });

  const applied: string[] = [];
  for (const stmt of migration.statements) {
    await sql.query(stmt);
    applied.push(stmt.split("\n")[0].slice(0, 80));
  }
  return NextResponse.json({ name, before: check, applied });
}
