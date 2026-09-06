import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isElevated } from "@/lib/access";

export async function GET() {
  // C4: Auth + admin role check
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const appId = process.env.META_APP_ID;
  if (!appId) {
    return NextResponse.json({ error: "META_APP_ID not configured" }, { status: 500 });
  }

  const rawBase = process.env.NEXTAUTH_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  const baseUrl = rawBase.replace(/\/+$/, "");
  const redirectUri = `${baseUrl}/api/meta/callback`;

  const scopes = [
    "ads_management",
    "ads_read",
    "business_management",
    "pages_read_engagement",
    "pages_show_list",
  ].join(",");

  const url = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&response_type=code`;

  return NextResponse.redirect(url);
}
