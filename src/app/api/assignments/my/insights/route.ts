import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { and, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { getEvolveSettings } from "@/lib/evolve/settings";
import { getUsdAccountIds, usdFactor } from "@/lib/money";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The signed-in editor's posted ads with their numbers, from the synced
 * insights table (USD, same conversion and purchase definition as /editors).
 * Previously one live Meta call per posted ad, on every page load.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sp = request.nextUrl.searchParams;
    const to = ISO.test(sp.get("to") || "") ? sp.get("to")! : new Date().toISOString().split("T")[0];
    const from = ISO.test(sp.get("from") || "") ? sp.get("from")! : new Date(Date.now() - 6 * 86400000).toISOString().split("T")[0];

    const posted = await db
      .select({
        id: schema.assignments.id,
        title: schema.assignments.title,
        autoName: schema.assignments.autoName,
        metaAdId: schema.assignments.metaAdId,
        metaAdsetId: schema.assignments.metaAdsetId,
        metaCampaignId: schema.assignments.metaCampaignId,
      })
      .from(schema.assignments)
      .where(and(eq(schema.assignments.assignedToId, session.user.id), eq(schema.assignments.status, "posted"), isNotNull(schema.assignments.metaAdId)));
    if (posted.length === 0) return NextResponse.json({ insights: [] });

    const [settings, usdAccounts] = await Promise.all([getEvolveSettings(), getUsdAccountIds()]);
    const factor = usdFactor(usdAccounts, settings.sekPerUsd);
    const adIds = posted.map((p) => p.metaAdId!);
    const rows = await db
      .select({
        adId: schema.insights.entityId,
        spend: sql<number>`coalesce(sum(${schema.insights.spend} * ${factor}),0)`,
        impressions: sql<number>`coalesce(sum(${schema.insights.impressions}),0)`,
        reach: sql<number>`coalesce(sum(${schema.insights.reach}),0)`,
        clicks: sql<number>`coalesce(sum(${schema.insights.clicks}),0)`,
        purchases: sql<number>`coalesce(sum(${schema.insights.purchases}),0)`,
        purchaseValue: sql<number>`coalesce(sum(${schema.insights.purchaseValue} * ${factor}),0)`,
      })
      .from(schema.insights)
      .where(and(eq(schema.insights.entityType, "ad"), inArray(schema.insights.entityId, adIds), gte(schema.insights.dateStart, from), lte(schema.insights.dateStart, to)))
      .groupBy(schema.insights.entityId);
    const byAd = new Map(rows.map((r) => [r.adId, r]));

    const insights = posted.map((a) => {
      const r = byAd.get(a.metaAdId!);
      const spend = Number(r?.spend) || 0;
      const impressions = Number(r?.impressions) || 0;
      const clicks = Number(r?.clicks) || 0;
      const purchases = Number(r?.purchases) || 0;
      const purchaseValue = Number(r?.purchaseValue) || 0;
      return {
        assignmentId: a.id,
        adId: a.metaAdId,
        adsetId: a.metaAdsetId,
        campaignId: a.metaCampaignId,
        autoName: a.autoName || a.title,
        spend,
        impressions,
        reach: Number(r?.reach) || 0,
        clicks,
        purchases,
        purchaseValue,
        roas: spend > 0 ? purchaseValue / spend : 0,
        cpa: purchases > 0 ? spend / purchases : 0,
        ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
        cpc: clicks > 0 ? spend / clicks : 0,
        cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
      };
    });

    return NextResponse.json({ insights, currency: "USD", dateRange: { from, to } });
  } catch (error) {
    console.error("Editor insights error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to fetch insights" }, { status: 500 });
  }
}
