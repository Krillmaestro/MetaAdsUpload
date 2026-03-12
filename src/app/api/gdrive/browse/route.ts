import { NextRequest, NextResponse } from "next/server";
import { listFiles } from "@/lib/gdrive/client";

export async function GET(request: NextRequest) {
  try {
    const folderId = request.nextUrl.searchParams.get("folder") || undefined;
    const files = await listFiles(folderId);
    return NextResponse.json({ files });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to browse" }, { status: 500 });
  }
}
