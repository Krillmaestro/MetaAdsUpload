"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import {
  Trophy, DollarSign, TrendingUp, Target, Zap, Clock, CheckCircle2, Check, Lock, Flame, Video, Lightbulb,
  Gauge, MousePointerClick, ChevronDown, ChevronRight, Layers,
} from "lucide-react";
import { bonusReadiness, byBonusReadiness, bonusTierColor, BONUS_TIERS, type BonusTier } from "@/lib/bonus";

interface Ad {
  id: string; name: string; spend: number; impressions: number; purchases: number; purchaseValue: number;
  roas: number; ctr: number; hookRate: number; holdRate: number; cpc: number; cpm: number;
  angle: string | null; problem: string | null; templateName: string | null;
}
interface Adset {
  adsetId: string; adsetName: string; campaignId: string | null; strategistName: string | null;
  spend: number; impressions: number; purchases: number; purchaseValue: number;
  roas: number; ctr: number; hookRate: number; holdRate: number; cpc: number; cpm: number;
  bonus: number; bonusTier: number; tierLog: Record<string, string>; paidForAdset: number; outstanding: number;
  lifetimeSpend: number; lifetimeRoas: number; isWinner: boolean; graveyardOutcome: string | null;
  adCount: number; ads: Ad[];
}
interface Editor {
  editorId: string; editor: string; fullName: string; slug: string | null; userType: string;
  totalSpend: number; totalPurchaseValue: number; totalPurchases: number;
  roas: number; ctr: number; hookRate: number; holdRate: number; cpc: number; cpm: number;
  totalBonus: number; paidAmount: number; pendingAmount: number; unpaidAmount: number;
  adsetCount: number; winnerCount: number; graveyardSpendWinners: number; graveyardLosers: number;
  adsets: Adset[];
}
interface LeaderEntry { editorId: string; name: string; winners: number; hookRate: number }
interface ApiResponse {
  editor: Editor;
  timeseries: Array<{ date: string; spend: number; revenue: number; roas: number; purchases: number }>;
  leaderboard: LeaderEntry[];
  bonusTiers: BonusTier[];
  dateRange: { from: string; to: string };
  passwordRequired?: boolean;
}

const PRESETS = [
  { label: "7d", days: 7 }, { label: "14d", days: 14 }, { label: "30d", days: 30 }, { label: "90d", days: 90 },
];

function fmt(n: number, d = 0) { return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }
function isoDaysAgo(days: number) { return new Date(Date.now() - days * 86400000).toISOString().split("T")[0]; }
function hookColor(h: number) { return h >= 30 ? "text-emerald-400" : h >= 20 ? "text-amber-400" : h > 0 ? "text-red-400" : "text-slate-600"; }
function holdColor(h: number) { return h >= 50 ? "text-emerald-400" : h >= 40 ? "text-amber-400" : h > 0 ? "text-red-400" : "text-slate-600"; }
function roasColor(r: number, spend: number) { return r >= 2.5 ? "text-emerald-400" : r >= 2.0 ? "text-amber-400" : spend > 0 ? "text-red-400" : "text-slate-600"; }

function TierLadder({ tierLog, tiers }: { tierLog: Record<string, string>; tiers: BonusTier[] }) {
  const ladder = [...tiers].map((t) => t.bonus).sort((a, b) => a - b);
  if (ladder.length === 0) return null;
  return (
    <div className="flex items-center gap-1 mt-1 flex-wrap">
      {ladder.map((t) => {
        const hit = tierLog?.[String(t)];
        return (
          <span key={t} title={hit ? `$${t} reached ${hit}` : `$${t} not reached yet`}
            className={"rounded px-1.5 py-0.5 text-[9px] font-bold border " + (hit ? bonusTierColor(t) : "bg-white/[0.02] text-slate-600 border-white/5")}>
            ${t}{hit ? " ✓" : ""}
          </span>
        );
      })}
    </div>
  );
}

export default function PublicEditorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [days, setDays] = useState(30);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pwRequired, setPwRequired] = useState(false);
  const [pw, setPw] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async (password?: string) => {
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams({ from: isoDaysAgo(days), to: isoDaysAgo(0) });
      if (password) qs.set("pw", password);
      const res = await fetch(`/api/e/${slug}?${qs}`);
      if (res.status === 401) {
        const j = await res.json().catch(() => ({}));
        setPwRequired(true); setError(j.error || null); setData(null); return;
      }
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || "Could not load"); }
      setPwRequired(false); setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally { setLoading(false); }
  }, [slug, days]);

  useEffect(() => { load(); }, [load]);

  const editor = data?.editor;
  // Falls back to the built-in ladder so ranking never degrades to "no tiers,
  // everything looks finished" if the API omits them.
  const tiers = data?.bonusTiers?.length ? data.bonusTiers : BONUS_TIERS;

  const { winners, inflight } = useMemo(() => {
    const sets = editor?.adsets || [];
    return {
      winners: sets.filter((a) => a.bonus > 0).sort((a, b) => b.bonus - a.bonus),
      // Ranked by how close each ad set is to earning, NOT by spend. An ad set
      // that already clears the ROAS bar and only needs delivery is nearly
      // money in hand; a big spender at 0.8 ROAS cannot get there at all.
      inflight: sets
        .filter((a) => a.bonus === 0 && a.lifetimeSpend > 0)
        .sort(byBonusReadiness((a) => ({ spend: a.lifetimeSpend, roas: a.lifetimeRoas, locked: a.bonus }), tiers))
        .slice(0, 6),
    };
  }, [editor, tiers]);

  const toggle = (id: string) => setExpanded((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  if (pwRequired) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#111827] p-6 space-y-4">
          <div className="flex items-center gap-2 text-cyan-400"><Lock className="h-5 w-5" /><h1 className="text-lg font-semibold text-white">Protected page</h1></div>
          <p className="text-sm text-slate-400">This performance page requires a password.</p>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load(pw)} placeholder="Password"
            className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50" />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button onClick={() => load(pw)} className="w-full rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 transition-all">View my page</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:py-12 space-y-8">
      {/* Hero */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-600 text-xl font-bold text-white shadow-lg shadow-cyan-500/20">
            {(editor?.editor || slug).slice(0, 2).toUpperCase()}
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-cyan-400 flex items-center gap-1.5">
              {editor?.userType === "creative_strategist" ? <Lightbulb className="h-3 w-3" /> : <Video className="h-3 w-3" />}
              {editor?.userType === "creative_strategist" ? "Creative Strategist" : "Video Editor"}
            </p>
            <h1 className="text-3xl font-bold text-white tracking-tight">{editor?.fullName || slug}</h1>
            <p className="text-sm text-slate-500">Your performance &amp; bonus overview</p>
          </div>
        </div>
        <div className="flex rounded-xl border border-white/10 overflow-hidden self-start">
          {PRESETS.map((p) => (
            <button key={p.days} onClick={() => setDays(p.days)}
              className={`px-3.5 py-2 text-xs font-medium transition-all ${days === p.days ? "bg-cyan-500/20 text-cyan-300" : "text-slate-400 hover:text-slate-200 hover:bg-white/5"}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24"><div className="h-10 w-10 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" /></div>
      ) : error ? (
        <div className="rounded-2xl border border-white/5 bg-[#111827] py-16 text-center text-slate-400">{error}</div>
      ) : editor ? (
        <>
          {/* Bonus band */}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 to-emerald-500/[0.02] p-5">
              <div className="flex items-center gap-2 text-emerald-400 mb-1"><Trophy className="h-4 w-4" /><span className="text-[11px] font-semibold uppercase tracking-wider">Bonus earned (lifetime)</span></div>
              <div className="text-4xl font-bold text-white">${fmt(editor.totalBonus)}</div>
              <p className="text-xs text-slate-500 mt-1">{editor.winnerCount} qualifying ad sets</p>
            </div>
            <div className="rounded-2xl border border-white/5 bg-[#111827] p-5">
              <div className="flex items-center gap-2 text-cyan-400 mb-1"><CheckCircle2 className="h-4 w-4" /><span className="text-[11px] font-semibold uppercase tracking-wider">Paid out</span></div>
              <div className="text-4xl font-bold text-emerald-400">${fmt(editor.paidAmount)}</div>
              <p className="text-xs text-slate-500 mt-1">
                {editor.pendingAmount > 0
                  ? <>already paid to you · <span className="text-cyan-400">${fmt(editor.pendingAmount)} on its way</span></>
                  : "already paid to you"}
              </p>
            </div>
            <div className={`rounded-2xl border p-5 ${editor.unpaidAmount > 0 ? "border-amber-500/30 bg-amber-500/5" : "border-white/5 bg-[#111827]"}`}>
              <div className={`flex items-center gap-2 mb-1 ${editor.unpaidAmount > 0 ? "text-amber-400" : "text-slate-500"}`}><Clock className="h-4 w-4" /><span className="text-[11px] font-semibold uppercase tracking-wider">Outstanding</span></div>
              <div className={`text-4xl font-bold ${editor.unpaidAmount > 0 ? "text-amber-400" : "text-slate-500"}`}>${fmt(editor.unpaidAmount)}</div>
              <p className="text-xs text-slate-500 mt-1">awaiting payout</p>
            </div>
          </div>

          {/* How the bonus works */}
          {tiers.length > 0 && (
            <div className="rounded-2xl border border-white/5 bg-[#111827] p-5">
              <div className="flex items-center gap-2 mb-2"><Trophy className="h-4 w-4 text-amber-400" /><h2 className="text-sm font-semibold text-white">How your bonus works</h2></div>
              <p className="text-xs text-slate-500 mb-3">
                Bonuses are earned per AD SET, based on the ad set&apos;s total spend &amp; ROAS (all its ads combined). The moment an ad set
                reaches a level it stays locked in — even if ROAS later drops. Spend is shown in USD.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[...tiers].sort((a, b) => a.bonus - b.bonus).map((t) => (
                  <div key={t.bonus} className={`rounded-xl border p-3 ${bonusTierColor(t.bonus)}`}>
                    <div className="text-lg font-bold">${t.bonus}</div>
                    <div className="text-[11px] opacity-80">${t.minSpend.toLocaleString("en-US")}+ spend</div>
                    <div className="text-[11px] opacity-80">{t.minRoas}+ ROAS</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi icon={DollarSign} label="Spend" value={`$${fmt(editor.totalSpend, 0)}`} tint="text-purple-400" />
            <Kpi icon={TrendingUp} label="ROAS" value={`${editor.roas.toFixed(2)}x`} tint={roasColor(editor.roas, editor.totalSpend)} />
            <Kpi icon={Flame} label="Hook Rate" value={`${editor.hookRate.toFixed(1)}%`} tint={hookColor(editor.hookRate)} sub="target 30%+" />
            <Kpi icon={Gauge} label="Hold Rate" value={`${editor.holdRate.toFixed(1)}%`} tint={holdColor(editor.holdRate)} sub="target 50%+" />
            <Kpi icon={MousePointerClick} label="CTR" value={`${editor.ctr.toFixed(2)}%`} tint="text-cyan-400" />
            <Kpi icon={DollarSign} label="CPC" value={`$${editor.cpc.toFixed(2)}`} tint="text-slate-300" sub="per link click" />
            <Kpi icon={DollarSign} label="CPM" value={`$${editor.cpm.toFixed(2)}`} tint="text-slate-300" />
            <Kpi icon={Zap} label="Purchases" value={fmt(editor.totalPurchases)} tint="text-cyan-400" />
          </div>

          {/* Chart */}
          <div className="rounded-2xl border border-white/5 bg-[#111827] p-5">
            <div className="flex items-center gap-2 mb-4"><TrendingUp className="h-4 w-4 text-cyan-400" /><h2 className="text-sm font-semibold text-white">Your performance over time</h2><span className="text-xs text-slate-600">spend (bars) &amp; ROAS (line)</span></div>
            {data && data.timeseries.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={data.timeseries} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 10 }} tickFormatter={(d) => String(d).slice(5)} />
                  <YAxis yAxisId="left" tick={{ fill: "#64748b", fontSize: 10 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fill: "#64748b", fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "#0f1629", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 12 }} labelStyle={{ color: "#e2e8f0" }} />
                  <ReferenceLine yAxisId="right" y={2.0} stroke="#f59e0b" strokeDasharray="4 4" />
                  <Bar yAxisId="left" dataKey="spend" name="Spend ($)" fill="#8b5cf6" radius={[3, 3, 0, 0]} maxBarSize={28} />
                  <Line yAxisId="right" type="monotone" dataKey="roas" name="ROAS" stroke="#34d399" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : <div className="py-12 text-center text-sm text-slate-600">No data in this period yet.</div>}
          </div>

          {/* Winners + In-flight (ad sets) */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-white/5 bg-[#111827] overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-4 border-b border-white/5"><Trophy className="h-4 w-4 text-yellow-400" /><h2 className="text-sm font-semibold text-white">Your winning ad sets ({winners.length})</h2></div>
              <div className="divide-y divide-white/5 max-h-[360px] overflow-y-auto">
                {winners.length === 0 && <p className="px-5 py-8 text-center text-sm text-slate-600">No qualifying ad sets yet — keep creating! 💪</p>}
                {winners.map((s) => (
                  <div key={s.adsetId} className="flex items-center gap-3 px-5 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-200 truncate">{s.adsetName}</p>
                      <p className="text-[11px] text-slate-500">
                        ${fmt(s.lifetimeSpend)} spend · {s.lifetimeRoas.toFixed(2)}x ROAS · {s.adCount} ads
                        {s.outstanding === 0 && s.bonus > 0 && <span className="text-emerald-500"> · paid</span>}
                        {s.outstanding > 0 && <span className="text-amber-400"> · ${fmt(s.outstanding)} outstanding</span>}
                      </p>
                      <TierLadder tierLog={s.tierLog} tiers={tiers} />
                    </div>
                    <span className={`shrink-0 rounded-lg border px-2.5 py-1 text-xs font-bold ${bonusTierColor(s.bonus)}`}>${s.bonus}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/5 bg-[#111827] overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-4 border-b border-white/5"><Target className="h-4 w-4 text-cyan-400" /><h2 className="text-sm font-semibold text-white">On the way to a bonus</h2></div>
              <div className="divide-y divide-white/5 max-h-[360px] overflow-y-auto">
                {inflight.length === 0 && <p className="px-5 py-8 text-center text-sm text-slate-600">No active ad sets near a tier right now.</p>}
                {inflight.map((s) => {
                  const prog = bonusReadiness(s.lifetimeSpend, s.lifetimeRoas, s.bonus, tiers);
                  return (
                    <div key={s.adsetId} className="px-5 py-3">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <p className="text-sm text-slate-300 truncate">{s.adsetName}</p>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {/* ROAS cleared = only delivery stands between this and the payout. */}
                          {prog.roasMet && (
                            <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                              <Check className="h-2.5 w-2.5" />
                              ROAS klar
                            </span>
                          )}
                          {prog.next && <span className="text-[11px] font-medium text-cyan-400">→ ${prog.next.bonus}</span>}
                        </div>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
                        <div className={`h-full rounded-full ${prog.roasMet ? "bg-emerald-400" : "bg-slate-600"}`} style={{ width: `${Math.round(prog.spendProgress * 100)}%` }} />
                      </div>
                      <p className={`mt-1 text-[11px] font-medium ${prog.roasMet ? "text-emerald-400/90" : "text-slate-400"}`}>
                        {prog.requirement}
                      </p>
                      <p className="text-[10px] text-slate-600">{prog.hint}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Ad sets (expandable → per-ad) */}
          <div className="rounded-2xl border border-white/5 bg-[#111827] overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-white/5"><Layers className="h-4 w-4 text-cyan-400" /><h2 className="text-sm font-semibold text-white">Your ad sets ({editor.adsetCount}) — click to see each ad</h2></div>
            <div className="divide-y divide-white/5">
              {editor.adsets.length === 0 && <p className="px-5 py-10 text-center text-sm text-slate-600">No ad sets assigned to you yet.</p>}
              {editor.adsets.map((s) => {
                const isOpen = expanded.has(s.adsetId);
                return (
                  <div key={s.adsetId}>
                    <button onClick={() => toggle(s.adsetId)} className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors text-left">
                      {isOpen ? <ChevronDown className="h-4 w-4 text-slate-500 shrink-0" /> : <ChevronRight className="h-4 w-4 text-slate-500 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-200 truncate">{s.adsetName}</p>
                        <p className="text-[11px] text-slate-500">{s.adCount} ads
                          {s.graveyardOutcome === "spend_winner" && <span className="text-blue-400"> · ⚰ spend winner</span>}
                          {s.graveyardOutcome === "loser" && <span className="text-red-400"> · ⚰ loser</span>}
                        </p>
                      </div>
                      <div className="hidden sm:flex items-center gap-4 text-xs shrink-0">
                        <span className="text-slate-400">${fmt(s.spend)}</span>
                        <span className={roasColor(s.roas, s.spend)}>{s.roas.toFixed(2)}x</span>
                        <span className={hookColor(s.hookRate)}>{s.hookRate.toFixed(0)}% hook</span>
                        <span className={holdColor(s.holdRate)}>{s.holdRate.toFixed(0)}% hold</span>
                      </div>
                      {s.bonus > 0 ? <span className={`shrink-0 rounded-lg border px-2 py-0.5 text-xs font-bold ${bonusTierColor(s.bonus)}`}>${s.bonus}</span> : <span className="shrink-0 text-slate-600 text-sm w-8 text-right">—</span>}
                    </button>
                    {isOpen && (
                      <div className="bg-white/[0.01] border-t border-white/5 overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b border-white/5">
                              {["Ad", "Angle", "Spend", "ROAS", "Hook", "Hold", "CTR", "Purch."].map((h, i) => (
                                <th key={h} className={`px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500 ${i > 1 ? "text-right" : "text-left"}`}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {s.ads.map((ad) => (
                              <tr key={ad.id} className="border-b border-white/[0.03]">
                                <td className="px-4 py-2 text-xs text-slate-400 max-w-[220px] truncate">{ad.name}</td>
                                <td className="px-4 py-2 text-xs text-slate-500 max-w-[110px] truncate" title={ad.problem || undefined}>{ad.angle || "—"}</td>
                                <td className="px-4 py-2 text-right text-xs text-slate-400">${fmt(ad.spend)}</td>
                                <td className={`px-4 py-2 text-right text-xs ${roasColor(ad.roas, ad.spend)}`}>{ad.roas.toFixed(2)}x</td>
                                <td className={`px-4 py-2 text-right text-xs ${hookColor(ad.hookRate)}`}>{ad.hookRate.toFixed(1)}%</td>
                                <td className={`px-4 py-2 text-right text-xs ${holdColor(ad.holdRate)}`}>{ad.holdRate.toFixed(1)}%</td>
                                <td className="px-4 py-2 text-right text-xs text-slate-500">{ad.ctr.toFixed(2)}%</td>
                                <td className="px-4 py-2 text-right text-xs text-slate-400">{ad.purchases}</td>
                              </tr>
                            ))}
                            {s.ads.length === 0 && <tr><td colSpan={8} className="px-4 py-4 text-center text-xs text-slate-600">No ad data synced yet.</td></tr>}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <p className="text-center text-xs text-slate-600 pt-4">Bonuses lock in per ad set for life and never decrease. Spend shown in USD.</p>
        </>
      ) : null}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, tint, sub }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; tint: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-[#111827] p-4">
      <div className="flex items-center justify-between mb-2"><span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</span><Icon className={`h-4 w-4 ${tint}`} /></div>
      <div className={`text-2xl font-bold ${tint}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-600 mt-0.5">{sub}</div>}
    </div>
  );
}
