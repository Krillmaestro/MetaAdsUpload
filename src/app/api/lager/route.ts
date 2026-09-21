import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isElevated } from "@/lib/access";
import { ensureCatalog } from "@/lib/lager/catalog";
import { buildForecast } from "@/lib/lager/forecast";
import { db, schema } from "@/db";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    await ensureCatalog();
    const forecast = await buildForecast();
    const orders = await db
      .select()
      .from(schema.inventoryPurchaseOrders)
      .orderBy(desc(schema.inventoryPurchaseOrders.orderedOn))
      .limit(50);

    return NextResponse.json({ ...forecast, purchaseOrders: orders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Kunde inte läsa lagerdata" },
      { status: 500 }
    );
  }
}
