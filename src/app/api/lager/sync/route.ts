import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isElevated } from "@/lib/access";
import { syncSales, syncStockFromShopify } from "@/lib/lager/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await request.json().catch(() => ({}));
    const days = Math.min(Math.max(Number(body?.days) || 60, 1), 60);

    const sales = await syncSales(days);
    const stock = await syncStockFromShopify();

    return NextResponse.json({ synced: true, ...sales, stock });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Synk misslyckades" },
      { status: 500 }
    );
  }
}
