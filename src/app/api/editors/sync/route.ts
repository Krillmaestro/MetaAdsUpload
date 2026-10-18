import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { runEditorInsightsSync, runSync, SYNC_BUDGET_MS } from "@/lib/meta/sync-insights";
import { invalidateEditorStats } from "@/lib/editor-stats";
import { isElevated } from "@/lib/access";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Admin-triggered manual sync (session-guarded). Refreshes the last 3 days for
 * every account (today's numbers, a few Meta calls per account), spends the
 * rest of the budget on pending lifetime backfills, then refreshes the ledger.
 * The nightly cron keeps the full 30-day window current.
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const deadline = Date.now() + SYNC_BUDGET_MS;
    const accounts = await runSync({ days: 3, deadline });
    const synced = await runEditorInsightsSync({ deadline });
    invalidateEditorStats();
    return NextResponse.json({ success: true, accounts, synced });
  } catch (error) {
    console.error("Manual sync error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 500 }
    );
  }
}
