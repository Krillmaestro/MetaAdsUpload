// ─── Editor performance aggregation (server-only) ───────────────────────────
// The bonus UNIT is the AD SET. Each editor owns ad sets; the bonus is computed
// on the ad set's aggregate lifetime spend + blended ROAS (see bonus-ledger).
// Each ad set drills down into its individual ads. Money is shown in USD —
// every insight row is converted by its own ad account's currency.
//
// Read-only: the ledger is refreshed by the sync (and owner changes), never by
// a page view. Results are cached under the "editor-stats" tag; everything that
// changes the numbers calls invalidateEditorStats().

import { unstable_cache, revalidateTag } from "next/cache";
import { db, schema } from "@/db";
import { and, eq, gte, lte, sql, inArray } from "drizzle-orm";
import { slugify } from "./bonus";
import { resolveOwnedAdsets, readLedger } from "./bonus-ledger";
import { getEvolveSettings } from "./evolve/settings";
import { getUsdAccountIds, usdFactor } from "./money";

export const EDITOR_STATS_TAG = "editor-stats";

/** Drop the cached editor numbers now (after a sync, payout or owner change). */
export function invalidateEditorStats(): void {
  try {
    revalidateTag(EDITOR_STATS_TAG, { expire: 0 });
  } catch (e) {
    console.error("invalidateEditorStats failed:", e);
  }
}

export interface EditorAdRow {
  id: string;
  name: string;
  spend: number;
  impressions: number;
  purchases: number;
  purchaseValue: number;
  roas: number;
  ctr: number;
  hookRate: number;
  holdRate: number;
  cpc: number;
  cpm: number;
  angle: string | null;
  problem: string | null;
  templateName: string | null;
}

export interface EditorAdsetRow {
  adsetId: string;
  adsetName: string;
  campaignId: string | null;
  strategistName: string | null;
  spend: number;
  impressions: number;
  purchases: number;
  purchaseValue: number;
  roas: number;
  ctr: number;
  hookRate: number;
  holdRate: number;
  cpc: number;
  cpm: number;
  bonus: number;
  bonusTier: number;
  tierLog: Record<string, string>;
  paidForAdset: number;
  pendingForAdset: number;
  outstanding: number;
  lifetimeSpend: number;
  lifetimeRoas: number;
  isWinner: boolean;
  graveyardOutcome: string | null;
  adCount: number;
  /** Ads that delivered in the selected period (adCount counts all of them). */
  ads: EditorAdRow[];
}

const r2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;

type UserLite = { id: string; name: string; slug: string | null; userType: string | null };

async function ensureSlugs(editorIds: string[], users: UserLite[]) {
  const taken = new Set(users.map((u) => u.slug).filter(Boolean) as string[]);
  for (const id of editorIds) {
    const u = users.find((x) => x.id === id);
    if (!u || u.slug) continue;
    const base = slugify(u.name) || `editor-${id.slice(0, 6)}`;
    let candidate = base;
    let n = 2;
    while (taken.has(candidate)) candidate = `${base}-${n++}`;
    taken.add(candidate);
    u.slug = candidate;
    try {
      await db.update(schema.users).set({ slug: candidate, updatedAt: new Date() }).where(eq(schema.users.id, id));
    } catch { /* unique-index race — ignore */ }
  }
}

/** Per-ad set amount sitting in PENDING payouts — not yet paid, but no longer outstanding. */
function pendingByAdset(payouts: (typeof schema.editorPayouts.$inferSelect)[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of payouts) {
    if (p.status !== "pending") continue;
    for (const b of p.breakdown || []) {
      if (b.adId) map.set(b.adId, (map.get(b.adId) || 0) + (Number(b.bonus) || 0));
    }
  }
  return map;
}

async function computeEditorsOverview(from: string, to: string) {
  const [allUsers, settings, ownedAll, usdAccounts] = await Promise.all([
    db.select({ id: schema.users.id, name: schema.users.name, slug: schema.users.slug, userType: schema.users.userType }).from(schema.users),
    getEvolveSettings(),
    resolveOwnedAdsets(),
    getUsdAccountIds(),
  ]);
  const userMap = new Map(allUsers.map((u) => [u.id, u]));
  const rate = settings.sekPerUsd > 0 ? settings.sekPerUsd : 10.5;
  const factor = usdFactor(usdAccounts, rate);

  // source='demo' = fabricated showcase rows. They are not real ad sets and
  // must never count toward anyone's numbers, bonus or payouts.
  const ownedAdsets = ownedAll.filter((a) => a.source !== "demo");
  const ownedAdsetIds = ownedAdsets.map((a) => a.adsetId);

  // Ads per owned ad set + their period insights (USD) + ledger — independent, in parallel.
  const [adsInSets, periodAd, ledgerRows] = await Promise.all([
    ownedAdsetIds.length
      ? db
          .select({ id: schema.adsCache.id, name: schema.adsCache.name, adsetId: schema.adsCache.adsetId })
          .from(schema.adsCache)
          .where(inArray(schema.adsCache.adsetId, ownedAdsetIds))
      : Promise.resolve([] as Array<{ id: string; name: string; adsetId: string }>),
    ownedAdsetIds.length
      ? db
          .select({
            entityId: schema.insights.entityId,
            spend: sql<number>`coalesce(sum(${schema.insights.spend} * ${factor}),0)`,
            impressions: sql<number>`coalesce(sum(${schema.insights.impressions}),0)`,
            linkClicks: sql<number>`coalesce(sum(${schema.insights.linkClicks}),0)`,
            purchases: sql<number>`coalesce(sum(${schema.insights.purchases}),0)`,
            purchaseValue: sql<number>`coalesce(sum(${schema.insights.purchaseValue} * ${factor}),0)`,
            videoViews3s: sql<number>`coalesce(sum(${schema.insights.videoViews3s}),0)`,
            videoThruplays: sql<number>`coalesce(sum(${schema.insights.videoThruplays}),0)`,
          })
          .from(schema.insights)
          .innerJoin(schema.adsCache, eq(schema.insights.entityId, schema.adsCache.id))
          .where(and(
            eq(schema.insights.entityType, "ad"),
            inArray(schema.adsCache.adsetId, ownedAdsetIds),
            gte(schema.insights.dateStart, from),
            lte(schema.insights.dateStart, to),
          ))
          .groupBy(schema.insights.entityId)
      : Promise.resolve([]),
    readLedger(ownedAdsetIds),
  ]);

  const ledgerByAdset = new Map(ledgerRows.map((r) => [r.adId, r]));
  const adsByAdset = new Map<string, Array<{ id: string; name: string }>>();
  for (const a of adsInSets) {
    const list = adsByAdset.get(a.adsetId) || [];
    list.push({ id: a.id, name: a.name });
    adsByAdset.set(a.adsetId, list);
  }
  const allAdIds = adsInSets.map((a) => a.id);
  const periodByAd = new Map(periodAd.map((r) => [r.entityId, r]));

  const editorIdsAll = [...new Set(ownedAdsets.map((a) => a.videoEditorId).filter(Boolean) as string[])];
  const [adMetaRows, payouts] = await Promise.all([
    allAdIds.length
      ? db
          .select({
            adId: schema.adOwners.adId,
            angle: schema.adOwners.angle,
            problem: schema.adOwners.problem,
            templateId: schema.adOwners.templateId,
            templateName: schema.adOwners.templateName,
          })
          .from(schema.adOwners)
          .where(inArray(schema.adOwners.adId, allAdIds))
      : Promise.resolve([]),
    editorIdsAll.length
      ? db.select().from(schema.editorPayouts).where(inArray(schema.editorPayouts.editorId, editorIdsAll))
      : Promise.resolve([] as (typeof schema.editorPayouts.$inferSelect)[]),
  ]);
  const adMetaById = new Map(adMetaRows.map((r) => [r.adId, r]));
  const pendingAdset = pendingByAdset(payouts);

  const editorMap = new Map<string, { editorId: string; adsets: EditorAdsetRow[]; angleAgg: Map<string, { angle: string; ads: number; winners: number }> }>();
  const strategistMap = new Map<string, { id: string; adsets: number; winners: number }>();
  const templateMap = new Map<number, { templateId: number; templateName: string; ads: number; winners: number; spend: number; revenue: number }>();
  const anglePerf = new Map<string, { name: string; ads: number; winners: number; spend: number; revenue: number }>();
  const problemPerf = new Map<string, { name: string; ads: number; winners: number; spend: number; revenue: number }>();
  // Raw per-editor sums for CTR/hook/hold — exact, not re-derived from rounded rates.
  const rawTotals = new Map<string, { link: number; v3: number; thru: number }>();

  for (const owned of ownedAdsets) {
    const ledger = ledgerByAdset.get(owned.adsetId);
    const adsList = adsByAdset.get(owned.adsetId) || [];
    const bonus = ledger?.earnedBonus || 0;
    const isWinner = bonus > 0;
    type EditorEntry = { editorId: string; adsets: EditorAdsetRow[]; angleAgg: Map<string, { angle: string; ads: number; winners: number }> };
    const entry: EditorEntry | null = owned.videoEditorId
      ? editorMap.get(owned.videoEditorId) || { editorId: owned.videoEditorId, adsets: [], angleAgg: new Map() }
      : null;

    let aggSpend = 0, aggImpr = 0, aggLink = 0, aggPurch = 0, aggPv = 0, aggV3 = 0, aggThru = 0;
    const ads: EditorAdRow[] = [];
    for (const ad of adsList) {
      const p = periodByAd.get(ad.id);
      const spend = Number(p?.spend) || 0;
      const impressions = Number(p?.impressions) || 0;
      const linkClicks = Number(p?.linkClicks) || 0;
      const purchases = Number(p?.purchases) || 0;
      const pv = Number(p?.purchaseValue) || 0;
      const v3 = Number(p?.videoViews3s) || 0;
      const thru = Number(p?.videoThruplays) || 0;
      aggSpend += spend; aggImpr += impressions; aggLink += linkClicks; aggPurch += purchases; aggPv += pv; aggV3 += v3; aggThru += thru;
      const meta = adMetaById.get(ad.id);
      // Ad-level tag wins; otherwise the ad inherits the ad set's tag.
      const effAngle = meta?.angle ?? owned.angle ?? null;
      const effProblem = meta?.problem ?? owned.problem ?? null;
      if (meta?.templateId) {
        const t = templateMap.get(meta.templateId) || { templateId: meta.templateId, templateName: meta.templateName || `Template ${meta.templateId}`, ads: 0, winners: 0, spend: 0, revenue: 0 };
        t.ads += 1; if (isWinner) t.winners += 1; t.spend += spend; t.revenue += pv;
        templateMap.set(meta.templateId, t);
      }
      if (effAngle) {
        const g = anglePerf.get(effAngle) || { name: effAngle, ads: 0, winners: 0, spend: 0, revenue: 0 };
        g.ads += 1; if (isWinner) g.winners += 1; g.spend += spend; g.revenue += pv;
        anglePerf.set(effAngle, g);
        if (entry) {
          const a = entry.angleAgg.get(effAngle) || { angle: effAngle, ads: 0, winners: 0 };
          a.ads += 1; if (isWinner) a.winners += 1;
          entry.angleAgg.set(effAngle, a);
        }
      }
      if (effProblem) {
        const g = problemPerf.get(effProblem) || { name: effProblem, ads: 0, winners: 0, spend: 0, revenue: 0 };
        g.ads += 1; if (isWinner) g.winners += 1; g.spend += spend; g.revenue += pv;
        problemPerf.set(effProblem, g);
      }
      if (impressions > 0 || spend > 0) {
        ads.push({
          id: ad.id,
          name: ad.name,
          spend: r2(spend),
          impressions,
          purchases,
          purchaseValue: r2(pv),
          roas: r2(spend > 0 ? pv / spend : 0),
          ctr: r2(impressions > 0 ? (linkClicks / impressions) * 100 : 0),
          hookRate: r2(impressions > 0 ? (v3 / impressions) * 100 : 0),
          holdRate: r2(v3 > 0 ? (thru / v3) * 100 : 0),
          cpc: r2(linkClicks > 0 ? spend / linkClicks : 0),
          cpm: r2(impressions > 0 ? (spend / impressions) * 1000 : 0),
          angle: effAngle,
          problem: effProblem,
          templateName: meta?.templateName ?? null,
        });
      }
    }
    ads.sort((a, b) => b.spend - a.spend);

    if (owned.creativeStrategistId) {
      const s = strategistMap.get(owned.creativeStrategistId) || { id: owned.creativeStrategistId, adsets: 0, winners: 0 };
      s.adsets += 1; if (isWinner) s.winners += 1;
      strategistMap.set(owned.creativeStrategistId, s);
    }

    if (!entry) continue;

    const paidForAdset = ledger?.paidAmount || 0;
    const pendingForAdset = pendingAdset.get(owned.adsetId) || 0;
    entry.adsets.push({
      adsetId: owned.adsetId,
      adsetName: owned.adsetName || owned.adsetId,
      campaignId: owned.campaignId,
      strategistName: owned.creativeStrategistId ? userMap.get(owned.creativeStrategistId)?.name?.split(" ")[0] || null : null,
      spend: r2(aggSpend),
      impressions: aggImpr,
      purchases: aggPurch,
      purchaseValue: r2(aggPv),
      roas: r2(aggSpend > 0 ? aggPv / aggSpend : 0),
      ctr: r2(aggImpr > 0 ? (aggLink / aggImpr) * 100 : 0),
      hookRate: r2(aggImpr > 0 ? (aggV3 / aggImpr) * 100 : 0),
      holdRate: r2(aggV3 > 0 ? (aggThru / aggV3) * 100 : 0),
      cpc: r2(aggLink > 0 ? aggSpend / aggLink : 0),
      cpm: r2(aggImpr > 0 ? (aggSpend / aggImpr) * 1000 : 0),
      bonus,
      bonusTier: ledger?.earnedTier || 0,
      tierLog: (ledger?.tierLog as Record<string, string>) || {},
      paidForAdset,
      pendingForAdset,
      outstanding: r2(Math.max(bonus - paidForAdset - pendingForAdset, 0)),
      lifetimeSpend: r2(ledger?.peakSpend || 0),
      lifetimeRoas: r2(ledger?.peakRoas || 0),
      isWinner,
      graveyardOutcome: owned.graveyardOutcome,
      adCount: adsList.length,
      ads,
    });
    const raw = rawTotals.get(owned.videoEditorId!) || { link: 0, v3: 0, thru: 0 };
    raw.link += aggLink; raw.v3 += aggV3; raw.thru += aggThru;
    rawTotals.set(owned.videoEditorId!, raw);
    editorMap.set(owned.videoEditorId!, entry);
  }

  const editorIds = Array.from(editorMap.keys());
  await ensureSlugs(editorIds, allUsers);

  const payoutsByEditor = new Map<string, typeof payouts>();
  for (const p of payouts) {
    const list = payoutsByEditor.get(p.editorId) || [];
    list.push(p);
    payoutsByEditor.set(p.editorId, list);
  }

  const editors = Array.from(editorMap.values()).map((e) => {
    const user = userMap.get(e.editorId);
    const raw = rawTotals.get(e.editorId) || { link: 0, v3: 0, thru: 0 };
    e.adsets.sort((a, b) => b.lifetimeSpend - a.lifetimeSpend);

    const totalSpend = e.adsets.reduce((s, a) => s + a.spend, 0);
    const totalPurchaseValue = e.adsets.reduce((s, a) => s + a.purchaseValue, 0);
    const totalPurchases = e.adsets.reduce((s, a) => s + a.purchases, 0);
    const totalImpressions = e.adsets.reduce((s, a) => s + a.impressions, 0);
    const totalBonus = e.adsets.reduce((s, a) => s + a.bonus, 0);
    const paidAmount = e.adsets.reduce((s, a) => s + a.paidForAdset, 0);
    const unpaidAmount = e.adsets.reduce((s, a) => s + a.outstanding, 0);

    const myPayouts = (payoutsByEditor.get(e.editorId) || []).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const pendingAmount = myPayouts.filter((p) => p.status === "pending").reduce((s, p) => s + p.amount, 0);

    return {
      editorId: e.editorId,
      editor: user?.name?.split(" ")[0] || "Unknown",
      fullName: user?.name || "Unknown",
      slug: user?.slug || null,
      userType: user?.userType || "video_editor",
      totalSpend: r2(totalSpend),
      totalPurchaseValue: r2(totalPurchaseValue),
      totalPurchases,
      totalImpressions,
      roas: r2(totalSpend > 0 ? totalPurchaseValue / totalSpend : 0),
      ctr: r2(totalImpressions > 0 ? (raw.link / totalImpressions) * 100 : 0),
      hookRate: r2(totalImpressions > 0 ? (raw.v3 / totalImpressions) * 100 : 0),
      holdRate: r2(raw.v3 > 0 ? (raw.thru / raw.v3) * 100 : 0),
      cpc: r2(raw.link > 0 ? totalSpend / raw.link : 0),
      cpm: r2(totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0),
      totalBonus: r2(totalBonus),
      paidAmount: r2(paidAmount),
      pendingAmount: r2(pendingAmount),
      unpaidAmount: r2(unpaidAmount),
      adsetCount: e.adsets.length,
      winnerCount: e.adsets.filter((a) => a.isWinner).length,
      graveyardSpendWinners: e.adsets.filter((a) => a.graveyardOutcome === "spend_winner").length,
      graveyardLosers: e.adsets.filter((a) => a.graveyardOutcome === "loser").length,
      angleStats: Array.from(e.angleAgg.values()).sort((x, y) => y.winners - x.winners || y.ads - x.ads),
      adsets: e.adsets,
      payouts: myPayouts,
    };
  });

  editors.sort((a, b) => b.totalBonus - a.totalBonus || b.totalSpend - a.totalSpend);

  const leaderboard = editors
    .map((e) => ({ editorId: e.editorId, name: e.editor, slug: e.slug, winners: e.winnerCount, hookRate: e.hookRate, earned: e.totalBonus }))
    .sort((a, b) => b.winners - a.winners || b.earned - a.earned);

  const strategists = Array.from(strategistMap.values())
    .map((s) => {
      const u = userMap.get(s.id);
      return { id: s.id, name: u?.name || "Unknown", slug: u?.slug || null, adsets: s.adsets, winners: s.winners, winRate: r2(s.adsets > 0 ? (s.winners / s.adsets) * 100 : 0) };
    })
    .sort((a, b) => b.winners - a.winners);

  const templates = Array.from(templateMap.values())
    .map((t) => ({ templateId: t.templateId, templateName: t.templateName, ads: t.ads, winners: t.winners, winRate: r2(t.ads > 0 ? (t.winners / t.ads) * 100 : 0), spend: r2(t.spend), roas: r2(t.spend > 0 ? t.revenue / t.spend : 0) }))
    .sort((a, b) => b.roas - a.roas || b.winners - a.winners);

  const mapPerf = (m: Map<string, { name: string; ads: number; winners: number; spend: number; revenue: number }>) =>
    Array.from(m.values())
      .map((g) => ({ name: g.name, ads: g.ads, winners: g.winners, winRate: r2(g.ads > 0 ? (g.winners / g.ads) * 100 : 0), spend: r2(g.spend), roas: r2(g.spend > 0 ? g.revenue / g.spend : 0) }))
      .sort((a, b) => b.winners - a.winners || b.spend - a.spend);

  return {
    editors, leaderboard, strategists, templates,
    angles: mapPerf(anglePerf),
    problems: mapPerf(problemPerf),
    bonusTiers: settings.bonusTiers, sekPerUsd: rate, dateRange: { from, to },
  };
}

/**
 * Team overview for a date range. Cached (10 min, tag "editor-stats") so the
 * dashboard and every public editor page share one computation.
 */
export const getEditorsOverview = unstable_cache(
  async ({ from, to }: { from: string; to: string }) => computeEditorsOverview(from, to),
  ["editors-overview-v2"],
  { tags: [EDITOR_STATS_TAG], revalidate: 600 },
);

async function computeEditorTimeseries(editorId: string, from: string, to: string) {
  const [owned, settings, usdAccounts] = await Promise.all([resolveOwnedAdsets(), getEvolveSettings(), getUsdAccountIds()]);
  const adsetIds = owned.filter((a) => a.videoEditorId === editorId && a.source !== "demo").map((a) => a.adsetId);
  if (adsetIds.length === 0) return [] as Array<{ date: string; spend: number; revenue: number; roas: number; purchases: number }>;
  const factor = usdFactor(usdAccounts, settings.sekPerUsd);
  const rows = await db
    .select({
      date: schema.insights.dateStart,
      spend: sql<number>`coalesce(sum(${schema.insights.spend} * ${factor}), 0)`,
      revenue: sql<number>`coalesce(sum(${schema.insights.purchaseValue} * ${factor}), 0)`,
      purchases: sql<number>`coalesce(sum(${schema.insights.purchases}), 0)`,
    })
    .from(schema.insights)
    .innerJoin(schema.adsCache, eq(schema.insights.entityId, schema.adsCache.id))
    .where(and(
      eq(schema.insights.entityType, "ad"),
      inArray(schema.adsCache.adsetId, adsetIds),
      gte(schema.insights.dateStart, from),
      lte(schema.insights.dateStart, to),
    ))
    .groupBy(schema.insights.dateStart)
    .orderBy(schema.insights.dateStart);

  return rows.map((r) => {
    const spend = Number(r.spend) || 0;
    const revenue = Number(r.revenue) || 0;
    return { date: String(r.date), spend: r2(spend), revenue: r2(revenue), roas: r2(spend > 0 ? revenue / spend : 0), purchases: Number(r.purchases) || 0 };
  });
}

/** Daily spend / revenue / ROAS for one editor's ad sets — powers the performance graph. Money in USD. */
export const getEditorTimeseries = unstable_cache(
  async (editorId: string, from: string, to: string) => computeEditorTimeseries(editorId, from, to),
  ["editor-timeseries-v2"],
  { tags: [EDITOR_STATS_TAG], revalidate: 600 },
);
