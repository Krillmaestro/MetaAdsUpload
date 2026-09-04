// Insight aggregation per ad set (server-only: touches the DB).
//
// The `insights` table holds one row per ad per day. The Learning Loop wants
// one row per AD SET (that is the unit the team tests, tags and pays bonuses
// on), so this rolls ads up through ads_cache.adset_id. Two calls are typical:
// one for the selected window and one for lifetime — both cheap, the table is
// tens of thousands of rows.

import { db, schema } from "@/db";
import { and, eq, gte, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";

export interface AdAgg {
  adId: string;
  name: string | null;
  status: string | null;
  adsetId: string;
  campaignId: string | null;
  videoId: string | null;
  imageHash: string | null;
  spend: number;
  impressions: number;
  linkClicks: number;
  purchases: number;
  purchaseValue: number;
  videoViews3s: number;
  videoThruplays: number;
  firstDate: string | null; // first day with spend
  lastDate: string | null; // last day with spend
}

export interface AdsetAgg extends Omit<AdAgg, "adId" | "name" | "status" | "videoId" | "imageHash"> {
  activeDays: number;
  ads: AdAgg[];
}

export interface Ratios {
  roas: number;
  cpa: number;
  ctr: number;
  cpm: number;
  hookRate: number;
  holdRate: number;
}

export function ratios(m: { spend: number; impressions: number; linkClicks: number; purchases: number; purchaseValue: number; videoViews3s: number; videoThruplays: number }): Ratios {
  return {
    roas: m.spend > 0 ? m.purchaseValue / m.spend : 0,
    cpa: m.purchases > 0 ? m.spend / m.purchases : 0,
    ctr: m.impressions > 0 ? (m.linkClicks / m.impressions) * 100 : 0,
    cpm: m.impressions > 0 ? (m.spend / m.impressions) * 1000 : 0,
    hookRate: m.impressions > 0 ? (m.videoViews3s / m.impressions) * 100 : 0,
    holdRate: m.videoViews3s > 0 ? (m.videoThruplays / m.videoViews3s) * 100 : 0,
  };
}

export interface AggregateOptions {
  since?: string | null; // yyyy-mm-dd inclusive
  until?: string | null;
  /** Ad account ids ("act_…"). Omit for every account. */
  accountIds?: string[] | null;
  /** Treat rows with a NULL ad_account_id (pre-stamping era) as belonging to the account. */
  includeLegacyNull?: boolean;
}

export async function aggregateInsightsByAdset(opts: AggregateOptions = {}): Promise<Map<string, AdsetAgg>> {
  const i = schema.insights;
  const a = schema.adsCache;
  const conds: SQL[] = [eq(i.entityType, "ad"), isNull(i.breakdownKey)];
  if (opts.since) conds.push(gte(i.dateStart, opts.since));
  if (opts.until) conds.push(lte(i.dateStart, opts.until));
  if (opts.accountIds && opts.accountIds.length) {
    const acct = sql<string>`coalesce(${a.adAccountId}, ${i.adAccountId})`;
    const inList = inArray(acct, opts.accountIds);
    conds.push(opts.includeLegacyNull ? (or(inList, isNull(acct)) as SQL) : inList);
  }

  const rows = await db
    .select({
      adsetId: a.adsetId,
      campaignId: a.campaignId,
      adId: i.entityId,
      name: a.name,
      status: a.status,
      videoId: a.videoId,
      imageHash: a.imageHash,
      spend: sql<number>`coalesce(sum(${i.spend}), 0)`,
      impressions: sql<number>`coalesce(sum(${i.impressions}), 0)`,
      linkClicks: sql<number>`coalesce(sum(${i.linkClicks}), 0)`,
      purchases: sql<number>`coalesce(sum(${i.purchases}), 0)`,
      purchaseValue: sql<number>`coalesce(sum(${i.purchaseValue}), 0)`,
      videoViews3s: sql<number>`coalesce(sum(${i.videoViews3s}), 0)`,
      videoThruplays: sql<number>`coalesce(sum(${i.videoThruplays}), 0)`,
      firstDate: sql<string | null>`min(${i.dateStart}) filter (where ${i.spend} > 0)`,
      lastDate: sql<string | null>`max(${i.dateStart}) filter (where ${i.spend} > 0)`,
      activeDays: sql<number>`count(distinct ${i.dateStart}) filter (where ${i.spend} > 0)`,
    })
    .from(i)
    .innerJoin(a, eq(a.id, i.entityId))
    .where(and(...conds))
    .groupBy(a.adsetId, a.campaignId, i.entityId, a.name, a.status, a.videoId, a.imageHash);

  const out = new Map<string, AdsetAgg>();
  for (const r of rows) {
    const ad: AdAgg = {
      adId: r.adId,
      name: r.name,
      status: r.status,
      adsetId: r.adsetId,
      campaignId: r.campaignId || null,
      videoId: r.videoId,
      imageHash: r.imageHash,
      spend: Number(r.spend) || 0,
      impressions: Number(r.impressions) || 0,
      linkClicks: Number(r.linkClicks) || 0,
      purchases: Number(r.purchases) || 0,
      purchaseValue: Number(r.purchaseValue) || 0,
      videoViews3s: Number(r.videoViews3s) || 0,
      videoThruplays: Number(r.videoThruplays) || 0,
      firstDate: r.firstDate ? String(r.firstDate).slice(0, 10) : null,
      lastDate: r.lastDate ? String(r.lastDate).slice(0, 10) : null,
    };
    let set = out.get(r.adsetId);
    if (!set) {
      set = {
        adsetId: r.adsetId,
        campaignId: r.campaignId || null,
        spend: 0, impressions: 0, linkClicks: 0, purchases: 0, purchaseValue: 0,
        videoViews3s: 0, videoThruplays: 0, firstDate: null, lastDate: null, activeDays: 0, ads: [],
      };
      out.set(r.adsetId, set);
    }
    set.ads.push(ad);
    set.spend += ad.spend;
    set.impressions += ad.impressions;
    set.linkClicks += ad.linkClicks;
    set.purchases += ad.purchases;
    set.purchaseValue += ad.purchaseValue;
    set.videoViews3s += ad.videoViews3s;
    set.videoThruplays += ad.videoThruplays;
    if (ad.firstDate && (!set.firstDate || ad.firstDate < set.firstDate)) set.firstDate = ad.firstDate;
    if (ad.lastDate && (!set.lastDate || ad.lastDate > set.lastDate)) set.lastDate = ad.lastDate;
    // Per-ad activeDays can't be unioned exactly without the day list; use the
    // max across ads as the ad set's active days (ads in a set run together).
    set.activeDays = Math.max(set.activeDays, Number(r.activeDays) || 0);
  }
  for (const set of out.values()) set.ads.sort((x, y) => y.spend - x.spend);
  return out;
}

/** Every ad across all ad sets, keyed by ad id. */
export function adsFromAdsets(agg: Map<string, AdsetAgg>): Map<string, AdAgg> {
  const out = new Map<string, AdAgg>();
  for (const set of agg.values()) for (const ad of set.ads) out.set(ad.adId, ad);
  return out;
}

export function daysBetween(from: string | null | undefined, to: string): number {
  if (!from) return 0;
  const a = new Date(`${from.slice(0, 10)}T00:00:00Z`).getTime();
  const b = new Date(`${to.slice(0, 10)}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000)) + 1;
}

export function isoDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function shiftDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
