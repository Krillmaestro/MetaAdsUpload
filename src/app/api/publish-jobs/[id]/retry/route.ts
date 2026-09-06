import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { retryJob, runJob } from "@/lib/publish/engine";
import { mayDrive, scheduleNext, summarize } from "@/lib/publish/http";

export const maxDuration = 60;

// POST /api/publish-jobs/:id/retry — clear the error and go again from the same step
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!mayDrive(request, session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const reset = await retryJob(id);
  if (!reset) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  const job = (await runJob(id, 30_000)) ?? reset;
  scheduleNext(request, job);
  return NextResponse.json({ job: summarize(job) });
}
