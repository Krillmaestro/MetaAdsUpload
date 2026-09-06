import { NextResponse } from "next/server";
import { auth } from "@/auth";
import type { Session } from "next-auth";
import { isElevated } from "@/lib/access";

export async function getSession() {
  return await auth();
}

export async function requireAuth() {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Unauthorized");
  }
  return session;
}

export async function requireAdmin() {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Unauthorized");
  }
  if (!isElevated(session.user)) {
    throw new Error("Forbidden: admin access required");
  }
  return session;
}

/**
 * Guard helper for API routes — returns a NextResponse error if auth fails,
 * or null if the session is valid. Avoids try/catch boilerplate.
 */
export async function guardAdmin(): Promise<{ session: Session; error: null } | { session: null; error: NextResponse }> {
  const session = await auth() as Session | null;
  if (!session?.user) {
    return { session: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!isElevated(session.user)) {
    return { session: null, error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session, error: null };
}
