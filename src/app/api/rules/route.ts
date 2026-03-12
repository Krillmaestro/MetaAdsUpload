import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    const rules = await db.select().from(schema.automationRules).orderBy(schema.automationRules.createdAt);
    const executions = await db.select().from(schema.ruleExecutions).orderBy(schema.ruleExecutions.executedAt);
    return NextResponse.json({ rules, executions });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const [rule] = await db.insert(schema.automationRules).values({
      name: body.name,
      level: body.level,
      conditions: body.conditions,
      action: body.action,
      cooldownHours: body.cooldownHours || 24,
      enabled: body.enabled ?? true,
    }).returning();
    return NextResponse.json(rule);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;
    await db.update(schema.automationRules).set({ ...updates, updatedAt: new Date() }).where(eq(schema.automationRules.id, id));
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json();
    await db.delete(schema.automationRules).where(eq(schema.automationRules.id, id));
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}
