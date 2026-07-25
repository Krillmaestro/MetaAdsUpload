import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { asc } from "drizzle-orm";
import { guardFounder, badRequest, isHexColor } from "@/lib/work-tracker";

// GET /api/work/categories — all work categories (active + inactive, UI filters)
export async function GET() {
  const { error } = await guardFounder();
  if (error) return error;

  const rows = await db
    .select()
    .from(schema.workCategories)
    .orderBy(asc(schema.workCategories.sortOrder), asc(schema.workCategories.name));

  return NextResponse.json(rows);
}

// POST /api/work/categories — add a category
export async function POST(request: NextRequest) {
  const { error } = await guardFounder();
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return badRequest("name is required");
  if (name.length > 60) return badRequest("name is too long (max 60)");

  const color = isHexColor(body.color) ? body.color : "#38bdf8";

  const existing = await db.select({ id: schema.workCategories.id }).from(schema.workCategories);

  try {
    const [row] = await db
      .insert(schema.workCategories)
      .values({ name, color, sortOrder: existing.length })
      .returning();
    return NextResponse.json(row, { status: 201 });
  } catch {
    return NextResponse.json({ error: "A category with that name already exists" }, { status: 409 });
  }
}
