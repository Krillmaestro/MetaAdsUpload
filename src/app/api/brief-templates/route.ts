import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { desc } from "drizzle-orm";
import { guardAdmin } from "@/lib/auth-helpers";

// Brief templates — reusable starting points so a strategist can create a
// full brief in minutes (part of the Notion exit).

export async function GET() {
  const { error } = await guardAdmin();
  if (error) return error;
  const templates = await db.select().from(schema.briefTemplates).orderBy(desc(schema.briefTemplates.lastUsedAt), desc(schema.briefTemplates.updatedAt));
  return NextResponse.json({ templates });
}

export async function POST(request: NextRequest) {
  const { error } = await guardAdmin();
  if (error) return error;
  try {
    const body = await request.json();
    if (!body.name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });
    const [created] = await db.insert(schema.briefTemplates).values({
      name: body.name.trim(),
      briefContent: body.briefContent ?? null,
      formatId: body.formatId ?? null,
      angleId: body.angleId ?? null,
      productId: body.productId ?? null,
      countryId: body.countryId ?? null,
      offerTypeId: body.offerTypeId ?? null,
      scriptStructureId: body.scriptStructureId ?? null,
      customerAvatarIds: body.customerAvatarIds ?? [],
      estimatedMinutes: body.estimatedMinutes ?? null,
      priority: body.priority ?? "medium",
      references: body.references ?? [],
      scriptContent: body.scriptContent ?? null,
      problemId: body.problemId ?? null,
      landingPage: body.landingPage ?? null,
      assignedToId: body.assignedToId ?? null,
      creativeStrategistId: body.creativeStrategistId ?? null,
      creativeStrategistName: body.creativeStrategistName ?? null,
      description: body.description ?? null,
      hypothesis: body.hypothesis ?? null,
      variableTested: body.variableTested ?? null,
      adType: body.adType ?? null,
      awarenessLevel: body.awarenessLevel ?? null,
      publishTemplateId: typeof body.publishTemplateId === "number" ? body.publishTemplateId : null,
    }).returning();
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    console.error("Brief template POST error:", e);
    return NextResponse.json({ error: "Failed to create template" }, { status: 500 });
  }
}
