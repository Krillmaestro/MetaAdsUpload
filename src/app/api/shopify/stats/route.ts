import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { desc, gte, and, eq, sql } from "drizzle-orm";
import { format, subDays } from "date-fns";
import { isElevated } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // Fetch last 30 days of shopify daily stats
    const stats = await db
      .select()
      .from(schema.shopifyDailyStats)
      .orderBy(desc(schema.shopifyDailyStats.date))
      .limit(30);

    // Calculate 7-day KPIs
    const sevenDaysAgo = format(subDays(new Date(), 7), "yyyy-MM-dd");
    const last7d = stats.filter((s) => s.date >= sevenDaysAgo);

    let totalRevenue7d = 0;
    let newRevenue7d = 0;
    let newOrders7d = 0;

    for (const day of last7d) {
      totalRevenue7d += day.totalRevenue ?? 0;
      newRevenue7d += day.newCustomerRevenue ?? 0;
      newOrders7d += day.newCustomerOrders ?? 0;
    }

    // Get total Meta spend for the last 7 days (campaign-level)
    const spendRows = await db
      .select({ totalSpend: sql<number>`coalesce(sum(${schema.insights.spend}), 0)` })
      .from(schema.insights)
      .where(
        and(
          gte(schema.insights.dateStart, sevenDaysAgo),
          eq(schema.insights.entityType, "campaign")
        )
      );

    const totalSpend7d = spendRows[0]?.totalSpend || 0;

    const ncRoas7d = totalSpend7d > 0 ? newRevenue7d / totalSpend7d : null;
    const blendedRoas7d = totalSpend7d > 0 ? totalRevenue7d / totalSpend7d : null;
    const newCustomerPct7d = totalRevenue7d > 0 ? (newRevenue7d / totalRevenue7d) * 100 : 0;

    return NextResponse.json({
      stats,
      kpi: {
        ncRoas7d,
        blendedRoas7d,
        newCustomerPct7d,
        newCustomerOrders7d: newOrders7d,
        totalSpend7d,
      },
    });
  } catch (error) {
    console.error("Shopify stats error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
