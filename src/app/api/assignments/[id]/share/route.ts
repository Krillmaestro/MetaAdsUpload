import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import { isElevated } from "@/lib/access";

// GET /api/assignments/:id/share — list share links for an assignment
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    const [assignment] = await db.select().from(schema.assignments).where(eq(schema.assignments.id, id));
    if (!assignment) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });

    if (!isElevated(session.user) && assignment.assignedToId !== session.user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const links = await db
      .select({
        id: schema.shareLinks.id,
        assignmentId: schema.shareLinks.assignmentId,
        token: schema.shareLinks.token,
        password: schema.shareLinks.password,
        expiresAt: schema.shareLinks.expiresAt,
        createdById: schema.shareLinks.createdById,
        allowComments: schema.shareLinks.allowComments,
        isActive: schema.shareLinks.isActive,
        accessCount: schema.shareLinks.accessCount,
        lastAccessedAt: schema.shareLinks.lastAccessedAt,
        createdAt: schema.shareLinks.createdAt,
        creatorName: schema.users.name,
      })
      .from(schema.shareLinks)
      .leftJoin(schema.users, eq(schema.shareLinks.createdById, schema.users.id))
      .where(eq(schema.shareLinks.assignmentId, id));

    const result = links.map((l) => ({
      ...l,
      // Never expose the password hash to the client
      hasPassword: !!l.password,
      password: undefined,
      createdBy: { id: l.createdById, name: l.creatorName || "Unknown" },
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error("Share links GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch share links" },
      { status: 500 }
    );
  }
}

// POST /api/assignments/:id/share — create a new share link
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const body = await request.json();
    const { password, expiresAt: expiresAtRaw, expiresInDays, allowComments } = body;

    const [assignment] = await db.select().from(schema.assignments).where(eq(schema.assignments.id, id));
    if (!assignment) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });

    if (!isElevated(session.user) && assignment.assignedToId !== session.user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Generate a unique token
    const token = randomBytes(32).toString("base64url");

    // Hash password if provided
    let passwordHash: string | null = null;
    if (password) {
      const bcrypt = await import("bcryptjs");
      passwordHash = await bcrypt.hash(password, 10);
    }

    // Calculate expiration — accept ISO string (expiresAt) or number of days (expiresInDays)
    let expiresAt: Date | null = null;
    if (expiresAtRaw) {
      expiresAt = new Date(expiresAtRaw);
    } else if (expiresInDays && expiresInDays > 0) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiresInDays);
    }

    const [link] = await db
      .insert(schema.shareLinks)
      .values({
        assignmentId: id,
        token,
        password: passwordHash,
        expiresAt,
        createdById: session.user.id!,
        allowComments: allowComments !== false, // default true
      })
      .returning();

    return NextResponse.json({
      ...link,
      hasPassword: !!passwordHash,
      password: undefined,
    }, { status: 201 });
  } catch (error) {
    console.error("Share links POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create share link" },
      { status: 500 }
    );
  }
}
