import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq, and, ne, sql } from "drizzle-orm";
import { guardFounder, badRequest, isHexColor } from "@/lib/work-tracker";

// PATCH /api/work/categories/[id] — rename, recolor, activate/deactivate, reorder
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await guardFounder();
  if (error) return error;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const updates: Partial<typeof schema.workCategories.$inferInsert> = {};
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return badRequest("name cannot be empty");
    if (name.length > 60) return badRequest("name is too long (max 60)");
    updates.name = name;
  }
  if (body.color !== undefined) {
    if (!isHexColor(body.color)) return badRequest("color must be a hex value like #38bdf8");
    updates.color = body.color;
  }
  if (typeof body.isActive === "boolean") updates.isActive = body.isActive;
  if (typeof body.sortOrder === "number") updates.sortOrder = body.sortOrder;

  if (Object.keys(updates).length === 0) return badRequest("nothing to update");

  try {
    const [row] = await db
      .update(schema.workCategories)
      .set(updates)
      .where(eq(schema.workCategories.id, id))
      .returning();
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch {
    return NextResponse.json({ error: "A category with that name already exists" }, { status: 409 });
  }
}

// DELETE /api/work/categories/[id] — only when unused; otherwise deactivate instead
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await guardFounder();
  if (error) return error;

  const { id } = await params;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.workSessions)
    .where(eq(schema.workSessions.categoryId, id));

  if (count > 0) {
    return NextResponse.json(
      { error: `${count} logged session(s) use this category — deactivate it instead of deleting.` },
      { status: 409 }
    );
  }

  // Never leave zero categories behind.
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.workCategories)
    .where(and(ne(schema.workCategories.id, id)));
  if (total === 0) return badRequest("You need at least one category");

  await db.delete(schema.workCategories).where(eq(schema.workCategories.id, id));
  return NextResponse.json({ ok: true });
}
