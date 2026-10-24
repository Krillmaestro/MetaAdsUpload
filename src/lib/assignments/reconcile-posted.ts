// "When we post, it always moves to Published."
//
// Ads are launched in two ways: the Upload-to-Meta dialog (which moves the
// assignment to `posted` itself) and launch scripts outside the app, which
// create the ad set on Meta and leave the card where it was. This reconciles
// the second case: an assignment whose ad set exists on Meta IS posted.
//
// Match rule: the ad set's name on Meta equals the assignment's auto name
// (exact, case-insensitive, whitespace-normalised) — the generated ad set
// name the handoff contract and the launch scripts use. The title is only
// consulted when there is no auto name: titles are short labels ("BATCH 2")
// that collide with old ad sets. And the ad set must have been created after
// the brief — an ad set older than the brief cannot be its launch. Nothing
// fuzzy: a wrong match moves the wrong card and credits the wrong editor.
import { db, schema } from "@/db";
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { applyLinks } from "@/lib/learning-loop/link";

export interface ReconcileResult {
  posted: Array<{ assignmentId: string; name: string; adsetId: string; campaignId: string | null }>;
  linked: Array<{ assignmentId: string; name: string; adsetId: string }>;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Moves every non-posted assignment with a live ad set of the same name to
 * `posted` (status, Meta ids, completedAt) and links it for the Learning
 * Loop. Posted assignments that lack their Meta ids get them filled in the
 * same way. DB-only — reads adsets_cache, which the sync keeps current.
 */
export async function reconcilePostedAssignments(actorId: string | null = null): Promise<ReconcileResult> {
  const result: ReconcileResult = { posted: [], linked: [] };
  const candidates = await db
    .select({ id: schema.assignments.id, status: schema.assignments.status, autoName: schema.assignments.autoName, title: schema.assignments.title, metaAdsetId: schema.assignments.metaAdsetId, createdAt: schema.assignments.createdAt })
    .from(schema.assignments)
    .where(or(ne(schema.assignments.status, "posted"), isNull(schema.assignments.metaAdsetId)));
  if (!candidates.length) return result;

  const nameOf = (a: { autoName: string | null; title: string }) => norm(a.autoName) || norm(a.title);
  const names = [...new Set(candidates.map(nameOf).filter(Boolean))];
  const adsets = await db
    .select({ id: schema.adsetsCache.id, name: schema.adsetsCache.name, campaignId: schema.adsetsCache.campaignId, status: schema.adsetsCache.status, createdTime: schema.adsetsCache.createdTime })
    .from(schema.adsetsCache)
    .where(and(
      inArray(sql`lower(regexp_replace(trim(${schema.adsetsCache.name}), '\\s+', ' ', 'g'))`, names),
      or(isNull(schema.adsetsCache.status), ne(schema.adsetsCache.status, "DELETED")),
    ));
  if (!adsets.length) return result;

  // name → ad sets (several when the same name was launched more than once; the oldest is the original)
  const byName = new Map<string, typeof adsets>();
  for (const s of adsets) {
    const k = norm(s.name);
    byName.set(k, [...(byName.get(k) ?? []), s].sort((a, b) => (a.createdTime?.getTime() ?? 0) - (b.createdTime?.getTime() ?? 0)));
  }

  const links: Array<{ assignmentId: string; adsetId: string }> = [];
  for (const a of candidates) {
    // Only ad sets created after the brief (a day of slack for time zones and
    // briefs written right after a manual launch).
    const notBefore = a.createdAt.getTime() - 24 * 60 * 60 * 1000;
    const hits = (byName.get(nameOf(a)) ?? []).filter((h) => h.createdTime && h.createdTime.getTime() >= notBefore);
    if (!hits.length) continue;
    const primary = hits[0];
    const label = a.autoName || a.title;
    if (a.status !== "posted") {
      await db.update(schema.assignments).set({
        status: "posted", metaAdsetId: a.metaAdsetId ?? primary.id, metaCampaignId: primary.campaignId ?? null,
        completedAt: primary.createdTime ?? new Date(), updatedAt: new Date(),
      }).where(and(eq(schema.assignments.id, a.id), ne(schema.assignments.status, "posted")));
      result.posted.push({ assignmentId: a.id, name: label, adsetId: primary.id, campaignId: primary.campaignId ?? null });
    } else if (!a.metaAdsetId) {
      await db.update(schema.assignments).set({ metaAdsetId: primary.id, metaCampaignId: primary.campaignId ?? null, updatedAt: new Date() }).where(eq(schema.assignments.id, a.id));
      result.linked.push({ assignmentId: a.id, name: label, adsetId: primary.id });
    }
    for (const h of hits) links.push({ assignmentId: a.id, adsetId: h.id });
  }
  if (links.length) {
    try { await applyLinks(links, "auto", actorId); } catch (e) { console.error("reconcile: Learning Loop link failed:", e); }
  }
  return result;
}
