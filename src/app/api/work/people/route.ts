import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq, asc } from "drizzle-orm";
import { guardFounder } from "@/lib/work-tracker";

// GET /api/work/people — the founders whose time shows up in the tracker
export async function GET() {
  const { error } = await guardFounder();
  if (error) return error;

  const rows = await db
    .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.isFounder, true))
    .orderBy(asc(schema.users.name));

  return NextResponse.json(rows);
}
