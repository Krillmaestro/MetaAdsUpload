import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isElevated } from "@/lib/access";
import { parseKonsidoReport, saveReport } from "@/lib/lager/report";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Upload a Konsido stock report (PDF). Its printed time becomes the new stock anchor. */
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Välj en PDF" }, { status: 400 });

    const report = await parseKonsidoReport(new Uint8Array(await file.arrayBuffer()));
    const saved = await saveReport(report, session.user.name ?? session.user.email ?? null);
    return NextResponse.json({ saved: true, ...saved });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Kunde inte läsa rapporten" },
      { status: 500 }
    );
  }
}
