import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { runEditorInsightsSync } from "@/lib/meta/sync-insights";
import { isElevated } from "@/lib/access";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Admin-triggered manual insights sync (no CRON_SECRET needed — session-guarded).
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const synced = await runEditorInsightsSync();
    return NextResponse.json({ success: true, synced });
  } catch (error) {
    console.error("Manual sync error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 500 }
    );
  }
}
