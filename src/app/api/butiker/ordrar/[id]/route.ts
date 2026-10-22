import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isElevated } from "@/lib/access";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { orderFields } from "../body";

export const dynamic = "force-dynamic";

/** Edit an order: status, invoice, paid dates, lines. Only the fields sent change. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { id } = await params;
    const f = orderFields(await request.json());
    if ("customerName" in f && !f.customerName) return NextResponse.json({ error: "Kunden behöver ett namn" }, { status: 400 });
    if ("lines" in f && !(f.lines as unknown[]).length) return NextResponse.json({ error: "Ordern behöver minst en rad" }, { status: 400 });

    const [row] = await db.update(schema.b2bOrders)
      .set({ ...(f as Partial<typeof schema.b2bOrders.$inferInsert>), updatedAt: new Date() })
      .where(eq(schema.b2bOrders.id, id)).returning();
    if (!row) return NextResponse.json({ error: "Ordern finns inte" }, { status: 404 });
    return NextResponse.json({ saved: true, order: row });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Kunde inte spara" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { id } = await params;
    const [row] = await db.delete(schema.b2bOrders).where(eq(schema.b2bOrders.id, id)).returning({ id: schema.b2bOrders.id });
    if (!row) return NextResponse.json({ error: "Ordern finns inte" }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Kunde inte ta bort" }, { status: 500 });
  }
}
