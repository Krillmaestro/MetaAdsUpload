"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, Link2, Loader2, MessageSquareText, ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CreativeLoopData, CreativeRow, Period } from "@/lib/learning-loop/rows";
import { CLASSIFICATION_CONFIG } from "@/lib/evolve/classifier";
import { Breakdowns } from "./breakdowns";
import { CreativeDetails } from "./creative-details";
import { VerdictSelect } from "./verdict-select";
import { Kpi } from "./kpi";
import { EMPTY_FILTERS, FilterBar, filterOptions, matchesFilters, type Filters } from "./filters";
import { fmtMoney, fmtNum, fmtPct, fmtX, ROLE_CONFIG } from "./format";

type SortKey = "name" | "editor" | "product" | "format" | "age" | "spend" | "purchases" | "roas" | "cpa" | "hook" | "class" | "outcome";
const CLASS_ORDER: Record<string, number> = { breakthrough: 0, kpi_winner: 1, spend_winner: 2, new: 3, loser: 4 };
const OUTCOME_ORDER: Record<string, number> = { winner: 0, judged: 1, learning: 2, loser: 3 };

function sortValue(r: CreativeRow, key: SortKey): number | string {
  switch (key) {
    case "name": return r.name.toLowerCase();
    case "editor": return (r.editorName ?? "").toLowerCase();
    case "product": return (r.productLine ?? "").toLowerCase();
    case "format": return (r.format ?? "").toLowerCase();
    case "age": return r.ageDays;
    case "spend": return r.window.spend;
    case "purchases": return r.window.purchases;
    case "roas": return r.window.roas;
    case "cpa": return r.window.cpa || Number.POSITIVE_INFINITY;
    case "hook": return r.window.hookRate;
    case "class": return CLASS_ORDER[r.classification] ?? 9;
    case "outcome": return OUTCOME_ORDER[r.outcome] ?? 9;
  }
}

/**
 * One row per CREATIVE — the same video/name wherever it was copied. This is
 * the view for CBO scaling campaigns, where one ad set holds winners from many
 * briefs and the ad set itself says nothing about which brief worked.
 */
export function CreativesView({ account, period, periodLabel }: { account: string; period: Period; periodLabel: string }) {
  const [data, setData] = useState<CreativeLoopData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "spend", dir: "desc" });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ period });
      if (account) params.set("account", account);
      const res = await fetch(`/api/learning-loop/creatives?${params}`);
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

  const patchRow = (key: string, patch: Partial<CreativeRow>) =>
    setData((d) => d ? { ...d, rows: d.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) } : d);

  const options = useMemo(() => filterOptions(data?.rows ?? []), [data]);
  const rows = useMemo(() => {
    if (!data) return [];
    const list = data.rows.filter((r) =>
      matchesFilters(r, filters, `${r.name} ${r.ads.map((a) => `${a.adsetName} ${a.campaignName ?? ""}`).join(" ")} ${r.editorName ?? ""} ${r.problem ?? ""} ${r.assignment?.autoName ?? ""} ${r.assignment?.batchNumber ?? ""} ${r.script ?? ""}`),
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
  const targetRoas = data?.settings.targetRoas ?? 2;

  const Th = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <th className={cn("px-2 py-2 text-[10px] font-medium uppercase tracking-wider text-slate-500", className)}>
      <button type="button" onClick={() => toggleSort(k)} className={cn("inline-flex items-center gap-1 hover:text-slate-300", sort.key === k && "text-cyan-400")}>
        {children}
        {sort.key === k ? (sort.dir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-30" />}
      </button>
    </th>
  );

  if (loading && !data) return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-cyan-400" /></div>;
  if (error) {
    return (
      <div className="rounded-xl border border-white/5 bg-[#111827] py-12 text-center">
        <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-amber-400" />
        <p className="text-slate-400">{error}</p>
        <button type="button" onClick={() => fetchData()} className="mt-4 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-400">Försök igen</button>
      </div>
    );
  }
  if (!data) return null;
  const s = data.summary;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label={`Spend · ${periodLabel}`} value={fmtMoney(s.spend, currency)} sub={`${fmtNum(s.purchases)} köp · CPA ${s.cpa > 0 ? fmtMoney(s.cpa, currency) : "–"}`} />
        <Kpi label="ROAS" value={fmtX(s.roas)} sub={`mål ${data.settings.targetRoas}x · breakeven ${data.settings.breakevenRoas}x`} accent={s.roas >= data.settings.targetRoas ? "text-emerald-400" : s.roas >= data.settings.breakevenRoas ? "text-amber-300" : "text-red-400"} />
        <Kpi label="Creatives" value={String(s.tests)} sub={`${s.live} live just nu${data.truncated ? " · topp 1500 visas" : ""}`} />
        <Kpi label="Hit rate" value={s.judged > 0 ? fmtPct(s.hitRate, 0) : "–"} sub={`${s.winners} vinnare av ${s.judged} bedömda`} accent={s.hitRate >= 30 ? "text-emerald-400" : s.hitRate >= 15 ? "text-amber-300" : "text-red-400"} />
        <Kpi label="Losers" value={String(s.losers)} sub={`${s.judged - s.winners - s.losers} bedömda utan tydligt utfall`} accent="text-red-400/90" />
        <Kpi label="Lärdomar" value={`${s.withLearnings}/${s.judged}`} sub="bedömda creatives med skriven lärdom" accent={s.judged > 0 && s.withLearnings / s.judged >= 0.5 ? "text-emerald-400" : "text-amber-300"} />
      </div>

      <Breakdowns breakdowns={data.breakdowns} currency={currency} targetRoas={targetRoas} />

      <FilterBar filters={filters} onChange={setFilters} options={options} placeholder="Sök creative, ad set, batch, script…" shown={rows.length} total={data.rows.length} unit="creatives" loading={loading} />

      <div className="overflow-x-auto rounded-xl border border-white/5 bg-[#111827]">
        <table className="w-full min-w-[1280px] text-xs">
          <thead className="sticky top-0 z-10 bg-[#111827]">
            <tr className="border-b border-white/5">
              <th className="w-8" />
              <Th k="name" className="text-left">Creative</Th>
              <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-slate-500">Brief</th>
              <Th k="editor" className="text-left">Editor</Th>
              <Th k="product" className="text-left">Produkt</Th>
              <Th k="format" className="text-left">Format</Th>
              <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-slate-500">Problem</th>
              <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-slate-500">Lager</th>
              <Th k="age" className="text-right">Dagar</Th>
              <Th k="spend" className="text-right">Spend</Th>
              <Th k="purchases" className="text-right">Köp</Th>
              <Th k="roas" className="text-right">ROAS</Th>
              <Th k="cpa" className="text-right">CPA</Th>
              <Th k="hook" className="text-right">Hook</Th>
              <Th k="class" className="text-left">Klass</Th>
              <Th k="outcome" className="text-left">Verdict</Th>
              <th className="w-8 px-1 py-2 text-center text-[10px] text-slate-500" title="Script">📜</th>
              <th className="w-8 px-1 py-2 text-center text-[10px] text-slate-500" title="Lärdom">📝</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={18} className="px-4 py-10 text-center text-slate-600">Inga creatives matchar filtren.</td></tr>
            ) : rows.map((r) => {
              const isOpen = expanded.has(r.key);
              const cls = CLASSIFICATION_CONFIG[r.classification];
              return (
                <Fragment key={r.key}>
                  <tr onClick={() => toggleExpand(r.key)} className={cn("cursor-pointer border-b border-white/[0.04] hover:bg-white/[0.02]", isOpen && "bg-white/[0.02]")}>
                    <td className="px-2 text-slate-500">{isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</td>
                    <td className="max-w-[360px] px-2 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", r.isLive ? "bg-emerald-400" : "bg-slate-700")} />
                        {r.hookLabel && <span className="shrink-0 rounded bg-white/5 px-1 py-px font-mono text-[10px] text-slate-400">{r.hookLabel}</span>}
                        <span className="truncate font-medium text-slate-200" title={r.name}>{r.name}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-500">
                        <span>{r.ads.length} annons{r.ads.length === 1 ? "" : "er"} · {r.adsetIds.length} ad set</span>
                        <span className="truncate" title={r.ads[0]?.adsetName}>{r.ads[0]?.adsetName}</span>
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      {r.assignment ? (
                        <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px]", r.linkSource === "ad" ? "border-cyan-500/20 bg-cyan-500/10 text-cyan-300" : "border-white/10 bg-white/5 text-slate-300")} title={`${r.assignment.autoName}${r.linkSource === "adset" ? " (ärvd från ad setet)" : ""}`}>
                          #{r.assignment.batchNumber}
                          {r.assignment.hypothesis && <span className="text-cyan-500/70">•</span>}
                        </span>
                      ) : r.suggestion ? (
                        <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/20 bg-amber-500/5 px-1.5 py-0.5 font-mono text-[11px] text-amber-300" title={`Förslag: ${r.suggestion.assignmentName} (${r.suggestion.score}p)`}>
                          ? #{r.suggestion.assignmentBatch}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-slate-600"><Link2 className="h-3 w-3" /> —</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-slate-300">{r.editorName ?? <span className="text-slate-600">—</span>}</td>
                    <td className="px-2 py-2 text-slate-300">{r.productLine ?? <span className="text-slate-600">—</span>}</td>
                    <td className="px-2 py-2 text-slate-400">{r.format ?? <span className="text-slate-600">—</span>}</td>
                    <td className="max-w-[120px] truncate px-2 py-2 text-slate-400" title={r.problem ?? ""}>{r.problem ?? <span className="text-slate-600">—</span>}</td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-0.5">
                        {r.roles.map((role) => <span key={role} className={cn("rounded px-1 py-px text-[9px]", ROLE_CONFIG[role].bg, ROLE_CONFIG[role].color)}>{role === "testing" ? "Test" : role === "scaling" ? "Scale" : role === "graveyard" ? "GY" : role === "bof" ? "BOF" : "Övr"}</span>)}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right text-slate-400">{r.ageDays || "–"}</td>
                    <td className="px-2 py-2 text-right font-medium text-slate-200">{fmtMoney(r.window.spend, currency)}</td>
                    <td className="px-2 py-2 text-right text-slate-300">{fmtNum(r.window.purchases)}</td>
                    <td className={cn("px-2 py-2 text-right font-semibold", r.window.roas >= data.settings.targetRoas ? "text-emerald-400" : r.window.roas >= data.settings.breakevenRoas ? "text-amber-300" : r.window.roas > 0 ? "text-red-400" : "text-slate-600")}>{fmtX(r.window.roas)}</td>
                    <td className="px-2 py-2 text-right text-slate-300">{r.window.cpa > 0 ? fmtMoney(r.window.cpa, currency) : "–"}</td>
                    <td className="px-2 py-2 text-right text-slate-400">{r.window.hookRate > 0 ? fmtPct(r.window.hookRate, 0) : "–"}</td>
                    <td className="px-2 py-2"><span className={cn("inline-block rounded px-1.5 py-0.5 text-[10px] font-medium", cls.bg, cls.color)} title={r.recommendation}>{cls.label}</span></td>
                    <td className="px-2 py-2">
                      <VerdictSelect adIds={r.adIds} value={r.verdict} onChange={(v) => patchRow(r.key, { verdict: v as CreativeRow["verdict"], verdictAt: v ? new Date().toISOString() : null })} />
                    </td>
                    <td className="px-1 py-2 text-center"><ScrollText className={cn("mx-auto h-3.5 w-3.5", r.scriptSource === "own" ? "text-cyan-400" : r.scriptSource === "assignment" ? "text-cyan-400/50" : "text-slate-700")} /></td>
                    <td className="px-1 py-2 text-center"><MessageSquareText className={cn("mx-auto h-3.5 w-3.5", r.learnings ? "text-emerald-400" : r.judged ? "text-amber-500/60" : "text-slate-700")} /></td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={18} className="p-0">
                        <CreativeDetails row={r} currency={currency} accountNumber={accountNumber} targetRoas={targetRoas} periodLabel={periodLabel} onPatch={(p) => patchRow(r.key, p)} onRefresh={() => fetchData(true)} />
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
        En creative = samma video/bild eller samma annonsnamn i alla ad sets den kopierats till (testing, scaling, graveyard). Brief-koppling ärvs från ad setet om creativen inte har en egen; i scaling-set kopplar du per creative. Scriptet hämtas från briefens hook (H1/H2…) eller skrivs in direkt.
      </p>
    </>
  );
}
