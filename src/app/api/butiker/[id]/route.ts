import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isElevated } from "@/lib/access";
import { db, schema } from "@/db";
import { desc, eq, sql } from "drizzle-orm";
import { CALL_OUTCOMES, STATUS_KEYS, statusMeta } from "@/lib/butiker/status";

export const dynamic = "force-dynamic";

const plusDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/** One shop's full history. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const events = await db
    .select()
    .from(schema.retailLeadEvents)
    .where(eq(schema.retailLeadEvents.leadId, id))
    .orderBy(desc(schema.retailLeadEvents.createdAt));
  return NextResponse.json({ events });
}

/**
 * Everything the page writes about a shop:
 *   action "call"   — log a call with an outcome (moves status, sets the follow-up date)
 *   action "status" — set the status directly (prov skickat, kund …)
 *   action "note"   — add a note to the history
 *   action "edit"   — change contact fields, owner or follow-up date
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const who = session.user.name ?? session.user.email ?? null;
    const { id } = await params;
    const b = await request.json();
    const note = typeof b?.note === "string" && b.note.trim() ? b.note.trim() : null;
    const L = schema.retailLeads;

    const [lead] = await db.select().from(L).where(eq(L.id, id));
    if (!lead) return NextResponse.json({ error: "Butiken finns inte" }, { status: 404 });

    if (b.action === "call") {
      const outcome = CALL_OUTCOMES.find((o) => o.key === b.outcome);
      if (!outcome) return NextResponse.json({ error: "Välj vad samtalet gav" }, { status: 400 });
      const next = typeof b.nextActionOn === "string" && b.nextActionOn ? b.nextActionOn
        : outcome.followUpDays ? plusDays(outcome.followUpDays) : null;
      const [row] = await db.update(L).set({
        status: outcome.status,
        callCount: sql`${L.callCount} + 1`,
        lastContactAt: new Date(),
        nextActionOn: next,
        ownerName: lead.ownerName ?? who,
        lastNote: note ?? lead.lastNote,
        updatedAt: new Date(),
      }).where(eq(L.id, id)).returning();
      await db.insert(schema.retailLeadEvents).values({ leadId: id, kind: "call", outcome: outcome.key, note, byName: who });
      return NextResponse.json({ saved: true, lead: row });
    }

    if (b.action === "status") {
      if (!STATUS_KEYS.has(b.status)) return NextResponse.json({ error: "Okänd status" }, { status: 400 });
      const [row] = await db.update(L).set({
        status: b.status,
        lastNote: note ?? lead.lastNote,
        ownerName: lead.ownerName ?? who,
        nextActionOn: b.status === "kund" || b.status === "nej" || b.status === "fel_nummer" ? null : lead.nextActionOn,
        updatedAt: new Date(),
      }).where(eq(L.id, id)).returning();
      await db.insert(schema.retailLeadEvents).values({
        leadId: id, kind: "status", outcome: b.status,
        note: note ?? `${statusMeta(lead.status).label} → ${statusMeta(b.status).label}`, byName: who,
      });
      return NextResponse.json({ saved: true, lead: row });
    }

    if (b.action === "note") {
      if (!note) return NextResponse.json({ error: "Skriv en anteckning" }, { status: 400 });
      const [row] = await db.update(L).set({ lastNote: note, updatedAt: new Date() }).where(eq(L.id, id)).returning();
      await db.insert(schema.retailLeadEvents).values({ leadId: id, kind: "note", note, byName: who });
      return NextResponse.json({ saved: true, lead: row });
    }

    if (b.action === "edit") {
      const fields = ["name", "type", "address", "postalCode", "city", "county", "phone", "email", "website", "brands", "companyForm", "ownerName", "nextActionOn"] as const;
      const set: Record<string, string | null | Date> = { updatedAt: new Date() };
      const changed: string[] = [];
      for (const f of fields) {
        if (!(f in b)) continue;
        const v = typeof b[f] === "string" && b[f].trim() ? b[f].trim() : null;
        if (f === "name" && !v) continue;
        set[f] = v;
        changed.push(f);
      }
      const [row] = await db.update(L).set(set).where(eq(L.id, id)).returning();
      if (changed.length && !(changed.length === 1 && changed[0] === "nextActionOn")) {
        await db.insert(schema.retailLeadEvents).values({ leadId: id, kind: "note", note: `Ändrade ${changed.join(", ")}`, byName: who });
      }
      return NextResponse.json({ saved: true, lead: row });
    }

    return NextResponse.json({ error: "Okänd åtgärd" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Kunde inte spara" }, { status: 500 });
  }
}
