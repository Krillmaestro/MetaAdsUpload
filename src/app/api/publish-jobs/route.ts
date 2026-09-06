import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { latestJobFor, resumeRunnable } from "@/lib/publish/engine";
import { mayDrive, summarize } from "@/lib/publish/http";

export const maxDuration = 60;

// GET /api/publish-jobs?assignmentId=… — the latest job for an assignment
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!mayDrive(request, session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const assignmentId = request.nextUrl.searchParams.get("assignmentId");
  if (!assignmentId) return NextResponse.json({ error: "assignmentId required" }, { status: 400 });
  const job = await latestJobFor(assignmentId);
  return NextResponse.json({ job: job ? summarize(job) : null });
}

// POST /api/publish-jobs — run every job that is due (board load, worker, cron)
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!mayDrive(request, session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const jobs = await resumeRunnable(45_000);
  return NextResponse.json({ ran: jobs.map(summarize) });
}
