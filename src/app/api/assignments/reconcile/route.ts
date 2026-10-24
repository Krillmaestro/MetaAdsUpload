import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isElevated } from "@/lib/access";
import { reconcilePostedAssignments } from "@/lib/assignments/reconcile-posted";

// POST /api/assignments/reconcile — move every assignment whose ad set exists
// on Meta (by name, from adsets_cache) to Posted. Runs on board load and in
// the nightly sync as well; this is the manual trigger.
export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const result = await reconcilePostedAssignments(session.user.id);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Reconcile failed" }, { status: 500 });
  }
}
