import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isElevated } from "@/lib/access";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Edit a template. A change to the subject or text raises the version, so every
 * logged mail still points at the wording it was sent with.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const who = session.user.name ?? session.user.email ?? null;
    const { id } = await params;
    const T = schema.retailEmailTemplates;

    const [tpl] = await db.select().from(T).where(eq(T.id, id));
    if (!tpl) return NextResponse.json({ error: "Mallen finns inte" }, { status: 404 });

    const b = await request.json();
    const name = typeof b?.name === "string" && b.name.trim() ? b.name.trim() : tpl.name;
    const subject = typeof b?.subject === "string" && b.subject.trim() ? b.subject.trim() : tpl.subject;
    const body = typeof b?.body === "string" && b.body.trim() ? b.body.replace(/\r\n/g, "\n").trim() : tpl.body;
    const state = ["utkast", "aktiv", "arkiverad"].includes(b?.state) ? b.state : tpl.state;
    const notes = typeof b?.notes === "string" ? (b.notes.trim() || null) : tpl.notes;
    const textChanged = subject !== tpl.subject || body !== tpl.body;

    const [row] = await db.update(T).set({
      name, subject, body, state, notes, updatedBy: who, updatedAt: new Date(),
      version: textChanged ? tpl.version + 1 : tpl.version,
    }).where(eq(T.id, id)).returning();
    return NextResponse.json({ saved: true, template: row });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Kunde inte spara" }, { status: 500 });
  }
}
