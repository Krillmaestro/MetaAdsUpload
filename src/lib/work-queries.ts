import { db, schema } from "@/db";
import { eq, desc, type SQL } from "drizzle-orm";
import { elapsedSeconds } from "@/lib/work-tracker";

/** Flat, UI-ready shape for a work session (category/brand/user already resolved). */
export const workSessionColumns = {
  id: schema.workSessions.id,
  userId: schema.workSessions.userId,
  userName: schema.users.name,
  categoryId: schema.workSessions.categoryId,
  categoryName: schema.workCategories.name,
  categoryColor: schema.workCategories.color,
  brandId: schema.workSessions.brandId,
  brandName: schema.workBrands.name,
  brandColor: schema.workBrands.color,
  task: schema.workSessions.task,
  note: schema.workSessions.note,
  startedAt: schema.workSessions.startedAt,
  endedAt: schema.workSessions.endedAt,
  segmentStartedAt: schema.workSessions.segmentStartedAt,
  accumulatedSeconds: schema.workSessions.accumulatedSeconds,
  durationSeconds: schema.workSessions.durationSeconds,
  status: schema.workSessions.status,
  source: schema.workSessions.source,
};

function withElapsed<
  T extends {
    status: string;
    accumulatedSeconds: number;
    segmentStartedAt: Date | null;
    durationSeconds: number | null;
  },
>(row: T): T & { elapsedSeconds: number } {
  return { ...row, elapsedSeconds: elapsedSeconds(row) };
}

function baseQuery() {
  return db
    .select(workSessionColumns)
    .from(schema.workSessions)
    .leftJoin(schema.users, eq(schema.users.id, schema.workSessions.userId))
    .leftJoin(schema.workCategories, eq(schema.workCategories.id, schema.workSessions.categoryId))
    .leftJoin(schema.workBrands, eq(schema.workBrands.id, schema.workSessions.brandId));
}

/** Fetch joined sessions, newest first. `where` is composed by the caller. */
export async function fetchSessions(where: SQL | undefined, limit = 2000) {
  const rows = await baseQuery()
    .where(where)
    .orderBy(desc(schema.workSessions.startedAt))
    .limit(limit);
  return rows.map(withElapsed);
}

export async function fetchSessionById(id: string) {
  const rows = await baseQuery().where(eq(schema.workSessions.id, id)).limit(1);
  return rows[0] ? withElapsed(rows[0]) : null;
}
