import { auth } from "@/auth";
import { NextResponse } from "next/server";

// Pages a non-admin (video editor / strategist without admin) may visit.
// Everything else redirects to /my-work. APIs guard themselves.
const EDITOR_PAGE_PREFIXES = ["/my-work", "/timer", "/review", "/e/", "/r/"];

// Founders (co-founder may hold a non-admin role) additionally reach the founder pages.
const FOUNDER_PAGE_PREFIXES = ["/time", "/logrocket", "/tasks"];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api")) return NextResponse.next();

  const user = req.auth?.user as { role?: string; isFounder?: boolean } | undefined;
  const role = user?.role;
  if (req.auth && role && role !== "admin") {
    if (user?.isFounder && FOUNDER_PAGE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      return NextResponse.next();
    }
    const allowed = EDITOR_PAGE_PREFIXES.some(
      (p) => pathname === p || pathname === p.replace(/\/$/, "") || pathname.startsWith(p)
    );
    if (!allowed) {
      return NextResponse.redirect(new URL("/my-work", req.nextUrl));
    }
  }
  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!login|register|api/auth|_next/static|_next/image|favicon.ico).*)",
  ],
};
