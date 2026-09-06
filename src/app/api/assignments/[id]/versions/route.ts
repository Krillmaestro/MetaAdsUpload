import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { notifyAssignmentEvent } from "@/lib/notifications";
import { eq, inArray } from "drizzle-orm";
import { addDeliverableFile, commentsByFile, listDeliverableFiles } from "@/lib/deliverables";
import { isElevated } from "@/lib/access";

// GET /api/assignments/:id/versions — the assignment's files (one row per
// hook/file; a revision replaces its file). Active files only unless ?all=1.
// Each file carries its root review comments so the editor sees what to fix.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const all = request.nextUrl.searchParams.get("all") === "1";

    const [assignment] = await db.select().from(schema.assignments).where(eq(schema.assignments.id, id));
    if (!assignment) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
    if (!isElevated(session.user) && assignment.assignedToId !== session.user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const files = await listDeliverableFiles(id, { all });
    const uploaderIds = [...new Set(files.map((f) => f.uploadedById))];
    const uploaders = uploaderIds.length
      ? await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, uploaderIds))
      : [];
    const nameOf = new Map(uploaders.map((u) => [u.id, u.name]));
    const comments = await commentsByFile(files.map((f) => f.id));

    return NextResponse.json(files.map((f) => ({
      ...f,
      uploadedBy: { id: f.uploadedById, name: nameOf.get(f.uploadedById) || "Unknown" },
      commentCount: comments.get(f.id)?.length ?? 0,
      comments: comments.get(f.id) ?? [],
    })));
  } catch (error) {
    console.error("Versions GET error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to fetch versions" }, { status: 500 });
  }
}

// POST /api/assignments/:id/versions — register an uploaded file (review page
// "Upload new version" and scripts). Same rules as PUT /deliverable.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const body = await request.json();
    const { r2Key, r2Url, filename, contentType, fileSize, width, height, duration, thumbnailR2Key, thumbnailUrl, hookLabel, replacesId } = body;
    if (!r2Key || !r2Url || !filename || !contentType) {
      return NextResponse.json({ error: "r2Key, r2Url, filename, and contentType are required" }, { status: 400 });
    }

    const [assignment] = await db.select().from(schema.assignments).where(eq(schema.assignments.id, id));
    if (!assignment) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
    if (!isElevated(session.user) && assignment.assignedToId !== session.user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const { version, replaced } = await addDeliverableFile(assignment, session.user.id!, {
      r2Key, r2Url, filename, contentType, fileSize, width, height, duration, thumbnailR2Key, thumbnailUrl, hookLabel, replacesId,
    });
    void notifyAssignmentEvent("version_uploaded", assignment);
    return NextResponse.json({ ...version, replaced: replaced ? { id: replaced.id, filename: replaced.filename, versionNumber: replaced.versionNumber } : null }, { status: 201 });
  } catch (error) {
    console.error("Versions POST error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create version" }, { status: 500 });
  }
}
