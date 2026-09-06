import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getAds, createAd, updateAd } from "@/lib/meta/ads";
import { withAccount } from "@/lib/meta/client";
import { isElevated } from "@/lib/access";

export const dynamic = "force-dynamic";

// Optional multi-account scoping: pass ?connectionId=<id> (or connectionId in
// the JSON body for writes) to target a non-active Meta connection.
function scopeRunner(connectionId: unknown) {
  const id = typeof connectionId === "string" ? parseInt(connectionId, 10) : typeof connectionId === "number" ? connectionId : NaN;
  return <T,>(fn: () => Promise<T>): Promise<T> => (Number.isFinite(id) ? withAccount(id as number, fn) : fn());
}


export async function GET(request: NextRequest) {
  try {
    // H8: Auth + admin check
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const adsetId = request.nextUrl.searchParams.get("adset_id") || undefined;
    const run = scopeRunner(request.nextUrl.searchParams.get("connectionId"));
    const ads = await run(() => getAds(adsetId));
    return NextResponse.json({ data: ads });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch ads" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await request.json();
    const { connectionId, ...params } = body;
    const run = scopeRunner(connectionId);
    const result = await run(() => createAd(params));
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create ad" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await request.json();
    const { id, ...params } = body;
    if (!id) return NextResponse.json({ error: "Missing ad ID" }, { status: 400 });
    await updateAd(id, params);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update ad" },
      { status: 500 }
    );
  }
}
