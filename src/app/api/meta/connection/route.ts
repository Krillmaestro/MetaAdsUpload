import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    const connections = await db.select().from(schema.metaConnections).orderBy(schema.metaConnections.createdAt);
    const active = connections.find((c) => c.isActive);
    return NextResponse.json({
      connections: connections.map((c) => ({
        id: c.id,
        name: c.name,
        facebookUserId: c.facebookUserId,
        adAccounts: c.adAccounts,
        activeAdAccountId: c.activeAdAccountId,
        pages: c.pages,
        activePageId: c.activePageId,
        pixelId: c.pixelId,
        isActive: c.isActive,
        tokenExpiresAt: c.tokenExpiresAt,
        createdAt: c.createdAt,
      })),
      active: active ? {
        id: active.id,
        name: active.name,
        activeAdAccountId: active.activeAdAccountId,
        activePageId: active.activePageId,
        pixelId: active.pixelId,
      } : null,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, activeAdAccountId, activePageId, pixelId, isActive } = body;

    if (!id) return NextResponse.json({ error: "Missing connection ID" }, { status: 400 });

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (activeAdAccountId !== undefined) updates.activeAdAccountId = activeAdAccountId;
    if (activePageId !== undefined) updates.activePageId = activePageId;
    if (pixelId !== undefined) updates.pixelId = pixelId;
    if (isActive !== undefined) {
      // If activating this one, deactivate others
      if (isActive) {
        await db.update(schema.metaConnections).set({ isActive: false });
      }
      updates.isActive = isActive;
    }

    await db.update(schema.metaConnections).set(updates).where(eq(schema.metaConnections.id, id));
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json();
    await db.delete(schema.metaConnections).where(eq(schema.metaConnections.id, id));
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}
