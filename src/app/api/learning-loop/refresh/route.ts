import { NextRequest, NextResponse } from "next/server";
import { guardAdmin } from "@/lib/auth-helpers";
import { withAdAccount } from "@/lib/meta/client";
import { syncAdsetsCache } from "@/lib/meta/sync-insights";
import { autoLinkAll } from "@/lib/learning-loop/link";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST { account? } — pull ad set metadata (names, status, created_time) from
 * Meta into adsets_cache, then run the auto-linker. Insights themselves come
 * from the nightly sync (or "Sync Meta" on /editors).
 */
export async function POST(request: NextRequest) {
  const { session, error } = await guardAdmin();
  if (error) return error;
  try {
    const body = (await request.json().catch(() => ({}))) as { account?: string | null };
    const account = body.account && body.account !== "all" ? body.account : undefined;
    const adsets = await withAdAccount(account, () => syncAdsetsCache());
    const links = await autoLinkAll(session.user.id);
    return NextResponse.json({ adsets, links });
  } catch (e) {
    console.error("learning-loop refresh failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Kunde inte uppdatera" }, { status: 500 });
  }
}
