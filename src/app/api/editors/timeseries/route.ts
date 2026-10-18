import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getEditorTimeseries } from "@/lib/editor-stats";
import { parseDateRange } from "@/lib/date-range";

// GET /api/editors/timeseries?editorId=...&from=...&to=...
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const editorId = request.nextUrl.searchParams.get("editorId");
    if (!editorId) return NextResponse.json({ error: "editorId is required" }, { status: 400 });
    const { from, to } = parseDateRange(request.nextUrl.searchParams);

    const timeseries = await getEditorTimeseries(editorId, from, to);
    return NextResponse.json({ timeseries });
  } catch (error) {
    console.error("Editor timeseries error:", error);
    return NextResponse.json({ error: "Failed to fetch timeseries" }, { status: 500 });
  }
}
