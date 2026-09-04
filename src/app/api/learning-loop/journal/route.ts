import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { guardAdmin } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

// The Growth Guide's "Meta Ads Log": dated notes + weekly recaps per account.

function formatAct(id: string | null | undefined): string | null {
  if (!id || id === "all") return null;
  return id.startsWith("act_") ? id : `act_${id}`;
}

/** GET ?account=&limit= — newest first. Notes without an account show for every account. */
export async function GET(request: NextRequest) {
  const { error } = await guardAdmin();
  if (error) return error;
  const sp = request.nextUrl.searchParams;
  const account = formatAct(sp.get("account"));
  const limit = Math.min(Math.max(parseInt(sp.get("limit") ?? "60", 10) || 60, 1), 300);
  const rows = await db
    .select()
    .from(schema.loopJournal)
    .where(account ? or(eq(schema.loopJournal.adAccountId, account), isNull(schema.loopJournal.adAccountId)) : undefined)
    .orderBy(desc(schema.loopJournal.entryDate), desc(schema.loopJournal.createdAt))
    .limit(limit);
  return NextResponse.json({ entries: rows });
}

const createBody = z.object({
  account: z.string().nullable().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(["note", "weekly_recap"]).default("note"),
  title: z.string().max(200).nullable().optional(),
  body: z.string().min(1).max(20000),
});

export async function POST(request: NextRequest) {
  const { session, error } = await guardAdmin();
  if (error) return error;
  const parsed = createBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Ogiltig anteckning" }, { status: 400 });
  const b = parsed.data;
  const [row] = await db.insert(schema.loopJournal).values({
    adAccountId: formatAct(b.account),
    entryDate: b.date,
    kind: b.kind,
    title: b.title?.trim() || null,
    body: b.body.trim(),
    authorId: session.user.id,
    authorName: session.user.name ?? null,
  }).returning();
  return NextResponse.json({ entry: row }, { status: 201 });
}

const updateBody = z.object({
  id: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  kind: z.enum(["note", "weekly_recap"]).optional(),
  title: z.string().max(200).nullable().optional(),
  body: z.string().min(1).max(20000).optional(),
});

export async function PATCH(request: NextRequest) {
  const { error } = await guardAdmin();
  if (error) return error;
  const parsed = updateBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Ogiltig anteckning" }, { status: 400 });
  const b = parsed.data;
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (b.date !== undefined) set.entryDate = b.date;
  if (b.kind !== undefined) set.kind = b.kind;
  if (b.title !== undefined) set.title = b.title?.trim() || null;
  if (b.body !== undefined) set.body = b.body.trim();
  const [row] = await db.update(schema.loopJournal).set(set).where(eq(schema.loopJournal.id, b.id)).returning();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ entry: row });
}

export async function DELETE(request: NextRequest) {
  const { error } = await guardAdmin();
  if (error) return error;
  const { id } = (await request.json().catch(() => ({}))) as { id?: string };
  if (!id) return NextResponse.json({ error: "id krävs" }, { status: 400 });
  await db.delete(schema.loopJournal).where(and(eq(schema.loopJournal.id, id)));
  return NextResponse.json({ success: true });
}
