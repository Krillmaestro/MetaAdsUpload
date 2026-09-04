import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { eq, and, or } from "drizzle-orm";
import { generateAutoName } from "@/lib/auto-name";
import { listDeliverableFiles, FLAGGED } from "@/lib/deliverables";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const userId = session.user.id;
    const body = await request.json();
    const { videoLengthSeconds, deliverableUrl } = body;

    const [assignment] = await db.select().from(schema.assignments).where(eq(schema.assignments.id, id));

    if (!assignment) {
      return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
    }

    if (assignment.assignedToId !== userId) {
      return NextResponse.json({ error: "This assignment is not assigned to you" }, { status: 403 });
    }

    // Find and complete active time entry
    const [activeEntry] = await db
      .select()
      .from(schema.timeEntries)
      .where(
        and(
          eq(schema.timeEntries.userId, userId),
          eq(schema.timeEntries.assignmentId, id),
          eq(schema.timeEntries.status, "in_progress")
        )
      );

    if (activeEntry) {
      const endTime = new Date();
      const durationSeconds = Math.floor((endTime.getTime() - new Date(activeEntry.startTime).getTime()) / 1000);

      await db
        .update(schema.timeEntries)
        .set({
          status: "completed",
          endTime,
          durationSeconds,
          videoOutputSeconds: videoLengthSeconds || null,
        })
        .where(eq(schema.timeEntries.id, activeEntry.id));
    }

    // A flagged file must be replaced (or unflagged) before the work goes back to review.
    {
      const files = await listDeliverableFiles(id);
      const stillFlagged = files.filter((f) => f.reviewStatus === FLAGGED);
      if (stillFlagged.length > 0) {
        return NextResponse.json({
          error: `${stillFlagged.map((f) => f.hookLabel ?? f.filename).join(", ")} är fortfarande markerad för revision — ladda upp den nya versionen först`,
        }, { status: 400 });
      }
    }

    // Regenerate auto-name if videoLengthSeconds provided
    let autoName = assignment.autoName;
    if (videoLengthSeconds) {
      autoName = await generateAutoName({
        batchNumber: assignment.batchNumber,
        formatId: assignment.formatId,
        angleId: assignment.angleId,
        productId: assignment.productId,
        countryId: assignment.countryId,
        offerTypeId: assignment.offerTypeId,
        scriptStructureId: assignment.scriptStructureId,
        landingPage: assignment.landingPage,
        assignedToId: assignment.assignedToId,
        creativeStrategistId: assignment.creativeStrategistId,
        creativeStrategistName: assignment.creativeStrategistName,
        videoLengthSeconds,
        createdAt: assignment.createdAt,
      });
    }

    const [updatedAssignment] = await db
      .update(schema.assignments)
      .set({
        status: "ready_for_review",
        videoLengthSeconds: videoLengthSeconds || assignment.videoLengthSeconds,
        deliverableUrl: deliverableUrl || assignment.deliverableUrl,
        autoName,
        updatedAt: new Date(),
      })
      .where(eq(schema.assignments.id, id))
      .returning();

    return NextResponse.json(updatedAssignment);
  } catch (error) {
    console.error("Assignment complete error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to complete assignment" },
      { status: 500 }
    );
  }
}
