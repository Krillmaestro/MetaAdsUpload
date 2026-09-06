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

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await request.json();
    const { type, items } = body as { type: string; items: { id: string; sortOrder: number }[] };

    if (!type || !items || !Array.isArray(items)) {
      return NextResponse.json({ error: "Type and items array required" }, { status: 400 });
    }

    const table = getTable(type);
    if (!table) return NextResponse.json({ error: "Invalid option type" }, { status: 400 });

    // Update each item's sortOrder
    for (const item of items) {
      await db.update(table).set({ sortOrder: item.sortOrder } as any).where(eq(table.id, item.id));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Reorder error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to reorder options" },
      { status: 500 }
    );
  }
}
