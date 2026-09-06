import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { canAccessPath, canCallApi, hasCustomAccess, homeFor } from "@/lib/access";

// Pages: every route belongs to an area (src/lib/access.ts); a person may
// open it when their role default, custom access or flags include that area.
// APIs guard themselves; people with custom access are additionally limited
// to the APIs of their areas here.
export default auth((req) => {
  const { pathname } = req.nextUrl;
  const user = req.auth?.user as { role?: string; isFounder?: boolean; isSuperadmin?: boolean; permissions?: string[] | null } | undefined;

  if (pathname.startsWith("/api")) {
    if (user && hasCustomAccess(user) && !canCallApi(user, pathname)) {
      return NextResponse.json({ error: "Du har inte tillgång till den här delen" }, { status: 403 });
    }
    return NextResponse.next();
  }

  if (req.auth && user && !canAccessPath(user, pathname)) {
    return NextResponse.redirect(new URL(homeFor(user), req.nextUrl));
  }
  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!login|register|api/auth|_next/static|_next/image|favicon.ico).*)",
  ],
};
