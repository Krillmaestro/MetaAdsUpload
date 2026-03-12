import { NextRequest, NextResponse } from "next/server";
import { getAdSets, createAdSet, updateAdSet } from "@/lib/meta/adsets";

export async function GET(request: NextRequest) {
  try {
    const campaignId = request.nextUrl.searchParams.get("campaign_id") || undefined;
    const adsets = await getAdSets(campaignId);
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
    const body = await request.json();
    const result = await createAdSet(body);
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
    const body = await request.json();
    const { id, ...params } = body;
    if (!id) return NextResponse.json({ error: "Missing ad set ID" }, { status: 400 });
    await updateAdSet(id, params);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update ad set" },
      { status: 500 }
    );
  }
}
