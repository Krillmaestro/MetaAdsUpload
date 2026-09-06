import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { asc } from "drizzle-orm";
import * as bcrypt from "bcryptjs";

// Superadmin only: everyone in the app and what they may use.
const cols = {
  id: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.users.role, userType: schema.users.userType,
  slug: schema.users.slug, isActive: schema.users.isActive, isFounder: schema.users.isFounder, isSuperadmin: schema.users.isSuperadmin,
  permissions: schema.users.permissions, hourlyRate: schema.users.hourlyRate, phone: schema.users.phone, createdAt: schema.users.createdAt,
};

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.user.isSuperadmin) return NextResponse.json({ error: "Superadmin only" }, { status: 403 });
  const people = await db.select(cols).from(schema.users).orderBy(asc(schema.users.role), asc(schema.users.name));
  return NextResponse.json(people);
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!session.user.isSuperadmin) return NextResponse.json({ error: "Superadmin only" }, { status: 403 });
    const { name, email, password, role = "editor", userType = "video_editor", permissions = null } = await request.json();
    if (!name || !email || !password) return NextResponse.json({ error: "Name, email and password are required" }, { status: 400 });
    if (!["admin", "editor"].includes(role)) return NextResponse.json({ error: "Role must be admin or editor" }, { status: 400 });
    if (password.length < 8 || !/[0-9]/.test(password) || !/[A-Z]/.test(password)) {
      return NextResponse.json({ error: "Password needs 8+ characters, a number and a capital letter" }, { status: 400 });
    }
    const [created] = await db.insert(schema.users).values({
      name: String(name).trim(), email: String(email).trim().toLowerCase(), password: await bcrypt.hash(password, 12), role, userType,
      permissions: Array.isArray(permissions) ? permissions : null,
      slug: String(name).trim().toLowerCase().replace(/[^a-z0-9åäö]+/g, "-").replace(/^-|-$/g, "") || null,
    }).returning(cols);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to create user";
    return NextResponse.json({ error: /unique|duplicate/i.test(msg) ? "That email or slug is already taken" : msg }, { status: 500 });
  }
}
