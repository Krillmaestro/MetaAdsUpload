import { NextRequest, NextResponse } from "next/server";
import { guardAdmin } from "@/lib/auth-helpers";
import { searchAdsets } from "@/lib/learning-loop/link";

export const dynamic = "force-dynamic";

/** GET ?q= — ad sets by name, for the manual link picker. */
export async function GET(request: NextRequest) {
  const { error } = await guardAdmin();
  if (error) return error;
  try {
    const q = request.nextUrl.searchParams.get("q") ?? "";
    const adsets = await searchAdsets(q, 40);
    return NextResponse.json({ adsets });
  } catch (e) {
    console.error("learning-loop adsets GET failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Kunde inte söka" }, { status: 500 });
  }
}
