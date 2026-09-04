import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { removeDeliverableFile } from "@/lib/deliverables";

// DELETE /api/assignments/:id/versions/:versionId — remove a file for good.
// Admin: always. Editor: own assignment while it is still being edited.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id, versionId } = await params;

    const [assignment] = await db.select().from(schema.assignments).where(eq(schema.assignments.id, id));
    if (!assignment) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
    if (session.user.role !== "admin") {
      if (assignment.assignedToId !== session.user.id) return NextResponse.json({ error: "Access denied" }, { status: 403 });
      if (!["ready_for_editing", "editing_now", "revision"].includes(assignment.status)) {
        return NextResponse.json({ error: "Filer kan bara tas bort medan uppdraget redigeras" }, { status: 400 });
      }
    }

    const [version] = await db.select().from(schema.deliverableVersions).where(eq(schema.deliverableVersions.id, versionId));
    if (!version || version.assignmentId !== id) return NextResponse.json({ error: "Version not found" }, { status: 404 });
    if (version.deletedAt || version.replacedById) return NextResponse.json({ error: "Filen är redan borttagen" }, { status: 400 });
    if (version.metaAdId) return NextResponse.json({ error: "Filen är uppladdad till Meta och kan inte tas bort här" }, { status: 400 });

    await removeDeliverableFile(version);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Version DELETE error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to delete version" }, { status: 500 });
  }
}
