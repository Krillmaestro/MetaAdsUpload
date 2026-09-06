import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { getInsights, extractPurchases, extractPurchaseValue, calculateROAS } from "@/lib/meta/insights";
import { getAds } from "@/lib/meta/ads";
import { getCampaigns } from "@/lib/meta/campaigns";
import { getAdSets } from "@/lib/meta/adsets";
import { getEvolveSettings } from "@/lib/evolve/settings";
import { classifyAd } from "@/lib/evolve/classifier";
import { format, subDays } from "date-fns";
import { desc, gte, eq, and, sql } from "drizzle-orm";
import { isElevated } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const settings = await getEvolveSettings();
    const today = format(new Date(), "yyyy-MM-dd");
    const yesterday = format(subDays(new Date(), 1), "yyyy-MM-dd");
    const last7d = format(subDays(new Date(), 7), "yyyy-MM-dd");

    // Fetch only ACTIVE entities in parallel — use 7d ad-level insights for both yesterday + week
    const [ads, campaigns, adsets, yesterdayCampaignInsights, last7dAdInsights, recentActions] = await Promise.all([
      getAds(undefined, 500, "ACTIVE"),
      getCampaigns(200, "ACTIVE"),
      getAdSets(undefined, 500, "ACTIVE"),
      // Campaign-level insights for yesterday (for CBO budget decisions)
      getInsights({ level: "campaign", dateRange: { since: yesterday, until: yesterday }, limit: 200 }),
      // Ad-level insights for last 7 days (includes yesterday — filter in JS)
      getInsights({ level: "ad", dateRange: { since: last7d, until: today }, limit: 500 }),
      db.select()
        .from(schema.adClassifications)
        .where(gte(schema.adClassifications.classifiedAt, subDays(new Date(), 7)))
        .orderBy(desc(schema.adClassifications.classifiedAt))
        .limit(50),
    ]);

    // Extract yesterday's ad insights from the 7d dataset
    const yesterdayAdInsights = last7dAdInsights.filter((i) => i.date_start === yesterday);

    const campaignMap = new Map(campaigns.map((c) => [c.id, c]));
    const adsetMap = new Map(adsets.map((a) => [a.id, a]));
    const adMap = new Map(ads.map((a) => [a.id, a]));

    const activeCampaigns = campaigns.filter((c) => c.status === "ACTIVE");
    const activeCampaignIds = new Set(activeCampaigns.map((c) => c.id));

    // ── Campaign-level performance (yesterday) ──
    const campaignPerformance = activeCampaigns.map((campaign) => {
      const insight = yesterdayCampaignInsights.find((i) => i.campaign_id === campaign.id);
      const spend = parseFloat(insight?.spend || "0");
      const purchases = insight ? extractPurchases(insight.actions) : 0;
      const revenue = insight ? extractPurchaseValue(insight.action_values) : 0;
      const roas = calculateROAS(revenue, spend);
      const cpa = purchases > 0 ? spend / purchases : 0;

      // Count ad sets in this campaign
      const campaignAdsets = adsets.filter((a) => a.campaign_id === campaign.id && a.status === "ACTIVE");
      const adsetCount = campaignAdsets.length;

      // Get campaign daily budget (from Meta API the budget is on campaign object for CBO)
      // For CBO campaigns, daily_budget is on the campaign itself
      const dailyBudget = campaign.daily_budget
        ? parseFloat(String(campaign.daily_budget))
        : 0;

      // CBO budget recommendation for this campaign
      let budgetAction: string;
      let budgetReason: string;
      let suggestedBudget: number | undefined;

      if (spend === 0) {
        budgetAction = "no_data";
        budgetReason = "No spend yesterday — cannot assess.";
      } else if (roas >= settings.targetRoas * 1.5) {
        budgetAction = "double";
        budgetReason = `ROAS ${roas.toFixed(2)}x was 50%+ above target (${settings.targetRoas}x). Double the CBO budget!`;
        suggestedBudget = dailyBudget > 0 ? dailyBudget * 2 : undefined;
      } else if (roas >= settings.targetRoas) {
        budgetAction = "increase_20";
        budgetReason = `ROAS ${roas.toFixed(2)}x was above target. Raise the CBO budget by 20%.`;
        suggestedBudget = dailyBudget > 0 ? Math.round(dailyBudget * 1.2) : undefined;
      } else if (roas >= settings.breakevenRoas) {
        budgetAction = "hold";
        budgetReason = `ROAS ${roas.toFixed(2)}x between breakeven and target. Keep the current budget.`;
      } else if (roas > 0) {
        budgetAction = "decrease_20";
        budgetReason = `ROAS ${roas.toFixed(2)}x below breakeven (${settings.breakevenRoas}x). Lower the CBO budget by 20%.`;
        suggestedBudget = dailyBudget > 0 ? Math.round(dailyBudget * 0.8) : undefined;
      } else {
        budgetAction = "no_data";
        budgetReason = "No ROAS data available.";
      }

      return {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        dailyBudget,
        adsetCount,
        maxAdSets: settings.maxAdSetsPerCampaign,
        adsetWarning: adsetCount > settings.maxAdSetsPerCampaign,
        yesterday: { spend, revenue, purchases, roas, cpa },
        budget: {
          action: budgetAction,
          reason: budgetReason,
          current: dailyBudget,
          suggested: suggestedBudget,
        },
      };
    });

    // ── Yesterday totals ──
    let yesterdaySpend = 0;
    let yesterdayRevenue = 0;
    let yesterdayPurchases = 0;

    for (const insight of yesterdayAdInsights) {
      yesterdaySpend += parseFloat(insight.spend || "0");
      yesterdayRevenue += extractPurchaseValue(insight.action_values);
      yesterdayPurchases += extractPurchases(insight.actions);
    }

    const yesterdayRoas = calculateROAS(yesterdayRevenue, yesterdaySpend);
    const yesterdayCpa = yesterdayPurchases > 0 ? yesterdaySpend / yesterdayPurchases : 0;

    // ── 7-day performance ──
    let weekSpend = 0;
    let weekRevenue = 0;
    let weekPurchases = 0;

    const insightsBy7d = new Map<string, { spend: number; roas: number; cpa: number; purchases: number }>();

    for (const insight of last7dAdInsights) {
      const spend = parseFloat(insight.spend || "0");
      const purchaseValue = extractPurchaseValue(insight.action_values);
      const purchases = extractPurchases(insight.actions);
      weekSpend += spend;
      weekRevenue += purchaseValue;
      weekPurchases += purchases;

      if (insight.ad_id) {
        insightsBy7d.set(insight.ad_id, {
          spend,
          roas: calculateROAS(purchaseValue, spend),
          cpa: purchases > 0 ? spend / purchases : 0,
          purchases,
        });
      }
    }

    const weekRoas = calculateROAS(weekRevenue, weekSpend);

    // ── Find top spender + total spend per campaign ──
    const activeAds = ads.filter((ad) => activeCampaignIds.has(ad.campaign_id));
    const topSpenderPerCampaign = new Map<string, string>();
    const totalSpendPerCampaign = new Map<string, number>();
    for (const ad of activeAds) {
      const spend = insightsBy7d.get(ad.id)?.spend || 0;
      totalSpendPerCampaign.set(ad.campaign_id, (totalSpendPerCampaign.get(ad.campaign_id) || 0) + spend);
      const currentTopId = topSpenderPerCampaign.get(ad.campaign_id);
      const currentTopSpend = currentTopId ? (insightsBy7d.get(currentTopId)?.spend || 0) : 0;
      if (spend > currentTopSpend) {
        topSpenderPerCampaign.set(ad.campaign_id, ad.id);
      }
    }

    // ── Classify ads (7-day data) ──
    const classifiedAds = activeAds
      .map((ad) => {
        const metrics = insightsBy7d.get(ad.id) || { spend: 0, roas: 0, cpa: 0, purchases: 0 };
        const spendThreshold = settings.targetCpa * 3;
        const isTopSpender = topSpenderPerCampaign.get(ad.campaign_id) === ad.id;
        const campTotalSpend = totalSpendPerCampaign.get(ad.campaign_id) || 0;
        const spendShare = campTotalSpend > 0 ? metrics.spend / campTotalSpend : 0;
        const { classification, recommendation } = classifyAd(
          { spend: metrics.spend, roas: metrics.roas, cpa: metrics.cpa, purchases: metrics.purchases, ageDays: 7, isTopSpender, spendShare },
          settings
        );
        return {
          id: ad.id,
          name: ad.name,
          status: ad.status,
          campaignId: ad.campaign_id,
          campaignName: campaignMap.get(ad.campaign_id)?.name || "Unknown",
          adsetName: adsetMap.get(ad.adset_id)?.name || "Unknown",
          ...metrics,
          classification,
          recommendation,
          spendProgress: spendThreshold > 0 ? Math.min(metrics.spend / spendThreshold, 1) : 0,
        };
      });

    const losers = classifiedAds.filter((a) => a.classification === "loser" && a.status === "ACTIVE");
    const breakthroughs = classifiedAds.filter((a) => a.classification === "breakthrough");
    const newAds = classifiedAds.filter((a) => a.classification === "new" && a.status === "ACTIVE");

    // ── Activity log ──
    const activityLog = recentActions.map((action) => {
      const ad = adMap.get(action.adId);
      return {
        id: action.id,
        adId: action.adId,
        adName: ad?.name || action.adId,
        action: action.actionTaken || "unknown",
        classification: action.classification,
        spend: action.spend,
        roas: action.roas,
        timestamp: action.classifiedAt,
        recommendation: action.recommendation,
      };
    });

    const classificationCounts = {
      breakthrough: classifiedAds.filter((a) => a.classification === "breakthrough").length,
      spend_winner: classifiedAds.filter((a) => a.classification === "spend_winner").length,
      kpi_winner: classifiedAds.filter((a) => a.classification === "kpi_winner").length,
      loser: classifiedAds.filter((a) => a.classification === "loser").length,
      new: classifiedAds.filter((a) => a.classification === "new").length,
    };

    // ── ncROAS from Shopify daily stats ──
    let ncRoas: number | null = null;
    let newCustomerRevenue: number | null = null;
    let newCustomerPct: number | null = null;

    try {
      const yesterdayShopify = await db
        .select()
        .from(schema.shopifyDailyStats)
        .where(eq(schema.shopifyDailyStats.date, yesterday))
        .limit(1);

      if (yesterdayShopify.length > 0) {
        const shopDay = yesterdayShopify[0];
        newCustomerRevenue = shopDay.newCustomerRevenue ?? 0;
        const totalShopRevenue = shopDay.totalRevenue ?? 0;
        newCustomerPct = totalShopRevenue > 0 ? (newCustomerRevenue / totalShopRevenue) * 100 : 0;
        ncRoas = yesterdaySpend > 0 ? newCustomerRevenue / yesterdaySpend : null;
      }
    } catch {
      // shopify_daily_stats table might not exist yet — ignore
    }

    return NextResponse.json({
      yesterday: {
        spend: yesterdaySpend,
        revenue: yesterdayRevenue,
        purchases: yesterdayPurchases,
        roas: yesterdayRoas,
        cpa: yesterdayCpa,
        date: yesterday,
        ncRoas,
        newCustomerRevenue,
        newCustomerPct,
      },
      week: {
        spend: weekSpend,
        revenue: weekRevenue,
        purchases: weekPurchases,
        roas: weekRoas,
      },
      campaigns: campaignPerformance,
      classificationCounts,
      totalActiveAds: classifiedAds.filter((a) => a.status === "ACTIVE").length,
      needsAttention: {
        losers: losers.slice(0, 10).map((a) => ({
          id: a.id, name: a.name, spend: a.spend, roas: a.roas,
          recommendation: a.recommendation, campaignName: a.campaignName,
        })),
        breakthroughs: breakthroughs.slice(0, 10).map((a) => ({
          id: a.id, name: a.name, spend: a.spend, roas: a.roas,
          recommendation: a.recommendation, campaignName: a.campaignName,
        })),
        newAds: newAds.slice(0, 10).map((a) => ({
          id: a.id, name: a.name, spend: a.spend, roas: a.roas,
          spendProgress: a.spendProgress, campaignName: a.campaignName,
        })),
      },
      activityLog,
      settings: {
        targetRoas: settings.targetRoas,
        breakevenRoas: settings.breakevenRoas,
        targetCpa: settings.targetCpa,
      },
    });
  } catch (error) {
    console.error("Daily summary error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate summary" },
      { status: 500 }
    );
  }
}
