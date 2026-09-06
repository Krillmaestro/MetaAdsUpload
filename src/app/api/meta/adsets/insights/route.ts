import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getInsights, extractPurchases, extractPurchaseValue, calculateROAS } from "@/lib/meta/insights";
import { format, subDays } from "date-fns";
import { isElevated } from "@/lib/access";

export const dynamic = "force-dynamic";

/**
 * Ad set-level metrics for a date range, straight from Meta — what the
 * campaign tree shows under each campaign.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const sp = request.nextUrl.searchParams;
    const since = sp.get("since") || format(subDays(new Date(), 7), "yyyy-MM-dd");
    const until = sp.get("until") || format(new Date(), "yyyy-MM-dd");

    const rows = await getInsights({ level: "adset", dateRange: { since, until }, limit: 500 });
    const adsets = rows
      .filter((r) => r.adset_id)
      .map((r) => {
        const spend = parseFloat(r.spend || "0");
        const impressions = parseInt(r.impressions || "0");
        const clicks = parseInt(r.clicks || "0");
        const purchases = extractPurchases(r.actions);
        const purchaseValue = extractPurchaseValue(r.action_values);
        return {
          id: r.adset_id!,
          campaignId: r.campaign_id ?? null,
          spend,
          impressions,
          clicks,
          purchases,
          purchaseValue,
          roas: calculateROAS(purchaseValue, spend),
          ctr: parseFloat(r.ctr || "0"),
          cpc: parseFloat(r.cpc || "0"),
          cpm: parseFloat(r.cpm || "0"),
          cpa: purchases > 0 ? spend / purchases : 0,
        };
      });
    return NextResponse.json({ adsets, dateRange: { since, until } });
  } catch (error) {
    console.error("adset insights error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to fetch ad set insights" }, { status: 500 });
  }
}
