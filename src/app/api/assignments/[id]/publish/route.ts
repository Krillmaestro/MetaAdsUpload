import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { and, eq, isNull } from "drizzle-orm";
import { createCampaign } from "@/lib/meta/campaigns";
import { createAdSet } from "@/lib/meta/adsets";
import { createAd, getAdPostId } from "@/lib/meta/ads";
import { createAdCreative, uploadImage, uploadVideo, waitForVideoReady, getVideoThumbnail } from "@/lib/meta/creatives";
import { metaApi, getAdAccountId } from "@/lib/meta/client";
import { applyLinks } from "@/lib/learning-loop/link";
import { listDeliverableFiles, APPROVED } from "@/lib/deliverables";
import { isElevated } from "@/lib/access";

export const maxDuration = 300; // large videos: Meta-side download + processing wait

interface CreativeInput {
  name: string; // filename / creative name
  type: "video" | "image";
  base64?: string;
  deliverableUrl?: string; // R2 public URL — backend downloads from here
  metaVideoId?: string;
  metaImageHash?: string;
  versionId?: string; // deliverable_versions.id — written back with the Meta ids
}

interface PublishConfig {
  // Campaign
  campaignId?: string; // existing campaign ID, or null to create new
  campaignName?: string;
  campaignObjective?: string;
  budgetType?: "ABO" | "CBO";

  // Ad Set
  adsetName?: string; // defaults to assignment autoName
  dailyBudget?: number; // in cents
  targeting?: Record<string, unknown>;
  optimizationGoal?: string;
  conversionEvent?: string;
  bidStrategy?: string;

  // Template / Copy
  templateId?: number;
  headlines?: string[];
  primaryTexts?: string[];
  descriptions?: string[];
  ctaType?: string;

  // Landing pages (multiple = multiply ads)
  landingPages: string[];

  // Creatives (multiple = multiply ads)
  creatives: CreativeInput[];

  // Post ID preservation — reuse existing Facebook post to keep engagement
  sourcePostId?: string; // effective_object_story_id e.g. "page_id_post_id"

  // Which approved files become ads (default: every approved, not yet uploaded file)
  versionIds?: string[];
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const config: PublishConfig = await request.json();

    // Get assignment
    const [assignment] = await db.select().from(schema.assignments).where(eq(schema.assignments.id, id));
    if (!assignment) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });

    // Files → creatives. Only files that still exist and are approved become
    // ads; a replaced or flagged file can never slip through. An explicit
    // versionIds list narrows that set.
    const files = await listDeliverableFiles(id);
    if (!config.creatives?.length) {
      const wanted = config.versionIds?.length ? new Set(config.versionIds) : null;
      const selected = files.filter((f) => (wanted ? wanted.has(f.id) : f.reviewStatus === APPROVED && !f.metaAdId));
      const notApproved = selected.filter((f) => f.reviewStatus !== APPROVED);
      if (notApproved.length > 0) {
        return NextResponse.json({ error: `${notApproved.map((f) => f.hookLabel ?? f.filename).join(", ")} är inte godkänd` }, { status: 400 });
      }
      config.creatives = selected.map((f) => ({
        name: f.filename,
        type: /\.(jpg|jpeg|png|webp)$/i.test(f.filename) ? "image" : "video",
        deliverableUrl: f.r2Url,
        versionId: f.id,
      }));
      if (!config.creatives.length && assignment.deliverableUrl && files.length === 0) {
        // Legacy assignment without file rows: fall back to the single deliverable
        const originalFilename = assignment.deliverableR2Key?.split("/").pop() || "deliverable.mp4";
        config.creatives = [{ name: originalFilename, type: /\.(jpg|jpeg|png|webp)$/i.test(originalFilename) ? "image" : "video", deliverableUrl: assignment.deliverableUrl }];
      }
    }

    // Validate
    if (!config.landingPages?.length) {
      return NextResponse.json({ error: "At least one landing page is required" }, { status: 400 });
    }
    if (!config.creatives?.length) {
      return NextResponse.json({ error: "At least one creative is required" }, { status: 400 });
    }

    if (assignment.status !== "ready_for_posting") {
      return NextResponse.json({ error: "Assignment must be in 'ready_for_posting' status" }, { status: 400 });
    }

    // Get editor info
    const [editor] = await db.select().from(schema.users).where(eq(schema.users.id, assignment.assignedToId));
    const editorName = editor?.name?.split(" ")[0] || "Unknown";

    // Get related entities
    const countryRow = assignment.countryId
      ? (await db.select().from(schema.countries).where(eq(schema.countries.id, assignment.countryId)))[0]
      : null;
    const countryCode = countryRow?.code || "SE";

    // Load template if specified
    let headlines = config.headlines || [];
    let primaryTexts = config.primaryTexts || [];
    let descriptions = config.descriptions || [];
    let ctaType = config.ctaType || "SHOP_NOW";

    if (config.templateId) {
      const [template] = await db.select().from(schema.templates).where(eq(schema.templates.id, config.templateId));
      if (template) {
        if (!headlines.length) headlines = (template.headlines as string[]) || [];
        if (!primaryTexts.length) primaryTexts = (template.primaryTexts as string[]) || [];
        if (!descriptions.length) descriptions = (template.descriptions as string[]) || [];
        ctaType = template.ctaType || ctaType;
      }
    }

    const { getPageId, getPixelId } = await import("@/lib/meta/client");
    const pageId = await getPageId();
    const pixelId = await getPixelId();

    // --- Step 1: Campaign ---
    let campaignId = config.campaignId;
    if (campaignId) {
      // An existing CBO campaign owns the budget — the ad set must not set one.
      try {
        const c = await metaApi<{ daily_budget?: string; lifetime_budget?: string }>(`/${campaignId}`, { params: { fields: "daily_budget,lifetime_budget" } });
        if (c.daily_budget || c.lifetime_budget) config.budgetType = "CBO";
      } catch (e) {
        console.error("campaign budget lookup failed:", e);
      }
    }
    if (!campaignId) {
      const campaign = await createCampaign({
        name: config.campaignName || `${countryCode} ${assignment.autoName || assignment.title}`,
        objective: config.campaignObjective || "OUTCOME_SALES",
        status: "PAUSED",
        daily_budget: config.budgetType === "CBO" ? (config.dailyBudget || 50000) : undefined,
      });
      campaignId = campaign.id;
    }

    // --- Step 2: Ad Set ---
    const adsetName = config.adsetName || assignment.autoName || assignment.title;
    const adset = await createAdSet({
      campaign_id: campaignId,
      name: adsetName,
      daily_budget: config.budgetType !== "CBO" ? (config.dailyBudget || 5000) : undefined,
      targeting: config.targeting || { geo_locations: { countries: [countryCode] } },
      optimization_goal: config.optimizationGoal || "OFFSITE_CONVERSIONS",
      billing_event: "IMPRESSIONS",
      bid_strategy: config.bidStrategy || "LOWEST_COST_WITHOUT_CAP",
      status: "PAUSED",
      promoted_object: pixelId
        ? { pixel_id: pixelId, custom_event_type: config.conversionEvent || "PURCHASE" }
        : undefined,
      // UTM url_tags — Meta appends these to all ad URLs automatically.
      // Meta replaces {{...}} dynamic templates per ad at serve time.
      url_tags: `utm_source=fb&utm_medium=paid&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}`,
    });

    // --- Step 3: Upload creatives & create ads (creatives × landing pages) ---
    const createdAds: Array<{
      adId: string;
      adName: string;
      creativeName: string;
      landingPage: string;
      creativeId: string;
    }> = [];

    const mediaIds = new Map<string, { videoId?: string; imageHash?: string }>();
    for (const creative of config.creatives) {
      // If sourcePostId is set, skip media upload — reuse existing post
      const useExistingPost = !!config.sourcePostId;

      let videoId = creative.metaVideoId;
      let imageHash = creative.metaImageHash;
      let thumbnailUrl: string | undefined;

      if (!useExistingPost) {
        if (creative.base64) {
          const buffer = Buffer.from(creative.base64, "base64");
          if (creative.type === "video") {
            const result = await uploadVideo(buffer, creative.name);
            videoId = result.id;
          } else {
            const result = await uploadImage(buffer, creative.name);
            imageHash = Object.values(result.images)[0]?.hash;
          }
        } else if (creative.deliverableUrl) {
          if (creative.type === "video") {
            // Direct cloud→Meta: Meta pulls the file itself from the R2 public URL
            try {
              const result = await metaApi<{ id: string }>(`/${await getAdAccountId()}/advideos`, {
                method: "POST",
                body: { file_url: creative.deliverableUrl, title: creative.name },
              });
              videoId = result.id;
            } catch {
              // Fallback: download from R2 and upload the bytes
              const fileRes = await fetch(creative.deliverableUrl);
              if (!fileRes.ok) throw new Error(`Failed to download deliverable from ${creative.deliverableUrl}`);
              const buffer = Buffer.from(await fileRes.arrayBuffer());
              const result = await uploadVideo(buffer, creative.name);
              videoId = result.id;
            }
          } else {
            const fileRes = await fetch(creative.deliverableUrl);
            if (!fileRes.ok) throw new Error(`Failed to download deliverable from ${creative.deliverableUrl}`);
            const buffer = Buffer.from(await fileRes.arrayBuffer());
            const result = await uploadImage(buffer, creative.name);
            imageHash = Object.values(result.images)[0]?.hash;
          }
        }

        mediaIds.set(creative.name, { videoId, imageHash });
        // Wait for Meta-side processing and grab the auto thumbnail for the creative
        if (videoId && creative.type === "video") {
          await waitForVideoReady(videoId);
          thumbnailUrl = (await getVideoThumbnail(videoId)) || undefined;
        }
      }

      // For each landing page, create an ad
      for (let lpIdx = 0; lpIdx < config.landingPages.length; lpIdx++) {
        const landingPage = config.landingPages[lpIdx];
        const lpSuffix = config.landingPages.length > 1 ? ` LP${lpIdx + 1}` : "";

        // Ad name = original filename without extension
        const cleanCreativeName = creative.name.replace(/\.[^.]+$/, "");
        // Remove any timestamp prefix (e.g. "1234567890-") from sanitized R2 filenames
        const displayName = cleanCreativeName.replace(/^\d{10,}-/, "");
        const adName = `${displayName}${lpSuffix}`;

        let adCreative;

        if (useExistingPost) {
          // Post ID preservation: reuse existing Facebook post (shares likes/comments/shares)
          adCreative = await createAdCreative({
            name: adName,
            object_story_id: config.sourcePostId!,
          });
        } else {
          // Build creative payload with new media
          const creativePayload: Record<string, unknown> = {
            name: adName,
            object_story_spec: { page_id: pageId },
          };

          if (videoId) {
            const videoData: Record<string, unknown> = {
              video_id: videoId,
              message: primaryTexts[0] || "",
              title: headlines[0] || "",
              call_to_action: {
                type: ctaType,
                value: { link: landingPage },
              },
            };
            if (thumbnailUrl) videoData.image_url = thumbnailUrl;
            (creativePayload.object_story_spec as Record<string, unknown>).video_data = videoData;
          } else if (imageHash) {
            (creativePayload.object_story_spec as Record<string, unknown>).link_data = {
              link: landingPage,
              message: primaryTexts[0] || "",
              name: headlines[0] || "",
              description: descriptions[0] || "",
              image_hash: imageHash,
              call_to_action: { type: ctaType },
            };
          }

          // If multiple headlines/texts, add them as text options (Multiple Text
          // Optimization). optimization_type DEGREES_OF_FREEDOM is REQUIRED —
          // without it Meta treats the asset feed as dynamic creative and rejects
          // it ("exactly one ad format", #1885374) or demands a dynamic ad set
          // (#1885852). Link/CTA stay in link_data/video_data — never in the feed.
          if (headlines.length > 1 || primaryTexts.length > 1) {
            creativePayload.asset_feed_spec = {
              ...(headlines.length > 0 ? { titles: headlines.map((t) => ({ text: t })) } : {}),
              ...(primaryTexts.length > 0 ? { bodies: primaryTexts.map((t) => ({ text: t })) } : {}),
              ...(descriptions.length > 0 ? { descriptions: descriptions.map((t) => ({ text: t })) } : {}),
              optimization_type: "DEGREES_OF_FREEDOM",
            };
          }

          adCreative = await createAdCreative(creativePayload as Parameters<typeof createAdCreative>[0]);
        }

        const ad = await createAd({
          adset_id: adset.id,
          name: adName,
          creative: { creative_id: adCreative.id },
          status: "PAUSED",
        });

        createdAds.push({
          adId: ad.id,
          adName,
          creativeName: creative.name,
          landingPage,
          creativeId: adCreative.id,
        });
      }
    }

    // --- Step 4: Retrieve post ID from first ad for future reuse ---
    let metaPostId = config.sourcePostId || null;
    if (!metaPostId && createdAds.length > 0) {
      metaPostId = await getAdPostId(createdAds[0].adId);
    }

    // --- Step 5: Update assignment ---
    const allAdIds = createdAds.map((a) => a.adId);
    const [updated] = await db
      .update(schema.assignments)
      .set({
        metaAdId: allAdIds[0], // primary ad ID
        metaAdsetId: adset.id,
        metaCampaignId: campaignId,
        metaPostId,
        status: "posted",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.assignments.id, id))
      .returning();

    // --- Step 5b: Write the Meta ids back on the files, put them in the
    // library (Learning Loop + previews find them by video id), and remember
    // this campaign/template/budget/landing page for the next brief of the
    // same product + country.
    try {
      const editorFull = editor?.name || null;
      const uploaded = new Map<string, { videoId?: string; imageHash?: string; adId: string }>();
      for (const c of config.creatives) {
        if (!c.versionId) continue;
        const ad = createdAds.find((a) => a.creativeName === c.name);
        if (ad) uploaded.set(c.versionId, { videoId: mediaIds.get(c.name)?.videoId, imageHash: mediaIds.get(c.name)?.imageHash, adId: ad.adId });
      }
      for (const f of files) {
        const u = uploaded.get(f.id);
        if (!u) continue;
        const [lib] = await db.insert(schema.creatives).values({
          name: f.filename,
          type: /\.(jpg|jpeg|png|webp)$/i.test(f.filename) ? "image" : "video",
          source: "r2",
          r2Key: f.r2Key,
          r2Url: f.r2Url,
          thumbnailUrl: f.thumbnailUrl,
          fileSize: f.fileSize,
          width: f.width,
          height: f.height,
          duration: f.duration,
          metaVideoId: u.videoId ?? null,
          metaImageHash: u.imageHash ?? null,
          assignmentId: id,
          editorName: editorFull,
          batchNumber: assignment.batchNumber != null ? String(assignment.batchNumber) : null,
          status: "uploaded",
        }).returning({ id: schema.creatives.id });
        await db.update(schema.deliverableVersions)
          .set({ metaVideoId: u.videoId ?? null, metaImageHash: u.imageHash ?? null, metaAdId: u.adId, creativeId: lib?.id ?? null })
          .where(eq(schema.deliverableVersions.id, f.id));
      }

      let campaignName = config.campaignName ?? null;
      if (!campaignName && campaignId) {
        const [cc] = await db.select({ name: schema.campaignsCache.name }).from(schema.campaignsCache).where(eq(schema.campaignsCache.id, campaignId));
        campaignName = cc?.name ?? null;
      }
      const defaultsPatch = {
        campaignId: campaignId ?? null,
        campaignName,
        templateId: config.templateId ?? null,
        dailyBudget: config.dailyBudget != null ? config.dailyBudget / 100 : null,
        landingPage: config.landingPages[0] ?? null,
        updatedAt: new Date(),
      };
      const [existing] = await db.select({ id: schema.publishDefaults.id }).from(schema.publishDefaults).where(
        and(
          assignment.productId ? eq(schema.publishDefaults.productId, assignment.productId) : isNull(schema.publishDefaults.productId),
          assignment.countryId ? eq(schema.publishDefaults.countryId, assignment.countryId) : isNull(schema.publishDefaults.countryId),
        ),
      );
      if (existing) await db.update(schema.publishDefaults).set(defaultsPatch).where(eq(schema.publishDefaults.id, existing.id));
      else await db.insert(schema.publishDefaults).values({ productId: assignment.productId, countryId: assignment.countryId, ...defaultsPatch });
    } catch (e) {
      console.error("post-publish bookkeeping failed:", e);
    }

    // --- Step 6: Learning Loop link — the new ad set IS this brief, live.
    // Cache the ad set first so the row has a name before the nightly sync.
    try {
      await db.insert(schema.adsetsCache).values({
        id: adset.id,
        adAccountId: await getAdAccountId(),
        campaignId: campaignId as string,
        name: adsetName,
        status: "PAUSED",
        effectiveStatus: "PAUSED",
        createdTime: new Date(),
      }).onConflictDoNothing();
      await applyLinks([{ assignmentId: id, adsetId: adset.id }], "publish", session.user.id);
    } catch (e) {
      console.error("Learning Loop link after publish failed:", e);
    }

    return NextResponse.json({
      success: true,
      assignment: updated,
      meta: {
        campaignId,
        adsetId: adset.id,
        adsetName,
        totalAds: createdAds.length,
        formula: `${config.creatives.length} creatives × ${config.landingPages.length} landing pages = ${createdAds.length} ads`,
        ads: createdAds,
      },
    });
  } catch (error) {
    console.error("Publish assignment error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to publish to Meta" },
      { status: 500 }
    );
  }
}
