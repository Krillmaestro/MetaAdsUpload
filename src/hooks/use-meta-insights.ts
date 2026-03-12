"use client";

import { useState, useEffect, useCallback } from "react";

interface InsightSummary {
  spend: number;
  impressions: number;
  reach: number;
  linkClicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  purchases: number;
  purchaseValue: number;
  roas: number;
}

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  objective: string;
  dailyBudget: number;
  spend: number;
  impressions: number;
  linkClicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  purchases: number;
  roas: number;
  hookRate: number;
  holdRate: number;
}

export function useMetaInsights(dateRange?: { from: string; to: string }) {
  const [summary, setSummary] = useState<InsightSummary | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (dateRange?.from) params.set("from", dateRange.from);
      if (dateRange?.to) params.set("to", dateRange.to);

      const res = await fetch(`/api/meta/insights?${params}`);
      if (!res.ok) throw new Error("Failed to fetch insights");
      const data = await res.json();
      setSummary(data.summary);
      setCampaigns(data.campaigns);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [dateRange?.from, dateRange?.to]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { summary, campaigns, loading, error, refresh: fetchData };
}
