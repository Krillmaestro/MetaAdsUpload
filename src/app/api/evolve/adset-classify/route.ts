import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getInsights, extractPurchases, extractPurchaseValue, calculateROAS } from "@/lib/meta/insights";
import { getAds } from "@/lib/meta/ads";
import { getCampaigns } from "@/lib/meta/campaigns";
import { getAdSets } from "@/lib/meta/adsets";
import { withAdAccount } from "@/lib/meta/client";
import { getEvolveSettings } from "@/lib/evolve/settings";
import { classifyAd } from "@/lib/evolve/classifier";
import { format, subDays, differenceInDays, parseISO } from "date-fns";
import { getAdsetNcRoas, getTotalNcRoas } from "@/lib/shopify/ncroas";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const searchParams = request.nextUrl.searchParams;
    const campaignFilter = searchParams.get("campaign_id") || undefined;

    // Date range
    let since: string;
    let until: string;
    if (searchParams.has("since") && searchParams.has("until")) {
      since = searchParams.get("since")!;
      until = searchParams.get("until")!;
    } else {
      const days = parseInt(searchParams.get("days") || "7");
      since = format(days === 0 ? new Date() : subDays(new Date(), days), "yyyy-MM-dd");
      until = format(new Date(), "yyyy-MM-dd");
    }

    // Which ad account to analyse. Without this the route silently reports on
    // whichever account happens to be active in settings, which is how the
    // analyzer ended up showing Glimmora while the editors' work sits in
    // DogDivaCOmain. Falsy = keep the connection's active account.
    const account = searchParams.get("account") || undefined;

    return await withAdAccount(account, async () => {
    const settings = await getEvolveSettings();

    // Fetch only ACTIVE entities from Meta — dramatically reduces data volume
    const [campaigns, adsets, insightsData, adInsightsData, allAds, ncRoasMap, totalNcData] = await Promise.all([
      getCampaigns(200, "ACTIVE"),
      getAdSets(undefined, 500, "ACTIVE"),
      getInsights({
        level: "adset",
        dateRange: { since, until },
        limit: 500,
      }),
      getInsights({
        level: "ad",
        dateRange: { since, until },
        limit: 500,
      }),
      getAds(undefined, 500, "ACTIVE"),
      getAdsetNcRoas(since, until),
      getTotalNcRoas(since, until),
    ]);

    const campaignMap = new Map(campaigns.map((c) => [c.id, c]));

    // Exclude graveyard campaign
    const activeCampaignIds = new Set(
      campaigns
        .filter((c) => c.status === "ACTIVE" && c.id !== settings.graveyardCampaignId)
        .map((c) => c.id)
    );

    const ads = allAds.filter((ad) => activeCampaignIds.has(ad.campaign_id));

    // Build insights lookup by adset_id
    const insightsMap = new Map<string, {
      spend: number;
      impressions: number;
      reach: number;
      clicks: number;
      purchases: number;
      purchaseValue: number;
      roas: number;
      ctr: number;
      cpc: number;
      cpm: number;
      frequency: number;
      dateStart: string;
    }>();

    for (const insight of insightsData) {
      if (!insight.adset_id) continue;
      const spend = parseFloat(insight.spend || "0");
      const impressions = parseInt(insight.impressions || "0");
      const reach = parseInt(insight.reach || "0");
      const clicks = parseInt(insight.clicks || "0");
      const purchases = extractPurchases(insight.actions);
      const purchaseValue = extractPurchaseValue(insight.action_values);
      const roas = calculateROAS(purchaseValue, spend);
      const ctr = parseFloat(insight.ctr || "0");
      const cpc = parseFloat(insight.cpc || "0");
      const cpm = parseFloat(insight.cpm || "0");
      const frequency = reach > 0 ? impressions / reach : 0;

      insightsMap.set(insight.adset_id, {
        spend, impressions, reach, clicks,
        purchases, purchaseValue, roas,
        ctr, cpc, cpm, frequency,
        dateStart: insight.date_start,
      });
    }

    // Count active ads per ad set
    const adCountMap = new Map<string, number>();
    for (const ad of ads) {
      if (ad.status === "ACTIVE") {
        adCountMap.set(ad.adset_id, (adCountMap.get(ad.adset_id) || 0) + 1);
      }
    }

    // Filter ad sets — only active ad sets in active campaigns
    const filteredAdsets = adsets
      .filter((as) => as.status === "ACTIVE")
      .filter((as) => activeCampaignIds.has(as.campaign_id))
      .filter((as) => !campaignFilter || as.campaign_id === campaignFilter);

    // Find top spender per campaign
    const topSpenderPerCampaign = new Map<string, string>();
    const totalSpendPerCampaign = new Map<string, number>();
    for (const as of filteredAdsets) {
      const spend = insightsMap.get(as.id)?.spend || 0;
      totalSpendPerCampaign.set(as.campaign_id, (totalSpendPerCampaign.get(as.campaign_id) || 0) + spend);
      const currentTopId = topSpenderPerCampaign.get(as.campaign_id);
      const currentTopSpend = currentTopId ? (insightsMap.get(currentTopId)?.spend || 0) : 0;
      if (spend > currentTopSpend) {
        topSpenderPerCampaign.set(as.campaign_id, as.id);
      }
    }

    const ageDays = differenceInDays(parseISO(until), parseISO(since)) + 1;

    // Build ad-level insights for expanded view
    const adInsightsMap = new Map<string, {
      spend: number; roas: number; purchases: number; purchaseValue: number; cpa: number;
    }>();
    for (const insight of adInsightsData) {
      if (!insight.ad_id) continue;
      const spend = parseFloat(insight.spend || "0");
      const purchases = extractPurchases(insight.actions);
      const purchaseValue = extractPurchaseValue(insight.action_values);
      const roas = calculateROAS(purchaseValue, spend);
      const cpa = purchases > 0 ? spend / purchases : 0;
      adInsightsMap.set(insight.ad_id, { spend, roas, purchases, purchaseValue, cpa });
    }

    // Group ads by adset for expanded view
    const adsByAdset = new Map<string, Array<{
      id: string; name: string; status: string;
      spend: number; roas: number; purchases: number; cpa: number;
    }>>();
    for (const ad of ads) {
      const metrics = adInsightsMap.get(ad.id) || { spend: 0, roas: 0, purchases: 0, purchaseValue: 0, cpa: 0 };
      const existing = adsByAdset.get(ad.adset_id) || [];
      existing.push({
        id: ad.id,
        name: ad.name,
        status: ad.status,
        spend: metrics.spend,
        roas: metrics.roas,
        purchases: metrics.purchases,
        cpa: metrics.cpa,
      });
      adsByAdset.set(ad.adset_id, existing);
    }

    // Classify each ad set
    const classifiedAdsets = filteredAdsets
      .map((as) => {
        const metrics = insightsMap.get(as.id) || {
          spend: 0, impressions: 0, reach: 0, clicks: 0,
          purchases: 0, purchaseValue: 0, roas: 0,
          ctr: 0, cpc: 0, cpm: 0, frequency: 0,
          dateStart: since,
        };
        const campaign = campaignMap.get(as.campaign_id);
        const cpa = metrics.purchases > 0 ? metrics.spend / metrics.purchases : 0;
        const isTopSpender = topSpenderPerCampaign.get(as.campaign_id) === as.id;
        const campTotalSpend = totalSpendPerCampaign.get(as.campaign_id) || 0;
        const spendShare = campTotalSpend > 0 ? metrics.spend / campTotalSpend : 0;

        const { classification, recommendation } = classifyAd(
          { spend: metrics.spend, roas: metrics.roas, cpa, purchases: metrics.purchases, ageDays, isTopSpender, spendShare },
          settings
        );

        const spendThreshold = settings.targetCpa * 3;
        const spendProgress = spendThreshold > 0 ? Math.min(metrics.spend / spendThreshold, 1) : 0;

        // ncROAS: per-adset new customer revenue / adset spend
        const ncData = ncRoasMap.get(as.id);
        const ncRevenue = ncData?.newCustomerRevenue || 0;
        const ncRoas = metrics.spend > 0 && ncRevenue > 0 ? ncRevenue / metrics.spend : null;

        return {
          id: as.id,
          name: as.name,
          status: as.status,
          campaignId: as.campaign_id,
          campaignName: campaign?.name || "Unknown",
          adCount: adCountMap.get(as.id) || 0,
          ads: (adsByAdset.get(as.id) || []).sort((a, b) => b.spend - a.spend),
          ...metrics,
          cpa,
          ageDays,
          classification,
          recommendation,
          spendProgress,
          spendThreshold,
          isTopSpender,
          spendShare,
          ncRoas,
          ncRevenue,
        };
      })
      .sort((a, b) => {
        const order: Record<string, number> = { breakthrough: 0, spend_winner: 1, kpi_winner: 2, loser: 3, new: 4 };
        return (order[a.classification] ?? 5) - (order[b.classification] ?? 5) || b.spend - a.spend;
      });

    // Summary stats
    const totalSpend = classifiedAdsets.reduce((s, a) => s + a.spend, 0);
    const totalRevenue = classifiedAdsets.reduce((s, a) => s + a.purchaseValue, 0);
    const totalPurchases = classifiedAdsets.reduce((s, a) => s + a.purchases, 0);
    const overallRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;

    const classificationCounts = {
      breakthrough: classifiedAdsets.filter((a) => a.classification === "breakthrough").length,
      spend_winner: classifiedAdsets.filter((a) => a.classification === "spend_winner").length,
      kpi_winner: classifiedAdsets.filter((a) => a.classification === "kpi_winner").length,
      loser: classifiedAdsets.filter((a) => a.classification === "loser").length,
      new: classifiedAdsets.filter((a) => a.classification === "new").length,
    };

    // Per-campaign summary
    const campaignSummaries = campaigns
      .filter((c) => c.status === "ACTIVE" && c.id !== settings.graveyardCampaignId)
      .map((c) => {
        const campAdsets = classifiedAdsets.filter((a) => a.campaignId === c.id);
        const campSpend = campAdsets.reduce((s, a) => s + a.spend, 0);
        const campRevenue = campAdsets.reduce((s, a) => s + a.purchaseValue, 0);
        const campPurchases = campAdsets.reduce((s, a) => s + a.purchases, 0);
        const campRoas = campSpend > 0 ? campRevenue / campSpend : 0;
        const campCpa = campPurchases > 0 ? campSpend / campPurchases : 0;
        const dailyBudget = c.daily_budget ? parseFloat(String(c.daily_budget)) : 0;

        return {
          id: c.id,
          name: c.name,
          spend: campSpend,
          revenue: campRevenue,
          purchases: campPurchases,
          roas: campRoas,
          cpa: campCpa,
          adsetCount: campAdsets.length,
          dailyBudget,
        };
      });

    // Total ncROAS for the period
    const totalNcRoas = totalSpend > 0 && totalNcData.newCustomerRevenue > 0
      ? totalNcData.newCustomerRevenue / totalSpend : null;

    return NextResponse.json({
      settings: {
        targetRoas: settings.targetRoas,
        breakevenRoas: settings.breakevenRoas,
        targetCpa: settings.targetCpa,
      },
      summary: {
        totalSpend,
        totalRevenue,
        totalPurchases,
        overallRoas,
        totalAdsets: classifiedAdsets.length,
        classificationCounts,
        ncRoas: totalNcRoas,
        newCustomerRevenue: totalNcData.newCustomerRevenue,
        newCustomerOrders: totalNcData.newCustomerOrders,
      },
      adsets: classifiedAdsets,
      campaignSummaries,
      dateRange: { since, until },
      campaigns: campaigns
        .filter((c) => c.status === "ACTIVE" && c.id !== settings.graveyardCampaignId)
        .map((c) => ({ id: c.id, name: c.name })),
      account: account ?? null,
    });
    });
  } catch (error) {
    console.error("AdSet Classify API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to classify ad sets" },
      { status: 500 }
    );
  }
}
