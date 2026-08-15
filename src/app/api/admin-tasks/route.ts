import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq, inArray, desc, asc } from "drizzle-orm";
import { sendWhatsApp } from "@/lib/notifications";
import { checkRateLimit } from "@/lib/rate-limit";
import { guardFounder } from "@/lib/work-tracker";

const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

export async function GET() {
  try {
    const { error } = await guardFounder();
    if (error) return error;

    const tasks = await db
      .select()
      .from(schema.adminTasks)
      .orderBy(asc(schema.adminTasks.dueDate), desc(schema.adminTasks.createdAt));

    const userIds = [...new Set(tasks.flatMap((t) => [t.assignedToId, t.createdById]))];
    const users = userIds.length
      ? await db
          .select({ id: schema.users.id, name: schema.users.name })
          .from(schema.users)
          .where(inArray(schema.users.id, userIds))
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.name]));

    return NextResponse.json({
      tasks: tasks.map((t) => ({
        ...t,
        assignedToName: nameById.get(t.assignedToId) ?? "Unknown",
        createdByName: nameById.get(t.createdById) ?? "Unknown",
      })),
    });
  } catch (error) {
    console.error("Admin tasks GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch tasks" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = checkRateLimit(request, 30, 60_000);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { session, error } = await guardFounder();
    if (error) return error;

    const body = await request.json();
    const { title, description, assignedToId, priority = "medium", dueDate } = body;

    if (!title?.trim()) return NextResponse.json({ error: "Title is required" }, { status: 400 });
    if (!assignedToId) return NextResponse.json({ error: "Assignee is required" }, { status: 400 });
    if (!PRIORITIES.includes(priority)) return NextResponse.json({ error: "Invalid priority" }, { status: 400 });

    const [assignee] = await db
      .select({ id: schema.users.id, isFounder: schema.users.isFounder, phone: schema.users.phone })
      .from(schema.users)
      .where(eq(schema.users.id, assignedToId))
      .limit(1);
    if (!assignee || !assignee.isFounder) {
      return NextResponse.json({ error: "Assignee must be a founder" }, { status: 400 });
    }

    const [task] = await db
      .insert(schema.adminTasks)
      .values({
        title: title.trim(),
        description: description?.trim() || null,
        assignedToId,
        createdById: session.user.id,
        priority,
        dueDate: dueDate ? new Date(dueDate) : null,
      })
      .returning();

    // Fire-and-forget WhatsApp ping when assigning a task to someone else
    if (assignee.id !== session.user.id && assignee.phone) {
      const due = task.dueDate ? ` — due ${new Date(task.dueDate).toISOString().slice(0, 10)}` : "";
      sendWhatsApp(assignee.phone, `📋 New task from ${session.user.name || "a founder"}: ${task.title}${due}`).catch(() => {});
    }

    return NextResponse.json({ task });
  } catch (error) {
    console.error("Admin tasks POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create task" },
      { status: 500 }
    );
  }
}
