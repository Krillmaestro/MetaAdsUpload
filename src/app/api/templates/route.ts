import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { guardAdmin } from "@/lib/auth-helpers";

export async function GET() {
  const { error } = await guardAdmin();
  if (error) return error;

  try {
    const templates = await db.select().from(schema.templates).orderBy(schema.templates.createdAt);
    return NextResponse.json({ data: templates });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to fetch templates" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { error } = await guardAdmin();
  if (error) return error;

  try {
    const body = await request.json();

    if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
      return NextResponse.json({ error: "Template name is required" }, { status: 400 });
    }

    // If marking as default, unset other defaults first
    if (body.isDefault) {
      await db.update(schema.templates).set({ isDefault: false });
    }

    const [template] = await db.insert(schema.templates).values({
      name: body.name.trim(),
      isDefault: body.isDefault || false,
      objective: body.objective,
      budgetType: body.budgetType,
      dailyBudget: body.dailyBudget,
      headlines: body.headlines || [],
      primaryTexts: body.primaryTexts || [],
      descriptions: body.descriptions || [],
      ctaType: body.ctaType,
      landingPages: body.landingPages || [],
      targetCountries: body.targetCountries || ["SE"],
      ageMin: body.ageMin ?? null,
      ageMax: body.ageMax ?? null,
      genders: body.genders || null,
      optimizationGoal: body.optimizationGoal,
      conversionEvent: body.conversionEvent,
      bidStrategy: body.bidStrategy,
      adsetNameTemplate: body.adsetNameTemplate,
      adNameTemplate: body.adNameTemplate,
      productName: body.productName || null,
      angleName: body.angleName || null,
      pixelId: body.pixelId || null,
      adAccountId: body.adAccountId || null,
      pageId: body.pageId || null,
    }).returning();
    return NextResponse.json(template);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to create template" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const { error } = await guardAdmin();
  if (error) return error;

  try {
    const body = await request.json();
    const { id, ...rawUpdates } = body;

    if (!id || typeof id !== "number") {
      return NextResponse.json({ error: "Valid template ID is required" }, { status: 400 });
    }

    if (rawUpdates.isDefault) {
      await db.update(schema.templates).set({ isDefault: false });
    }

    // Whitelist allowed fields to prevent field injection
    const allowedFields = [
      "name", "isDefault", "objective", "budgetType", "dailyBudget",
      "headlines", "primaryTexts", "descriptions", "ctaType",
      "landingPages", "targetCountries", "ageMin", "ageMax", "genders",
      "optimizationGoal", "conversionEvent", "bidStrategy",
      "adsetNameTemplate", "adNameTemplate", "productName", "angleName", "pixelId",
      "adAccountId", "pageId",
    ] as const;

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const field of allowedFields) {
      if (field in rawUpdates) {
        updates[field] = rawUpdates[field];
      }
    }

    const [template] = await db.update(schema.templates)
      .set(updates)
      .where(eq(schema.templates.id, id))
      .returning();
    return NextResponse.json(template);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to update template" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const { error } = await guardAdmin();
  if (error) return error;

  try {
    const { id } = await request.json();
    if (!id || typeof id !== "number") {
      return NextResponse.json({ error: "Valid template ID is required" }, { status: 400 });
    }
    await db.delete(schema.templates).where(eq(schema.templates.id, id));
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to delete template" }, { status: 500 });
  }
}
