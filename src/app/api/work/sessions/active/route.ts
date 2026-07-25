import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq, and, ne } from "drizzle-orm";
import { guardFounder } from "@/lib/work-tracker";
import { fetchSessionById } from "@/lib/work-queries";

// GET /api/work/sessions/active — the caller's open (running/paused) session, if any.
// This is what makes the timer survive refreshes, tab closes and device switches.
export async function GET() {
  const { session, error } = await guardFounder();
  if (error) return error;

  const [open] = await db
    .select({ id: schema.workSessions.id })
    .from(schema.workSessions)
    .where(
      and(eq(schema.workSessions.userId, session.user.id), ne(schema.workSessions.status, "done"))
    )
    .limit(1);

  if (!open) return NextResponse.json(null);
  return NextResponse.json(await fetchSessionById(open.id));
}
