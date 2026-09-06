import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { applyBonusPayment } from "@/lib/bonus-ledger";
import { isElevated } from "@/lib/access";

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
      ? await db.select().from(schema.users).where(inArray(schema.users.id, editorIds))
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

// POST - Create a new payout record
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await request.json();
    const { editorId, amount, currency, periodFrom, periodTo, adIds, assignmentIds, breakdown, notes } = body;

    if (!editorId || !amount || !periodFrom || !periodTo) {
      return NextResponse.json({ error: "editorId, amount, periodFrom, and periodTo are required" }, { status: 400 });
    }

    const [payout] = await db
      .insert(schema.editorPayouts)
      .values({
        editorId,
        amount,
        currency: currency || "USD",
        periodFrom,
        periodTo,
        adIds: adIds || [],
        assignmentIds: assignmentIds || [],
        breakdown: breakdown || [],
        notes: notes || null,
        status: "pending",
      })
      .returning();

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

    // Fetch the current row so we only move the ledger on an actual status change.
    const [current] = await db.select().from(schema.editorPayouts).where(eq(schema.editorPayouts.id, id));
    if (!current) return NextResponse.json({ error: "Payout not found" }, { status: 404 });

    const updateData: Record<string, unknown> = {};
    if (status === "paid") {
      updateData.status = "paid";
      updateData.paidAt = new Date();
      updateData.paidById = session.user.id;
    } else if (status === "pending") {
      updateData.status = "pending";
      updateData.paidAt = null;
      updateData.paidById = null;
    }
    if (notes !== undefined) updateData.notes = notes;

    const [updated] = await db
      .update(schema.editorPayouts)
      .set(updateData)
      .where(eq(schema.editorPayouts.id, id))
      .returning();

    // Keep the lifetime ledger's paidAmount in sync with payout status changes.
    const breakdown = (current.breakdown || []).map((b) => ({ adId: b.adId, bonus: b.bonus }));
    if (status === "paid" && current.status !== "paid") {
      await applyBonusPayment(breakdown);
    } else if (status === "pending" && current.status === "paid") {
      // Reverse the payment.
      await applyBonusPayment(breakdown.map((b) => ({ adId: b.adId, bonus: -b.bonus })));
    }

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

    await db.delete(schema.editorPayouts).where(eq(schema.editorPayouts.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Payouts DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete payout" }, { status: 500 });
  }
}
