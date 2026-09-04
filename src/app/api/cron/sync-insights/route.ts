import { NextRequest, NextResponse } from "next/server";
import { runEditorInsightsSync, runSync } from "@/lib/meta/sync-insights";
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
    // The two syncs each need most of the 300s budget — they run as SEPARATE
    // cron invocations (?mode=accounts at 05:40, ?mode=editor at 06:00 in
    // vercel.json). Default = editor (original behaviour); mode=all is for
    // manual runs where the caller accepts the timeout risk.
    const mode = request.nextUrl.searchParams.get("mode") ?? "editor";
    if (mode === "accounts") {
      // Auto-assign runs FIRST: runSync regularly eats the whole 300s budget
      // and the function is killed mid-run, so anything after it never
      // executes. That starved auto-assign every night — new ad sets sat
      // without owners and the editor pages stopped picking up new videos.
      const autoAssign = await autoAssignSafely();
      const autoLink = await autoLinkSafely();
      const accountSync = await runSync();
      return NextResponse.json({ success: true, accountSync, autoAssign, autoLink });
    }
    if (mode === "all") {
      const autoAssign = await autoAssignSafely();
      await autoLinkSafely();
      let accountSync: unknown = null;
      try {
        accountSync = await runSync();
      } catch (e) {
        accountSync = { error: e instanceof Error ? e.message : String(e) };
      }
      const synced = await runEditorInsightsSync();
      return NextResponse.json({ success: true, accountSync, autoAssign, synced });
    }
    const synced = await runEditorInsightsSync();
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
