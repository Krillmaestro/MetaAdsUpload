import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db";
import { inArray } from "drizzle-orm";
import { guardAdmin } from "@/lib/auth-helpers";
import { applyAdLinks, unlinkAds } from "@/lib/learning-loop/link";
import { VERDICTS } from "@/lib/learning-loop/rows";

const body = z.object({
  /** Every ad that IS this creative (copies in other ad sets included) — all get the same values. */
  adIds: z.array(z.string().min(1)).min(1).max(100),
  verdict: z.enum(VERDICTS as [string, ...string[]]).nullable().optional(),
  learnings: z.string().max(10000).nullable().optional(),
  script: z.string().max(20000).nullable().optional(),
  hookLabel: z.string().max(10).nullable().optional(),
  /** string = link to that brief, null = unlink, undefined = untouched */
  assignmentId: z.string().nullable().optional(),
});

/** PATCH — verdict, learnings, script and the brief link for ONE creative (= its ads). */
export async function PATCH(request: NextRequest) {
  const { session, error } = await guardAdmin();
  if (error) return error;
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Ogiltig begäran" }, { status: 400 });
  const b = parsed.data;
  const now = new Date();

  try {
    const set: Record<string, unknown> = { updatedAt: now };
    if (b.verdict !== undefined) { set.verdict = b.verdict; set.verdictAt = b.verdict ? now : null; }
    if (b.learnings !== undefined) { set.learnings = b.learnings?.trim() || null; set.learningsAt = b.learnings?.trim() ? now : null; }
    if (b.script !== undefined) set.script = b.script?.trim() || null;
    if (b.hookLabel !== undefined) set.hookLabel = b.hookLabel?.trim().toUpperCase() || null;

    if (Object.keys(set).length > 1) {
      const [existing, cached] = await Promise.all([
        db.select({ adId: schema.adOwners.adId }).from(schema.adOwners).where(inArray(schema.adOwners.adId, b.adIds)),
        db.select({ id: schema.adsCache.id, name: schema.adsCache.name, adsetId: schema.adsCache.adsetId, campaignId: schema.adsCache.campaignId }).from(schema.adsCache).where(inArray(schema.adsCache.id, b.adIds)),
      ]);
      const have = new Set(existing.map((e) => e.adId));
      const cache = new Map(cached.map((c) => [c.id, c]));
      const toUpdate = b.adIds.filter((id) => have.has(id));
      if (toUpdate.length) await db.update(schema.adOwners).set(set).where(inArray(schema.adOwners.adId, toUpdate));
      for (const id of b.adIds.filter((x) => !have.has(x))) {
        const c = cache.get(id);
        await db.insert(schema.adOwners).values({
          adId: id,
          adName: c?.name ?? null,
          adsetId: c?.adsetId ?? null,
          campaignId: c?.campaignId ?? null,
          source: "analyzer",
          assignedById: session.user.id,
          ...set,
        });
      }
    }

    if (b.assignmentId === null) await unlinkAds(b.adIds);
    else if (typeof b.assignmentId === "string") await applyAdLinks(b.adIds.map((adId) => ({ assignmentId: b.assignmentId as string, adId })), "manual", session.user.id);

    const rows = await db.select().from(schema.adOwners).where(inArray(schema.adOwners.adId, b.adIds));
    return NextResponse.json({ owners: rows });
  } catch (e) {
    console.error("learning-loop ad PATCH failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Kunde inte spara" }, { status: 500 });
  }
}
