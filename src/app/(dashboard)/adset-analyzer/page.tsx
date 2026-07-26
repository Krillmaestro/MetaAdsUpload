"use client";

import { useState, useEffect, useCallback } from "react";
import {
  BarChart3,
  RefreshCw,
  Calendar,
  AlertTriangle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Pause,
  Skull,
  Check,
  Tag,
  Trophy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { format } from "date-fns";
import { AdsetOwnerPicker, type TeamMember } from "@/components/editors/adset-owner-picker";
import { AdsetAutoAssignDialog } from "@/components/editors/adset-auto-assign-dialog";
import { Wand2 } from "lucide-react";

type Classification = "breakthrough" | "spend_winner" | "kpi_winner" | "loser" | "new";

interface AdInSet {
  id: string;
  name: string;
  status: string;
  spend: number;
  roas: number;
  purchases: number;
  cpa: number;
}

interface ClassifiedAdset {
  id: string;
  name: string;
  status: string;
  campaignId: string;
  campaignName: string;
  adCount: number;
  ads: AdInSet[];
  spend: number;
  purchases: number;
  purchaseValue: number;
  roas: number;
  cpa: number;
  frequency: number;
  spendProgress: number;
  spendThreshold: number;
  classification: Classification;
  recommendation: string;
  ncRoas: number | null;
  ncRevenue: number;
}

interface AdsetAnalyzerData {
  settings: { targetRoas: number; breakevenRoas: number; targetCpa: number };
  summary: {
    totalSpend: number;
    totalRevenue: number;
    totalPurchases: number;
    overallRoas: number;
    totalAdsets: number;
    classificationCounts: Record<Classification, number>;
  };
  adsets: ClassifiedAdset[];
  dateRange: { since: string; until: string };
  campaigns: Array<{ id: string; name: string }>;
}

const CLASS_CONFIG: Record<Classification, { label: string; color: string; bg: string; border: string; action: string }> = {
  breakthrough: { label: "Breakthrough", color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20", action: "Keep!" },
  spend_winner: { label: "Spend Winner", color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20", action: "Graveyard" },
  kpi_winner: { label: "KPI Winner", color: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/20", action: "Let it run" },
  loser: { label: "Loser", color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20", action: "Turn off" },
  new: { label: "Ny", color: "text-slate-400", bg: "bg-white/5", border: "border-white/10", action: "Wait" },
};

type DateMode = "preset" | "today" | "custom";

interface AdsetMeta {
  videoEditorId: string | null;
  creativeStrategistId: string | null;
  angle: string | null;
  problem: string | null;
  verdict: string | null;
}

const EMPTY_META: AdsetMeta = { videoEditorId: null, creativeStrategistId: null, angle: null, problem: null, verdict: null };

export default function AdSetAnalyzerPage() {
  const [data, setData] = useState<AdsetAnalyzerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateMode, setDateMode] = useState<DateMode>("preset");
  const [presetDays, setPresetDays] = useState(7);
  const [customFrom, setCustomFrom] = useState(format(new Date(), "yyyy-MM-dd"));
  const [customTo, setCustomTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [campaignFilter, setCampaignFilter] = useState("");
  const [classFilter, setClassFilter] = useState<Classification | null>(null);
  const [tagFilter, setTagFilter] = useState<"confirmed" | "untagged" | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [acting, setActing] = useState<string | null>(null);
  const [graveyardChoiceFor, setGraveyardChoiceFor] = useState<string | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [ownersByAdset, setOwnersByAdset] = useState<Record<string, AdsetMeta>>({});
  const [angleOptions, setAngleOptions] = useState<string[]>([]);
  const [problemOptions, setProblemOptions] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<{ id: string; name: string; currency: string }[]>([]);
  const [account, setAccount] = useState<string>("");
  const [autoAssignOpen, setAutoAssignOpen] = useState(false);

  // Which ad account to analyse. Without an explicit choice this page reports on
  // whatever is active in settings — which is how it ended up showing Glimmora
  // while the editors' work lives in DogDivaCOmain. The pick is remembered, and
  // DogDivaCO is the default because that is where the video batches run.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/meta/connection");
        if (!res.ok) return;
        const j = await res.json();
        type Conn = { id: number; isActive?: boolean; adAccounts?: { id: string; name: string; currency: string }[] };
        const conns: Conn[] = j?.connections ?? [];
        const conn = conns.find((c) => c.isActive) ?? conns[0];
        const list = (conn?.adAccounts ?? []).filter((a) => a?.id && a?.name);
        if (!list.length) return;
        setAccounts(list);
        const saved = typeof window !== "undefined" ? localStorage.getItem("adsetAnalyzerAccount") : null;
        const dogdiva = list.find((a) => /dogdiva/i.test(a.name));
        const initial =
          (saved && list.some((a) => a.id === saved) ? saved : null) ??
          dogdiva?.id ??
          j?.active?.activeAdAccountId ??
          list[0].id;
        setAccount(initial);
      } catch { /* not connected */ }
    })();
  }, []);

  const chooseAccount = useCallback((id: string) => {
    setAccount(id);
    try { localStorage.setItem("adsetAnalyzerAccount", id); } catch { /* private mode */ }
  }, []);

  // Team members for the owner picker (admin only — silently empty otherwise).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/users");
        if (!res.ok) return;
        const { users } = await res.json();
        setMembers(
          (users || [])
            .filter((u: { isActive?: boolean }) => u.isActive !== false)
            .map((u: { id: string; name: string; userType?: string; role?: string }) => ({
              id: u.id,
              name: u.name,
              userType: u.userType,
              role: u.role,
            }))
        );
      } catch { /* not admin / not logged in */ }
    })();
  }, []);

  // Angle/problem options for the tag selects (shared with the uploader).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/options");
        if (!res.ok) return;
        const j = await res.json();
        setAngleOptions((j.angles || []).map((a: { name: string }) => a.name));
        setProblemOptions((j.problems || []).map((p: { name: string }) => p.name));
      } catch { /* ignore */ }
    })();
  }, []);

  const buildUrl = useCallback(() => {
    const params = new URLSearchParams();
    if (dateMode === "today") params.set("days", "0");
    else if (dateMode === "custom") { params.set("since", customFrom); params.set("until", customTo); }
    else params.set("days", String(presetDays));
    if (account) params.set("account", account);
    return `/api/evolve/adset-classify?${params}`;
  }, [dateMode, presetDays, customFrom, customTo, account]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(buildUrl());
      if (!res.ok) {
        let msg = "Failed to fetch";
        try { const j = await res.json(); msg = j.error || msg; } catch { msg = `Server error (${res.status})`; }
        throw new Error(msg);
      }
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [buildUrl]);

  // Debounce filter changes to avoid rapid API calls
  useEffect(() => {
    const timer = setTimeout(() => { fetchData(); }, 300);
    return () => clearTimeout(timer);
  }, [fetchData]);

  // Load existing owners + tags/verdict for the ad sets currently shown.
  useEffect(() => {
    if (!data) return;
    const adsetIds = data.adsets.map((a) => a.id);
    if (adsetIds.length === 0) return;
    (async () => {
      try {
        const res = await fetch(`/api/adset-owner?adsetIds=${encodeURIComponent(adsetIds.join(","))}`);
        if (!res.ok) return;
        const { owners } = await res.json();
        const map: Record<string, AdsetMeta> = {};
        for (const o of owners || []) {
          map[o.adsetId] = {
            videoEditorId: o.videoEditorId,
            creativeStrategistId: o.creativeStrategistId,
            angle: o.angle ?? null,
            problem: o.problem ?? null,
            verdict: o.verdict ?? null,
          };
        }
        setOwnersByAdset(map);
      } catch { /* ignore */ }
    })();
  }, [data]);

  const executeAction = async (adsetId: string, action: string, adset: ClassifiedAdset, graveyardOutcome?: "spend_winner" | "loser") => {
    setActing(adsetId);
    try {
      const res = await fetch("/api/evolve/adset-classify/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adsetId,
          action,
          classification: adset.classification,
          metrics: { spend: adset.spend, roas: adset.roas, cpa: adset.cpa, purchases: adset.purchases },
          campaignId: adset.campaignId,
          adsetName: adset.name,
          dateRange: data?.dateRange,
          graveyardOutcome,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      toast.success(result.action || "Klart!");
      // Optimistic update: remove paused/moved adset from local state instead of re-fetching
      if (action === "pause" || action === "move_zombie") {
        setData((prev) => prev ? {
          ...prev,
          adsets: prev.adsets.filter((a) => a.id !== adsetId),
          summary: {
            ...prev.summary,
            totalAdsets: prev.summary.totalAdsets - 1,
            classificationCounts: {
              ...prev.summary.classificationCounts,
              [adset.classification]: Math.max(0, (prev.summary.classificationCounts[adset.classification] || 0) - 1),
            },
          },
        } : prev);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setActing(null);
    }
  };

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Save a set-level tag or the manual verdict (partial update, optimistic).
  const saveAdsetMeta = async (adset: ClassifiedAdset, patch: Partial<Pick<AdsetMeta, "angle" | "problem" | "verdict">>) => {
    const prev = ownersByAdset[adset.id] || EMPTY_META;
    setOwnersByAdset((m) => ({ ...m, [adset.id]: { ...prev, ...patch } }));
    try {
      const res = await fetch("/api/adset-owner", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adsetId: adset.id, adsetName: adset.name, campaignId: adset.campaignId, ...patch }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Kunde inte spara");
      }
    } catch (err) {
      setOwnersByAdset((m) => ({ ...m, [adset.id]: prev }));
      toast.error(err instanceof Error ? err.message : "Kunde inte spara");
    }
  };

  const isUntagged = (id: string) => !ownersByAdset[id]?.angle && !ownersByAdset[id]?.problem;

  const filteredAdsets = data?.adsets.filter((a) =>
    (!campaignFilter || a.campaignId === campaignFilter) &&
    (!classFilter || a.classification === classFilter) &&
    (!tagFilter || (tagFilter === "confirmed" ? ownersByAdset[a.id]?.verdict === "confirmed_winner" : isUntagged(a.id)))
  ) || [];

  const confirmedCount = data?.adsets.filter((a) => ownersByAdset[a.id]?.verdict === "confirmed_winner").length || 0;
  const untaggedCount = data?.adsets.filter((a) => isUntagged(a.id)).length || 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <BarChart3 className="h-6 w-6 text-cyan-400" />
            Ad Set Analyzer
          </h1>
          {data && (
            <p className="text-sm text-slate-500 mt-0.5">
              Target: {data.settings.targetRoas}x &middot; Breakeven: {data.settings.breakevenRoas}x &middot; CPA: {data.settings.targetCpa} SEK
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {accounts.length > 0 && (
            <select
              value={account}
              onChange={(e) => chooseAccount(e.target.value)}
              aria-label="Annonskonto"
              title="Annonskonto som analyseras"
              className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-300 [color-scheme:dark]"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>
              ))}
            </select>
          )}
          {data && data.campaigns.length > 0 && (
            <select
              value={campaignFilter}
              onChange={(e) => setCampaignFilter(e.target.value)}
              className="rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 text-xs text-white [color-scheme:dark]"
            >
              <option value="">Alla kampanjer</option>
              {data.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <div className="flex rounded-lg border border-white/10 overflow-hidden">
            <button onClick={() => setDateMode("today")}
              className={cn("px-3 py-1.5 text-xs font-medium transition-all", dateMode === "today" ? "bg-cyan-500/20 text-cyan-400" : "text-slate-400 hover:text-slate-200 hover:bg-white/5")}>
              Idag
            </button>
            {[3, 7, 14, 30].map((d) => (
              <button key={d} onClick={() => { setDateMode("preset"); setPresetDays(d); }}
                className={cn("px-3 py-1.5 text-xs font-medium transition-all", dateMode === "preset" && presetDays === d ? "bg-cyan-500/20 text-cyan-400" : "text-slate-400 hover:text-slate-200 hover:bg-white/5")}>
                {d}d
              </button>
            ))}
            <button onClick={() => setDateMode("custom")}
              className={cn("px-3 py-1.5 text-xs font-medium transition-all", dateMode === "custom" ? "bg-cyan-500/20 text-cyan-400" : "text-slate-400 hover:text-slate-200 hover:bg-white/5")}>
              <Calendar className="h-3.5 w-3.5" />
            </button>
          </div>
          <button onClick={() => setAutoAssignOpen(true)}
            title="Läs editor, videotyp, problem och landingpage ur ad set-namnen"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs font-medium text-slate-300 hover:bg-white/10 hover:text-white transition-all">
            <Wand2 className="h-3.5 w-3.5" />
            Auto-koppla
          </button>
          <button onClick={fetchData} disabled={loading}
            className="flex items-center px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-300 hover:bg-white/10 transition-all disabled:opacity-50">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      <AdsetAutoAssignDialog
        open={autoAssignOpen}
        onClose={() => setAutoAssignOpen(false)}
        account={account}
        onApplied={fetchData}
      />

      {dateMode === "custom" && (
        <div className="flex items-center gap-3 rounded-xl border border-white/5 bg-[#111827] p-3">
          <Calendar className="h-4 w-4 text-slate-500" />
          <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
            className="rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 text-sm text-white [color-scheme:dark]" />
          <span className="text-slate-500 text-sm">till</span>
          <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
            className="rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 text-sm text-white [color-scheme:dark]" />
          <button onClick={fetchData}
            className="px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-xs font-medium text-cyan-400 hover:bg-cyan-500/20 transition-all">
            Visa
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-cyan-500 border-t-transparent" />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-white/5 bg-[#111827] py-12 text-center">
          <AlertTriangle className="h-12 w-12 text-amber-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-white mb-2">Kunde inte ladda data</h3>
          <p className="text-slate-500 mb-4">{error}</p>
          <button onClick={fetchData} className="px-4 py-2 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 transition-all">
            Försök igen
          </button>
        </div>
      ) : data ? (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard label="Ad Sets" value={String(data.summary.totalAdsets)} />
            <KpiCard label="Spend" value={`${data.summary.totalSpend.toFixed(0)} SEK`} />
            <KpiCard label="ROAS" value={`${data.summary.overallRoas.toFixed(2)}x`}
              color={data.summary.overallRoas >= data.settings.targetRoas ? "text-emerald-400" : data.summary.overallRoas >= data.settings.breakevenRoas ? "text-amber-400" : "text-red-400"} />
            <KpiCard label="Purchases" value={String(data.summary.totalPurchases)} />
          </div>

          {/* Filter tabs */}
          <div className="flex flex-wrap gap-2">
            <FilterTab active={!classFilter} onClick={() => setClassFilter(null)}
              label={`Alla (${data.summary.totalAdsets})`} />
            {(["breakthrough", "spend_winner", "kpi_winner", "loser", "new"] as const).map((cls) => {
              const c = CLASS_CONFIG[cls];
              const count = data.summary.classificationCounts[cls] || 0;
              if (count === 0) return null;
              return (
                <FilterTab key={cls} active={classFilter === cls}
                  onClick={() => setClassFilter(classFilter === cls ? null : cls)}
                  label={`${c.label} (${count})`}
                  activeColor={c.color} activeBg={c.bg} activeBorder={c.border} />
              );
            })}
            <div className="w-px bg-white/10 mx-1 self-stretch" />
            <FilterTab active={tagFilter === "confirmed"}
              onClick={() => setTagFilter(tagFilter === "confirmed" ? null : "confirmed")}
              label={`✓ Confirmed (${confirmedCount})`}
              activeColor="text-emerald-400" activeBg="bg-emerald-500/10" activeBorder="border-emerald-500/20" />
            {untaggedCount > 0 && (
              <FilterTab active={tagFilter === "untagged"}
                onClick={() => setTagFilter(tagFilter === "untagged" ? null : "untagged")}
                label={`Otaggad (${untaggedCount})`}
                activeColor="text-amber-400" activeBg="bg-amber-500/10" activeBorder="border-amber-500/20" />
            )}
          </div>

          {/* Ad Set Cards */}
          <div className="space-y-3">
            {filteredAdsets.map((adset) => {
              const config = CLASS_CONFIG[adset.classification];
              const isExpanded = expanded.has(adset.id);
              const isActing = acting === adset.id;
              const meta = ownersByAdset[adset.id] || EMPTY_META;
              const isConfirmed = meta.verdict === "confirmed_winner";

              return (
                <div key={adset.id} className={cn("rounded-xl border bg-[#111827] overflow-hidden transition-all", config.border)}>
                  {/* Main ad set row */}
                  <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/[0.02] transition-colors"
                    onClick={() => toggle(adset.id)}>

                    {/* Expand arrow */}
                    <div className="shrink-0 text-slate-500">
                      {isExpanded
                        ? <ChevronDown className="h-4 w-4" />
                        : <ChevronRight className="h-4 w-4" />}
                    </div>

                    {/* Classification badge */}
                    <div className={cn("shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-bold border", config.bg, config.color, config.border)}>
                      {config.label}
                    </div>

                    {/* Manual verdict badge */}
                    {isConfirmed && (
                      <div className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        <Trophy className="h-3 w-3" /> Winner
                      </div>
                    )}

                    {/* Name + campaign + tags */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{adset.name}</p>
                      <p className="text-[10px] text-slate-600 truncate">
                        {adset.campaignName} &middot; {adset.adCount} ads
                        {meta.angle || meta.problem ? (
                          <span className="text-cyan-500/80"> &middot; <Tag className="inline h-2.5 w-2.5 -mt-px" /> {[meta.angle, meta.problem].filter(Boolean).join(" / ")}</span>
                        ) : (
                          <span className="text-amber-500/80"> &middot; otaggad — expandera för att tagga</span>
                        )}
                      </p>
                    </div>

                    {/* Metrics */}
                    <div className="hidden sm:flex items-center gap-5 shrink-0">
                      <Metric label="Spend" value={`${adset.spend.toFixed(0)}`} />
                      <Metric label="ROAS" value={`${adset.roas.toFixed(2)}x`}
                        color={adset.roas >= data.settings.targetRoas ? "text-emerald-400" : adset.roas >= data.settings.breakevenRoas ? "text-amber-400" : adset.spend > 0 ? "text-red-400" : "text-slate-500"} />
                      <Metric label="ncROAS" value={adset.ncRoas != null ? `${adset.ncRoas.toFixed(2)}x` : "—"}
                        color={adset.ncRoas != null && adset.ncRoas >= data.settings.targetRoas ? "text-emerald-400" : adset.ncRoas != null && adset.ncRoas >= data.settings.breakevenRoas ? "text-amber-400" : adset.ncRoas != null ? "text-red-400" : "text-slate-600"} />
                      <Metric label="CPA" value={adset.cpa > 0 ? adset.cpa.toFixed(0) : "-"}
                        color={adset.cpa > 0 && adset.cpa <= data.settings.targetCpa ? "text-emerald-400" : adset.cpa > 0 ? "text-red-400" : "text-slate-500"} />
                      <Metric label="Purchases" value={String(adset.purchases)} />
                      <Metric label="Freq" value={adset.frequency.toFixed(1)} />
                    </div>

                    {/* 3x CPA progress */}
                    <div className="hidden lg:flex flex-col items-center gap-0.5 shrink-0 w-20">
                      <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div className={cn("h-full rounded-full",
                          adset.spendProgress >= 1 ? "bg-cyan-400" : adset.spendProgress >= 0.5 ? "bg-amber-400" : "bg-slate-600"
                        )} style={{ width: `${Math.min(adset.spendProgress * 100, 100)}%` }} />
                      </div>
                      <span className="text-[9px] text-slate-600">{adset.spend.toFixed(0)}/{adset.spendThreshold.toFixed(0)} SEK</span>
                    </div>

                    {/* Owner (ad-set level) */}
                    <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                      <AdsetOwnerPicker
                        adsetId={adset.id}
                        adsetName={adset.name}
                        campaignId={adset.campaignId}
                        members={members}
                        videoEditorId={ownersByAdset[adset.id]?.videoEditorId || null}
                        creativeStrategistId={ownersByAdset[adset.id]?.creativeStrategistId || null}
                        onSaved={(ve, cs) => setOwnersByAdset((prev) => ({ ...prev, [adset.id]: { ...(prev[adset.id] || EMPTY_META), videoEditorId: ve, creativeStrategistId: cs } }))}
                      />
                    </div>

                    {/* Action buttons — always visible */}
                    <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      {isActing ? (
                        <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
                      ) : (
                        <>
                          <button
                            onClick={() => saveAdsetMeta(adset, { verdict: isConfirmed ? null : "confirmed_winner" })}
                            className={cn(
                              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-all",
                              isConfirmed
                                ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                                : "bg-white/5 text-slate-400 border-white/10 hover:bg-emerald-500/10 hover:text-emerald-400 hover:border-emerald-500/20"
                            )}
                            title={isConfirmed ? "Ta bort manuell winner-markering" : "Manually confirm this ad set is performing well (independent of the auto-classification)"}
                          >
                            <Trophy className="h-3.5 w-3.5" />
                            {isConfirmed ? "Winner ✓" : "Winner?"}
                          </button>
                          {(
                            graveyardChoiceFor === adset.id ? (
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] text-slate-500 mr-0.5">Graveyard as:</span>
                                <button
                                  onClick={() => { executeAction(adset.id, "move_zombie", adset, "spend_winner"); setGraveyardChoiceFor(null); }}
                                  className="px-2 py-1.5 rounded-lg text-[11px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-all"
                                  title="Profitable but under target — counts as Spend Winner for the editor"
                                >
                                  Spend Winner
                                </button>
                                <button
                                  onClick={() => { executeAction(adset.id, "move_zombie", adset, "loser"); setGraveyardChoiceFor(null); }}
                                  className="px-2 py-1.5 rounded-lg text-[11px] font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-all"
                                  title="Below breakeven — counts as Loser for the editor"
                                >
                                  Loser
                                </button>
                                <button
                                  onClick={() => setGraveyardChoiceFor(null)}
                                  className="px-1.5 py-1.5 rounded-lg text-[11px] text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-all"
                                  title="Cancel"
                                >
                                  ✕
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setGraveyardChoiceFor(adset.id)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-all"
                                title="Move all ads to Graveyard — you'll choose Spend Winner or Loser"
                              >
                                <Skull className="h-3.5 w-3.5" />
                                Graveyard
                              </button>
                            )
                          )}
                          {adset.classification === "loser" && adset.status === "ACTIVE" && (
                            <button
                              onClick={() => executeAction(adset.id, "pause", adset)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-all"
                              title="Pausa hela ad set"
                            >
                              <Pause className="h-3.5 w-3.5" />
                              Pausa
                            </button>
                          )}
                          {(adset.classification === "breakthrough" || adset.classification === "kpi_winner" || adset.classification === "new") && (
                            <button
                              onClick={() => executeAction(adset.id, "let_run", adset)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10 transition-all"
                            >
                              <Check className="h-3.5 w-3.5" />
                              OK
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Recommendation bar */}
                  <div className={cn("px-4 py-2 text-xs border-t", config.bg, config.border, config.color)}>
                    {adset.recommendation}
                  </div>

                  {/* Expanded: set-level creative tags (inherited by every ad in the set) */}
                  {isExpanded && (
                    <div className="border-t border-white/5 px-4 py-3 flex items-center gap-3 flex-wrap bg-white/[0.01]">
                      <span className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                        <Tag className="h-3 w-3" /> Taggar
                      </span>
                      <select
                        value={meta.angle || ""}
                        onChange={(e) => saveAdsetMeta(adset, { angle: e.target.value || null })}
                        className={cn("rounded-lg border px-2.5 py-1.5 text-xs [color-scheme:dark]",
                          meta.angle ? "bg-white/5 border-white/10 text-white" : "bg-amber-500/5 border-amber-500/20 text-amber-400")}
                      >
                        <option value="">Angle…</option>
                        {angleOptions.map((a) => <option key={a} value={a}>{a}</option>)}
                      </select>
                      <select
                        value={meta.problem || ""}
                        onChange={(e) => saveAdsetMeta(adset, { problem: e.target.value || null })}
                        className={cn("rounded-lg border px-2.5 py-1.5 text-xs [color-scheme:dark]",
                          meta.problem ? "bg-white/5 border-white/10 text-white" : "bg-amber-500/5 border-amber-500/20 text-amber-400")}
                      >
                        <option value="">Problem…</option>
                        {problemOptions.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                      <span className="text-[10px] text-slate-600">ärvs av alla ads i settet · per-ad-taggar från uppladdningen vinner</span>
                    </div>
                  )}

                  {/* Expanded: creatives inside this ad set */}
                  {isExpanded && adset.ads.length > 0 && (
                    <div className="border-t border-white/5">
                      <div className="px-4 py-2 bg-white/[0.02]">
                        <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider mb-1">Creatives i detta ad set</p>
                      </div>
                      {adset.ads.map((ad) => (
                        <div key={ad.id} className="flex items-center gap-3 px-4 py-2.5 border-t border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                          {/* Status dot */}
                          <div className={cn("w-2 h-2 rounded-full shrink-0",
                            ad.status === "ACTIVE" ? "bg-emerald-400" : "bg-slate-600"
                          )} />
                          {/* Name */}
                          <p className="flex-1 text-xs text-slate-400 truncate min-w-0">{ad.name}</p>
                          {/* Mini metrics */}
                          <div className="flex items-center gap-4 shrink-0 text-xs">
                            <span className="text-slate-500">{ad.spend.toFixed(0)} SEK</span>
                            <span className={cn("font-medium",
                              ad.roas >= (data?.settings.targetRoas || 0) ? "text-emerald-400" :
                              ad.roas >= (data?.settings.breakevenRoas || 0) ? "text-amber-400" :
                              ad.spend > 0 ? "text-red-400" : "text-slate-600"
                            )}>
                              {ad.roas.toFixed(2)}x
                            </span>
                            <span className="text-slate-500">{ad.purchases} köp</span>
                          </div>
                        </div>
                      ))}
                      {adset.ads.length === 0 && (
                        <div className="px-4 py-4 text-xs text-slate-600 text-center">Inga ads i detta ad set</div>
                      )}
                    </div>
                  )}

                  {isExpanded && adset.ads.length === 0 && (
                    <div className="border-t border-white/5 px-4 py-4 text-xs text-slate-600 text-center">
                      Inga ads hittade i detta ad set
                    </div>
                  )}
                </div>
              );
            })}

            {filteredAdsets.length === 0 && (
              <div className="rounded-xl border border-white/5 bg-[#111827] py-12 text-center text-slate-500">
                {data.adsets.length === 0
                  ? "No ad sets found. Make sure you have active campaigns."
                  : "No ad sets in this category."}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

function KpiCard({ label, value, color = "text-white" }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-[#111827] px-4 py-3">
      <div className="text-[10px] text-slate-600 uppercase tracking-wider">{label}</div>
      <div className={cn("text-xl font-bold mt-0.5", color)}>{value}</div>
    </div>
  );
}

function Metric({ label, value, color = "text-slate-300" }: { label: string; value: string; color?: string }) {
  return (
    <div className="text-right">
      <div className="text-[9px] text-slate-600 uppercase">{label}</div>
      <div className={cn("text-sm font-medium", color)}>{value}</div>
    </div>
  );
}

function FilterTab({ active, onClick, label, activeColor, activeBg, activeBorder }: {
  active: boolean; onClick: () => void; label: string;
  activeColor?: string; activeBg?: string; activeBorder?: string;
}) {
  return (
    <button onClick={onClick}
      className={cn(
        "px-3.5 py-2 rounded-xl border text-xs font-medium transition-all",
        active
          ? cn(activeBg || "bg-cyan-500/10", activeColor || "text-cyan-400", activeBorder || "border-cyan-500/20")
          : "bg-white/5 text-slate-400 border-white/10 hover:bg-white/10"
      )}>
      {label}
    </button>
  );
}
