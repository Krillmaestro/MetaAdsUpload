// Client-safe types + formatting for the founder time tracker.
// (No server imports here — this file is pulled into client components.)

export interface WorkSession {
  id: string;
  userId: string;
  userName: string | null;
  categoryId: string;
  categoryName: string | null;
  categoryColor: string | null;
  brandId: string | null;
  brandName: string | null;
  brandColor: string | null;
  task: string | null;
  note: string | null;
  startedAt: string;
  endedAt: string | null;
  segmentStartedAt: string | null;
  accumulatedSeconds: number;
  durationSeconds: number | null;
  status: "running" | "paused" | "done";
  source: "timer" | "manual";
  elapsedSeconds: number;
}

export interface WorkTag {
  id: string;
  name: string;
  color: string;
  isActive: boolean;
  sortOrder: number;
}

export const MIN_NOTE_LENGTH = 10;
export const UNTAGGED_BRAND = "Otaggat";
export const UNTAGGED_COLOR = "#475569";

/** 01:23:45 — for the live clock. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
}

/** 2h 15m — for totals. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** 2,5 h — for chart axes and compact stats. */
export function formatHours(seconds: number): string {
  return `${(seconds / 3600).toFixed(1).replace(".", ",")} h`;
}

/** Local-time day key, e.g. "2026-07-25". */
export function dayKey(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleDateString("sv-SE");
}

export function formatTimeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
}

export function formatDayLabel(key: string): string {
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86400000));
  if (key === today) return "Idag";
  if (key === yesterday) return "Igår";
  const d = new Date(`${key}T12:00:00`);
  return d.toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "short" });
}

/** Local midnight, `offsetDays` from today. */
export function startOfDay(offsetDays = 0): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d;
}

export function startOfMonth(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** Monday-based start of the current week. */
export function startOfWeek(): Date {
  const d = startOfDay();
  const weekday = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - weekday);
  return d;
}

export interface Slice {
  id: string;
  name: string;
  color: string;
  seconds: number;
  sessions: number;
  share: number;
}

function toSlices(map: Map<string, Omit<Slice, "share">>): Slice[] {
  const total = [...map.values()].reduce((sum, s) => sum + s.seconds, 0) || 1;
  return [...map.values()]
    .map((s) => ({ ...s, share: s.seconds / total }))
    .sort((a, b) => b.seconds - a.seconds);
}

export function byCategory(sessions: WorkSession[]): Slice[] {
  const map = new Map<string, Omit<Slice, "share">>();
  for (const s of sessions) {
    const key = s.categoryId;
    const current = map.get(key) ?? {
      id: key,
      name: s.categoryName ?? "Okänd",
      color: s.categoryColor ?? UNTAGGED_COLOR,
      seconds: 0,
      sessions: 0,
    };
    current.seconds += s.elapsedSeconds;
    current.sessions += 1;
    map.set(key, current);
  }
  return toSlices(map);
}

export function byBrand(sessions: WorkSession[]): Slice[] {
  const map = new Map<string, Omit<Slice, "share">>();
  for (const s of sessions) {
    const key = s.brandId ?? "__none";
    const current = map.get(key) ?? {
      id: key,
      name: s.brandName ?? UNTAGGED_BRAND,
      color: s.brandColor ?? UNTAGGED_COLOR,
      seconds: 0,
      sessions: 0,
    };
    current.seconds += s.elapsedSeconds;
    current.sessions += 1;
    map.set(key, current);
  }
  return toSlices(map);
}

export function byPerson(sessions: WorkSession[], palette: string[]): Slice[] {
  const map = new Map<string, Omit<Slice, "share">>();
  for (const s of sessions) {
    const current = map.get(s.userId) ?? {
      id: s.userId,
      name: s.userName ?? "Okänd",
      color: palette[map.size % palette.length],
      seconds: 0,
      sessions: 0,
    };
    current.seconds += s.elapsedSeconds;
    current.sessions += 1;
    map.set(s.userId, current);
  }
  return toSlices(map);
}

export function totalSeconds(sessions: WorkSession[]): number {
  return sessions.reduce((sum, s) => sum + s.elapsedSeconds, 0);
}

/** Sessions grouped by local day, newest day first. */
export function groupByDay(sessions: WorkSession[]): { key: string; sessions: WorkSession[]; seconds: number }[] {
  const map = new Map<string, WorkSession[]>();
  for (const s of sessions) {
    const key = dayKey(s.startedAt);
    map.set(key, [...(map.get(key) ?? []), s]);
  }
  return [...map.entries()]
    .map(([key, items]) => ({
      key,
      sessions: items.sort((a, b) => +new Date(b.startedAt) - +new Date(a.startedAt)),
      seconds: totalSeconds(items),
    }))
    .sort((a, b) => (a.key < b.key ? 1 : -1));
}

// ── Time bucketing (day / week / month) ──────────────────────────────────────

export type Bucket = "day" | "week" | "month";

/** Monday of the week `date` falls in. */
export function weekStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/** ISO week number — what "v. 31" means to a Swede. */
export function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function bucketStart(date: Date, bucket: Bucket): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  if (bucket === "week") return weekStart(d);
  if (bucket === "month") return new Date(d.getFullYear(), d.getMonth(), 1);
  return d;
}

export function bucketKey(date: Date, bucket: Bucket): string {
  return dayKey(bucketStart(date, bucket));
}

export function bucketLabel(date: Date, bucket: Bucket): string {
  if (bucket === "week") return `v.${isoWeek(date)}`;
  if (bucket === "month") return date.toLocaleDateString("sv-SE", { month: "short" });
  return date.toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
}

/** Full label for tooltips — the axis tick is abbreviated, the tooltip is not. */
export function bucketFullLabel(date: Date, bucket: Bucket): string {
  if (bucket === "week") {
    const end = new Date(date);
    end.setDate(end.getDate() + 6);
    return `Vecka ${isoWeek(date)} · ${date.toLocaleDateString("sv-SE", { day: "numeric", month: "short" })}–${end.toLocaleDateString("sv-SE", { day: "numeric", month: "short" })}`;
  }
  if (bucket === "month") return date.toLocaleDateString("sv-SE", { month: "long", year: "numeric" });
  return date.toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "long" });
}

function advance(date: Date, bucket: Bucket): void {
  if (bucket === "month") date.setMonth(date.getMonth() + 1);
  else date.setDate(date.getDate() + (bucket === "week" ? 7 : 1));
}

/** Pick a sensible granularity for a range length so buckets stay readable. */
export function autoBucket(from: Date, to: Date): Bucket {
  const days = (to.getTime() - from.getTime()) / 86400000;
  if (days <= 45) return "day";
  if (days <= 200) return "week"; // a year of weekly bars is 52 columns — too many
  return "month";
}

export interface TrendSeries {
  id: string;
  name: string;
  color: string;
}

export interface TrendData {
  rows: Record<string, string | number>[];
  series: TrendSeries[];
}

/**
 * One row per bucket, hours per series. Series are the categories present,
 * with everything past the ceiling folded into a single neutral "Övrigt" —
 * a chart never carries more hues than the palette can keep distinguishable.
 */
export function trendSeries(
  sessions: WorkSession[],
  from: Date,
  to: Date,
  bucket: Bucket,
  ceiling: number,
  otherId: string,
  otherLabel: string,
  otherColor: string,
  rank: (hex: string) => number
): TrendData {
  const ranked = byCategory(sessions);

  // Keep the top slice, but never two series wearing the same hue — if a
  // custom category duplicates a colour, the smaller one folds into "Övrigt".
  // (Folding, not recolouring: whoever is on screen keeps their own colour.)
  const kept: Slice[] = [];
  const usedColors = new Set<string>();
  const folded = new Set<string>();
  for (const c of ranked) {
    const color = c.color.toLowerCase();
    if (kept.length < ceiling && !usedColors.has(color)) {
      kept.push(c);
      usedColors.add(color);
    } else {
      folded.add(c.id);
    }
  }

  // Stack order follows the palette, not size — so touching segments are the
  // pairs the palette was validated on, and the order doesn't jump per period.
  const series: TrendSeries[] = kept
    .map((c) => ({ id: c.id, name: c.name, color: c.color }))
    .sort((a, b) => rank(a.color) - rank(b.color));
  if (folded.size > 0) series.push({ id: otherId, name: otherLabel, color: otherColor });

  const rows: Record<string, string | number>[] = [];
  const cursor = bucketStart(from, bucket);
  const end = bucketStart(new Date(Math.min(to.getTime(), Date.now())), bucket);

  let guard = 0;
  while (cursor <= end && guard < 200) {
    const row: Record<string, string | number> = {
      key: dayKey(cursor),
      label: bucketLabel(cursor, bucket),
      full: bucketFullLabel(cursor, bucket),
    };
    for (const s of series) row[s.id] = 0;
    rows.push(row);
    advance(cursor, bucket);
    guard++;
  }

  const index = new Map(rows.map((r) => [r.key as string, r]));
  for (const s of sessions) {
    const row = index.get(bucketKey(new Date(s.startedAt), bucket));
    if (!row) continue;
    const id = folded.has(s.categoryId) ? otherId : s.categoryId;
    if (!(id in row)) continue;
    row[id] = (row[id] as number) + s.elapsedSeconds / 3600;
  }

  return { rows, series };
}

/** Hours per weekday, Monday-first — "när på veckan går tiden?". */
export function weekdayPattern(sessions: WorkSession[]): { label: string; hours: number }[] {
  const labels = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];
  const totals = new Array(7).fill(0);
  for (const s of sessions) {
    const weekday = (new Date(s.startedAt).getDay() + 6) % 7;
    totals[weekday] += s.elapsedSeconds / 3600;
  }
  return labels.map((label, i) => ({ label, hours: totals[i] }));
}

export interface HeatCell {
  key: string;
  date: Date;
  seconds: number;
}

/** Day cells grouped into Monday-first week columns for the activity map. */
export function heatmapWeeks(sessions: WorkSession[], from: Date, to: Date, maxWeeks = 27): HeatCell[][] {
  const perDay = new Map<string, number>();
  for (const s of sessions) {
    const key = dayKey(s.startedAt);
    perDay.set(key, (perDay.get(key) ?? 0) + s.elapsedSeconds);
  }

  const end = new Date(Math.min(to.getTime(), Date.now()));
  end.setHours(0, 0, 0, 0);
  let start = weekStart(from);
  const earliestAllowed = weekStart(new Date(end.getTime() - (maxWeeks - 1) * 7 * 86400000));
  if (start < earliestAllowed) start = earliestAllowed;

  const weeks: HeatCell[][] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const week: HeatCell[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(cursor);
      date.setDate(date.getDate() + i);
      const key = dayKey(date);
      week.push({ key, date, seconds: date > end ? -1 : (perDay.get(key) ?? 0) });
    }
    weeks.push(week);
    cursor.setDate(cursor.getDate() + 7);
  }

  // Drop leading empty weeks — a wide range shouldn't open with blank columns.
  while (weeks.length > 1 && weeks[0].every((c) => c.seconds <= 0)) weeks.shift();
  return weeks;
}
