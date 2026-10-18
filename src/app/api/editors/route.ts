import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getEditorsOverview } from "@/lib/editor-stats";
import { parseDateRange } from "@/lib/date-range";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const data = await getEditorsOverview(parseDateRange(request.nextUrl.searchParams));
    return NextResponse.json(data);
  } catch (error) {
    console.error("Editors API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch editor data" },
      { status: 500 }
    );
  }
}
