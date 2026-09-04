// Deliverable files on an assignment — one row per file (hook), revisions
// replace files. Shared by the editor upload, the review page, the admin
// detail and the Upload-to-Meta step.
import { db, schema } from "@/db";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { deleteR2Objects } from "@/lib/r2";

export type DeliverableRow = typeof schema.deliverableVersions.$inferSelect;

export const FLAGGED = "needs_review"; // revision requested on this file
export const APPROVED = "approved";

/** "H2 SE Fervin Aug22 …mp4" → "H2". Null when the name has no hook label. */
export function hookLabelFromFilename(filename: string | null | undefined): string | null {
  const m = (filename ?? "").replace(/^\d{10,}-/, "").match(/^\s*(H\d+)(?![A-Za-z0-9])/i);
  return m ? m[1].toUpperCase() : null;
}

const hookOrder = (label: string | null) => (label ? parseInt(label.slice(1), 10) || 999 : 999);

/** Files that still exist: not replaced by a newer upload, not deleted. */
export async function listDeliverableFiles(assignmentId: string, opts: { all?: boolean } = {}) {
  const rows = await db
    .select()
    .from(schema.deliverableVersions)
    .where(
      opts.all
        ? eq(schema.deliverableVersions.assignmentId, assignmentId)
        : and(
            eq(schema.deliverableVersions.assignmentId, assignmentId),
            isNull(schema.deliverableVersions.replacedById),
            isNull(schema.deliverableVersions.deletedAt),
          ),
    )
    .orderBy(asc(schema.deliverableVersions.createdAt));
  return rows.sort(
    (a, b) => hookOrder(a.hookLabel) - hookOrder(b.hookLabel) || b.versionNumber - a.versionNumber || a.createdAt.getTime() - b.createdAt.getTime(),
  );
}

/** Root review comments per file, for the editor's to-do list and the revision text. */
export async function commentsByFile(versionIds: string[]) {
  const map = new Map<string, Array<{ id: string; timecodeSeconds: number | null; body: string; author: string; isResolved: boolean; createdAt: Date }>>();
  if (versionIds.length === 0) return map;
  const rows = await db
    .select({
      id: schema.reviewComments.id,
      versionId: schema.reviewComments.deliverableVersionId,
      timecodeSeconds: schema.reviewComments.timecodeSeconds,
      body: schema.reviewComments.body,
      guestName: schema.reviewComments.guestName,
      isResolved: schema.reviewComments.isResolved,
      createdAt: schema.reviewComments.createdAt,
      authorName: schema.users.name,
    })
    .from(schema.reviewComments)
    .leftJoin(schema.users, eq(schema.reviewComments.authorId, schema.users.id))
    .where(and(inArray(schema.reviewComments.deliverableVersionId, versionIds), isNull(schema.reviewComments.parentCommentId)))
    .orderBy(asc(schema.reviewComments.timecodeSeconds), asc(schema.reviewComments.createdAt));
  for (const r of rows) {
    const list = map.get(r.versionId) ?? [];
    list.push({ id: r.id, timecodeSeconds: r.timecodeSeconds, body: r.body, author: r.authorName || r.guestName || "Gäst", isResolved: r.isResolved, createdAt: r.createdAt });
    map.set(r.versionId, list);
  }
  return map;
}

export const formatTimecode = (s: number | null | undefined) => {
  if (s == null) return null;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

/** The revision message the editor gets: per flagged file, the note and the timecoded comments. */
export async function composeRevisionFeedback(assignmentId: string, extra?: string | null): Promise<{ text: string; flagged: DeliverableRow[] }> {
  const files = await listDeliverableFiles(assignmentId);
  const flagged = files.filter((f) => f.reviewStatus === FLAGGED);
  const comments = await commentsByFile(flagged.map((f) => f.id));
  const parts: string[] = [];
  if (extra?.trim()) parts.push(extra.trim());
  for (const f of flagged) {
    const head = `${f.hookLabel ?? f.filename} (v${f.versionNumber})${f.reviewNote ? ` – ${f.reviewNote.trim()}` : ""}`;
    const lines = (comments.get(f.id) ?? []).filter((c) => !c.isResolved).map((c) => `  ${c.timecodeSeconds != null ? formatTimecode(c.timecodeSeconds) + " – " : ""}${c.body.trim()}`);
    parts.push([head, ...lines].join("\n"));
  }
  return { text: parts.join("\n\n"), flagged };
}

export interface NewFileInput {
  r2Key: string;
  r2Url: string;
  filename: string;
  contentType?: string | null;
  fileSize?: number | null;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  thumbnailR2Key?: string | null;
  thumbnailUrl?: string | null;
  hookLabel?: string | null;
  /** Explicit "this replaces file X". */
  replacesId?: string | null;
}

/**
 * Register an uploaded file. In a revision, a file with the same hook label as
 * a flagged file replaces it (explicit replacesId always wins). The replaced
 * file is deleted from R2 — only the fixed one stays.
 */
export async function addDeliverableFile(
  assignment: typeof schema.assignments.$inferSelect,
  uploadedById: string,
  input: NewFileInput,
): Promise<{ version: DeliverableRow; replaced: DeliverableRow | null }> {
  const active = await listDeliverableFiles(assignment.id);
  const label = (input.hookLabel?.trim().toUpperCase() || hookLabelFromFilename(input.filename)) ?? null;

  let target: DeliverableRow | null = null;
  if (input.replacesId) {
    target = active.find((v) => v.id === input.replacesId) ?? null;
    if (!target) throw new Error("Filen som skulle ersättas finns inte längre");
  } else if (label) {
    // A flagged file with the same hook label is, by definition, what this
    // upload replaces — whatever status the assignment is in right now.
    target = active.find((v) => v.reviewStatus === FLAGGED && v.hookLabel === label) ?? null;
  }

  const [version] = await db
    .insert(schema.deliverableVersions)
    .values({
      assignmentId: assignment.id,
      versionNumber: target ? target.versionNumber + 1 : 1,
      r2Key: input.r2Key,
      r2Url: input.r2Url,
      filename: input.filename,
      contentType: input.contentType || "video/mp4",
      fileSize: input.fileSize ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      duration: input.duration ?? null,
      thumbnailR2Key: input.thumbnailR2Key ?? null,
      thumbnailUrl: input.thumbnailUrl ?? null,
      uploadedById,
      reviewStatus: "no_status",
      hookLabel: label ?? target?.hookLabel ?? null,
    })
    .returning();

  if (target) {
    await deleteR2Objects([target.r2Key, target.thumbnailR2Key]);
    await db
      .update(schema.deliverableVersions)
      .set({ replacedById: version.id, replacedAt: new Date(), deletedAt: new Date() })
      .where(eq(schema.deliverableVersions.id, target.id));
  }

  await db
    .update(schema.assignments)
    .set({ deliverableUrl: version.r2Url, deliverableR2Key: version.r2Key, currentVersionId: version.id, updatedAt: new Date() })
    .where(eq(schema.assignments.id, assignment.id));

  return { version, replaced: target };
}

/** Delete a file for good (R2 + tombstone). Keeps the row for comment history. */
export async function removeDeliverableFile(version: DeliverableRow): Promise<void> {
  await deleteR2Objects([version.r2Key, version.thumbnailR2Key]);
  await db
    .update(schema.deliverableVersions)
    .set({ deletedAt: new Date() })
    .where(eq(schema.deliverableVersions.id, version.id));
  // Point the assignment at another remaining file, or at nothing.
  const remaining = await listDeliverableFiles(version.assignmentId);
  const next = remaining[0] ?? null;
  await db
    .update(schema.assignments)
    .set({
      deliverableUrl: next?.r2Url ?? null,
      deliverableR2Key: next?.r2Key ?? null,
      currentVersionId: next?.id ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.assignments.id, version.assignmentId), sql`${schema.assignments.currentVersionId} = ${version.id} or ${schema.assignments.currentVersionId} is null`));
}

/** Approve every file that nobody has reviewed yet (the admin approved the assignment as a whole). */
export async function approveUnreviewed(assignmentId: string): Promise<number> {
  const rows = await db
    .update(schema.deliverableVersions)
    .set({ reviewStatus: APPROVED })
    .where(and(
      eq(schema.deliverableVersions.assignmentId, assignmentId),
      isNull(schema.deliverableVersions.replacedById),
      isNull(schema.deliverableVersions.deletedAt),
      sql`${schema.deliverableVersions.reviewStatus} in ('no_status', 'in_progress')`,
    ))
    .returning({ id: schema.deliverableVersions.id });
  return rows.length;
}
