import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { uploadImage, uploadVideo, createAdCreative, waitForVideoReady, getVideoThumbnail } from "@/lib/meta/creatives";
import { createAdSet } from "@/lib/meta/adsets";
import { createAd, createAdWithTextOptions } from "@/lib/meta/ads";
import { getPageId, getPixelId, metaApi, getAdAccountId, MetaApiError, withAccount, withAdAccount } from "@/lib/meta/client";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { getR2Client, getR2Bucket } from "@/lib/r2";
import { isElevated } from "@/lib/access";

export const maxDuration = 300; // 5 minutes for large video uploads

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function downloadFromR2(key: string): Promise<{ buffer: Buffer; contentType: string }> {
  const client = getR2Client();
  const bucketName = getR2Bucket();

  const command = new GetObjectCommand({ Bucket: bucketName, Key: key });
  const result = await client.send(command);

  if (!result.Body) throw new Error("Empty file in R2");

  const chunks: Uint8Array[] = [];
  const stream = result.Body as AsyncIterable<Uint8Array>;
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return {
    buffer: Buffer.concat(chunks),
    contentType: result.ContentType || "application/octet-stream",
  };
}

async function uploadVideoByUrl(url: string, filename: string): Promise<string> {
  const accountId = await getAdAccountId();
  const result = await metaApi<{ id: string }>(`/${accountId}/advideos`, {
    method: "POST",
    body: { file_url: url, title: filename },
  });
  return result.id;
}

interface AdCopyInput {
  headline?: string;
  headlines?: string[];
  primaryText?: string;
  primaryTexts?: string[];
  linkUrl: string;
  ctaType: string;
}

async function updateJob(jobId: number, data: Record<string, unknown>) {
  try {
    await db
      .update(schema.uploadJobs)
      .set(data)
      .where(eq(schema.uploadJobs.id, jobId));
  } catch (e) {
    console.error("Failed to update upload job:", e);
  }
}

interface ErrorDetails {
  message: string;
  failedStep: number;
  failedStepName: string;
  metaErrorCode?: number;
  metaErrorSubcode?: number;
  httpStatus?: number;
  isAuthError?: boolean;
  isRateLimitError?: boolean;
  suggestion?: string;
  payload?: Record<string, unknown>;
  timestamp: string;
}

const STEP_NAMES = [
  "Upload media to Meta",
  "Create ad creative",
  "Set up ad set",
  "Create ad",
];

function buildErrorDetails(error: unknown, step: number, payload?: Record<string, unknown>): ErrorDetails {
  const details: ErrorDetails = {
    message: error instanceof Error ? error.message : String(error),
    failedStep: step,
    failedStepName: STEP_NAMES[step - 1] || `Step ${step}`,
    timestamp: new Date().toISOString(),
  };

  if (payload) {
    // Sanitize — don't store the access token
    details.payload = payload;
  }

  if (error instanceof MetaApiError) {
    details.metaErrorCode = error.metaErrorCode;
    details.metaErrorSubcode = error.metaErrorSubcode;
    details.httpStatus = error.statusCode;
    details.isAuthError = error.isAuthError;
    details.isRateLimitError = error.isRateLimitError;

    // Provide actionable suggestions for common errors
    if (error.isAuthError) {
      details.suggestion = "Your Meta token has expired. Go to Settings and reconnect your Meta account.";
    } else if (error.isRateLimitError) {
      details.suggestion = "Meta API rate limit reached. Wait a few minutes and try again.";
    } else if (error.metaErrorCode === 100) {
      if (error.metaErrorSubcode === 1487851) {
        details.suggestion = "Invalid video. Make sure it is at least 1 second long and in a format Meta supports (MP4, MOV).";
      } else if (error.metaErrorSubcode === 1487390) {
        details.suggestion = "Invalid image. Make sure it is at least 600x600px and in JPG/PNG format.";
      } else {
        details.suggestion = "Invalid parameters sent to Meta. Check that all fields are filled in correctly. See 'payload' for details.";
      }
    } else if (error.metaErrorCode === 2) {
      details.suggestion = "Temporary Meta API error. Try again in a few seconds.";
    } else if (error.metaErrorCode === 1) {
      details.suggestion = "Unknown Meta API error. It may be temporary — try again. If it persists, check Meta Ads Manager.";
    } else if (error.metaErrorCode === 10 || error.metaErrorCode === 200) {
      details.suggestion = "Permission problem. Your Meta token is missing required permissions (ads_management). Reconnect the account in Settings.";
    } else if (error.metaErrorCode === 2635) {
      details.suggestion = "Dynamic Creative-fel. Kontrollera att ad set:et har is_dynamic_creative=true, eller skicka bara en headline/text.";
    } else if (error.message.includes("pixel")) {
      details.suggestion = "Pixel-related error. Check that your Pixel ID is correct in Settings.";
    } else if (error.message.includes("page")) {
      details.suggestion = "Page-related error. Check that the correct Facebook Page is selected in Settings.";
    }
  } else if (error instanceof Error) {
    if (error.message.includes("R2") || error.message.includes("S3")) {
      details.suggestion = "Cloudflare R2 error. Check that the R2 credentials are configured correctly in the environment variables.";
    } else if (error.message.includes("network") || error.message.includes("fetch")) {
      details.suggestion = "Network error. Check the internet connection and try again.";
    } else if (error.message.includes("timeout")) {
      details.suggestion = "Timeout. The file may be too large. Try a smaller file or compress the video.";
    }
  }

  if (!details.suggestion) {
    details.suggestion = "Unexpected error. Copy the error message and search the Meta Business Help Center.";
  }

  return details;
}

// ─── Main handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  let jobId: number | undefined;
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await request.json();
    const {
      r2Key,
      r2Url,
      filename,
      mediaType,
      campaignId,
      adsetId: existingAdsetId,
      adsetConfig,
      adCopy,
      adName: adNameValue,
      existingJobId,
      pageId: overridePageId,
      pixelId: overridePixelId,
      variants,
      connectionId,
      adAccountId,
    } = body as {
      r2Key: string;
      r2Url: string;
      filename: string;
      mediaType: "video" | "image";
      campaignId: string;
      adsetId?: string;
      adsetConfig?: {
        name: string;
        dailyBudget: number;
        targeting: Record<string, unknown>;
        optimizationGoal: string;
        bidStrategy: string;
        conversionEvent?: string;
        startTime?: string;
      };
      adCopy: AdCopyInput;
      adName: string;
      existingJobId?: number;
      pageId?: string;
      pixelId?: string;
      variants?: Array<{ r2Key: string; r2Url: string; filename: string }>;
      connectionId?: number; // optional: publish via a non-active Meta connection
      adAccountId?: string; // optional: publish to a specific ad account (from template)
    };

    if (!r2Key || !campaignId || !adCopy) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Multi-account: scope every Meta call below to the requested connection
    // and/or ad account (e.g. a template's US account). AsyncLocalStorage
    // propagates it through getPageId/getAdAccountId/etc.
    const runScoped = <T,>(fn: () => Promise<T>): Promise<T> => {
      const inner = () =>
        withAdAccount(typeof adAccountId === "string" && adAccountId.trim() ? adAccountId.trim() : null, fn);
      return typeof connectionId === "number" && Number.isFinite(connectionId)
        ? withAccount(connectionId, inner)
        : inner();
    };
    return await runScoped(async () => {

    // Use existing job record if provided, otherwise create new one
    if (existingJobId) {
      jobId = existingJobId;
      await updateJob(jobId, {
        status: "uploading_meta",
        currentStep: 1,
        stepLabel: "Laddar upp media till Meta...",
        r2Key,
        r2Url,
        config: { adCopy, adsetConfig, adName: adNameValue },
      });
    } else {
      const [job] = await db
        .insert(schema.uploadJobs)
        .values({
          filename: filename || "unknown",
          mediaType: mediaType || "video",
          status: "uploading_meta",
          currentStep: 1,
          totalSteps: 4,
          stepLabel: "Laddar upp media till Meta...",
          r2Key,
          r2Url,
          campaignId,
          config: { adCopy, adsetConfig, adName: adNameValue },
        })
        .returning();
      jobId = job.id;
    }

    // Normalize ad copy
    const headlinesArr = adCopy.headlines?.filter(Boolean) || (adCopy.headline ? [adCopy.headline] : []);
    const textsArr = adCopy.primaryTexts?.filter(Boolean) || (adCopy.primaryText ? [adCopy.primaryText] : []);
    const hasMultipleTexts = headlinesArr.length > 1 || textsArr.length > 1;
    const hasVariants = variants && variants.length > 0;

    const results: Record<string, string> = {};
    let currentStep = 1;

    // ─── Step 1: Upload media to Meta ─────────────────────────────────────
    currentStep = 1;
    await updateJob(jobId, { currentStep, stepLabel: `Uploading ${mediaType} to Meta...` });

    let videoId: string | undefined;
    let imageHash: string | undefined;

    if (mediaType === "video") {
      let urlError: unknown;
      try {
        videoId = await uploadVideoByUrl(r2Url, filename);
      } catch (e) {
        urlError = e;
      }
      if (!videoId) {
        try {
          const { buffer } = await downloadFromR2(r2Key);
          const result = await uploadVideo(buffer, filename);
          videoId = result.id;
        } catch (e) {
          // Both methods failed — report error with context
          const details = buildErrorDetails(e, currentStep, {
            r2Key, r2Url, filename, mediaType,
            urlUploadError: urlError instanceof Error ? urlError.message : String(urlError),
          });
          await updateJob(jobId, {
            status: "failed",
            error: details.message,
            stepLabel: `Misslyckades: ${details.failedStepName}`,
            config: { ...body, errorDetails: details },
          });
          return NextResponse.json({ error: details.message, jobId, errorDetails: details }, { status: 500 });
        }
      }
      results.videoId = videoId;
      await updateJob(jobId, { videoId, stepLabel: "Waiting for video processing..." });

      // Wait for video to finish processing on Meta's side
      await waitForVideoReady(videoId);

      // Get auto-generated thumbnail (required for video creatives)
      const thumbnailUrl = await getVideoThumbnail(videoId);
      if (thumbnailUrl) results.thumbnailUrl = thumbnailUrl;
    } else {
      try {
        const { buffer } = await downloadFromR2(r2Key);
        const result = await uploadImage(buffer, filename);
        imageHash = result.hash;
      } catch (e) {
        const details = buildErrorDetails(e, currentStep, { r2Key, filename, mediaType });
        await updateJob(jobId, {
          status: "failed",
          error: details.message,
          stepLabel: `Misslyckades: ${details.failedStepName}`,
          config: { ...body, errorDetails: details },
        });
        return NextResponse.json({ error: details.message, jobId, errorDetails: details }, { status: 500 });
      }
      results.imageHash = imageHash!;
      await updateJob(jobId, { imageHash });
    }

    // Self-link: if this file lives in the Creative Library, stamp the Meta
    // ids (and thumbnail) on it so the library aggregates this ad's performance
    try {
      const linkUpdates: Record<string, unknown> = {};
      if (videoId) linkUpdates.metaVideoId = videoId;
      if (imageHash) linkUpdates.metaImageHash = imageHash;
      if (results.thumbnailUrl) linkUpdates.thumbnailUrl = results.thumbnailUrl;
      if (Object.keys(linkUpdates).length > 0) {
        const linked = await db.update(schema.creatives).set(linkUpdates).where(eq(schema.creatives.r2Key, r2Key)).returning({ id: schema.creatives.id });
        // A deliverable (editor upload) has no library row yet — create one so
        // the Learning Loop can play the original file for this ad.
        if (linked.length === 0) {
          await db.insert(schema.creatives).values({
            name: filename,
            type: mediaType === "image" ? "image" : "video",
            source: "r2",
            r2Key,
            r2Url,
            status: "uploaded",
            ...linkUpdates,
          });
        }
      }
    } catch (e) {
      console.error("Library creative link failed (non-fatal):", e);
    }

    // Upload variant images to Meta (placement variants)
    const variantHashes: string[] = [];
    if (hasVariants && mediaType === "image") {
      for (const variant of variants!) {
        try {
          const { buffer: vBuffer } = await downloadFromR2(variant.r2Key);
          const vResult = await uploadImage(vBuffer, variant.filename);
          variantHashes.push(vResult.hash);
        } catch (e) {
          console.error(`Failed to upload variant ${variant.filename}:`, e);
          // Non-fatal: continue with primary image only
        }
      }
    }

    // ─── Step 2: Create Ad Creative (skip if multiple texts — handled at ad level) ───
    currentStep = 2;
    const pageId = overridePageId || await getPageId();
    const creativeName = `${filename.replace(/\.[^.]+$/, "")} ${new Date().toISOString().split("T")[0]}`;

    let creativeId: string | undefined;

    // For images with multiple texts OR variants: skip creative here — created inline at ad level via creative_asset_groups_spec
    // For videos (even with multiple texts): always create creative here — creative_asset_groups_spec doesn't support video
    const needsCreativeHere = (!hasMultipleTexts && !hasVariants) || !!videoId;

    if (needsCreativeHere) {
      await updateJob(jobId, { currentStep, stepLabel: "Creating ad creative..." });

      const firstHeadline = headlinesArr[0] || "";
      const firstText = textsArr[0] || "";

      const storySpec: Record<string, unknown> = { page_id: pageId };

      if (videoId) {
        const videoData: Record<string, unknown> = {
          video_id: videoId,
          message: firstText,
          title: firstHeadline,
          call_to_action: {
            type: adCopy.ctaType || "SHOP_NOW",
            value: { link: adCopy.linkUrl || "" },
          },
        };
        // Thumbnail is REQUIRED for video creatives
        if (results.thumbnailUrl) {
          videoData.image_url = results.thumbnailUrl;
        }
        storySpec.video_data = videoData;
      } else if (imageHash) {
        storySpec.link_data = {
          link: adCopy.linkUrl || "",
          message: firstText,
          name: firstHeadline,
          image_hash: imageHash,
          call_to_action: { type: adCopy.ctaType || "SHOP_NOW" },
        };
      }

      // Use FormData with stringified JSON — Meta requires this for nested objects
      const creativeForm = new FormData();
      creativeForm.append("name", creativeName);
      creativeForm.append("object_story_spec", JSON.stringify(storySpec));

      const creativePayloadForError = { name: creativeName, object_story_spec: storySpec };

      let adCreative: { id: string };
      try {
        adCreative = await metaApi<{ id: string }>(`/${await getAdAccountId()}/adcreatives`, {
          method: "POST",
          body: creativeForm,
        });
      } catch (e) {
        const details = buildErrorDetails(e, currentStep, creativePayloadForError);
        await updateJob(jobId, {
          status: "failed",
          error: details.message,
          stepLabel: `Misslyckades: ${details.failedStepName}`,
          config: { ...body, errorDetails: details },
        });
        return NextResponse.json({ error: details.message, jobId, errorDetails: details }, { status: 500 });
      }

      creativeId = adCreative.id;
      results.creativeId = adCreative.id;
      await updateJob(jobId, { creativeId: adCreative.id });
    } else {
      // Multiple texts or variants with image: creative will be created inline at ad level (step 4)
      await updateJob(jobId, { currentStep, stepLabel: "Skipping (creative is created with the ad)..." });
    }

    // ─── Step 3: Create or reuse ad set ───────────────────────────────────
    currentStep = 3;
    await updateJob(jobId, { currentStep, stepLabel: "Setting up ad set..." });

    let adsetId = existingAdsetId;

    if (!adsetId && adsetConfig) {
      const pixelId = overridePixelId || await getPixelId();
      const optGoal = adsetConfig.optimizationGoal || "OFFSITE_CONVERSIONS";

      // Check if campaign uses CBO — if so, budget is at campaign level, not ad set
      let isCBO = false;
      try {
        const campaign = await metaApi<{ daily_budget?: string; lifetime_budget?: string }>(`/${campaignId}`, {
          params: { fields: "daily_budget,lifetime_budget" },
        });
        isCBO = !!(campaign.daily_budget || campaign.lifetime_budget);
      } catch { /* if check fails, try with budget anyway */ }

      const adsetParams: Record<string, unknown> = {
        campaign_id: campaignId,
        name: adsetConfig.name,
        // CBO campaigns: budget is on campaign level, skip on ad set
        daily_budget: isCBO ? undefined : (adsetConfig.dailyBudget ? adsetConfig.dailyBudget * 100 : undefined),
        targeting: adsetConfig.targeting || { geo_locations: { countries: ["SE"] } },
        optimization_goal: optGoal,
        billing_event: "IMPRESSIONS",
        bid_strategy: isCBO ? undefined : (adsetConfig.bidStrategy || "LOWEST_COST_WITHOUT_CAP"),
        status: "ACTIVE",
        promoted_object: pixelId
          ? { pixel_id: pixelId, custom_event_type: adsetConfig.conversionEvent || "PURCHASE" }
          : undefined,
        destination_type: optGoal === "OFFSITE_CONVERSIONS" ? "WEBSITE" : undefined,
        // Schedule ad set start time (e.g. 02:00 tomorrow)
        start_time: adsetConfig.startTime || undefined,
      };

      try {
        const adset = await createAdSet(adsetParams as Parameters<typeof createAdSet>[0]);
        adsetId = adset.id;
        results.adsetId = adset.id;
      } catch (e) {
        const details = buildErrorDetails(e, currentStep, adsetParams);
        await updateJob(jobId, {
          status: "failed",
          error: details.message,
          stepLabel: `Misslyckades: ${details.failedStepName}`,
          config: { ...body, errorDetails: details },
        });
        return NextResponse.json({ error: details.message, jobId, errorDetails: details }, { status: 500 });
      }
    } else if (adsetId) {
      results.adsetId = adsetId;
    }

    if (!adsetId) {
      const details: ErrorDetails = {
        message: "Inget ad set valt och ingen ad set-konfiguration angiven",
        failedStep: currentStep,
        failedStepName: STEP_NAMES[currentStep - 1],
        suggestion: "Choose an existing ad set or fill in 'Create New' med budget och targeting.",
        timestamp: new Date().toISOString(),
      };
      await updateJob(jobId, {
        status: "failed",
        error: details.message,
        stepLabel: `Misslyckades: ${details.failedStepName}`,
        config: { ...body, errorDetails: details },
      });
      return NextResponse.json({ error: details.message, jobId, errorDetails: details }, { status: 400 });
    }

    await updateJob(jobId, { adsetId });

    // ─── Step 4: Create Ad ────────────────────────────────────────────────
    currentStep = 4;
    await updateJob(jobId, { currentStep, stepLabel: "Creating ad..." });

    let ad: { id: string };
    let adPayloadForError: Record<string, unknown>;

    if ((hasMultipleTexts || hasVariants) && imageHash) {
      // Multiple headlines/texts OR placement variants WITH IMAGE: use creative_asset_groups_spec (Flexible Ads)
      // Note: creative_asset_groups_spec does NOT support video — only images
      const flexParams = {
        adset_id: adsetId,
        name: adNameValue || creativeName,
        page_id: pageId,
        status: "ACTIVE",
        headlines: headlinesArr,
        primaryTexts: textsArr,
        imageHash,
        variantHashes: variantHashes.length > 0 ? variantHashes : undefined,
        linkUrl: adCopy.linkUrl,
        ctaType: adCopy.ctaType,
      };
      adPayloadForError = flexParams as unknown as Record<string, unknown>;
      try {
        ad = await createAdWithTextOptions(flexParams);
      } catch (e) {
        const details = buildErrorDetails(e, currentStep, adPayloadForError);
        await updateJob(jobId, {
          status: "failed",
          error: details.message,
          stepLabel: `Misslyckades: ${details.failedStepName}`,
          config: { ...body, errorDetails: details },
        });
        return NextResponse.json({ error: details.message, jobId, errorDetails: details }, { status: 500 });
      }
    } else if (hasMultipleTexts && videoId) {
      // Multiple headlines/texts WITH VIDEO: use creative_asset_groups_spec
      // (Flexible Ads) — it works on standard ad sets AND supports video, unlike
      // a dynamic-creative asset_feed_spec which the ad set rejects (error 1885998).
      // If Meta still refuses the flexible video ad, fall back to the single-text
      // creative from Step 2 so the upload always succeeds (first text only).
      const flexParams = {
        adset_id: adsetId,
        name: adNameValue || creativeName,
        page_id: pageId,
        status: "ACTIVE",
        headlines: headlinesArr,
        primaryTexts: textsArr,
        videoId,
        videoThumbnailUrl: results.thumbnailUrl,
        linkUrl: adCopy.linkUrl,
        ctaType: adCopy.ctaType,
      };
      adPayloadForError = flexParams as unknown as Record<string, unknown>;
      try {
        ad = await createAdWithTextOptions(flexParams);
      } catch (flexErr) {
        console.warn("Flexible video ad failed, falling back to single-text creative:", flexErr);
        const adParams = {
          adset_id: adsetId,
          name: adNameValue || creativeName,
          creative: { creative_id: creativeId! },
          status: "ACTIVE" as const,
        };
        adPayloadForError = adParams as unknown as Record<string, unknown>;
        try {
          ad = await createAd(adParams);
        } catch (e) {
          const details = buildErrorDetails(e, currentStep, adPayloadForError);
          await updateJob(jobId, {
            status: "failed",
            error: details.message,
            stepLabel: `Misslyckades: ${details.failedStepName}`,
            config: { ...body, errorDetails: details },
          });
          return NextResponse.json({ error: details.message, jobId, errorDetails: details }, { status: 500 });
        }
      }
    } else {
      // Standard ad with creative_id (single text)
      const adParams = {
        adset_id: adsetId,
        name: adNameValue || creativeName,
        creative: { creative_id: creativeId! },
        status: "ACTIVE" as const,
      };
      adPayloadForError = adParams as unknown as Record<string, unknown>;
      try {
        ad = await createAd(adParams);
      } catch (e) {
        const details = buildErrorDetails(e, currentStep, adPayloadForError);
        await updateJob(jobId, {
          status: "failed",
          error: details.message,
          stepLabel: `Misslyckades: ${details.failedStepName}`,
          config: { ...body, errorDetails: details },
        });
        return NextResponse.json({ error: details.message, jobId, errorDetails: details }, { status: 500 });
      }
    }

    results.adId = ad.id;

    // Mark completed
    await updateJob(jobId, {
      status: "completed",
      currentStep: 4,
      stepLabel: "Done!",
      adId: ad.id,
      completedAt: new Date(),
    });

    return NextResponse.json({ success: true, jobId, ...results });
    });
  } catch (error) {
    // Catch-all for unexpected errors (auth, DB, etc.)
    console.error("Upload from R2 error:", error);
    const details = buildErrorDetails(error, 0, undefined);

    if (jobId) {
      await updateJob(jobId, {
        status: "failed",
        error: details.message,
        stepLabel: "Misslyckades",
        config: { errorDetails: details },
      });
    }

    return NextResponse.json({ error: details.message, jobId, errorDetails: details }, { status: 500 });
  }
}
