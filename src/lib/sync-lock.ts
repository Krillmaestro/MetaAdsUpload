// Lease-based lock in sync_locks. The Neon HTTP driver has no sessions, so
// pg advisory locks don't survive between statements — a row with an expiry
// does. A crashed run's lease simply runs out.
import { db, schema } from "@/db";
import { sql } from "drizzle-orm";

export async function acquireLock(name: string, ttlSeconds: number, holder: string): Promise<boolean> {
  const until = new Date(Date.now() + ttlSeconds * 1000);
  const rows = await db
    .insert(schema.syncLocks)
    .values({ name, lockedUntil: until, holder })
    .onConflictDoUpdate({
      target: schema.syncLocks.name,
      set: { lockedUntil: until, holder },
      setWhere: sql`${schema.syncLocks.lockedUntil} < now()`,
    })
    .returning({ name: schema.syncLocks.name });
  return rows.length > 0;
}

export async function releaseLock(name: string, holder: string): Promise<void> {
  await db
    .update(schema.syncLocks)
    .set({ lockedUntil: new Date(0) })
    .where(sql`${schema.syncLocks.name} = ${name} AND ${schema.syncLocks.holder} = ${holder}`);
}

/** Run fn under the lock; returns null (without running) if another run holds it. */
export async function withLock<T>(name: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T | null> {
  const holder = crypto.randomUUID();
  if (!(await acquireLock(name, ttlSeconds, holder))) return null;
  try {
    return await fn();
  } finally {
    await releaseLock(name, holder).catch(() => {});
  }
}

