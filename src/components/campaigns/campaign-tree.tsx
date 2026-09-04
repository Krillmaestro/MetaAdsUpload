"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ChevronDown, ChevronRight, ChevronUp, RefreshCw, Copy, Loader2, Search, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { format, subDays } from "date-fns";

interface Campaign {
  id: string;
  name: string;
  status: string;
  objective?: string;
  daily_budget?: string;
  lifetime_budget?: string;
}

interface AdSet {
  id: string;
  campaign_id: string;
  name: string;
  status: string;
  daily_budget?: string;
  lifetime_budget?: string;
}

interface Metrics {
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  purchaseValue: number;
  roas: number;
  ctr: number;
  cpc: number;
  cpm: number;
  cpa: number;
  hookRate: number;
}

const EMPTY_METRICS: Metrics = {
  spend: 0, impressions: 0, clicks: 0, purchases: 0, purchaseValue: 0,
  roas: 0, ctr: 0, cpc: 0, cpm: 0, cpa: 0, hookRate: 0,
};

type DatePreset = "today" | "3" | "7" | "14" | "30";

type SortKey = "status" | "name" | "spend" | "purchases" | "cpa" | "roas" | "ctr" | "cpc" | "cpm" | "hookRate";
type SortDir = "asc" | "desc";

const STATUS_ORDER: Record<string, number> = { ACTIVE: 0, PAUSED: 1, ARCHIVED: 2, DELETED: 3 };

function getStatusOrder(status: string) {
  return STATUS_ORDER[status] ?? 99;
}

function sortItems<T extends { status: string }>(
  items: T[],
  getMetrics: (item: T) => Metrics,
  sortKey: SortKey,
  sortDir: SortDir,
): T[] {
  return [...items].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    if (sortKey === "status") {
      const diff = getStatusOrder(a.status) - getStatusOrder(b.status);
      return diff !== 0 ? diff * dir : a.status.localeCompare(b.status) * dir;
    }
    if (sortKey === "name") {
      return ((a as unknown as { name: string }).name || "").localeCompare(
        (b as unknown as { name: string }).name || ""
      ) * dir;
    }
    const ma = getMetrics(a);
    const mb = getMetrics(b);
    return (ma[sortKey] - mb[sortKey]) * dir;
  });
}

export function CampaignTree() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [adsets, setAdsets] = useState<Record<string, AdSet[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [editBudget, setEditBudget] = useState<{ id: string; type: "campaign" | "adset"; value: string } | null>(null);

  // Date range
  const [datePreset, setDatePreset] = useState<DatePreset>("7");

  // Sorting — default: status ascending (ACTIVE first)
  const [campaignSort, setCampaignSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "status", dir: "asc" });
  const [adsetSort, setAdsetSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "status", dir: "asc" });

  // Metrics
  const [campaignMetrics, setCampaignMetrics] = useState<Map<string, Metrics>>(new Map());
  const [adsetMetrics, setAdsetMetrics] = useState<Map<string, Metrics>>(new Map());

  // Duplicate state
  const [showDuplicate, setShowDuplicate] = useState(false);
  const [duplicateSource, setDuplicateSource] = useState<AdSet | null>(null);
  const [duplicateTarget, setDuplicateTarget] = useState("");
  const [duplicateName, setDuplicateName] = useState("");
  const [duplicating, setDuplicating] = useState(false);

  // Cache: insights keyed by "since_until", adset insights keyed by "campaignId_since_until"
  const insightsCache = useRef<Map<string, Map<string, Metrics>>>(new Map());
  const adsetInsightsCache = useRef<Map<string, Map<string, Metrics>>>(new Map());

  const getDateRange = useCallback(() => {
    const days = datePreset === "today" ? 0 : parseInt(datePreset);
    const since = format(days === 0 ? new Date() : subDays(new Date(), days), "yyyy-MM-dd");
    const until = format(new Date(), "yyyy-MM-dd");
    return { since, until };
  }, [datePreset]);

  const dateKey = useMemo(() => {
    const { since, until } = getDateRange();
    return `${since}_${until}`;
  }, [getDateRange]);

  const parseInsightsResponse = (insightsData: Record<string, unknown>): Map<string, Metrics> => {
    const metricsMap = new Map<string, Metrics>();
    for (const c of ((insightsData.campaigns || []) as Array<Record<string, number | string>>)) {
      metricsMap.set(c.id as string, {
        spend: (c.spend as number) || 0,
        impressions: (c.impressions as number) || 0,
        clicks: (c.linkClicks as number) || 0,
        purchases: (c.purchases as number) || 0,
        purchaseValue: (c.purchaseValue as number) || ((c.roas as number) && (c.spend as number) ? (c.roas as number) * (c.spend as number) : 0),
        roas: (c.roas as number) || 0,
        ctr: (c.ctr as number) || 0,
        cpc: (c.cpc as number) || 0,
        cpm: (c.cpm as number) || 0,
        cpa: (c.cpa as number) || ((c.purchases as number) > 0 ? (c.spend as number) / (c.purchases as number) : 0),
        hookRate: (c.hookRate as number) || 0,
      });
    }
    return metricsMap;
  };

  const fetchInsights = useCallback(async (force: boolean) => {
    const { since, until } = getDateRange();
    const key = `${since}_${until}`;

    // Use cache if available and not forcing refresh
    if (!force && insightsCache.current.has(key)) {
      setCampaignMetrics(insightsCache.current.get(key)!);
      return;
    }

    const insightsRes = await fetch(`/api/meta/insights?from=${since}&to=${until}`);
    if (!insightsRes.ok) {
      const errData = await insightsRes.json().catch(() => ({}));
      const errMsg = (errData as { error?: string }).error || `Insights API returned ${insightsRes.status}`;
      console.error("Insights fetch failed:", errMsg);
      setInsightsError(errMsg);
      return;
    }
    const insightsData = await insightsRes.json();
    const metricsMap = parseInsightsResponse(insightsData);
    insightsCache.current.set(key, metricsMap);
    setCampaignMetrics(metricsMap);
  }, [getDateRange]);

  const fetchAll = useCallback(async (force: boolean) => {
    setLoading(true);
    setInsightsError(null);
    try {
      const res = await fetch("/api/meta/campaigns");
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `Campaigns API returned ${res.status}`);
      }
      const data = await res.json();
      const rawCampaigns: Campaign[] = data.data || [];
      setCampaigns(rawCampaigns);
      await fetchInsights(force);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to fetch campaigns");
    } finally {
      setLoading(false);
    }
  }, [fetchInsights]);

  // Initial load
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      fetchAll(true);
    }
  }, [fetchAll]);

  // When date range changes, use cache or fetch
  useEffect(() => {
    if (!didMount.current) return;
    fetchInsights(false);
  }, [dateKey, fetchInsights]);

  const handleRefresh = useCallback(() => {
    // Clear all caches and re-fetch everything
    insightsCache.current.clear();
    adsetInsightsCache.current.clear();
    setAdsets({});
    setAdsetMetrics(new Map());
    fetchAll(true);
  }, [fetchAll]);

  const fetchAdsetInsights = async (campaignId: string, adsetList: AdSet[], force: boolean = false) => {
    try {
      const { since, until } = getDateRange();
      const cacheKey = `${since}_${until}`;

      // Check cache first
      if (!force && adsetInsightsCache.current.has(cacheKey)) {
        const cached = adsetInsightsCache.current.get(cacheKey)!;
        const metricsMap = new Map(adsetMetrics);
        for (const as of adsetList) {
          if (cached.has(as.id)) metricsMap.set(as.id, cached.get(as.id)!);
        }
        setAdsetMetrics(metricsMap);
        return;
      }

      const res = await fetch(`/api/meta/adsets/insights?since=${since}&until=${until}`);
      if (!res.ok) return;
      const data = await res.json();

      // Build full cache for this date range
      const fullCache = new Map<string, Metrics>();
      const metricsMap = new Map(adsetMetrics);
      for (const a of (data.adsets || [])) {
        const m: Metrics = {
          spend: a.spend || 0,
          impressions: a.impressions || 0,
          clicks: a.clicks || 0,
          purchases: a.purchases || 0,
          purchaseValue: a.purchaseValue || 0,
          roas: a.roas || 0,
          ctr: a.ctr || 0,
          cpc: a.cpc || 0,
          cpm: a.cpm || 0,
          cpa: a.cpa || 0,
          hookRate: 0,
        };
        fullCache.set(a.id, m);
        if (adsetList.some(as => as.id === a.id)) {
          metricsMap.set(a.id, m);
        }
      }
      adsetInsightsCache.current.set(cacheKey, fullCache);
      setAdsetMetrics(metricsMap);
    } catch {
      // Silently fail — metrics just won't show
    }
  };

  const toggleExpand = async (campaignId: string) => {
    const next = new Set(expanded);
    if (next.has(campaignId)) {
      next.delete(campaignId);
    } else {
      next.add(campaignId);
      if (!adsets[campaignId]) {
        const res = await fetch(`/api/meta/adsets?campaign_id=${campaignId}`);
        const data = await res.json();
        const adsetList: AdSet[] = data.data || [];
        setAdsets((prev) => ({ ...prev, [campaignId]: adsetList }));
        fetchAdsetInsights(campaignId, adsetList);
      }
    }
    setExpanded(next);
  };

  const toggleStatus = async (id: string, type: "campaign" | "adset", currentStatus: string) => {
    const newStatus = currentStatus === "ACTIVE" ? "PAUSED" : "ACTIVE";
    const endpoint = type === "campaign" ? "/api/meta/campaigns" : "/api/meta/adsets";
    try {
      await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: newStatus }),
      });
      toast.success(`${type === "campaign" ? "Campaign" : "Ad Set"} ${newStatus.toLowerCase()}`);
      handleRefresh();
    } catch {
      toast.error("Failed to update status");
    }
  };

  const saveBudget = async () => {
    if (!editBudget) return;
    const budgetCents = Math.round(parseFloat(editBudget.value) * 100);
    const endpoint = editBudget.type === "campaign" ? "/api/meta/campaigns" : "/api/meta/adsets";
    try {
      await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editBudget.id, daily_budget: budgetCents }),
      });
      toast.success("Budget updated");
      setEditBudget(null);
      handleRefresh();
    } catch {
      toast.error("Failed to update budget");
    }
  };

  const handleDuplicate = (adset: AdSet) => {
    setDuplicateSource(adset);
    setDuplicateName(`${adset.name} (copy)`);
    setDuplicateTarget("");
    setShowDuplicate(true);
  };

  const handleDuplicateSubmit = async () => {
    if (!duplicateSource || !duplicateTarget) return;
    setDuplicating(true);
    try {
      const res = await fetch("/api/meta/adsets/duplicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceAdsetId: duplicateSource.id,
          targetCampaignId: duplicateTarget,
          newName: duplicateName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to duplicate");
      toast.success(`Duplicated ad set with ${data.totalAds} ads`);
      setShowDuplicate(false);
      const targetRes = await fetch(`/api/meta/adsets?campaign_id=${duplicateTarget}`);
      const targetData = await targetRes.json();
      setAdsets((prev) => ({ ...prev, [duplicateTarget]: targetData.data || [] }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to duplicate");
    } finally {
      setDuplicating(false);
    }
  };

  // Sorted + filtered campaigns
  const sortedCampaigns = useMemo(() => {
    const filtered = campaigns.filter((c) =>
      c.name.toLowerCase().includes(search.toLowerCase())
    );
    return sortItems(filtered, (c) => campaignMetrics.get(c.id) || EMPTY_METRICS, campaignSort.key, campaignSort.dir);
  }, [campaigns, search, campaignSort, campaignMetrics]);

  // Sorted ad sets per campaign
  const getSortedAdsets = useCallback(
    (campaignId: string) => {
      const list = adsets[campaignId] || [];
      return sortItems(list, (as) => adsetMetrics.get(as.id) || EMPTY_METRICS, adsetSort.key, adsetSort.dir);
    },
    [adsets, adsetSort, adsetMetrics],
  );

  const formatBudget = (daily?: string, lifetime?: string) => {
    if (daily) return `${(parseFloat(daily) / 100).toFixed(0)} SEK/day`;
    if (lifetime) return `${(parseFloat(lifetime) / 100).toFixed(0)} SEK`;
    return "-";
  };

  const toggleCampaignSort = (key: SortKey) => {
    setCampaignSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "status" || key === "name" ? "asc" : "desc" }
    );
  };

  const toggleAdsetSort = (key: SortKey) => {
    setAdsetSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "status" || key === "name" ? "asc" : "desc" }
    );
  };

  const SortIcon = ({ sortKey, current }: { sortKey: SortKey; current: { key: SortKey; dir: SortDir } }) => {
    if (current.key !== sortKey) return null;
    return current.dir === "asc"
      ? <ChevronUp className="h-3 w-3 inline ml-0.5 text-cyan-400" />
      : <ChevronDown className="h-3 w-3 inline ml-0.5 text-cyan-400" />;
  };

  const MetricCell = ({ value, suffix = "", color }: { value: number; suffix?: string; color?: string }) => (
    <td className={cn("px-3 py-3 text-right text-sm tabular-nums", color || "text-slate-300")}>
      {value > 0 ? `${value.toLocaleString("sv-SE", { maximumFractionDigits: value < 10 ? 2 : 0 })}${suffix}` : "-"}
    </td>
  );

  const columns: { key: SortKey; label: string; align: string }[] = [
    { key: "name", label: "Name", align: "text-left" },
    { key: "status", label: "Status", align: "text-center" },
  ];
  const metricColumns: { key: SortKey; label: string }[] = [
    { key: "spend", label: "Spend" },
    { key: "purchases", label: "Purch." },
    { key: "cpa", label: "CPA" },
    { key: "roas", label: "ROAS" },
    { key: "ctr", label: "CTR" },
    { key: "cpc", label: "CPC" },
    { key: "cpm", label: "CPM" },
    { key: "hookRate", label: "Hook%" },
  ];

  return (
    <div className="space-y-4">
      {/* Insights error banner */}
      {insightsError && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-400">Failed to load metrics</p>
            <p className="text-xs text-slate-400 mt-1">{insightsError}</p>
            <button onClick={handleRefresh} className="text-xs text-cyan-400 hover:underline mt-2">Try again</button>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <Input
            placeholder="Search campaigns..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 bg-white/5 border-white/10 text-sm placeholder:text-slate-500"
          />
        </div>
        <div className="flex rounded-lg border border-white/10 overflow-hidden">
          {(["today", "3", "7", "14", "30"] as DatePreset[]).map((d) => (
            <button
              key={d}
              onClick={() => setDatePreset(d)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium transition-all",
                datePreset === d ? "bg-cyan-500/20 text-cyan-400" : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
              )}
            >
              {d === "today" ? "Today" : `${d}d`}
            </button>
          ))}
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-300 hover:bg-white/10 transition-all disabled:opacity-50"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      <div className="rounded-xl border border-white/5 bg-[#111827] overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5">
              <th className="w-10 px-3 py-3" />
              <th
                className="text-left text-[10px] font-medium text-slate-500 uppercase tracking-wider px-3 py-3 min-w-[200px] cursor-pointer hover:text-slate-300 transition-colors select-none"
                onClick={() => toggleCampaignSort("name")}
              >
                Name <SortIcon sortKey="name" current={campaignSort} />
              </th>
              <th
                className="text-center text-[10px] font-medium text-slate-500 uppercase tracking-wider px-3 py-3 cursor-pointer hover:text-slate-300 transition-colors select-none"
                onClick={() => toggleCampaignSort("status")}
              >
                Status <SortIcon sortKey="status" current={campaignSort} />
              </th>
              <th className="text-right text-[10px] font-medium text-slate-500 uppercase tracking-wider px-3 py-3">Budget</th>
              {metricColumns.map((col) => (
                <th
                  key={col.key}
                  className="text-right text-[10px] font-medium text-slate-500 uppercase tracking-wider px-3 py-3 cursor-pointer hover:text-slate-300 transition-colors select-none"
                  onClick={() => toggleCampaignSort(col.key)}
                >
                  {col.label} <SortIcon sortKey={col.key} current={campaignSort} />
                </th>
              ))}
              <th className="w-12 px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {sortedCampaigns.map((c) => {
              const m = campaignMetrics.get(c.id) || EMPTY_METRICS;
              const sortedAdsetList = getSortedAdsets(c.id);
              return (
                <CampaignRows
                  key={c.id}
                  campaign={c}
                  metrics={m}
                  expanded={expanded.has(c.id)}
                  adsets={sortedAdsetList}
                  adsetMetrics={adsetMetrics}
                  editBudget={editBudget}
                  adsetSort={adsetSort}
                  onToggleExpand={() => toggleExpand(c.id)}
                  onToggleStatus={toggleStatus}
                  onEditBudget={setEditBudget}
                  onSaveBudget={saveBudget}
                  onDuplicate={handleDuplicate}
                  onToggleAdsetSort={toggleAdsetSort}
                  formatBudget={formatBudget}
                  MetricCell={MetricCell}
                  SortIcon={SortIcon}
                  metricColumns={metricColumns}
                />
              );
            })}
            {campaigns.length === 0 && !loading && (
              <tr>
                <td colSpan={13} className="py-12 text-center text-slate-500">
                  No campaigns found. Connect your Meta account and create campaigns first.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Duplicate Ad Set Dialog */}
      <Dialog open={showDuplicate} onOpenChange={setShowDuplicate}>
        <DialogContent className="max-w-md bg-[#111827] border-white/10">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Copy className="h-5 w-5 text-cyan-400" />
              Duplicate Ad Set
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg bg-white/[0.02] border border-white/5 p-3">
              <p className="text-xs text-slate-500">Source Ad Set</p>
              <p className="text-sm font-medium text-white">{duplicateSource?.name}</p>
              <p className="text-xs text-slate-600 font-mono mt-1">ID: {duplicateSource?.id}</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">New Name</label>
              <Input value={duplicateName} onChange={(e) => setDuplicateName(e.target.value)} className="bg-white/5 border-white/10 placeholder:text-slate-600" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Target Campaign</label>
              <Select value={duplicateTarget} onValueChange={setDuplicateTarget}>
                <SelectTrigger className="bg-white/5 border-white/10"><SelectValue placeholder="Select target campaign..." /></SelectTrigger>
                <SelectContent className="bg-[#111827] border-white/10">
                  {campaigns.map((c) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => setShowDuplicate(false)} className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-300 hover:bg-white/10 transition-all">Cancel</button>
            <button onClick={handleDuplicateSubmit} disabled={duplicating || !duplicateTarget}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-cyan-600 text-sm font-medium text-white hover:from-cyan-400 hover:to-cyan-500 transition-all disabled:opacity-50">
              {duplicating ? <><Loader2 className="h-4 w-4 animate-spin" /> Duplicating...</> : <><Copy className="h-4 w-4" /> Duplicate</>}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Extracted campaign + adset rows to keep the main component clean
function CampaignRows({
  campaign: c,
  metrics: m,
  expanded,
  adsets,
  adsetMetrics,
  editBudget,
  adsetSort,
  onToggleExpand,
  onToggleStatus,
  onEditBudget,
  onSaveBudget,
  onDuplicate,
  onToggleAdsetSort,
  formatBudget,
  MetricCell,
  SortIcon,
  metricColumns,
}: {
  campaign: Campaign;
  metrics: Metrics;
  expanded: boolean;
  adsets: AdSet[];
  adsetMetrics: Map<string, Metrics>;
  editBudget: { id: string; type: string; value: string } | null;
  adsetSort: { key: SortKey; dir: SortDir };
  onToggleExpand: () => void;
  onToggleStatus: (id: string, type: "campaign" | "adset", status: string) => void;
  onEditBudget: (v: { id: string; type: "campaign" | "adset"; value: string } | null) => void;
  onSaveBudget: () => void;
  onDuplicate: (adset: AdSet) => void;
  onToggleAdsetSort: (key: SortKey) => void;
  formatBudget: (daily?: string, lifetime?: string) => string;
  MetricCell: React.FC<{ value: number; suffix?: string; color?: string }>;
  SortIcon: React.FC<{ sortKey: SortKey; current: { key: SortKey; dir: SortDir } }>;
  metricColumns: { key: SortKey; label: string }[];
}) {
  return (
    <>
      <tr className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
        <td className="px-3 py-3">
          <button
            onClick={onToggleExpand}
            className="p-1 rounded hover:bg-white/5 text-slate-500 hover:text-slate-300 transition-all"
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </td>
        <td className="px-3 py-3 font-medium text-white truncate max-w-[250px]" title={c.name}>{c.name}</td>
        <td className="px-3 py-3 text-center">
          <div className="flex items-center justify-center gap-2">
            <Switch checked={c.status === "ACTIVE"} onCheckedChange={() => onToggleStatus(c.id, "campaign", c.status)} />
            <span className={cn(
              "text-[10px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap",
              c.status === "ACTIVE" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-white/5 text-slate-400 border-white/10"
            )}>
              {c.status}
            </span>
          </div>
        </td>
        <td className="px-3 py-3 text-right text-sm text-slate-300">
          {editBudget?.id === c.id ? (
            <Input
              className="ml-auto w-24 h-7 text-right bg-white/5 border-white/10"
              value={editBudget.value}
              onChange={(e) => onEditBudget({ ...editBudget, type: "campaign" as const, value: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && onSaveBudget()}
              onBlur={onSaveBudget}
              autoFocus
            />
          ) : (
            <span
              className="cursor-pointer hover:text-cyan-400 transition-colors whitespace-nowrap"
              onClick={() => onEditBudget({ id: c.id, type: "campaign", value: String(parseFloat(c.daily_budget || "0") / 100) })}
            >
              {formatBudget(c.daily_budget, c.lifetime_budget)}
            </span>
          )}
        </td>
        <MetricCell value={m.spend} suffix=" SEK" />
        <td className="px-3 py-3 text-right text-sm font-medium text-slate-200">{m.purchases || "-"}</td>
        <MetricCell value={m.cpa} suffix=" SEK" />
        <td className="px-3 py-3 text-right text-sm font-semibold">
          <span className={cn(
            m.roas >= 2 ? "text-emerald-400" : m.roas >= 1.42 ? "text-amber-400" : m.roas > 0 ? "text-red-400" : "text-slate-500"
          )}>
            {m.roas > 0 ? `${m.roas.toFixed(2)}x` : "-"}
          </span>
        </td>
        <MetricCell value={m.ctr} suffix="%" />
        <MetricCell value={m.cpc} suffix=" SEK" />
        <MetricCell value={m.cpm} suffix=" SEK" />
        <MetricCell value={m.hookRate} suffix="%" />
        <td className="px-3 py-3">
          <span className="font-mono text-[10px] text-slate-600">{c.id.slice(-6)}</span>
        </td>
      </tr>
      {expanded && adsets.length > 0 && (
        <>
          {/* Adset sort header */}
          <tr className="bg-white/[0.01] border-b border-white/5">
            <td />
            <td
              className="pl-10 px-3 py-1.5 text-[9px] font-medium text-slate-600 uppercase tracking-wider cursor-pointer hover:text-slate-400 transition-colors select-none"
              onClick={() => onToggleAdsetSort("name")}
            >
              Ad Set <SortIcon sortKey="name" current={adsetSort} />
            </td>
            <td
              className="px-3 py-1.5 text-center text-[9px] font-medium text-slate-600 uppercase tracking-wider cursor-pointer hover:text-slate-400 transition-colors select-none"
              onClick={() => onToggleAdsetSort("status")}
            >
              Status <SortIcon sortKey="status" current={adsetSort} />
            </td>
            <td className="px-3 py-1.5" />
            {metricColumns.map((col) => (
              <td
                key={col.key}
                className="px-3 py-1.5 text-right text-[9px] font-medium text-slate-600 uppercase tracking-wider cursor-pointer hover:text-slate-400 transition-colors select-none"
                onClick={() => onToggleAdsetSort(col.key)}
              >
                {col.label} <SortIcon sortKey={col.key} current={adsetSort} />
              </td>
            ))}
            <td />
          </tr>
          {adsets.map((as) => {
            const am = adsetMetrics.get(as.id) || EMPTY_METRICS;
            return (
              <tr key={as.id} className="border-b border-white/5 bg-white/[0.01] hover:bg-white/[0.03] transition-colors">
                <td className="px-3 py-2.5" />
                <td className="px-3 py-2.5 pl-10 text-slate-300 truncate max-w-[230px]" title={as.name}>
                  <span className="text-slate-600 mr-1">{"\u2514"}</span>{as.name}
                </td>
                <td className="px-3 py-2.5 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <Switch checked={as.status === "ACTIVE"} onCheckedChange={() => onToggleStatus(as.id, "adset", as.status)} />
                    <span className={cn(
                      "text-[10px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap",
                      as.status === "ACTIVE" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-white/5 text-slate-400 border-white/10"
                    )}>
                      {as.status}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right text-sm">
                  {editBudget?.id === as.id ? (
                    <Input
                      className="ml-auto w-24 h-7 text-right bg-white/5 border-white/10"
                      value={editBudget.value}
                      onChange={(e) => onEditBudget({ ...editBudget, type: "adset" as const, value: e.target.value })}
                      onKeyDown={(e) => e.key === "Enter" && onSaveBudget()}
                      onBlur={onSaveBudget}
                      autoFocus
                    />
                  ) : (
                    <span
                      className="cursor-pointer text-slate-400 hover:text-cyan-400 transition-colors whitespace-nowrap"
                      onClick={() => onEditBudget({ id: as.id, type: "adset", value: String(parseFloat(as.daily_budget || "0") / 100) })}
                    >
                      {formatBudget(as.daily_budget, as.lifetime_budget)}
                    </span>
                  )}
                </td>
                <MetricCell value={am.spend} suffix=" SEK" />
                <td className="px-3 py-2.5 text-right text-sm font-medium text-slate-300">{am.purchases || "-"}</td>
                <MetricCell value={am.cpa} suffix=" SEK" />
                <td className="px-3 py-2.5 text-right text-sm font-semibold">
                  <span className={cn(
                    am.roas >= 2 ? "text-emerald-400" : am.roas >= 1.42 ? "text-amber-400" : am.roas > 0 ? "text-red-400" : "text-slate-500"
                  )}>
                    {am.roas > 0 ? `${am.roas.toFixed(2)}x` : "-"}
                  </span>
                </td>
                <MetricCell value={am.ctr} suffix="%" />
                <MetricCell value={am.cpc} suffix=" SEK" />
                <MetricCell value={am.cpm} suffix=" SEK" />
                <MetricCell value={am.hookRate} suffix="%" />
                <td className="px-3 py-2.5">
                  <button
                    onClick={() => onDuplicate(as)}
                    className="p-1.5 rounded hover:bg-cyan-500/10 text-slate-500 hover:text-cyan-400 transition-all"
                    title="Duplicate to another campaign"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            );
          })}
        </>
      )}
    </>
  );
}
