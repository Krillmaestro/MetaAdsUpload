"use client";

import { useState } from "react";
import { format, subDays } from "date-fns";
import { KPICards } from "@/components/dashboard/kpi-cards";
import { PerformanceTable } from "@/components/dashboard/performance-table";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { useMetaInsights } from "@/hooks/use-meta-insights";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

export default function DashboardPage() {
  const [dateRange, setDateRange] = useState({
    from: subDays(new Date(), 7),
    to: new Date(),
  });

  const { summary, campaigns, loading, refresh } = useMetaInsights({
    from: format(dateRange.from, "yyyy-MM-dd"),
    to: format(dateRange.to, "yyyy-MM-dd"),
  });

  const handleToggleStatus = async (id: string, newStatus: string) => {
    await fetch("/api/meta/campaigns", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: newStatus }),
    });
    refresh();
  };

  const handleUpdateBudget = async (id: string, budget: number) => {
    await fetch("/api/meta/campaigns", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, daily_budget: Math.round(budget * 100) }),
    });
    refresh();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <DateRangePicker
          from={dateRange.from}
          to={dateRange.to}
          onChange={setDateRange}
        />
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <KPICards summary={summary} loading={loading} />
      <PerformanceTable
        campaigns={campaigns}
        loading={loading}
        onToggleStatus={handleToggleStatus}
        onUpdateBudget={handleUpdateBudget}
      />
    </div>
  );
}
