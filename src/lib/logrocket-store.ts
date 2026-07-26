import "server-only";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { SEED_PAYLOAD } from "./logrocket-data";
import type { LogRocketPayload, SnapshotMeta, SnapshotSource } from "./logrocket-types";

type Row = typeof schema.logrocketSnapshots.$inferSelect;

export function toMeta(row: Row): SnapshotMeta {
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

/**
 * Newest first, seeding the first row from SEED_PAYLOAD when the table is
 * empty. The partial unique index on source='seed' keeps that insert
 * idempotent, so concurrent callers cannot create two seeds.
 */
export async function listSnapshots(limit = 60): Promise<Row[]> {
  const read = () =>
    db
      .select()
      .from(schema.logrocketSnapshots)
      .orderBy(desc(schema.logrocketSnapshots.capturedAt))
      .limit(limit);

  const rows = await read();
  if (rows.length > 0) return rows;

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

  return read();
}

export async function getSnapshot(id: string): Promise<Row | null> {
  const [row] = await db
    .select()
    .from(schema.logrocketSnapshots)
    .where(eq(schema.logrocketSnapshots.id, id))
    .limit(1);
  return row ?? null;
}

/** What the page needs on first paint: the version list, the newest payload, and the one before it to diff against. */
export async function loadDashboard(): Promise<{
  versions: SnapshotMeta[];
  current: SnapshotMeta & { payload: LogRocketPayload };
  previous: (SnapshotMeta & { payload: LogRocketPayload }) | null;
}> {
  const rows = await listSnapshots();

  // Database unreachable or still empty — render the seed so the page never blanks.
  if (rows.length === 0) {
    const fallback: SnapshotMeta & { payload: LogRocketPayload } = {
      id: "seed",
      label: "Första hämtningen",
      source: "seed",
      windowStart: SEED_PAYLOAD.source.windowStart,
      windowEnd: SEED_PAYLOAD.source.windowEnd,
      capturedAt: new Date().toISOString(),
      createdByName: "Gene",
      payload: SEED_PAYLOAD,
    };
    return { versions: [fallback], current: fallback, previous: null };
  }

  return {
    versions: rows.map(toMeta),
    current: { ...toMeta(rows[0]), payload: rows[0].payload },
    previous: rows[1] ? { ...toMeta(rows[1]), payload: rows[1].payload } : null,
  };
}
