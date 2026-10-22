import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isElevated } from "@/lib/access";
import { createPublishJob, runJob, type PublishConfig } from "@/lib/publish/engine";
import { scheduleNext, summarize } from "@/lib/publish/http";
import { db, schema } from "@/db";

export const maxDuration = 60;

// POST /api/assignments/:id/publish — start (or return the running) upload
// job for this assignment. The job continues on the server; the dialog
// polls /api/publish-jobs/:jobId/run for progress.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let config: PublishConfig | null = null;
  let userId: string | null = null;
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    userId = session.user.id;
    config = (await request.json()) as PublishConfig;

    const { job: created, existing } = await createPublishJob(id, config, session.user.id);
    const job = existing ? created : (await runJob(created.id, 20_000)) ?? created;
    scheduleNext(request, job);
    return NextResponse.json({ success: true, jobId: job.id, existing, job: summarize(job) }, { status: existing ? 200 : 202 });
  } catch (error) {
    console.error("Publish start error:", error);
    const message = error instanceof Error ? error.message : "Failed to start upload";
    // Vercel keeps function logs for an hour, so a start that fails before a
    // job exists would otherwise leave no trace. Record it as a failed job.
    try {
      await db.insert(schema.publishJobs).values({
        assignmentId: id, createdById: userId, status: "failed", step: "preflight", attempts: 1, lastError: message.slice(0, 900),
        config: (config ?? {}) as Record<string, unknown>, state: { log: [{ at: new Date().toISOString(), msg: `Stopped before start: ${message}` }] },
        totalAds: 0, finishedAt: new Date(),
      });
    } catch (e) { console.error("Could not record failed publish start:", e); }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
