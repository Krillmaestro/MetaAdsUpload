import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { eq, and, desc } from "drizzle-orm";
import { generateAutoName } from "@/lib/auto-name";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const userId = session.user.id;
    const userRole = session.user.role;

    const [assignment] = await db
      .select()
      .from(schema.assignments)
      .where(eq(schema.assignments.id, id));

    if (!assignment) {
      return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
    }

    if (userRole !== "admin" && assignment.assignedToId !== userId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Get time entries
    const timeEntries = await db
      .select()
      .from(schema.timeEntries)
      .where(eq(schema.timeEntries.assignmentId, id))
      .orderBy(desc(schema.timeEntries.startTime));

    const totalTrackedSeconds = timeEntries
      .filter(te => te.status === "completed")
      .reduce((sum, te) => sum + (te.durationSeconds || 0), 0);

    // Look up related names
    const [assignedTo, assignedBy, cs, angle, format, product, country, offerType, scriptStructure, problem] = await Promise.all([
      db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, assignment.assignedToId)).then(r => r[0]),
      db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, assignment.assignedById)).then(r => r[0]),
      assignment.creativeStrategistId
        ? db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, assignment.creativeStrategistId)).then(r => r[0])
        : null,
      assignment.angleId ? db.select().from(schema.angles).where(eq(schema.angles.id, assignment.angleId)).then(r => r[0]) : null,
      assignment.formatId ? db.select().from(schema.formats).where(eq(schema.formats.id, assignment.formatId)).then(r => r[0]) : null,
      assignment.productId ? db.select().from(schema.products).where(eq(schema.products.id, assignment.productId)).then(r => r[0]) : null,
      assignment.countryId ? db.select().from(schema.countries).where(eq(schema.countries.id, assignment.countryId)).then(r => r[0]) : null,
      assignment.offerTypeId ? db.select().from(schema.offerTypes).where(eq(schema.offerTypes.id, assignment.offerTypeId)).then(r => r[0]) : null,
      assignment.scriptStructureId ? db.select({ id: schema.scriptStructures.id, name: schema.scriptStructures.name }).from(schema.scriptStructures).where(eq(schema.scriptStructures.id, assignment.scriptStructureId)).then(r => r[0]) : null,
      assignment.problemId ? db.select({ id: schema.problems.id, name: schema.problems.name }).from(schema.problems).where(eq(schema.problems.id, assignment.problemId)).then(r => r[0]) : null,
    ]);

    return NextResponse.json({
      ...assignment,
      status: assignment.status.toUpperCase(),
      priority: assignment.priority.toUpperCase(),
      totalTrackedSeconds,
      timeEntries,
      assignedTo,
      assignedBy,
      creativeStrategist: cs,
      angle,
      format,
      product,
      country,
      offerType,
      scriptStructure,
      problem,
    });
  } catch (error) {
    console.error("Assignment GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch assignment" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const body = await request.json();

    // Allow creative strategists to update only strategistNotes
    if (session.user.role !== "admin") {
      if (body.strategistNotes !== undefined && Object.keys(body).length === 1) {
        const [current] = await db.select().from(schema.assignments).where(eq(schema.assignments.id, id));
        if (!current) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
        if (current.creativeStrategistId !== session.user.id) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const [updated] = await db
          .update(schema.assignments)
          .set({ strategistNotes: body.strategistNotes, updatedAt: new Date() })
          .where(eq(schema.assignments.id, id))
          .returning();
        return NextResponse.json(updated);
      }
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [current] = await db.select().from(schema.assignments).where(eq(schema.assignments.id, id));
    if (!current) {
      return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
    }

    const {
      batchNumber, version, formatId, angleId, productId, countryId,
      offerTypeId, scriptStructureId, customerAvatarIds, landingPage, assignedToId,
      creativeStrategistId, creativeStrategistName, priority, dueDate, estimatedMinutes,
      videoLengthSeconds, description, scriptContent, revisionFeedback,
      strategistNotes, briefContent, references,
      problemId, hypothesis, variableTested, adType, iterationOfId, awarenessLevel, publishTemplateId,
    } = body;

    // H2: Input validation — normalize priority to lowercase for DB
    const dbPriority = priority !== undefined ? priority.toLowerCase() : undefined;
    if (dbPriority !== undefined) {
      const validPriorities = ["low", "medium", "high", "urgent"];
      if (!validPriorities.includes(dbPriority)) {
        return NextResponse.json({ error: "Priority must be one of: low, medium, high, urgent" }, { status: 400 });
      }
    }
    if (batchNumber !== undefined && (!Number.isInteger(batchNumber) || batchNumber <= 0)) {
      return NextResponse.json({ error: "batchNumber must be a positive integer" }, { status: 400 });
    }
    if (estimatedMinutes !== undefined && estimatedMinutes !== null && (!Number.isInteger(estimatedMinutes) || estimatedMinutes <= 0)) {
      return NextResponse.json({ error: "estimatedMinutes must be a positive integer" }, { status: 400 });
    }
    if (description !== undefined && description !== null) {
      if (typeof description !== "string" || description.length > 5000) {
        return NextResponse.json({ error: "description must be a string (max 5000 chars)" }, { status: 400 });
      }
    }

    // H3: Strip status from PUT body - status should only be changed via /status endpoint
    if (body.status !== undefined) {
      return NextResponse.json({ error: "Status cannot be changed via PUT. Use the /status endpoint instead." }, { status: 400 });
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    if (batchNumber !== undefined) { updateData.batchNumber = batchNumber; updateData.title = `BATCH ${batchNumber}`; }
    if (version !== undefined) updateData.version = version;
    if (formatId !== undefined) updateData.formatId = formatId;
    if (angleId !== undefined) updateData.angleId = angleId;
    if (productId !== undefined) updateData.productId = productId;
    if (countryId !== undefined) updateData.countryId = countryId;
    if (offerTypeId !== undefined) updateData.offerTypeId = offerTypeId;
    if (scriptStructureId !== undefined) updateData.scriptStructureId = scriptStructureId;
    if (customerAvatarIds !== undefined) updateData.customerAvatarIds = customerAvatarIds;
    if (landingPage !== undefined) updateData.landingPage = landingPage;
    if (assignedToId !== undefined) updateData.assignedToId = assignedToId;
    if (creativeStrategistId !== undefined) updateData.creativeStrategistId = creativeStrategistId;
    if (creativeStrategistName !== undefined) updateData.creativeStrategistName = creativeStrategistName;
    if (dbPriority !== undefined) updateData.priority = dbPriority;
    if (dueDate !== undefined) updateData.dueDate = dueDate ? new Date(dueDate) : null;
    if (estimatedMinutes !== undefined) updateData.estimatedMinutes = estimatedMinutes;
    if (videoLengthSeconds !== undefined) updateData.videoLengthSeconds = videoLengthSeconds;
    if (description !== undefined) updateData.description = description;
    if (scriptContent !== undefined) updateData.scriptContent = scriptContent;
    if (briefContent !== undefined) updateData.briefContent = briefContent;
    if (references !== undefined) updateData.references = Array.isArray(references) ? references : [];
    if (revisionFeedback !== undefined) updateData.revisionFeedback = revisionFeedback;
    if (strategistNotes !== undefined) updateData.strategistNotes = strategistNotes;
    // Learning Loop fields
    if (problemId !== undefined) updateData.problemId = problemId || null;
    if (hypothesis !== undefined) updateData.hypothesis = hypothesis || null;
    if (variableTested !== undefined) updateData.variableTested = variableTested || null;
    if (adType !== undefined) updateData.adType = adType === "ideation" || adType === "iteration" ? adType : null;
    if (iterationOfId !== undefined) updateData.iterationOfId = iterationOfId || null;
    if (awarenessLevel !== undefined) updateData.awarenessLevel = awarenessLevel || null;
    if (publishTemplateId !== undefined) updateData.publishTemplateId = typeof publishTemplateId === "number" ? publishTemplateId : null;

    // Regenerate auto-name
    const autoName = await generateAutoName({
      batchNumber: batchNumber ?? current.batchNumber,
      formatId: formatId !== undefined ? formatId : current.formatId,
      angleId: angleId !== undefined ? angleId : current.angleId,
      productId: productId !== undefined ? productId : current.productId,
      countryId: countryId !== undefined ? countryId : current.countryId,
      offerTypeId: offerTypeId !== undefined ? offerTypeId : current.offerTypeId,
      scriptStructureId: scriptStructureId !== undefined ? scriptStructureId : current.scriptStructureId,
      landingPage: landingPage !== undefined ? landingPage : current.landingPage,
      assignedToId: assignedToId ?? current.assignedToId,
      creativeStrategistId: creativeStrategistId !== undefined ? creativeStrategistId : current.creativeStrategistId,
      creativeStrategistName: creativeStrategistName !== undefined ? creativeStrategistName : current.creativeStrategistName,
      videoLengthSeconds: videoLengthSeconds !== undefined ? videoLengthSeconds : current.videoLengthSeconds,
      createdAt: current.createdAt,
    });
    updateData.autoName = autoName;

    const [assignment] = await db
      .update(schema.assignments)
      .set(updateData)
      .where(eq(schema.assignments.id, id))
      .returning();

    return NextResponse.json(assignment);
  } catch (error) {
    console.error("Assignment PUT error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update assignment" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    // Unlink time entries
    await db
      .update(schema.timeEntries)
      .set({ assignmentId: null })
      .where(eq(schema.timeEntries.assignmentId, id));

    const deleted = await db.delete(schema.assignments).where(eq(schema.assignments.id, id)).returning({ id: schema.assignments.id });
    if (deleted.length === 0) {
      return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Assignment DELETE error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete assignment" },
      { status: 500 }
    );
  }
}
