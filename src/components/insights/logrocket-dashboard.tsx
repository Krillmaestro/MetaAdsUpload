"use client";

import { useCallback, useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, Cell } from "recharts";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Ban,
  CalendarRange,
  CheckCircle2,
  History,
  Info,
  Loader2,
  MousePointerClick,
  RefreshCw,
  Smartphone,
  Timer,
  TrendingDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { HEAT_RAMP, INK, PALETTE_HEXES } from "@/lib/work-palette";
import {
  aggregate,
  ctaShare,
  daysInRange,
  PRESETS,
  resolvePreset,
  sampleNeeded,
  separated,
  SOURCE_LABEL,
  STRENGTH_META,
  strengthOf,
  wilson,
  type Aggregated,
  type Blocker,
  type LogRocketPayload,
  type PresetKey,
  type Range,
  type Row,
  type Snapshot,
  type SnapshotMeta,
} from "@/lib/logrocket-types";
import { SnapshotImportDialog } from "@/components/insights/logrocket-import-dialog";

const SERIES = PALETTE_HEXES[0];
const STACK_COLORS = [PALETTE_HEXES[0], PALETTE_HEXES[2], "#64748b"];
const DURATION_RAMP = [HEAT_RAMP[0], HEAT_RAMP[1], HEAT_RAMP[2], HEAT_RAMP[4]];

const SEVERITY: Record<Blocker["severity"], { hex: string; label: string; Icon: typeof AlertTriangle }> = {
  critical: { hex: "#d03b3b", label: "Kritisk", Icon: Ban },
  serious: { hex: "#ec835a", label: "Allvarlig", Icon: AlertTriangle },
  warning: { hex: "#fab219", label: "Bevaka", Icon: AlertTriangle },
  good: { hex: "#0ca30c", label: "Ofarlig", Icon: CheckCircle2 },
};

const PAGE_STATUS: Record<string, { hex: string; label: string }> = {
  good: { hex: "#0ca30c", label: "Skalar" },
  warning: { hex: "#fab219", label: "Läcker" },
  critical: { hex: "#d03b3b", label: "Trasig" },
  neutral: { hex: "#64748b", label: "För lite data" },
};

const nf = new Intl.NumberFormat("sv-SE");
const pct = (n: number) => `${Math.round(n * 100)} %`;
const dayLabel = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;

function formatCaptured(iso: string) {
  return new Date(iso).toLocaleString("sv-SE", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

/* ── Primitives ─────────────────────────────────────────────────────────── */

function Card({ title, hint, children, className }: {
  title?: string; hint?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-white/5 bg-[#111827] p-4", className)}>
      {title && (
        <header className="mb-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{title}</h3>
          {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
        </header>
      )}
      {children}
    </section>
  );
}

function Delta({ current, previous, format }: {
  current: number; previous: number | null; format: (n: number) => string;
}) {
  if (previous === null) return <span className="text-[10px] text-slate-600">ingen jämförbar period</span>;
  if (previous === current) return <span className="text-[10px] text-slate-600">oförändrat</span>;
  const Icon = current > previous ? ArrowUp : ArrowDown;
  return (
    <span className="flex items-center gap-1 text-[10px] text-slate-400">
      <Icon className="h-3 w-3" />
      <span className="tabular-nums">{format(Math.abs(current - previous))}</span>
      <span className="text-slate-600">mot föregående ({format(previous)})</span>
    </span>
  );
}

function Stat({ label, value, sub, tone = "neutral", Icon, delta }: {
  label: string; value: string; sub: string;
  tone?: "neutral" | "good" | "warning" | "critical";
  Icon: typeof Timer; delta?: React.ReactNode;
}) {
  const toneHex = tone === "good" ? "#0ca30c" : tone === "warning" ? "#fab219" : tone === "critical" ? "#d03b3b" : SERIES;
  return (
    <div className="rounded-xl border border-white/5 bg-[#111827] p-4">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
        <Icon className="h-3 w-3" style={{ color: toneHex }} />
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
      {delta && <div className="mt-1">{delta}</div>}
      <p className="mt-1 text-xs leading-relaxed text-slate-400">{sub}</p>
    </div>
  );
}

function BarList({ rows, colorAt, unit = "sessioner", empty = "Inget att visa i vald period." }: {
  rows: Row[]; colorAt?: (i: number) => string; unit?: string; empty?: string;
}) {
  if (rows.length === 0) return <p className="py-2 text-xs text-slate-600">{empty}</p>;
  const ceiling = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((row, i) => (
        <li key={`${row.label}-${i}`} className="group">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-xs text-slate-300" title={row.label}>
              {row.label}
              {row.note && <span className="ml-1.5 text-[10px] text-slate-600">{row.note}</span>}
            </span>
            <span className="shrink-0 text-xs font-semibold text-white tabular-nums">{nf.format(row.value)}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full transition-opacity group-hover:opacity-80"
              style={{ width: `${(row.value / ceiling) * 100}%`, backgroundColor: colorAt?.(i) ?? SERIES }}
              title={`${row.label}: ${nf.format(row.value)} ${unit}`}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function ChartTooltip({ active, payload, label }: {
  active?: boolean; payload?: { value: number; payload: { partial?: boolean } }[]; label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-[#0f1629] px-3 py-2 shadow-xl">
      <div className="text-[11px] font-semibold text-white">{label}</div>
      <div className="mt-0.5 text-xs text-slate-300 tabular-nums">{nf.format(payload[0].value)} sessioner</div>
      {payload[0].payload.partial && <div className="mt-1 text-[10px] text-amber-400">pågående dag</div>}
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────── */

export function LogRocketDashboard({ versions: initialVersions, initialCurrent, initialPrevious }: {
  versions: SnapshotMeta[]; initialCurrent: Snapshot; initialPrevious: Snapshot | null;
}) {
  const [versions, setVersions] = useState(initialVersions);
  const [current, setCurrent] = useState(initialCurrent);
  const [, setPreviousSnapshot] = useState(initialPrevious);
  const [switching, setSwitching] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const data: LogRocketPayload = current.payload;

  const [preset, setPreset] = useState<PresetKey>("all");
  const [custom, setCustom] = useState<Range>(() => resolvePreset("all", data));

  const range = useMemo(
    () => (preset === "custom" ? custom : resolvePreset(preset, data)),
    [preset, custom, data]
  );

  const selectedDays = useMemo(() => daysInRange(data, range), [data, range]);
  const now: Aggregated = useMemo(() => aggregate(selectedDays), [selectedDays]);

  /** The equally long window immediately before the selected one. */
  const before = useMemo(() => {
    const span = selectedDays.length;
    if (span === 0) return null;
    const start = new Date(`${range.from}T00:00:00Z`);
    const prevTo = new Date(start);
    prevTo.setUTCDate(prevTo.getUTCDate() - 1);
    const prevFrom = new Date(prevTo);
    prevFrom.setUTCDate(prevFrom.getUTCDate() - (span - 1));
    const days = daysInRange(data, {
      from: prevFrom.toISOString().slice(0, 10),
      to: prevTo.toISOString().slice(0, 10),
    });
    return days.length ? aggregate(days) : null;
  }, [data, range, selectedDays.length]);

  const selectVersion = useCallback(async (id: string) => {
    if (id === current.id) return;
    setSwitching(true);
    try {
      const res = await fetch(`/api/logrocket/snapshots/${id}`);
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { current: Snapshot; previous: Snapshot | null };
      setCurrent(body.current);
      setPreviousSnapshot(body.previous);
      setPreset("all");
      setCustom(resolvePreset("all", body.current.payload));
    } catch {
      /* keep the current render rather than blanking the page */
    } finally {
      setSwitching(false);
    }
  }, [current.id]);

  const onImported = useCallback((saved: Snapshot) => {
    setVersions((list) => [saved, ...list]);
    setPreviousSnapshot(current);
    setCurrent(saved);
    setPreset("all");
    setCustom(resolvePreset("all", saved.payload));
    setImportOpen(false);
  }, [current]);

  const pdp = data.period.pages.find((p) => p.role === "PDP");
  const listicle = data.period.pages.find((p) => p.role === "Listicle");
  const moneyEaters = data.period.blockers.filter((b) => b.eatsMoney).length;
  const isLatest = versions.length > 0 && versions[0].id === current.id;
  const empty = selectedDays.length === 0;

  const chartData = selectedDays.map((d) => ({
    label: dayLabel(d.date), sessions: d.sessions, partial: d.partial, date: d.date,
  }));

  function applyPreset(key: PresetKey) {
    setPreset(key);
    if (key !== "custom") setCustom(resolvePreset(key, data));
  }

  return (
    <div className={cn("flex flex-col gap-4 p-4 transition-opacity sm:p-6", switching && "opacity-60")}>
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">LogRocket · SmallDogCO</h1>
          <p className="mt-1 text-xs text-slate-400">
            Beteendeanalys av {data.source.site} — vad besökarna faktiskt gör på sidan, och var det bryter.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5">
            <History className="h-3.5 w-3.5 text-slate-500" />
            <select
              value={current.id}
              onChange={(e) => selectVersion(e.target.value)}
              disabled={switching}
              aria-label="Version"
              className="bg-transparent text-[11px] font-medium text-slate-200 outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 disabled:opacity-50 [&>option]:bg-[#111827]"
            >
              {versions.map((v, i) => (
                <option key={v.id} value={v.id}>
                  {formatCaptured(v.capturedAt)}{v.label ? ` · ${v.label}` : ""}{i === 0 ? " (senaste)" : ""}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-2 text-xs font-semibold text-[#04202a] transition-colors hover:bg-cyan-400"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Hämta ny data
          </button>
        </div>
      </header>

      {/* Period selector — one row above everything it scopes */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/5 bg-[#111827] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1 rounded-lg bg-white/5 p-1">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => applyPreset(p.key)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                  preset === p.key ? "bg-cyan-500 text-[#04202a]" : "text-slate-400 hover:bg-white/5 hover:text-white"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5">
            <CalendarRange className="h-3.5 w-3.5 text-slate-500" />
            <input
              type="date"
              value={range.from}
              max={range.to}
              onChange={(e) => { setCustom({ from: e.target.value, to: range.to }); setPreset("custom"); }}
              aria-label="Från"
              className="bg-transparent text-[11px] text-slate-200 outline-none [color-scheme:dark] focus-visible:ring-1 focus-visible:ring-cyan-400"
            />
            <span className="text-slate-600">→</span>
            <input
              type="date"
              value={range.to}
              min={range.from}
              onChange={(e) => { setCustom({ from: range.from, to: e.target.value }); setPreset("custom"); }}
              aria-label="Till"
              className="bg-transparent text-[11px] text-slate-200 outline-none [color-scheme:dark] focus-visible:ring-1 focus-visible:ring-cyan-400"
            />
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          {switching && <Loader2 className="h-3 w-3 animate-spin" />}
          <span>
            {selectedDays.length} {selectedDays.length === 1 ? "dag" : "dagar"} med data
          </span>
          <span className="text-slate-700">·</span>
          <span>Hämtad {formatCaptured(current.capturedAt)}</span>
          <span className="text-slate-700">·</span>
          <span>{SOURCE_LABEL[current.source]}</span>
          {!isLatest && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-semibold text-amber-400">historisk version</span>
          )}
        </div>
      </div>

      {/* Caveats */}
      <section className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-amber-400">
          <Info className="h-3 w-3" />
          Läs det här först
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {data.caveats.map((c) => (
            <div key={c.title} className="border-l-2 border-amber-500/30 pl-3">
              <h4 className="text-xs font-semibold text-white">{c.title}</h4>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      {empty ? (
        <Card>
          <div className="py-10 text-center">
            <p className="text-sm font-semibold text-white">Ingen inspelad data i vald period</p>
            <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-slate-400">
              LogRocket började spela in {data.source.windowStart}. Perioden {range.from} → {range.to} ligger utanför
              det som finns inspelat — det betyder “inte mätt”, inte “noll trafik”.
            </p>
            <button
              type="button"
              onClick={() => applyPreset("all")}
              className="mt-4 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              Visa hela perioden
            </button>
          </div>
        </Card>
      ) : (
        <>
          {/* Key figures */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              Icon={Smartphone} label="In-app-trafik" value={pct(now.inAppShare)}
              delta={<Delta current={now.inAppShare} previous={before?.inAppShare ?? null} format={pct} />}
              sub="lämnar aldrig Facebooks eller Instagrams inbyggda browser."
              tone="warning"
            />
            <Stat
              Icon={Timer} label="Borta inom 30 sek" value={pct(now.shortShare)}
              delta={<Delta current={now.shortShare} previous={before?.shortShare ?? null} format={pct} />}
              sub={`Bara ${pct(now.longShare)} stannar längre än två minuter.`}
              tone="warning"
            />
            <Stat
              Icon={MousePointerClick} label="Sessioner" value={nf.format(now.sessions)}
              delta={<Delta current={now.sessions} previous={before?.sessions ?? null} format={(n) => nf.format(n)} />}
              sub={`${range.from} → ${range.to}. Bottar och Meta-crawlers ingår.`}
            />
            <Stat
              Icon={TrendingDown} label="Fel som äter köp" value={String(moneyEaters)}
              sub={`av ${data.period.blockers.length} tekniska fynd kan direkt stoppa ett köp. Gäller hela hämtningen.`}
              tone="critical"
            />
          </div>

          {/* Daily volume */}
          <Card
            title="Sessioner per dag"
            hint={`${nf.format(now.sessions)} sessioner över ${selectedDays.length} ${selectedDays.length === 1 ? "dag" : "dagar"}. Blek stapel = pågående dag.`}
          >
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 18, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke={INK.grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: INK.muted, fontSize: 11 }} axisLine={{ stroke: INK.axis }} tickLine={false} />
                  <YAxis tick={{ fill: INK.muted, fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                  <Bar dataKey="sessions" radius={[4, 4, 0, 0]} maxBarSize={54}>
                    {chartData.map((d) => (
                      <Cell key={d.date} fill={SERIES} fillOpacity={d.partial ? 0.4 : 1} />
                    ))}
                    <LabelList dataKey="sessions" position="top" fill={INK.secondary} fontSize={11}
                      formatter={(v: unknown) => nf.format(Number(v))} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Day-by-day table */}
          <Card title="Dag för dag" hint="Varje inspelad dag i vald period, med alla dimensioner som mäts dagligen.">
            <div className="-mx-1 overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-white/5 text-left text-[10px] uppercase tracking-widest text-slate-500">
                    <th className="px-1 pb-2 font-semibold">Dag</th>
                    <th className="px-1 pb-2 text-right font-semibold">Sessioner</th>
                    <th className="px-1 pb-2 text-right font-semibold">In-app</th>
                    <th className="px-1 pb-2 text-right font-semibold">≤30 sek</th>
                    <th className="px-1 pb-2 text-right font-semibold">PDP</th>
                    <th className="px-1 pb-2 text-right font-semibold">Listicle1</th>
                    <th className="px-1 pb-2 text-right font-semibold">Itch2</th>
                    <th className="px-1 pb-2 text-right font-semibold">Ears1</th>
                    <th className="px-1 pb-2 text-right font-semibold">Varukorg</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedDays.map((d) => {
                    const one = aggregate([d]);
                    const cell = (n: number | undefined) =>
                      n ? nf.format(n) : <span className="text-slate-700">0</span>;
                    return (
                      <tr key={d.date} className="border-b border-white/5 last:border-0">
                        <td className="px-1 py-2 text-xs text-white">
                          {dayLabel(d.date)}
                          {d.partial && <span className="ml-1.5 text-[10px] text-amber-400">pågår</span>}
                        </td>
                        <td className="px-1 py-2 text-right text-xs font-semibold text-white tabular-nums">
                          {nf.format(d.sessions)}
                        </td>
                        <td className="px-1 py-2 text-right text-xs text-slate-400 tabular-nums">{pct(one.inAppShare)}</td>
                        <td className="px-1 py-2 text-right text-xs text-slate-400 tabular-nums">{pct(one.shortShare)}</td>
                        <td className="px-1 py-2 text-right text-xs text-slate-300 tabular-nums">{cell(d.pages["/products/small-dog-co-itch-relief"])}</td>
                        <td className="px-1 py-2 text-right text-xs text-slate-300 tabular-nums">{cell(d.pages["/pages/listicle1"])}</td>
                        <td className="px-1 py-2 text-right text-xs text-slate-300 tabular-nums">{cell(d.pages["/pages/itch2"])}</td>
                        <td className="px-1 py-2 text-right text-xs text-slate-300 tabular-nums">{cell(d.pages["/pages/ears1"])}</td>
                        <td className="px-1 py-2 text-right text-xs text-slate-300 tabular-nums">{cell(d.pages["/cart"])}</td>
                      </tr>
                    );
                  })}
                  <tr className="border-t border-white/10 bg-white/[0.02]">
                    <td className="px-1 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Totalt</td>
                    <td className="px-1 py-2 text-right text-xs font-semibold text-white tabular-nums">{nf.format(now.sessions)}</td>
                    <td className="px-1 py-2 text-right text-xs font-semibold text-slate-300 tabular-nums">{pct(now.inAppShare)}</td>
                    <td className="px-1 py-2 text-right text-xs font-semibold text-slate-300 tabular-nums">{pct(now.shortShare)}</td>
                    {["/products/small-dog-co-itch-relief", "/pages/listicle1", "/pages/itch2", "/pages/ears1", "/cart"].map((p) => (
                      <td key={p} className="px-1 py-2 text-right text-xs font-semibold text-slate-300 tabular-nums">
                        {nf.format(now.pages[p] ?? 0)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          {/* Environment */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Var besökaren står" hint="In-app-webview mot riktig webbläsare, för vald period.">
              <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
                {now.environment.map((g, i) => (
                  <div key={g.label}
                    style={{ width: `${(g.value / Math.max(now.sessions, 1)) * 100}%`, backgroundColor: STACK_COLORS[i % STACK_COLORS.length] }}
                    title={`${g.label}: ${nf.format(g.value)}`} />
                ))}
              </div>
              <ul className="mt-3 flex flex-col gap-2">
                {now.environment.map((g, i) => (
                  <li key={g.label} className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex min-w-0 items-center gap-2 text-slate-300">
                      <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: STACK_COLORS[i % STACK_COLORS.length] }} />
                      <span className="truncate">{g.label}</span>
                    </span>
                    <span className="shrink-0 font-semibold text-white tabular-nums">
                      {pct(g.value / Math.max(now.sessions, 1))}
                      <span className="ml-1.5 font-normal text-slate-500">{nf.format(g.value)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Webbläsare" hint="Chrome-andelen är uppblåst av bottar och Metas link-crawlers.">
              <BarList rows={now.browsers} />
            </Card>
            <Card title="Operativsystem" hint="Allt vi bygger måste klara en telefon i en webview.">
              <BarList rows={now.operatingSystems} />
            </Card>
          </div>

          {/* Attention */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Uppmärksamhet" hint={`${pct(now.shortShare)} är borta inom 30 sekunder. Ljusare stapel = längre session.`}>
              <BarList rows={now.duration} colorAt={(i) => DURATION_RAMP[i % DURATION_RAMP.length]} />
            </Card>
            <Card title="Friktion" hint="LogRockets frustrationssignaler — gäller hela hämtningen, inte vald period.">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Rage clicks", value: data.period.frustration.rageClicks },
                  { label: "Dead clicks", value: data.period.frustration.deadClicks },
                ].map((f) => (
                  <div key={f.label} className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{f.label}</div>
                    <div className="mt-1 text-2xl font-semibold text-white">{nf.format(f.value)}</div>
                  </div>
                ))}
              </div>
              <p className="mt-4 flex gap-2 border-t border-white/5 pt-3 text-xs leading-relaxed text-slate-400">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "#0ca30c" }} />
                {data.period.frustration.verdict}
              </p>
            </Card>
          </div>

          {/* Pages */}
          <Card
            title="Sidorna"
            hint="Sessioner följer vald period. CTA-genomslag mäts över hela hämtningen — LogRocket bryter inte ut klick per dag. Bandet är 95 % osäkerhetsintervall: så brett kan sanningen vara."
          >
            <div className="-mx-1 overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-white/5 text-left text-[10px] uppercase tracking-widest text-slate-500">
                    <th className="px-1 pb-2 font-semibold">Sida</th>
                    <th className="px-1 pb-2 font-semibold">Roll</th>
                    <th className="px-1 pb-2 text-right font-semibold">Sessioner</th>
                    <th className="px-1 pb-2 text-right font-semibold">Med klick</th>
                    <th className="px-1 pb-2 font-semibold">CTA-genomslag <span className="normal-case text-slate-600">(95 % intervall)</span></th>
                    <th className="px-1 pb-2 font-semibold">Datastyrka</th>
                    <th className="px-1 pb-2 font-semibold">Läge</th>
                  </tr>
                </thead>
                <tbody>
                  {data.period.pages.map((p) => {
                    const share = ctaShare(p);
                    const ci = p.clickSessions && p.ctaClicks !== null ? wilson(p.ctaClicks, p.clickSessions) : null;
                    const strength = strengthOf(p.clickSessions);
                    const sm = STRENGTH_META[strength];
                    // A verdict is only as strong as its denominator — thin data can never read "Skalar".
                    const status =
                      strength === "none" || strength === "thin"
                        ? PAGE_STATUS.neutral
                        : PAGE_STATUS[p.status] ?? PAGE_STATUS.neutral;
                    const needed = ci ? sampleNeeded(ci.p, 0.1) : null;
                    return (
                      <tr key={p.path} className="border-b border-white/5 align-top last:border-0">
                        <td className="px-1 py-3">
                          <div className="font-mono text-xs text-white">{p.path}</div>
                          <p className="mt-1 max-w-md text-[11px] leading-relaxed text-slate-400">{p.note}</p>
                        </td>
                        <td className="px-1 py-3 text-xs text-slate-400">{p.role}</td>
                        <td className="px-1 py-3 text-right text-xs font-semibold text-white tabular-nums">
                          {nf.format(now.pages[p.path] ?? 0)}
                        </td>
                        <td className="px-1 py-3 text-right text-xs text-slate-400 tabular-nums">
                          {p.clickSessions ? nf.format(p.clickSessions) : "—"}
                        </td>
                        <td className="px-1 py-3">
                          {share === null || !ci ? (
                            <span className="text-xs text-slate-600">ej mätbart</span>
                          ) : (
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-2">
                                {/* Track = 0–100 %. Pale band = the interval, solid tick = the estimate. */}
                                <div className="relative h-2.5 w-28 overflow-hidden rounded-full bg-white/5">
                                  <div
                                    className="absolute inset-y-0 rounded-full"
                                    style={{ left: `${ci.lo * 100}%`, width: `${(ci.hi - ci.lo) * 100}%`, backgroundColor: `${SERIES}59` }}
                                  />
                                  <div
                                    className="absolute inset-y-0 w-[2px] rounded-full"
                                    style={{ left: `calc(${ci.p * 100}% - 1px)`, backgroundColor: SERIES }}
                                  />
                                </div>
                                <span className="text-xs font-semibold text-white tabular-nums">{pct(share)}</span>
                              </div>
                              <span className="text-[10px] text-slate-500 tabular-nums">
                                {pct(ci.lo)} – {pct(ci.hi)}
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="px-1 py-3">
                          <span
                            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                            style={{ backgroundColor: `${sm.hex}1f`, color: sm.hex }}
                            title={sm.blurb}
                          >
                            {sm.label}
                          </span>
                          {needed && p.clickSessions && p.clickSessions < needed && (
                            <div className="mt-1 text-[10px] text-slate-600 tabular-nums">
                              behöver ~{nf.format(needed)} för ±10pp
                            </div>
                          )}
                        </td>
                        <td className="px-1 py-3">
                          <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                            style={{ backgroundColor: `${status.hex}1f`, color: status.hex }}>
                            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: status.hex }} />
                            {status.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {pdp && listicle && (
              <p className="mt-3 flex gap-2 border-t border-white/5 pt-3 text-[11px] leading-relaxed text-slate-400">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                {separated(pdp, listicle) ? (
                  <span>
                    PDP:ns och listiclens intervall <strong className="text-slate-200">överlappar inte</strong> — skillnaden
                    i CTA-genomslag håller trots låg volym. Men intervallen är breda, så läs den som “PDP är bättre”,
                    aldrig som “PDP ligger på {pct(ctaShare(pdp) ?? 0)}”. Och sidorna fick trafik olika länge, vilket
                    statistiken inte kan reda ut åt oss.
                  </span>
                ) : (
                  <span>
                    PDP:ns och listiclens intervall <strong className="text-slate-200">överlappar</strong> — skillnaden är
                    ännu inte bevisad. Vänta på mer volym innan någon sida döms ut.
                  </span>
                )}
              </p>
            )}
          </Card>

          {/* Clicks — period aggregates */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Mest klickat — hela sajten" hint="Hela hämtningen. En enda knapp bär sajten.">
              <BarList rows={data.period.clicksSitewide} unit="klickande sessioner" />
            </Card>
            <Card title="PDP" hint={pdp?.clickSessions ? `${nf.format(pdp.clickSessions)} sessioner med klick.` : undefined}>
              <BarList rows={data.period.clicksPdp} unit="klickande sessioner" />
            </Card>
            <Card title="Listicle1" hint={listicle?.clickSessions ? `${nf.format(listicle.clickSessions)} sessioner med klick — de klickar på texten.` : undefined}>
              <BarList rows={data.period.clicksListicle} unit="klickande sessioner" />
            </Card>
          </div>

          {/* Objections */}
          <Card title="Invändningarna de faktiskt har" hint="FAQ-dragspel som öppnades på PDP:n, hela hämtningen. Låga tal — men riktningen matchar vår research.">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <BarList rows={data.period.objections.map((o) => ({ label: o.label, value: o.value, note: o.kind }))} unit="öppningar" />
              <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                <h4 className="text-xs font-semibold text-white">Två av topp fyra är förtroendefrågor</h4>
                <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                  Apoquel-kompatibiliteten ligger överst — exakt vad marknadsresearchen pekade ut som den största oägda
                  emotionen, nu bekräftat av beteende. Och “är prenumerationen en fälla?” hör inte hemma nedgrävd i en
                  FAQ: det är en köpblockerare som ska stå i buy-boxen.
                </p>
              </div>
            </div>
          </Card>

          {/* Blockers */}
          <Card title="Tekniska blockerare" hint="Hela hämtningen, rankade efter om de äter pengar — inte efter antal events.">
            <ul className="flex flex-col gap-2">
              {data.period.blockers.map((b) => {
                const s = SEVERITY[b.severity];
                return (
                  <li key={b.title} className="flex gap-3 rounded-lg border border-white/5 bg-white/[0.02] p-3"
                    style={{ borderLeft: `2px solid ${s.hex}` }}>
                    <s.Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: s.hex }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h4 className="text-xs font-semibold text-white">{b.title}</h4>
                        <div className="flex items-center gap-2">
                          {b.eatsMoney && (
                            <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400">äter köp</span>
                          )}
                          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: s.hex }}>{s.label}</span>
                        </div>
                      </div>
                      <div className="mt-1 font-mono text-[10px] text-slate-500">{b.where} · {nf.format(b.events)} events</div>
                      <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">{b.verdict}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>

          {/* Conclusions */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Hur vi ska tänka framåt">
              <ul className="flex flex-col gap-3">
                {data.conclusions.map((c) => (
                  <li key={c.heading} className="border-l-2 border-white/10 pl-3">
                    <h4 className="text-xs font-semibold text-white">{c.heading}</h4>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{c.body}</p>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Next 3 tests">
              <ol className="flex flex-col gap-3">
                {data.nextTests.map((t, i) => (
                  <li key={t.title} className="flex gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                      style={{ backgroundColor: `${SERIES}22`, color: SERIES }}>{i + 1}</span>
                    <div>
                      <h4 className="text-xs font-semibold text-white">{t.title}</h4>
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{t.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          </div>
        </>
      )}

      <SnapshotImportDialog open={importOpen} onClose={() => setImportOpen(false)} onSaved={onImported} />
    </div>
  );
}
