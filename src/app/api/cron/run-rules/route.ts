import { NextRequest, NextResponse } from "next/server";
import { runAllRules } from "@/lib/rules/engine";

export async function POST(request: NextRequest) {
  // Allow both cron secret and direct invocation
  const authHeader = request.headers.get("authorization");
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  // For manual invocation from the UI, we'll allow it without the secret

  try {
    const results = await runAllRules();
    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error("Rules engine error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}
