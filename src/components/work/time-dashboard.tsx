"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Chip } from "@/components/work/work-timer-widget";
import { WORK_SESSION_EVENT } from "@/components/work/work-timer-widget";
import { SessionEditorDialog } from "@/components/work/session-editor-dialog";
import { TaxonomyDialog } from "@/components/work/taxonomy-dialog";
import {
  type WorkSession,
  type WorkTag,
  type Slice,
  byBrand,
  byCategory,
  byPerson,
  dailySeries,
  dayKey,
  formatDayLabel,
  formatDuration,
  formatHours,
  formatTimeOfDay,
  groupByDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
  totalSeconds,
} from "@/lib/work-types";

type Person = { id: string; name: string; email: string };

const RANGES = [
  { key: "today", label: "Idag" },
  { key: "week", label: "Denna vecka" },
  { key: "30d", label: "30 dagar" },
  { key: "month", label: "Denna månad" },
  { key: "all", label: "Allt" },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

function rangeBounds(key: RangeKey): { from: Date | null; to: Date | null } {
  const tomorrow = startOfDay(1);
  switch (key) {
    case "today":
      return { from: startOfDay(), to: tomorrow };
    case "week":
      return { from: startOfWeek(), to: tomorrow };
    case "30d":
      return { from: startOfDay(-29), to: tomorrow };
    case "month":
      return { from: startOfMonth(), to: tomorrow };
    case "all":
      return { from: null, to: null };
  }
}

export function TimeDashboard({ currentUserId }: { currentUserId: string }) {
  const [range, setRange] = useState<RangeKey>("week");
  const [personId, setPersonId] = useState<string>("");
  const [sessions, setSessions] = useState<WorkSession[]>([]);
  const [categories, setCategories] = useState<WorkTag[]>([]);
  const [brands, setBrands] = useState<WorkTag[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);

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
    const { from, to } = rangeBounds(range);
    const params = new URLSearchParams();
    if (from) params.set("from", from.toISOString());
    if (to) params.set("to", to.toISOString());
    if (personId) params.set("userId", personId);

    try {
      const res = await fetch(`/api/work/sessions?${params}`, { cache: "no-store" });
      if (res.ok) setSessions((await res.json()) as WorkSession[]);
    } finally {
      setLoading(false);
    }
  }, [range, personId]);

  useEffect(() => {
    loadTaxonomy();
  }, [loadTaxonomy]);

  useEffect(() => {
    setLoading(true);
    loadSessions();
  }, [loadSessions]);

  // Live-refresh when the widget starts/stops something.
  useEffect(() => {
    const handler = () => loadSessions();
    window.addEventListener(WORK_SESSION_EVENT, handler);
    return () => window.removeEventListener(WORK_SESSION_EVENT, handler);
  }, [loadSessions]);

  const activeCategories = useMemo(() => categories.filter((c) => c.isActive), [categories]);
  const activeBrands = useMemo(() => brands.filter((b) => b.isActive), [brands]);

  const stats = useMemo(() => {
    const total = totalSeconds(sessions);
    const days = new Set(sessions.map((s) => dayKey(s.startedAt))).size;
    return {
      total,
      count: sessions.length,
      avgSession: sessions.length ? total / sessions.length : 0,
      activeDays: days,
      avgDay: days ? total / days : 0,
    };
  }, [sessions]);

  const categorySlices = useMemo(() => byCategory(sessions), [sessions]);
  const brandSlices = useMemo(() => byBrand(sessions), [sessions]);
  const personSlices = useMemo(() => byPerson(sessions), [sessions]);
  const days = useMemo(() => groupByDay(sessions), [sessions]);

  // "Allt" can span years — clamp the daily chart to the last 92 days so the
  // buckets stay readable (the totals above still cover the full range).
  const CHART_MAX_DAYS = 92;
  const chart = useMemo(() => {
    const { from, to } = rangeBounds(range);
    const earliest = sessions.length
      ? new Date(Math.min(...sessions.map((s) => +new Date(s.startedAt))))
      : new Date();
    const floor = startOfDay(-(CHART_MAX_DAYS - 1));
    const start = from ?? (earliest > floor ? earliest : floor);
    return dailySeries(sessions, start, to ?? startOfDay(1));
  }, [sessions, range]);

  const chartClamped =
    range === "all" &&
    sessions.some((s) => new Date(s.startedAt) < startOfDay(-(CHART_MAX_DAYS - 1)));

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

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-lg bg-white/5 p-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                range === r.key ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200"
              )}
            >
              {r.label}
            </button>
          ))}
        </div>

        {people.length > 1 && (
          <div className="flex flex-wrap gap-1 rounded-lg bg-white/5 p-1">
            <button
              onClick={() => setPersonId("")}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                personId === "" ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200"
              )}
            >
              Alla
            </button>
            {people.map((p) => (
              <button
                key={p.id}
                onClick={() => setPersonId(p.id)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  personId === p.id ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200"
                )}
              >
                {p.id === currentUserId ? `${p.name} (du)` : p.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-cyan-500" />
        </div>
      ) : (
        <>
          {/* ── KPIs ────────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard icon={Clock} label="Total tid" value={formatDuration(stats.total)} accent="text-cyan-400" />
            <StatCard icon={Layers} label="Pass" value={String(stats.count)} accent="text-violet-400" />
            <StatCard
              icon={Gauge}
              label="Snitt per pass"
              value={stats.count ? formatDuration(stats.avgSession) : "–"}
              accent="text-emerald-400"
            />
            <StatCard
              icon={CalendarDays}
              label="Snitt per aktiv dag"
              value={stats.activeDays ? formatDuration(stats.avgDay) : "–"}
              sub={stats.activeDays ? `${stats.activeDays} dagar` : undefined}
              accent="text-amber-400"
            />
          </div>

          {sessions.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              {/* ── Daily chart ───────────────────────────────────────────────── */}
              {range !== "today" && (
                <Panel
                  title="Timmar per dag"
                  subtitle={
                    chartClamped
                      ? "Staplat per kategori · visar senaste 92 dagarna"
                      : "Staplat per kategori"
                  }
                >
                  <div className="h-64 -ml-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chart.rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                        <XAxis
                          dataKey="label"
                          tick={{ fill: "#64748b", fontSize: 11 }}
                          axisLine={false}
                          tickLine={false}
                          interval="preserveStartEnd"
                        />
                        <YAxis
                          tick={{ fill: "#64748b", fontSize: 11 }}
                          axisLine={false}
                          tickLine={false}
                          width={32}
                          tickFormatter={(v: number) => `${v}h`}
                        />
                        <Tooltip
                          cursor={{ fill: "rgba(255,255,255,0.04)" }}
                          contentStyle={{
                            backgroundColor: "#0f1629",
                            border: "1px solid rgba(255,255,255,0.1)",
                            borderRadius: 10,
                            fontSize: 12,
                          }}
                          labelStyle={{ color: "#e2e8f0", marginBottom: 4 }}
                          formatter={(value, name) => [formatHours(Number(value ?? 0) * 3600), String(name ?? "")]}
                        />
                        {chart.categories.map((c) => (
                          <Bar key={c.id} dataKey={c.id} stackId="a" name={c.name} fill={c.color} radius={0} />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Panel>
              )}

              {/* ── Breakdowns ────────────────────────────────────────────────── */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <Breakdown title="Per kategori" slices={categorySlices} />
                <Breakdown title="Per varumärke" slices={brandSlices} />
                {personSlices.length > 1 ? (
                  <Breakdown title="Per person" slices={personSlices} />
                ) : (
                  <Panel title="Mest tid på" subtitle="Största posten i perioden">
                    <TopFocus slices={categorySlices} total={stats.total} />
                  </Panel>
                )}
              </div>

              {/* ── Log ───────────────────────────────────────────────────────── */}
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
        </>
      )}

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

// ── Building blocks ──────────────────────────────────────────────────────────

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-[#111827] p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        {subtitle && <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>}
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
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-[#111827] p-4">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
        <Icon className={cn("h-3.5 w-3.5", accent)} />
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-bold text-white tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

function Breakdown({ title, slices }: { title: string; slices: Slice[] }) {
  return (
    <Panel title={title}>
      {slices.length === 0 ? (
        <p className="text-xs text-slate-500">Inget loggat</p>
      ) : (
        <div className="space-y-2.5">
          {slices.map((slice) => (
            <div key={slice.id}>
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: slice.color }}
                  />
                  <span className="truncate text-xs text-slate-300">{slice.name}</span>
                </span>
                <span className="shrink-0 text-xs font-medium text-slate-400 tabular-nums">
                  {formatDuration(slice.seconds)}
                  <span className="ml-1.5 text-slate-600">{Math.round(slice.share * 100)}%</span>
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
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

function TopFocus({ slices, total }: { slices: Slice[]; total: number }) {
  const top = slices[0];
  if (!top) return <p className="text-xs text-slate-500">Inget loggat</p>;
  return (
    <div>
      <div className="text-3xl font-bold text-white">{Math.round(top.share * 100)}%</div>
      <div className="mt-1 flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: top.color }} />
        <span className="text-sm text-slate-300">{top.name}</span>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">
        {formatDuration(top.seconds)} av {formatDuration(total)} i perioden.
      </p>
    </div>
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
