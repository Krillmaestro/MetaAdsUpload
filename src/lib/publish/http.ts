// Glue between the job engine and HTTP: who may drive a job, how the server
// keeps a job moving after it has answered, and what the UI gets to see.
import { after, type NextRequest } from "next/server";
import type { Session } from "next-auth";
import { isElevated } from "@/lib/access";
import { STEP_LABELS, progressOf, type PublishJob } from "@/lib/publish/engine";

const workerSecret = () => (process.env.CRON_SECRET ?? "").trim();

/** A signed-in admin-level person, or the server/worker calling itself with the secret. */
export function mayDrive(request: NextRequest, session: Session | null): boolean {
  if (session?.user && isElevated(session.user)) return true;
  const s = workerSecret();
  if (!s) return false;
  const given = request.headers.get("x-worker-secret") ?? request.nextUrl.searchParams.get("secret") ?? "";
  return given === s;
}

export function summarize(job: PublishJob) {
  return {
    id: job.id, assignmentId: job.assignmentId, status: job.status, step: job.step, stepLabel: STEP_LABELS[job.step] ?? job.step,
    attempts: job.attempts, lastError: job.lastError, totalAds: job.totalAds, nextRunAt: job.nextRunAt, createdAt: job.createdAt, updatedAt: job.updatedAt, finishedAt: job.finishedAt,
    progress: progressOf(job),
  };
}

/**
 * Keep the job moving without anyone polling: once this response is sent,
 * call our own run endpoint again. The lock makes extra calls harmless.
 */
export function scheduleNext(request: NextRequest, job: PublishJob | null, delayMs = 1500) {
  if (!job || !["queued", "waiting", "running"].includes(job.status)) return;
  const s = workerSecret();
  if (!s) return;
  const origin = request.nextUrl.origin;
  const wait = job.nextRunAt ? Math.max(delayMs, job.nextRunAt.getTime() - Date.now()) : delayMs;
  console.log(`[publish-job ${job.id.slice(0, 8)}] chain scheduled in ${Math.min(wait, 25_000)} ms (${job.status} @ ${job.step})`);
  after(async () => {
    await new Promise((r) => setTimeout(r, Math.min(wait, 25_000)));
    try {
      const res = await fetch(`${origin}/api/publish-jobs/${job.id}/run`, { method: "POST", headers: { "x-worker-secret": s, "content-type": "application/json" }, body: "{}" });
      console.log(`[publish-job ${job.id.slice(0, 8)}] chained run → ${res.status}`);
    } catch (e) {
      console.log(`[publish-job ${job.id.slice(0, 8)}] chained run failed: ${e instanceof Error ? e.message : e}`);
    }
  });
}
