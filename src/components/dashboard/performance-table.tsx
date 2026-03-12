"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronRight } from "lucide-react";

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

interface PerformanceTableProps {
  campaigns: CampaignRow[];
  loading: boolean;
  onToggleStatus?: (id: string, newStatus: string) => void;
  onUpdateBudget?: (id: string, budget: number) => void;
}

export function PerformanceTable({ campaigns, loading, onToggleStatus, onUpdateBudget }: PerformanceTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [editingBudget, setEditingBudget] = useState<string | null>(null);
  const [budgetValue, setBudgetValue] = useState("");
  const [search, setSearch] = useState("");

  const filtered = campaigns.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  const toggleExpand = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBudgetSave = (id: string) => {
    const val = parseFloat(budgetValue);
    if (!isNaN(val) && onUpdateBudget) {
      onUpdateBudget(id, val);
    }
    setEditingBudget(null);
  };

  if (loading) {
    return <div className="py-8 text-center text-muted-foreground">Loading campaigns...</div>;
  }

  return (
    <div className="space-y-4">
      <Input
        placeholder="Search campaigns..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Campaign</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Budget</TableHead>
              <TableHead className="text-right">Spend</TableHead>
              <TableHead className="text-right">Impr.</TableHead>
              <TableHead className="text-right">Clicks</TableHead>
              <TableHead className="text-right">CTR</TableHead>
              <TableHead className="text-right">CPC</TableHead>
              <TableHead className="text-right">CPM</TableHead>
              <TableHead className="text-right">Purch.</TableHead>
              <TableHead className="text-right">ROAS</TableHead>
              <TableHead className="text-right">Hook%</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={13} className="text-center text-muted-foreground py-8">
                  No campaigns found
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => toggleExpand(c.id)}>
                      {expandedRows.has(c.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </Button>
                  </TableCell>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={c.status === "ACTIVE"}
                        onCheckedChange={(checked) =>
                          onToggleStatus?.(c.id, checked ? "ACTIVE" : "PAUSED")
                        }
                      />
                      <Badge variant={c.status === "ACTIVE" ? "default" : "secondary"}>
                        {c.status}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {editingBudget === c.id ? (
                      <div className="flex items-center gap-1 justify-end">
                        <Input
                          className="w-24 h-7 text-right"
                          value={budgetValue}
                          onChange={(e) => setBudgetValue(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleBudgetSave(c.id)}
                          onBlur={() => handleBudgetSave(c.id)}
                          autoFocus
                        />
                      </div>
                    ) : (
                      <span
                        className="cursor-pointer hover:underline"
                        onClick={() => {
                          setEditingBudget(c.id);
                          setBudgetValue(String(c.dailyBudget || 0));
                        }}
                      >
                        {c.dailyBudget ? `${c.dailyBudget.toLocaleString()} SEK` : "-"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{c.spend.toLocaleString("sv-SE", { maximumFractionDigits: 0 })} SEK</TableCell>
                  <TableCell className="text-right">{c.impressions.toLocaleString("sv-SE")}</TableCell>
                  <TableCell className="text-right">{c.linkClicks.toLocaleString("sv-SE")}</TableCell>
                  <TableCell className="text-right">{c.ctr.toFixed(2)}%</TableCell>
                  <TableCell className="text-right">{c.cpc.toFixed(2)}</TableCell>
                  <TableCell className="text-right">{c.cpm.toFixed(2)}</TableCell>
                  <TableCell className="text-right">{c.purchases}</TableCell>
                  <TableCell className="text-right font-medium">
                    <span className={c.roas >= 2 ? "text-green-500" : c.roas >= 1 ? "text-yellow-500" : "text-red-500"}>
                      {c.roas.toFixed(2)}x
                    </span>
                  </TableCell>
                  <TableCell className="text-right">{c.hookRate.toFixed(1)}%</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
