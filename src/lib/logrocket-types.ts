import { z } from "zod";

// Shape of one LogRocket pull. Every snapshot stored in `logrocket_snapshots`
// validates against this, so an older version always renders — the page never
// has to guess whether a field existed when the snapshot was taken.
//
// Derived figures (CTA cut-through, shares, totals) are computed at render time
// and deliberately NOT stored: a stored percentage can silently disagree with
// the counts it came from.

export const rowSchema = z.object({
  label: z.string(),
  value: z.number(),
  note: z.string().optional(),
});

export const dayPointSchema = z.object({
  day: z.string(),
  label: z.string(),
  sessions: z.number(),
  partial: z.boolean().optional(),
});

export const pageSchema = z.object({
  path: z.string(),
  role: z.string(),
  sessions: z.number(),
  /** Sessions in which any click was recorded — the denominator for cut-through. */
  clickSessions: z.number().nullable(),
  /** Of those, how many pressed the page's main CTA. */
  ctaClicks: z.number().nullable(),
  status: z.enum(["good", "warning", "critical", "neutral"]),
  note: z.string(),
});

export const objectionSchema = rowSchema.extend({
  kind: z.enum(["förtroende", "produkt"]),
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
  source: z.object({
    project: z.string(),
    site: z.string(),
    windowStart: z.string(),
    windowEnd: z.string(),
    recordedDays: z.number(),
  }),
  caveats: z.array(noteSchema),
  sessionsPerDay: z.array(dayPointSchema),
  environmentGroups: z.array(rowSchema),
  browsers: z.array(rowSchema),
  operatingSystems: z.array(rowSchema),
  sessionLength: z.array(rowSchema),
  pages: z.array(pageSchema),
  clicksSitewide: z.array(rowSchema),
  clicksPdp: z.array(rowSchema),
  clicksListicle: z.array(rowSchema),
  objections: z.array(objectionSchema),
  blockers: z.array(blockerSchema),
  frustration: z.object({
    rageClicks: z.number(),
    deadClicks: z.number(),
    verdict: z.string(),
  }),
  conclusions: z.array(z.object({ heading: z.string(), body: z.string() })),
  nextTests: z.array(noteSchema),
});

export type Row = z.infer<typeof rowSchema>;
export type DayPoint = z.infer<typeof dayPointSchema>;
export type PageRow = z.infer<typeof pageSchema>;
export type Objection = z.infer<typeof objectionSchema>;
export type Blocker = z.infer<typeof blockerSchema>;
export type LogRocketPayload = z.infer<typeof payloadSchema>;

/** How a snapshot got into the table — shown in the version picker. */
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

/* ── Derived figures — one definition, used by both the page and the deltas ── */

export function ctaShare(page: PageRow): number | null {
  if (!page.clickSessions || page.ctaClicks === null) return null;
  return page.ctaClicks / page.clickSessions;
}

function sum(rows: { value: number }[]): number {
  return rows.reduce((total, r) => total + r.value, 0);
}

/** The four figures the header compares between versions. */
export function headline(payload: LogRocketPayload) {
  const envTotal = sum(payload.environmentGroups);
  const lengthTotal = sum(payload.sessionLength);
  const inApp = payload.environmentGroups[0]?.value ?? 0;
  const short = (payload.sessionLength[0]?.value ?? 0) + (payload.sessionLength[1]?.value ?? 0);
  const pdp = payload.pages.find((p) => p.role === "PDP");

  return {
    sessions: payload.sessionsPerDay.reduce((total, d) => total + d.sessions, 0),
    inAppShare: envTotal ? inApp / envTotal : 0,
    shortShare: lengthTotal ? short / lengthTotal : 0,
    pdpCta: pdp ? (ctaShare(pdp) ?? 0) : 0,
    moneyEaters: payload.blockers.filter((b) => b.eatsMoney).length,
  };
}

export type Headline = ReturnType<typeof headline>;
