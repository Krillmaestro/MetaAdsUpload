import { NextRequest, NextResponse } from "next/server";
import { runEditorInsightsSync, runSync, SYNC_BUDGET_MS } from "@/lib/meta/sync-insights";
import { refreshBonusLedger } from "@/lib/bonus-ledger";
import { invalidateEditorStats } from "@/lib/editor-stats";
import { autoAssignAllAccounts } from "@/lib/adsets/auto-assign";
import { autoLinkAll } from "@/lib/learning-loop/link";

/**
 * Brief ↔ ad set linking for the Learning Loop. Applies only high-confidence,
 * unambiguous name matches; the rest wait for a person on /learning-loop.
 * Best-effort for the same reason as auto-assign.
 */
async function autoLinkSafely() {
  try {
    return await autoLinkAll(null);
  } catch (e) {
    console.error("auto-link during sync failed:", e);
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Auto-assignment runs after the account sync, once new ad sets exist locally.
 * It only applies safe fills — a scheduled job never overrules a person, so
 * conflicts stay in the review dialog. Failures are swallowed on purpose:
 * tagging is a convenience and must not take the insights sync down with it.
 */
async function autoAssignSafely() {
  try {
    return await autoAssignAllAccounts();
  } catch (e) {
    console.error("auto-assign during sync failed:", e);
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export const dynamic = "force-dynamic";
export const maxDuration = 300; // allow long syncs (daily rows for many ads)

function isAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

async function handle(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error("CRON_SECRET environment variable is not set");
    return NextResponse.json({ error: "Server configuration error: CRON_SECRET not set" }, { status: 500 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    // Two cron invocations, each with its own 300s function:
    //  ?mode=accounts (05:40) — auto-assign + auto-link, then every account's
    //    rolling 30-day window (archived/deleted ads included) and a ledger refresh.
    //  ?mode=editor (06:00, default) — lifetime backfills for owned ad sets
    //    that don't have them yet, then a ledger refresh.
    // mode=all runs both for manual triggers that accept the timeout risk.
    const deadline = Date.now() + SYNC_BUDGET_MS;
    const mode = request.nextUrl.searchParams.get("mode") ?? "editor";
    if (mode === "accounts") {
      // Auto-assign first, so new ad sets have owners before their numbers land.
      const autoAssign = await autoAssignSafely();
      const autoLink = await autoLinkSafely();
      const accountSync = await runSync({ deadline });
      const ledger = await refreshBonusLedger();
      invalidateEditorStats();
      return NextResponse.json({ success: true, accountSync, autoAssign, autoLink, ledger });
    }
    if (mode === "all") {
      const autoAssign = await autoAssignSafely();
      await autoLinkSafely();
      let accountSync: unknown = null;
      try {
        accountSync = await runSync({ deadline });
      } catch (e) {
        accountSync = { error: e instanceof Error ? e.message : String(e) };
      }
      const synced = await runEditorInsightsSync({ deadline });
      invalidateEditorStats();
      return NextResponse.json({ success: true, accountSync, autoAssign, synced });
    }
    const synced = await runEditorInsightsSync({ deadline });
    invalidateEditorStats();
    return NextResponse.json({ success: true, synced });
  } catch (error) {
    console.error("Sync error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 500 }
    );
  }
}

// POST — manual / external trigger. GET — Vercel Cron (auto-sends Bearer CRON_SECRET).
export async function POST(request: NextRequest) { return handle(request); }
export async function GET(request: NextRequest) { return handle(request); }
