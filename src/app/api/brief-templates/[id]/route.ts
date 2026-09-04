import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq, sql } from "drizzle-orm";
import { guardAdmin } from "@/lib/auth-helpers";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await guardAdmin();
  if (error) return error;
  const { id } = await params;
  try {
    const body = await request.json();
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of [
      "name", "briefContent", "formatId", "angleId", "productId", "countryId", "offerTypeId", "scriptStructureId",
      "customerAvatarIds", "estimatedMinutes", "priority", "references", "scriptContent",
      "problemId", "landingPage", "assignedToId", "creativeStrategistId", "creativeStrategistName", "description",
      "hypothesis", "variableTested", "adType", "awarenessLevel", "publishTemplateId",
    ] as const) {
      if (body[key] !== undefined) updates[key] = body[key];
    }
    // { used: true } = the template was applied to a brief — bump usage so the
    // picker can sort the most-used ones first.
    if (body.used === true) {
      updates.useCount = sql`${schema.briefTemplates.useCount} + 1`;
      updates.lastUsedAt = new Date();
    }
    const [updated] = await db.update(schema.briefTemplates).set(updates).where(eq(schema.briefTemplates.id, id)).returning();
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (e) {
    console.error("Brief template PATCH error:", e);
    return NextResponse.json({ error: "Failed to update template" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await guardAdmin();
  if (error) return error;
  const { id } = await params;
  await db.delete(schema.briefTemplates).where(eq(schema.briefTemplates.id, id));
  return NextResponse.json({ success: true });
}
