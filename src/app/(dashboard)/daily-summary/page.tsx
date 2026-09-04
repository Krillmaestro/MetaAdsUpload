"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Sun,
  RefreshCw,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowRight,
  Skull,
  Star,
  Clock,
  Activity,
  Pause,
  Eye,
  ChevronRight,
  Megaphone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

interface AdSummary {
  id: string;
  name: string;
  spend: number;
  roas: number;
  recommendation?: string;
  campaignName: string;
  spendProgress?: number;
}

interface CampaignPerformance {
  id: string;
  name: string;
  status: string;
  dailyBudget: number;
  adsetCount: number;
  maxAdSets: number;
  adsetWarning: boolean;
  yesterday: {
    spend: number;
    revenue: number;
    purchases: number;
    roas: number;
    cpa: number;
  };
  budget: {
    action: string;
    reason: string;
    current: number;
    suggested?: number;
  };
}

interface ActivityEntry {
  id: number;
  adId: string;
  adName: string;
  action: string;
  classification: string;
  spend: number | null;
  roas: number | null;
  timestamp: string;
  recommendation: string | null;
}

interface SummaryData {
  yesterday: {
    spend: number;
    revenue: number;
    purchases: number;
    roas: number;
    cpa: number;
    date: string;
    ncRoas: number | null;
    newCustomerRevenue: number | null;
    newCustomerPct: number | null;
  };
  week: {
    spend: number;
    revenue: number;
    purchases: number;
    roas: number;
  };
  campaigns: CampaignPerformance[];
  classificationCounts: Record<string, number>;
  totalActiveAds: number;
  needsAttention: {
    losers: AdSummary[];
    breakthroughs: AdSummary[];
    newAds: AdSummary[];
  };
  activityLog: ActivityEntry[];
  settings: {
    targetRoas: number;
    breakevenRoas: number;
    targetCpa: number;
  };
}

const ACTION_LABELS: Record<string, { label: string; icon: typeof Pause; color: string }> = {
  pause: { label: "Pausad", icon: Pause, color: "text-red-400" },
  move_zombie: { label: "Graveyard", icon: Skull, color: "text-amber-400" },
  let_run: { label: "Granskad", icon: Eye, color: "text-slate-400" },
};

const CLASS_COLORS: Record<string, string> = {
  breakthrough: "text-emerald-400",
  spend_winner: "text-blue-400",
  kpi_winner: "text-cyan-400",
  loser: "text-red-400",
  new: "text-slate-400",
};

const BUDGET_ACTION_CONFIG: Record<string, { bg: string; border: string; icon: typeof TrendingUp; iconColor: string; label: string }> = {
  double: { bg: "bg-emerald-500/10", border: "border-emerald-500/20", icon: TrendingUp, iconColor: "text-emerald-400", label: "DUBBLA" },
  increase_20: { bg: "bg-emerald-500/10", border: "border-emerald-500/20", icon: TrendingUp, iconColor: "text-emerald-400", label: "+20%" },
  hold: { bg: "bg-white/5", border: "border-white/10", icon: Minus, iconColor: "text-slate-400", label: "HOLD" },
  decrease_20: { bg: "bg-red-500/10", border: "border-red-500/20", icon: TrendingDown, iconColor: "text-red-400", label: "-20%" },
  no_data: { bg: "bg-white/5", border: "border-white/10", icon: Minus, iconColor: "text-slate-500", label: "—" },
};

export default function DailySummaryPage() {
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/evolve/daily-summary");
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to fetch");
      }
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-cyan-500 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-white/5 bg-[#111827] py-12 text-center">
        <AlertTriangle className="h-12 w-12 text-amber-400 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-white mb-2">Kunde inte ladda sammanfattning</h3>
        <p className="text-slate-500 mb-4">{error}</p>
        <button onClick={fetchData} className="px-4 py-2 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 transition-all">
          Försök igen
        </button>
      </div>
    );
  }

  if (!data) return null;

  const roasColor = data.yesterday.roas >= data.settings.targetRoas
    ? "text-emerald-400"
    : data.yesterday.roas >= data.settings.breakevenRoas
    ? "text-amber-400"
    : "text-red-400";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Sun className="h-6 w-6 text-amber-400" />
            Daglig Sammanfattning
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {data.yesterday.date} &middot; {data.totalActiveAds} aktiva ads &middot; Target: {data.settings.targetRoas}x ROAS
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/learning-loop"
            className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-300 hover:bg-white/10 transition-all"
          >
            Ad Analyzer <ChevronRight className="inline h-3.5 w-3.5" />
          </Link>
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-300 hover:bg-white/10 transition-all disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Yesterday's Performance */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { label: "Spend yesterday", value: `${data.yesterday.spend.toFixed(0)} SEK`, sub: `Vecka: ${data.week.spend.toFixed(0)}`, color: "text-white" },
          { label: "Revenue yesterday", value: `${data.yesterday.revenue.toFixed(0)} SEK`, sub: `Vecka: ${data.week.revenue.toFixed(0)}`, color: "text-white" },
          { label: "ROAS yesterday", value: `${data.yesterday.roas.toFixed(2)}x`, sub: `Vecka: ${data.week.roas.toFixed(2)}x`, color: roasColor },
          { label: "Purchases yesterday", value: data.yesterday.purchases.toString(), sub: `Vecka: ${data.week.purchases}`, color: "text-white" },
          { label: "CPA yesterday", value: data.yesterday.cpa > 0 ? `${data.yesterday.cpa.toFixed(0)} SEK` : "-", sub: `Target: ${data.settings.targetCpa} SEK`, color: data.yesterday.cpa > 0 && data.yesterday.cpa <= data.settings.targetCpa ? "text-emerald-400" : data.yesterday.cpa > 0 ? "text-red-400" : "text-slate-500" },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-xl border border-white/5 bg-[#111827] p-4">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider">{kpi.label}</span>
            <div className={cn("text-xl font-bold mt-1", kpi.color)}>{kpi.value}</div>
            <div className="text-[10px] text-slate-600 mt-0.5">{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* ncROAS Cards */}
      {data.yesterday.ncRoas !== null && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <div className={cn(
            "rounded-xl border p-4",
            data.yesterday.ncRoas >= data.settings.targetRoas
              ? "border-emerald-500/20 bg-emerald-500/5"
              : "border-red-500/20 bg-red-500/5"
          )}>
            <span className="text-[10px] text-slate-500 uppercase tracking-wider">ncROAS yesterday</span>
            <div className={cn(
              "text-2xl font-bold mt-1",
              data.yesterday.ncRoas >= data.settings.targetRoas ? "text-emerald-400" : "text-red-400"
            )}>
              {data.yesterday.ncRoas.toFixed(2)}x
            </div>
            <div className="text-[10px] text-slate-600 mt-0.5">New Customer ROAS (Shopify)</div>
          </div>

          <div className="rounded-xl border border-white/5 bg-[#111827] p-4">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider">Nykund-revenue igår</span>
            <div className="text-2xl font-bold mt-1 text-emerald-400">
              {(data.yesterday.newCustomerRevenue ?? 0).toLocaleString("sv-SE", { maximumFractionDigits: 0 })} SEK
            </div>
            <div className="text-[10px] text-slate-600 mt-0.5">
              Ny-kund {(data.yesterday.newCustomerPct ?? 0).toFixed(0)}% av total
            </div>
          </div>

          <div className="rounded-xl border border-white/5 bg-[#111827] p-4">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider">Blended vs ncROAS</span>
            <div className="text-xl font-bold mt-1 text-white">
              {data.yesterday.roas.toFixed(2)}x <span className="text-slate-500 text-sm">→</span>{" "}
              <span className={data.yesterday.ncRoas >= data.settings.targetRoas ? "text-emerald-400" : "text-red-400"}>
                {data.yesterday.ncRoas.toFixed(2)}x
              </span>
            </div>
            <div className="text-[10px] text-slate-600 mt-0.5">Blended → ncROAS</div>
          </div>
        </div>
      )}

      {/* Campaign-Level CBO Budget Recommendations */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-cyan-400" />
          CBO Budget per Kampanj
        </h2>
        {data.campaigns.length === 0 ? (
          <div className="rounded-xl border border-white/5 bg-[#111827] p-6 text-center text-slate-500 text-sm">
            Inga aktiva kampanjer hittades.
          </div>
        ) : (
          data.campaigns.map((camp) => {
            const config = BUDGET_ACTION_CONFIG[camp.budget.action] || BUDGET_ACTION_CONFIG.no_data;
            const BudgetIcon = config.icon;
            const campRoasColor = camp.yesterday.roas >= data.settings.targetRoas
              ? "text-emerald-400"
              : camp.yesterday.roas >= data.settings.breakevenRoas
              ? "text-amber-400"
              : camp.yesterday.spend > 0
              ? "text-red-400"
              : "text-slate-500";

            return (
              <div key={camp.id} className={cn("rounded-xl border p-4", config.bg, config.border)}>
                <div className="flex items-start gap-4">
                  {/* Action badge */}
                  <div className="flex flex-col items-center gap-1 min-w-[60px]">
                    <BudgetIcon className={cn("h-5 w-5", config.iconColor)} />
                    <span className={cn("text-[10px] font-bold", config.iconColor)}>{config.label}</span>
                  </div>

                  {/* Campaign info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-semibold text-white truncate">{camp.name}</h3>
                      {camp.adsetWarning && (
                        <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 flex-shrink-0">
                          {camp.adsetCount}/{camp.maxAdSets} ad sets
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">{camp.budget.reason}</p>

                    {/* Budget change indicator */}
                    {camp.budget.suggested && camp.budget.current > 0 && (
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-xs text-slate-400">{camp.budget.current.toFixed(0)} SEK</span>
                        <ArrowRight className="h-3 w-3 text-slate-600" />
                        <span className={cn("text-xs font-bold", config.iconColor)}>{camp.budget.suggested.toFixed(0)} SEK</span>
                      </div>
                    )}
                  </div>

                  {/* KPIs */}
                  <div className="flex gap-4 flex-shrink-0 text-right">
                    <div>
                      <div className="text-[10px] text-slate-500">ROAS</div>
                      <div className={cn("text-sm font-bold", campRoasColor)}>
                        {camp.yesterday.spend > 0 ? `${camp.yesterday.roas.toFixed(2)}x` : "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500">Spend</div>
                      <div className="text-sm text-slate-300">{camp.yesterday.spend.toFixed(0)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500">Köp</div>
                      <div className="text-sm text-slate-300">{camp.yesterday.purchases}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500">Ad Sets</div>
                      <div className={cn("text-sm", camp.adsetWarning ? "text-amber-400 font-bold" : "text-slate-300")}>
                        {camp.adsetCount}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Classification Overview */}
      <div className="rounded-xl border border-white/5 bg-[#111827] p-5">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-cyan-400" />
          Ad Klassificering (7 dagar)
        </h3>
        <div className="grid grid-cols-5 gap-3">
          {[
            { key: "breakthrough", label: "Breakthrough", color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20", desc: "Top ads! Let them run." },
            { key: "spend_winner", label: "Spend Winner", color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20", desc: "Profitable, below target → Graveyard" },
            { key: "kpi_winner", label: "KPI Winner", color: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/20", desc: "Good ROAS, needs more spend" },
            { key: "loser", label: "Loser", color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20", desc: "Below breakeven → turn off" },
            { key: "new", label: "New", color: "text-slate-400", bg: "bg-white/5", border: "border-white/10", desc: "Learning phase, wait" },
          ].map((cls) => (
            <div key={cls.key} className={cn("rounded-lg border p-3 text-center", cls.bg, cls.border)}>
              <div className={cn("text-2xl font-bold", cls.color)}>
                {data.classificationCounts[cls.key] || 0}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">{cls.label}</div>
              <div className="text-[9px] text-slate-600 mt-1">{cls.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Needs Attention */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Breakthroughs */}
        {data.needsAttention.breakthroughs.length > 0 && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
            <h3 className="text-sm font-semibold text-emerald-400 mb-3 flex items-center gap-2">
              <Star className="h-4 w-4" />
              Breakthroughs — Låt dem köra! ({data.needsAttention.breakthroughs.length})
            </h3>
            <div className="space-y-2">
              {data.needsAttention.breakthroughs.map((ad) => (
                <div key={ad.id} className="flex items-center justify-between py-1.5 border-b border-emerald-500/10 last:border-0">
                  <div>
                    <p className="text-sm text-white font-medium truncate max-w-[200px]">{ad.name}</p>
                    <p className="text-[10px] text-slate-600">{ad.campaignName}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-bold text-emerald-400">{ad.roas.toFixed(2)}x</span>
                    <p className="text-[10px] text-slate-500">{ad.spend.toFixed(0)} SEK</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Losers */}
        {data.needsAttention.losers.length > 0 && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-5">
            <h3 className="text-sm font-semibold text-red-400 mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Stäng av eller flytta till Graveyard ({data.needsAttention.losers.length})
            </h3>
            <div className="space-y-2">
              {data.needsAttention.losers.map((ad) => (
                <div key={ad.id} className="flex items-center justify-between py-1.5 border-b border-red-500/10 last:border-0">
                  <div>
                    <p className="text-sm text-white font-medium truncate max-w-[200px]">{ad.name}</p>
                    <p className="text-[10px] text-slate-600">{ad.recommendation}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-bold text-red-400">{ad.roas.toFixed(2)}x</span>
                    <p className="text-[10px] text-slate-500">{ad.spend.toFixed(0)} SEK</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* New Ads - Learning Phase */}
      {data.needsAttention.newAds.length > 0 && (
        <div className="rounded-xl border border-white/5 bg-[#111827] p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-slate-500" />
            Nya Ads — Vänta tills 3x CPA spenderats ({data.needsAttention.newAds.length})
          </h3>
          <div className="space-y-2">
            {data.needsAttention.newAds.map((ad) => (
              <div key={ad.id} className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
                <div>
                  <p className="text-sm text-white font-medium truncate max-w-[250px]">{ad.name}</p>
                  <p className="text-[10px] text-slate-600">{ad.campaignName}</p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex flex-col items-center gap-0.5">
                    <div className="w-16 h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className={cn("h-full rounded-full", (ad.spendProgress || 0) >= 1 ? "bg-cyan-400" : "bg-slate-500")}
                        style={{ width: `${Math.min((ad.spendProgress || 0) * 100, 100)}%` }}
                      />
                    </div>
                    <span className="text-[9px] text-slate-600">3x CPA</span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm text-slate-400">{ad.roas.toFixed(2)}x</span>
                    <p className="text-[10px] text-slate-500">{ad.spend.toFixed(0)} SEK</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Reference - Evolve Rules */}
      <div className="rounded-xl border border-cyan-500/10 bg-cyan-500/5 p-5">
        <h3 className="text-sm font-semibold text-cyan-400 mb-3">Evolve Snabbguide — Vad gör jag?</h3>
        <div className="grid md:grid-cols-2 gap-4 text-xs text-slate-400">
          <div>
            <p className="font-medium text-white mb-1">Ads:</p>
            <ul className="space-y-1 list-disc list-inside">
              <li>Döm ALDRIG en ad innan den spenderat <span className="text-cyan-400">3x target CPA ({data.settings.targetCpa * 3} SEK)</span></li>
              <li><span className="text-emerald-400">Breakthrough</span> = bästa ads, rör dem inte</li>
              <li><span className="text-blue-400">Spend Winner</span> = lönsam men under target → Graveyard</li>
              <li><span className="text-red-400">Loser</span> = under breakeven → stäng av eller Graveyard</li>
            </ul>
          </div>
          <div>
            <p className="font-medium text-white mb-1">CBO Budget:</p>
            <ul className="space-y-1 list-disc list-inside">
              <li>ROAS över target i <span className="text-cyan-400">2-3 dagar</span> → höj +20%</li>
              <li>ROAS 50%+ över target → kan dubbla</li>
              <li>ROAS under breakeven 2+ dagar → sänk 20%</li>
              <li>Max <span className="text-cyan-400">{data.campaigns[0]?.maxAdSets || 5} ad sets</span> per CBO-kampanj</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Activity Log */}
      <div className="rounded-xl border border-white/5 bg-[#111827] p-5">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-cyan-400" />
          Recent Actions
        </h3>
        {data.activityLog.length === 0 ? (
          <p className="text-sm text-slate-600 py-4 text-center">Inga åtgärder registrerade senaste 7 dagarna.</p>
        ) : (
          <div className="space-y-1">
            {data.activityLog.map((entry) => {
              const actionConfig = ACTION_LABELS[entry.action] || { label: entry.action, icon: Eye, color: "text-slate-400" };
              const ActionIcon = actionConfig.icon;
              return (
                <div key={entry.id} className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0">
                  <ActionIcon className={cn("h-3.5 w-3.5 flex-shrink-0", actionConfig.color)} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{entry.adName}</p>
                    <div className="flex items-center gap-2 text-[10px] text-slate-600">
                      <span className={CLASS_COLORS[entry.classification] || "text-slate-500"}>{entry.classification}</span>
                      {entry.spend != null && <span>&middot; {entry.spend.toFixed(0)} SEK</span>}
                      {entry.roas != null && <span>&middot; {entry.roas.toFixed(2)}x</span>}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className={cn("text-xs font-medium", actionConfig.color)}>{actionConfig.label}</span>
                    <p className="text-[9px] text-slate-600">
                      {new Date(entry.timestamp).toLocaleDateString("sv-SE")}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
