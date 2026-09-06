import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { addDeliverableFile } from "@/lib/deliverables";
import { isElevated } from "@/lib/access";

// PUT /api/assignments/:id/deliverable — register an uploaded file.
// Body: deliverableUrl, deliverableR2Key, filename, contentType, fileSize,
// width, height, duration, thumbnailUrl, hookLabel?, replacesId?
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const body = await request.json();
    const { deliverableUrl, deliverableR2Key, filename, contentType, fileSize, width, height, duration, thumbnailUrl, thumbnailR2Key, hookLabel, replacesId } = body;

    if (!deliverableUrl || !deliverableR2Key) {
      return NextResponse.json({ error: "deliverableUrl and deliverableR2Key are required" }, { status: 400 });
    }

    const [assignment] = await db.select().from(schema.assignments).where(eq(schema.assignments.id, id));
    if (!assignment) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });

    // Editors can only update their own assignments; admins can update any
    if (!isElevated(session.user) && assignment.assignedToId !== session.user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
    if (!isElevated(session.user) && !["ready_for_editing", "editing_now", "revision"].includes(assignment.status)) {
      return NextResponse.json({ error: "Uppladdning är stängd i den här statusen" }, { status: 400 });
    }

    const { version, replaced } = await addDeliverableFile(assignment, session.user.id!, {
      r2Key: deliverableR2Key,
      r2Url: deliverableUrl,
      filename: filename || deliverableR2Key.split("/").pop() || "deliverable",
      contentType,
      fileSize,
      width,
      height,
      duration,
      thumbnailUrl,
      thumbnailR2Key,
      hookLabel,
      replacesId,
    });

    return NextResponse.json({ ...version, replaced: replaced ? { id: replaced.id, filename: replaced.filename, versionNumber: replaced.versionNumber, hookLabel: replaced.hookLabel } : null });
  } catch (error) {
    console.error("Save deliverable error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save deliverable" },
      { status: 500 }
    );
  }
}
