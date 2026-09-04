import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { guardAdmin } from "@/lib/auth-helpers";
import { applyLinks, unlinkAdset } from "@/lib/learning-loop/link";
import { VERDICTS } from "@/lib/learning-loop/rows";

const body = z.object({
  adsetId: z.string().min(1),
  adsetName: z.string().nullable().optional(),
  campaignId: z.string().nullable().optional(),
  verdict: z.enum(VERDICTS as [string, ...string[]]).nullable().optional(),
  learnings: z.string().max(10000).nullable().optional(),
  /** string = link to that assignment, null = unlink, undefined = untouched */
  assignmentId: z.string().nullable().optional(),
  problem: z.string().nullable().optional(),
  angle: z.string().nullable().optional(),
});

/**
 * PATCH — verdict, learnings, tags and the brief link for ONE ad set.
 * Only the fields present are written; pass null to clear one.
 */
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
    if (b.problem !== undefined) set.problem = b.problem || null;
    if (b.angle !== undefined) set.angle = b.angle || null;

    const [existing] = await db.select({ adsetId: schema.adsetOwners.adsetId }).from(schema.adsetOwners).where(eq(schema.adsetOwners.adsetId, b.adsetId)).limit(1);
    if (existing) {
      if (Object.keys(set).length > 1) await db.update(schema.adsetOwners).set(set).where(eq(schema.adsetOwners.adsetId, b.adsetId));
    } else {
      await db.insert(schema.adsetOwners).values({
        adsetId: b.adsetId,
        adsetName: b.adsetName ?? null,
        campaignId: b.campaignId ?? null,
        source: "analyzer",
        assignedById: session.user.id,
        ...set,
      });
    }

    if (b.assignmentId === null) await unlinkAdset(b.adsetId);
    else if (typeof b.assignmentId === "string") await applyLinks([{ assignmentId: b.assignmentId, adsetId: b.adsetId }], "manual", session.user.id);

    const [row] = await db.select().from(schema.adsetOwners).where(eq(schema.adsetOwners.adsetId, b.adsetId)).limit(1);
    return NextResponse.json({ owner: row });
  } catch (e) {
    console.error("learning-loop adset PATCH failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Kunde inte spara" }, { status: 500 });
  }
}
