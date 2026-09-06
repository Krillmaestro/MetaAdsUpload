import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { getAssignmentPerformance, type Period } from "@/lib/learning-loop/rows";
import { isElevated } from "@/lib/access";

export const dynamic = "force-dynamic";

/** GET ?period= — the ad sets this brief runs in, with their numbers. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    if (!isElevated(session.user)) {
      const [a] = await db.select({ assignedToId: schema.assignments.assignedToId }).from(schema.assignments).where(eq(schema.assignments.id, id)).limit(1);
      if (!a || a.assignedToId !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const period = (request.nextUrl.searchParams.get("period") as Period) || "30d";
    const data = await getAssignmentPerformance(id, period);
    return NextResponse.json(data);
  } catch (e) {
    console.error("assignment performance failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Kunde inte läsa prestanda" }, { status: 500 });
  }
}
