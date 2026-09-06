import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { encryptSecret } from "@/lib/crypto";
import { invalidateAccountCache } from "@/lib/meta/client";
import { fetchAdAccountsAndPages } from "@/lib/meta/assets";
import { isElevated } from "@/lib/access";

export async function GET(request: NextRequest) {
  // C4: Auth + admin role check
  const session = await auth();
  if (!session?.user) return NextResponse.redirect(new URL("/login", request.url));
  if (!isElevated(session.user)) return NextResponse.redirect(new URL("/settings?error=forbidden", request.url));

  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(new URL("/settings?error=oauth_denied", request.url));
  }

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const rawBase = process.env.NEXTAUTH_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  const baseUrl = rawBase.replace(/\/+$/, "");
  const redirectUri = `${baseUrl}/api/meta/callback`;

  try {
    // Exchange code for short-lived token
    const tokenRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`
    );
    const tokenData = await tokenRes.json();

    if (tokenData.error) {
      throw new Error(tokenData.error.message);
    }

    // Exchange for long-lived token (60 days)
    const longRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${tokenData.access_token}`
    );
    const longData = await longRes.json();
    const accessToken = longData.access_token || tokenData.access_token;
    const expiresIn = longData.expires_in || tokenData.expires_in;

    // Get user info
    const meRes = await fetch(
      `https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${accessToken}`
    );
    const meData = await meRes.json();

    // Get ad accounts + pages (paginated — never cap at the first 50)
    const { adAccounts, pages } = await fetchAdAccountsAndPages(accessToken);

    // Deactivate existing connections
    await db.update(schema.metaConnections).set({ isActive: false });

    // Save new connection
    await db.insert(schema.metaConnections).values({
      name: meData.name || "Meta Account",
      accessToken: encryptSecret(accessToken),
      tokenExpiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
      facebookUserId: meData.id,
      adAccounts,
      activeAdAccountId: adAccounts[0]?.id || null,
      pages,
      activePageId: pages[0]?.id || null,
      isActive: true,
    });
    invalidateAccountCache();

    return NextResponse.redirect(new URL("/settings?success=connected", request.url));
  } catch (err) {
    console.error("Meta OAuth error:", err);
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.redirect(new URL(`/settings?error=${encodeURIComponent(errorMsg)}`, request.url));
  }
}
