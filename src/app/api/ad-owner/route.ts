import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { eq, inArray } from "drizzle-orm";
import { isElevated } from "@/lib/access";

// GET /api/ad-owner?adId=...        → owner for one ad
// GET /api/ad-owner?adIds=a,b,c     → owners for several ads (for the analyzer)
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = request.nextUrl;
    const adId = searchParams.get("adId");
    const adIdsParam = searchParams.get("adIds");

    if (adId) {
      const [owner] = await db.select().from(schema.adOwners).where(eq(schema.adOwners.adId, adId));
      return NextResponse.json({ owner: owner || null });
    }

    if (adIdsParam) {
      const ids = adIdsParam.split(",").map((s) => s.trim()).filter(Boolean);
      if (ids.length === 0) return NextResponse.json({ owners: [] });
      const owners = await db.select().from(schema.adOwners).where(inArray(schema.adOwners.adId, ids));
      return NextResponse.json({ owners });
    }

    const owners = await db.select().from(schema.adOwners);
    return NextResponse.json({ owners });
  } catch (error) {
    console.error("ad-owner GET error:", error);
    return NextResponse.json({ error: "Failed to fetch ad owners" }, { status: 500 });
  }
}

// POST /api/ad-owner — set / update the owner of an ad (upsert). Admin only.
// Body: { adId, videoEditorId, creativeStrategistId?, adName?, campaignId?, adsetId?, source? }
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await request.json();
    const { adId, videoEditorId, creativeStrategistId, adName, campaignId, adsetId, source, angle, problem, templateId, templateName } = body;

    if (!adId) return NextResponse.json({ error: "adId is required" }, { status: 400 });
    if (!videoEditorId && !creativeStrategistId) {
      return NextResponse.json({ error: "videoEditorId or creativeStrategistId is required" }, { status: 400 });
    }

    const now = new Date();

    // On update, only touch creative metadata when it's actually provided, so a
    // later owner change in the analyzer doesn't wipe angle/problem/template set
    // at upload time.
    const updateSet: Record<string, unknown> = {
      videoEditorId: videoEditorId || null,
      creativeStrategistId: creativeStrategistId || null,
      adName: adName || null,
      campaignId: campaignId || null,
      adsetId: adsetId || null,
      source: source || "analyzer",
      assignedById: session.user.id,
      updatedAt: now,
    };
    if (angle !== undefined) updateSet.angle = angle || null;
    if (problem !== undefined) updateSet.problem = problem || null;
    if (templateId !== undefined) updateSet.templateId = templateId || null;
    if (templateName !== undefined) updateSet.templateName = templateName || null;

    const [row] = await db
      .insert(schema.adOwners)
      .values({
        adId,
        videoEditorId: videoEditorId || null,
        creativeStrategistId: creativeStrategistId || null,
        adName: adName || null,
        campaignId: campaignId || null,
        adsetId: adsetId || null,
        angle: angle || null,
        problem: problem || null,
        templateId: templateId || null,
        templateName: templateName || null,
        source: source || "analyzer",
        assignedById: session.user.id,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.adOwners.adId,
        set: updateSet,
      })
      .returning();

    // Keep the bonus ledger pointed at the (possibly new) owner.
    if (videoEditorId) {
      await db
        .update(schema.adBonuses)
        .set({ editorId: videoEditorId, updatedAt: now })
        .where(eq(schema.adBonuses.adId, adId));
    }

    return NextResponse.json({ owner: row });
  } catch (error) {
    console.error("ad-owner POST error:", error);
    return NextResponse.json({ error: "Failed to set ad owner" }, { status: 500 });
  }
}

// DELETE /api/ad-owner — clear ownership. Body: { adId }
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { adId } = await request.json();
    if (!adId) return NextResponse.json({ error: "adId is required" }, { status: 400 });

    await db.delete(schema.adOwners).where(eq(schema.adOwners.adId, adId));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("ad-owner DELETE error:", error);
    return NextResponse.json({ error: "Failed to clear ad owner" }, { status: 500 });
  }
}
