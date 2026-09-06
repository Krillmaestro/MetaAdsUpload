import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { metaApi, getAdAccountId } from "@/lib/meta/client";
import { createAdSet } from "@/lib/meta/adsets";
import { createAd } from "@/lib/meta/ads";
import { isElevated } from "@/lib/access";

export const dynamic = "force-dynamic";

/**
 * POST /api/meta/adsets/duplicate
 *
 * Duplicates an existing ad-set (with all its ads) to a target campaign.
 * Each ad in the source ad-set is recreated in the new ad-set with the same creative.
 *
 * Body: { sourceAdsetId, targetCampaignId, newName? }
 * Returns: { adsetId, ads: [...] }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { sourceAdsetId, targetCampaignId, newName } = await request.json();

    if (!sourceAdsetId || !targetCampaignId) {
      return NextResponse.json({ error: "sourceAdsetId and targetCampaignId are required" }, { status: 400 });
    }

    // Fetch source ad-set details
    const sourceAdset = await metaApi<{
      id: string;
      name: string;
      daily_budget?: string;
      targeting?: Record<string, unknown>;
      optimization_goal?: string;
      billing_event?: string;
      bid_strategy?: string;
      promoted_object?: Record<string, unknown>;
    }>(`/${sourceAdsetId}`, {
      params: {
        fields: "id,name,daily_budget,targeting,optimization_goal,billing_event,bid_strategy,promoted_object",
      },
    });

    // Fetch ads in the source ad-set
    const sourceAds = await metaApi<{
      data: Array<{
        id: string;
        name: string;
        creative: { id: string };
        status: string;
      }>;
    }>(`/${sourceAdsetId}/ads`, {
      params: { fields: "id,name,creative{id},status" },
    });

    // Create new ad-set in target campaign
    const newAdset = await createAdSet({
      campaign_id: targetCampaignId,
      name: newName || `${sourceAdset.name} (copy)`,
      daily_budget: sourceAdset.daily_budget ? parseInt(sourceAdset.daily_budget) : undefined,
      targeting: sourceAdset.targeting || { geo_locations: { countries: ["SE"] } },
      optimization_goal: sourceAdset.optimization_goal || "OFFSITE_CONVERSIONS",
      billing_event: sourceAdset.billing_event || "IMPRESSIONS",
      bid_strategy: sourceAdset.bid_strategy || "LOWEST_COST_WITHOUT_CAP",
      status: "PAUSED",
      promoted_object: sourceAdset.promoted_object,
    });

    // Recreate each ad in the new ad-set concurrently (throttle handles rate limiting)
    const adsToCreate = (sourceAds.data || []).filter((a) => a.creative?.id);
    const createdAdsResults = await Promise.allSettled(
      adsToCreate.map(async (srcAd) => {
        const newAd = await createAd({
          adset_id: newAdset.id,
          name: srcAd.name,
          creative: { creative_id: srcAd.creative.id },
          status: "PAUSED",
        });
        return { id: newAd.id, name: srcAd.name, sourceAdId: srcAd.id };
      })
    );
    const createdAds = createdAdsResults
      .filter((r): r is PromiseFulfilledResult<{ id: string; name: string; sourceAdId: string }> => r.status === "fulfilled")
      .map((r) => r.value);

    return NextResponse.json({
      success: true,
      adsetId: newAdset.id,
      adsetName: newName || `${sourceAdset.name} (copy)`,
      targetCampaignId,
      sourceAdsetId,
      totalAds: createdAds.length,
      ads: createdAds,
    });
  } catch (error) {
    console.error("Duplicate adset error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to duplicate ad set" },
      { status: 500 }
    );
  }
}
