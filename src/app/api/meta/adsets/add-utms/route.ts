import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getAdSets, updateAdSet } from "@/lib/meta/adsets";
import { metaApi } from "@/lib/meta/client";
import { isElevated } from "@/lib/access";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const UTM_TAGS = "utm_source=fb&utm_medium=paid&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}";

/**
 * POST: Add UTM url_tags to all active ad sets that don't have them yet.
 * This enables per-campaign/adset ncROAS tracking via Shopify order attribution.
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // Fetch all active ad sets
    const adsets = await getAdSets(undefined, 500, "ACTIVE");

    // Check each ad set for existing url_tags
    const results: Array<{ id: string; name: string; status: string }> = [];
    const errors: Array<{ id: string; name: string; error: string }> = [];
    let skipped = 0;

    for (const adset of adsets) {
      // Fetch current url_tags for this adset
      try {
        const details = await metaApi<{ url_tags?: string }>(`/${adset.id}`, {
          params: { fields: "url_tags" },
        });

        // Skip if already has UTM tags
        if (details.url_tags && details.url_tags.includes("utm_source")) {
          skipped++;
          continue;
        }

        // Set url_tags
        await updateAdSet(adset.id, { url_tags: UTM_TAGS });
        results.push({ id: adset.id, name: adset.name, status: "updated" });
      } catch (err) {
        errors.push({
          id: adset.id,
          name: adset.name,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    return NextResponse.json({
      success: true,
      updated: results.length,
      skipped,
      errors: errors.length,
      details: { results, errors },
      utmTemplate: UTM_TAGS,
    });
  } catch (error) {
    console.error("Add UTMs error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to add UTMs" },
      { status: 500 }
    );
  }
}
