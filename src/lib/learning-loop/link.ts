// Brief ↔ ad set / ad linking (server-only).
//
// Publishing through the app links automatically. Most launches happen through
// batch scripts though, so the link has to be RECOVERED from names: the ad set
// "SE Fervin Aug198 - #1 - VSL - PP + LP12 - …" is the assignment Fervin was
// given as batch 198, and the ad "H2 SE Fervin Aug198 - …" inside a scaling
// ad set is the same brief's second hook. Editor + batch number is the key;
// month, product, format, landing and problem raise confidence; a different
// market or product is a hard no. Only high-confidence, unambiguous matches
// are applied unattended — a wrong link credits the wrong brief with the wrong
// result, which defeats the loop.

import { db, schema } from "@/db";
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { parseAdsetName, type ParsedAdsetName } from "@/lib/adset-name";
import {
  extractBatchToken,
  formatKeyFromName,
  hookLabelFromName,
  landingTokens,
  normalizeTag,
  productLine,
  stripHookLabel,
  type BatchToken,
} from "./derive";

export type LinkConfidence = "high" | "medium";
export type LinkSource = "publish" | "auto" | "manual";

// products.name → the product line read from campaign names. "Skin & Coat"
// is sold under "Allergi & Klåda" campaigns.
const PRODUCT_ALIAS: Record<string, string> = {
  "skin&coat": "allergi&klåda",
  "allergiklåda": "allergi&klåda",
  "munhälsa+": "munhälsa",
};
export function productKey(name: string | null | undefined): string {
  const k = (name ?? "").toLowerCase().replace(/\s+/g, "");
  return PRODUCT_ALIAS[k] ?? k;
}

// High = safe to apply unattended. Requires the month to match too: batch
// numbers are sometimes a running counter and sometimes a day-of-month, so
// editor + number alone is not proof.
const HIGH_SCORE = 75;

// ─── Assignments as match targets ────────────────────────────────────────────

export interface AssignmentForMatch {
  id: string;
  name: string;
  batchNumber: number;
  version: number;
  editorFirst: string;
  months: number[]; // created + due month
  formatKey: string | null;
  landing: string[];
  problem: string;
  angle: string;
  country: string | null;
  product: string;
}

export async function loadAssignmentsForMatch(onlyId?: string): Promise<AssignmentForMatch[]> {
  const conds = [ne(schema.assignments.status, "draft")];
  if (onlyId) conds.push(eq(schema.assignments.id, onlyId));
  const rows = await db
    .select({
      id: schema.assignments.id,
      autoName: schema.assignments.autoName,
      title: schema.assignments.title,
      batchNumber: schema.assignments.batchNumber,
      version: schema.assignments.version,
      createdAt: schema.assignments.createdAt,
      dueDate: schema.assignments.dueDate,
      landingPage: schema.assignments.landingPage,
      editorName: schema.users.name,
      formatName: schema.formats.name,
      problemName: schema.problems.name,
      angleName: schema.angles.name,
      countryCode: schema.countries.code,
      productName: schema.products.name,
    })
    .from(schema.assignments)
    .leftJoin(schema.users, eq(schema.users.id, schema.assignments.assignedToId))
    .leftJoin(schema.formats, eq(schema.formats.id, schema.assignments.formatId))
    .leftJoin(schema.problems, eq(schema.problems.id, schema.assignments.problemId))
    .leftJoin(schema.angles, eq(schema.angles.id, schema.assignments.angleId))
    .leftJoin(schema.countries, eq(schema.countries.id, schema.assignments.countryId))
    .leftJoin(schema.products, eq(schema.products.id, schema.assignments.productId))
    .where(and(...conds));

  return rows
    .filter((r) => r.batchNumber > 0 && r.editorName)
    .map((r) => {
      const months = new Set<number>();
      if (r.createdAt) months.add(new Date(r.createdAt).getMonth());
      if (r.dueDate) months.add(new Date(r.dueDate).getMonth());
      return {
        id: r.id,
        name: r.autoName || r.title,
        batchNumber: r.batchNumber,
        version: r.version,
        editorFirst: (r.editorName || "").split(" ")[0].toLowerCase(),
        months: [...months],
        formatKey: formatKeyFromName(r.formatName),
        landing: landingTokens(r.landingPage),
        problem: normalizeTag(r.problemName),
        angle: normalizeTag(r.angleName),
        country: r.countryCode ? (r.countryCode.toUpperCase() === "US" ? "USA" : r.countryCode.toUpperCase()) : null,
        product: productKey(r.productName),
      };
    });
}

// ─── Name → candidate, candidate × assignment → score ────────────────────────

export interface NameCandidate {
  p: ParsedAdsetName;
  token: BatchToken | null;
  product: string;
  editorFirst: string;
}

export function parseCandidate(name: string, campaignName: string | null | undefined, knownNames: string[]): NameCandidate {
  const clean = stripHookLabel(name);
  const p = parseAdsetName(clean, knownNames);
  return {
    p,
    token: extractBatchToken(clean),
    product: productKey(productLine(campaignName, clean)),
    editorFirst: (p.editor ?? "").split(" ")[0].toLowerCase(),
  };
}

export interface MatchScore {
  score: number;
  reasons: string[];
  high: boolean;
}

/** null = not a candidate at all (different editor/batch, or a hard gate failed). */
export function scoreCandidate(a: AssignmentForMatch, c: NameCandidate): MatchScore | null {
  if (!c.token || !c.editorFirst) return null;
  if (c.editorFirst !== a.editorFirst || c.token.batch !== a.batchNumber) return null;
  // Hard gates: a different market or a different product is never the same brief.
  if (a.country && c.p.country && a.country !== c.p.country) return null;
  if (a.product && c.product && a.product !== c.product) return null;

  let score = 40;
  const reasons = [`${c.p.editor} + batch ${a.batchNumber}`];
  const monthMatch = a.months.includes(c.token.month);
  if (monthMatch) { score += 20; reasons.push("månad matchar"); }
  if (a.product && c.product && a.product === c.product) { score += 15; reasons.push("produkt matchar"); }
  if (a.formatKey && c.p.format === a.formatKey) { score += 10; reasons.push(`format ${c.p.format}`); }
  if (a.landing.length && c.p.landing.some((l) => a.landing.includes(l))) { score += 10; reasons.push(`landing ${c.p.landing.join("+")}`); }
  const prob = normalizeTag(c.p.problem);
  if (prob && (prob === a.problem || prob === a.angle)) { score += 5; reasons.push(`problem ${c.p.problem}`); }
  if (c.token.version != null && c.token.version === a.version) { score += 5; reasons.push(`v${a.version}`); }
  return { score, reasons, high: score >= HIGH_SCORE && monthMatch };
}

/** Best assignment for one name — used for inline suggestions. */
export function bestMatch(assignments: AssignmentForMatch[], c: NameCandidate): { assignment: AssignmentForMatch; match: MatchScore } | null {
  let best: { assignment: AssignmentForMatch; match: MatchScore } | null = null;
  let tie = false;
  for (const a of assignments) {
    const m = scoreCandidate(a, c);
    if (!m) continue;
    if (!best || m.score > best.match.score) { best = { assignment: a, match: m }; tie = false; }
    else if (m.score === best.match.score) tie = true;
  }
  if (best && tie) best.match = { ...best.match, high: false, reasons: [...best.match.reasons, "flera briefs matchar"] };
  return best;
}

// ─── Ad set proposals ────────────────────────────────────────────────────────

export interface LinkProposal {
  assignmentId: string;
  assignmentName: string;
  assignmentBatch: number;
  adsetId: string;
  adsetName: string;
  campaignId: string | null;
  score: number;
  confidence: LinkConfidence;
  reasons: string[];
  /** Set when the ad set already points at ANOTHER assignment. */
  currentAssignmentId: string | null;
  currentAssignmentName: string | null;
}

interface AdsetForMatch {
  adsetId: string;
  name: string;
  campaignId: string | null;
  campaignName: string | null;
  currentAssignmentId: string | null;
}

async function loadAdsetsForMatch(): Promise<AdsetForMatch[]> {
  const [owners, cached, campaigns] = await Promise.all([
    db.select({
      adsetId: schema.adsetOwners.adsetId,
      name: schema.adsetOwners.adsetName,
      campaignId: schema.adsetOwners.campaignId,
      assignmentId: schema.adsetOwners.assignmentId,
    }).from(schema.adsetOwners),
    db.select({ id: schema.adsetsCache.id, name: schema.adsetsCache.name, campaignId: schema.adsetsCache.campaignId }).from(schema.adsetsCache),
    db.select({ id: schema.campaignsCache.id, name: schema.campaignsCache.name }).from(schema.campaignsCache),
  ]);
  const campaignName = new Map(campaigns.map((c) => [c.id, c.name]));
  const map = new Map<string, AdsetForMatch>();
  for (const c of cached) map.set(c.id, { adsetId: c.id, name: c.name, campaignId: c.campaignId, campaignName: campaignName.get(c.campaignId) ?? null, currentAssignmentId: null });
  for (const o of owners) {
    const ex = map.get(o.adsetId);
    const cid = o.campaignId || ex?.campaignId || null;
    map.set(o.adsetId, {
      adsetId: o.adsetId,
      name: o.name || ex?.name || "",
      campaignId: cid,
      campaignName: cid ? campaignName.get(cid) ?? null : null,
      currentAssignmentId: o.assignmentId ?? null,
    });
  }
  return [...map.values()].filter((a) => a.name);
}

export async function buildLinkProposals(opts: { assignmentId?: string } = {}): Promise<{
  proposals: LinkProposal[];
  assignments: number;
  adsets: number;
}> {
  const [users, assignments, adsets] = await Promise.all([
    db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users),
    loadAssignmentsForMatch(opts.assignmentId),
    loadAdsetsForMatch(),
  ]);
  const knownNames = [...new Set(users.map((u) => u.name))];
  const assignmentNameById = new Map(assignments.map((a) => [a.id, a.name]));

  const parsed = adsets.map((s) => ({ ...s, c: parseCandidate(s.name, s.campaignName, knownNames) }));
  const byEditorBatch = new Map<string, typeof parsed>();
  for (const s of parsed) {
    if (!s.c.token || !s.c.editorFirst) continue;
    const key = `${s.c.editorFirst}|${s.c.token.batch}`;
    byEditorBatch.set(key, [...(byEditorBatch.get(key) ?? []), s]);
  }

  const proposals: LinkProposal[] = [];
  for (const a of assignments) {
    for (const s of byEditorBatch.get(`${a.editorFirst}|${a.batchNumber}`) ?? []) {
      if (s.currentAssignmentId === a.id) continue;
      const m = scoreCandidate(a, s.c);
      if (!m) continue;
      const reasons = [...m.reasons];
      let confidence: LinkConfidence = m.high ? "high" : "medium";
      if (s.currentAssignmentId) { confidence = "medium"; reasons.push("redan kopplad till annan brief"); }
      proposals.push({
        assignmentId: a.id,
        assignmentName: a.name,
        assignmentBatch: a.batchNumber,
        adsetId: s.adsetId,
        adsetName: s.name,
        campaignId: s.campaignId,
        score: m.score,
        confidence,
        reasons,
        currentAssignmentId: s.currentAssignmentId,
        currentAssignmentName: s.currentAssignmentId ? assignmentNameById.get(s.currentAssignmentId) ?? null : null,
      });
    }
  }
  demoteAmbiguous(proposals, (p) => p.adsetId);
  proposals.sort((x, y) => y.score - x.score || x.adsetName.localeCompare(y.adsetName));
  return { proposals, assignments: assignments.length, adsets: adsets.length };
}

/** Two different briefs claiming one target at high confidence = ambiguous; demote both. */
function demoteAmbiguous<T extends { assignmentId: string; confidence: LinkConfidence; reasons: string[] }>(list: T[], keyOf: (p: T) => string) {
  const claims = new Map<string, T[]>();
  for (const p of list) claims.set(keyOf(p), [...(claims.get(keyOf(p)) ?? []), p]);
  for (const group of claims.values()) {
    const highs = group.filter((p) => p.confidence === "high");
    if (new Set(highs.map((p) => p.assignmentId)).size > 1) {
      for (const p of highs) { p.confidence = "medium"; p.reasons.push("flera briefs matchar"); }
    }
  }
}

// ─── Ad (creative) proposals ─────────────────────────────────────────────────

export interface AdLinkProposal {
  assignmentId: string;
  assignmentName: string;
  assignmentBatch: number;
  adId: string;
  adName: string;
  adsetId: string;
  campaignId: string | null;
  score: number;
  confidence: LinkConfidence;
  reasons: string[];
  currentAssignmentId: string | null;
  /** The ad set's own link — when it equals the proposal, the ad link is redundant. */
  adsetAssignmentId: string | null;
}

export async function buildAdLinkProposals(opts: { assignmentId?: string; adIds?: string[] } = {}): Promise<AdLinkProposal[]> {
  const [users, assignments, ads, adOwners, adsetOwners, campaigns] = await Promise.all([
    db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users),
    loadAssignmentsForMatch(opts.assignmentId),
    opts.adIds?.length
      ? db.select({ id: schema.adsCache.id, name: schema.adsCache.name, adsetId: schema.adsCache.adsetId, campaignId: schema.adsCache.campaignId }).from(schema.adsCache).where(inArray(schema.adsCache.id, opts.adIds))
      : db.select({ id: schema.adsCache.id, name: schema.adsCache.name, adsetId: schema.adsCache.adsetId, campaignId: schema.adsCache.campaignId }).from(schema.adsCache),
    db.select({ adId: schema.adOwners.adId, assignmentId: schema.adOwners.assignmentId }).from(schema.adOwners).where(sql`${schema.adOwners.assignmentId} is not null`),
    db.select({ adsetId: schema.adsetOwners.adsetId, assignmentId: schema.adsetOwners.assignmentId }).from(schema.adsetOwners).where(sql`${schema.adsetOwners.assignmentId} is not null`),
    db.select({ id: schema.campaignsCache.id, name: schema.campaignsCache.name }).from(schema.campaignsCache),
  ]);
  const knownNames = [...new Set(users.map((u) => u.name))];
  const campaignName = new Map(campaigns.map((c) => [c.id, c.name]));
  const adLink = new Map(adOwners.map((o) => [o.adId, o.assignmentId as string]));
  const adsetLink = new Map(adsetOwners.map((o) => [o.adsetId, o.assignmentId as string]));

  const byEditorBatch = new Map<string, Array<{ ad: (typeof ads)[number]; c: NameCandidate }>>();
  for (const ad of ads) {
    if (!ad.name) continue;
    const c = parseCandidate(ad.name, campaignName.get(ad.campaignId) ?? null, knownNames);
    if (!c.token || !c.editorFirst) continue;
    const key = `${c.editorFirst}|${c.token.batch}`;
    byEditorBatch.set(key, [...(byEditorBatch.get(key) ?? []), { ad, c }]);
  }

  const proposals: AdLinkProposal[] = [];
  for (const a of assignments) {
    for (const { ad, c } of byEditorBatch.get(`${a.editorFirst}|${a.batchNumber}`) ?? []) {
      const current = adLink.get(ad.id) ?? null;
      if (current === a.id) continue;
      const m = scoreCandidate(a, c);
      if (!m) continue;
      const reasons = [...m.reasons];
      let confidence: LinkConfidence = m.high ? "high" : "medium";
      if (current) { confidence = "medium"; reasons.push("redan kopplad till annan brief"); }
      proposals.push({
        assignmentId: a.id,
        assignmentName: a.name,
        assignmentBatch: a.batchNumber,
        adId: ad.id,
        adName: ad.name,
        adsetId: ad.adsetId,
        campaignId: ad.campaignId || null,
        score: m.score,
        confidence,
        reasons,
        currentAssignmentId: current,
        adsetAssignmentId: adsetLink.get(ad.adsetId) ?? null,
      });
    }
  }
  demoteAmbiguous(proposals, (p) => p.adId);
  proposals.sort((x, y) => y.score - x.score || x.adName.localeCompare(y.adName));
  return proposals;
}

// ─── Applying links ──────────────────────────────────────────────────────────

/** Point ad set(s) at an assignment. Idempotent; never touches a human-set editor. */
export async function applyLinks(
  pairs: Array<{ assignmentId: string; adsetId: string }>,
  source: LinkSource,
  actorId?: string | null,
): Promise<number> {
  if (!pairs.length) return 0;
  const assignmentIds = [...new Set(pairs.map((p) => p.assignmentId))];
  const adsetIds = [...new Set(pairs.map((p) => p.adsetId))];
  const [assignments, owners, cached, users] = await Promise.all([
    db.select().from(schema.assignments).where(inArray(schema.assignments.id, assignmentIds)),
    db.select().from(schema.adsetOwners).where(inArray(schema.adsetOwners.adsetId, adsetIds)),
    db.select({ id: schema.adsetsCache.id, name: schema.adsetsCache.name, campaignId: schema.adsetsCache.campaignId })
      .from(schema.adsetsCache).where(inArray(schema.adsetsCache.id, adsetIds)),
    db.select({ id: schema.users.id, userType: schema.users.userType }).from(schema.users),
  ]);
  const aById = new Map(assignments.map((a) => [a.id, a]));
  const oById = new Map(owners.map((o) => [o.adsetId, o]));
  const cById = new Map(cached.map((c) => [c.id, c]));
  const isVideoEditor = new Set(users.filter((u) => u.userType === "video_editor").map((u) => u.id));

  let applied = 0;
  const now = new Date();
  for (const { assignmentId, adsetId } of pairs) {
    const a = aById.get(assignmentId);
    if (!a) continue;
    const owner = oById.get(adsetId);
    const cache = cById.get(adsetId);
    const editorId = isVideoEditor.has(a.assignedToId) ? a.assignedToId : null;

    const set: Record<string, unknown> = { assignmentId, linkSource: source, linkedAt: now, updatedAt: now };
    if (owner) {
      // Fill ownership only where nothing is set — a person's choice stands.
      if (!owner.videoEditorId && editorId) set.videoEditorId = editorId;
      if (!owner.creativeStrategistId && a.creativeStrategistId) set.creativeStrategistId = a.creativeStrategistId;
      if (!owner.adsetName && cache?.name) set.adsetName = cache.name;
      if (!owner.campaignId && cache?.campaignId) set.campaignId = cache.campaignId;
      await db.update(schema.adsetOwners).set(set).where(eq(schema.adsetOwners.adsetId, adsetId));
    } else {
      await db.insert(schema.adsetOwners).values({
        adsetId,
        adsetName: cache?.name ?? a.autoName ?? null,
        campaignId: cache?.campaignId ?? a.metaCampaignId ?? null,
        videoEditorId: editorId,
        creativeStrategistId: a.creativeStrategistId ?? null,
        source: source === "publish" ? "uploader" : "analyzer",
        assignedById: actorId ?? null,
        ...set,
      });
    }

    // First linked ad set becomes the assignment's primary one.
    if (!a.metaAdsetId) {
      await db.update(schema.assignments)
        .set({ metaAdsetId: adsetId, metaCampaignId: a.metaCampaignId ?? cache?.campaignId ?? null, updatedAt: now })
        .where(eq(schema.assignments.id, assignmentId));
      a.metaAdsetId = adsetId;
    }
    applied++;
  }
  return applied;
}

export async function unlinkAdset(adsetId: string): Promise<void> {
  const [owner] = await db.select().from(schema.adsetOwners).where(eq(schema.adsetOwners.adsetId, adsetId)).limit(1);
  if (!owner?.assignmentId) return;
  const assignmentId = owner.assignmentId;
  const now = new Date();
  await db.update(schema.adsetOwners)
    .set({ assignmentId: null, linkSource: null, linkedAt: null, updatedAt: now })
    .where(eq(schema.adsetOwners.adsetId, adsetId));

  // Keep the assignment's primary pointer valid.
  const [a] = await db.select({ metaAdsetId: schema.assignments.metaAdsetId }).from(schema.assignments).where(eq(schema.assignments.id, assignmentId)).limit(1);
  if (a?.metaAdsetId === adsetId) {
    const [next] = await db.select({ adsetId: schema.adsetOwners.adsetId, campaignId: schema.adsetOwners.campaignId })
      .from(schema.adsetOwners).where(eq(schema.adsetOwners.assignmentId, assignmentId)).limit(1);
    await db.update(schema.assignments)
      .set({ metaAdsetId: next?.adsetId ?? null, metaCampaignId: next?.campaignId ?? null, updatedAt: now })
      .where(eq(schema.assignments.id, assignmentId));
  }
}

/** Point ad(s) at an assignment — creative-level link, e.g. inside a scaling ad set. */
export async function applyAdLinks(
  pairs: Array<{ assignmentId: string; adId: string }>,
  source: LinkSource,
  actorId?: string | null,
): Promise<number> {
  if (!pairs.length) return 0;
  const adIds = [...new Set(pairs.map((p) => p.adId))];
  const [owners, cached] = await Promise.all([
    db.select({ adId: schema.adOwners.adId, hookLabel: schema.adOwners.hookLabel }).from(schema.adOwners).where(inArray(schema.adOwners.adId, adIds)),
    db.select({ id: schema.adsCache.id, name: schema.adsCache.name, adsetId: schema.adsCache.adsetId, campaignId: schema.adsCache.campaignId }).from(schema.adsCache).where(inArray(schema.adsCache.id, adIds)),
  ]);
  const existing = new Map(owners.map((o) => [o.adId, o]));
  const cache = new Map(cached.map((c) => [c.id, c]));
  const now = new Date();
  let applied = 0;
  for (const { assignmentId, adId } of pairs) {
    const c = cache.get(adId);
    const ex = existing.get(adId);
    const set: Record<string, unknown> = { assignmentId, linkSource: source, linkedAt: now, updatedAt: now };
    if (!ex?.hookLabel) set.hookLabel = hookLabelFromName(c?.name);
    if (ex) {
      await db.update(schema.adOwners).set(set).where(eq(schema.adOwners.adId, adId));
    } else {
      await db.insert(schema.adOwners).values({
        adId,
        adName: c?.name ?? null,
        adsetId: c?.adsetId ?? null,
        campaignId: c?.campaignId ?? null,
        source: "analyzer",
        assignedById: actorId ?? null,
        ...set,
      });
    }
    applied++;
  }
  return applied;
}

export async function unlinkAds(adIds: string[]): Promise<void> {
  if (!adIds.length) return;
  await db.update(schema.adOwners)
    .set({ assignmentId: null, linkSource: null, linkedAt: null, updatedAt: new Date() })
    .where(inArray(schema.adOwners.adId, adIds));
}

/**
 * Nightly: apply every HIGH-confidence proposal whose target is still unlinked.
 * Ad links are skipped when the ad set already carries the same brief (the ad
 * inherits it). Medium ones are left for the review UI.
 */
export async function autoLinkAll(actorId?: string | null): Promise<{ applied: number; adsApplied: number; suggested: number }> {
  const { proposals } = await buildLinkProposals();
  const safe = proposals.filter((p) => p.confidence === "high" && !p.currentAssignmentId);
  const applied = await applyLinks(safe.map((p) => ({ assignmentId: p.assignmentId, adsetId: p.adsetId })), "auto", actorId);

  const adProposals = await buildAdLinkProposals();
  const safeAds = adProposals.filter((p) => p.confidence === "high" && !p.currentAssignmentId && p.adsetAssignmentId !== p.assignmentId);
  const adsApplied = await applyAdLinks(safeAds.map((p) => ({ assignmentId: p.assignmentId, adId: p.adId })), "auto", actorId);

  return { applied, adsApplied, suggested: proposals.length - safe.length + (adProposals.length - safeAds.length) };
}

/** Ad sets by name — for the manual picker. */
export async function searchAdsets(q: string, limit = 30): Promise<Array<{ adsetId: string; name: string; campaignId: string | null; campaignName: string | null; assignmentId: string | null }>> {
  const like = `%${q.trim()}%`;
  const rows = await db
    .select({
      adsetId: schema.adsetOwners.adsetId,
      name: schema.adsetOwners.adsetName,
      campaignId: schema.adsetOwners.campaignId,
      campaignName: schema.campaignsCache.name,
      assignmentId: schema.adsetOwners.assignmentId,
    })
    .from(schema.adsetOwners)
    .leftJoin(schema.campaignsCache, eq(schema.campaignsCache.id, schema.adsetOwners.campaignId))
    .where(q.trim() ? sql`${schema.adsetOwners.adsetName} ilike ${like}` : sql`true`)
    .orderBy(sql`${schema.adsetOwners.updatedAt} desc`)
    .limit(limit);
  const seen = new Set(rows.map((r) => r.adsetId));
  const cachedRows = await db
    .select({
      adsetId: schema.adsetsCache.id,
      name: schema.adsetsCache.name,
      campaignId: schema.adsetsCache.campaignId,
      campaignName: schema.campaignsCache.name,
    })
    .from(schema.adsetsCache)
    .leftJoin(schema.campaignsCache, eq(schema.campaignsCache.id, schema.adsetsCache.campaignId))
    .where(and(q.trim() ? sql`${schema.adsetsCache.name} ilike ${like}` : sql`true`, or(isNull(schema.adsetsCache.status), ne(schema.adsetsCache.status, "DELETED"))))
    .limit(limit);
  const out = rows.map((r) => ({ ...r, name: r.name ?? r.adsetId }));
  for (const c of cachedRows) if (!seen.has(c.adsetId)) out.push({ ...c, assignmentId: null });
  return out.slice(0, limit);
}
