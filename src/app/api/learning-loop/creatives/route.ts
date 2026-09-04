import { NextRequest, NextResponse } from "next/server";
import { guardAdmin } from "@/lib/auth-helpers";
import { buildCreativeLoop, type Period } from "@/lib/learning-loop/rows";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET ?account=act_…|all&period=… — one row per creative across ad sets. */
export async function GET(request: NextRequest) {
  const { error } = await guardAdmin();
  if (error) return error;
  try {
    const sp = request.nextUrl.searchParams;
    const data = await buildCreativeLoop({
      account: sp.get("account") || null,
      period: (sp.get("period") as Period) || "30d",
    });
    return NextResponse.json(data);
  } catch (e) {
    console.error("learning-loop creatives GET failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Kunde inte bygga creative-vyn" }, { status: 500 });
  }
}
