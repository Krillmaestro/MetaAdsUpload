import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isElevated } from "@/lib/access";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * One endpoint for the three things the page writes:
 *   type "count"    — a physical stock count (the anchor the forecast builds on)
 *   type "po"       — a purchase order placed with the supplier
 *   type "settings" — lead time, safety days, target cover, MOQ, unit cost per product
 */
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const who = session.user.name ?? session.user.email ?? null;

    const body = await request.json();
    const type = body?.type as string;
    const productId = body?.productId as string;
    if (!type) return NextResponse.json({ error: "Saknar 'type'" }, { status: 400 });

    if (type === "count") {
      const units = Number(body.units);
      const countedOn = (body.countedOn as string) || new Date().toISOString().slice(0, 10);
      if (!productId || !Number.isFinite(units) || units < 0) {
        return NextResponse.json({ error: "Ange produkt och ett saldo på noll eller mer" }, { status: 400 });
      }
      const [row] = await db
        .insert(schema.inventoryCounts)
        .values({ productId, units: Math.round(units), countedOn, note: body.note ?? null, createdByName: who })
        .returning();
      return NextResponse.json({ saved: true, count: row });
    }

    if (type === "po") {
      const units = Number(body.units);
      const orderedOn = (body.orderedOn as string) || new Date().toISOString().slice(0, 10);
      if (!productId || !Number.isFinite(units) || units <= 0) {
        return NextResponse.json({ error: "Ange produkt och antal" }, { status: 400 });
      }
      const [row] = await db
        .insert(schema.inventoryPurchaseOrders)
        .values({
          productId,
          units: Math.round(units),
          orderedOn,
          etaOn: body.etaOn || null,
          note: body.note ?? null,
          createdByName: who,
        })
        .returning();
      return NextResponse.json({ saved: true, purchaseOrder: row });
    }

    if (type === "settings") {
      if (!productId) return NextResponse.json({ error: "Saknar produkt" }, { status: 400 });
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      const numeric = ["leadTimeMinDays", "leadTimeMaxDays", "safetyDays", "targetCoverDays", "velocityBasisDays", "moq"] as const;
      for (const key of numeric) if (body[key] !== undefined && body[key] !== null && body[key] !== "") patch[key] = Math.round(Number(body[key]));
      if (body.unitCost !== undefined) patch.unitCost = body.unitCost === "" || body.unitCost === null ? null : Number(body.unitCost);
      if (body.isActive !== undefined) patch.isActive = Boolean(body.isActive);
      await db.update(schema.inventoryProducts).set(patch).where(eq(schema.inventoryProducts.id, productId));
      return NextResponse.json({ saved: true });
    }

    return NextResponse.json({ error: `Okänd typ: ${type}` }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Kunde inte spara" },
      { status: 500 }
    );
  }
}

/** Mark a purchase order as received (or cancelled). */
export async function PATCH(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await request.json();
    const id = body?.id as string;
    if (!id) return NextResponse.json({ error: "Saknar id" }, { status: 400 });

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.status) patch.status = body.status;
    if (body.status === "received") patch.receivedOn = body.receivedOn || new Date().toISOString().slice(0, 10);
    if (body.etaOn !== undefined) patch.etaOn = body.etaOn || null;
    if (body.units !== undefined) patch.units = Math.round(Number(body.units));

    await db.update(schema.inventoryPurchaseOrders).set(patch).where(eq(schema.inventoryPurchaseOrders.id, id));
    return NextResponse.json({ saved: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Kunde inte uppdatera" },
      { status: 500 }
    );
  }
}
