"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, Cell } from "recharts";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Info,
  MousePointerClick,
  Smartphone,
  Timer,
  TrendingDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { HEAT_RAMP, INK, PALETTE_HEXES } from "@/lib/work-palette";
import {
  BLOCKERS,
  BROWSERS,
  CAVEATS,
  CLICKS_LISTICLE,
  CLICKS_PDP,
  CLICKS_SITEWIDE,
  CONCLUSIONS,
  ENVIRONMENT_GROUPS,
  FRUSTRATION,
  NEXT_TESTS,
  OBJECTIONS,
  OPERATING_SYSTEMS,
  PAGES,
  SESSION_LENGTH,
  SESSIONS_PER_DAY,
  SOURCE,
  type Blocker,
  type Row,
} from "@/lib/logrocket-data";

/* One series → slot 1. Multi-series stays inside the first three validated slots. */
const SERIES = PALETTE_HEXES[0];
const STACK_COLORS = [PALETTE_HEXES[0], PALETTE_HEXES[2], "#64748b"];

/* Ordered bins read light→dark with duration: longer session = brighter mark. */
const DURATION_RAMP = [HEAT_RAMP[0], HEAT_RAMP[1], HEAT_RAMP[2], HEAT_RAMP[4]];

const SEVERITY: Record<Blocker["severity"], { hex: string; label: string; Icon: typeof AlertTriangle }> = {
  critical: { hex: "#d03b3b", label: "Kritisk", Icon: Ban },
  serious: { hex: "#ec835a", label: "Allvarlig", Icon: AlertTriangle },
  warning: { hex: "#fab219", label: "Bevaka", Icon: AlertTriangle },
  good: { hex: "#0ca30c", label: "Ofarlig", Icon: CheckCircle2 },
};

const nf = new Intl.NumberFormat("sv-SE");
const pct = (n: number) => `${Math.round(n * 100)} %`;

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

function Stat({
  label,
  value,
  sub,
  tone = "neutral",
  Icon,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "neutral" | "good" | "warning" | "critical";
  Icon: typeof Timer;
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
      <p className="mt-1 text-xs leading-relaxed text-slate-400">{sub}</p>
    </div>
  );
}

/** Horizontal bars with every value direct-labelled — no value hides in a tooltip. */
function BarList({
  rows,
  max,
  colorAt,
  unit = "sessioner",
}: {
  rows: Row[];
  max?: number;
  colorAt?: (index: number) => string;
  unit?: string;
}) {
  const ceiling = max ?? Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((row, i) => (
        <li key={row.label} className="group">
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

export function LogRocketDashboard() {
  const totalSessions = SESSIONS_PER_DAY.reduce((sum, d) => sum + d.sessions, 0);
  const envTotal = ENVIRONMENT_GROUPS.reduce((sum, g) => sum + g.value, 0);
  const inAppShare = ENVIRONMENT_GROUPS[0].value / envTotal;
  const lengthTotal = SESSION_LENGTH.reduce((sum, b) => sum + b.value, 0);
  const shortShare = (SESSION_LENGTH[0].value + SESSION_LENGTH[1].value) / lengthTotal;
  const pdp = PAGES[0];
  const listicle = PAGES[1];
  const moneyEaters = BLOCKERS.filter((b) => b.eatsMoney).length;

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">LogRocket · SmallDogCO</h1>
          <p className="mt-1 text-xs text-slate-400">
            Beteendeanalys av {SOURCE.site} — vad besökarna faktiskt gör på sidan, och var det bryter.
          </p>
        </div>
        <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-slate-500">
          <div className="flex gap-1.5">
            <dt>Period</dt>
            <dd className="font-medium text-slate-300 tabular-nums">
              {SOURCE.windowStart} → {SOURCE.windowEnd}
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt>Källa</dt>
            <dd className="font-medium text-slate-300">{SOURCE.project}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt>Hämtad</dt>
            <dd className="font-medium text-slate-300 tabular-nums">{SOURCE.pulledAt}</dd>
          </div>
        </dl>
      </header>

      {/* Caveats — these come first on purpose. Without them the data reads inverted. */}
      <section className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-amber-400">
          <Info className="h-3 w-3" />
          Läs det här först
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {CAVEATS.map((c) => (
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
          value={pct(inAppShare)}
          sub="lämnar aldrig Facebooks eller Instagrams inbyggda browser. Designparametern, inte en fotnot."
          tone="warning"
        />
        <Stat
          Icon={Timer}
          label="Borta inom 30 sek"
          value={pct(shortShare)}
          sub="För två av tre besökare är första skärmen hela sajten."
          tone="warning"
        />
        <Stat
          Icon={MousePointerClick}
          label="CTA-genomslag PDP"
          value={pct(pdp.ctaShare ?? 0)}
          sub={`av klickande sessioner trycker huvud-CTA:n. Listiclen: ${pct(listicle.ctaShare ?? 0)}.`}
          tone="good"
        />
        <Stat
          Icon={TrendingDown}
          label="Fel som äter köp"
          value={String(moneyEaters)}
          sub="av fem tekniska fynd kan direkt stoppa ett köp. Resten är brus."
          tone="critical"
        />
      </div>

      {/* Volume */}
      <Card
        title="Sessioner per dag"
        hint={`${nf.format(totalSessions)} sessioner under ${SOURCE.recordedDays} inspelade dagar. 26/7 är en pågående dag.`}
      >
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={SESSIONS_PER_DAY} margin={{ top: 18, right: 8, left: -18, bottom: 0 }}>
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
                {SESSIONS_PER_DAY.map((d) => (
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
        <Card
          title="Var besökaren står"
          hint="Mer än hälften av trafiken är en inbyggd social webview — inte en riktig webbläsare."
          className="lg:col-span-1"
        >
          <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
            {ENVIRONMENT_GROUPS.map((g, i) => (
              <div
                key={g.label}
                style={{ width: `${(g.value / envTotal) * 100}%`, backgroundColor: STACK_COLORS[i] }}
                title={`${g.label}: ${nf.format(g.value)}`}
              />
            ))}
          </div>
          <ul className="mt-3 flex flex-col gap-2">
            {ENVIRONMENT_GROUPS.map((g, i) => (
              <li key={g.label} className="flex items-center justify-between gap-2 text-xs">
                <span className="flex min-w-0 items-center gap-2 text-slate-300">
                  <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: STACK_COLORS[i] }} />
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
          <BarList rows={BROWSERS} />
        </Card>

        <Card title="Operativsystem" hint="72 % mobil. Allt vi bygger måste klara en telefon i en webview.">
          <BarList rows={OPERATING_SYSTEMS} />
        </Card>
      </div>

      {/* Attention */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Uppmärksamhet"
          hint={`${pct(shortShare)} är borta inom 30 sekunder. Ljusare stapel = längre session.`}
        >
          <BarList rows={SESSION_LENGTH} colorAt={(i) => DURATION_RAMP[i]} />
          <p className="mt-4 border-t border-white/5 pt-3 text-xs leading-relaxed text-slate-400">
            Bara {pct(SESSION_LENGTH[3].value / lengthTotal)} stannar längre än två minuter. Hela erbjudandet — löfte,
            storleksbevis, pris, CTA — måste bäras ovanför vecket.
          </p>
        </Card>

        <Card title="Friktion" hint="LogRockets frustrationssignaler över hela perioden.">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Rage clicks", value: FRUSTRATION.rageClicks },
              { label: "Dead clicks", value: FRUSTRATION.deadClicks },
            ].map((f) => (
              <div key={f.label} className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{f.label}</div>
                <div className="mt-1 text-2xl font-semibold text-white">{f.value}</div>
              </div>
            ))}
          </div>
          <p className="mt-4 flex gap-2 border-t border-white/5 pt-3 text-xs leading-relaxed text-slate-400">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "#0ca30c" }} />
            {FRUSTRATION.verdict}
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
              {PAGES.map((p) => {
                const tone =
                  p.status === "good"
                    ? "#0ca30c"
                    : p.status === "warning"
                      ? "#fab219"
                      : p.status === "critical"
                        ? "#d03b3b"
                        : "#64748b";
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
                      {p.ctaShare === null ? (
                        <span className="text-xs text-slate-600">ej mätbart</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/5">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${p.ctaShare * 100}%`, backgroundColor: SERIES }}
                            />
                          </div>
                          <span className="text-xs font-semibold text-white tabular-nums">{pct(p.ctaShare)}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-1 py-3">
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                        style={{ backgroundColor: `${tone}1f`, color: tone }}
                      >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tone }} />
                        {p.status === "good"
                          ? "Skalar"
                          : p.status === "warning"
                            ? "Läcker"
                            : p.status === "critical"
                              ? "Trasig"
                              : "För lite data"}
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
          <BarList rows={CLICKS_SITEWIDE} />
        </Card>
        <Card title="PDP" hint={`${pdp.clickSessions} sessioner med klick. 58 % når huvud-CTA:n.`}>
          <BarList rows={CLICKS_PDP} />
        </Card>
        <Card title="Listicle1" hint={`${listicle.clickSessions} sessioner med klick. De klickar på texten, inte knappen.`}>
          <BarList rows={CLICKS_LISTICLE} />
        </Card>
      </div>

      {/* Objections */}
      <Card
        title="Invändningarna de faktiskt har"
        hint="FAQ-dragspel som öppnades på PDP:n. Låga tal — men riktningen är entydig och matchar vår research."
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <BarList
            rows={OBJECTIONS.map((o) => ({ label: o.label, value: o.value, note: o.kind }))}
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
          {BLOCKERS.map((b) => {
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
            {CONCLUSIONS.map((c) => (
              <li key={c.heading} className="border-l-2 border-white/10 pl-3">
                <h4 className="text-xs font-semibold text-white">{c.heading}</h4>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{c.body}</p>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Next 3 tests">
          <ol className="flex flex-col gap-3">
            {NEXT_TESTS.map((t, i) => (
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

      <p className="pb-2 text-center text-[10px] text-slate-600">
        Data hämtad från LogRocket {SOURCE.pulledAt} · {SOURCE.project} · siffrorna uppdateras manuellt i{" "}
        <span className="font-mono">src/lib/logrocket-data.ts</span>
      </p>
    </div>
  );
}
