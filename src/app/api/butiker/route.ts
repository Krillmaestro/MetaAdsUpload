import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isElevated } from "@/lib/access";
import { db, schema } from "@/db";
import { desc, sql } from "drizzle-orm";
import { dedupeKey } from "@/lib/butiker/status";

export const dynamic = "force-dynamic";

/** Every shop plus the latest 300 logged events (the shared activity feed). */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const E = schema.retailLeadEmails;
    const [leads, events, mailStats] = await Promise.all([
      db.select().from(schema.retailLeads).orderBy(schema.retailLeads.county, schema.retailLeads.city, schema.retailLeads.name),
      db.select().from(schema.retailLeadEvents).orderBy(desc(schema.retailLeadEvents.createdAt)).limit(300),
      db.select({
        leadId: E.leadId,
        sent: sql<number>`count(*) filter (where ${E.direction} = 'ut')::int`,
        replies: sql<number>`count(*) filter (where ${E.direction} = 'in')::int`,
        lastAt: sql<string>`max(${E.sentAt})`,
        lastInAt: sql<string | null>`max(${E.sentAt}) filter (where ${E.direction} = 'in')`,
        lastOutAt: sql<string | null>`max(${E.sentAt}) filter (where ${E.direction} = 'ut')`,
      }).from(E).groupBy(E.leadId),
    ]);
    return NextResponse.json({ leads, events, mailStats, me: session.user.name ?? session.user.email ?? null });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Kunde inte läsa butikerna" }, { status: 500 });
  }
}

/** Add a shop by hand. */
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const who = session.user.name ?? session.user.email ?? null;

    const b = await request.json();
    const name = String(b?.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "Ange butikens namn" }, { status: 400 });
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

    const [row] = await db
      .insert(schema.retailLeads)
      .values({
        dedupeKey: dedupeKey(name, str(b.city)),
        name, type: str(b.type), address: str(b.address), postalCode: str(b.postalCode), city: str(b.city),
        county: str(b.county), phone: str(b.phone), email: str(b.email), website: str(b.website),
        brands: str(b.brands), companyForm: str(b.companyForm), source: str(b.source) ?? `manuellt (${who})`,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) return NextResponse.json({ error: "Butiken finns redan i listan" }, { status: 409 });
    await db.insert(schema.retailLeadEvents).values({ leadId: row.id, kind: "note", note: "Lade till butiken", byName: who });
    return NextResponse.json({ saved: true, lead: row });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Kunde inte spara" }, { status: 500 });
  }
}
