// Shared insights sync — used by the cron route (GET/POST) and the admin
// "Sync now" button. Pulls daily campaign + ad insights (with video metrics)
// from Meta into the insights table, and refreshes campaign/ad metadata caches.
//
// Two jobs, split so each fits a Vercel function:
//  - runSync():               every account, the rolling window, account-wide
//                             (a handful of Meta calls per account). This is
//                             what keeps editor numbers current — archived and
//                             deleted ads included.
//  - runEditorInsightsSync(): lifetime BACKFILL of owned ad sets that have not
//                             been backfilled yet (bonuses are lifetime), then
//                             a ledger refresh.
// All writes are bulk upserts on (entity_type, entity_id, date_start), so a
// re-run or an overlapping run can never double a day.

import { db, schema } from "@/db";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import {
  getInsights,
  getAdsetInsightsByAd,
  extractPurchases,
  extractPurchaseValue,
  calculateROAS,
  extractThruplays,
  type InsightData,
} from "./insights";
import { getCampaigns, upsertCampaignsCache } from "./campaigns";
import { reconcilePostedAssignments } from "@/lib/assignments/reconcile-posted";
import { getAdSets } from "./adsets";
import { type Ad } from "./ads";
import { metaApi, metaApiPaginated, resolveAccount, withAdAccount, getAdAccountId, MetaApiError } from "./client";
import { withLock } from "@/lib/sync-lock";
import { refreshBonusLedger } from "@/lib/bonus-ledger";

const WRITE_CHUNK = 500;

function chunks<T>(arr: T[], size = WRITE_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Excluded-column assignments for an upsert: every listed column takes the incoming value. */
function excludedSet(cols: Record<string, string>) {
  return Object.fromEntries(Object.entries(cols).map(([key, col]) => [key, sql.raw(`excluded.${col}`)]));
}

/**
 * Ad set metadata → adsets_cache for the CURRENT account context (call inside
 * withAdAccount). Names, status and created_time are what the Learning Loop
 * needs to show an ad set that has not spent yet and to count "days live".
 */
export async function syncAdsetsCache(): Promise<number> {
  const adAccountId = await getAdAccountId();
  const adsets = await getAdSets(undefined, 500);
  const now = new Date();
  const rows = adsets.map((s) => ({
    id: s.id,
    targeting: (s.targeting ?? {}) as Record<string, unknown>,
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
    syncedAt: now,
  }));
  for (const chunk of chunks(rows)) {
    await db.insert(schema.adsetsCache).values(chunk).onConflictDoUpdate({
      target: schema.adsetsCache.id,
      set: excludedSet({
        adAccountId: "ad_account_id", campaignId: "campaign_id", name: "name", status: "status",
        effectiveStatus: "effective_status", dailyBudget: "daily_budget", lifetimeBudget: "lifetime_budget",
        optimizationGoal: "optimization_goal", billingEvent: "billing_event", bidStrategy: "bid_strategy",
        startTime: "start_time", endTime: "end_time", createdTime: "created_time", syncedAt: "synced_at",
      }),
    });
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
 * Bulk upsert on (entity_type, entity_id, date_start). Replaces the old
 * delete-then-insert: nothing is ever cleared, so a failed or partial fetch
 * can only leave a day stale (repaired next run), never missing or doubled.
 */
async function upsertInsights(rows: InsightRow[]): Promise<number> {
  // Postgres rejects an upsert that touches the same key twice in one
  // statement — keep the last occurrence per key.
  const byKey = new Map<string, InsightRow>();
  for (const r of rows) byKey.set(`${r.entityType}|${r.entityId}|${r.dateStart}`, r);
  const unique = [...byKey.values()];
  for (const chunk of chunks(unique)) {
    await db.insert(schema.insights).values(chunk).onConflictDoUpdate({
      target: [schema.insights.entityType, schema.insights.entityId, schema.insights.dateStart],
      targetWhere: sql`breakdown_key IS NULL`,
      set: {
        ...excludedSet({
          adAccountId: "ad_account_id", dateStop: "date_stop", spend: "spend", impressions: "impressions",
          reach: "reach", clicks: "clicks", linkClicks: "link_clicks", ctr: "ctr", cpc: "cpc", cpm: "cpm",
          purchases: "purchases", purchaseValue: "purchase_value", roas: "roas",
          videoViews3s: "video_views_3s", videoThruplays: "video_thruplays",
        }),
        syncedAt: sql`now()`,
      },
    });
  }
  return unique.length;
}

/**
 * ads_cache rows for ads that only appear in insights (archived/deleted ads are
 * not listed by /ads). Without a row their insights never join to an ad set.
 * Existing rows are left alone — /ads metadata is richer.
 */
async function upsertAdStubs(data: InsightData[], adAccountId: string | null): Promise<void> {
  const stubs = new Map<string, typeof schema.adsCache.$inferInsert>();
  for (const r of data) {
    if (!r.ad_id || !r.adset_id || stubs.has(r.ad_id)) continue;
    stubs.set(r.ad_id, {
      id: r.ad_id,
      adAccountId,
      adsetId: r.adset_id,
      campaignId: r.campaign_id || "",
      name: r.ad_name || r.ad_id,
      // Every live ad is listed by /ads (upserted with its real status before
      // this runs); one that only shows up here is archived or deleted.
      status: "ARCHIVED",
    });
  }
  for (const chunk of chunks([...stubs.values()])) {
    await db.insert(schema.adsCache).values(chunk).onConflictDoNothing({ target: schema.adsCache.id });
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
const MAX_HISTORY_DAYS = 1100; // Meta retains ~37 months of insights
const DEFAULT_WINDOW_DAYS = 30; // attribution keeps moving for ~28 days

/** Time budget per function run (maxDuration is 300s) — stop cleanly before the kill. */
export const SYNC_BUDGET_MS = 240_000;

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split("T")[0];
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().split("T")[0];
}

function formatAct(id: string): string {
  return id.startsWith("act_") ? id : `act_${id}`;
}

/**
 * Lifetime backfill for owned ad sets that have never been backfilled, then a
 * bonus-ledger refresh. The rolling window is NOT refetched here — runSync
 * already covers every account's ads (archived/deleted included), so per-ad-set
 * window refreshes were ~3 duplicate Meta calls per owned ad set per night.
 * Runs until the time budget is spent; whatever is left continues next run.
 */
export async function runEditorInsightsSync(opts: { deadline?: number } = {}) {
  const deadline = opts.deadline ?? Date.now() + SYNC_BUDGET_MS;
  const result = await withLock("insights-editor", 300, async () => {
    const today = daysAgo(0);
    const oldestAllowed = daysAgo(MAX_HISTORY_DAYS);

    // Ad sets linked only through an assignment get an adset_owners row, so
    // they are tracked (backfilledAt) like every other owned ad set. Same
    // owner the assignment already implies — resolveOwnedAdsets is unchanged.
    await db.execute(sql`
      INSERT INTO adset_owners (adset_id, video_editor_id, creative_strategist_id, campaign_id, adset_name, source, updated_at)
      SELECT DISTINCT ON (a.meta_adset_id) a.meta_adset_id, a.assigned_to_id, a.creative_strategist_id, a.meta_campaign_id, a.auto_name, 'assignment', now()
      FROM assignments a
      WHERE a.meta_adset_id IS NOT NULL AND a.meta_adset_id <> ''
      ORDER BY a.meta_adset_id, a.updated_at DESC
      ON CONFLICT (adset_id) DO NOTHING`);

    // source='demo' rows are fabricated showcase data — never sent to the API.
    const pending = await db
      .select({ adsetId: schema.adsetOwners.adsetId })
      .from(schema.adsetOwners)
      .where(and(isNull(schema.adsetOwners.backfilledAt), sql`coalesce(${schema.adsetOwners.source}, '') <> 'demo'`));

    let backfilled = 0;
    let rowsWritten = 0;
    const failed: string[] = [];

    for (let i = 0; i < pending.length; i += 50) {
      if (Date.now() > deadline) break;
      const batch = pending.slice(i, i + 50).map((p) => p.adsetId);

      // created_time bounds each backfill; account_id stamps the rows. One call per 50 ad sets.
      let info: Record<string, { created_time?: string; account_id?: string; name?: string }> = {};
      try {
        info = await metaApi<typeof info>("/", { params: { ids: batch.join(","), fields: "name,created_time,account_id" } });
      } catch (e) {
        console.error("Ad set info batch failed:", e instanceof Error ? e.message : e);
      }

      for (const adsetId of batch) {
        if (Date.now() > deadline) break;
        const meta = info[adsetId];
        const created = meta?.created_time?.slice(0, 10);
        const since = created && created > oldestAllowed ? created : oldestAllowed;
        const adsetAccountId = meta?.account_id ? formatAct(meta.account_id) : null;
        try {
          const data: InsightData[] = [];
          for (let cursor = since; cursor <= today; ) {
            const end = addDays(cursor, BACKFILL_CHUNK_DAYS - 1) < today ? addDays(cursor, BACKFILL_CHUNK_DAYS - 1) : today;
            data.push(...(await getAdsetInsightsByAd(adsetId, { since: cursor, until: end }, 1)));
            cursor = addDays(end, 1);
          }
          await upsertAdStubs(data, adsetAccountId);
          rowsWritten += await upsertInsights(
            data.filter((r) => r.ad_id).map((r) => toRow(r, r.ad_id!, "ad", adsetAccountId))
          );
          await db
            .update(schema.adsetOwners)
            .set({ backfilledAt: new Date(), updatedAt: new Date(), ...(meta?.name ? { adsetName: meta.name } : {}) })
            .where(eq(schema.adsetOwners.adsetId, adsetId));
          backfilled++;
        } catch (e) {
          // Not marked backfilled → retried next run. Nothing was deleted.
          failed.push(adsetId);
          console.error(`Backfill failed for ad set ${adsetId}:`, e instanceof Error ? e.message : e);
        }
      }
    }

    const ledger = await refreshBonusLedger();
    return {
      backfilled,
      backfillsPending: Math.max(pending.length - backfilled, 0),
      adInsightRows: rowsWritten,
      failed: failed.length,
      ledger,
    };
  });
  return result ?? { skipped: "another sync is running" };
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
  const [tpl, hist, cached] = await Promise.all([
    db.selectDistinct({ act: schema.templates.adAccountId }).from(schema.templates).where(isNotNull(schema.templates.adAccountId)),
    db.selectDistinct({ act: schema.insights.adAccountId }).from(schema.insights).where(isNotNull(schema.insights.adAccountId)),
    // ads_cache covers accounts that have ads but no delivery yet (e.g. a fresh
    // US account right after its first uploads).
    db.selectDistinct({ act: schema.adsCache.adAccountId }).from(schema.adsCache).where(isNotNull(schema.adsCache.adAccountId)),
  ]);
  for (const r of [...tpl, ...hist, ...cached]) if (r.act) set.add(formatAct(r.act));
  return [...set];
}

/**
 * Account-wide sync. `days` = how far back the rolling window reaches (the
 * nightly run uses 30 so attribution revisions land; the manual button uses a
 * short window so it returns in seconds).
 */
export async function runSync(opts: { days?: number; deadline?: number } = {}) {
  const days = opts.days ?? DEFAULT_WINDOW_DAYS;
  const deadline = opts.deadline ?? Date.now() + SYNC_BUDGET_MS;
  const result = await withLock("insights-accounts", 300, async () => {
    const account = await resolveAccount();
    const accounts = await accountsToSync(account.adAccountId);
    const results: Record<string, unknown> = {};
    for (const act of accounts) {
      if (Date.now() > deadline) { results[act] = { skipped: "time budget" }; continue; }
      try {
        results[act] = await withAdAccount(act, () => syncOneAccount(act, days, deadline));
      } catch (e) {
        results[act] = { error: e instanceof Error ? e.message : String(e) };
        console.error(`runSync failed for ${act}:`, e);
      }
    }
    // Ad sets launched outside the app: their assignments are posted now.
    try {
      const r = await reconcilePostedAssignments(null);
      if (r.posted.length || r.linked.length) results.reconciled = { posted: r.posted.length, linked: r.linked.length };
    } catch (e) { console.error("reconcile posted assignments failed:", e); }
    // Owner rows show the ad set's current name — refresh from the cache in one statement.
    await db.execute(sql`
      UPDATE adset_owners o SET adset_name = c.name, updated_at = now()
      FROM adsets_cache c
      WHERE c.id = o.adset_id AND c.name IS DISTINCT FROM o.adset_name`);
    return results;
  });
  return result ?? { skipped: "another sync is running" };
}

/** Meta refuses a sync insights call whose result has too many rows (error 100 / subcode 1487534). */
function isTooManyRows(e: unknown): boolean {
  if (e instanceof MetaApiError && (e.metaErrorSubcode === 1487534 || /too many rows|för många rader|reduce the amount of data/i.test(e.message))) return true;
  return e instanceof Error && /too many rows|för många rader|reduce the amount of data/i.test(e.message);
}

/**
 * Ad-level daily insights for a date window, shrinking the request until Meta
 * accepts it: the whole window → one day at a time → one campaign at a time
 * for that day. Accounts with thousands of archived ads (ApotekHunden) exceed
 * Meta's row limit even for a two-day window, which used to fail the whole
 * account's sync.
 */
async function getAdInsightsWithinLimits(since: string, until: string, campaignIds: string[]): Promise<InsightData[]> {
  const base = { level: "ad" as const, timeIncrement: 1, includeVideoMetrics: true, includeAllAdStatuses: true };
  try {
    return await getInsights({ ...base, dateRange: { since, until } });
  } catch (e) {
    if (!isTooManyRows(e)) throw e;
  }
  if (since !== until) {
    const out: InsightData[] = [];
    for (let day = until; day >= since; day = addDays(day, -1)) out.push(...(await getAdInsightsWithinLimits(day, day, campaignIds)));
    return out;
  }
  // a single day is still too big: one campaign at a time
  const out: InsightData[] = [];
  for (const campaignId of campaignIds) {
    out.push(...(await getInsights({ ...base, entityId: campaignId, dateRange: { since, until } })));
  }
  return out;
}

async function syncOneAccount(adAccountId: string, days: number, deadline: number) {
  const today = daysAgo(0);
  const since = daysAgo(days);

  // 1. Campaign metadata (budgets included — the Upload dialog reads CBO/ABO from here)
  const campaigns = await getCampaigns();
  const campaignCount = await upsertCampaignsCache(adAccountId, campaigns);

  // 1b. Ad set metadata → adsets_cache. Best-effort: a failure here must not stop the insights.
  let adsetCount = 0;
  try {
    adsetCount = await syncAdsetsCache();
  } catch (e) {
    console.error(`adsets_cache sync failed for ${adAccountId}:`, e instanceof Error ? e.message : e);
  }

  // 2. Ad metadata → ads_cache. Lean field list: preview_shareable_link is
  // expensive for Meta to build and the sync never stored it.
  const ads = await metaApiPaginated<Ad>(`/${adAccountId}/ads`, {
    params: { fields: "id,adset_id,campaign_id,name,status,creative{id,video_id,image_hash}", limit: 500 },
  });
  for (const chunk of chunks(ads)) {
    await db.insert(schema.adsCache).values(chunk.map((ad) => ({
      id: ad.id,
      adAccountId,
      adsetId: ad.adset_id,
      campaignId: ad.campaign_id,
      name: ad.name,
      status: ad.status,
      creativeId: ad.creative?.id || null,
      videoId: ad.creative?.video_id || null,
      imageHash: ad.creative?.image_hash || null,
    }))).onConflictDoUpdate({
      target: schema.adsCache.id,
      set: {
        ...excludedSet({
          name: "name", status: "status", adAccountId: "ad_account_id", adsetId: "adset_id", campaignId: "campaign_id",
          creativeId: "creative_id", videoId: "video_id", imageHash: "image_hash",
        }),
        syncedAt: sql`now()`,
      },
    });
  }

  // 3. Campaign-level daily insights
  const campaignInsights = await getInsights({ level: "campaign", dateRange: { since, until: today }, timeIncrement: 1 });
  const campaignRows = campaignInsights.filter((r) => r.campaign_id).map((r) => toRow(r, r.campaign_id!, "campaign", adAccountId));
  await upsertInsights(campaignRows);

  // 4. Ad-level daily insights (powers the editor dashboard), ARCHIVED and
  // DELETED ads included — Meta drops them unless asked, and the editor's
  // lifetime numbers need every ad that ever spent. Weekly chunks paginate
  // cleanly on accounts with thousands of ads; each chunk is written as soon
  // as it arrives. Newest first: if the budget runs out, the days left for
  // tomorrow are the oldest ones, which barely move.
  let adRowCount = 0;
  let complete = true;
  for (let chunkEnd = today; chunkEnd >= since; ) {
    if (Date.now() > deadline) { complete = false; break; }
    const chunkStart = addDays(chunkEnd, -(AD_INSIGHT_CHUNK_DAYS - 1)) > since ? addDays(chunkEnd, -(AD_INSIGHT_CHUNK_DAYS - 1)) : since;
    const chunk = await getAdInsightsWithinLimits(chunkStart, chunkEnd, campaigns.map((c) => c.id));
    await upsertAdStubs(chunk, adAccountId);
    adRowCount += await upsertInsights(chunk.filter((r) => r.ad_id).map((r) => toRow(r, r.ad_id!, "ad", adAccountId)));
    chunkEnd = addDays(chunkStart, -1);
  }

  return {
    campaigns: campaignCount,
    adsets: adsetCount,
    ads: ads.length,
    campaignInsightRows: campaignRows.length,
    adInsightRows: adRowCount,
    complete,
  };
}
