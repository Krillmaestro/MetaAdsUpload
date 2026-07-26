import { z } from "zod";

// Shape of one LogRocket pull.
//
// The unit of storage is a DAY, not a period. Every dimension LogRocket can
// break out daily is stored per day, so the page can total any date range the
// user picks — this week, last week, a single day — instead of being locked to
// the window the pull happened to cover.
//
// Dimensions LogRocket only exposes as a period aggregate (clicked elements,
// FAQ opens, issues) live under `period` and are labelled as such in the UI.
// Pretending they were daily would be a lie the totals could not support.
//
// Derived figures (shares, CTA cut-through) are computed at render time and
// deliberately never stored: a stored percentage can silently disagree with
// the counts it came from.

export const PAYLOAD_VERSION = 2;

/** Browser/OS/page names → session count for that day. */
const countsSchema = z.record(z.string(), z.number());

export const daySchema = z.object({
  date: z.string(), // YYYY-MM-DD
  sessions: z.number(),
  /** Still being recorded — rendered at reduced opacity, flagged in tooltips. */
  partial: z.boolean().optional(),
  browsers: countsSchema,
  operatingSystems: countsSchema,
  /** Ordered duration bins. Keys are fixed; see DURATION_BINS. */
  duration: z.object({
    lt5: z.number(),
    s5to30: z.number(),
    s30to120: z.number(),
    gt120: z.number(),
  }),
  /** Sessions that visited each tracked path at least once. */
  pages: countsSchema,
});

export const rowSchema = z.object({
  label: z.string(),
  value: z.number(),
  note: z.string().optional(),
});

export const pageMetaSchema = z.object({
  path: z.string(),
  role: z.string(),
  /** Sessions in which any click was recorded — denominator for cut-through. */
  clickSessions: z.number().nullable(),
  /** Of those, how many pressed the page's main CTA. */
  ctaClicks: z.number().nullable(),
  status: z.enum(["good", "warning", "critical", "neutral"]),
  note: z.string(),
});

export const blockerSchema = z.object({
  title: z.string(),
  where: z.string(),
  events: z.number(),
  severity: z.enum(["critical", "serious", "warning", "good"]),
  verdict: z.string(),
  eatsMoney: z.boolean(),
});

export const noteSchema = z.object({ title: z.string(), body: z.string() });

export const payloadSchema = z.object({
  version: z.number().optional(),
  source: z.object({
    project: z.string(),
    site: z.string(),
    windowStart: z.string(),
    windowEnd: z.string(),
  }),
  caveats: z.array(noteSchema),
  /** The daily facts. Everything the period selector totals comes from here. */
  days: z.array(daySchema),
  /** Period aggregates LogRocket cannot break out by day. */
  period: z.object({
    pages: z.array(pageMetaSchema),
    clicksSitewide: z.array(rowSchema),
    clicksPdp: z.array(rowSchema),
    clicksListicle: z.array(rowSchema),
    objections: z.array(rowSchema.extend({ kind: z.enum(["förtroende", "produkt"]) })),
    blockers: z.array(blockerSchema),
    frustration: z.object({ rageClicks: z.number(), deadClicks: z.number(), verdict: z.string() }),
  }),
  conclusions: z.array(z.object({ heading: z.string(), body: z.string() })),
  nextTests: z.array(noteSchema),
});

export type Row = z.infer<typeof rowSchema>;
export type Day = z.infer<typeof daySchema>;
export type PageMeta = z.infer<typeof pageMetaSchema>;
export type Blocker = z.infer<typeof blockerSchema>;
export type LogRocketPayload = z.infer<typeof payloadSchema>;

export const DURATION_BINS = [
  { key: "lt5", label: "under 5 sek" },
  { key: "s5to30", label: "5–30 sek" },
  { key: "s30to120", label: "30–120 sek" },
  { key: "gt120", label: "över 120 sek" },
] as const;

/** Facebook and Instagram webviews — the browsers that never leave the app. */
export const IN_APP_BROWSERS = ["Facebook", "Instagram"];
export const UNIDENTIFIED = "Ej identifierad";

/* ── Snapshots ──────────────────────────────────────────────────────────── */

export const SNAPSHOT_SOURCES = ["mcp", "manual", "seed"] as const;
export type SnapshotSource = (typeof SNAPSHOT_SOURCES)[number];

export const SOURCE_LABEL: Record<SnapshotSource, string> = {
  mcp: "Gene · MCP-hämtning",
  manual: "Manuell inklistring",
  seed: "Första version",
};

export type SnapshotMeta = {
  id: string;
  label: string | null;
  source: SnapshotSource;
  windowStart: string;
  windowEnd: string;
  capturedAt: string;
  createdByName: string | null;
};

export type Snapshot = SnapshotMeta & { payload: LogRocketPayload };

/* ── Period selection ───────────────────────────────────────────────────── */

export type Range = { from: string; to: string };

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shift(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

/** Monday-based week start, matching Swedish convention. */
function weekStart(base: Date): Date {
  const d = new Date(base);
  const weekday = (d.getDay() + 6) % 7;
  return shift(d, -weekday);
}

export type PresetKey = "today" | "yesterday" | "last7" | "thisWeek" | "lastWeek" | "all" | "custom";

export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "today", label: "Idag" },
  { key: "yesterday", label: "Igår" },
  { key: "last7", label: "7 dagar" },
  { key: "thisWeek", label: "Denna vecka" },
  { key: "lastWeek", label: "Förra veckan" },
  { key: "all", label: "Hela perioden" },
];

/**
 * Resolve a preset against a reference date. `all` spans whatever the payload
 * actually covers, so it never invents days that were never recorded.
 */
export function resolvePreset(key: PresetKey, payload: LogRocketPayload, today = new Date()): Range {
  const dates = payload.days.map((d) => d.date).sort();
  const first = dates[0] ?? iso(today);
  const last = dates[dates.length - 1] ?? iso(today);

  switch (key) {
    case "today":
      return { from: iso(today), to: iso(today) };
    case "yesterday": {
      const y = iso(shift(today, -1));
      return { from: y, to: y };
    }
    case "last7":
      return { from: iso(shift(today, -6)), to: iso(today) };
    case "thisWeek":
      return { from: iso(weekStart(today)), to: iso(today) };
    case "lastWeek": {
      const start = shift(weekStart(today), -7);
      return { from: iso(start), to: iso(shift(start, 6)) };
    }
    default:
      return { from: first, to: last };
  }
}

export function daysInRange(payload: LogRocketPayload, range: Range): Day[] {
  return payload.days
    .filter((d) => d.date >= range.from && d.date <= range.to)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/* ── Aggregation ────────────────────────────────────────────────────────── */

function mergeCounts(days: Day[], pick: (d: Day) => Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const day of days) {
    for (const [key, value] of Object.entries(pick(day))) {
      out[key] = (out[key] ?? 0) + value;
    }
  }
  return out;
}

function toRows(counts: Record<string, number>, renameBlank = UNIDENTIFIED): Row[] {
  return Object.entries(counts)
    .map(([label, value]) => ({ label: label || renameBlank, value }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
}

/** Everything the page renders for the selected range, from the daily facts alone. */
export function aggregate(days: Day[]) {
  const sessions = days.reduce((t, d) => t + d.sessions, 0);

  const browserCounts = mergeCounts(days, (d) => d.browsers);
  const browsers = toRows(browserCounts);

  const inApp = IN_APP_BROWSERS.reduce((t, name) => t + (browserCounts[name] ?? 0), 0);
  const unidentified = browserCounts[""] ?? 0;
  const realBrowser = Math.max(0, sessions - inApp - unidentified);

  const duration = DURATION_BINS.map((bin) => ({
    label: bin.label,
    value: days.reduce((t, d) => t + d.duration[bin.key], 0),
  }));
  const durationTotal = duration.reduce((t, b) => t + b.value, 0);
  const short = duration[0].value + duration[1].value;

  return {
    sessions,
    days,
    browsers,
    operatingSystems: toRows(mergeCounts(days, (d) => d.operatingSystems)),
    pages: mergeCounts(days, (d) => d.pages),
    duration,
    durationTotal,
    environment: [
      { label: "In-app (Facebook + Instagram)", value: inApp },
      { label: "Riktig webbläsare", value: realBrowser },
      { label: UNIDENTIFIED, value: unidentified },
    ].filter((g) => g.value > 0),
    inAppShare: sessions ? inApp / sessions : 0,
    shortShare: durationTotal ? short / durationTotal : 0,
    longShare: durationTotal ? duration[3].value / durationTotal : 0,
  };
}

export type Aggregated = ReturnType<typeof aggregate>;

export function ctaShare(page: PageMeta): number | null {
  if (!page.clickSessions || page.ctaClicks === null) return null;
  return page.ctaClicks / page.clickSessions;
}

/* ── How much the numbers can actually carry ────────────────────────────── */

/**
 * Wilson score interval — correct at the sample sizes we work with. The normal
 * approximation produces impossible bounds (below 0, above 1) when n is small
 * and the rate is near an edge, which is exactly our situation.
 */
export function wilson(successes: number, n: number, z = 1.96): { p: number; lo: number; hi: number } | null {
  if (!n) return null;
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { p, lo: Math.max(0, centre - margin), hi: Math.min(1, centre + margin) };
}

export type Strength = "none" | "thin" | "early" | "readable";

export const STRENGTH_META: Record<Strength, { label: string; hex: string; blurb: string }> = {
  none: { label: "Ingen data", hex: "#64748b", blurb: "Inga klick registrerade — ingenting går att säga." },
  thin: { label: "För tunt", hex: "#64748b", blurb: "Under 30 klickande sessioner. Läs som en anekdot, inte som ett resultat." },
  early: { label: "Tidig signal", hex: "#fab219", blurb: "30–99 klickande sessioner. Riktningen kan vara verklig, siffran är det inte." },
  readable: { label: "Läsbar", hex: "#0ca30c", blurb: "100+ klickande sessioner. Punktvärdet börjar hålla." },
};

/** Deliberately about the DENOMINATOR, never the rate — a flattering rate on 12 sessions is still noise. */
export function strengthOf(n: number | null): Strength {
  if (!n) return "none";
  if (n < 30) return "thin";
  if (n < 100) return "early";
  return "readable";
}

/** Click-sessions needed to pin a rate to ±margin at 95%. Drives the "how much longer?" hint. */
export function sampleNeeded(rate: number, margin: number, z = 1.96): number {
  return Math.ceil(((z * z) * rate * (1 - rate)) / (margin * margin));
}

/** Two rates differ only if their intervals do not overlap. */
export function separated(a: PageMeta, b: PageMeta): boolean {
  const wa = a.clickSessions && a.ctaClicks !== null ? wilson(a.ctaClicks, a.clickSessions) : null;
  const wb = b.clickSessions && b.ctaClicks !== null ? wilson(b.ctaClicks, b.clickSessions) : null;
  if (!wa || !wb) return false;
  return wa.lo > wb.hi || wb.lo > wa.hi;
}
