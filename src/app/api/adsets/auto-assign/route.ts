import { NextRequest, NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { getAdSets } from "@/lib/meta/adsets";
import { withAdAccount } from "@/lib/meta/client";
import { parseAdsetName, type ParsedAdsetName } from "@/lib/adset-name";

export const dynamic = "force-dynamic";

/**
 * Auto-assign ad sets from their names.
 *
 * GET  = dry run. Returns what WOULD change, grouped by how safe it is.
 * POST = apply the proposals you send back.
 *
 * Two rules keep this from doing damage:
 *
 *  1. A field a human set is never overwritten. `autoFields` records what the
 *     parser wrote last time; anything outside that list belongs to a person.
 *     Disagreements are surfaced as conflicts for a human to resolve, never
 *     applied silently — a wrong editor assignment pays the wrong person.
 *  2. The parser returns null rather than guessing, so a field it could not
 *     read simply produces no proposal.
 */

type Kind = "fill" | "conflict" | "unchanged" | "unparsed";

type Proposal = {
  adsetId: string;
  adsetName: string;
  campaignId: string | null;
  kind: Kind;
  parsed: ParsedAdsetName;
  /** Field → { from, to }. Only fields that would actually change. */
  changes: Record<string, { from: string | null; to: string | null }>;
  /** Human-readable editor names, for the preview table. */
  editorFrom: string | null;
  editorTo: string | null;
};

const FIELDS = ["videoEditorId", "format", "landing", "problem", "country", "batch"] as const;
type Field = (typeof FIELDS)[number];

function landingText(p: ParsedAdsetName): string | null {
  return p.landing.length ? p.landing.join(" + ") : null;
}

/** Everything the parser proposes for one ad set, as column values. */
function proposedValues(p: ParsedAdsetName, editorId: string | null): Record<Field, string | null> {
  return {
    videoEditorId: editorId,
    format: p.format,
    landing: landingText(p),
    problem: p.problem,
    country: p.country,
    batch: p.batch,
  };
}

async function buildProposals(account: string | undefined) {
  const editors = await db
    .select({ id: schema.users.id, name: schema.users.name, userType: schema.users.userType })
    .from(schema.users);
  const videoEditors = editors.filter((e) => e.userType === "video_editor");
  const editorNames = videoEditors.map((e) => e.name);
  const idByName = new Map(videoEditors.map((e) => [e.name.toLowerCase(), e.id]));
  const nameById = new Map(editors.map((e) => [e.id, e.name]));

  const adsets = await withAdAccount(account, () => getAdSets(undefined, 500));

  const existing = adsets.length
    ? await db
        .select()
        .from(schema.adsetOwners)
        .where(inArray(schema.adsetOwners.adsetId, adsets.map((a) => a.id)))
    : [];
  const ownerByAdset = new Map(existing.map((o) => [o.adsetId, o]));

  const proposals: Proposal[] = [];

  for (const adset of adsets) {
    const parsed = parseAdsetName(adset.name ?? "", editorNames);
    const owner = ownerByAdset.get(adset.id);
    const auto = new Set(owner?.autoFields ?? []);
    const editorId = parsed.editor ? idByName.get(parsed.editor.toLowerCase()) ?? null : null;
    const want = proposedValues(parsed, editorId);

    const changes: Proposal["changes"] = {};
    let conflict = false;

    for (const field of FIELDS) {
      const next = want[field];
      if (next === null) continue; // parser read nothing — never clears a value
      const currentRaw = owner ? (owner as Record<string, unknown>)[field] : null;
      const current = typeof currentRaw === "string" && currentRaw ? currentRaw : null;
      if (current === next) continue;

      if (current !== null && !auto.has(field)) {
        // A human put something else here. Report it; do not overwrite.
        conflict = true;
        changes[field] = { from: current, to: next };
        continue;
      }
      changes[field] = { from: current, to: next };
    }

    const kind: Kind = parsed.unparsed
      ? "unparsed"
      : conflict
        ? "conflict"
        : Object.keys(changes).length
          ? "fill"
          : "unchanged";

    proposals.push({
      adsetId: adset.id,
      adsetName: adset.name ?? "",
      campaignId: adset.campaign_id ?? null,
      kind,
      parsed,
      changes,
      editorFrom: owner?.videoEditorId ? nameById.get(owner.videoEditorId) ?? null : null,
      editorTo: parsed.editor,
    });
  }

  return { proposals, videoEditors };
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const account = request.nextUrl.searchParams.get("account") || undefined;
    const { proposals } = await buildProposals(account);

    const counts = proposals.reduce<Record<Kind, number>>(
      (acc, p) => ({ ...acc, [p.kind]: acc[p.kind] + 1 }),
      { fill: 0, conflict: 0, unchanged: 0, unparsed: 0 }
    );

    return NextResponse.json({
      account: account ?? null,
      total: proposals.length,
      counts,
      // Unchanged rows are noise in a review UI — the counts still report them.
      proposals: proposals.filter((p) => p.kind === "fill" || p.kind === "conflict"),
    });
  } catch (error) {
    console.error("auto-assign preview failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Kunde inte läsa ad sets" },
      { status: 500 }
    );
  }
}

const applySchema = z.object({
  account: z.string().optional(),
  /** Ad set IDs to apply. Omit to apply every safe fill (never conflicts). */
  adsetIds: z.array(z.string()).optional(),
  /** Apply conflicts too — the name wins over the manual value. Explicit only. */
  includeConflicts: z.boolean().default(false),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const parsedBody = applySchema.safeParse(body ?? {});
  if (!parsedBody.success) {
    return NextResponse.json({ error: "Ogiltig begäran" }, { status: 400 });
  }
  const { account, adsetIds, includeConflicts } = parsedBody.data;

  try {
    const { proposals } = await buildProposals(account);
    const wanted = adsetIds?.length ? new Set(adsetIds) : null;

    const targets = proposals.filter((p) => {
      if (wanted && !wanted.has(p.adsetId)) return false;
      if (p.kind === "fill") return true;
      return p.kind === "conflict" && includeConflicts;
    });

    let applied = 0;
    for (const p of targets) {
      const fields = Object.keys(p.changes) as Field[];
      if (!fields.length) continue;

      const values: Record<string, unknown> = { updatedAt: new Date(), autoAssignedAt: new Date() };
      for (const f of fields) values[f] = p.changes[f].to;

      const [existing] = await db
        .select({ autoFields: schema.adsetOwners.autoFields })
        .from(schema.adsetOwners)
        .where(eq(schema.adsetOwners.adsetId, p.adsetId))
        .limit(1);

      // Remember what the parser owns, so the next run may update these again
      // while leaving anything a human typed alone.
      values.autoFields = Array.from(new Set([...(existing?.autoFields ?? []), ...fields]));

      if (existing) {
        await db.update(schema.adsetOwners).set(values).where(eq(schema.adsetOwners.adsetId, p.adsetId));
      } else {
        await db.insert(schema.adsetOwners).values({
          adsetId: p.adsetId,
          adsetName: p.adsetName,
          campaignId: p.campaignId,
          source: "auto",
          assignedById: session.user.id,
          ...values,
        });
      }
      applied++;
    }

    return NextResponse.json({ applied, skipped: proposals.length - applied });
  } catch (error) {
    console.error("auto-assign apply failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Kunde inte spara" },
      { status: 500 }
    );
  }
}
