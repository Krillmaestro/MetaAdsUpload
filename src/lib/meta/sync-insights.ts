// Shared insights sync — used by the cron route (GET/POST) and the admin
// "Sync now" button. Pulls daily campaign + ad insights (with video metrics)
// from Meta into the insights table, and refreshes campaign/ad metadata caches.

import { db, schema } from "@/db";
import { and, eq, gte, lte, inArray, isNotNull, isNull, or, count as sqlCount } from "drizzle-orm";
import {
  getInsights,
  getAdsetInsightsByAd,
  extractPurchases,
  extractPurchaseValue,
  calculateROAS,
  extractThruplays,
  type InsightData,
} from "./insights";
import { getCampaigns } from "./campaigns";
import { getAdSets } from "./adsets";
import { getAds } from "./ads";
import { metaApi, resolveAccount, withAdAccount, getAdAccountId } from "./client";

/**
 * Ad set metadata → adsets_cache for the CURRENT account context (call inside
 * withAdAccount). Names, status and created_time are what the Learning Loop
 * needs to show an ad set that has not spent yet and to count "days live".
 */
export async function syncAdsetsCache(): Promise<number> {
  const adAccountId = await getAdAccountId();
  const adsets = await getAdSets(undefined, 500);
  for (const s of adsets) {
    const values = {
      adAccountId,
      campaignId: s.campaign_id,
      name: s.name,
      status: s.status,
      effectiveStatus: s.effective_status ?? null,
      dailyBudget: s.daily_budget ? parseFloat(s.daily_budget) / 100 : null,
      lifetimeBudget: s.lifetime_budget ? parseFloat(s.lifetime_budget) / 100 : null,
      optimizationGoal: s.optimization_goal ?? null,
      billingEvent: s.billing_event ?? null,
      bidStrategy: s.bid_strategy ?? null,
      startTime: s.start_time ? new Date(s.start_time) : null,
      endTime: s.end_time ? new Date(s.end_time) : null,
      createdTime: s.created_time ? new Date(s.created_time) : null,
      syncedAt: new Date(),
    };
    await db.insert(schema.adsetsCache)
      .values({ id: s.id, targeting: (s.targeting ?? {}) as Record<string, unknown>, ...values })
      .onConflictDoUpdate({ target: schema.adsetsCache.id, set: values });
  }
  return adsets.length;
}

function extractLinkClicks(actions?: Array<{ action_type: string; value: string }>): number {
  return parseInt(actions?.find((a) => a.action_type === "link_click")?.value || "0", 10);
}

function extractVideoViews3s(actions?: Array<{ action_type: string; value: string }>): number {
  return parseInt(actions?.find((a) => a.action_type === "video_view")?.value || "0", 10);
}

type InsightRow = typeof schema.insights.$inferInsert;

function toRow(row: InsightData, entityId: string, entityType: string, adAccountId: string | null): InsightRow {
  const spend = parseFloat(row.spend || "0");
  const purchaseValue = extractPurchaseValue(row.action_values);
  return {
    adAccountId,
    entityId,
    entityType,
    dateStart: row.date_start,
    dateStop: row.date_stop,
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

/**
 * Replace all rows of an entityType within [since, until] with fresh data (bulk).
 * Scoped to ONE ad account — with multi-account sync, deleting globally would
 * wipe the other accounts' rows every run. `includeLegacyNull` widens the
 * delete to rows with a NULL ad_account_id (pre-stamping era) so the primary
 * account migrates its legacy rows instead of duplicating them forever.
 */
async function replaceInsights(
  entityType: string,
  since: string,
  until: string,
  rows: InsightRow[],
  adAccountId: string | null,
  includeLegacyNull: boolean,
) {
  const accountScope = adAccountId
    ? includeLegacyNull
      ? or(eq(schema.insights.adAccountId, adAccountId), isNull(schema.insights.adAccountId))
      : eq(schema.insights.adAccountId, adAccountId)
    : isNull(schema.insights.adAccountId);
  // Day-by-day delete+insert (oldest first): the HTTP driver has no
  // transactions, so a mid-run timeout must never leave a large half-deleted
  // window — at worst ONE day goes missing and tomorrow's run repairs it.
  const byDay = new Map<string, InsightRow[]>();
  for (const r of rows) {
    const d = String(r.dateStart);
    byDay.set(d, [...(byDay.get(d) ?? []), r]);
  }
  const allDays = new Set<string>(byDay.keys());
  // Also clear days in range that no longer have rows (e.g. data corrections)
  for (let d = since; d <= until; d = new Date(new Date(`${d}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10)) {
    allDays.add(d);
  }

  // A completely empty fetch for a window that currently holds data is almost
  // always a failed call rather than the truth — Meta returning nothing for an
  // account that was spending yesterday. Clearing on that basis destroys
  // history for no gain, so skip instead. A genuinely empty window simply
  // stays as it was until a fetch returns rows.
  if (rows.length === 0) {
    const [{ count } = { count: 0 }] = await db
      .select({ count: sqlCount() })
      .from(schema.insights)
      .where(and(eq(schema.insights.entityType, entityType), gte(schema.insights.dateStart, since), lte(schema.insights.dateStart, until), accountScope));
    if (Number(count) > 0) {
      console.warn(
        `replaceInsights: refusing to clear ${count} existing ${entityType} rows in ${since}..${until} — fetch returned nothing`
      );
      return;
    }
  }
  for (const day of [...allDays].sort()) {
    await db.delete(schema.insights).where(
      and(
        eq(schema.insights.entityType, entityType),
        eq(schema.insights.dateStart, day),
        accountScope,
      )
    );
    const dayRows = byDay.get(day) ?? [];
    const CHUNK = 200;
    for (let i = 0; i < dayRows.length; i += CHUNK) {
      const slice = dayRows.slice(i, i + CHUNK);
      if (slice.length) await db.insert(schema.insights).values(slice);
    }
  }
}

// The bonus is computed on LIFETIME spend/ROAS, so the very first sync of an ad
// set must pull its entire history — not just the rolling window. Meta caps
// daily-granularity insight queries, so long ranges are fetched in chunks.
const BACKFILL_CHUNK_DAYS = 90;

/**
 * Window size for account-wide ad-level insight pulls. Small enough that
 * pagination completes on accounts with thousands of ads — the 30-day
 * single-shot version failed mid-pagination and cost real rows.
 */
const AD_INSIGHT_CHUNK_DAYS = 7;
const MAX_BACKFILLS_PER_RUN = 8; // keep a single run within Hobby function limits
const MAX_HISTORY_DAYS = 1100; // Meta retains ~37 months of insights

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split("T")[0];
}

/**
 * Targeted sync for the editor dashboard: pulls daily insights ONLY for the ad
 * sets that are assigned to an editor (adset_owners + published assignments).
 * For each owned ad set it refreshes ad metadata (names + ad→adset mapping) and
 * pulls per-ad daily insights. The first time an ad set is seen it backfills
 * the full lifetime (from the ad set's created_time) and records backfilledAt;
 * after that, only the rolling 30-day window is refreshed. Writes happen per ad
 * set so a timeout mid-run never loses completed work. Scales with owned ad
 * sets, not the whole (thousands-of-ads) account.
 */
export async function runEditorInsightsSync() {
  const account = await resolveAccount();
  const adAccountId = account.adAccountId;
  const today = new Date().toISOString().split("T")[0];
  const windowSince = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
  const oldestAllowed = new Date(Date.now() - MAX_HISTORY_DAYS * 86400000).toISOString().split("T")[0];

  // source='demo' rows are fabricated showcase data — they don't exist in Meta,
  // so they must never reach the API.
  const owners = (await db.select().from(schema.adsetOwners)).filter((o) => o.source !== "demo");
  const ownerByAdset = new Map(owners.map((o) => [o.adsetId, o]));
  const assigns = await db
    .select({ adsetId: schema.assignments.metaAdsetId })
    .from(schema.assignments)
    .where(isNotNull(schema.assignments.metaAdsetId));

  const adsetIds = [...new Set([...owners.map((o) => o.adsetId), ...(assigns.map((a) => a.adsetId).filter(Boolean) as string[])])];
  if (adsetIds.length === 0) return { adsets: 0, ads: 0, adInsightRows: 0, backfilled: 0, backfillsPending: 0 };

  // Backfill the never-backfilled ad sets first so repeated manual runs make progress.
  adsetIds.sort((a, b) => {
    const aPending = ownerByAdset.has(a) && !ownerByAdset.get(a)!.backfilledAt ? 0 : 1;
    const bPending = ownerByAdset.has(b) && !ownerByAdset.get(b)!.backfilledAt ? 0 : 1;
    return aPending - bPending;
  });

  const allAdIds = new Set<string>();
  const failed: string[] = [];
  let totalRows = 0;
  let backfillsDone = 0;

  for (const adsetId of adsetIds) {
    const ownerRow = ownerByAdset.get(adsetId);
    const wantsBackfill = !!ownerRow && !ownerRow.backfilledAt;
    const doBackfill = wantsBackfill && backfillsDone < MAX_BACKFILLS_PER_RUN;

    try {
      let since = windowSince;
      // The ad set's own account — adset ids are global, so an owned US-account
      // ad set syncs fine, but its rows must be stamped with ITS account, not
      // the connection's active one.
      let adsetAccountId = adAccountId;

      // Keep the ad set's display name fresh; created_time bounds the backfill.
      try {
        const info = await metaApi<{ name?: string; created_time?: string; account_id?: string }>(`/${adsetId}`, { params: { fields: "name,created_time,account_id" } });
        if (info?.account_id) adsetAccountId = formatAct(info.account_id);
        if (info?.name && ownerRow) {
          await db.update(schema.adsetOwners).set({ adsetName: info.name, updatedAt: new Date() }).where(eq(schema.adsetOwners.adsetId, adsetId));
        }
        if (doBackfill) {
          const created = info?.created_time?.slice(0, 10);
          since = created && created > oldestAllowed ? created : oldestAllowed;
        }
      } catch {
        // Name/created_time are best-effort; a backfill without created_time
        // falls back to the full retention window.
        if (doBackfill) since = oldestAllowed;
      }

      // Refresh ad metadata (names + ad→adset mapping) for this ad set.
      const ads = await getAds(adsetId, 200);
      const adsetAdIds = new Set<string>();
      for (const ad of ads) {
        adsetAdIds.add(ad.id);
        await db.insert(schema.adsCache).values({
          id: ad.id,
          adAccountId: adsetAccountId,
          adsetId: ad.adset_id || adsetId,
          campaignId: ad.campaign_id || "",
          name: ad.name,
          status: ad.status,
          creativeId: ad.creative?.id || null,
          videoId: ad.creative?.video_id || null,
          imageHash: ad.creative?.image_hash || null,
        }).onConflictDoUpdate({
          target: schema.adsCache.id,
          set: {
            name: ad.name, status: ad.status, adsetId: ad.adset_id || adsetId,
            adAccountId: adsetAccountId,
            creativeId: ad.creative?.id || null,
            videoId: ad.creative?.video_id || null,
            imageHash: ad.creative?.image_hash || null,
            syncedAt: new Date(),
          },
        });
      }

      // Per-ad daily insights, chunked so lifetime backfills stay within Meta's
      // limits on daily-granularity queries.
      const rows: InsightRow[] = [];
      let cursor = since;
      while (cursor <= today) {
        const chunkEnd = addDays(cursor, BACKFILL_CHUNK_DAYS - 1) < today ? addDays(cursor, BACKFILL_CHUNK_DAYS - 1) : today;
        const data = await getAdsetInsightsByAd(adsetId, { since: cursor, until: chunkEnd }, 1);
        for (const r of data) {
          if (r.ad_id) { rows.push(toRow(r, r.ad_id, "ad", adsetAccountId)); adsetAdIds.add(r.ad_id); }
        }
        cursor = addDays(chunkEnd, 1);
      }

      // Replace this ad set's rows within the fetched range, then persist
      // immediately — a later failure must not lose this ad set's data.
      const adIdArr = [...adsetAdIds];
      if (adIdArr.length) {
        await db.delete(schema.insights).where(
          and(
            eq(schema.insights.entityType, "ad"),
            inArray(schema.insights.entityId, adIdArr),
            gte(schema.insights.dateStart, since),
            lte(schema.insights.dateStop, today),
          )
        );
      }
      const CHUNK = 200;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK);
        if (slice.length) await db.insert(schema.insights).values(slice);
      }

      if (doBackfill) {
        await db.update(schema.adsetOwners).set({ backfilledAt: new Date(), updatedAt: new Date() }).where(eq(schema.adsetOwners.adsetId, adsetId));
        backfillsDone++;
      }

      totalRows += rows.length;
      adIdArr.forEach((id) => allAdIds.add(id));
    } catch (e) {
      failed.push(adsetId);
      console.error(`Insights fetch failed for ad set ${adsetId}:`, e instanceof Error ? e.message : e);
    }
  }

  const backfillsPending = owners.filter((o) => !o.backfilledAt).length - backfillsDone;
  return {
    adsets: adsetIds.length,
    ads: allAdIds.size,
    adInsightRows: totalRows,
    backfilled: backfillsDone,
    backfillsPending: Math.max(backfillsPending, 0),
    failed: failed.length,
  };
}

function formatAct(id: string): string {
  return id.startsWith("act_") ? id : `act_${id}`;
}

/**
 * The accounts the daily sync covers — self-configuring, no hardcoded list:
 *  - the connection's active/default account (always),
 *  - every ad account referenced by a template (the moment a template targets
 *    the US account, the sync starts covering it),
 *  - every account that already has stamped insights rows (keeps history fresh
 *    even if the template that introduced the account is later deleted).
 */
async function accountsToSync(activeAdAccountId: string | null): Promise<string[]> {
  const set = new Set<string>();
  if (activeAdAccountId) set.add(formatAct(activeAdAccountId));
  const tpl = await db
    .selectDistinct({ act: schema.templates.adAccountId })
    .from(schema.templates)
    .where(isNotNull(schema.templates.adAccountId));
  for (const t of tpl) if (t.act) set.add(formatAct(t.act));
  const hist = await db
    .selectDistinct({ act: schema.insights.adAccountId })
    .from(schema.insights)
    .where(isNotNull(schema.insights.adAccountId));
  for (const h of hist) if (h.act) set.add(formatAct(h.act));
  // ads_cache covers accounts that have ads but no delivery yet (e.g. a fresh
  // US account right after its first uploads) — without this they'd stay
  // invisible until the first insights row exists, which requires this sync.
  const cached = await db
    .selectDistinct({ act: schema.adsCache.adAccountId })
    .from(schema.adsCache)
    .where(isNotNull(schema.adsCache.adAccountId));
  for (const c of cached) if (c.act) set.add(formatAct(c.act));
  return [...set];
}

export async function runSync() {
  const account = await resolveAccount();
  const accounts = await accountsToSync(account.adAccountId);
  const results: Record<string, unknown> = {};
  for (const act of accounts) {
    try {
      results[act] = await withAdAccount(act, () =>
        syncOneAccount(act, act === account.adAccountId)
      );
    } catch (e) {
      results[act] = { error: e instanceof Error ? e.message : String(e) };
      console.error(`runSync failed for ${act}:`, e);
    }
  }
  return results;
}

async function syncOneAccount(adAccountId: string, isPrimary: boolean) {
  const today = new Date().toISOString().split("T")[0];
  const since = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];

  // 1. Campaign metadata
  const campaigns = await getCampaigns();
  for (const c of campaigns) {
    await db.insert(schema.campaignsCache).values({
      id: c.id, adAccountId, name: c.name, status: c.status, objective: c.objective,
      dailyBudget: c.daily_budget ? parseFloat(c.daily_budget) / 100 : null,
    }).onConflictDoUpdate({
      target: schema.campaignsCache.id,
      set: { name: c.name, status: c.status, adAccountId, syncedAt: new Date() },
    });
  }

  // 1b. Ad set metadata → adsets_cache (names / status / created_time for the
  // Learning Loop). Best-effort: a failure here must not stop the insights.
  let adsetCount = 0;
  try {
    adsetCount = await syncAdsetsCache();
  } catch (e) {
    console.error(`adsets_cache sync failed for ${adAccountId}:`, e instanceof Error ? e.message : e);
  }

  // 2. Ad metadata → ads_cache (for ad names on the editor dashboard)
  const ads = await getAds();
  for (const ad of ads) {
    await db.insert(schema.adsCache).values({
      id: ad.id,
      adAccountId,
      adsetId: ad.adset_id,
      campaignId: ad.campaign_id,
      name: ad.name,
      status: ad.status,
      creativeId: ad.creative?.id || null,
      videoId: ad.creative?.video_id || null,
      imageHash: ad.creative?.image_hash || null,
    }).onConflictDoUpdate({
      target: schema.adsCache.id,
      set: {
        name: ad.name, status: ad.status,
        adAccountId,
        creativeId: ad.creative?.id || null,
        videoId: ad.creative?.video_id || null,
        imageHash: ad.creative?.image_hash || null,
        syncedAt: new Date(),
      },
    });
  }

  // 3. Campaign-level daily insights
  const campaignInsights = await getInsights({
    level: "campaign",
    dateRange: { since, until: today },
    timeIncrement: 1,
  });
  const campaignRows = campaignInsights.filter((r) => r.campaign_id).map((r) => toRow(r, r.campaign_id!, "campaign", adAccountId));
  await replaceInsights("campaign", since, today, campaignRows, adAccountId, isPrimary);

  // 4. Ad-level daily insights (powers the editor dashboard) — with video metrics.
  //
  // Fetched in weekly chunks. A single 30-day request across every ad in a large
  // account is big enough that Meta's pagination gives up partway ("an unknown
  // error occurred"); combined with the delete-then-write below that silently
  // shrank the table, because a whole window was cleared and only the fraction
  // that arrived was written back. Small windows paginate cleanly, and each
  // chunk replaces only its own days, so a failure late in the run cannot
  // damage the days already rebuilt.
  let adRowCount = 0;
  let cursor = since;
  while (cursor <= today) {
    const chunkEnd = addDays(cursor, AD_INSIGHT_CHUNK_DAYS - 1) < today
      ? addDays(cursor, AD_INSIGHT_CHUNK_DAYS - 1)
      : today;
    const chunk = await getInsights({
      level: "ad",
      dateRange: { since: cursor, until: chunkEnd },
      timeIncrement: 1,
      includeVideoMetrics: true,
    });
    const rows = chunk.filter((r) => r.ad_id).map((r) => toRow(r, r.ad_id!, "ad", adAccountId));
    await replaceInsights("ad", cursor, chunkEnd, rows, adAccountId, isPrimary);
    adRowCount += rows.length;
    cursor = addDays(chunkEnd, 1);
  }

  return {
    campaigns: campaigns.length,
    adsets: adsetCount,
    ads: ads.length,
    campaignInsightRows: campaignRows.length,
    adInsightRows: adRowCount,
  };
}
