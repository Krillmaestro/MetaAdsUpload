"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link2, Loader2, Repeat, Unlink, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { CreativeRow, LearningLoopRow, Period } from "@/lib/learning-loop/rows";
import { CLASSIFICATION_CONFIG } from "@/lib/evolve/classifier";
import { LinkPicker } from "@/components/learning-loop/link-picker";
import { VerdictSelect } from "@/components/learning-loop/verdict-select";
import { fmtMoney, fmtNum, fmtX, fmtPct } from "@/components/learning-loop/format";

interface PerfData {
  rows: LearningLoopRow[];
  creatives: CreativeRow[];
  period: Period;
  since: string | null;
  until: string;
  currency: string;
}

/**
 * "Where is this brief running and how is it doing" — the ad sets linked to
 * the assignment with their numbers. This is the data the user asked to have
 * ON the assignment; the Learning Loop page is the same data across all briefs.
 */
export function AssignmentPerformance({ assignmentId, assignmentName, isAdmin, isPosted }: { assignmentId: string; assignmentName: string; isAdmin?: boolean; isPosted?: boolean }) {
  const [period, setPeriod] = useState<Period>("30d");
  const [data, setData] = useState<PerfData | null>(null);
  const [loading, setLoading] = useState(true);
  const [picker, setPicker] = useState(false);
  const [unlinking, setUnlinking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/assignments/${assignmentId}/performance?period=${period}`);
      if (res.ok) setData(await res.json());
    } catch { /* leave empty */ } finally { setLoading(false); }
  }, [assignmentId, period]);

  useEffect(() => { load(); }, [load]);

  const unlink = async (adsetId: string) => {
    setUnlinking(adsetId);
    try {
      const res = await fetch("/api/learning-loop/adset", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adsetId, assignmentId: null }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Kunde inte koppla loss");
      toast.success("Kopplingen borttagen");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunde inte koppla loss");
    } finally { setUnlinking(null); }
  };

  const rows = data?.rows ?? [];
  const creatives = data?.creatives ?? [];
  const currency = data?.currency || "SEK";
  const total = rows.reduce((s, r) => ({ spend: s.spend + r.window.spend, purchases: s.purchases + r.window.purchases, value: s.value + r.window.purchaseValue }), { spend: 0, purchases: 0, value: 0 });
  const totalRoas = total.spend > 0 ? total.value / total.spend : 0;
  const lifetime = rows.reduce((s, r) => ({ spend: s.spend + r.lifetime.spend, value: s.value + r.lifetime.purchaseValue }), { spend: 0, value: 0 });

  return (
    <Card className="border-emerald-500/20 bg-emerald-500/[0.03]">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-emerald-400">
            <Repeat className="h-4 w-4" />
            Learning Loop · resultat
          </CardTitle>
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-0.5 rounded-md border border-white/10 bg-white/5 p-0.5">
              {(["7d", "30d", "lifetime"] as Period[]).map((p) => (
                <button key={p} type="button" onClick={() => setPeriod(p)} className={cn("rounded px-2 py-0.5 text-[11px]", period === p ? "bg-white/10 text-white" : "text-slate-400 hover:text-white")}>{p === "lifetime" ? "Lifetime" : p}</button>
              ))}
            </div>
            {isAdmin && (
              <Button size="sm" variant="outline" onClick={() => setPicker(true)} className="h-7 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10">
                <Link2 className="mr-1 h-3.5 w-3.5" /> Koppla ad set
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading && !data ? (
          <div className="flex items-center gap-2 py-3 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Hämtar…</div>
        ) : rows.length === 0 && creatives.length === 0 ? (
          <p className="text-sm text-slate-500">
            {isPosted ? "Inget ad set kopplat än. Koppla ett så syns spend, ROAS och verdict här." : "Inte live än — när videon publiceras kopplas ad setet automatiskt (eller manuellt här)."}
          </p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { l: "Spend", v: fmtMoney(total.spend, currency), s: `lifetime ${fmtMoney(lifetime.spend, currency)}` },
                { l: "Köp", v: fmtNum(total.purchases), s: `CPA ${total.purchases > 0 ? fmtMoney(total.spend / total.purchases, currency) : "–"}` },
                { l: "ROAS", v: fmtX(totalRoas), s: `lifetime ${fmtX(lifetime.spend > 0 ? lifetime.value / lifetime.spend : 0)}` },
                { l: "Ad sets", v: String(rows.length), s: `${rows.filter((r) => r.isLive).length} live` },
              ].map((k) => (
                <div key={k.l} className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">{k.l}</div>
                  <div className="text-sm font-semibold text-slate-100">{k.v}</div>
                  <div className="text-[10px] text-slate-500">{k.s}</div>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto rounded-lg border border-white/5">
              <table className="w-full text-xs">
                <thead className="bg-white/[0.03] text-[10px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">Ad set</th>
                    <th className="px-2 py-1.5 text-right font-medium">Spend</th>
                    <th className="px-2 py-1.5 text-right font-medium">Köp</th>
                    <th className="px-2 py-1.5 text-right font-medium">ROAS</th>
                    <th className="px-2 py-1.5 text-right font-medium">Hook</th>
                    <th className="px-2 py-1.5 text-left font-medium">Klass</th>
                    <th className="px-2 py-1.5 text-left font-medium">Verdict</th>
                    {isAdmin && <th className="w-8" />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const cls = CLASSIFICATION_CONFIG[r.classification];
                    return (
                      <tr key={r.adsetId} className="border-t border-white/[0.04]">
                        <td className="max-w-[260px] px-2 py-1.5">
                          <div className="truncate text-slate-200" title={r.name}>
                            <span className={cn("mr-1.5 inline-block h-1.5 w-1.5 rounded-full", r.isLive ? "bg-emerald-400" : "bg-slate-600")} />
                            {r.name}
                          </div>
                          <div className="truncate text-[10px] text-slate-500">{r.roleLabel} · {r.campaignName ?? "—"} · {r.ageDays} dagar</div>
                        </td>
                        <td className="px-2 py-1.5 text-right text-slate-200">{fmtMoney(r.window.spend, currency)}</td>
                        <td className="px-2 py-1.5 text-right text-slate-300">{fmtNum(r.window.purchases)}</td>
                        <td className={cn("px-2 py-1.5 text-right font-semibold", r.window.roas >= 2 ? "text-emerald-400" : r.window.roas > 0 ? "text-amber-300" : "text-slate-600")}>{fmtX(r.window.roas)}</td>
                        <td className="px-2 py-1.5 text-right text-slate-400">{r.window.hookRate > 0 ? fmtPct(r.window.hookRate, 0) : "–"}</td>
                        <td className="px-2 py-1.5"><span className={cn("rounded px-1.5 py-0.5 text-[10px]", cls.bg, cls.color)} title={r.recommendation}>{cls.label}</span></td>
                        <td className="px-2 py-1.5">
                          {isAdmin ? (
                            <VerdictSelect adsetId={r.adsetId} adsetName={r.name} campaignId={r.campaignId} value={r.verdict} onChange={() => load()} />
                          ) : (
                            <span className="text-slate-400">{r.verdict ?? "—"}</span>
                          )}
                        </td>
                        {isAdmin && (
                          <td className="px-1 py-1.5 text-right">
                            <button type="button" onClick={() => unlink(r.adsetId)} disabled={unlinking === r.adsetId} title="Koppla loss" className="text-slate-600 hover:text-red-400">
                              {unlinking === r.adsetId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />}
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {creatives.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Creatives · per hook, över alla ad sets</div>
                <div className="overflow-x-auto rounded-lg border border-white/5">
                  <table className="w-full text-xs">
                    <thead className="bg-white/[0.03] text-[10px] uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-medium">Creative</th>
                        <th className="px-2 py-1.5 text-left font-medium">Lager</th>
                        <th className="px-2 py-1.5 text-right font-medium">Spend</th>
                        <th className="px-2 py-1.5 text-right font-medium">Köp</th>
                        <th className="px-2 py-1.5 text-right font-medium">ROAS</th>
                        <th className="px-2 py-1.5 text-right font-medium">Hook</th>
                        <th className="px-2 py-1.5 text-left font-medium">Klass</th>
                        <th className="px-2 py-1.5 text-left font-medium">Verdict</th>
                      </tr>
                    </thead>
                    <tbody>
                      {creatives.map((c) => {
                        const cls = CLASSIFICATION_CONFIG[c.classification];
                        return (
                          <tr key={c.key} className="border-t border-white/[0.04]">
                            <td className="max-w-[260px] px-2 py-1.5">
                              <div className="truncate text-slate-200" title={c.name}>
                                <span className={cn("mr-1.5 inline-block h-1.5 w-1.5 rounded-full", c.isLive ? "bg-emerald-400" : "bg-slate-600")} />
                                {c.hookLabel && <span className="mr-1 rounded bg-white/5 px-1 font-mono text-[10px] text-slate-400">{c.hookLabel}</span>}
                                {c.name}
                              </div>
                              <div className="truncate text-[10px] text-slate-500">{c.ads.length} annons{c.ads.length === 1 ? "" : "er"} · {c.adsetIds.length} ad set{c.script ? " · script ✓" : ""}</div>
                            </td>
                            <td className="px-2 py-1.5 text-[10px] text-slate-400">{c.roleLabel}</td>
                            <td className="px-2 py-1.5 text-right text-slate-200">{fmtMoney(c.window.spend, currency)}</td>
                            <td className="px-2 py-1.5 text-right text-slate-300">{fmtNum(c.window.purchases)}</td>
                            <td className={cn("px-2 py-1.5 text-right font-semibold", c.window.roas >= 2 ? "text-emerald-400" : c.window.roas > 0 ? "text-amber-300" : "text-slate-600")}>{fmtX(c.window.roas)}</td>
                            <td className="px-2 py-1.5 text-right text-slate-400">{c.window.hookRate > 0 ? fmtPct(c.window.hookRate, 0) : "–"}</td>
                            <td className="px-2 py-1.5"><span className={cn("rounded px-1.5 py-0.5 text-[10px]", cls.bg, cls.color)} title={c.recommendation}>{cls.label}</span></td>
                            <td className="px-2 py-1.5">
                              {isAdmin ? <VerdictSelect adIds={c.adIds} value={c.verdict} onChange={() => load()} /> : <span className="text-slate-400">{c.verdict ?? "—"}</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {(rows.some((r) => r.learnings) || creatives.some((c) => c.learnings)) && (
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Lärdomar</div>
                {rows.filter((r) => r.learnings).map((r) => (
                  <p key={r.adsetId} className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-slate-300 whitespace-pre-wrap"><span className="text-slate-500">{r.name}: </span>{r.learnings}</p>
                ))}
                {creatives.filter((c) => c.learnings).map((c) => (
                  <p key={c.key} className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-slate-300 whitespace-pre-wrap"><span className="text-slate-500">{c.name}: </span>{c.learnings}</p>
                ))}
              </div>
            )}
            <Link href="/learning-loop" className="inline-flex items-center gap-1 text-[11px] text-cyan-400 hover:underline">
              Öppna i Learning Loop <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        )}
      </CardContent>
      {picker && (
        <LinkPicker mode="assignment" assignmentId={assignmentId} assignmentName={assignmentName} open={picker} onOpenChange={setPicker} onLinked={() => { setPicker(false); load(); }} />
      )}
    </Card>
  );
}
