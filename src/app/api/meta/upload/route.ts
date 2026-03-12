import { NextRequest, NextResponse } from "next/server";
import { uploadImage, uploadVideo, createAdCreative } from "@/lib/meta/creatives";
import { createCampaign } from "@/lib/meta/campaigns";
import { createAdSet } from "@/lib/meta/adsets";
import { createAd } from "@/lib/meta/ads";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      creative: creativeConfig,
      campaign: campaignConfig,
      adset: adsetConfig,
      ad: adConfig,
    } = body;

    // Step 1: Upload creative media (if provided as base64)
    let imageHash: string | undefined;
    let videoId: string | undefined;

    if (creativeConfig.imageBase64) {
      const buffer = Buffer.from(creativeConfig.imageBase64, "base64");
      const result = await uploadImage(buffer, creativeConfig.filename || "image.jpg");
      const images = result.images;
      imageHash = Object.values(images)[0]?.hash;
    }

    if (creativeConfig.videoBase64) {
      const buffer = Buffer.from(creativeConfig.videoBase64, "base64");
      const result = await uploadVideo(buffer, creativeConfig.filename || "video.mp4");
      videoId = result.id;
    }

    // Step 2: Create Ad Creative
    const pageId = process.env.META_PAGE_ID;
    if (!pageId) throw new Error("META_PAGE_ID not configured");

    const creativePayload: Record<string, unknown> = {
      name: adConfig.name || "Ad Creative",
      object_story_spec: {
        page_id: pageId,
      },
    };

    if (videoId) {
      (creativePayload.object_story_spec as Record<string, unknown>).video_data = {
        video_id: videoId,
        message: creativeConfig.primaryTexts?.[0] || "",
        title: creativeConfig.headlines?.[0] || "",
        call_to_action: {
          type: creativeConfig.ctaType || "SHOP_NOW",
          value: { link: creativeConfig.linkUrl || "" },
        },
        ...(imageHash ? { image_hash: imageHash } : {}),
      };
    } else if (imageHash) {
      (creativePayload.object_story_spec as Record<string, unknown>).link_data = {
        link: creativeConfig.linkUrl || "",
        message: creativeConfig.primaryTexts?.[0] || "",
        name: creativeConfig.headlines?.[0] || "",
        description: creativeConfig.descriptions?.[0] || "",
        image_hash: imageHash,
        call_to_action: { type: creativeConfig.ctaType || "SHOP_NOW" },
      };
    }

    // If multiple headlines/texts, use asset_feed_spec
    if ((creativeConfig.headlines?.length > 1 || creativeConfig.primaryTexts?.length > 1)) {
      creativePayload.asset_feed_spec = {
        ...(creativeConfig.headlines?.length > 0 ? { titles: creativeConfig.headlines.map((t: string) => ({ text: t })) } : {}),
        ...(creativeConfig.primaryTexts?.length > 0 ? { bodies: creativeConfig.primaryTexts.map((t: string) => ({ text: t })) } : {}),
        ...(creativeConfig.linkUrl ? { link_urls: [{ website_url: creativeConfig.linkUrl }] } : {}),
        call_to_action_types: [creativeConfig.ctaType || "SHOP_NOW"],
      };
    }

    const adCreative = await createAdCreative(creativePayload as Parameters<typeof createAdCreative>[0]);

    // Step 3: Create Campaign
    const campaign = await createCampaign({
      name: campaignConfig.name,
      objective: campaignConfig.objective || "OUTCOME_SALES",
      status: "PAUSED",
      daily_budget: campaignConfig.budgetType === "CBO" ? campaignConfig.dailyBudget * 100 : undefined,
    });

    // Step 4: Create Ad Set
    const pixelId = process.env.META_PIXEL_ID;
    const adset = await createAdSet({
      campaign_id: campaign.id,
      name: adsetConfig.name,
      daily_budget: campaignConfig.budgetType !== "CBO" ? (adsetConfig.dailyBudget || 5000) : undefined,
      targeting: adsetConfig.targeting || { geo_locations: { countries: ["SE"] } },
      optimization_goal: adsetConfig.optimizationGoal || "OFFSITE_CONVERSIONS",
      billing_event: "IMPRESSIONS",
      bid_strategy: adsetConfig.bidStrategy || "LOWEST_COST_WITHOUT_CAP",
      status: "PAUSED",
      promoted_object: pixelId ? { pixel_id: pixelId, custom_event_type: adsetConfig.conversionEvent || "PURCHASE" } : undefined,
    });

    // Step 5: Create Ad
    const ad = await createAd({
      adset_id: adset.id,
      name: adConfig.name,
      creative: { creative_id: adCreative.id },
      status: "PAUSED",
    });

    return NextResponse.json({
      success: true,
      campaignId: campaign.id,
      adsetId: adset.id,
      adId: ad.id,
      creativeId: adCreative.id,
    });
  } catch (error) {
    console.error("Upload API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 500 }
    );
  }
}
