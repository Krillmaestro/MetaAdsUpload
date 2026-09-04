import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { guardAdmin } from "@/lib/auth-helpers";
import { applyLinks, autoLinkAll, buildLinkProposals } from "@/lib/learning-loop/link";

export const dynamic = "force-dynamic";

/** GET ?assignmentId= — link proposals (dry run). */
export async function GET(request: NextRequest) {
  const { error } = await guardAdmin();
  if (error) return error;
  try {
    const assignmentId = request.nextUrl.searchParams.get("assignmentId") || undefined;
    const result = await buildLinkProposals({ assignmentId });
    return NextResponse.json(result);
  } catch (e) {
    console.error("learning-loop links GET failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Kunde inte läsa förslag" }, { status: 500 });
  }
}

const applyBody = z.object({
  pairs: z.array(z.object({ assignmentId: z.string().min(1), adsetId: z.string().min(1) })).optional(),
  auto: z.boolean().optional(),
});

/** POST { pairs } = link these; { auto: true } = apply every high-confidence proposal. */
export async function POST(request: NextRequest) {
  const { session, error } = await guardAdmin();
  if (error) return error;
  const parsed = applyBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Ogiltig begäran" }, { status: 400 });
  try {
    if (parsed.data.auto) {
      const r = await autoLinkAll(session.user.id);
      return NextResponse.json(r);
    }
    const applied = await applyLinks(parsed.data.pairs ?? [], "manual", session.user.id);
    return NextResponse.json({ applied });
  } catch (e) {
    console.error("learning-loop links POST failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Kunde inte koppla" }, { status: 500 });
  }
}
