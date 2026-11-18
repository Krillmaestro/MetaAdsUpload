import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isElevated } from "@/lib/access";
import { ensureCatalog } from "@/lib/lager/catalog";
import { buildForecast } from "@/lib/lager/forecast";
import { syncTracking } from "@/lib/lager/tracking";
import { db, schema } from "@/db";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    await ensureCatalog();
    // Keep the shipment ledger current; a Shopify hiccup must not take the page down.
    const trackingError = await syncTracking({ ifStale: true }).then(
      () => null,
      (e: unknown) => (e instanceof Error ? e.message : "Spårningen kunde inte uppdateras")
    );
    const forecast = await buildForecast();
    const orders = await db
      .select()
      .from(schema.inventoryPurchaseOrders)
      .orderBy(desc(schema.inventoryPurchaseOrders.orderedOn))
      .limit(50);

    return NextResponse.json({ ...forecast, purchaseOrders: orders, trackingError });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Kunde inte läsa lagerdata" },
      { status: 500 }
    );
  }
}
