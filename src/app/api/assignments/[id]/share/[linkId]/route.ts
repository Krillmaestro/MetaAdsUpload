import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { isElevated } from "@/lib/access";

// DELETE /api/assignments/:id/share/:linkId — deactivate a share link
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; linkId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id, linkId } = await params;

    const [assignment] = await db.select().from(schema.assignments).where(eq(schema.assignments.id, id));
    if (!assignment) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });

    if (!isElevated(session.user) && assignment.assignedToId !== session.user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const [link] = await db
      .select()
      .from(schema.shareLinks)
      .where(eq(schema.shareLinks.id, linkId));

    if (!link || link.assignmentId !== id) {
      return NextResponse.json({ error: "Share link not found" }, { status: 404 });
    }

    // Soft-delete by deactivating
    await db
      .update(schema.shareLinks)
      .set({ isActive: false })
      .where(eq(schema.shareLinks.id, linkId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Share link DELETE error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete share link" },
      { status: 500 }
    );
  }
}
