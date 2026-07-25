import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq, and, gte, lt, ne } from "drizzle-orm";
import {
  guardFounder,
  badRequest,
  parseDate,
  MIN_NOTE_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_SESSION_SECONDS,
} from "@/lib/work-tracker";
import { fetchSessions, fetchSessionById } from "@/lib/work-queries";

/**
 * GET /api/work/sessions?from=<iso>&to=<iso>&userId=<id>
 * Both founders see both founders' sessions — shared visibility is the point.
 */
export async function GET(request: NextRequest) {
  const { error } = await guardFounder();
  if (error) return error;

  const { searchParams } = request.nextUrl;
  const from = parseDate(searchParams.get("from"));
  const to = parseDate(searchParams.get("to"));
  const userId = searchParams.get("userId");

  // Filtered on start time — a session belongs to the day it began. The widget
  // fetches the currently open session separately via /sessions/active.
  const conditions = [];
  if (from) conditions.push(gte(schema.workSessions.startedAt, from));
  if (to) conditions.push(lt(schema.workSessions.startedAt, to));
  if (userId) conditions.push(eq(schema.workSessions.userId, userId));

  const requested = Number(searchParams.get("limit"));
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 5000) : 2000;

  const sessions = await fetchSessions(conditions.length ? and(...conditions) : undefined, limit);
  return NextResponse.json(sessions);
}

/**
 * POST /api/work/sessions
 *  - { categoryId, brandId?, task? }                       → starts the timer
 *  - { manual: true, categoryId, startedAt, endedAt, note } → logs a finished session
 */
export async function POST(request: NextRequest) {
  const { session, error } = await guardFounder();
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const userId = session.user.id;

  const categoryId = typeof body.categoryId === "string" ? body.categoryId : "";
  if (!categoryId) return badRequest("categoryId is required");

  const [category] = await db
    .select({ id: schema.workCategories.id })
    .from(schema.workCategories)
    .where(eq(schema.workCategories.id, categoryId))
    .limit(1);
  if (!category) return badRequest("Unknown category");

  let brandId: string | null = typeof body.brandId === "string" && body.brandId ? body.brandId : null;
  if (brandId) {
    const [brand] = await db
      .select({ id: schema.workBrands.id })
      .from(schema.workBrands)
      .where(eq(schema.workBrands.id, brandId))
      .limit(1);
    if (!brand) brandId = null;
  }

  const task = typeof body.task === "string" && body.task.trim() ? body.task.trim().slice(0, 200) : null;

  // ── Manual entry (forgot to hit start) ────────────────────────────────────
  if (body.manual === true) {
    const startedAt = parseDate(body.startedAt);
    const endedAt = parseDate(body.endedAt);
    if (!startedAt || !endedAt) return badRequest("startedAt and endedAt are required");
    if (endedAt <= startedAt) return badRequest("endedAt must be after startedAt");

    const durationSeconds = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000);
    if (durationSeconds > MAX_SESSION_SECONDS) return badRequest("A session cannot be longer than 24h");

    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (note.length < MIN_NOTE_LENGTH) {
      return badRequest(`Write what you did — at least ${MIN_NOTE_LENGTH} characters`);
    }

    const [row] = await db
      .insert(schema.workSessions)
      .values({
        userId,
        categoryId,
        brandId,
        task,
        note: note.slice(0, MAX_NOTE_LENGTH),
        startedAt,
        endedAt,
        segmentStartedAt: null,
        accumulatedSeconds: durationSeconds,
        durationSeconds,
        status: "done",
        source: "manual",
      })
      .returning({ id: schema.workSessions.id });

    return NextResponse.json(await fetchSessionById(row.id), { status: 201 });
  }

  // ── Start the timer ───────────────────────────────────────────────────────
  const open = await db
    .select({ id: schema.workSessions.id })
    .from(schema.workSessions)
    .where(and(eq(schema.workSessions.userId, userId), ne(schema.workSessions.status, "done")))
    .limit(1);

  if (open.length > 0) {
    return NextResponse.json(
      { error: "You already have a session running. Stop it first.", activeId: open[0].id },
      { status: 409 }
    );
  }

  const now = new Date();
  try {
    const [row] = await db
      .insert(schema.workSessions)
      .values({
        userId,
        categoryId,
        brandId,
        task,
        startedAt: now,
        segmentStartedAt: now,
        accumulatedSeconds: 0,
        status: "running",
        source: "timer",
      })
      .returning({ id: schema.workSessions.id });

    return NextResponse.json(await fetchSessionById(row.id), { status: 201 });
  } catch {
    // Partial unique index caught a double-click / second tab.
    return NextResponse.json({ error: "You already have a session running. Stop it first." }, { status: 409 });
  }
}
