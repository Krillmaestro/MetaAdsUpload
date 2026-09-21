import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { syncSales, syncStockFromShopify } from "@/lib/lager/sync";
import { checkScopes, pushStock } from "@/lib/lager/shopify-stock";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

/** Nightly: refresh units sold per product so the reorder dates stay current. */
export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const sales = await syncSales(60);
    const stock = await syncStockFromShopify();

    // Push the freshly recalculated stock to Shopify, but only for products that are
    // linked and actually have a count behind them. Silent no-op until the scopes exist.
    let pushed = 0;
    const scopes = await checkScopes().catch(() => null);
    if (scopes?.canWrite) {
      const products = await db.select().from(schema.inventoryProducts);
      for (const p of products) {
        if (!p.isActive || !p.shopifyInventoryItemId) continue;
        const res = await pushStock(p.id, "cron");
        if (res.ok) pushed++;
      }
    }

    return NextResponse.json({ ok: true, ...sales, stock, pushedToShopify: pushed });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 500 }
    );
  }
}
