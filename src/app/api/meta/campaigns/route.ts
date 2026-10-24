import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getCampaigns, createCampaign, updateCampaign, upsertCampaignsCache } from "@/lib/meta/campaigns";
import { withAccount, withAdAccount, getAdAccountId } from "@/lib/meta/client";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
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

    const run = scopeRunner(
      request.nextUrl.searchParams.get("connectionId"),
      request.nextUrl.searchParams.get("adAccountId")
    );
    // Fetch and cache inside the same scope, so the rows are stamped with the
    // account they belong to (a row without ad_account_id never shows up in
    // the Upload-to-Meta dialog, which filters on the template's account).
    const campaigns = await run(async () => {
      const list = await getCampaigns();
      await upsertCampaignsCache(await getAdAccountId(), list);
      return list;
    });

    return NextResponse.json({ data: campaigns });
  } catch (error) {
    console.error("Campaigns API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch campaigns" },
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
    const result = await run(() => createCampaign(params));
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create campaign" },
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
    if (!id) return NextResponse.json({ error: "Missing campaign ID" }, { status: 400 });

    await updateCampaign(id, params);

    // Update cache
    if (params.status) {
      await db.update(schema.campaignsCache).set({ status: params.status, syncedAt: new Date() }).where(eq(schema.campaignsCache.id, id));
    }
    if (params.daily_budget) {
      await db.update(schema.campaignsCache).set({ dailyBudget: params.daily_budget / 100, syncedAt: new Date() }).where(eq(schema.campaignsCache.id, id));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update campaign" },
      { status: 500 }
    );
  }
}
