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

export function byPerson(sessions: WorkSession[]): Slice[] {
  const palette = ["#22d3ee", "#f472b6", "#facc15", "#4ade80"];
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

/** One row per day in the range, each with hours per category — feeds the stacked chart. */
export function dailySeries(
  sessions: WorkSession[],
  from: Date,
  to: Date
): { rows: Record<string, string | number>[]; categories: { id: string; name: string; color: string }[] } {
  const categories = byCategory(sessions).map((c) => ({ id: c.id, name: c.name, color: c.color }));

  const rows: Record<string, string | number>[] = [];
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(Math.min(to.getTime(), Date.now()));

  // Cap at ~92 buckets so a wide custom range can't melt the chart.
  let guard = 0;
  while (cursor <= end && guard < 92) {
    const key = dayKey(cursor);
    const row: Record<string, string | number> = {
      day: key,
      label: cursor.toLocaleDateString("sv-SE", { day: "numeric", month: "short" }),
    };
    for (const c of categories) row[c.id] = 0;
    rows.push(row);
    cursor.setDate(cursor.getDate() + 1);
    guard++;
  }

  const index = new Map(rows.map((r) => [r.day as string, r]));
  for (const s of sessions) {
    const row = index.get(dayKey(s.startedAt));
    if (!row) continue;
    row[s.categoryId] = ((row[s.categoryId] as number) ?? 0) + s.elapsedSeconds / 3600;
  }

  return { rows, categories };
}
