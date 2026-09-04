import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { notifyAssignmentEvent } from "@/lib/notifications";
import { eq } from "drizzle-orm";
import { approveUnreviewed, composeRevisionFeedback, listDeliverableFiles, FLAGGED } from "@/lib/deliverables";

// PATCH /api/assignments/:id/status
// Body: { status, revisionFeedback? }
//   revision          → feedback = your text + every flagged file's note and
//                        timecoded comments (needs ≥1 flagged file or a text)
//   ready_for_review  → (from revision) every flagged file must be replaced
//   ready_for_posting → no flagged files; unreviewed files count as approved
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const userId = session.user.id;
    const userRole = session.user.role;
    const body = await request.json();
    const { status, revisionFeedback } = body;

    if (!status) return NextResponse.json({ error: "Status is required" }, { status: 400 });

    const dbStatus = String(status).toLowerCase();
    const validStatuses = ["ready_for_editing", "editing_now", "ready_for_review", "revision", "ready_for_posting", "posted"];
    if (!validStatuses.includes(dbStatus)) return NextResponse.json({ error: "Invalid status value" }, { status: 400 });

    const [current] = await db.select().from(schema.assignments).where(eq(schema.assignments.id, id));
    if (!current) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });

    if (userRole !== "admin") {
      if (current.assignedToId !== userId) return NextResponse.json({ error: "Access denied" }, { status: 403 });
      const allowedTransitions: Record<string, string[]> = {
        ready_for_editing: ["editing_now"],
        editing_now: ["ready_for_review"],
        ready_for_review: ["editing_now"],
        revision: ["ready_for_review"],
      };
      if (!allowedTransitions[current.status]?.includes(dbStatus)) {
        return NextResponse.json({ error: "Invalid status transition" }, { status: 403 });
      }
    }

    const updateData: Record<string, unknown> = { status: dbStatus, updatedAt: new Date() };
    if (dbStatus === "editing_now" && !current.startedAt) updateData.startedAt = new Date();
    if (dbStatus === "posted") updateData.completedAt = new Date();

    if (dbStatus === "revision") {
      const { text } = await composeRevisionFeedback(id, revisionFeedback);
      if (!text) return NextResponse.json({ error: "Markera minst en fil för revision eller skriv vad som ska ändras" }, { status: 400 });
      updateData.revisionFeedback = text;
    }

    if (dbStatus === "ready_for_review" && current.status === "revision") {
      const files = await listDeliverableFiles(id);
      const stillFlagged = files.filter((f) => f.reviewStatus === FLAGGED);
      if (stillFlagged.length > 0) {
        return NextResponse.json({
          error: `${stillFlagged.map((f) => f.hookLabel ?? f.filename).join(", ")} är fortfarande markerad för revision — ladda upp den nya versionen först`,
        }, { status: 400 });
      }
    }

    if (dbStatus === "ready_for_posting") {
      const files = await listDeliverableFiles(id);
      const flagged = files.filter((f) => f.reviewStatus === FLAGGED);
      if (flagged.length > 0) {
        return NextResponse.json({
          error: `${flagged.map((f) => f.hookLabel ?? f.filename).join(", ")} väntar på revision — godkänn eller skicka revision först`,
        }, { status: 400 });
      }
      await approveUnreviewed(id);
    }

    const [assignment] = await db
      .update(schema.assignments)
      .set(updateData)
      .where(eq(schema.assignments.id, id))
      .returning();

    if (dbStatus === "revision") {
      void notifyAssignmentEvent("revision_requested", current);
    } else if (dbStatus === "posted") {
      void notifyAssignmentEvent("completed", current);
    }

    return NextResponse.json(assignment);
  } catch (error) {
    console.error("Assignment status PATCH error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update status" }, { status: 500 });
  }
}
