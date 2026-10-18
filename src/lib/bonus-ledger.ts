// ─── Bonus ledger (server-only) ─────────────────────────────────────────────
// Resolves who owns each Meta ad and locks in lifetime-earned bonuses.
// Imports the DB, so this must only be used from server code (API routes /
// server components) — never from a client component.

import { db, schema } from "@/db";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { BONUS_TIERS, type BonusTier } from "./bonus";
import { getEvolveSettings } from "./evolve/settings";
import { getUsdAccountIds, usdFactor } from "./money";

// ─── Ad-set level (the bonus unit) ──────────────────────────────────────────

export interface OwnedAdset {
  adsetId: string;
  videoEditorId: string | null;
  creativeStrategistId: string | null;
  adsetName: string | null;
  campaignId: string | null;
  angle: string | null;
  problem: string | null;
  verdict: string | null;
  graveyardOutcome: string | null;
  source: string;
  /** Lifetime history is in the DB (adset_owners.backfilled_at set). */
  backfilled: boolean;
}

/** Resolve ad set → owner. adset_owners overrides the assignment linkage. */
export async function resolveOwnedAdsets(): Promise<OwnedAdset[]> {
  const [owners, assignmentRows] = await Promise.all([
    db.select().from(schema.adsetOwners),
    db
      .select({
        metaAdsetId: schema.assignments.metaAdsetId,
        assignedToId: schema.assignments.assignedToId,
        creativeStrategistId: schema.assignments.creativeStrategistId,
        autoName: schema.assignments.autoName,
        metaCampaignId: schema.assignments.metaCampaignId,
      })
      .from(schema.assignments)
      .where(isNotNull(schema.assignments.metaAdsetId))
      .orderBy(schema.assignments.updatedAt),
  ]);
  const map = new Map<string, OwnedAdset>();
  for (const a of assignmentRows) {
    if (!a.metaAdsetId) continue;
    map.set(a.metaAdsetId, {
      adsetId: a.metaAdsetId,
      videoEditorId: a.assignedToId,
      creativeStrategistId: a.creativeStrategistId || null,
      adsetName: a.autoName || null,
      campaignId: a.metaCampaignId || null,
      angle: null,
      problem: null,
      verdict: null,
      graveyardOutcome: null,
      source: "assignment",
      backfilled: false,
    });
  }
  for (const o of owners) {
    const ex = map.get(o.adsetId);
    map.set(o.adsetId, {
      adsetId: o.adsetId,
      videoEditorId: o.videoEditorId ?? ex?.videoEditorId ?? null,
      creativeStrategistId: o.creativeStrategistId ?? ex?.creativeStrategistId ?? null,
      adsetName: o.adsetName || ex?.adsetName || null,
      campaignId: o.campaignId || ex?.campaignId || null,
      angle: o.angle ?? ex?.angle ?? null,
      problem: o.problem ?? ex?.problem ?? null,
      verdict: o.verdict ?? ex?.verdict ?? null,
      graveyardOutcome: o.graveyardOutcome ?? ex?.graveyardOutcome ?? null,
      source: o.videoEditorId || o.creativeStrategistId ? (o.source || "analyzer") : (ex?.source || o.source || "analyzer"),
      backfilled: !!o.backfilledAt,
    });
  }
  return Array.from(map.values());
}

type LedgerRow = typeof schema.adBonuses.$inferSelect;

/**
 * Lock in lifetime bonuses per AD SET. The ad set's performance is the aggregate
 * of all its ads (sum spend + revenue → blended ROAS), in USD — each insight
 * row converted by its own account's currency. Walks the daily aggregate
 * chronologically and records every tier reached (tier ladder). Stored in
 * ad_bonuses keyed by the ad set id.
 *
 * Runs after each sync (and after an owner change), never on a page view.
 * Writes are one bulk upsert of the rows that actually changed.
 *
 * An ad set whose lifetime history has not been backfilled yet only gets its
 * spend refreshed: a tier is never locked on a partial history (a 30-day
 * slice can show a ROAS the whole run never had, and locks never go down).
 */
export async function recomputeAdsetBonuses(
  ownedAdsets: OwnedAdset[],
  sekPerUsd = 10.5,
  tiers: BonusTier[] = BONUS_TIERS,
  usdAccountIds?: string[],
): Promise<{ evaluated: number; written: number }> {
  const eligible = ownedAdsets.filter((a) => a.videoEditorId && a.source !== "demo");
  const adsetIds = eligible.map((a) => a.adsetId);
  if (adsetIds.length === 0) return { evaluated: 0, written: 0 };
  const byId = new Map(eligible.map((a) => [a.adsetId, a]));
  const factor = usdFactor(usdAccountIds ?? (await getUsdAccountIds()), sekPerUsd);

  // Daily aggregate per ad set in USD = sum of its ads' daily insights (join via ads_cache).
  const [daily, existing] = await Promise.all([
    db
      .select({
        adsetId: schema.adsCache.adsetId,
        date: schema.insights.dateStart,
        spend: sql<number>`coalesce(sum(${schema.insights.spend} * ${factor}),0)`,
        purchaseValue: sql<number>`coalesce(sum(${schema.insights.purchaseValue} * ${factor}),0)`,
      })
      .from(schema.insights)
      .innerJoin(schema.adsCache, eq(schema.insights.entityId, schema.adsCache.id))
      .where(and(eq(schema.insights.entityType, "ad"), inArray(schema.adsCache.adsetId, adsetIds)))
      .groupBy(schema.adsCache.adsetId, schema.insights.dateStart)
      .orderBy(schema.adsCache.adsetId, schema.insights.dateStart),
    db.select().from(schema.adBonuses).where(inArray(schema.adBonuses.adId, adsetIds)),
  ]);

  const byAdset = new Map<string, Array<{ date: string; spend: number; pv: number }>>();
  for (const r of daily) {
    const list = byAdset.get(r.adsetId) || [];
    list.push({ date: String(r.date), spend: Number(r.spend) || 0, pv: Number(r.purchaseValue) || 0 });
    byAdset.set(r.adsetId, list);
  }
  const existingByAdset = new Map(existing.map((r) => [r.adId, r]));
  const now = new Date();
  const round = (n: number) => Math.round(n * 100) / 100;

  const writes: Array<typeof schema.adBonuses.$inferInsert> = [];
  for (const adsetId of adsetIds) {
    const owned = byId.get(adsetId)!;
    const editorId = owned.videoEditorId as string;
    const prev = existingByAdset.get(adsetId);
    const tierLog: Record<string, string> = { ...((prev?.tierLog as Record<string, string>) || {}) };
    let cumSpend = 0, cumRev = 0, maxBonus = 0;
    for (const day of byAdset.get(adsetId) || []) {
      cumSpend += day.spend;
      cumRev += day.pv;
      if (!owned.backfilled) continue;
      const roas = cumSpend > 0 ? cumRev / cumSpend : 0;
      for (const t of tiers) {
        if (cumSpend >= t.minSpend && roas >= t.minRoas) {
          if (!tierLog[String(t.bonus)]) tierLog[String(t.bonus)] = day.date;
          if (t.bonus > maxBonus) maxBonus = t.bonus;
        }
      }
    }
    const spend = round(cumSpend);
    const roas = cumSpend > 0 ? round(cumRev / cumSpend) : 0;
    const earnedBonus = Math.max(prev?.earnedBonus || 0, maxBonus);
    const earnedTier = Math.max(prev?.earnedTier || 0, maxBonus);

    if (!prev && earnedBonus <= 0 && spend <= 0) continue;
    const unchanged =
      prev &&
      prev.editorId === editorId &&
      prev.earnedBonus === earnedBonus &&
      prev.earnedTier === earnedTier &&
      round(prev.peakSpend) === spend &&
      round(prev.peakRoas) === roas &&
      JSON.stringify(prev.tierLog || {}) === JSON.stringify(tierLog);
    if (unchanged) continue;

    writes.push({
      adId: adsetId,
      editorId,
      earnedBonus,
      earnedTier,
      tierLog,
      paidAmount: prev?.paidAmount ?? 0,
      // Current lifetime spend/ROAS (not a running max — a correction or
      // removed duplicate must be able to bring it down).
      peakSpend: spend,
      peakRoas: roas,
      firstQualifiedAt: prev?.firstQualifiedAt || (earnedBonus > 0 ? now : null),
      lastEvaluatedAt: now,
      updatedAt: now,
    });
  }

  for (let i = 0; i < writes.length; i += 500) {
    await db
      .insert(schema.adBonuses)
      .values(writes.slice(i, i + 500))
      .onConflictDoUpdate({
        target: schema.adBonuses.adId,
        set: {
          editorId: sql.raw("excluded.editor_id"),
          // Locks only go up, even if two refreshes race.
          earnedBonus: sql`greatest(${schema.adBonuses.earnedBonus}, excluded.earned_bonus)`,
          earnedTier: sql`greatest(${schema.adBonuses.earnedTier}, excluded.earned_tier)`,
          tierLog: sql.raw("excluded.tier_log"),
          peakSpend: sql.raw("excluded.peak_spend"),
          peakRoas: sql.raw("excluded.peak_roas"),
          firstQualifiedAt: sql`coalesce(${schema.adBonuses.firstQualifiedAt}, excluded.first_qualified_at)`,
          lastEvaluatedAt: sql.raw("excluded.last_evaluated_at"),
          updatedAt: sql.raw("excluded.updated_at"),
          // paid_amount is deliberately NOT touched here — only payouts move it.
        },
      });
  }
  return { evaluated: adsetIds.length, written: writes.length };
}

/**
 * Re-evaluate the ledger with the current settings. `adsetIds` limits it to
 * specific ad sets (after an owner change); omitted = every owned ad set.
 */
export async function refreshBonusLedger(adsetIds?: string[]) {
  const settings = await getEvolveSettings();
  const rate = settings.sekPerUsd > 0 ? settings.sekPerUsd : 10.5;
  let owned = await resolveOwnedAdsets();
  if (adsetIds) {
    const want = new Set(adsetIds);
    owned = owned.filter((o) => want.has(o.adsetId));
  }
  return recomputeAdsetBonuses(owned, rate, settings.bonusTiers);
}

/** Ledger rows for the given ad sets (read-only — what the pages use). */
export async function readLedger(adsetIds: string[]): Promise<LedgerRow[]> {
  if (adsetIds.length === 0) return [];
  return db.select().from(schema.adBonuses).where(inArray(schema.adBonuses.adId, adsetIds));
}

/**
 * Record a payment against a set of ad bonuses (called when a payout is marked
 * paid; negative amounts reverse it). One statement for the whole breakdown.
 */
export async function applyBonusPayment(breakdown: Array<{ adId: string; bonus: number }>) {
  const items = breakdown.filter((b) => b.adId && Number.isFinite(b.bonus) && b.bonus !== 0);
  if (items.length === 0) return;
  const values = sql.join(items.map((b) => sql`(${b.adId}::text, ${b.bonus}::float8)`), sql`, `);
  await db.execute(sql`
    UPDATE ad_bonuses AS b
    SET paid_amount = greatest(b.paid_amount + v.amount, 0), updated_at = now()
    FROM (VALUES ${values}) AS v(ad_id, amount)
    WHERE b.ad_id = v.ad_id`);
}
