import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { eq, and, desc, inArray, ne } from "drizzle-orm";
import { applyBonusPayment } from "@/lib/bonus-ledger";
import { isElevated } from "@/lib/access";
import { invalidateEditorStats } from "@/lib/editor-stats";

// GET - List payouts (optionally filtered by editorId)
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = request.nextUrl;
    const editorId = searchParams.get("editorId");

    let payouts;
    if (editorId) {
      payouts = await db
        .select()
        .from(schema.editorPayouts)
        .where(eq(schema.editorPayouts.editorId, editorId))
        .orderBy(desc(schema.editorPayouts.createdAt));
    } else {
      payouts = await db
        .select()
        .from(schema.editorPayouts)
        .orderBy(desc(schema.editorPayouts.createdAt));
    }

    // Enrich with editor names
    const editorIds = [...new Set(payouts.map((p) => p.editorId))];
    const editors = editorIds.length > 0
      ? await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, editorIds))
      : [];
    const editorMap = new Map(editors.map((e) => [e.id, e]));

    const enriched = payouts.map((p) => ({
      ...p,
      editorName: editorMap.get(p.editorId)?.name || "Unknown",
    }));

    return NextResponse.json({ payouts: enriched });
  } catch (error) {
    console.error("Payouts GET error:", error);
    return NextResponse.json({ error: "Failed to fetch payouts" }, { status: 500 });
  }
}

// POST - Create a new payout record.
// The amount and breakdown are computed HERE from the ledger: per ad set,
// earned − paid − already in a pending payout. A client-sent breakdown could
// include ad sets that are already pending and pay them twice.
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await request.json();
    const { editorId, currency, periodFrom, periodTo, notes } = body;

    if (!editorId || !periodFrom || !periodTo) {
      return NextResponse.json({ error: "editorId, periodFrom, and periodTo are required" }, { status: 400 });
    }

    const [ledger, pending, owners] = await Promise.all([
      db.select().from(schema.adBonuses).where(eq(schema.adBonuses.editorId, editorId)),
      db.select().from(schema.editorPayouts).where(and(eq(schema.editorPayouts.editorId, editorId), eq(schema.editorPayouts.status, "pending"))),
      db.select({ adsetId: schema.adsetOwners.adsetId, adsetName: schema.adsetOwners.adsetName, source: schema.adsetOwners.source }).from(schema.adsetOwners).where(eq(schema.adsetOwners.videoEditorId, editorId)),
    ]);
    const ownerById = new Map(owners.map((o) => [o.adsetId, o]));
    const pendingByAdset = new Map<string, number>();
    for (const p of pending) for (const b of p.breakdown || []) pendingByAdset.set(b.adId, (pendingByAdset.get(b.adId) || 0) + (Number(b.bonus) || 0));

    const breakdown = ledger
      .filter((l) => ownerById.get(l.adId)?.source !== "demo")
      .map((l) => ({
        adId: l.adId,
        adName: ownerById.get(l.adId)?.adsetName || l.adId,
        spend: l.peakSpend,
        roas: l.peakRoas,
        bonus: Math.round((l.earnedBonus - l.paidAmount - (pendingByAdset.get(l.adId) || 0)) * 100) / 100,
      }))
      .filter((b) => b.bonus > 0);
    const amount = Math.round(breakdown.reduce((s, b) => s + b.bonus, 0) * 100) / 100;
    if (amount <= 0) return NextResponse.json({ error: "Nothing outstanding for this editor" }, { status: 400 });

    const [payout] = await db
      .insert(schema.editorPayouts)
      .values({
        editorId,
        amount,
        currency: currency || "USD",
        periodFrom,
        periodTo,
        adIds: breakdown.map((b) => b.adId),
        assignmentIds: [],
        breakdown,
        notes: notes || null,
        status: "pending",
      })
      .returning();

    invalidateEditorStats();
    return NextResponse.json(payout);
  } catch (error) {
    console.error("Payouts POST error:", error);
    return NextResponse.json({ error: "Failed to create payout" }, { status: 500 });
  }
}

// PATCH - Update payout (mark as paid)
export async function PATCH(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await request.json();
    const { id, status, notes } = body;

    if (!id) return NextResponse.json({ error: "Payout ID is required" }, { status: 400 });

    // Status changes are conditional updates: two clicks racing can only move
    // the ledger once, because only one UPDATE matches the old status.
    const now = new Date();
    let updated: typeof schema.editorPayouts.$inferSelect | undefined;
    let ledgerDelta = 0; // +1 apply payment, -1 reverse it
    if (status === "paid") {
      [updated] = await db
        .update(schema.editorPayouts)
        .set({ status: "paid", paidAt: now, paidById: session.user.id, ...(notes !== undefined ? { notes } : {}) })
        .where(and(eq(schema.editorPayouts.id, id), ne(schema.editorPayouts.status, "paid")))
        .returning();
      if (updated) ledgerDelta = 1;
    } else if (status === "pending") {
      [updated] = await db
        .update(schema.editorPayouts)
        .set({ status: "pending", paidAt: null, paidById: null, ...(notes !== undefined ? { notes } : {}) })
        .where(and(eq(schema.editorPayouts.id, id), eq(schema.editorPayouts.status, "paid")))
        .returning();
      if (updated) ledgerDelta = -1;
    }
    if (!updated) {
      // No status change (already in that state, or notes-only edit).
      const set = notes !== undefined ? { notes } : {};
      [updated] = Object.keys(set).length
        ? await db.update(schema.editorPayouts).set(set).where(eq(schema.editorPayouts.id, id)).returning()
        : await db.select().from(schema.editorPayouts).where(eq(schema.editorPayouts.id, id));
      if (!updated) return NextResponse.json({ error: "Payout not found" }, { status: 404 });
    }

    // Keep the lifetime ledger's paidAmount in sync with payout status changes.
    if (ledgerDelta !== 0) {
      await applyBonusPayment((updated.breakdown || []).map((b) => ({ adId: b.adId, bonus: ledgerDelta * b.bonus })));
    }

    invalidateEditorStats();
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Payouts PATCH error:", error);
    return NextResponse.json({ error: "Failed to update payout" }, { status: 500 });
  }
}

// DELETE - Remove payout record
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await request.json();
    const { id } = body;

    if (!id) return NextResponse.json({ error: "Payout ID is required" }, { status: 400 });

    const [deleted] = await db.delete(schema.editorPayouts).where(eq(schema.editorPayouts.id, id)).returning();
    // Deleting a PAID payout takes the payment back off the ledger, otherwise
    // those ad sets would stay "paid" with no payout record behind them.
    if (deleted?.status === "paid") {
      await applyBonusPayment((deleted.breakdown || []).map((b) => ({ adId: b.adId, bonus: -b.bonus })));
    }

    invalidateEditorStats();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Payouts DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete payout" }, { status: 500 });
  }
}
