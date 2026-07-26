"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from "recharts";
import {
  Plus,
  SlidersHorizontal,
  Download,
  Pencil,
  Clock,
  Layers,
  CalendarDays,
  Gauge,
  Loader2,
  Inbox,
  ArrowUp,
  ArrowDown,
  BarChart3,
  Table as TableIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Chip } from "@/components/work/work-timer-widget";
import { WORK_SESSION_EVENT } from "@/components/work/work-timer-widget";
import { SessionEditorDialog } from "@/components/work/session-editor-dialog";
import { TaxonomyDialog } from "@/components/work/taxonomy-dialog";
import {
  CHART_SURFACE,
  INK,
  OTHER_COLOR,
  OTHER_LABEL,
  PALETTE_HEXES,
  SERIES_CEILING,
  heatColor,
  paletteRank,
} from "@/lib/work-palette";
import {
  type Bucket,
  type HeatCell,
  type Slice,
  type TrendSeries,
  type WorkSession,
  type WorkTag,
  autoBucket,
  byBrand,
  byCategory,
  byPerson,
  dayKey,
  formatDayLabel,
  formatDuration,
  formatTimeOfDay,
  groupByDay,
  heatmapWeeks,
  startOfDay,
  startOfMonth,
  startOfWeek,
  totalSeconds,
  trendSeries,
  weekdayPattern,
} from "@/lib/work-types";

type Person = { id: string; name: string; email: string };

const OTHER_ID = "__other";

const RANGES = [
  { key: "today", label: "Idag", compare: "igår" },
  { key: "week", label: "Denna vecka", compare: "förra veckan" },
  { key: "month", label: "Denna månad", compare: "förra månaden" },
  { key: "12w", label: "12 veckor", compare: "föregående 12 v" },
  { key: "12m", label: "12 månader", compare: "föregående 12 mån" },
  { key: "all", label: "Allt", compare: null },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

function rangeBounds(key: RangeKey): { from: Date | null; to: Date | null } {
  const tomorrow = startOfDay(1);
  switch (key) {
    case "today":
      return { from: startOfDay(), to: tomorrow };
    case "week":
      return { from: startOfWeek(), to: tomorrow };
    case "month":
      return { from: startOfMonth(), to: tomorrow };
    case "12w":
      return { from: startOfDay(-83), to: tomorrow };
    case "12m": {
      const from = startOfDay();
      from.setMonth(from.getMonth() - 12);
      return { from, to: tomorrow };
    }
    case "all":
      return { from: null, to: null };
  }
}

/** The equally long window immediately before the current one. */
function previousBounds(from: Date | null, to: Date | null): { from: Date; to: Date } | null {
  if (!from || !to) return null;
  const length = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - length), to: new Date(from.getTime()) };
}

export function TimeDashboard({ currentUserId }: { currentUserId: string }) {
  const [range, setRange] = useState<RangeKey>("week");
  const [personId, setPersonId] = useState<string>("");
  const [bucket, setBucket] = useState<Bucket | "auto">("auto");
  const [trendAsTable, setTrendAsTable] = useState(false);

  const [sessions, setSessions] = useState<WorkSession[]>([]);
  const [previous, setPrevious] = useState<WorkSession[]>([]);
  const [categories, setCategories] = useState<WorkTag[]>([]);
  const [brands, setBrands] = useState<WorkTag[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [firstLoad, setFirstLoad] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<WorkSession | null>(null);
  const [taxonomyOpen, setTaxonomyOpen] = useState(false);

  const loadTaxonomy = useCallback(async () => {
    const [cats, brs, ppl] = await Promise.all([
      fetch("/api/work/categories").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/work/brands").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/work/people").then((r) => (r.ok ? r.json() : [])),
    ]).catch(() => [[], [], []]);
    setCategories(cats as WorkTag[]);
    setBrands(brs as WorkTag[]);
    setPeople(ppl as Person[]);
  }, []);

  const loadSessions = useCallback(async () => {
    setRefreshing(true);
    const { from, to } = rangeBounds(range);
    const prev = previousBounds(from, to);

    const query = (a: Date | null, b: Date | null) => {
      const params = new URLSearchParams({ limit: "5000" });
      if (a) params.set("from", a.toISOString());
      if (b) params.set("to", b.toISOString());
      if (personId) params.set("userId", personId);
      return `/api/work/sessions?${params}`;
    };

    try {
      const [current, before] = await Promise.all([
        fetch(query(from, to), { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])),
        prev
          ? fetch(query(prev.from, prev.to), { cache: "no-store" }).then((r) => (r.ok ? r.json() : []))
          : Promise.resolve([]),
      ]);
      setSessions(current as WorkSession[]);
      setPrevious(before as WorkSession[]);
    } finally {
      setFirstLoad(false);
      setRefreshing(false);
    }
  }, [range, personId]);

  useEffect(() => {
    loadTaxonomy();
  }, [loadTaxonomy]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    const handler = () => loadSessions();
    window.addEventListener(WORK_SESSION_EVENT, handler);
    return () => window.removeEventListener(WORK_SESSION_EVENT, handler);
  }, [loadSessions]);

  const activeCategories = useMemo(() => categories.filter((c) => c.isActive), [categories]);
  const activeBrands = useMemo(() => brands.filter((b) => b.isActive), [brands]);

  const bounds = rangeBounds(range);
  const effectiveFrom =
    bounds.from ??
    (sessions.length ? new Date(Math.min(...sessions.map((s) => +new Date(s.startedAt)))) : startOfDay(-27));
  const effectiveTo = bounds.to ?? startOfDay(1);
  const effectiveBucket: Bucket = bucket === "auto" ? autoBucket(effectiveFrom, effectiveTo) : bucket;

  const stats = useMemo(() => {
    const total = totalSeconds(sessions);
    const days = new Set(sessions.map((s) => dayKey(s.startedAt))).size;
    const prevTotal = totalSeconds(previous);
    return {
      total,
      count: sessions.length,
      avgSession: sessions.length ? total / sessions.length : 0,
      activeDays: days,
      avgDay: days ? total / days : 0,
      delta: prevTotal > 0 ? (total - prevTotal) / prevTotal : null,
      prevTotal,
    };
  }, [sessions, previous]);

  const categorySlices = useMemo(() => byCategory(sessions), [sessions]);
  const brandSlices = useMemo(() => byBrand(sessions), [sessions]);
  const personSlices = useMemo(() => byPerson(sessions, PALETTE_HEXES), [sessions]);
  const days = useMemo(() => groupByDay(sessions), [sessions]);

  const trend = useMemo(
    () =>
      trendSeries(
        sessions,
        effectiveFrom,
        effectiveTo,
        effectiveBucket,
        SERIES_CEILING,
        OTHER_ID,
        OTHER_LABEL,
        OTHER_COLOR,
        paletteRank
      ),
    [sessions, effectiveFrom, effectiveTo, effectiveBucket]
  );

  const weekdays = useMemo(() => weekdayPattern(sessions), [sessions]);
  const heat = useMemo(() => heatmapWeeks(sessions, effectiveFrom, effectiveTo), [sessions, effectiveFrom, effectiveTo]);
  const showHeatmap = (effectiveTo.getTime() - effectiveFrom.getTime()) / 86400000 >= 21;

  const compareLabel = RANGES.find((r) => r.key === range)?.compare ?? null;

  function exportCsv() {
    const header = ["Datum", "Start", "Slut", "Timmar", "Person", "Kategori", "Varumärke", "Uppgift", "Kommentar"];
    const rows = sessions.map((s) => [
      dayKey(s.startedAt),
      formatTimeOfDay(s.startedAt),
      s.endedAt ? formatTimeOfDay(s.endedAt) : "",
      (s.elapsedSeconds / 3600).toFixed(2).replace(".", ","),
      s.userName ?? "",
      s.categoryName ?? "",
      s.brandName ?? "",
      s.task ?? "",
      s.note ?? "",
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";"))
      .join("\n");

    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `tid-${range}-${dayKey(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (firstLoad) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-cyan-500" />
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-32">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Time Tracker</h1>
          <p className="text-sm text-slate-500 mt-0.5">Vart tiden faktiskt går — och vad som blev gjort</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
            className="flex items-center gap-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 px-3 py-2 text-xs font-semibold text-[#04202a] transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Lägg till pass
          </button>
          <button
            onClick={() => setTaxonomyOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Kategorier
          </button>
          <button
            onClick={exportCsv}
            disabled={sessions.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-40 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </button>
        </div>
      </div>

      {/* ── One filter row, scoping everything below ────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          options={RANGES.map((r) => ({ value: r.key, label: r.label }))}
          value={range}
          onChange={(v) => setRange(v as RangeKey)}
        />
        {people.length > 1 && (
          <SegmentedControl
            options={[
              { value: "", label: "Alla" },
              ...people.map((p) => ({ value: p.id, label: p.id === currentUserId ? `${p.name} (du)` : p.name })),
            ]}
            value={personId}
            onChange={setPersonId}
          />
        )}
      </div>

      {/* Refetch holds the previous render at reduced opacity — no skeleton flash. */}
      <div className={cn("space-y-5 transition-opacity", refreshing && "opacity-60")}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            icon={Clock}
            label="Total tid"
            value={formatDuration(stats.total)}
            delta={stats.delta}
            deltaLabel={compareLabel}
            accent="text-cyan-400"
          />
          <StatCard icon={Layers} label="Pass" value={String(stats.count)} accent="text-violet-400" />
          <StatCard
            icon={Gauge}
            label="Snitt per task"
            value={stats.count ? formatDuration(stats.avgSession) : "–"}
            accent="text-emerald-400"
          />
          <StatCard
            icon={CalendarDays}
            label="Snitt per aktiv dag"
            value={stats.activeDays ? formatDuration(stats.avgDay) : "–"}
            sub={stats.activeDays ? `${stats.activeDays} aktiva dagar` : undefined}
            accent="text-amber-400"
          />
        </div>

        {sessions.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <TrendPanel
              data={trend}
              bucket={effectiveBucket}
              bucketMode={bucket}
              onBucketChange={setBucket}
              asTable={trendAsTable}
              onToggleTable={() => setTrendAsTable((v) => !v)}
            />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <Breakdown title="Per kategori" subtitle="Andel av perioden" slices={categorySlices} />
              <Breakdown title="Per varumärke" subtitle="Vart krutet går" slices={brandSlices} />
              {personSlices.length > 1 ? (
                <Breakdown title="Per person" subtitle="Fördelning mellan er" slices={personSlices} />
              ) : (
                <TopFocusPanel slices={categorySlices} total={stats.total} />
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <WeekdayPanel data={weekdays} />
              {/* A one-column heat map says nothing — only worth it over a few weeks. */}
              {showHeatmap ? (
                <div className="lg:col-span-2">
                  <ActivityMap weeks={heat} />
                </div>
              ) : personSlices.length > 1 ? (
                <TopFocusPanel slices={categorySlices} total={stats.total} />
              ) : null}
            </div>

            <Panel title="Loggbok" subtitle={`${sessions.length} pass · vad som faktiskt blev gjort`}>
              <div className="space-y-5">
                {days.map((day) => (
                  <div key={day.key}>
                    <div className="flex items-baseline justify-between border-b border-white/5 pb-1.5 mb-2">
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                        {formatDayLabel(day.key)}
                      </span>
                      <span className="text-xs font-medium text-slate-500 tabular-nums">
                        {formatDuration(day.seconds)}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {day.sessions.map((s) => (
                        <LogRow
                          key={s.id}
                          session={s}
                          canEdit={s.userId === currentUserId}
                          showPerson={personSlices.length > 1}
                          onEdit={() => {
                            setEditing(s);
                            setEditorOpen(true);
                          }}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </>
        )}
      </div>

      <SessionEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        session={editing}
        categories={activeCategories}
        brands={activeBrands}
        onSaved={loadSessions}
      />
      <TaxonomyDialog
        open={taxonomyOpen}
        onOpenChange={setTaxonomyOpen}
        categories={categories}
        brands={brands}
        onChanged={() => {
          loadTaxonomy();
          loadSessions();
        }}
      />
    </div>
  );
}

// ── Trend ────────────────────────────────────────────────────────────────────

const BUCKETS: { value: Bucket | "auto"; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "day", label: "Dag" },
  { value: "week", label: "Vecka" },
  { value: "month", label: "Månad" },
];

function TrendPanel({
  data,
  bucket,
  bucketMode,
  onBucketChange,
  asTable,
  onToggleTable,
}: {
  data: { rows: Record<string, string | number>[]; series: TrendSeries[] };
  bucket: Bucket;
  bucketMode: Bucket | "auto";
  onBucketChange: (b: Bucket | "auto") => void;
  asTable: boolean;
  onToggleTable: () => void;
}) {
  const unit = bucket === "day" ? "dag" : bucket === "week" ? "vecka" : "månad";

  return (
    <div className="rounded-xl border border-white/5 bg-[#111827] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Timmar per {unit}</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">Staplat per kategori</p>
        </div>
        <div className="flex items-center gap-2">
          <SegmentedControl
            options={BUCKETS.map((b) => ({ value: b.value, label: b.label }))}
            value={bucketMode}
            onChange={(v) => onBucketChange(v as Bucket | "auto")}
            size="sm"
          />
          <button
            onClick={onToggleTable}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] font-medium text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            title={asTable ? "Visa diagram" : "Visa som tabell"}
          >
            {asTable ? <BarChart3 className="h-3.5 w-3.5" /> : <TableIcon className="h-3.5 w-3.5" />}
            {asTable ? "Diagram" : "Tabell"}
          </button>
        </div>
      </div>

      {/* Legend — identity is never carried by colour alone. */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-3">
        {data.series.map((s) => (
          <span key={s.id} className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
            {s.name}
          </span>
        ))}
      </div>

      {asTable ? (
        <TrendTable data={data} />
      ) : (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.rows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={INK.grid} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: INK.muted, fontSize: 11 }}
                axisLine={{ stroke: INK.axis }}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={16}
              />
              <YAxis
                tick={{ fill: INK.muted, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={34}
                tickFormatter={(v: number) => `${v}h`}
              />
              <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} content={<TrendTooltip />} />
              {data.series.map((s) => (
                <Bar
                  key={s.id}
                  dataKey={s.id}
                  stackId="hours"
                  name={s.name}
                  fill={s.color}
                  maxBarSize={24}
                  /* 2px of surface between touching segments — the gap, not a border. */
                  stroke={CHART_SURFACE}
                  strokeWidth={2}
                  /* Flat caps: which category tops a column varies per bucket, so a
                     per-series radius would round a segment in the middle of a stack. */
                  animationDuration={400}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

type TooltipEntry = { dataKey?: string | number; name?: string; value?: number; color?: string };

function TrendTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<TooltipEntry & { payload?: Record<string, string | number> }>;
}) {
  if (!active || !payload?.length) return null;
  const head = payload[0]?.payload?.full ?? payload[0]?.payload?.label;
  const rows = payload
    .filter((p) => (p.value ?? 0) > 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const total = payload.reduce((sum, p) => sum + (p.value ?? 0), 0);

  return (
    <div className="rounded-lg border border-white/10 bg-[#0f1629] px-3 py-2 shadow-xl">
      <div className={cn("text-[11px] text-slate-400", rows.length > 0 && "mb-1.5")}>{String(head ?? "")}</div>
      {rows.length === 0 && <div className="text-xs text-slate-500">Inget loggat</div>}
      {rows.map((r) => (
        <div key={String(r.dataKey)} className="flex items-center gap-2 text-xs leading-relaxed">
          <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ backgroundColor: r.color }} />
          <span className="font-semibold text-white tabular-nums">{formatDuration((r.value ?? 0) * 3600)}</span>
          <span className="text-slate-400">{r.name}</span>
        </div>
      ))}
      {rows.length > 1 && (
        <div className="mt-1.5 border-t border-white/5 pt-1.5 text-xs">
          <span className="font-semibold text-white tabular-nums">{formatDuration(total * 3600)}</span>
          <span className="ml-2 text-slate-500">totalt</span>
        </div>
      )}
    </div>
  );
}

/** The table twin — every value the chart encodes, in text. */
function TrendTable({ data }: { data: { rows: Record<string, string | number>[]; series: TrendSeries[] } }) {
  const rows = data.rows.filter((r) => data.series.some((s) => (r[s.id] as number) > 0));
  return (
    <div className="max-h-72 overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-[#111827]">
          <tr className="text-left text-slate-500">
            <th className="py-1.5 pr-3 font-medium">Period</th>
            {data.series.map((s) => (
              <th key={s.id} className="py-1.5 px-2 font-medium text-right whitespace-nowrap">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} />
                  {s.name}
                </span>
              </th>
            ))}
            <th className="py-1.5 pl-2 font-medium text-right">Totalt</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map((r) => {
            const total = data.series.reduce((sum, s) => sum + ((r[s.id] as number) ?? 0), 0);
            return (
              <tr key={String(r.key)} className="text-slate-300">
                <td className="py-1.5 pr-3 whitespace-nowrap text-slate-400">{String(r.label)}</td>
                {data.series.map((s) => (
                  <td key={s.id} className="py-1.5 px-2 text-right tabular-nums">
                    {(r[s.id] as number) > 0 ? formatDuration((r[s.id] as number) * 3600) : "–"}
                  </td>
                ))}
                <td className="py-1.5 pl-2 text-right font-semibold text-white tabular-nums">
                  {formatDuration(total * 3600)}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={data.series.length + 2} className="py-6 text-center text-slate-500">
                Inget loggat i perioden
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Activity map ─────────────────────────────────────────────────────────────

function ActivityMap({ weeks }: { weeks: HeatCell[][] }) {
  const [hovered, setHovered] = useState<HeatCell | null>(null);
  const max = Math.max(...weeks.flat().map((c) => c.seconds), 1);
  const dayLabels = ["M", "T", "O", "T", "F", "L", "S"];

  return (
    <Panel
      title="Aktivitetskarta"
      subtitle={`Timmar per dag · ${weeks.length} veckor`}
      action={
        <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
          Mindre
          <span className="flex gap-0.5">
            {[0, 0.2, 0.45, 0.7, 0.95].map((r) => (
              <span
                key={r}
                className="h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: heatColor(r * max, max) }}
              />
            ))}
          </span>
          Mer
        </span>
      }
    >
      <div className="overflow-x-auto pb-1">
        <div className="flex gap-[3px]">
          <div className="flex flex-col gap-[3px] pr-1">
            {dayLabels.map((d, i) => (
              <span key={i} className="h-5 w-3 text-[9px] leading-5 text-slate-600">
                {i % 2 === 0 ? d : ""}
              </span>
            ))}
          </div>
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-[3px]">
              {week.map((cell) => {
                if (cell.seconds < 0) return <span key={cell.key} className="h-5 w-5" />;
                const isHovered = hovered?.key === cell.key;
                return (
                  <button
                    key={cell.key}
                    type="button"
                    onMouseEnter={() => setHovered(cell)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(cell)}
                    onBlur={() => setHovered(null)}
                    className={cn(
                      "h-5 w-5 rounded-sm transition-shadow outline-none",
                      isHovered && "ring-2 ring-white/60"
                    )}
                    style={{ backgroundColor: heatColor(cell.seconds, max) }}
                    aria-label={`${cell.key}: ${formatDuration(cell.seconds)}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-2.5 h-4 text-[11px]">
        {hovered ? (
          <span className="text-slate-300">
            <span className="font-semibold text-white tabular-nums">{formatDuration(hovered.seconds)}</span>
            <span className="ml-2 text-slate-500">
              {hovered.date.toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "long" })}
            </span>
          </span>
        ) : (
          <span className="text-slate-600">Hovra en ruta för dagens tid — alla värden finns i loggboken.</span>
        )}
      </div>
    </Panel>
  );
}

// ── Weekday pattern ──────────────────────────────────────────────────────────

function WeekdayPanel({ data }: { data: { label: string; hours: number }[] }) {
  const empty = data.every((d) => d.hours === 0);
  return (
    <Panel title="Veckodagsmönster" subtitle="När på veckan tiden läggs">
      {empty ? (
        <p className="text-xs text-slate-500">Inget loggat</p>
      ) : (
        <div className="h-[168px] -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 16, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={INK.grid} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: INK.muted, fontSize: 11 }}
                axisLine={{ stroke: INK.axis }}
                tickLine={false}
              />
              <YAxis hide />
              {/* Single series — one hue, no legend needed; the title names it. */}
              <Bar dataKey="hours" fill="#3987e5" maxBarSize={24} radius={[4, 4, 0, 0]}>
                <LabelList
                  dataKey="hours"
                  position="top"
                  formatter={(v: unknown) => (Number(v) > 0 ? formatDuration(Number(v) * 3600) : "")}
                  fill={INK.muted}
                  fontSize={10}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

// ── Building blocks ──────────────────────────────────────────────────────────

function SegmentedControl({
  options,
  value,
  onChange,
  size = "md",
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg bg-white/5 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md font-medium transition-colors",
            size === "sm" ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-xs",
            value === o.value ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Panel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-[#111827] p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          {subtitle && <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  delta,
  deltaLabel,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  delta?: number | null;
  deltaLabel?: string | null;
  accent: string;
}) {
  const showDelta = delta !== null && delta !== undefined && deltaLabel;
  const up = (delta ?? 0) >= 0;
  return (
    <div className="rounded-xl border border-white/5 bg-[#111827] p-4">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
        <Icon className={cn("h-3.5 w-3.5", accent)} />
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-bold text-white">{value}</div>
      {showDelta ? (
        // Neutral ink: more hours is not automatically good or bad.
        <div className="flex items-center gap-1 text-[11px] text-slate-500">
          {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          <span className="tabular-nums">{Math.abs(Math.round((delta ?? 0) * 100))}%</span>
          <span>vs {deltaLabel}</span>
        </div>
      ) : (
        sub && <div className="text-[11px] text-slate-500">{sub}</div>
      )}
    </div>
  );
}

function Breakdown({ title, subtitle, slices }: { title: string; subtitle?: string; slices: Slice[] }) {
  return (
    <Panel title={title} subtitle={subtitle}>
      {slices.length === 0 ? (
        <p className="text-xs text-slate-500">Inget loggat</p>
      ) : (
        <div className="space-y-2.5">
          {slices.map((slice) => (
            <div key={slice.id}>
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} />
                  <span className="truncate text-xs text-slate-300">{slice.name}</span>
                </span>
                <span className="shrink-0 text-xs font-medium text-slate-400 tabular-nums">
                  {formatDuration(slice.seconds)}
                  <span className="ml-1.5 text-slate-600">{Math.round(slice.share * 100)}%</span>
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.max(slice.share * 100, 1.5)}%`, backgroundColor: slice.color }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function TopFocusPanel({ slices, total }: { slices: Slice[]; total: number }) {
  const top = slices[0];
  return (
    <Panel title="Mest tid på" subtitle="Största posten i perioden">
      {!top ? (
        <p className="text-xs text-slate-500">Inget loggat</p>
      ) : (
        <div>
          <div className="text-5xl font-bold text-white">{Math.round(top.share * 100)}%</div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: top.color }} />
            <span className="text-sm text-slate-300">{top.name}</span>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            {formatDuration(top.seconds)} av {formatDuration(total)} i perioden.
          </p>
        </div>
      )}
    </Panel>
  );
}

function LogRow({
  session,
  canEdit,
  showPerson,
  onEdit,
}: {
  session: WorkSession;
  canEdit: boolean;
  showPerson: boolean;
  onEdit: () => void;
}) {
  const open = session.status !== "done";
  return (
    <div
      className={cn(
        "group flex gap-3 rounded-lg border border-transparent px-2.5 py-2 transition-colors hover:border-white/5 hover:bg-white/[0.02]",
        open && "border-emerald-500/20 bg-emerald-500/[0.04]"
      )}
    >
      <div className="w-24 shrink-0 pt-0.5 text-[11px] text-slate-500 tabular-nums">
        {formatTimeOfDay(session.startedAt)}
        {session.endedAt ? `–${formatTimeOfDay(session.endedAt)}` : " –"}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip color={session.categoryColor} label={session.categoryName ?? "Okänd"} />
          {session.brandName && <Chip color={session.brandColor} label={session.brandName} />}
          {showPerson && session.userName && (
            <span className="text-[11px] text-slate-500">{session.userName}</span>
          )}
          {session.source === "manual" && (
            <span className="text-[10px] uppercase tracking-wider text-slate-600">manuellt</span>
          )}
          {open && (
            <span className="text-[10px] uppercase tracking-wider text-emerald-400">
              {session.status === "paused" ? "pausad" : "pågår"}
            </span>
          )}
        </div>

        {session.task && <div className="mt-1 text-xs font-medium text-slate-300">{session.task}</div>}

        <p className={cn("mt-0.5 text-xs leading-relaxed", session.note ? "text-slate-400" : "text-slate-600 italic")}>
          {session.note ?? "Ingen kommentar än — läggs när passet stoppas"}
        </p>
      </div>

      <div className="flex shrink-0 items-start gap-2">
        <span className="pt-0.5 text-xs font-semibold text-slate-300 tabular-nums">
          {formatDuration(session.elapsedSeconds)}
        </span>
        {canEdit && session.status === "done" && (
          <button
            onClick={onEdit}
            className="rounded p-1 text-slate-600 opacity-0 transition-opacity hover:text-cyan-400 group-hover:opacity-100 focus:opacity-100"
            title="Redigera"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-white/10 bg-[#111827]/50 py-16 text-center">
      <Inbox className="mx-auto h-8 w-8 text-slate-600" />
      <p className="mt-3 text-sm font-medium text-slate-400">Inget loggat i perioden</p>
      <p className="mt-1 text-xs text-slate-600">
        Starta timern nere till höger — den följer med på alla sidor.
      </p>
    </div>
  );
}
