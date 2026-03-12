import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { getInsights, extractPurchases, extractPurchaseValue, calculateROAS } from "@/lib/meta/insights";
import { getCampaigns } from "@/lib/meta/campaigns";

export async function POST(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const today = new Date().toISOString().split("T")[0];
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];

    // Sync campaigns first
    const campaigns = await getCampaigns();
    for (const c of campaigns) {
      await db.insert(schema.campaignsCache).values({
        id: c.id, name: c.name, status: c.status, objective: c.objective,
        dailyBudget: c.daily_budget ? parseFloat(c.daily_budget) / 100 : null,
      }).onConflictDoUpdate({
        target: schema.campaignsCache.id,
        set: { name: c.name, status: c.status, syncedAt: new Date() },
      });
    }

    // Fetch insights at campaign level
    const insights = await getInsights({
      level: "campaign",
      dateRange: { since: sevenDaysAgo, until: today },
    });

    for (const row of insights) {
      const spend = parseFloat(row.spend || "0");
      const purchases = extractPurchases(row.actions);
      const purchaseValue = extractPurchaseValue(row.action_values);

      await db.insert(schema.insights).values({
        entityId: "", // Will need campaign ID from context
        entityType: "campaign",
        dateStart: row.date_start,
        dateStop: row.date_stop,
        spend,
        impressions: parseInt(row.impressions || "0"),
        reach: parseInt(row.reach || "0"),
        clicks: parseInt(row.clicks || "0"),
        ctr: parseFloat(row.ctr || "0"),
        cpc: parseFloat(row.cpc || "0"),
        cpm: parseFloat(row.cpm || "0"),
        purchases,
        purchaseValue,
        roas: calculateROAS(purchaseValue, spend),
      });
    }

    return NextResponse.json({ success: true, synced: insights.length });
  } catch (error) {
    console.error("Sync error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sync failed" }, { status: 500 });
  }
}
