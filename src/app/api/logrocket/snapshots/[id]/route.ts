import { NextResponse } from "next/server";
import { guardFounder } from "@/lib/work-tracker";
import { getSnapshot, listSnapshots, toMeta } from "@/lib/logrocket-store";

export const dynamic = "force-dynamic";

/**
 * GET /api/logrocket/snapshots/:id
 *
 * One version plus the one captured immediately before it, so the page can
 * show deltas for any point in the history — not just the newest pull.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await guardFounder();
  if (error) return error;

  const { id } = await params;
  const row = await getSnapshot(id);
  if (!row) {
    return NextResponse.json({ error: "Versionen finns inte." }, { status: 404 });
  }

  const all = await listSnapshots();
  const index = all.findIndex((r) => r.id === id);
  const older = index >= 0 ? all[index + 1] : undefined;

  return NextResponse.json({
    current: { ...toMeta(row), payload: row.payload },
    previous: older ? { ...toMeta(older), payload: older.payload } : null,
  });
}
