import { NextRequest, NextResponse } from "next/server";
import { guardAdmin } from "@/lib/auth-helpers";
import { buildLearningLoop, type Period } from "@/lib/learning-loop/rows";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET ?account=act_…|all&period=7d|14d|30d|90d|lifetime */
export async function GET(request: NextRequest) {
  const { error } = await guardAdmin();
  if (error) return error;
  try {
    const sp = request.nextUrl.searchParams;
    const data = await buildLearningLoop({
      account: sp.get("account") || null,
      period: (sp.get("period") as Period) || "30d",
    });
    return NextResponse.json(data);
  } catch (e) {
    console.error("learning-loop GET failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Kunde inte bygga Learning Loop" }, { status: 500 });
  }
}
