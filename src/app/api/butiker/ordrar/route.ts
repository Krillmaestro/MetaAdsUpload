import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isElevated } from "@/lib/access";
import { db, schema } from "@/db";
import { desc } from "drizzle-orm";
import { orderFields } from "./body";

export const dynamic = "force-dynamic";

/** Every B2B order, newest first. Totals are computed on the page from the frozen lines. */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const O = schema.b2bOrders;
    const orders = await db.select().from(O).orderBy(desc(O.orderDate), desc(O.createdAt));
    return NextResponse.json({ orders });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Kunde inte läsa ordrarna" }, { status: 500 });
  }
}

/** Register an order. */
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const who = session.user.name ?? session.user.email ?? null;

    const f = orderFields(await request.json());
    if (!f.customerName) return NextResponse.json({ error: "Ange kundens namn" }, { status: 400 });
    if (!f.orderDate) return NextResponse.json({ error: "Ange orderdatum (ÅÅÅÅ-MM-DD)" }, { status: 400 });
    if (!Array.isArray(f.lines) || !(f.lines as unknown[]).length) return NextResponse.json({ error: "Ordern behöver minst en rad" }, { status: 400 });

    const [row] = await db.insert(schema.b2bOrders)
      .values({ ...(f as typeof schema.b2bOrders.$inferInsert), createdBy: who })
      .returning();
    return NextResponse.json({ saved: true, order: row });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Kunde inte spara ordern" }, { status: 500 });
  }
}
