import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { runJob } from "@/lib/publish/engine";
import { mayDrive, scheduleNext, summarize } from "@/lib/publish/http";

export const maxDuration = 60;

// POST /api/publish-jobs/:id/run — advance the job as far as ~35 s allow and
// report where it is. Harmless to call at any time from anywhere.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!mayDrive(request, session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const job = await runJob(id, 35_000);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  scheduleNext(request, job);
  return NextResponse.json({ job: summarize(job) });
}
