import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq, sql } from "drizzle-orm";
import { guardFounder, badRequest, isHexColor } from "@/lib/work-tracker";

// PATCH /api/work/brands/[id]
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await guardFounder();
  if (error) return error;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const updates: Partial<typeof schema.workBrands.$inferInsert> = {};
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return badRequest("name cannot be empty");
    if (name.length > 60) return badRequest("name is too long (max 60)");
    updates.name = name;
  }
  if (body.color !== undefined) {
    if (!isHexColor(body.color)) return badRequest("color must be a hex value like #a78bfa");
    updates.color = body.color;
  }
  if (typeof body.isActive === "boolean") updates.isActive = body.isActive;
  if (typeof body.sortOrder === "number") updates.sortOrder = body.sortOrder;

  if (Object.keys(updates).length === 0) return badRequest("nothing to update");

  try {
    const [row] = await db
      .update(schema.workBrands)
      .set(updates)
      .where(eq(schema.workBrands.id, id))
      .returning();
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch {
    return NextResponse.json({ error: "A brand with that name already exists" }, { status: 409 });
  }
}

// DELETE /api/work/brands/[id] — only when unused
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await guardFounder();
  if (error) return error;

  const { id } = await params;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.workSessions)
    .where(eq(schema.workSessions.brandId, id));

  if (count > 0) {
    return NextResponse.json(
      { error: `${count} logged session(s) use this brand — deactivate it instead of deleting.` },
      { status: 409 }
    );
  }

  await db.delete(schema.workBrands).where(eq(schema.workBrands.id, id));
  return NextResponse.json({ ok: true });
}
