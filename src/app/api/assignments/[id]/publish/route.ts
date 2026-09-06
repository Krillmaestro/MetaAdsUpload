import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isElevated } from "@/lib/access";
import { createPublishJob, runJob, type PublishConfig } from "@/lib/publish/engine";
import { scheduleNext, summarize } from "@/lib/publish/http";

export const maxDuration = 60;

// POST /api/assignments/:id/publish — start (or return the running) upload
// job for this assignment. The job continues on the server; the dialog
// polls /api/publish-jobs/:jobId/run for progress.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { id } = await params;
    const config = (await request.json()) as PublishConfig;

    const { job: created, existing } = await createPublishJob(id, config, session.user.id);
    const job = existing ? created : (await runJob(created.id, 20_000)) ?? created;
    scheduleNext(request, job);
    return NextResponse.json({ success: true, jobId: job.id, existing, job: summarize(job) }, { status: existing ? 200 : 202 });
  } catch (error) {
    console.error("Publish start error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to start upload" }, { status: 400 });
  }
}
