// The Learning Loop dataset (server-only).
//
// Two views of the same loop:
//
//   ad set view  — one row per AD SET: the unit the team tests, tags and pays
//                  bonuses on. Right for ABO testing campaigns.
//   creative view — one row per CREATIVE (same video / same name across every
//                  ad set it was copied into). Right for CBO scaling campaigns,
//                  where a single ad set holds the winners from many briefs.
//
// Both join the brief (assignment) that produced the thing, the Evolve
// classification of its numbers, and the human verdict + learnings, so the
// page reads:  brief → live → numbers → verdict → learning → next brief.

import { db, schema } from "@/db";
import { eq, isNull, ne, or } from "drizzle-orm";
import { classifyAd, type Classification } from "@/lib/evolve/classifier";
import { getEvolveSettings } from "@/lib/evolve/settings";
import { getAdsetNcRoas } from "@/lib/shopify/ncroas";
import { parseAdsetName } from "@/lib/adset-name";
import {
  adsFromAdsets,
  aggregateInsightsByAdset,
  daysBetween,
  isoDate,
  ratios,
  shiftDays,
  type AdAgg,
  type AdsetAgg,
  type Ratios,
} from "./metrics";
import {
  campaignRole,
  productLine,
  extractBatchToken,
  hookLabelFromName,
  normalizeCreativeName,
  scriptTextFor,
  stripHookLabel,
  CAMPAIGN_ROLE_LABEL,
  type CampaignRole,
} from "./derive";
import {
  bestMatch,
  buildLinkProposals,
  loadAssignmentsForMatch,
  parseCandidate,
  type AssignmentForMatch,
  type LinkProposal,
} from "./link";

export type Period = "7d" | "14d" | "30d" | "90d" | "lifetime";
export const PERIODS: Period[] = ["7d", "14d", "30d", "90d", "lifetime"];
export type Verdict = "confirmed_winner" | "loser" | "iterate" | "inconclusive";
export const VERDICTS: Verdict[] = ["confirmed_winner", "loser", "iterate", "inconclusive"];
export type Outcome = "winner" | "loser" | "judged" | "learning";

// ─── Shared shapes ───────────────────────────────────────────────────────────

export interface LoopMetrics extends Ratios {
  spend: number;
  impressions: number;
  linkClicks: number;
  purchases: number;
  purchaseValue: number;
  videoViews3s: number;
  videoThruplays: number;
  activeDays: number;
  firstDate: string | null;
  lastDate: string | null;
}

export interface LoopAd {
  id: string;
  name: string;
  status: string | null;
  spend: number;
  impressions: number;
  purchases: number;
  purchaseValue: number;
  roas: number;
  cpa: number;
  ctr: number;
  hookRate: number;
  holdRate: number;
}

export interface ScriptContent {
  hooks: Array<{ id: string; label: string; eng: string; se: string }>;
  body: { eng: string; se: string };
}

export interface LoopAssignmentRef {
  id: string;
  batchNumber: number;
  version: number;
  autoName: string;
  status: string;
  hypothesis: string | null;
  variableTested: string | null;
  adType: string | null;
  awarenessLevel: string | null;
  iterationOfId: string | null;
  editorName: string | null;
  strategistName: string | null;
  productName: string | null;
  formatName: string | null;
  problemName: string | null;
  angleName: string | null;
  landingPage: string | null;
  scriptContent: ScriptContent | null;
}

export interface LearningLoopRow {
  adsetId: string;
  name: string;
  campaignId: string | null;
  campaignName: string | null;
  role: CampaignRole;
  roleLabel: string;
  productLine: string | null;
  status: string | null;
  isLive: boolean;
  editorId: string | null;
  editorName: string | null;
  strategistId: string | null;
  strategistName: string | null;
  format: string | null;
  problem: string | null;
  angle: string | null;
  landing: string | null;
  batch: string | null;
  country: string | null;
  assignment: LoopAssignmentRef | null;
  linkSource: string | null;
  window: LoopMetrics;
  lifetime: LoopMetrics;
  ageDays: number;
  ncRoas: number | null;
  classification: Classification;
  recommendation: string;
  isTopSpender: boolean;
  spendShare: number;
  spendThreshold: number;
  spendProgress: number;
  verdict: Verdict | null;
  verdictAt: string | null;
  learnings: string | null;
  learningsAt: string | null;
  graveyardOutcome: string | null;
  outcome: Outcome;
  judged: boolean;
  ads: LoopAd[];
  /** A CBO scaling container ("Scaling Winners - POSTID") — many briefs, never a test itself. */
  isContainer: boolean;
  creativesCount: number;
  /** Copies of THIS ad set's creatives running elsewhere (scaling, BOF, graveyard). */
  scaled: { window: LoopMetrics; lifetime: LoopMetrics; copies: ScaledCopy[] };
  /** Own + scaled. */
  total: { window: LoopMetrics; lifetime: LoopMetrics };
  /** For containers: what is inside and where each creative came from. */
  containerCreatives: ContainerCreative[];
}

export interface ScaledCopy {
  adId: string;
  name: string;
  status: string | null;
  adsetId: string;
  adsetName: string;
  role: CampaignRole;
  roleLabel: string;
  window: LoopMetrics;
  lifetime: LoopMetrics;
}

export interface ContainerCreative {
  key: string;
  name: string;
  hookLabel: string | null;
  adIds: string[];
  originAdsetId: string | null;
  originAdsetName: string | null;
  originSource: OriginSource;
  window: LoopMetrics;
  lifetime: LoopMetrics;
}

export type OriginSource = "manual" | "testing" | "name" | "earliest" | "only" | null;

/** One ad of a creative, in one ad set. */
export interface CreativeAdRef {
  adId: string;
  name: string;
  status: string | null;
  adsetId: string;
  adsetName: string;
  campaignId: string | null;
  campaignName: string | null;
  role: CampaignRole;
  roleLabel: string;
  isContainer: boolean;
  isOrigin: boolean;
  window: LoopMetrics;
  lifetime: LoopMetrics;
}

export interface CreativeSuggestion {
  assignmentId: string;
  assignmentName: string;
  assignmentBatch: number;
  score: number;
  confidence: "high" | "medium";
  reasons: string[];
}

export interface CreativeRow {
  key: string;
  name: string;
  hookLabel: string | null;
  primaryAdId: string;
  adIds: string[];
  adsetIds: string[];
  videoIds: string[];
  roles: CampaignRole[];
  roleLabel: string;
  /** The ad set this creative was TESTED in — where its learning belongs. */
  originAdsetId: string | null;
  originAdsetName: string | null;
  originSource: OriginSource;
  productLine: string | null;
  isLive: boolean;
  editorName: string | null;
  strategistName: string | null;
  format: string | null;
  problem: string | null;
  angle: string | null;
  landing: string | null;
  assignment: LoopAssignmentRef | null;
  linkSource: "ad" | "adset" | null;
  suggestion: CreativeSuggestion | null;
  script: string | null;
  scriptSource: "own" | "assignment" | null;
  scriptFromAssignment: string | null;
  window: LoopMetrics;
  lifetime: LoopMetrics;
  ageDays: number;
  classification: Classification;
  recommendation: string;
  spendThreshold: number;
  spendProgress: number;
  verdict: Verdict | null;
  verdictAt: string | null;
  learnings: string | null;
  learningsAt: string | null;
  outcome: Outcome;
  judged: boolean;
  ads: CreativeAdRef[];
}

export interface BreakdownRow {
  key: string;
  label: string;
  tests: number;
  live: number;
  judged: number;
  winners: number;
  losers: number;
  hitRate: number;
  spend: number;
  purchases: number;
  purchaseValue: number;
  roas: number;
  cpa: number;
}

export interface LoopSummary {
  spend: number;
  purchases: number;
  purchaseValue: number;
  roas: number;
  cpa: number;
  ncRoas: number | null;
  tests: number;
  live: number;
  judged: number;
  winners: number;
  losers: number;
  hitRate: number;
  pipeline: number;
  unlinkedPosted: number;
  withLearnings: number;
}

export interface PipelineAssignment extends Omit<LoopAssignmentRef, "scriptContent"> {
  createdAt: string;
  dueDate: string | null;
  priority: string;
  linkedAdsets: number;
  suggestions: LinkProposal[];
}

interface LoopEnvelope {
  account: string | null;
  accounts: Array<{ id: string; name: string; currency: string }>;
  currency: string;
  period: Period;
  since: string | null;
  until: string;
  settings: { targetRoas: number; breakevenRoas: number; targetCpa: number; learningPeriodDays: number };
  summary: LoopSummary;
  breakdowns: Record<string, BreakdownRow[]>;
  generatedAt: string;
}

export interface LearningLoopData extends LoopEnvelope {
  rows: LearningLoopRow[];
  pipeline: PipelineAssignment[];
}

export interface CreativeLoopData extends LoopEnvelope {
  rows: CreativeRow[];
  truncated: boolean;
}

export const BREAKDOWN_DIMENSIONS: Array<{ key: string; label: string }> = [
  { key: "productLine", label: "Produkt" },
  { key: "editorName", label: "Editor" },
  { key: "strategistName", label: "Strateg" },
  { key: "format", label: "Format" },
  { key: "problem", label: "Problem" },
  { key: "angle", label: "Angle" },
  { key: "landing", label: "Landing" },
  { key: "roleLabel", label: "Lager" },
  { key: "adType", label: "Ideation/Iteration" },
];

// ─── Context ─────────────────────────────────────────────────────────────────

function formatAct(id: string): string {
  return id.startsWith("act_") ? id : `act_${id}`;
}

const EMPTY_METRICS: LoopMetrics = {
  spend: 0, impressions: 0, linkClicks: 0, purchases: 0, purchaseValue: 0,
  videoViews3s: 0, videoThruplays: 0, activeDays: 0, firstDate: null, lastDate: null,
  roas: 0, cpa: 0, ctr: 0, cpm: 0, hookRate: 0, holdRate: 0,
};

function toMetrics(m: AdsetAgg | AdAgg | undefined): LoopMetrics {
  if (!m) return { ...EMPTY_METRICS };
  return {
    spend: m.spend, impressions: m.impressions, linkClicks: m.linkClicks, purchases: m.purchases,
    purchaseValue: m.purchaseValue, videoViews3s: m.videoViews3s, videoThruplays: m.videoThruplays,
    activeDays: "activeDays" in m ? m.activeDays : 0, firstDate: m.firstDate, lastDate: m.lastDate,
    ...ratios(m),
  };
}

function sumMetrics(list: LoopMetrics[]): LoopMetrics {
  const s = { ...EMPTY_METRICS };
  for (const m of list) {
    s.spend += m.spend; s.impressions += m.impressions; s.linkClicks += m.linkClicks; s.purchases += m.purchases;
    s.purchaseValue += m.purchaseValue; s.videoViews3s += m.videoViews3s; s.videoThruplays += m.videoThruplays;
    s.activeDays = Math.max(s.activeDays, m.activeDays);
    if (m.firstDate && (!s.firstDate || m.firstDate < s.firstDate)) s.firstDate = m.firstDate;
    if (m.lastDate && (!s.lastDate || m.lastDate > s.lastDate)) s.lastDate = m.lastDate;
  }
  return { ...s, ...ratios(s) };
}

function periodSince(period: Period, until: string): string | null {
  const days: Record<Period, number | null> = { "7d": 7, "14d": 14, "30d": 30, "90d": 90, lifetime: null };
  const n = days[period];
  return n ? shiftDays(until, -(n - 1)) : null;
}

export interface BuildOptions {
  /** "act_…", null = the connection's active account, "all" = every account. */
  account?: string | null;
  period?: Period;
  /** Restrict to these ad sets (assignment performance view). */
  adsetIds?: string[];
  /** Creatives: restrict to ads linked (directly or via ad set) to this brief. */
  assignmentId?: string;
  /** Skip the (name-parsing) suggestion pass for the pipeline. */
  withSuggestions?: boolean;
}

interface LoopContext {
  period: Period;
  since: string | null;
  until: string;
  liveCutoff: string;
  accountId: string | null;
  accounts: Array<{ id: string; name: string; currency: string }>;
  currency: string;
  settings: Awaited<ReturnType<typeof getEvolveSettings>>;
  windowAgg: Map<string, AdsetAgg>;
  lifetimeAgg: Map<string, AdsetAgg>;
  owners: (typeof schema.adsetOwners.$inferSelect)[];
  ownerById: Map<string, typeof schema.adsetOwners.$inferSelect>;
  cacheById: Map<string, typeof schema.adsetsCache.$inferSelect>;
  campaignById: Map<string, { id: string; name: string; status: string }>;
  nameById: Map<string, string>;
  knownNames: string[];
  assignmentRows: AssignmentRowRaw[];
  assignmentRefs: Map<string, LoopAssignmentRef>;
  assignmentsForMatch: AssignmentForMatch[];
  ncMap: Map<string, { newCustomerRevenue: number }>;
  adOwnerById: Map<string, typeof schema.adOwners.$inferSelect>;
}

type AssignmentRowRaw = {
  id: string; batchNumber: number; version: number; autoName: string | null; title: string; status: string; priority: string;
  createdAt: Date; dueDate: Date | null; hypothesis: string | null; variableTested: string | null; adType: string | null;
  awarenessLevel: string | null; iterationOfId: string | null; landingPage: string | null; assignedToId: string;
  creativeStrategistId: string | null; creativeStrategistName: string | null; scriptContent: ScriptContent | null;
  productName: string | null; formatName: string | null; problemName: string | null; angleName: string | null;
};

async function loadContext(opts: BuildOptions): Promise<LoopContext> {
  const period: Period = opts.period && PERIODS.includes(opts.period) ? opts.period : "30d";
  const until = isoDate();
  const since = periodSince(period, until);

  const [connection] = await db
    .select({ activeAdAccountId: schema.metaConnections.activeAdAccountId, adAccounts: schema.metaConnections.adAccounts })
    .from(schema.metaConnections)
    .where(eq(schema.metaConnections.isActive, true))
    .limit(1);
  const accounts = ((connection?.adAccounts ?? []) as Array<{ id: string; name: string; currency?: string }>)
    .map((a) => ({ id: formatAct(a.id), name: a.name, currency: a.currency ?? "SEK" }));
  const activeId = connection?.activeAdAccountId ? formatAct(connection.activeAdAccountId) : null;
  const wantAll = opts.account === "all";
  const accountId = wantAll ? null : opts.account ? formatAct(opts.account) : activeId;
  const currency = wantAll ? "" : accounts.find((a) => a.id === accountId)?.currency ?? "SEK";
  const aggOpts = accountId ? { accountIds: [accountId], includeLegacyNull: accountId === activeId } : {};

  const [settings, windowAgg, lifetimeAgg, owners, cache, campaigns, users, assignmentRows, ncMap, adOwners, assignmentsForMatch] = await Promise.all([
    getEvolveSettings(),
    aggregateInsightsByAdset({ since, until, ...aggOpts }),
    aggregateInsightsByAdset(aggOpts),
    db.select().from(schema.adsetOwners),
    accountId
      ? db.select().from(schema.adsetsCache).where(or(eq(schema.adsetsCache.adAccountId, accountId), isNull(schema.adsetsCache.adAccountId)))
      : db.select().from(schema.adsetsCache),
    db.select({ id: schema.campaignsCache.id, name: schema.campaignsCache.name, status: schema.campaignsCache.status }).from(schema.campaignsCache),
    db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users),
    db
      .select({
        id: schema.assignments.id,
        batchNumber: schema.assignments.batchNumber,
        version: schema.assignments.version,
        autoName: schema.assignments.autoName,
        title: schema.assignments.title,
        status: schema.assignments.status,
        priority: schema.assignments.priority,
        createdAt: schema.assignments.createdAt,
        dueDate: schema.assignments.dueDate,
        hypothesis: schema.assignments.hypothesis,
        variableTested: schema.assignments.variableTested,
        adType: schema.assignments.adType,
        awarenessLevel: schema.assignments.awarenessLevel,
        iterationOfId: schema.assignments.iterationOfId,
        landingPage: schema.assignments.landingPage,
        assignedToId: schema.assignments.assignedToId,
        creativeStrategistId: schema.assignments.creativeStrategistId,
        creativeStrategistName: schema.assignments.creativeStrategistName,
        scriptContent: schema.assignments.scriptContent,
        productName: schema.products.name,
        formatName: schema.formats.name,
        problemName: schema.problems.name,
        angleName: schema.angles.name,
      })
      .from(schema.assignments)
      .leftJoin(schema.products, eq(schema.products.id, schema.assignments.productId))
      .leftJoin(schema.formats, eq(schema.formats.id, schema.assignments.formatId))
      .leftJoin(schema.problems, eq(schema.problems.id, schema.assignments.problemId))
      .leftJoin(schema.angles, eq(schema.angles.id, schema.assignments.angleId))
      .where(ne(schema.assignments.status, "draft")),
    getAdsetNcRoas(since ?? "2020-01-01", until).catch(() => new Map<string, { newCustomerRevenue: number }>()),
    db.select().from(schema.adOwners),
    loadAssignmentsForMatch(),
  ]);

  const nameById = new Map(users.map((u) => [u.id, u.name]));
  const assignmentRefs = new Map<string, LoopAssignmentRef>();
  for (const a of assignmentRows) {
    assignmentRefs.set(a.id, {
      id: a.id,
      batchNumber: a.batchNumber,
      version: a.version,
      autoName: a.autoName || a.title,
      status: a.status,
      hypothesis: a.hypothesis,
      variableTested: a.variableTested,
      adType: a.adType,
      awarenessLevel: a.awarenessLevel,
      iterationOfId: a.iterationOfId,
      editorName: nameById.get(a.assignedToId) ?? null,
      strategistName: a.creativeStrategistName || (a.creativeStrategistId ? nameById.get(a.creativeStrategistId) ?? null : null),
      productName: a.productName,
      formatName: a.formatName,
      problemName: a.problemName,
      angleName: a.angleName,
      landingPage: a.landingPage,
      scriptContent: (a.scriptContent as ScriptContent | null) ?? null,
    });
  }

  return {
    period, since, until, liveCutoff: shiftDays(until, -2),
    accountId, accounts, currency, settings,
    windowAgg, lifetimeAgg,
    owners, ownerById: new Map(owners.map((o) => [o.adsetId, o])),
    cacheById: new Map(cache.map((c) => [c.id, c])),
    campaignById: new Map(campaigns.map((c) => [c.id, c])),
    nameById, knownNames: [...new Set(users.map((u) => u.name))],
    assignmentRows: assignmentRows as AssignmentRowRaw[], assignmentRefs, assignmentsForMatch,
    ncMap, adOwnerById: new Map(adOwners.map((o) => [o.adId, o])),
  };
}

function outcomeOf(verdict: Verdict | null, classification: Classification): { outcome: Outcome; judged: boolean } {
  let outcome: Outcome = "learning";
  if (verdict === "confirmed_winner") outcome = "winner";
  else if (verdict === "loser") outcome = "loser";
  else if (verdict) outcome = "judged";
  else if (classification === "breakthrough") outcome = "winner";
  else if (classification === "loser") outcome = "loser";
  else if (classification === "spend_winner") outcome = "judged";
  return { outcome, judged: outcome !== "learning" };
}

function strategistFromName(ctx: LoopContext, name: string): string | null {
  const parsed = parseAdsetName(stripHookLabel(name), ctx.knownNames);
  return parsed.strategist && ctx.knownNames.some((n) => n.toLowerCase() === parsed.strategist!.toLowerCase()) ? parsed.strategist : null;
}

function envelope(ctx: LoopContext, summary: LoopSummary, breakdowns: Record<string, BreakdownRow[]>): LoopEnvelope {
  return {
    account: ctx.accountId,
    accounts: ctx.accounts,
    currency: ctx.currency,
    period: ctx.period,
    since: ctx.since,
    until: ctx.until,
    settings: {
      targetRoas: ctx.settings.targetRoas,
      breakevenRoas: ctx.settings.breakevenRoas,
      targetCpa: ctx.settings.targetCpa,
      learningPeriodDays: ctx.settings.learningPeriodDays,
    },
    summary,
    breakdowns,
    generatedAt: new Date().toISOString(),
  };
}

// ─── Breakdowns + summary (shared by both views) ─────────────────────────────

interface BreakdownSource {
  productLine: string | null;
  editorName: string | null;
  strategistName: string | null;
  format: string | null;
  problem: string | null;
  angle: string | null;
  landing: string | null;
  roleLabel: string;
  assignment: { adType: string | null } | null;
  isLive: boolean;
  judged: boolean;
  outcome: Outcome;
  window: { spend: number; purchases: number; purchaseValue: number };
  learnings: string | null;
  ncRoas?: number | null;
}

function computeBreakdowns(rows: BreakdownSource[]): Record<string, BreakdownRow[]> {
  const breakdowns: Record<string, BreakdownRow[]> = {};
  for (const dim of BREAKDOWN_DIMENSIONS) {
    const groups = new Map<string, BreakdownRow>();
    for (const r of rows) {
      const raw = dim.key === "adType" ? r.assignment?.adType ?? null : (r as unknown as Record<string, unknown>)[dim.key];
      const key = typeof raw === "string" && raw.trim() ? raw.trim() : "—";
      const g = groups.get(key) ?? { key, label: key, tests: 0, live: 0, judged: 0, winners: 0, losers: 0, hitRate: 0, spend: 0, purchases: 0, purchaseValue: 0, roas: 0, cpa: 0 };
      g.tests += 1;
      if (r.isLive) g.live += 1;
      if (r.judged) g.judged += 1;
      if (r.outcome === "winner") g.winners += 1;
      if (r.outcome === "loser") g.losers += 1;
      g.spend += r.window.spend;
      g.purchases += r.window.purchases;
      g.purchaseValue += r.window.purchaseValue;
      groups.set(key, g);
    }
    breakdowns[dim.key] = [...groups.values()]
      .map((g) => ({
        ...g,
        hitRate: g.judged > 0 ? (g.winners / g.judged) * 100 : 0,
        roas: g.spend > 0 ? g.purchaseValue / g.spend : 0,
        cpa: g.purchases > 0 ? g.spend / g.purchases : 0,
      }))
      .sort((a, b) => b.spend - a.spend);
  }
  return breakdowns;
}

function computeSummary(rows: BreakdownSource[], pipeline = 0, unlinkedPosted = 0): LoopSummary {
  const spend = rows.reduce((s, r) => s + r.window.spend, 0);
  const purchases = rows.reduce((s, r) => s + r.window.purchases, 0);
  const purchaseValue = rows.reduce((s, r) => s + r.window.purchaseValue, 0);
  const ncRevenueTotal = rows.reduce((s, r) => s + (r.ncRoas ? r.ncRoas * r.window.spend : 0), 0);
  const judged = rows.filter((r) => r.judged).length;
  const winners = rows.filter((r) => r.outcome === "winner").length;
  return {
    spend,
    purchases,
    purchaseValue,
    roas: spend > 0 ? purchaseValue / spend : 0,
    cpa: purchases > 0 ? spend / purchases : 0,
    ncRoas: spend > 0 && ncRevenueTotal > 0 ? ncRevenueTotal / spend : null,
    tests: rows.length,
    live: rows.filter((r) => r.isLive).length,
    judged,
    winners,
    losers: rows.filter((r) => r.outcome === "loser").length,
    hitRate: judged > 0 ? (winners / judged) * 100 : 0,
    pipeline,
    unlinkedPosted,
    withLearnings: rows.filter((r) => r.learnings && r.learnings.trim()).length,
  };
}

// ─── Creative groups + origins (shared by both views) ────────────────────────
//
// A creative = the same video / image / normalised name wherever it was copied
// (union-find over EVERY ad the account has ever delivered, so an ABO original
// that stopped spending months ago still groups with its scaling copy today).
// Each group gets an ORIGIN ad set: the ABO ad set it was tested in. Copies
// inside CBO scaling containers credit their result back to that origin.

interface OriginInfo {
  adsetId: string | null;
  name: string | null;
  source: OriginSource;
}

interface CreativeGroups {
  adsL: Map<string, AdAgg>;
  adsW: Map<string, AdAgg>;
  rootOf: Map<string, string>;
  members: Map<string, string[]>;
  originOf: Map<string, OriginInfo>;
  containers: Set<string>;
  /** adsetId → root ids of the groups that have a member in it */
  groupsInAdset: Map<string, Set<string>>;
  adsetName: (id: string) => string;
  adsetRole: (id: string) => CampaignRole;
}

const CONTAINER_NAME = /scaling\s*winners|postid|\s-\s*scaling\s*-\s|zombie\s*stack/i;

function buildCreativeGroups(ctx: LoopContext): CreativeGroups {
  const adsL = adsFromAdsets(ctx.lifetimeAgg);
  const adsW = adsFromAdsets(ctx.windowAgg);
  // Window-only ads (no lifetime row is impossible, but be safe).
  for (const [id, ad] of adsW) if (!adsL.has(id)) adsL.set(id, ad);

  const adsetName = (id: string) => ctx.ownerById.get(id)?.adsetName || ctx.cacheById.get(id)?.name || id;
  const adsetCampaign = (id: string) => {
    const cid = ctx.lifetimeAgg.get(id)?.campaignId ?? ctx.ownerById.get(id)?.campaignId ?? ctx.cacheById.get(id)?.campaignId ?? null;
    return cid ? ctx.campaignById.get(cid)?.name ?? null : null;
  };
  const roleCache = new Map<string, CampaignRole>();
  const adsetRole = (id: string) => {
    let r = roleCache.get(id);
    if (!r) { r = campaignRole(adsetCampaign(id), adsetName(id)); roleCache.set(id, r); }
    return r;
  };

  // ── union-find ──
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; }
    return r;
  };
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const repByKey = new Map<string, string>();
  for (const [id, ad] of adsL) {
    parent.set(id, id);
    const keys: string[] = [];
    if (ad.videoId) keys.push(`v:${ad.videoId}`);
    if (ad.imageHash) keys.push(`i:${ad.imageHash}`);
    const n = normalizeCreativeName(ad.name);
    if (n) keys.push(`n:${n}`);
    for (const k of keys) {
      const rep = repByKey.get(k);
      if (rep) union(id, rep); else repByKey.set(k, id);
    }
  }
  const rootOf = new Map<string, string>();
  const members = new Map<string, string[]>();
  for (const id of adsL.keys()) {
    const r = find(id);
    rootOf.set(id, r);
    members.set(r, [...(members.get(r) ?? []), id]);
  }

  // ── name key per ad ("editor|batch") and containers ──
  const nameKeyOf = new Map<string, string | null>();
  const keysInAdset = new Map<string, Set<string>>();
  const groupsInAdset = new Map<string, Set<string>>();
  for (const [id, ad] of adsL) {
    const c = parseCandidate(ad.name ?? "", adsetCampaign(ad.adsetId), ctx.knownNames);
    const key = c.token && c.editorFirst ? `${c.editorFirst}|${c.token.raw.toLowerCase()}` : null;
    nameKeyOf.set(id, key);
    if (key) {
      const set = keysInAdset.get(ad.adsetId) ?? new Set<string>();
      set.add(key);
      keysInAdset.set(ad.adsetId, set);
    }
    const g = groupsInAdset.get(ad.adsetId) ?? new Set<string>();
    g.add(rootOf.get(id)!);
    groupsInAdset.set(ad.adsetId, g);
  }
  const containers = new Set<string>();
  for (const adsetId of groupsInAdset.keys()) {
    const role = adsetRole(adsetId);
    const distinct = keysInAdset.get(adsetId)?.size ?? 0;
    if (CONTAINER_NAME.test(adsetName(adsetId)) || (role !== "testing" && distinct >= 2)) containers.add(adsetId);
  }

  // Testing-role ad sets indexed by their own name key, for the name fallback.
  const testingByKey = new Map<string, string[]>();
  const allAdsetIds = new Set<string>([...ctx.lifetimeAgg.keys(), ...ctx.ownerById.keys(), ...ctx.cacheById.keys()]);
  for (const adsetId of allAdsetIds) {
    if (adsetRole(adsetId) !== "testing" || containers.has(adsetId)) continue;
    const c = parseCandidate(adsetName(adsetId), adsetCampaign(adsetId), ctx.knownNames);
    if (!c.token || !c.editorFirst) continue;
    const key = `${c.editorFirst}|${c.token.raw.toLowerCase()}`;
    testingByKey.set(key, [...(testingByKey.get(key) ?? []), adsetId]);
  }
  const firstDateOf = (adsetId: string) => ctx.lifetimeAgg.get(adsetId)?.firstDate ?? "9999";

  // ── origin per group ──
  const originOf = new Map<string, OriginInfo>();
  for (const [root, ids] of members) {
    const sorted = ids.slice().sort((a, b) => (adsL.get(b)?.spend ?? 0) - (adsL.get(a)?.spend ?? 0));
    const primary = sorted[0];
    let info: OriginInfo | null = null;

    const manual = ids.map((id) => ctx.adOwnerById.get(id)).find((o) => o?.originAdsetId)?.originAdsetId ?? null;
    if (manual) info = { adsetId: manual, name: adsetName(manual), source: "manual" };

    const ownAdsets = [...new Set(ids.map((id) => adsL.get(id)!.adsetId))];
    if (!info) {
      const testing = ownAdsets.filter((a) => adsetRole(a) === "testing" && !containers.has(a)).sort((a, b) => firstDateOf(a).localeCompare(firstDateOf(b)));
      if (testing.length) info = { adsetId: testing[0], name: adsetName(testing[0]), source: "testing" };
    }
    if (!info) {
      const key = nameKeyOf.get(primary);
      const byName = key ? (testingByKey.get(key) ?? []).slice().sort((a, b) => firstDateOf(a).localeCompare(firstDateOf(b))) : [];
      if (byName.length) info = { adsetId: byName[0], name: adsetName(byName[0]), source: "name" };
    }
    if (!info) {
      const nonContainer = ownAdsets.filter((a) => !containers.has(a)).sort((a, b) => firstDateOf(a).localeCompare(firstDateOf(b)));
      if (nonContainer.length) info = { adsetId: nonContainer[0], name: adsetName(nonContainer[0]), source: ownAdsets.length > 1 ? "earliest" : "only" };
    }
    if (!info) {
      // Only ever lived inside containers — no test to credit; keep it on itself.
      const a = adsL.get(primary)!.adsetId;
      info = { adsetId: a, name: adsetName(a), source: null };
    }
    originOf.set(root, info);
  }

  return { adsL, adsW, rootOf, members, originOf, containers, groupsInAdset, adsetName, adsetRole };
}

// ─── Ad set view ─────────────────────────────────────────────────────────────

export async function buildLearningLoop(opts: BuildOptions = {}): Promise<LearningLoopData> {
  const ctx = await loadContext(opts);
  const { windowAgg, lifetimeAgg, owners, ownerById, cacheById, campaignById, nameById, assignmentRefs, settings, until, liveCutoff, period } = ctx;
  const groups = buildCreativeGroups(ctx);

  const ids = new Set<string>();
  if (opts.adsetIds) {
    for (const id of opts.adsetIds) ids.add(id);
  } else {
    // Rows with insight rows but no delivery at all in the window are noise
    // (they would all classify as "no distribution → loser").
    for (const [id, w] of windowAgg) if (w.spend > 0 || w.impressions > 0) ids.add(id);
    const fresh = Date.now() - 30 * 86400000;
    for (const o of owners) {
      const belongs = lifetimeAgg.has(o.adsetId) || cacheById.has(o.adsetId) || new Date(o.updatedAt).getTime() > fresh;
      if (!belongs) continue;
      // A linked brief is always shown (so "went live" is visible even before
      // spend); verdict/learnings-only rows are lifetime material.
      if (o.assignmentId) ids.add(o.adsetId);
      else if (period === "lifetime" && (o.verdict || o.learnings)) ids.add(o.adsetId);
    }
    // An origin ad set whose copies are spending now belongs in the window too.
    for (const [root, origin] of groups.originOf) {
      if (!origin.adsetId || ids.has(origin.adsetId)) continue;
      const copiesActive = (groups.members.get(root) ?? []).some((id) => { const w = groups.adsW.get(id); return !!w && (w.spend > 0 || w.impressions > 0) && w.adsetId !== origin.adsetId; });
      if (copiesActive && (lifetimeAgg.has(origin.adsetId) || cacheById.has(origin.adsetId))) ids.add(origin.adsetId);
    }
  }

  // Copies per origin ad set: every ad of a group that runs OUTSIDE its origin.
  const copiesByOrigin = new Map<string, string[]>();
  for (const [root, origin] of groups.originOf) {
    if (!origin.adsetId || origin.source === null) continue;
    for (const id of groups.members.get(root) ?? []) {
      if (groups.adsL.get(id)!.adsetId === origin.adsetId) continue;
      copiesByOrigin.set(origin.adsetId, [...(copiesByOrigin.get(origin.adsetId) ?? []), id]);
    }
  }

  // Top spender per campaign inside the window.
  const campaignSpend = new Map<string, number>();
  const campaignTop = new Map<string, { id: string; spend: number }>();
  for (const id of ids) {
    const w = windowAgg.get(id);
    const cid = w?.campaignId ?? ownerById.get(id)?.campaignId ?? cacheById.get(id)?.campaignId ?? null;
    if (!cid || !w) continue;
    campaignSpend.set(cid, (campaignSpend.get(cid) ?? 0) + w.spend);
    const top = campaignTop.get(cid);
    if (!top || w.spend > top.spend) campaignTop.set(cid, { id, spend: w.spend });
  }

  const spendThreshold = settings.targetCpa * 3;
  const rows: LearningLoopRow[] = [];
  for (const id of ids) {
    const w = windowAgg.get(id);
    const l = lifetimeAgg.get(id);
    const owner = ownerById.get(id);
    const cached = cacheById.get(id);
    const campaignId = w?.campaignId ?? l?.campaignId ?? owner?.campaignId ?? cached?.campaignId ?? null;
    const campaign = campaignId ? campaignById.get(campaignId) : undefined;
    const name = owner?.adsetName || cached?.name || id;
    const assignment = owner?.assignmentId ? assignmentRefs.get(owner.assignmentId) ?? null : null;
    const window = toMetrics(w);
    const lifetime = toMetrics(l);
    const firstEver = lifetime.firstDate ?? (cached?.createdTime ? isoDate(new Date(cached.createdTime)) : null);
    const ageDays = daysBetween(firstEver, until);
    const isTopSpender = campaignId ? campaignTop.get(campaignId)?.id === id : false;
    const campTotal = campaignId ? campaignSpend.get(campaignId) ?? 0 : 0;
    const spendShare = campTotal > 0 ? window.spend / campTotal : 0;
    const isContainer = groups.containers.has(id);
    const { classification, recommendation } = classifyAd(
      { spend: window.spend, roas: window.roas, cpa: window.cpa, purchases: window.purchases, ageDays, isTopSpender, spendShare },
      settings,
    );
    const verdict = (owner?.verdict as Verdict | null) ?? null;
    const judgedInfo = isContainer ? { outcome: "learning" as Outcome, judged: false } : outcomeOf(verdict, classification);
    const role = campaignRole(campaign?.name, name);
    const ncRevenue = ctx.ncMap.get(id)?.newCustomerRevenue ?? 0;

    // Scaling copies credited to this (origin) ad set.
    const copyIds = copiesByOrigin.get(id) ?? [];
    const copies: ScaledCopy[] = copyIds.map((adId) => {
      const lad = groups.adsL.get(adId)!;
      const wad = groups.adsW.get(adId);
      const r = groups.adsetRole(lad.adsetId);
      return {
        adId, name: lad.name ?? adId, status: lad.status, adsetId: lad.adsetId, adsetName: groups.adsetName(lad.adsetId),
        role: r, roleLabel: CAMPAIGN_ROLE_LABEL[r], window: toMetrics(wad), lifetime: toMetrics(lad),
      };
    }).sort((a, b) => b.window.spend - a.window.spend || b.lifetime.spend - a.lifetime.spend);
    const scaledWindow = sumMetrics(copies.map((c) => c.window));
    const scaledLifetime = sumMetrics(copies.map((c) => c.lifetime));

    // For containers: what is inside, and where each creative came from.
    const containerCreatives: ContainerCreative[] = isContainer
      ? [...(groups.groupsInAdset.get(id) ?? [])].map((root) => {
          const memberIds = groups.members.get(root) ?? [];
          const here = memberIds.filter((m) => groups.adsL.get(m)!.adsetId === id);
          const primary = here.slice().sort((a, b) => (groups.adsL.get(b)?.spend ?? 0) - (groups.adsL.get(a)?.spend ?? 0))[0];
          const origin = groups.originOf.get(root)!;
          const pname = groups.adsL.get(primary)?.name ?? primary;
          return {
            key: root, name: pname, hookLabel: hookLabelFromName(pname), adIds: here,
            originAdsetId: origin.adsetId === id ? null : origin.adsetId,
            originAdsetName: origin.adsetId === id ? null : origin.name,
            originSource: origin.adsetId === id ? null : origin.source,
            window: sumMetrics(here.map((m) => toMetrics(groups.adsW.get(m)))),
            lifetime: sumMetrics(here.map((m) => toMetrics(groups.adsL.get(m)))),
          };
        }).sort((a, b) => b.window.spend - a.window.spend)
      : [];

    rows.push({
      adsetId: id,
      name,
      campaignId,
      campaignName: campaign?.name ?? null,
      role,
      roleLabel: CAMPAIGN_ROLE_LABEL[role],
      productLine: assignment?.productName ?? productLine(campaign?.name, name),
      status: cached?.effectiveStatus ?? cached?.status ?? null,
      isLive: !!window.lastDate && window.lastDate >= liveCutoff,
      editorId: owner?.videoEditorId ?? null,
      editorName: owner?.videoEditorId ? nameById.get(owner.videoEditorId) ?? null : assignment?.editorName ?? null,
      strategistId: owner?.creativeStrategistId ?? null,
      strategistName: owner?.creativeStrategistId ? nameById.get(owner.creativeStrategistId) ?? null : assignment?.strategistName ?? strategistFromName(ctx, name),
      format: assignment?.formatName ?? owner?.format ?? null,
      problem: assignment?.problemName ?? owner?.problem ?? null,
      angle: assignment?.angleName ?? owner?.angle ?? null,
      landing: assignment?.landingPage ?? owner?.landing ?? null,
      batch: owner?.batch ?? extractBatchToken(name)?.raw ?? null,
      country: owner?.country ?? null,
      assignment,
      linkSource: owner?.linkSource ?? null,
      window,
      lifetime,
      ageDays,
      ncRoas: window.spend > 0 && ncRevenue > 0 ? ncRevenue / window.spend : null,
      classification,
      recommendation: isContainer ? "Scaling-behållare med creatives från flera briefs — lärdomen bokförs på varje creatives ursprungs-ad set." : recommendation,
      isTopSpender,
      spendShare,
      spendThreshold,
      spendProgress: spendThreshold > 0 ? Math.min(window.spend / spendThreshold, 1) : 0,
      verdict,
      verdictAt: owner?.verdictAt ? new Date(owner.verdictAt).toISOString() : null,
      learnings: owner?.learnings ?? null,
      learningsAt: owner?.learningsAt ? new Date(owner.learningsAt).toISOString() : null,
      graveyardOutcome: owner?.graveyardOutcome ?? null,
      outcome: judgedInfo.outcome,
      judged: judgedInfo.judged,
      ads: (w?.ads ?? l?.ads ?? []).map((ad) => {
        const r = ratios(ad);
        return {
          id: ad.adId, name: ad.name ?? ad.adId, status: ad.status,
          spend: ad.spend, impressions: ad.impressions, purchases: ad.purchases, purchaseValue: ad.purchaseValue,
          roas: r.roas, cpa: r.cpa, ctr: r.ctr, hookRate: r.hookRate, holdRate: r.holdRate,
        };
      }),
      isContainer,
      creativesCount: groups.groupsInAdset.get(id)?.size ?? 0,
      scaled: { window: scaledWindow, lifetime: scaledLifetime, copies },
      total: { window: sumMetrics([window, scaledWindow]), lifetime: sumMetrics([lifetime, scaledLifetime]) },
      containerCreatives,
    });
  }
  rows.sort((a, b) => b.window.spend - a.window.spend || b.lifetime.spend - a.lifetime.spend);

  // ── Pipeline: briefs that are not live (or not linked) yet ───────────────
  const linkedCount = new Map<string, number>();
  for (const o of owners) if (o.assignmentId) linkedCount.set(o.assignmentId, (linkedCount.get(o.assignmentId) ?? 0) + 1);
  for (const o of ctx.adOwnerById.values()) if (o.assignmentId) linkedCount.set(o.assignmentId, (linkedCount.get(o.assignmentId) ?? 0) + 1);
  let proposalsByAssignment = new Map<string, LinkProposal[]>();
  if (opts.withSuggestions !== false && !opts.adsetIds) {
    try {
      const { proposals } = await buildLinkProposals();
      proposalsByAssignment = new Map();
      for (const p of proposals) proposalsByAssignment.set(p.assignmentId, [...(proposalsByAssignment.get(p.assignmentId) ?? []), p]);
    } catch (e) {
      console.error("learning-loop: suggestions failed", e);
    }
  }
  const pipeline: PipelineAssignment[] = ctx.assignmentRows
    .filter((a) => !(linkedCount.get(a.id) ?? 0))
    .map((a) => {
      const ref = assignmentRefs.get(a.id) as LoopAssignmentRef;
      // scriptContent is not needed on the pipeline card and bloats the payload
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { scriptContent: _s, ...rest } = ref;
      return {
        ...rest,
        createdAt: new Date(a.createdAt).toISOString(),
        dueDate: a.dueDate ? new Date(a.dueDate).toISOString() : null,
        priority: a.priority,
        linkedAdsets: 0,
        suggestions: (proposalsByAssignment.get(a.id) ?? []).slice(0, 5),
      };
    })
    .sort((a, b) => (a.status === "posted" ? 0 : 1) - (b.status === "posted" ? 0 : 1) || b.createdAt.localeCompare(a.createdAt));

  // Containers are not tests: they never count in hit rate or breakdowns.
  const tests = rows.filter((r) => !r.isContainer);
  const summary = computeSummary(tests, pipeline.length, pipeline.filter((p) => p.status === "posted").length);
  return { ...envelope(ctx, summary, computeBreakdowns(tests)), rows, pipeline };
}

// ─── Creative view ───────────────────────────────────────────────────────────

const MAX_CREATIVE_ROWS = 1500;

export async function buildCreativeLoop(opts: BuildOptions = {}): Promise<CreativeLoopData> {
  const ctx = await loadContext(opts);
  const { ownerById, cacheById, campaignById, nameById, assignmentRefs, adOwnerById, settings, until, liveCutoff, period } = ctx;
  const groups = buildCreativeGroups(ctx);
  const { adsL, adsW } = groups;

  // ── Which groups to show ─────────────────────────────────────────────────
  const roots = new Set<string>();
  const active = (id: string) => { const w = adsW.get(id); return !!w && (w.spend > 0 || w.impressions > 0); };
  if (opts.assignmentId) {
    for (const [root, ids] of groups.members) {
      const own = ids.map((id) => adOwnerById.get(id)?.assignmentId).find(Boolean);
      const origin = groups.originOf.get(root);
      const viaOrigin = origin?.adsetId ? ownerById.get(origin.adsetId)?.assignmentId : null;
      const viaAny = ids.map((id) => ownerById.get(adsL.get(id)!.adsetId)?.assignmentId).find(Boolean);
      if (own === opts.assignmentId || (!own && (viaOrigin === opts.assignmentId || viaAny === opts.assignmentId))) roots.add(root);
    }
  } else {
    for (const [root, ids] of groups.members) {
      if (ids.some(active)) { roots.add(root); continue; }
      const o = ids.map((id) => adOwnerById.get(id)).find((x) => x && (x.assignmentId || x.verdict || x.learnings || x.script));
      if (o && (o.assignmentId || period === "lifetime")) roots.add(root);
    }
  }

  const spendThreshold = settings.targetCpa * 3;
  const rows: CreativeRow[] = [];
  for (const root of roots) {
    const adIds = groups.members.get(root) ?? [];
    const origin = groups.originOf.get(root)!;
    const ads: CreativeAdRef[] = adIds.map((id) => {
      const l = adsL.get(id)!;
      const w = adsW.get(id);
      const campaignId = l.campaignId ?? ownerById.get(l.adsetId)?.campaignId ?? cacheById.get(l.adsetId)?.campaignId ?? null;
      const campaign = campaignId ? campaignById.get(campaignId) : undefined;
      const role = groups.adsetRole(l.adsetId);
      return {
        adId: id,
        name: l.name ?? id,
        status: l.status,
        adsetId: l.adsetId,
        adsetName: groups.adsetName(l.adsetId),
        campaignId,
        campaignName: campaign?.name ?? null,
        role,
        roleLabel: CAMPAIGN_ROLE_LABEL[role],
        isContainer: groups.containers.has(l.adsetId),
        isOrigin: origin.adsetId === l.adsetId,
        window: toMetrics(w),
        lifetime: toMetrics(l),
      };
    });
    ads.sort((a, b) => b.lifetime.spend - a.lifetime.spend || b.window.spend - a.window.spend);
    const primary = ads[0];
    const window = sumMetrics(ads.map((a) => a.window));
    const lifetime = sumMetrics(ads.map((a) => a.lifetime));
    const adOwners = adIds.map((id) => adOwnerById.get(id)).filter((o): o is NonNullable<typeof o> => !!o);
    const primaryOwner = adOwnerById.get(primary.adId);
    const firstOwnerWith = <K extends keyof NonNullable<typeof primaryOwner>>(k: K) =>
      (primaryOwner?.[k] ?? adOwners.find((o) => o[k])?.[k] ?? null) as NonNullable<typeof primaryOwner>[K] | null;

    // Brief: the ad's own link wins; then the ORIGIN ad set's; then any ad set's.
    let assignment: LoopAssignmentRef | null = null;
    let linkSource: CreativeRow["linkSource"] = null;
    const ownLink = firstOwnerWith("assignmentId");
    if (ownLink && assignmentRefs.has(ownLink)) { assignment = assignmentRefs.get(ownLink)!; linkSource = "ad"; }
    else {
      const candidates = [origin.adsetId, ...ads.map((a) => a.adsetId)].filter((x): x is string => !!x);
      for (const adsetId of candidates) {
        const via = ownerById.get(adsetId)?.assignmentId;
        if (via && assignmentRefs.has(via)) { assignment = assignmentRefs.get(via)!; linkSource = "adset"; break; }
      }
    }

    const originOwner = origin.adsetId ? ownerById.get(origin.adsetId) : undefined;
    const anySetOwner = ads.map((a) => ownerById.get(a.adsetId)).filter((o): o is NonNullable<typeof o> => !!o);
    const parsed = parseAdsetName(stripHookLabel(primary.name), ctx.knownNames);
    const editorId = firstOwnerWith("videoEditorId") ?? originOwner?.videoEditorId ?? anySetOwner.find((o) => o.videoEditorId)?.videoEditorId ?? null;
    const strategistId = firstOwnerWith("creativeStrategistId") ?? originOwner?.creativeStrategistId ?? anySetOwner.find((o) => o.creativeStrategistId)?.creativeStrategistId ?? null;
    const setTag = (k: "format" | "problem" | "angle" | "landing") => originOwner?.[k] ?? anySetOwner.find((o) => o[k])?.[k] ?? null;

    const hookLabel = firstOwnerWith("hookLabel") ?? hookLabelFromName(primary.name);
    const ownScript = firstOwnerWith("script");
    const scriptFromAssignment = scriptTextFor(assignment?.scriptContent, hookLabel);
    const ageDays = daysBetween(lifetime.firstDate, until);
    const { classification, recommendation } = classifyAd(
      { spend: window.spend, roas: window.roas, cpa: window.cpa, purchases: window.purchases, ageDays, isTopSpender: false, spendShare: 0 },
      settings,
    );
    const verdict = (firstOwnerWith("verdict") as Verdict | null) ?? null;
    const { outcome, judged } = outcomeOf(verdict, classification);
    const roles = [...new Set(ads.map((a) => a.role))];

    let suggestion: CreativeSuggestion | null = null;
    if (!assignment) {
      const best = bestMatch(ctx.assignmentsForMatch, parseCandidate(primary.name, primary.campaignName, ctx.knownNames));
      if (best) suggestion = { assignmentId: best.assignment.id, assignmentName: best.assignment.name, assignmentBatch: best.assignment.batchNumber, score: best.match.score, confidence: best.match.high ? "high" : "medium", reasons: best.match.reasons };
    }

    rows.push({
      key: root,
      name: primary.name,
      hookLabel,
      primaryAdId: primary.adId,
      adIds,
      adsetIds: [...new Set(ads.map((a) => a.adsetId))],
      videoIds: [...new Set(adIds.map((id) => adsL.get(id)?.videoId).filter((v): v is string => !!v))],
      roles,
      roleLabel: roles.map((r) => CAMPAIGN_ROLE_LABEL[r]).join(" + "),
      originAdsetId: origin.adsetId,
      originAdsetName: origin.name,
      originSource: origin.source,
      productLine: assignment?.productName ?? productLine(primary.campaignName, primary.name),
      isLive: !!window.lastDate && window.lastDate >= liveCutoff,
      editorName: editorId ? nameById.get(editorId) ?? null : assignment?.editorName ?? parsed.editor,
      strategistName: strategistId ? nameById.get(strategistId) ?? null : assignment?.strategistName ?? strategistFromName(ctx, primary.name),
      format: assignment?.formatName ?? setTag("format") ?? parsed.format,
      problem: assignment?.problemName ?? firstOwnerWith("problem") ?? setTag("problem") ?? parsed.problem,
      angle: assignment?.angleName ?? firstOwnerWith("angle") ?? setTag("angle"),
      landing: assignment?.landingPage ?? setTag("landing") ?? (parsed.landing.length ? parsed.landing.join(" + ") : null),
      assignment,
      linkSource,
      suggestion,
      script: ownScript ?? scriptFromAssignment,
      scriptSource: ownScript ? "own" : scriptFromAssignment ? "assignment" : null,
      scriptFromAssignment,
      window,
      lifetime,
      ageDays,
      classification,
      recommendation,
      spendThreshold,
      spendProgress: spendThreshold > 0 ? Math.min(window.spend / spendThreshold, 1) : 0,
      verdict,
      verdictAt: firstOwnerWith("verdictAt") ? new Date(firstOwnerWith("verdictAt") as Date).toISOString() : null,
      learnings: firstOwnerWith("learnings"),
      learningsAt: firstOwnerWith("learningsAt") ? new Date(firstOwnerWith("learningsAt") as Date).toISOString() : null,
      outcome,
      judged,
      ads,
    });
  }
  rows.sort((a, b) => b.window.spend - a.window.spend || b.lifetime.spend - a.lifetime.spend);
  const truncated = rows.length > MAX_CREATIVE_ROWS;
  const kept = truncated ? rows.slice(0, MAX_CREATIVE_ROWS) : rows;
  return { ...envelope(ctx, computeSummary(kept), computeBreakdowns(kept)), rows: kept, truncated };
}

// ─── One brief's results ─────────────────────────────────────────────────────

/** The ad sets linked to ONE assignment plus its creatives, every account. */
export async function getAssignmentPerformance(assignmentId: string, period: Period = "30d") {
  const linked = await db
    .select({ adsetId: schema.adsetOwners.adsetId })
    .from(schema.adsetOwners)
    .where(eq(schema.adsetOwners.assignmentId, assignmentId));
  const [a] = await db.select({ metaAdsetId: schema.assignments.metaAdsetId }).from(schema.assignments).where(eq(schema.assignments.id, assignmentId)).limit(1);
  const ids = new Set(linked.map((l) => l.adsetId));
  if (a?.metaAdsetId) ids.add(a.metaAdsetId);
  const creativeData = await buildCreativeLoop({ account: "all", period, assignmentId, withSuggestions: false });
  if (ids.size === 0) {
    return { rows: [] as LearningLoopRow[], creatives: creativeData.rows, period: creativeData.period, since: creativeData.since, until: creativeData.until, currency: creativeData.currency };
  }
  const data = await buildLearningLoop({ account: "all", period, adsetIds: [...ids], withSuggestions: false });
  return { rows: data.rows, creatives: creativeData.rows, period: data.period, since: data.since, until: data.until, currency: data.currency };
}

export type { LinkProposal };
