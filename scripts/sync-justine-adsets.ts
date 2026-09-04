// Riktad engångssynk: insights för Justines nyligen auto-assignade ad sets.
// Speglar per-adset-loopen i runEditorInsightsSync (lib/meta/sync-insights.ts).
// Kör: NODE_OPTIONS="--conditions=react-server" npx tsx --env-file=.env.local scripts/sync-justine-adsets.ts
import { db, schema } from "../src/db";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import {
  getAdsetInsightsByAd,
  extractPurchases,
  extractPurchaseValue,
  calculateROAS,
  extractThruplays,
  type InsightData,
} from "../src/lib/meta/insights";
import { getAds } from "../src/lib/meta/ads";
import { metaApi } from "../src/lib/meta/client";

const JUSTINE = "2beec5c4-73d2-480c-a470-38fe9499e913";

function extractLinkClicks(actions?: Array<{ action_type: string; value: string }>): number {
  return parseInt(actions?.find((a) => a.action_type === "link_click")?.value || "0", 10);
}
function extractVideoViews3s(actions?: Array<{ action_type: string; value: string }>): number {
  return parseInt(actions?.find((a) => a.action_type === "video_view")?.value || "0", 10);
}
function formatAct(id: string): string {
  return id.startsWith("act_") ? id : `act_${id}`;
}
function toRow(row: InsightData, entityId: string, adAccountId: string | null) {
  const spend = parseFloat(row.spend || "0");
  const purchaseValue = extractPurchaseValue(row.action_values);
  return {
    adAccountId, entityId, entityType: "ad",
    dateStart: row.date_start, dateStop: row.date_stop,
    spend,
    impressions: parseInt(row.impressions || "0"),
    reach: parseInt(row.reach || "0"),
    clicks: parseInt(row.clicks || "0"),
    linkClicks: extractLinkClicks(row.actions),
    ctr: parseFloat(row.ctr || "0"),
    cpc: parseFloat(row.cpc || "0"),
    cpm: parseFloat(row.cpm || "0"),
    purchases: extractPurchases(row.actions),
    purchaseValue,
    roas: calculateROAS(purchaseValue, spend),
    videoViews3s: extractVideoViews3s(row.actions),
    videoThruplays: extractThruplays(row.video_thruplay_watched_actions),
  };
}

async function main() {
  const today = new Date().toISOString().split("T")[0];
  const owners = await db
    .select()
    .from(schema.adsetOwners)
    .where(eq(schema.adsetOwners.videoEditorId, JUSTINE));
  const targets = owners.filter((o) => !o.backfilledAt);
  console.log(`Justine har ${owners.length} ad sets, ${targets.length} osynkade — synkar dem...`);

  for (const owner of targets) {
    const adsetId = owner.adsetId;
    try {
      let since = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
      let adsetAccountId: string | null = null;
      try {
        const info = await metaApi<{ name?: string; created_time?: string; account_id?: string }>(`/${adsetId}`, { params: { fields: "name,created_time,account_id" } });
        if (info?.account_id) adsetAccountId = formatAct(info.account_id);
        const created = info?.created_time?.slice(0, 10);
        if (created && created > since) since = created;
      } catch {}

      const ads = await getAds(adsetId, 200);
      const adIds = new Set<string>();
      for (const ad of ads) {
        adIds.add(ad.id);
        await db.insert(schema.adsCache).values({
          id: ad.id, adAccountId: adsetAccountId, adsetId: ad.adset_id || adsetId,
          campaignId: ad.campaign_id || "", name: ad.name, status: ad.status,
          creativeId: ad.creative?.id || null, videoId: ad.creative?.video_id || null,
          imageHash: ad.creative?.image_hash || null,
        }).onConflictDoUpdate({
          target: schema.adsCache.id,
          set: { name: ad.name, status: ad.status, adsetId: ad.adset_id || adsetId, adAccountId: adsetAccountId, syncedAt: new Date() },
        });
      }

      const data = await getAdsetInsightsByAd(adsetId, { since, until: today }, 1);
      const rows = data.filter((r) => r.ad_id).map((r) => { adIds.add(r.ad_id!); return toRow(r, r.ad_id!, adsetAccountId); });

      const adIdArr = [...adIds];
      if (adIdArr.length) {
        await db.delete(schema.insights).where(and(
          eq(schema.insights.entityType, "ad"),
          inArray(schema.insights.entityId, adIdArr),
          gte(schema.insights.dateStart, since),
          lte(schema.insights.dateStop, today),
        ));
      }
      for (let i = 0; i < rows.length; i += 200) {
        const slice = rows.slice(i, i + 200);
        if (slice.length) await db.insert(schema.insights).values(slice);
      }
      await db.update(schema.adsetOwners).set({ backfilledAt: new Date(), updatedAt: new Date() }).where(eq(schema.adsetOwners.adsetId, adsetId));
      console.log(`  ✓ ${adsetId} (${(owner.adsetName || "").slice(0, 55)}): ${ads.length} ads, ${rows.length} insight-rader`);
    } catch (e) {
      console.error(`  ✗ ${adsetId}: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log("KLART");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
