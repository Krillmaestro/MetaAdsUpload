import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { eq, and, ne } from "drizzle-orm";
import { GRANTABLE_AREAS } from "@/lib/access";

// PATCH /api/access/users/:id — role, type, flags, access. Superadmin only.
// You cannot lock yourself out, and the last superadmin stays superadmin.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!session.user.isSuperadmin) return NextResponse.json({ error: "Superadmin only" }, { status: 403 });
    const { id } = await params;
    const body = await request.json();
    const self = id === session.user.id;

    const patch: Partial<typeof schema.users.$inferInsert> = { updatedAt: new Date() };
    if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
    if (body.role !== undefined) {
      if (!["admin", "editor"].includes(body.role)) return NextResponse.json({ error: "Role must be admin or editor" }, { status: 400 });
      patch.role = body.role;
    }
    if (body.userType !== undefined) patch.userType = body.userType;
    if (body.hourlyRate !== undefined) patch.hourlyRate = body.hourlyRate === null ? null : Number(body.hourlyRate);
    if (body.phone !== undefined) patch.phone = body.phone || null;
    if (body.isFounder !== undefined) patch.isFounder = !!body.isFounder;
    if (body.isActive !== undefined) {
      if (self && !body.isActive) return NextResponse.json({ error: "You cannot deactivate yourself" }, { status: 400 });
      patch.isActive = !!body.isActive;
    }
    if (body.isSuperadmin !== undefined) {
      if (self && !body.isSuperadmin) return NextResponse.json({ error: "You cannot remove your own superadmin" }, { status: 400 });
      patch.isSuperadmin = !!body.isSuperadmin;
      if (patch.isSuperadmin) patch.role = body.role ?? "admin"; // a superadmin is always an admin too
    }
    if (body.permissions !== undefined) {
      if (body.permissions === null) patch.permissions = null;
      else if (Array.isArray(body.permissions)) {
        const valid = new Set(GRANTABLE_AREAS.map((a) => a.key));
        patch.permissions = body.permissions.filter((k: unknown): k is string => typeof k === "string" && valid.has(k));
      } else return NextResponse.json({ error: "permissions must be a list or null" }, { status: 400 });
    }

    if (patch.isSuperadmin === false) {
      const [other] = await db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.isSuperadmin, true), ne(schema.users.id, id))).limit(1);
      if (!other) return NextResponse.json({ error: "There must be at least one superadmin" }, { status: 400 });
    }

    const [updated] = await db.update(schema.users).set(patch).where(eq(schema.users.id, id)).returning({
      id: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.users.role, userType: schema.users.userType,
      slug: schema.users.slug, isActive: schema.users.isActive, isFounder: schema.users.isFounder, isSuperadmin: schema.users.isSuperadmin,
      permissions: schema.users.permissions, hourlyRate: schema.users.hourlyRate, phone: schema.users.phone, createdAt: schema.users.createdAt,
    });
    if (!updated) return NextResponse.json({ error: "User not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update user" }, { status: 500 });
  }
}
