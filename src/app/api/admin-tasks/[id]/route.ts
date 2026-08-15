import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { sendWhatsApp } from "@/lib/notifications";

const STATUSES = ["todo", "in_progress", "done"] as const;
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const [existing] = await db.select().from(schema.adminTasks).where(eq(schema.adminTasks.id, id)).limit(1);
    if (!existing) return NextResponse.json({ error: "Task not found" }, { status: 404 });

    const body = await request.json();
    const updates: Partial<typeof schema.adminTasks.$inferInsert> = { updatedAt: new Date() };

    if (body.title !== undefined) {
      if (!body.title?.trim()) return NextResponse.json({ error: "Title cannot be empty" }, { status: 400 });
      updates.title = body.title.trim();
    }
    if (body.description !== undefined) updates.description = body.description?.trim() || null;
    if (body.dueDate !== undefined) updates.dueDate = body.dueDate ? new Date(body.dueDate) : null;
    if (body.priority !== undefined) {
      if (!PRIORITIES.includes(body.priority)) return NextResponse.json({ error: "Invalid priority" }, { status: 400 });
      updates.priority = body.priority;
    }
    if (body.assignedToId !== undefined) {
      const [assignee] = await db
        .select({ id: schema.users.id, role: schema.users.role })
        .from(schema.users)
        .where(eq(schema.users.id, body.assignedToId))
        .limit(1);
      if (!assignee || assignee.role !== "admin") {
        return NextResponse.json({ error: "Assignee must be an admin" }, { status: 400 });
      }
      updates.assignedToId = body.assignedToId;
    }
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      updates.status = body.status;
      if (body.status === "in_progress" && !existing.startedAt) updates.startedAt = new Date();
      if (body.status === "done") updates.completedAt = new Date();
      if (body.status !== "done") updates.completedAt = null;
      if (body.status === "todo") updates.startedAt = null;
    }

    const [task] = await db
      .update(schema.adminTasks)
      .set(updates)
      .where(eq(schema.adminTasks.id, id))
      .returning();

    // Ping the creator when someone else finishes their task
    if (body.status === "done" && existing.status !== "done" && existing.createdById !== session.user.id) {
      const [creator] = await db
        .select({ phone: schema.users.phone })
        .from(schema.users)
        .where(eq(schema.users.id, existing.createdById))
        .limit(1);
      if (creator?.phone) {
        sendWhatsApp(creator.phone, `✅ Task done: ${task.title} (by ${session.user.name || "an admin"})`).catch(() => {});
      }
    }

    return NextResponse.json({ task });
  } catch (error) {
    console.error("Admin task PATCH error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update task" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const [deleted] = await db.delete(schema.adminTasks).where(eq(schema.adminTasks.id, id)).returning();
    if (!deleted) return NextResponse.json({ error: "Task not found" }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Admin task DELETE error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete task" },
      { status: 500 }
    );
  }
}
