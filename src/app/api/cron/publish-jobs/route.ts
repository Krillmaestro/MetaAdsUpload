import { NextRequest, NextResponse } from "next/server";
import { resumeRunnable } from "@/lib/publish/engine";
import { mayDrive, summarize } from "@/lib/publish/http";

export const maxDuration = 60;

// GET /api/cron/publish-jobs?secret=… — safety net: run whatever is due.
export async function GET(request: NextRequest) {
  if (!mayDrive(request, null)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const jobs = await resumeRunnable(45_000);
  return NextResponse.json({ ran: jobs.map(summarize) });
}
