import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isElevated } from "@/lib/access";
import { db, schema } from "@/db";
import { desc, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** All mail templates, with how many shops each one has gone to. */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const E = schema.retailLeadEmails;
    const [templates, usage] = await Promise.all([
      db.select().from(schema.retailEmailTemplates).orderBy(desc(schema.retailEmailTemplates.updatedAt)),
      db.select({
        templateId: E.templateId,
        templateVersion: E.templateVersion,
        sent: sql<number>`count(*)::int`,
        shops: sql<number>`count(distinct ${E.leadId})::int`,
        lastSentAt: sql<string>`max(${E.sentAt})`,
      }).from(E).where(sql`${E.direction} = 'ut' and ${E.templateId} is not null`).groupBy(E.templateId, E.templateVersion),
    ]);
    return NextResponse.json({ templates, usage });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Kunde inte läsa mallarna" }, { status: 500 });
  }
}

/** Create a template. */
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const who = session.user.name ?? session.user.email ?? null;

    const b = await request.json();
    const name = String(b?.name ?? "").trim();
    const subject = String(b?.subject ?? "").trim();
    const body = String(b?.body ?? "").replace(/\r\n/g, "\n").trim();
    if (!name || !subject || !body) return NextResponse.json({ error: "Mallen behöver namn, ämne och text" }, { status: 400 });
    const state = ["utkast", "aktiv", "arkiverad"].includes(b?.state) ? b.state : "utkast";

    const [row] = await db.insert(schema.retailEmailTemplates).values({
      name, subject, body, state, notes: typeof b?.notes === "string" && b.notes.trim() ? b.notes.trim() : null, updatedBy: who,
    }).returning();
    return NextResponse.json({ saved: true, template: row });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Kunde inte spara" }, { status: 500 });
  }
}
