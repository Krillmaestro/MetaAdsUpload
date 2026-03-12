"use client";

import { useState, useEffect } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface Campaign {
  id: string;
  name: string;
  status: string;
  objective?: string;
  daily_budget?: string;
}

interface AdSet {
  id: string;
  campaign_id: string;
  name: string;
  status: string;
  daily_budget?: string;
}

export function CampaignTree() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [adsets, setAdsets] = useState<Record<string, AdSet[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [editBudget, setEditBudget] = useState<{ id: string; type: "campaign" | "adset"; value: string } | null>(null);

  const fetchCampaigns = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/meta/campaigns");
      const data = await res.json();
      setCampaigns(data.data || []);
    } catch {
      toast.error("Failed to fetch campaigns");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCampaigns(); }, []);

  const toggleExpand = async (campaignId: string) => {
    const next = new Set(expanded);
    if (next.has(campaignId)) {
      next.delete(campaignId);
    } else {
      next.add(campaignId);
      if (!adsets[campaignId]) {
        const res = await fetch(`/api/meta/adsets?campaign_id=${campaignId}`);
        const data = await res.json();
        setAdsets((prev) => ({ ...prev, [campaignId]: data.data || [] }));
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
      fetchCampaigns();
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
      fetchCampaigns();
    } catch {
      toast.error("Failed to update budget");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={fetchCampaigns} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Objective</TableHead>
              <TableHead className="text-right">Daily Budget</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaigns.map((c) => (
              <>
                <TableRow key={c.id}>
                  <TableCell>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => toggleExpand(c.id)}>
                      {expanded.has(c.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </Button>
                  </TableCell>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch checked={c.status === "ACTIVE"} onCheckedChange={() => toggleStatus(c.id, "campaign", c.status)} />
                      <Badge variant={c.status === "ACTIVE" ? "default" : "secondary"}>{c.status}</Badge>
                    </div>
                  </TableCell>
                  <TableCell>{c.objective?.replace("OUTCOME_", "") || "-"}</TableCell>
                  <TableCell className="text-right">
                    {editBudget?.id === c.id ? (
                      <Input className="ml-auto w-28 h-7 text-right" value={editBudget.value}
                        onChange={(e) => setEditBudget({ ...editBudget, value: e.target.value })}
                        onKeyDown={(e) => e.key === "Enter" && saveBudget()}
                        onBlur={saveBudget} autoFocus />
                    ) : (
                      <span className="cursor-pointer hover:underline"
                        onClick={() => setEditBudget({ id: c.id, type: "campaign", value: String(parseFloat(c.daily_budget || "0") / 100) })}>
                        {c.daily_budget ? `${(parseFloat(c.daily_budget) / 100).toFixed(0)} SEK` : "-"}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
                {expanded.has(c.id) && adsets[c.id]?.map((as) => (
                  <TableRow key={as.id} className="bg-muted/30">
                    <TableCell></TableCell>
                    <TableCell className="pl-10 text-sm">{as.name}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch checked={as.status === "ACTIVE"} onCheckedChange={() => toggleStatus(as.id, "adset", as.status)} />
                        <Badge variant={as.status === "ACTIVE" ? "default" : "secondary"} className="text-xs">{as.status}</Badge>
                      </div>
                    </TableCell>
                    <TableCell></TableCell>
                    <TableCell className="text-right">
                      {editBudget?.id === as.id ? (
                        <Input className="ml-auto w-28 h-7 text-right" value={editBudget.value}
                          onChange={(e) => setEditBudget({ ...editBudget, value: e.target.value })}
                          onKeyDown={(e) => e.key === "Enter" && saveBudget()}
                          onBlur={saveBudget} autoFocus />
                      ) : (
                        <span className="cursor-pointer hover:underline"
                          onClick={() => setEditBudget({ id: as.id, type: "adset", value: String(parseFloat(as.daily_budget || "0") / 100) })}>
                          {as.daily_budget ? `${(parseFloat(as.daily_budget) / 100).toFixed(0)} SEK` : "-"}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </>
            ))}
            {campaigns.length === 0 && !loading && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No campaigns found. Create your first campaign from the Upload page.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
