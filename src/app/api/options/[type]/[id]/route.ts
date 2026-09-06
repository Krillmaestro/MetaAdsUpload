import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { isElevated } from "@/lib/access";

function getTable(type: string) {
  switch (type) {
    case "angles": return schema.angles;
    case "products": return schema.products;
    case "formats": return schema.formats;
    case "countries": return schema.countries;
    case "offer-types": return schema.offerTypes;
    case "customer-avatars": return schema.customerAvatars;
    default: return null;
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { type, id } = await params;
    const body = await request.json();
    const { name, code, description, isActive, sortOrder } = body;

    const table = getTable(type);
    if (!table) return NextResponse.json({ error: "Invalid option type" }, { status: 400 });

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name.trim();
    if (isActive !== undefined) updateData.isActive = isActive;
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;

    // Handle code for types that have it
    if ((type === "products" || type === "countries" || type === "customer-avatars") && code !== undefined) {
      updateData.code = code.trim();
    }

    // Handle description for customer-avatars
    if (type === "customer-avatars" && description !== undefined) {
      updateData.description = description?.trim() || null;
    }

    const [item] = await db.update(table).set(updateData as any).where(eq(table.id, id)).returning();

    if (!item) {
      return NextResponse.json({ error: "Option not found" }, { status: 404 });
    }

    return NextResponse.json(item);
  } catch (error: any) {
    if (error?.message?.includes("unique") || error?.code === "23505") {
      return NextResponse.json({ error: "An option with this name or code already exists" }, { status: 400 });
    }
    console.error("Options PUT error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update option" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { type, id } = await params;

    const table = getTable(type);
    if (!table) return NextResponse.json({ error: "Invalid option type" }, { status: 400 });

    // Check if option is used in assignments
    let usageColumn: any = null;
    switch (type) {
      case "angles": usageColumn = schema.assignments.angleId; break;
      case "products": usageColumn = schema.assignments.productId; break;
      case "formats": usageColumn = schema.assignments.formatId; break;
      case "countries": usageColumn = schema.assignments.countryId; break;
      case "offer-types": usageColumn = schema.assignments.offerTypeId; break;
    }

    if (usageColumn) {
      const usage = await db.select({ id: schema.assignments.id }).from(schema.assignments).where(eq(usageColumn, id)).limit(1);
      if (usage.length > 0) {
        // Soft delete - deactivate instead
        await db.update(table).set({ isActive: false } as any).where(eq(table.id, id));
        return NextResponse.json({ success: true, softDeleted: true, message: "Option deactivated (in use by assignments)" });
      }
    }

    const deleted = await db.delete(table).where(eq(table.id, id)).returning({ id: table.id });
    if (deleted.length === 0) {
      return NextResponse.json({ error: "Option not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Options DELETE error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete option" },
      { status: 500 }
    );
  }
}
