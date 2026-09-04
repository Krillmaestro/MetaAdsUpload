"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Repeat,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronRight,
  Plus,
  MessageSquareText,
  Link2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  AlertTriangle,
  Layers,
  Film,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { LearningLoopData, LearningLoopRow, Period } from "@/lib/learning-loop/rows";
import { CLASSIFICATION_CONFIG } from "@/lib/evolve/classifier";
import { Breakdowns } from "@/components/learning-loop/breakdowns";
import { Pipeline } from "@/components/learning-loop/pipeline";
import { RowDetails } from "@/components/learning-loop/row-details";
import { VerdictSelect } from "@/components/learning-loop/verdict-select";
import { CreativesView } from "@/components/learning-loop/creatives-view";
import { Journal } from "@/components/learning-loop/journal";
import { Kpi } from "@/components/learning-loop/kpi";
import { EMPTY_FILTERS, FilterBar, filterOptions, matchesFilters, type Filters } from "@/components/learning-loop/filters";
import { fmtMoney, fmtNum, fmtPct, fmtX, ROLE_CONFIG } from "@/components/learning-loop/format";

const PERIOD_OPTIONS: { v: Period; l: string }[] = [
  { v: "7d", l: "7 dagar" },
  { v: "14d", l: "14 dagar" },
  { v: "30d", l: "30 dagar" },
  { v: "90d", l: "90 dagar" },
  { v: "lifetime", l: "Lifetime" },
];

type View = "adsets" | "creatives";
type SortKey = "name" | "editor" | "product" | "format" | "age" | "spend" | "scaled" | "purchases" | "roas" | "cpa" | "hook" | "class" | "outcome";
const CLASS_ORDER: Record<string, number> = { breakthrough: 0, kpi_winner: 1, spend_winner: 2, new: 3, loser: 4 };
const OUTCOME_ORDER: Record<string, number> = { winner: 0, judged: 1, learning: 2, loser: 3 };

function sortValue(r: LearningLoopRow, key: SortKey): number | string {
  switch (key) {
    case "name": return r.name.toLowerCase();
    case "editor": return (r.editorName ?? "").toLowerCase();
    case "product": return (r.productLine ?? "").toLowerCase();
    case "format": return (r.format ?? "").toLowerCase();
    case "age": return r.ageDays;
    case "spend": return r.window.spend;
    case "scaled": return r.scaled.window.spend;
    case "purchases": return r.window.purchases;
    case "roas": return r.window.roas;
    case "cpa": return r.window.cpa || Number.POSITIVE_INFINITY;
    case "hook": return r.window.hookRate;
    case "class": return CLASS_ORDER[r.classification] ?? 9;
    case "outcome": return OUTCOME_ORDER[r.outcome] ?? 9;
  }
}

function readStoredView(): View {
  try { return localStorage.getItem("learning-loop-view") === "creatives" ? "creatives" : "adsets"; } catch { return "adsets"; }
}

export default function LearningLoopPage() {
  const [view, setView] = useState<View>("adsets");
  const [account, setAccount] = useState<string>("");
  const [period, setPeriod] = useState<Period>("30d");
  const [data, setData] = useState<LearningLoopData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "spend", dir: "desc" });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [jumpTarget, setJumpTarget] = useState<string | null>(null);

  useEffect(() => {
    // ?adset=<id> (from the assignment card) opens straight onto that row.
    let fromUrl: string | null = null;
    try { fromUrl = new URLSearchParams(window.location.search).get("adset"); } catch { /* ignore */ }
    if (fromUrl) { setView("adsets"); setExpanded(new Set([fromUrl])); setJumpTarget(fromUrl); }
    else setView(readStoredView());
  }, []);
  const changeView = (v: View) => { setView(v); try { localStorage.setItem("learning-loop-view", v); } catch { /* ignore */ } };

  /** Expand + scroll to an ad set row — from a container's creative list or the Creatives view. */
  const jumpToAdset = (adsetId: string) => {
    changeView("adsets");
    setFilters(EMPTY_FILTERS);
    setExpanded((s) => new Set(s).add(adsetId));
    setJumpTarget(adsetId);
  };
  useEffect(() => {
    if (!jumpTarget || !data || view !== "adsets") return;
    const t = setTimeout(() => {
      const el = document.getElementById(`adset-row-${jumpTarget}`);
      if (!el) { toast.info("Ad setet finns inte i den här perioden — prova Lifetime."); setJumpTarget(null); return; }
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("ring-1", "ring-cyan-400/60");
      setTimeout(() => el.classList.remove("ring-1", "ring-cyan-400/60"), 2500);
      setJumpTarget(null);
    }, 150);
    return () => clearTimeout(t);
  }, [jumpTarget, data, view]);

  const fetchData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ period });
      if (account) params.set("account", account);
      const res = await fetch(`/api/learning-loop?${params}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Kunde inte hämta");
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Okänt fel");
    } finally {
      setLoading(false);
    }
  }, [account, period]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const refreshFromMeta = async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/learning-loop/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account: account || null }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Kunde inte uppdatera");
      toast.success(`${d.adsets} ad sets uppdaterade · ${d.links?.applied ?? 0} ad sets + ${d.links?.adsApplied ?? 0} creatives kopplade`);
      await fetchData(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunde inte uppdatera");
    } finally {
      setRefreshing(false);
    }
  };

  const patchRow = (adsetId: string, patch: Partial<LearningLoopRow>) => {
    setData((d) => d ? { ...d, rows: d.rows.map((r) => (r.adsetId === adsetId ? { ...r, ...patch } : r)) } : d);
  };

  const options = useMemo(() => filterOptions(data?.rows ?? []), [data]);
  const rows = useMemo(() => {
    if (!data) return [];
    const list = data.rows.filter((r) =>
      matchesFilters(r, filters, `${r.name} ${r.campaignName ?? ""} ${r.editorName ?? ""} ${r.problem ?? ""} ${r.assignment?.autoName ?? ""} ${r.assignment?.batchNumber ?? ""}`),
    );
    const dir = sort.dir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      const va = sortValue(a, sort.key);
      const vb = sortValue(b, sort.key);
      if (typeof va === "string" && typeof vb === "string") return va.localeCompare(vb) * dir;
      return ((va as number) - (vb as number)) * dir || b.window.spend - a.window.spend;
    });
    return list;
  }, [data, filters, sort]);

  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: ["name", "editor", "product", "format"].includes(key) ? "asc" : "desc" }));
  const toggleExpand = (id: string) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const currency = data?.currency ?? "SEK";
  const accountNumber = data?.account ? data.account.replace(/^act_/, "") : null;
  const periodLabel = PERIOD_OPTIONS.find((p) => p.v === period)?.l ?? period;
  const targetRoas = data?.settings.targetRoas ?? 2;
  const effectiveAccount = account || data?.account || "";

  const Th = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <th className={cn("px-2 py-2 text-[10px] font-medium uppercase tracking-wider text-slate-500", className)}>
      <button type="button" onClick={() => toggleSort(k)} className={cn("inline-flex items-center gap-1 hover:text-slate-300", sort.key === k && "text-cyan-400")}>
        {children}
        {sort.key === k ? (sort.dir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-30" />}
      </button>
    </th>
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold text-white">
            <Repeat className="h-6 w-6 text-cyan-400" />
            Learning Loop
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">Brief → live → resultat → verdict → lärdom → nästa brief. Sorterat på spend.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-lg border border-white/10 bg-white/5 p-0.5">
            <button type="button" onClick={() => changeView("adsets")} className={cn("inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors", view === "adsets" ? "bg-cyan-500/15 text-cyan-200" : "text-slate-400 hover:text-white")}>
              <Layers className="h-3.5 w-3.5" /> Ad sets
            </button>
            <button type="button" onClick={() => changeView("creatives")} className={cn("inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors", view === "creatives" ? "bg-cyan-500/15 text-cyan-200" : "text-slate-400 hover:text-white")}>
              <Film className="h-3.5 w-3.5" /> Creatives
            </button>
          </div>
          {data && data.accounts.length > 1 && (
            <select
              value={account || data.account || "all"}
              onChange={(e) => setAccount(e.target.value)}
              className="h-9 rounded-lg border border-white/10 bg-white/5 px-2.5 text-xs text-white outline-none focus:border-cyan-500/50"
            >
              {data.accounts.map((a) => <option key={a.id} value={a.id} className="bg-[#111827]">{a.name} ({a.currency})</option>)}
              <option value="all" className="bg-[#111827]">Alla konton</option>
            </select>
          )}
          <div className="flex items-center gap-0.5 rounded-lg border border-white/10 bg-white/5 p-0.5">
            {PERIOD_OPTIONS.map((p) => (
              <button key={p.v} type="button" onClick={() => setPeriod(p.v)} className={cn("rounded-md px-2.5 py-1.5 text-xs transition-colors", period === p.v ? "bg-white/10 text-white" : "text-slate-400 hover:text-white")}>
                {p.l}
              </button>
            ))}
          </div>
          <button type="button" onClick={refreshFromMeta} disabled={refreshing} title="Hämta ad set-namn/status från Meta och kör auto-koppling" className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-50">
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} /> Uppdatera från Meta
          </button>
          <Link href="/assignments" className="inline-flex h-9 items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-500 to-cyan-600 px-3 text-xs font-medium text-white hover:from-cyan-400 hover:to-cyan-500">
            <Plus className="h-3.5 w-3.5" /> Ny brief
          </Link>
        </div>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-cyan-400" /></div>
      ) : error ? (
        <div className="rounded-xl border border-white/5 bg-[#111827] py-12 text-center">
          <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-amber-400" />
          <p className="text-slate-400">{error}</p>
          <button type="button" onClick={() => fetchData()} className="mt-4 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-400">Försök igen</button>
        </div>
      ) : data ? (
        <>
          <Journal account={effectiveAccount} data={data} currency={currency} />
          {view === "creatives" ? (
            <>
              <Pipeline pipeline={data.pipeline} onChanged={() => fetchData(true)} />
              <CreativesView key={`${effectiveAccount}|${period}`} account={effectiveAccount} period={period} periodLabel={periodLabel} onJumpToAdset={jumpToAdset} />
            </>
          ) : (
            <>
              {/* KPIs */}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
                <Kpi label={`Spend · ${periodLabel}`} value={fmtMoney(data.summary.spend, currency)} sub={`${fmtNum(data.summary.purchases)} köp · CPA ${data.summary.cpa > 0 ? fmtMoney(data.summary.cpa, currency) : "–"}`} />
                <Kpi label="ROAS" value={fmtX(data.summary.roas)} sub={data.summary.ncRoas ? `ncROAS ${fmtX(data.summary.ncRoas)}` : `mål ${data.settings.targetRoas}x · breakeven ${data.settings.breakevenRoas}x`} accent={data.summary.roas >= data.settings.targetRoas ? "text-emerald-400" : data.summary.roas >= data.settings.breakevenRoas ? "text-amber-300" : "text-red-400"} />
                <Kpi label="Tester" value={String(data.summary.tests)} sub={`${data.summary.live} live just nu`} />
                <Kpi label="Hit rate" value={data.summary.judged > 0 ? fmtPct(data.summary.hitRate, 0) : "–"} sub={`${data.summary.winners} vinnare av ${data.summary.judged} bedömda`} accent={data.summary.hitRate >= 30 ? "text-emerald-400" : data.summary.hitRate >= 15 ? "text-amber-300" : "text-red-400"} />
                <Kpi label="Losers" value={String(data.summary.losers)} sub={`${data.summary.judged - data.summary.winners - data.summary.losers} bedömda utan tydligt utfall`} accent="text-red-400/90" />
                <Kpi label="Lärdomar" value={`${data.summary.withLearnings}/${data.summary.judged}`} sub="bedömda tester med skriven lärdom" accent={data.summary.judged > 0 && data.summary.withLearnings / data.summary.judged >= 0.5 ? "text-emerald-400" : "text-amber-300"} />
                <Kpi label="Pipeline" value={String(data.summary.pipeline)} sub={data.summary.unlinkedPosted > 0 ? `${data.summary.unlinkedPosted} postade utan koppling` : "briefs utan ad set"} accent={data.summary.unlinkedPosted > 0 ? "text-amber-300" : undefined} />
              </div>

              <Breakdowns breakdowns={data.breakdowns} currency={currency} targetRoas={targetRoas} />

              <Pipeline pipeline={data.pipeline} onChanged={() => fetchData(true)} />

              <FilterBar filters={filters} onChange={setFilters} options={options} placeholder="Sök ad set, kampanj, batch, problem…" shown={rows.length} total={data.rows.length} unit="ad sets" loading={loading} />

              {/* Table */}
              <div className="overflow-x-auto rounded-xl border border-white/5 bg-[#111827]">
                <table className="w-full min-w-[1280px] text-xs">
                  <thead className="sticky top-0 z-10 bg-[#111827]">
                    <tr className="border-b border-white/5">
                      <th className="w-8" />
                      <Th k="name" className="text-left">Ad set</Th>
                      <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-slate-500">Brief</th>
                      <Th k="editor" className="text-left">Editor</Th>
                      <Th k="product" className="text-left">Produkt</Th>
                      <Th k="format" className="text-left">Format</Th>
                      <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-slate-500">Problem</th>
                      <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-slate-500">LP</th>
                      <Th k="age" className="text-right">Dagar</Th>
                      <Th k="spend" className="text-right">Spend</Th>
                      <Th k="scaled" className="text-right">+Scaling</Th>
                      <Th k="purchases" className="text-right">Köp</Th>
                      <Th k="roas" className="text-right">ROAS</Th>
                      <Th k="cpa" className="text-right">CPA</Th>
                      <Th k="hook" className="text-right">Hook</Th>
                      <Th k="class" className="text-left">Klass</Th>
                      <Th k="outcome" className="text-left">Verdict</Th>
                      <th className="w-10 px-2 py-2 text-center text-[10px] font-medium uppercase tracking-wider text-slate-500" title="Lärdom">📝</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr><td colSpan={18} className="px-4 py-10 text-center text-slate-600">Inga ad sets matchar filtren.</td></tr>
                    ) : rows.map((r) => {
                      const isOpen = expanded.has(r.adsetId);
                      const cls = CLASSIFICATION_CONFIG[r.classification];
                      const role = ROLE_CONFIG[r.role];
                      return (
                        <Fragment key={r.adsetId}>
                          <tr id={`adset-row-${r.adsetId}`} onClick={() => toggleExpand(r.adsetId)} className={cn("cursor-pointer border-b border-white/[0.04] transition-shadow hover:bg-white/[0.02]", isOpen && "bg-white/[0.02]")}>
                            <td className="px-2 text-slate-500">{isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</td>
                            <td className="max-w-[340px] px-2 py-2">
                              <div className="flex items-center gap-1.5">
                                <span className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", r.isLive ? "bg-emerald-400" : "bg-slate-700")} title={r.isLive ? "Spend senaste 3 dagarna" : "Ingen spend senaste 3 dagarna"} />
                                <span className="truncate font-medium text-slate-200" title={r.name}>{r.name}</span>
                              </div>
                              <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-500">
                                <span className={cn("rounded px-1 py-px", role.bg, role.color)}>{r.roleLabel}</span>
                                {r.isContainer && <span className="rounded bg-white/10 px-1 py-px text-slate-300" title="Scaling-behållare: creatives från flera briefs. Räknas inte som test — lärdomen bokförs på varje creatives ursprungs-ad set.">behållare · {r.creativesCount} creatives</span>}
                                <span className="truncate" title={r.campaignName ?? ""}>{r.campaignName ?? "—"}</span>
                              </div>
                            </td>
                            <td className="px-2 py-2">
                              {r.assignment ? (
                                <span className="inline-flex items-center gap-1 rounded-md border border-cyan-500/20 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[11px] text-cyan-300" title={r.assignment.autoName}>
                                  #{r.assignment.batchNumber}
                                  {r.assignment.hypothesis && <span className="text-cyan-500/70" title="Har hypotes">•</span>}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] text-slate-600" title="Ingen brief kopplad — öppna raden för att koppla"><Link2 className="h-3 w-3" /> —</span>
                              )}
                            </td>
                            <td className="px-2 py-2 text-slate-300">{r.editorName ?? <span className="text-slate-600">—</span>}</td>
                            <td className="px-2 py-2 text-slate-300">{r.productLine ?? <span className="text-slate-600">—</span>}</td>
                            <td className="px-2 py-2 text-slate-400">{r.format ?? <span className="text-slate-600">—</span>}</td>
                            <td className="max-w-[120px] truncate px-2 py-2 text-slate-400" title={r.problem ?? ""}>{r.problem ?? <span className="text-slate-600">—</span>}</td>
                            <td className="max-w-[100px] truncate px-2 py-2 text-slate-400" title={r.landing ?? ""}>{r.landing ?? <span className="text-slate-600">—</span>}</td>
                            <td className="px-2 py-2 text-right text-slate-400">{r.ageDays || "–"}</td>
                            <td className="px-2 py-2 text-right font-medium text-slate-200">{fmtMoney(r.window.spend, currency)}</td>
                            <td className="px-2 py-2 text-right">
                              {r.scaled.copies.length > 0 ? (
                                <span className="text-violet-300" title={`Ingår i Spend: ${r.scaled.copies.length} kopior i scaling/BOF/graveyard · scaling-ROAS ${fmtX(r.scaled.window.roas)} · eget ${fmtMoney(r.own.window.spend, currency)} @ ${fmtX(r.own.window.roas)}`}>
                                  {fmtMoney(r.scaled.window.spend, currency)}
                                </span>
                              ) : <span className="text-slate-700">–</span>}
                            </td>
                            <td className="px-2 py-2 text-right text-slate-300">{fmtNum(r.window.purchases)}</td>
                            <td className={cn("px-2 py-2 text-right font-semibold", r.window.roas >= data.settings.targetRoas ? "text-emerald-400" : r.window.roas >= data.settings.breakevenRoas ? "text-amber-300" : r.window.roas > 0 ? "text-red-400" : "text-slate-600")}>{fmtX(r.window.roas)}</td>
                            <td className="px-2 py-2 text-right text-slate-300">{r.window.cpa > 0 ? fmtMoney(r.window.cpa, currency) : "–"}</td>
                            <td className="px-2 py-2 text-right text-slate-400">{r.window.hookRate > 0 ? fmtPct(r.window.hookRate, 0) : "–"}</td>
                            <td className="px-2 py-2">
                              {r.isContainer ? (
                                <span className="inline-block rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-slate-400" title={r.recommendation}>Behållare</span>
                              ) : (
                                <span className={cn("inline-block rounded px-1.5 py-0.5 text-[10px] font-medium", cls.bg, cls.color)} title={r.recommendation}>{cls.label}</span>
                              )}
                            </td>
                            <td className="px-2 py-2">
                              {r.isContainer ? (
                                <span className="text-[10px] text-slate-600" title="Sätt verdict per creative i Creatives-vyn">per creative</span>
                              ) : (
                                <VerdictSelect adsetId={r.adsetId} adsetName={r.name} campaignId={r.campaignId} value={r.verdict} onChange={(v) => patchRow(r.adsetId, { verdict: v as LearningLoopRow["verdict"], verdictAt: v ? new Date().toISOString() : null })} />
                              )}
                            </td>
                            <td className="px-2 py-2 text-center">
                              <MessageSquareText className={cn("mx-auto h-3.5 w-3.5", r.learnings ? "text-emerald-400" : r.judged ? "text-amber-500/60" : "text-slate-700")} />
                            </td>
                          </tr>
                          {isOpen && (
                            <tr>
                              <td colSpan={18} className="p-0">
                                <RowDetails row={r} currency={currency} accountNumber={accountNumber} targetRoas={targetRoas} periodLabel={periodLabel} onPatch={(p) => patchRow(r.adsetId, p)} onRefresh={() => fetchData(true)} onJumpToAdset={jumpToAdset} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-slate-600">
                Klass = Evolve-klassning på periodens siffror (3× CPA-regeln, mål {data.settings.targetRoas}x, breakeven {data.settings.breakevenRoas}x). Verdict = teamets beslut, väger tyngre än klassen i hit rate. Spend, ROAS och klass på en rad inkluderar radens creatives var de än kör — +Scaling visar hur mycket som kommer från scaling/BOF/graveyard-kopior. Scaling-behållare (&quot;Scaling Winners&quot;) räknas aldrig som test; klicka på ursprunget i behållaren för att göra learning där. Insights synkas nattligen; &quot;Uppdatera från Meta&quot; hämtar ad set-namn/status och kör auto-kopplingen. Byt till <button type="button" onClick={() => changeView("creatives")} className="text-cyan-400 hover:underline">Creatives</button> för scaling-kampanjer där ett ad set rymmer många briefs.
              </p>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
