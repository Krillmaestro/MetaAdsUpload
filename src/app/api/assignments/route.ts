import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { eq, and, sql, desc, asc, inArray } from "drizzle-orm";
import { notifyAssignmentEvent } from "@/lib/notifications";
import { generateAutoName } from "@/lib/auto-name";
import { checkRateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = request.nextUrl;
    const status = searchParams.get("status");
    const priority = searchParams.get("priority");
    const assignedToId = searchParams.get("assignedToId");
    const formatId = searchParams.get("formatId");
    const productId = searchParams.get("productId");

    const userId = session.user.id;
    const userRole = session.user.role;

    const conditions = [];

    // Non-admins can only see their own assignments
    if (userRole !== "admin") {
      conditions.push(eq(schema.assignments.assignedToId, userId));
    } else if (assignedToId) {
      conditions.push(eq(schema.assignments.assignedToId, assignedToId));
    }

    if (status) conditions.push(eq(schema.assignments.status, status.toLowerCase()));
    if (priority) conditions.push(eq(schema.assignments.priority, priority.toLowerCase()));
    if (formatId) conditions.push(eq(schema.assignments.formatId, formatId));
    if (productId) conditions.push(eq(schema.assignments.productId, productId));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const assignments = await db
      .select()
      .from(schema.assignments)
      .where(whereClause)
      .orderBy(
        asc(schema.assignments.priority),
        asc(schema.assignments.dueDate),
        desc(schema.assignments.createdAt)
      );

    // Get total tracked seconds for each assignment
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

    // Look up related entity names for each assignment
    const [allUsers, allAngles, allFormats, allProducts, allCountries, allOfferTypes, allScriptStructures, allProblems] = await Promise.all([
      db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email }).from(schema.users),
      db.select({ id: schema.angles.id, name: schema.angles.name }).from(schema.angles),
      db.select({ id: schema.formats.id, name: schema.formats.name }).from(schema.formats),
      db.select({ id: schema.products.id, name: schema.products.name, code: schema.products.code }).from(schema.products),
      db.select({ id: schema.countries.id, name: schema.countries.name, code: schema.countries.code }).from(schema.countries),
      db.select({ id: schema.offerTypes.id, name: schema.offerTypes.name }).from(schema.offerTypes),
      db.select({ id: schema.scriptStructures.id, name: schema.scriptStructures.name }).from(schema.scriptStructures),
      db.select({ id: schema.problems.id, name: schema.problems.name }).from(schema.problems),
    ]);

    const problemMap = new Map(allProblems.map(p => [p.id, p]));
    const userMap = new Map(allUsers.map(u => [u.id, u]));
    const angleMap = new Map(allAngles.map(a => [a.id, a]));
    const formatMap = new Map(allFormats.map(f => [f.id, f]));
    const productMap = new Map(allProducts.map(p => [p.id, p]));
    const countryMap = new Map(allCountries.map(c => [c.id, c]));
    const offerTypeMap = new Map(allOfferTypes.map(o => [o.id, o]));
    const scriptStructureMap = new Map(allScriptStructures.map(s => [s.id, s]));

    const enriched = assignments.map(a => ({
      ...a,
      status: a.status.toUpperCase(),
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
      scriptStructure: a.scriptStructureId ? scriptStructureMap.get(a.scriptStructureId) || null : null,
      problem: a.problemId ? problemMap.get(a.problemId) || null : null,
    }));

    return NextResponse.json(enriched);
  } catch (error) {
    console.error("Assignments GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch assignments" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = checkRateLimit(request, 20, 60_000);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const userId = session.user.id;
    const body = await request.json();
    const {
      isDraft,
      batchNumber,
      version = 1,
      formatId,
      angleId,
      productId,
      countryId,
      offerTypeId,
      scriptStructureId,
      customerAvatarIds = [],
      landingPage,
      assignedToId,
      creativeStrategistId,
      creativeStrategistName,
      priority = "medium",
      dueDate,
      estimatedMinutes,
      description,
      scriptContent,
      briefContent,
      references,
      problemId,
      hypothesis,
      variableTested,
      adType,
      iterationOfId,
      awarenessLevel,
      publishTemplateId,
    } = body;

    // ─── Draft creation: instant empty assignment ───
    if (isDraft) {
      const now = new Date();
      const [assignment] = await db
        .insert(schema.assignments)
        .values({
          title: "Draft",
          description: null,
          batchNumber: 0,
          version: 1,
          formatId: null,
          angleId: null,
          productId: null,
          countryId: null,
          offerTypeId: null,
          scriptStructureId: null,
          customerAvatarIds: [],
          landingPage: null,
          assignedToId: userId,
          assignedById: userId,
          creativeStrategistId: null,
          creativeStrategistName: null,
          status: "draft",
          priority: "medium",
          dueDate: null,
          estimatedMinutes: null,
          scriptContent: null,
          autoName: "Draft",
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      return NextResponse.json(assignment, { status: 201 });
    }

    // ─── Normal creation with validation ───
    if (!batchNumber || !assignedToId) {
      return NextResponse.json({ error: "Batch number and assignedToId are required" }, { status: 400 });
    }

    // H2: Input validation — normalize priority to lowercase for DB
    const dbPriority = priority.toLowerCase();
    const validPriorities = ["low", "medium", "high", "urgent"];
    if (!validPriorities.includes(dbPriority)) {
      return NextResponse.json({ error: "Priority must be one of: low, medium, high, urgent" }, { status: 400 });
    }
    if (!Number.isInteger(batchNumber) || batchNumber <= 0) {
      return NextResponse.json({ error: "batchNumber must be a positive integer" }, { status: 400 });
    }
    if (estimatedMinutes !== undefined && (!Number.isInteger(estimatedMinutes) || estimatedMinutes <= 0)) {
      return NextResponse.json({ error: "estimatedMinutes must be a positive integer" }, { status: 400 });
    }
    if (description !== undefined) {
      if (typeof description !== "string" || description.length > 5000) {
        return NextResponse.json({ error: "description must be a string (max 5000 chars)" }, { status: 400 });
      }
    }

    // Verify editor exists
    const editor = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, assignedToId));
    if (editor.length === 0) {
      return NextResponse.json({ error: "Assigned editor not found" }, { status: 400 });
    }

    const now = new Date();
    const autoName = await generateAutoName({
      batchNumber,
      formatId: formatId || null,
      angleId: angleId || null,
      productId: productId || null,
      countryId: countryId || null,
      offerTypeId: offerTypeId || null,
      scriptStructureId: scriptStructureId || null,
      landingPage: landingPage || null,
      assignedToId,
      creativeStrategistId: creativeStrategistId || null,
      creativeStrategistName: creativeStrategistName || null,
      videoLengthSeconds: null,
      createdAt: now,
    });

    const [assignment] = await db
      .insert(schema.assignments)
      .values({
        title: `BATCH ${batchNumber}`,
        description: description || null,
        batchNumber,
        version,
        formatId: formatId || null,
        angleId: angleId || null,
        productId: productId || null,
        countryId: countryId || null,
        offerTypeId: offerTypeId || null,
        scriptStructureId: scriptStructureId || null,
        customerAvatarIds,
        landingPage: landingPage || null,
        assignedToId,
        assignedById: userId,
        creativeStrategistId: creativeStrategistId || null,
        creativeStrategistName: creativeStrategistName || null,
        status: "ready_for_editing",
        priority: dbPriority,
        dueDate: dueDate ? new Date(dueDate) : null,
        estimatedMinutes: estimatedMinutes || null,
        scriptContent: scriptContent || null,
        briefContent: typeof briefContent === "string" ? briefContent : null,
        references: Array.isArray(references) ? references : [],
        problemId: problemId || null,
        hypothesis: typeof hypothesis === "string" ? hypothesis : null,
        variableTested: typeof variableTested === "string" ? variableTested : null,
        adType: adType === "ideation" || adType === "iteration" ? adType : null,
        iterationOfId: iterationOfId || null,
        awarenessLevel: typeof awarenessLevel === "string" && awarenessLevel ? awarenessLevel : null,
        publishTemplateId: typeof publishTemplateId === "number" ? publishTemplateId : null,
        autoName,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Fire-and-forget WhatsApp notification to the assigned editor
    void notifyAssignmentEvent("assigned", assignment);

    return NextResponse.json(assignment, { status: 201 });
  } catch (error) {
    console.error("Assignments POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create assignment" },
      { status: 500 }
    );
  }
}
