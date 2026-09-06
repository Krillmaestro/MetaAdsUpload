import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { isElevated } from "@/lib/access";

// PATCH /api/assignments/:id/comments/:commentId — update a comment (body, isResolved, reactions)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id, commentId } = await params;
    const body = await request.json();

    // Verify assignment
    const [assignment] = await db.select().from(schema.assignments).where(eq(schema.assignments.id, id));
    if (!assignment) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });

    if (!isElevated(session.user) && assignment.assignedToId !== session.user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Verify comment exists
    const [comment] = await db
      .select()
      .from(schema.reviewComments)
      .where(eq(schema.reviewComments.id, commentId));

    if (!comment) return NextResponse.json({ error: "Comment not found" }, { status: 404 });

    // Only author or admin can edit body; anyone with access can resolve/react
    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    if (body.bodyText !== undefined) {
      if (!isElevated(session.user) && comment.authorId !== session.user.id) {
        return NextResponse.json({ error: "Only the author can edit this comment" }, { status: 403 });
      }
      updateData.body = body.bodyText;
    }

    if (body.isResolved !== undefined) {
      updateData.isResolved = body.isResolved;
    }

    if (body.reactions !== undefined) {
      updateData.reactions = body.reactions;
    }

    const [updated] = await db
      .update(schema.reviewComments)
      .set(updateData)
      .where(eq(schema.reviewComments.id, commentId))
      .returning();

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Comment PATCH error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update comment" },
      { status: 500 }
    );
  }
}

// DELETE /api/assignments/:id/comments/:commentId — delete a comment
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id, commentId } = await params;

    const [assignment] = await db.select().from(schema.assignments).where(eq(schema.assignments.id, id));
    if (!assignment) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });

    // Verify comment exists
    const [comment] = await db
      .select()
      .from(schema.reviewComments)
      .where(eq(schema.reviewComments.id, commentId));

    if (!comment) return NextResponse.json({ error: "Comment not found" }, { status: 404 });

    // Only author or admin can delete
    if (!isElevated(session.user) && comment.authorId !== session.user.id) {
      return NextResponse.json({ error: "Only the author can delete this comment" }, { status: 403 });
    }

    // Delete replies first, then the comment
    await db
      .delete(schema.reviewComments)
      .where(eq(schema.reviewComments.parentCommentId, commentId));

    await db
      .delete(schema.reviewComments)
      .where(eq(schema.reviewComments.id, commentId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Comment DELETE error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete comment" },
      { status: 500 }
    );
  }
}
