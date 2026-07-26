import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { guardFounder } from "@/lib/work-tracker";
import { payloadSchema, SNAPSHOT_SOURCES, type SnapshotSource } from "@/lib/logrocket-types";
import { SEED_PAYLOAD } from "@/lib/logrocket-data";

export const dynamic = "force-dynamic";

const envelopeSchema = z.object({
  label: z.string().max(120).optional(),
  source: z.enum(SNAPSHOT_SOURCES).default("manual"),
  payload: payloadSchema,
});

type Row = typeof schema.logrocketSnapshots.$inferSelect;

function meta(row: Row) {
  return {
    id: row.id,
    label: row.label,
    source: row.source as SnapshotSource,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    capturedAt: row.capturedAt.toISOString(),
    createdByName: row.createdByName,
  };
}

function newestFirst(limit: number) {
  return db
    .select()
    .from(schema.logrocketSnapshots)
    .orderBy(desc(schema.logrocketSnapshots.capturedAt))
    .limit(limit);
}

/**
 * GET /api/logrocket/snapshots
 *
 * Newest first. `?full=1` includes payloads (what the page's initial load
 * needs); without it you get metadata only, which is all the version picker
 * reads.
 *
 * An empty table seeds its first row from SEED_PAYLOAD rather than returning
 * nothing, so the history starts at the pull the page shipped with instead of
 * starting blank. A partial unique index on source='seed' makes the insert
 * idempotent under concurrent requests.
 */
export async function GET(request: Request) {
  const { error } = await guardFounder();
  if (error) return error;

  const full = new URL(request.url).searchParams.get("full") === "1";

  let rows = await newestFirst(60);

  if (rows.length === 0) {
    await db
      .insert(schema.logrocketSnapshots)
      .values({
        label: "Första hämtningen",
        source: "seed",
        windowStart: SEED_PAYLOAD.source.windowStart,
        windowEnd: SEED_PAYLOAD.source.windowEnd,
        payload: SEED_PAYLOAD,
        createdByName: "Gene",
      })
      .onConflictDoNothing();

    rows = await newestFirst(60);
  }

  return NextResponse.json(
    rows.map((row) => (full ? { ...meta(row), payload: row.payload } : meta(row)))
  );
}

/**
 * POST /api/logrocket/snapshots
 *
 * Stores a new version. Nothing is ever updated in place — a correction is a
 * new row, so the history stays honest about what we believed and when.
 */
export async function POST(request: Request) {
  const { session, error } = await guardFounder();
  if (error) return error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Kunde inte läsa JSON i anropet." }, { status: 400 });
  }

  const parsed = envelopeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Payloaden matchar inte förväntat format.",
        issues: parsed.error.issues.slice(0, 12).map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 }
    );
  }

  const { label, source, payload } = parsed.data;

  const [saved] = await db
    .insert(schema.logrocketSnapshots)
    .values({
      label: label?.trim() || null,
      source,
      windowStart: payload.source.windowStart,
      windowEnd: payload.source.windowEnd,
      payload,
      createdBy: session.user.id,
      createdByName: session.user.name ?? null,
    })
    .returning();

  return NextResponse.json({ ...meta(saved), payload: saved.payload });
}
