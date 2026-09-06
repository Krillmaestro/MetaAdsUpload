import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import * as bcrypt from "bcryptjs";

// POST /api/access/users/:id/password { password } — set a new password. Superadmin only.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!session.user.isSuperadmin) return NextResponse.json({ error: "Superadmin only" }, { status: 403 });
    const { id } = await params;
    const { password } = await request.json();
    if (typeof password !== "string" || password.length < 8 || !/[0-9]/.test(password) || !/[A-Z]/.test(password)) {
      return NextResponse.json({ error: "Password needs 8+ characters, a number and a capital letter" }, { status: 400 });
    }
    const [updated] = await db.update(schema.users).set({ password: await bcrypt.hash(password, 12), updatedAt: new Date() }).where(eq(schema.users.id, id)).returning({ id: schema.users.id });
    if (!updated) return NextResponse.json({ error: "User not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to set password" }, { status: 500 });
  }
}
