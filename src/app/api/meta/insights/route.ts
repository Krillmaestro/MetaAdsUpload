import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const from = searchParams.get("from") || new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
    const to = searchParams.get("to") || new Date().toISOString().split("T")[0];

    // Get campaign-level insights
    const campaignInsights = await db
      .select({
        entityId: schema.insights.entityId,
        spend: sql<number>`sum(${schema.insights.spend})`,
        impressions: sql<number>`sum(${schema.insights.impressions})`,
        reach: sql<number>`sum(${schema.insights.reach})`,
        linkClicks: sql<number>`sum(${schema.insights.linkClicks})`,
        purchases: sql<number>`sum(${schema.insights.purchases})`,
        purchaseValue: sql<number>`sum(${schema.insights.purchaseValue})`,
        videoViews3s: sql<number>`sum(${schema.insights.videoViews3s})`,
      })
      .from(schema.insights)
      .where(
        and(
          eq(schema.insights.entityType, "campaign"),
          gte(schema.insights.dateStart, from),
          lte(schema.insights.dateStop, to)
        )
      )
      .groupBy(schema.insights.entityId);

    // Get campaign metadata
    const campaignsData = await db.select().from(schema.campaignsCache);
    const campaignMap = new Map(campaignsData.map((c) => [c.id, c]));

    // Build campaign rows
    const campaigns = campaignInsights.map((ci) => {
      const meta = campaignMap.get(ci.entityId);
      const spend = ci.spend || 0;
      const impressions = ci.impressions || 0;
      const linkClicks = ci.linkClicks || 0;
      const purchases = ci.purchases || 0;
      const purchaseValue = ci.purchaseValue || 0;
      const videoViews3s = ci.videoViews3s || 0;

      return {
        id: ci.entityId,
        name: meta?.name || ci.entityId,
        status: meta?.status || "UNKNOWN",
        objective: meta?.objective || "",
        dailyBudget: meta?.dailyBudget || 0,
        spend,
        impressions,
        linkClicks,
        ctr: impressions > 0 ? (linkClicks / impressions) * 100 : 0,
        cpc: linkClicks > 0 ? spend / linkClicks : 0,
        cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
        purchases,
        roas: spend > 0 ? purchaseValue / spend : 0,
        hookRate: impressions > 0 ? (videoViews3s / impressions) * 100 : 0,
        holdRate: 0,
      };
    });

    // Summary
    const summary = {
      spend: campaigns.reduce((s, c) => s + c.spend, 0),
      impressions: campaigns.reduce((s, c) => s + c.impressions, 0),
      reach: campaignInsights.reduce((s, c) => s + (c.reach || 0), 0),
      linkClicks: campaigns.reduce((s, c) => s + c.linkClicks, 0),
      ctr: 0,
      cpc: 0,
      cpm: 0,
      purchases: campaigns.reduce((s, c) => s + c.purchases, 0),
      purchaseValue: campaigns.reduce((s, c) => s + c.spend * c.roas, 0),
      roas: 0,
    };
    summary.ctr = summary.impressions > 0 ? (summary.linkClicks / summary.impressions) * 100 : 0;
    summary.cpc = summary.linkClicks > 0 ? summary.spend / summary.linkClicks : 0;
    summary.cpm = summary.impressions > 0 ? (summary.spend / summary.impressions) * 1000 : 0;
    summary.roas = summary.spend > 0 ? summary.purchaseValue / summary.spend : 0;

    return NextResponse.json({ summary, campaigns });
  } catch (error) {
    console.error("Insights API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch insights" },
      { status: 500 }
    );
  }
}
