import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { getAds, getAdPostIds, createAdWithPostId } from "@/lib/meta/ads";
import { updateAdSet, createAdSet } from "@/lib/meta/adsets";
import { metaApi } from "@/lib/meta/client";
import { getEvolveSettings } from "@/lib/evolve/settings";
import { isBig5Targeting, createZombiePlacer } from "@/lib/evolve/zombie";
import { isElevated } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await request.json();
    const { adsetId, action, classification, metrics, campaignId, adsetName, dateRange, graveyardOutcome } = body as {
      adsetId: string;
      action: "move_zombie" | "pause" | "let_run";
      classification: string;
      metrics?: { spend: number; roas: number; cpa: number; purchases: number };
      campaignId?: string;
      adsetName?: string;
      dateRange?: { since: string; until: string };
      graveyardOutcome?: "spend_winner" | "loser";
    };

    if (!adsetId || !action) {
      return NextResponse.json({ error: "Missing adsetId or action" }, { status: 400 });
    }

    if (action === "move_zombie" && graveyardOutcome !== "spend_winner" && graveyardOutcome !== "loser") {
      return NextResponse.json({ error: "Choose whether the ads are Spend Winner or Loser before moving them to the Graveyard." }, { status: 400 });
    }

    let actionDescription = "";
    const newAdIds: string[] = [];

    switch (action) {
      case "pause":
        await updateAdSet(adsetId, { status: "PAUSED" });
        actionDescription = "Ad set pausad";
        break;

      case "let_run":
        actionDescription = "Ad set reviewed — letting it run";
        break;

      case "move_zombie": {
        const settings = await getEvolveSettings();

        // Look up graveyard for this specific campaign, fall back to global default
        const targetGraveyardId = (campaignId && settings.graveyardMappings[campaignId])
          || settings.graveyardCampaignId;

        if (!targetGraveyardId) {
          return NextResponse.json({
            error: "No Graveyard campaign configured for this campaign. Go to Evolve KPI Settings and connect one.",
          }, { status: 400 });
        }

        // 1. Get all active ads in this ad set
        const adsInSet = await getAds(adsetId, 100);
        const activeAds = adsInSet.filter((a) => a.status === "ACTIVE");

        if (activeAds.length === 0) {
          return NextResponse.json({
            error: "Inga aktiva ads i detta ad set att flytta.",
          }, { status: 400 });
        }

        // 2. Fetch the source ad set's targeting + settings to copy
        const sourceAdset = await metaApi<{
          name: string;
          targeting: Record<string, unknown>;
          optimization_goal: string;
          billing_event: string;
          promoted_object?: Record<string, unknown>;
        }>(`/${adsetId}`, {
          params: { fields: "name,targeting,optimization_goal,billing_event,promoted_object" },
        });

        // 3. Batch-fetch post IDs for all active ads (needed for every path)
        const costCapValue = Math.round(settings.targetCpa * (1 - settings.zombieCostCapDiscount) * 100); // in cents
        const postIdMap = await getAdPostIds(activeAds.map((a) => a.id));

        const results: string[] = [];
        const errors: string[] = [];
        let placementSummary = "";

        // 4. Place ads. BIG 5 / US → one shared zombie ad set (spill to a sibling
        //    when full). Other markets → a fresh [GY] ad set per move (as before).
        if (isBig5Targeting(sourceAdset.targeting)) {
          const placer = await createZombiePlacer({
            graveyardCampaignId: targetGraveyardId,
            targeting: sourceAdset.targeting,
            optimizationGoal: sourceAdset.optimization_goal,
            billingEvent: sourceAdset.billing_event,
            promotedObject: sourceAdset.promoted_object,
            costCapValue,
          });

          for (const ad of activeAds) {
            try {
              const postId = postIdMap.get(ad.id);
              if (!postId) {
                errors.push(`${ad.name}: could not fetch post ID`);
                continue;
              }
              const targetAdsetId = await placer.next();
              const result = await createAdWithPostId({
                adset_id: targetAdsetId,
                name: ad.name,
                postId,
                status: "ACTIVE",
              });
              newAdIds.push(result.id);
              results.push(`${ad.name} → ${result.id}`);
            } catch (err) {
              errors.push(`${ad.name}: ${err instanceof Error ? err.message : "failed"}`);
            }
          }

          placementSummary = `BIG 5 Graveyard: ${results.length}/${activeAds.length} ads → delade zombie ad set (${placer.reusedAdsetIds.length} återanvänt, ${placer.createdAdsetIds.length} nytt).`;
        } else {
          const gyAdsetName = `[GY] ${sourceAdset.name}`;
          const newAdset = await createAdSet({
            campaign_id: targetGraveyardId,
            name: gyAdsetName,
            targeting: sourceAdset.targeting,
            optimization_goal: sourceAdset.optimization_goal,
            billing_event: sourceAdset.billing_event,
            bid_strategy: "LOWEST_COST_WITH_BID_CAP",
            bid_amount: costCapValue,
            status: "ACTIVE",
            ...(sourceAdset.promoted_object && { promoted_object: sourceAdset.promoted_object }),
          });

          for (const ad of activeAds) {
            try {
              const postId = postIdMap.get(ad.id);
              if (!postId) {
                errors.push(`${ad.name}: could not fetch post ID`);
                continue;
              }
              const result = await createAdWithPostId({
                adset_id: newAdset.id,
                name: ad.name,
                postId,
                status: "ACTIVE",
              });
              newAdIds.push(result.id);
              results.push(`${ad.name} → ${result.id}`);
            } catch (err) {
              errors.push(`${ad.name}: ${err instanceof Error ? err.message : "failed"}`);
            }
          }

          placementSummary = `Nytt GY ad set "${gyAdsetName}" (cost cap ${costCapValue / 100} kr). ${results.length}/${activeAds.length} ads duplicerade.`;
        }

        // 5. Pause the original ad set
        await updateAdSet(adsetId, { status: "PAUSED" });

        // 6. Record the forced spend_winner/loser outcome on each ORIGINAL ad
        //    (the ones linked to a video editor) for per-editor tracking.
        const gyNow = new Date();
        for (const ad of activeAds) {
          try {
            await db
              .insert(schema.adOwners)
              .values({
                adId: ad.id,
                adName: ad.name,
                campaignId: campaignId || null,
                adsetId,
                graveyardOutcome,
                graveyardAt: gyNow,
                source: "analyzer",
              })
              .onConflictDoUpdate({
                target: schema.adOwners.adId,
                set: { graveyardOutcome, graveyardAt: gyNow, updatedAt: gyNow },
              });
          } catch { /* best-effort outcome tracking */ }
        }

        actionDescription = `${graveyardOutcome === "spend_winner" ? "Spend Winner" : "Loser"} → Graveyard. Ad set pausad. ${placementSummary}`;
        if (errors.length > 0) {
          actionDescription += ` Fel: ${errors.join("; ")}`;
        }
        break;
      }
    }

    // Save to audit trail
    await db.insert(schema.adClassifications).values({
      adId: adsetId,
      classification: classification || "unknown",
      spend: metrics?.spend || 0,
      roas: metrics?.roas || 0,
      cpa: metrics?.cpa || 0,
      purchases: metrics?.purchases || 0,
      recommendation: actionDescription,
      actionTaken: action,
      actionTakenAt: new Date(),
      campaignId: campaignId || null,
      adsetId: adsetId,
      dateRangeStart: dateRange?.since || null,
      dateRangeEnd: dateRange?.until || null,
    });

    return NextResponse.json({
      success: true,
      action: actionDescription,
      newAdIds,
    });
  } catch (error) {
    console.error("AdSet Action error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to execute action" },
      { status: 500 }
    );
  }
}
