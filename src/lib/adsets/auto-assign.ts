import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { getAdSets } from "@/lib/meta/adsets";
import { withAdAccount } from "@/lib/meta/client";
import { parseAdsetName, type ParsedAdsetName } from "@/lib/adset-name";

// Shared by the review dialog (/api/adsets/auto-assign) and the nightly sync,
// so a scheduled run can never diverge from what the preview showed.
//
// Two rules, enforced here rather than at each call site:
//
//  1. A field a human set is never overwritten. `autoFields` records which
//     columns the parser last wrote; anything outside that list belongs to a
//     person and is reported as a conflict instead. A wrong editor assignment
//     silently pays the wrong person, so this never resolves itself.
//  2. The parser returns null rather than guessing, so a field it cannot read
//     produces no proposal and never clears an existing value.

export type ProposalKind = "fill" | "conflict" | "unchanged" | "unparsed";

export type Proposal = {
  adsetId: string;
  adsetName: string;
  campaignId: string | null;
  kind: ProposalKind;
  parsed: ParsedAdsetName;
  changes: Record<string, { from: string | null; to: string | null }>;
  editorFrom: string | null;
  editorTo: string | null;
};

export const AUTO_FIELDS = ["videoEditorId", "format", "landing", "problem", "country", "batch"] as const;
export type AutoField = (typeof AUTO_FIELDS)[number];

export type Counts = Record<ProposalKind, number>;

function proposedValues(p: ParsedAdsetName, editorId: string | null): Record<AutoField, string | null> {
  return {
    videoEditorId: editorId,
    format: p.format,
    landing: p.landing.length ? p.landing.join(" + ") : null,
    problem: p.problem,
    country: p.country,
    batch: p.batch,
  };
}

export async function buildProposals(account?: string): Promise<{ proposals: Proposal[]; counts: Counts }> {
  const users = await db
    .select({ id: schema.users.id, name: schema.users.name, userType: schema.users.userType })
    .from(schema.users);
  const videoEditors = users.filter((u) => u.userType === "video_editor");
  const editorNames = videoEditors.map((e) => e.name);
  const idByName = new Map(videoEditors.map((e) => [e.name.toLowerCase(), e.id]));
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  const adsets = await withAdAccount(account, () => getAdSets(undefined, 500));

  const existing = adsets.length
    ? await db
        .select()
        .from(schema.adsetOwners)
        .where(inArray(schema.adsetOwners.adsetId, adsets.map((a) => a.id)))
    : [];
  const ownerByAdset = new Map(existing.map((o) => [o.adsetId, o]));

  const proposals: Proposal[] = [];
  const counts: Counts = { fill: 0, conflict: 0, unchanged: 0, unparsed: 0 };

  for (const adset of adsets) {
    const parsed = parseAdsetName(adset.name ?? "", editorNames);
    const owner = ownerByAdset.get(adset.id);
    const auto = new Set(owner?.autoFields ?? []);
    const editorId = parsed.editor ? idByName.get(parsed.editor.toLowerCase()) ?? null : null;
    const want = proposedValues(parsed, editorId);

    const changes: Proposal["changes"] = {};
    let conflict = false;

    for (const field of AUTO_FIELDS) {
      const next = want[field];
      if (next === null) continue;
      const raw = owner ? (owner as Record<string, unknown>)[field] : null;
      const current = typeof raw === "string" && raw ? raw : null;
      if (current === next) continue;
      if (current !== null && !auto.has(field)) {
        conflict = true;
      }
      changes[field] = { from: current, to: next };
    }

    const kind: ProposalKind = parsed.unparsed
      ? "unparsed"
      : conflict
        ? "conflict"
        : Object.keys(changes).length
          ? "fill"
          : "unchanged";
    counts[kind]++;

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

  return { proposals, counts };
}

export async function applyProposals(opts: {
  proposals: Proposal[];
  adsetIds?: string[];
  /** Let the name win over a manual value. Never true on a scheduled run. */
  includeConflicts?: boolean;
  actorId?: string | null;
}): Promise<number> {
  const wanted = opts.adsetIds?.length ? new Set(opts.adsetIds) : null;
  const targets = opts.proposals.filter((p) => {
    if (wanted && !wanted.has(p.adsetId)) return false;
    if (p.kind === "fill") return true;
    return p.kind === "conflict" && opts.includeConflicts === true;
  });

  let applied = 0;
  for (const p of targets) {
    const fields = Object.keys(p.changes) as AutoField[];
    if (!fields.length) continue;

    const now = new Date();
    const values: Record<string, unknown> = { updatedAt: now, autoAssignedAt: now };
    for (const f of fields) values[f] = p.changes[f].to;

    const [existing] = await db
      .select({ autoFields: schema.adsetOwners.autoFields })
      .from(schema.adsetOwners)
      .where(eq(schema.adsetOwners.adsetId, p.adsetId))
      .limit(1);

    values.autoFields = Array.from(new Set([...(existing?.autoFields ?? []), ...fields]));

    if (existing) {
      await db.update(schema.adsetOwners).set(values).where(eq(schema.adsetOwners.adsetId, p.adsetId));
    } else {
      await db.insert(schema.adsetOwners).values({
        adsetId: p.adsetId,
        adsetName: p.adsetName,
        campaignId: p.campaignId,
        source: "auto",
        assignedById: opts.actorId ?? null,
        ...values,
      });
    }
    applied++;
  }
  return applied;
}

/**
 * Nightly pass over every ad account on the active connection.
 *
 * Deliberately applies ONLY safe fills — a scheduled job must never overrule a
 * person, so conflicts are counted and left for the review dialog. Per-account
 * failures are captured rather than thrown: auto-assignment is a convenience,
 * and it must not take the insights sync down with it.
 */
export async function autoAssignAllAccounts(): Promise<{
  accounts: { account: string; name: string; applied: number; conflicts: number; error?: string }[];
  totalApplied: number;
  totalConflicts: number;
}> {
  const [connection] = await db
    .select({ adAccounts: schema.metaConnections.adAccounts })
    .from(schema.metaConnections)
    .where(eq(schema.metaConnections.isActive, true))
    .limit(1);

  const accounts = (connection?.adAccounts ?? []).filter((a) => a?.id);
  const results: { account: string; name: string; applied: number; conflicts: number; error?: string }[] = [];

  for (const acct of accounts) {
    try {
      const { proposals, counts } = await buildProposals(acct.id);
      const applied = await applyProposals({ proposals, includeConflicts: false });
      results.push({ account: acct.id, name: acct.name, applied, conflicts: counts.conflict });
    } catch (e) {
      results.push({
        account: acct.id,
        name: acct.name,
        applied: 0,
        conflicts: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    accounts: results,
    totalApplied: results.reduce((t, r) => t + r.applied, 0),
    totalConflicts: results.reduce((t, r) => t + r.conflicts, 0),
  };
}
