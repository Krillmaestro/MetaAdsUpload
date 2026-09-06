import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { asc, sql, eq } from "drizzle-orm";
import { isElevated } from "@/lib/access";

function getTable(type: string) {
  switch (type) {
    case "angles": return schema.angles;
    case "problems": return schema.problems;
    case "products": return schema.products;
    case "formats": return schema.formats;
    case "countries": return schema.countries;
    case "offer-types": return schema.offerTypes;
    case "customer-avatars": return schema.customerAvatars;
    case "script-structures": return schema.scriptStructures;
    default: return null;
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ type: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { type } = await params;
    const table = getTable(type);
    if (!table) return NextResponse.json({ error: "Invalid option type" }, { status: 400 });

    const items = await db.select().from(table).orderBy(asc(table.sortOrder));
    return NextResponse.json(items);
  } catch (error) {
    console.error("Options type GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch options" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ type: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { type } = await params;
    const body = await request.json();
    const { name, code, description } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const table = getTable(type);
    if (!table) return NextResponse.json({ error: "Invalid option type" }, { status: 400 });

    // Get max sortOrder
    const maxResult = await db.select({ max: sql<number>`coalesce(max(${table.sortOrder}), 0)` }).from(table);
    const nextOrder = (maxResult[0]?.max || 0) + 1;

    let values: Record<string, unknown> = { name: name.trim(), sortOrder: nextOrder };

    // Add code field for types that have it
    if (type === "products" || type === "countries" || type === "customer-avatars") {
      if (!code?.trim()) {
        return NextResponse.json({ error: "Code is required" }, { status: 400 });
      }
      values.code = code.trim();
    }

    // Add description for customer-avatars
    if (type === "customer-avatars" && description !== undefined) {
      values.description = description?.trim() || null;
    }

    const [item] = await db.insert(table).values(values as any).returning();
    return NextResponse.json(item, { status: 201 });
  } catch (error: any) {
    if (error?.message?.includes("unique") || error?.code === "23505") {
      return NextResponse.json({ error: "An option with this name or code already exists" }, { status: 400 });
    }
    console.error("Options type POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create option" },
      { status: 500 }
    );
  }
}

// DELETE — soft-deactivate an option (keeps any already-stored values intact).
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ type: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { type } = await params;
    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const table = getTable(type);
    if (!table) return NextResponse.json({ error: "Invalid option type" }, { status: 400 });

    await db.update(table).set({ isActive: false }).where(eq(table.id, id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Options type DELETE error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete option" },
      { status: 500 }
    );
  }
}
