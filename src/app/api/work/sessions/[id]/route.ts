import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import {
  guardFounder,
  badRequest,
  parseDate,
  elapsedSeconds,
  MIN_NOTE_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_SESSION_SECONDS,
} from "@/lib/work-tracker";
import { fetchSessionById } from "@/lib/work-queries";

/**
 * PATCH /api/work/sessions/[id]
 *   { action: "pause" }
 *   { action: "resume" }
 *   { action: "stop", note, categoryId?, brandId?, task? }   ← note is mandatory
 *   { action: "update", ...fields }                          ← edit a logged session
 *
 * You can only touch your own sessions; both founders can *read* everything.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await guardFounder();
  if (error) return error;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "update";

  const [row] = await db
    .select()
    .from(schema.workSessions)
    .where(eq(schema.workSessions.id, id))
    .limit(1);

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.userId !== session.user.id) {
    return NextResponse.json({ error: "You can only edit your own sessions" }, { status: 403 });
  }

  const now = new Date();

  // ── pause ─────────────────────────────────────────────────────────────────
  if (action === "pause") {
    if (row.status !== "running") return badRequest("Session is not running");
    await db
      .update(schema.workSessions)
      .set({
        status: "paused",
        accumulatedSeconds: elapsedSeconds(row, now),
        segmentStartedAt: null,
        updatedAt: now,
      })
      .where(eq(schema.workSessions.id, id));
    return NextResponse.json(await fetchSessionById(id));
  }

  // ── resume ────────────────────────────────────────────────────────────────
  if (action === "resume") {
    if (row.status !== "paused") return badRequest("Session is not paused");
    await db
      .update(schema.workSessions)
      .set({ status: "running", segmentStartedAt: now, updatedAt: now })
      .where(eq(schema.workSessions.id, id));
    return NextResponse.json(await fetchSessionById(id));
  }

  // ── stop ──────────────────────────────────────────────────────────────────
  if (action === "stop") {
    if (row.status === "done") return badRequest("Session is already stopped");

    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (note.length < MIN_NOTE_LENGTH) {
      return badRequest(`Write what you did — at least ${MIN_NOTE_LENGTH} characters`);
    }

    const updates: Partial<typeof schema.workSessions.$inferInsert> = {
      note: note.slice(0, MAX_NOTE_LENGTH),
      status: "done",
      endedAt: now,
      segmentStartedAt: null,
      updatedAt: now,
    };

    // Let the category/brand be corrected at stop time — you often learn what
    // the session really was only once it's over.
    const reclassified = await applyClassification(body, updates);
    if (reclassified) return reclassified;

    const total = Math.min(elapsedSeconds(row, now), MAX_SESSION_SECONDS);
    updates.accumulatedSeconds = total;
    updates.durationSeconds = total;

    await db.update(schema.workSessions).set(updates).where(eq(schema.workSessions.id, id));
    return NextResponse.json(await fetchSessionById(id));
  }

  // ── update a logged session ───────────────────────────────────────────────
  if (action === "update") {
    const updates: Partial<typeof schema.workSessions.$inferInsert> = { updatedAt: now };

    const reclassified = await applyClassification(body, updates);
    if (reclassified) return reclassified;

    if (body.task !== undefined) {
      updates.task =
        typeof body.task === "string" && body.task.trim() ? body.task.trim().slice(0, 200) : null;
    }

    if (body.note !== undefined) {
      const note = typeof body.note === "string" ? body.note.trim() : "";
      if (row.status === "done" && note.length < MIN_NOTE_LENGTH) {
        return badRequest(`Write what you did — at least ${MIN_NOTE_LENGTH} characters`);
      }
      updates.note = note ? note.slice(0, MAX_NOTE_LENGTH) : null;
    }

    // Time corrections only apply to finished sessions.
    if (body.startedAt !== undefined || body.endedAt !== undefined) {
      if (row.status !== "done") return badRequest("Stop the session before editing its times");

      const startedAt = parseDate(body.startedAt) ?? row.startedAt;
      const endedAt = parseDate(body.endedAt) ?? row.endedAt;
      if (!endedAt) return badRequest("endedAt is required");
      if (endedAt <= startedAt) return badRequest("endedAt must be after startedAt");

      const duration = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000);
      if (duration > MAX_SESSION_SECONDS) return badRequest("A session cannot be longer than 24h");

      updates.startedAt = startedAt;
      updates.endedAt = endedAt;
      updates.durationSeconds = duration;
      updates.accumulatedSeconds = duration;
    }

    if (Object.keys(updates).length <= 1) return badRequest("nothing to update");

    await db.update(schema.workSessions).set(updates).where(eq(schema.workSessions.id, id));
    return NextResponse.json(await fetchSessionById(id));
  }

  return badRequest(`Unknown action: ${action}`);
}

// DELETE /api/work/sessions/[id]
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await guardFounder();
  if (error) return error;

  const { id } = await params;
  const [row] = await db
    .select({ userId: schema.workSessions.userId })
    .from(schema.workSessions)
    .where(eq(schema.workSessions.id, id))
    .limit(1);

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.userId !== session.user.id) {
    return NextResponse.json({ error: "You can only delete your own sessions" }, { status: 403 });
  }

  await db.delete(schema.workSessions).where(eq(schema.workSessions.id, id));
  return NextResponse.json({ ok: true });
}

/** Validates + applies categoryId/brandId from a request body. Returns an error response on failure. */
async function applyClassification(
  body: Record<string, unknown>,
  updates: Partial<typeof schema.workSessions.$inferInsert>
): Promise<NextResponse | null> {
  if (typeof body.categoryId === "string" && body.categoryId) {
    const [category] = await db
      .select({ id: schema.workCategories.id })
      .from(schema.workCategories)
      .where(eq(schema.workCategories.id, body.categoryId))
      .limit(1);
    if (!category) return badRequest("Unknown category");
    updates.categoryId = body.categoryId;
  }

  if (body.brandId !== undefined) {
    if (typeof body.brandId === "string" && body.brandId) {
      const [brand] = await db
        .select({ id: schema.workBrands.id })
        .from(schema.workBrands)
        .where(eq(schema.workBrands.id, body.brandId))
        .limit(1);
      if (!brand) return badRequest("Unknown brand");
      updates.brandId = body.brandId;
    } else {
      updates.brandId = null;
    }
  }

  return null;
}
