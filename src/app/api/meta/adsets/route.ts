import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getAdSets, createAdSet, updateAdSet } from "@/lib/meta/adsets";
import { withAccount, withAdAccount } from "@/lib/meta/client";
import { isElevated } from "@/lib/access";

export const dynamic = "force-dynamic";

// Optional multi-account scoping: pass ?connectionId=<id> to target a
// non-active Meta connection and/or ?adAccountId=act_... to target a specific
// ad account on it (e.g. the US account from a template).
function scopeRunner(connectionId: unknown, adAccountId?: unknown) {
  const id = typeof connectionId === "string" ? parseInt(connectionId, 10) : typeof connectionId === "number" ? connectionId : NaN;
  const act = typeof adAccountId === "string" && adAccountId.trim() ? adAccountId.trim() : null;
  return <T,>(fn: () => Promise<T>): Promise<T> => {
    const inner = () => withAdAccount(act, fn);
    return Number.isFinite(id) ? withAccount(id as number, inner) : inner();
  };
}


export async function GET(request: NextRequest) {
  try {
    // H8: Auth + admin check
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const campaignId = request.nextUrl.searchParams.get("campaign_id") || undefined;
    const run = scopeRunner(
      request.nextUrl.searchParams.get("connectionId"),
      request.nextUrl.searchParams.get("adAccountId")
    );
    const adsets = await run(() => getAdSets(campaignId));
    return NextResponse.json({ data: adsets });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch ad sets" },
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
    const { connectionId, adAccountId, ...params } = body;
    const run = scopeRunner(connectionId, adAccountId);
    const result = await run(() => createAdSet(params));
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create ad set" },
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
    const { id, connectionId, adAccountId, ...params } = body;
    if (!id) return NextResponse.json({ error: "Missing ad set ID" }, { status: 400 });
    const run = scopeRunner(connectionId, adAccountId);
    await run(() => updateAdSet(id, params));
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update ad set" },
      { status: 500 }
    );
  }
}
