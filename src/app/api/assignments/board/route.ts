import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { eq, and, sql, desc, asc, inArray } from "drizzle-orm";

const STATUS_KEYS = [
  "DRAFT",
  "READY_FOR_EDITING",
  "EDITING_NOW",
  "READY_FOR_REVIEW",
  "REVISION",
  "READY_FOR_POSTING",
  "POSTED",
] as const;

// Map lowercase DB values to uppercase frontend keys
function toUpperStatus(dbStatus: string): string {
  return dbStatus.toUpperCase();
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { searchParams } = request.nextUrl;
    const assignedToId = searchParams.get("assignedToId");
    const formatId = searchParams.get("formatId");
    const productId = searchParams.get("productId");
    const priority = searchParams.get("priority");

    const conditions = [];
    if (assignedToId) conditions.push(eq(schema.assignments.assignedToId, assignedToId));
    if (formatId) conditions.push(eq(schema.assignments.formatId, formatId));
    if (productId) conditions.push(eq(schema.assignments.productId, productId));
    if (priority) conditions.push(eq(schema.assignments.priority, priority.toLowerCase()));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const assignments = await db
      .select()
      .from(schema.assignments)
      .where(whereClause)
      .orderBy(asc(schema.assignments.priority), asc(schema.assignments.dueDate), desc(schema.assignments.createdAt));

    // Get time sums
    const assignmentIds = assignments.map(a => a.id);
    const timeMap = new Map<string, number>();

    if (assignmentIds.length > 0) {
      const timeSums = await db
        .select({
          assignmentId: schema.timeEntries.assignmentId,
          total: sql<number>`coalesce(sum(${schema.timeEntries.durationSeconds}), 0)`,
        })
        .from(schema.timeEntries)
        .where(
          and(
            eq(schema.timeEntries.status, "completed"),
            inArray(schema.timeEntries.assignmentId, assignmentIds)
          )
        )
        .groupBy(schema.timeEntries.assignmentId);

      for (const ts of timeSums) {
        if (ts.assignmentId) timeMap.set(ts.assignmentId, ts.total);
      }
    }

    // Look up related entities
    const [allUsers, allAngles, allFormats, allProducts, allCountries, allOfferTypes, allProblems, linkRows] = await Promise.all([
      db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email }).from(schema.users),
      db.select({ id: schema.angles.id, name: schema.angles.name }).from(schema.angles),
      db.select({ id: schema.formats.id, name: schema.formats.name }).from(schema.formats),
      db.select({ id: schema.products.id, name: schema.products.name, code: schema.products.code }).from(schema.products),
      db.select({ id: schema.countries.id, name: schema.countries.name, code: schema.countries.code }).from(schema.countries),
      db.select({ id: schema.offerTypes.id, name: schema.offerTypes.name }).from(schema.offerTypes),
      db.select({ id: schema.problems.id, name: schema.problems.name }).from(schema.problems),
      db.select({ assignmentId: schema.adsetOwners.assignmentId, n: sql<number>`count(*)` })
        .from(schema.adsetOwners)
        .where(sql`${schema.adsetOwners.assignmentId} is not null`)
        .groupBy(schema.adsetOwners.assignmentId),
    ]);

    const problemMap = new Map(allProblems.map(p => [p.id, p]));
    const linkedAdsets = new Map(linkRows.map(r => [r.assignmentId as string, Number(r.n) || 0]));
    const userMap = new Map(allUsers.map(u => [u.id, u]));
    const angleMap = new Map(allAngles.map(a => [a.id, a]));
    const formatMap = new Map(allFormats.map(f => [f.id, f]));
    const productMap = new Map(allProducts.map(p => [p.id, p]));
    const countryMap = new Map(allCountries.map(c => [c.id, c]));
    const offerTypeMap = new Map(allOfferTypes.map(o => [o.id, o]));

    // Build board with UPPERCASE keys
    const board: Record<string, unknown[]> = {};
    for (const key of STATUS_KEYS) {
      board[key] = [];
    }

    for (const a of assignments) {
      const upperStatus = toUpperStatus(a.status);
      const enriched = {
        ...a,
        status: upperStatus,
        priority: a.priority.toUpperCase(),
        totalTrackedSeconds: timeMap.get(a.id) || 0,
        assignedTo: userMap.get(a.assignedToId) || { id: a.assignedToId, name: "Unknown", email: "" },
        assignedBy: userMap.get(a.assignedById) || { id: a.assignedById, name: "Unknown", email: "" },
        creativeStrategist: a.creativeStrategistId ? userMap.get(a.creativeStrategistId) || null : null,
        angle: a.angleId ? angleMap.get(a.angleId) || null : null,
        format: a.formatId ? formatMap.get(a.formatId) || null : null,
        product: a.productId ? productMap.get(a.productId) || null : null,
        country: a.countryId ? countryMap.get(a.countryId) || null : null,
        offerType: a.offerTypeId ? offerTypeMap.get(a.offerTypeId) || null : null,
        problem: a.problemId ? problemMap.get(a.problemId) || null : null,
        linkedAdsets: linkedAdsets.get(a.id) ?? (a.metaAdsetId ? 1 : 0),
      };
      if (upperStatus in board) {
        board[upperStatus].push(enriched);
      }
    }

    return NextResponse.json(board);
  } catch (error) {
    console.error("Board GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch board" },
      { status: 500 }
    );
  }
}
