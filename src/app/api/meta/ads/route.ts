import { NextRequest, NextResponse } from "next/server";
import { getAds, createAd, updateAd } from "@/lib/meta/ads";

export async function GET(request: NextRequest) {
  try {
    const adsetId = request.nextUrl.searchParams.get("adset_id") || undefined;
    const ads = await getAds(adsetId);
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
    const body = await request.json();
    const result = await createAd(body);
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
