import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { eq, and, ne, lt, sql, notInArray } from "drizzle-orm";
import { isElevated } from "@/lib/access";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // Total count
    const [totalResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.assignments);

    // By status — return UPPERCASE keys to match frontend
    const byStatusRows = await db
      .select({
        status: schema.assignments.status,
        count: sql<number>`count(*)`,
      })
      .from(schema.assignments)
      .groupBy(schema.assignments.status);

    const byStatus: Record<string, number> = {};
    for (const row of byStatusRows) {
      byStatus[row.status.toUpperCase()] = row.count;
    }

    // By priority (excluding posted) — UPPERCASE keys
    const byPriorityRows = await db
      .select({
        priority: schema.assignments.priority,
        count: sql<number>`count(*)`,
      })
      .from(schema.assignments)
      .where(ne(schema.assignments.status, "posted"))
      .groupBy(schema.assignments.priority);

    const byPriority: Record<string, number> = {};
    for (const row of byPriorityRows) {
      byPriority[row.priority.toUpperCase()] = row.count;
    }

    // Overdue count
    const [overdueResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.assignments)
      .where(
        and(
          lt(schema.assignments.dueDate, new Date()),
          notInArray(schema.assignments.status, ["posted", "ready_for_posting"])
        )
      );

    // Average time from completed time entries
    const [avgResult] = await db
      .select({ avg: sql<number>`coalesce(avg(${schema.timeEntries.durationSeconds}), 0)` })
      .from(schema.timeEntries)
      .where(
        and(
          eq(schema.timeEntries.status, "completed"),
          sql`${schema.timeEntries.assignmentId} is not null`
        )
      );

    return NextResponse.json({
      total: totalResult.count,
      byStatus,
      byPriority,
      overdue: overdueResult.count,
      avgTimeSeconds: Math.round(avgResult.avg || 0),
    });
  } catch (error) {
    console.error("Stats GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
