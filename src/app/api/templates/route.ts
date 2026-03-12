import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    const templates = await db.select().from(schema.templates).orderBy(schema.templates.createdAt);
    return NextResponse.json({ data: templates });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to fetch templates" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const [template] = await db.insert(schema.templates).values({
      name: body.name,
      objective: body.objective,
      budgetType: body.budgetType,
      dailyBudget: body.dailyBudget,
      headlines: body.headlines || [],
      primaryTexts: body.primaryTexts || [],
      descriptions: body.descriptions || [],
      linkUrl: body.linkUrl,
      ctaType: body.ctaType,
      targeting: body.targeting || {},
      placements: body.placements || [],
    }).returning();
    return NextResponse.json(template);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create template" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json();
    await db.delete(schema.templates).where(eq(schema.templates.id, id));
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to delete template" }, { status: 500 });
  }
}
