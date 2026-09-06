import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { isElevated } from "@/lib/access";

// PATCH /api/assignments/:id/versions/:versionId/status — review one file.
// Body: { reviewStatus: "approved" | "needs_review" | "no_status", reviewNote?: string | null }
// ("status" is accepted as an alias for reviewStatus.) Reviewing is an admin job.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Bara admin granskar filer" }, { status: 403 });

    const { id, versionId } = await params;
    const body = await request.json();
    const reviewStatus: string | undefined = body.reviewStatus ?? body.status;
    const validStatuses = ["no_status", "in_progress", "needs_review", "approved"];
    if (!reviewStatus || !validStatuses.includes(reviewStatus)) {
      return NextResponse.json({ error: "Invalid reviewStatus" }, { status: 400 });
    }

    const [version] = await db.select().from(schema.deliverableVersions).where(eq(schema.deliverableVersions.id, versionId));
    if (!version || version.assignmentId !== id) return NextResponse.json({ error: "Version not found" }, { status: 404 });
    if (version.replacedById || version.deletedAt) return NextResponse.json({ error: "Filen är ersatt eller borttagen" }, { status: 400 });

    const patch: Partial<typeof schema.deliverableVersions.$inferInsert> = { reviewStatus };
    if (body.reviewNote !== undefined) patch.reviewNote = typeof body.reviewNote === "string" && body.reviewNote.trim() ? body.reviewNote.trim() : null;
    if (reviewStatus === "approved" && body.reviewNote === undefined) patch.reviewNote = null;

    const [updated] = await db
      .update(schema.deliverableVersions)
      .set(patch)
      .where(eq(schema.deliverableVersions.id, versionId))
      .returning();
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Version status PATCH error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update version status" }, { status: 500 });
  }
}
