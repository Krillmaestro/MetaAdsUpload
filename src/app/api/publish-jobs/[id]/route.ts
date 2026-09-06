import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { mayDrive, summarize } from "@/lib/publish/http";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!mayDrive(request, session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const [job] = await db.select().from(schema.publishJobs).where(eq(schema.publishJobs.id, id));
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json({ job: summarize(job) });
}
