"use client";

import { useCallback, useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, Cell } from "recharts";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Ban,
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
  ctaShare,
  headline,
  SOURCE_LABEL,
  type Blocker,
  type LogRocketPayload,
  type Row,
  type Snapshot,
  type SnapshotMeta,
} from "@/lib/logrocket-types";
import { SnapshotImportDialog } from "@/components/insights/logrocket-import-dialog";

/* One series → slot 1. Multi-series stays inside the first three validated slots. */
const SERIES = PALETTE_HEXES[0];
const STACK_COLORS = [PALETTE_HEXES[0], PALETTE_HEXES[2], "#64748b"];

/* Ordered bins read dark→light with duration: longer session = brighter mark. */
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

function formatCaptured(iso: string) {
  return new Date(iso).toLocaleString("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ── Primitives ─────────────────────────────────────────────────────────── */

function Card({
  title,
  hint,
  children,
  className,
}: {
  title?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
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

/** Change against the previous version. Direction alone never carries meaning — the arrow ships with a number. */
function Delta({ current, previous, format }: { current: number; previous: number | null; format: (n: number) => string }) {
  if (previous === null || previous === current) {
    return (
      <span className="text-[10px] text-slate-600">
        {previous === null ? "ingen tidigare version" : "oförändrat"}
      </span>
    );
  }
  const up = current > previous;
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span className="flex items-center gap-1 text-[10px] text-slate-400">
      <Icon className="h-3 w-3" />
      <span className="tabular-nums">{format(Math.abs(current - previous))}</span>
      <span className="text-slate-600">mot förra ({format(previous)})</span>
    </span>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "neutral",
  Icon,
  delta,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "neutral" | "good" | "warning" | "critical";
  Icon: typeof Timer;
  delta?: React.ReactNode;
}) {
  const toneHex =
    tone === "good" ? "#0ca30c" : tone === "warning" ? "#fab219" : tone === "critical" ? "#d03b3b" : SERIES;
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

/** Horizontal bars with every value direct-labelled — no value hides in a tooltip. */
function BarList({
  rows,
  colorAt,
  unit = "sessioner",
}: {
  rows: Row[];
  colorAt?: (index: number) => string;
  unit?: string;
}) {
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

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number; payload: { partial?: boolean } }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0];
  return (
    <div className="rounded-lg border border-white/10 bg-[#0f1629] px-3 py-2 shadow-xl">
      <div className="text-[11px] font-semibold text-white">{label}</div>
      <div className="mt-0.5 text-xs text-slate-300 tabular-nums">{nf.format(point.value)} sessioner</div>
      {point.payload.partial && <div className="mt-1 text-[10px] text-amber-400">pågående dag</div>}
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────── */

export function LogRocketDashboard({
  versions: initialVersions,
  initialCurrent,
  initialPrevious,
}: {
  versions: SnapshotMeta[];
  initialCurrent: Snapshot;
  initialPrevious: Snapshot | null;
}) {
  const [versions, setVersions] = useState(initialVersions);
  const [current, setCurrent] = useState(initialCurrent);
  const [previous, setPrevious] = useState(initialPrevious);
  const [switching, setSwitching] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const data: LogRocketPayload = current.payload;

  const now = useMemo(() => headline(data), [data]);
  const before = useMemo(() => (previous ? headline(previous.payload) : null), [previous]);

  const selectVersion = useCallback(
    async (id: string) => {
      if (id === current.id) return;
      setSwitching(true);
      try {
        const res = await fetch(`/api/logrocket/snapshots/${id}`);
        if (!res.ok) throw new Error("Kunde inte hämta versionen.");
        const body = (await res.json()) as { current: Snapshot; previous: Snapshot | null };
        setCurrent(body.current);
        setPrevious(body.previous);
      } catch {
        // Keep the current render rather than blanking the page.
      } finally {
        setSwitching(false);
      }
    },
    [current.id]
  );

  const onImported = useCallback((saved: Snapshot) => {
    setVersions((list) => [saved, ...list]);
    setPrevious(current);
    setCurrent(saved);
    setImportOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const envTotal = data.environmentGroups.reduce((t, g) => t + g.value, 0);
  const lengthTotal = data.sessionLength.reduce((t, b) => t + b.value, 0);
  const pdp = data.pages.find((p) => p.role === "PDP");
  const listicle = data.pages.find((p) => p.role === "Listicle");
  const isLatest = versions.length > 0 && versions[0].id === current.id;

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
          <label className="sr-only" htmlFor="lr-version">
            Version
          </label>
          <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5">
            <History className="h-3.5 w-3.5 text-slate-500" />
            <select
              id="lr-version"
              value={current.id}
              onChange={(e) => selectVersion(e.target.value)}
              disabled={switching}
              className="bg-transparent text-[11px] font-medium text-slate-200 outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 disabled:opacity-50 [&>option]:bg-[#111827]"
            >
              {versions.map((v, i) => (
                <option key={v.id} value={v.id}>
                  {formatCaptured(v.capturedAt)}
                  {v.label ? ` · ${v.label}` : ""}
                  {i === 0 ? " (senaste)" : ""}
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

      {/* Version bar */}
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-[11px]">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-slate-500">
          <span>
            Period{" "}
            <span className="font-medium text-slate-300 tabular-nums">
              {data.source.windowStart} → {data.source.windowEnd}
            </span>
          </span>
          <span>
            Hämtad <span className="font-medium text-slate-300">{formatCaptured(current.capturedAt)}</span>
          </span>
          <span>
            Metod <span className="font-medium text-slate-300">{SOURCE_LABEL[current.source]}</span>
          </span>
          <span>
            Källa <span className="font-medium text-slate-300">{data.source.project}</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          {switching && <Loader2 className="h-3 w-3 animate-spin text-slate-500" />}
          {!isLatest && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-semibold text-amber-400">
              historisk version
            </span>
          )}
          <span className="text-slate-600">
            {versions.length} {versions.length === 1 ? "version" : "versioner"} sparade
          </span>
        </div>
      </div>

      {/* Caveats — these come first on purpose. Without them the data reads inverted. */}
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

      {/* Key figures */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          Icon={Smartphone}
          label="In-app-trafik"
          value={pct(now.inAppShare)}
          delta={<Delta current={now.inAppShare} previous={before?.inAppShare ?? null} format={pct} />}
          sub="lämnar aldrig Facebooks eller Instagrams inbyggda browser. Designparametern, inte en fotnot."
          tone="warning"
        />
        <Stat
          Icon={Timer}
          label="Borta inom 30 sek"
          value={pct(now.shortShare)}
          delta={<Delta current={now.shortShare} previous={before?.shortShare ?? null} format={pct} />}
          sub="För två av tre besökare är första skärmen hela sajten."
          tone="warning"
        />
        <Stat
          Icon={MousePointerClick}
          label="CTA-genomslag PDP"
          value={pct(now.pdpCta)}
          delta={<Delta current={now.pdpCta} previous={before?.pdpCta ?? null} format={pct} />}
          sub={
            listicle && ctaShare(listicle) !== null
              ? `av klickande sessioner trycker huvud-CTA:n. Listiclen: ${pct(ctaShare(listicle)!)}.`
              : "av klickande sessioner trycker huvud-CTA:n."
          }
          tone="good"
        />
        <Stat
          Icon={TrendingDown}
          label="Fel som äter köp"
          value={String(now.moneyEaters)}
          delta={
            <Delta
              current={now.moneyEaters}
              previous={before?.moneyEaters ?? null}
              format={(n) => nf.format(n)}
            />
          }
          sub={`av ${data.blockers.length} tekniska fynd kan direkt stoppa ett köp. Resten är brus.`}
          tone="critical"
        />
      </div>

      {/* Volume */}
      <Card
        title="Sessioner per dag"
        hint={`${nf.format(now.sessions)} sessioner under ${data.source.recordedDays} inspelade dagar. Blek stapel = pågående dag.`}
      >
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.sessionsPerDay} margin={{ top: 18, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke={INK.grid} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: INK.muted, fontSize: 11 }}
                axisLine={{ stroke: INK.axis }}
                tickLine={false}
              />
              <YAxis tick={{ fill: INK.muted, fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
              <Bar dataKey="sessions" radius={[4, 4, 0, 0]} maxBarSize={54}>
                {data.sessionsPerDay.map((d) => (
                  <Cell key={d.day} fill={SERIES} fillOpacity={d.partial ? 0.4 : 1} />
                ))}
                <LabelList
                  dataKey="sessions"
                  position="top"
                  fill={INK.secondary}
                  fontSize={11}
                  formatter={(v: unknown) => nf.format(Number(v))}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Environment */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Var besökaren står" hint="Mer än hälften av trafiken är en inbyggd social webview — inte en riktig webbläsare.">
          <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
            {data.environmentGroups.map((g, i) => (
              <div
                key={g.label}
                style={{ width: `${(g.value / envTotal) * 100}%`, backgroundColor: STACK_COLORS[i % STACK_COLORS.length] }}
                title={`${g.label}: ${nf.format(g.value)}`}
              />
            ))}
          </div>
          <ul className="mt-3 flex flex-col gap-2">
            {data.environmentGroups.map((g, i) => (
              <li key={g.label} className="flex items-center justify-between gap-2 text-xs">
                <span className="flex min-w-0 items-center gap-2 text-slate-300">
                  <span
                    className="h-2 w-2 shrink-0 rounded-sm"
                    style={{ backgroundColor: STACK_COLORS[i % STACK_COLORS.length] }}
                  />
                  <span className="truncate">{g.label}</span>
                </span>
                <span className="shrink-0 font-semibold text-white tabular-nums">
                  {pct(g.value / envTotal)}
                  <span className="ml-1.5 font-normal text-slate-500">{nf.format(g.value)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Webbläsare" hint="Chrome-andelen är kraftigt uppblåst av bottar och Metas link-crawlers.">
          <BarList rows={data.browsers} />
        </Card>

        <Card title="Operativsystem" hint="Nästan tre av fyra är mobil. Allt vi bygger måste klara en telefon i en webview.">
          <BarList rows={data.operatingSystems} />
        </Card>
      </div>

      {/* Attention */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Uppmärksamhet" hint={`${pct(now.shortShare)} är borta inom 30 sekunder. Ljusare stapel = längre session.`}>
          <BarList rows={data.sessionLength} colorAt={(i) => DURATION_RAMP[i % DURATION_RAMP.length]} />
          <p className="mt-4 border-t border-white/5 pt-3 text-xs leading-relaxed text-slate-400">
            Bara {pct((data.sessionLength.at(-1)?.value ?? 0) / lengthTotal)} stannar längre än två minuter. Hela
            erbjudandet — löfte, storleksbevis, pris, CTA — måste bäras ovanför vecket.
          </p>
        </Card>

        <Card title="Friktion" hint="LogRockets frustrationssignaler över hela perioden.">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Rage clicks", value: data.frustration.rageClicks },
              { label: "Dead clicks", value: data.frustration.deadClicks },
            ].map((f) => (
              <div key={f.label} className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{f.label}</div>
                <div className="mt-1 text-2xl font-semibold text-white">{nf.format(f.value)}</div>
              </div>
            ))}
          </div>
          <p className="mt-4 flex gap-2 border-t border-white/5 pt-3 text-xs leading-relaxed text-slate-400">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "#0ca30c" }} />
            {data.frustration.verdict}
          </p>
        </Card>
      </div>

      {/* Pages */}
      <Card title="Sidorna" hint="CTA-genomslag = andel av sessioner med klick som tryckte sidans huvud-CTA.">
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/5 text-left text-[10px] uppercase tracking-widest text-slate-500">
                <th className="px-1 pb-2 font-semibold">Sida</th>
                <th className="px-1 pb-2 font-semibold">Roll</th>
                <th className="px-1 pb-2 text-right font-semibold">Sessioner</th>
                <th className="px-1 pb-2 text-right font-semibold">Med klick</th>
                <th className="px-1 pb-2 font-semibold">CTA-genomslag</th>
                <th className="px-1 pb-2 font-semibold">Läge</th>
              </tr>
            </thead>
            <tbody>
              {data.pages.map((p) => {
                const share = ctaShare(p);
                const status = PAGE_STATUS[p.status] ?? PAGE_STATUS.neutral;
                return (
                  <tr key={p.path} className="border-b border-white/5 align-top last:border-0">
                    <td className="px-1 py-3">
                      <div className="font-mono text-xs text-white">{p.path}</div>
                      <p className="mt-1 max-w-md text-[11px] leading-relaxed text-slate-400">{p.note}</p>
                    </td>
                    <td className="px-1 py-3 text-xs text-slate-400">{p.role}</td>
                    <td className="px-1 py-3 text-right text-xs font-semibold text-white tabular-nums">
                      {nf.format(p.sessions)}
                    </td>
                    <td className="px-1 py-3 text-right text-xs text-slate-400 tabular-nums">
                      {p.clickSessions ? nf.format(p.clickSessions) : "—"}
                    </td>
                    <td className="px-1 py-3">
                      {share === null ? (
                        <span className="text-xs text-slate-600">ej mätbart</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/5">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${share * 100}%`, backgroundColor: SERIES }}
                            />
                          </div>
                          <span className="text-xs font-semibold text-white tabular-nums">{pct(share)}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-1 py-3">
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                        style={{ backgroundColor: `${status.hex}1f`, color: status.hex }}
                      >
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
      </Card>

      {/* Clicks */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Mest klickat — hela sajten" hint="En enda knapp bär sajten.">
          <BarList rows={data.clicksSitewide} unit="klickande sessioner" />
        </Card>
        <Card
          title="PDP"
          hint={
            pdp?.clickSessions
              ? `${nf.format(pdp.clickSessions)} sessioner med klick. ${pct(now.pdpCta)} når huvud-CTA:n.`
              : "Klickmönster på produktsidan."
          }
        >
          <BarList rows={data.clicksPdp} unit="klickande sessioner" />
        </Card>
        <Card
          title="Listicle1"
          hint={
            listicle?.clickSessions
              ? `${nf.format(listicle.clickSessions)} sessioner med klick. De klickar på texten, inte knappen.`
              : "Klickmönster på listiclen."
          }
        >
          <BarList rows={data.clicksListicle} unit="klickande sessioner" />
        </Card>
      </div>

      {/* Objections */}
      <Card
        title="Invändningarna de faktiskt har"
        hint="FAQ-dragspel som öppnades på PDP:n. Låga tal — men riktningen är entydig och matchar vår research."
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <BarList
            rows={data.objections.map((o) => ({ label: o.label, value: o.value, note: o.kind }))}
            unit="öppningar"
          />
          <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
            <h4 className="text-xs font-semibold text-white">Två av topp fyra är förtroendefrågor</h4>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
              Apoquel-kompatibiliteten ligger överst — exakt vad marknadsresearchen pekade ut som den största oägda
              emotionen, nu bekräftat av beteende. Och “är prenumerationen en fälla?” hör inte hemma nedgrävd i en FAQ:
              det är en köpblockerare som ska stå i buy-boxen.
            </p>
          </div>
        </div>
      </Card>

      {/* Blockers */}
      <Card title="Tekniska blockerare" hint="Rankade efter om de äter pengar — inte efter antal events.">
        <ul className="flex flex-col gap-2">
          {data.blockers.map((b) => {
            const s = SEVERITY[b.severity];
            return (
              <li
                key={b.title}
                className="flex gap-3 rounded-lg border border-white/5 bg-white/[0.02] p-3"
                style={{ borderLeft: `2px solid ${s.hex}` }}
              >
                <s.Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: s.hex }} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h4 className="text-xs font-semibold text-white">{b.title}</h4>
                    <div className="flex items-center gap-2">
                      {b.eatsMoney && (
                        <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400">
                          äter köp
                        </span>
                      )}
                      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: s.hex }}>
                        {s.label}
                      </span>
                    </div>
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-slate-500">
                    {b.where} · {nf.format(b.events)} events
                  </div>
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
                <span
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                  style={{ backgroundColor: `${SERIES}22`, color: SERIES }}
                >
                  {i + 1}
                </span>
                <div>
                  <h4 className="text-xs font-semibold text-white">{t.title}</h4>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{t.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <SnapshotImportDialog open={importOpen} onClose={() => setImportOpen(false)} onSaved={onImported} />
    </div>
  );
}
