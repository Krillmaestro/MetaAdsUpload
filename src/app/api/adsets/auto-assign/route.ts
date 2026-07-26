import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { applyProposals, buildProposals } from "@/lib/adsets/auto-assign";

export const dynamic = "force-dynamic";

/**
 * Auto-assign ad sets from their names.
 *
 * GET  = dry run, returns what WOULD change.
 * POST = apply. Conflicts require `includeConflicts` — see lib/adsets/auto-assign.
 *
 * The logic lives in the lib so this route and the nightly sync can never
 * diverge from each other.
 */

async function guard() {
  const session = await auth();
  if (!session?.user) return { session: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (session.user.role !== "admin") {
    return { session: null, error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session, error: null };
}

export async function GET(request: NextRequest) {
  const { error } = await guard();
  if (error) return error;

  try {
    const account = request.nextUrl.searchParams.get("account") || undefined;
    const { proposals, counts } = await buildProposals(account);
    return NextResponse.json({
      account: account ?? null,
      total: proposals.length,
      counts,
      // Unchanged/unparsed rows are noise in a review UI — counts still report them.
      proposals: proposals.filter((p) => p.kind === "fill" || p.kind === "conflict"),
    });
  } catch (e) {
    console.error("auto-assign preview failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Kunde inte läsa ad sets" },
      { status: 500 }
    );
  }
}

const applyBody = z.object({
  account: z.string().optional(),
  adsetIds: z.array(z.string()).optional(),
  includeConflicts: z.boolean().default(false),
});

export async function POST(request: NextRequest) {
  const { session, error } = await guard();
  if (error) return error;

  let raw: unknown = {};
  try {
    raw = await request.json();
  } catch {
    /* empty body = apply all safe fills */
  }
  const parsed = applyBody.safeParse(raw ?? {});
  if (!parsed.success) return NextResponse.json({ error: "Ogiltig begäran" }, { status: 400 });

  try {
    const { account, adsetIds, includeConflicts } = parsed.data;
    const { proposals } = await buildProposals(account);
    const applied = await applyProposals({
      proposals,
      adsetIds,
      includeConflicts,
      actorId: session.user.id,
    });
    return NextResponse.json({ applied });
  } catch (e) {
    console.error("auto-assign apply failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Kunde inte spara" }, { status: 500 });
  }
}
